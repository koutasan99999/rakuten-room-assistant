import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/discover.js';
import { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', RAKUTEN_ACCESS_KEY: 'key', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(env = ENV, headers = {}) {
  const req = { method: 'POST', headers: { host: 'room.example.app', ...headers } };
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; }
  };
  await handler(req, res, env);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('正常系：最大5件、URLと価格は楽天の値を使う', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(30), pageCount: 10 }),
    openai: () => aiReply({ picks: [0, 3, 5, 7, 9, 11].map((id) => ({ id, reason: '見た目が良い', intro: GOOD_INTRO, url: 'https://evil.example/', price: 1 })) })
  });
  const { status, data } = await call();
  assert.equal(status, 200);
  assert.equal(data.products.length, 5);
  for (const p of data.products) {
    assert.match(p.url, /^https:\/\/item\.rakuten\.co\.jp\//);
    assert.ok(p.price >= 1000);
    assert.equal(p.intro, GOOD_INTRO);
  }
  const r = mock.calls.rakuten[0];
  assert.equal(r.url.searchParams.get('accessKey'), 'key');
  assert.equal(r.headers.Referer, 'https://room.example.app/');
  const page = Number(r.url.searchParams.get('page'));
  assert.ok(page >= 1 && page <= 5);
  // AIに送る商品情報は短く切り詰める
  assert.ok(mock.calls.openai[0].messages[1].content.length < 6000);
});

test('ふるさと納税・重複商品を除外する', async () => {
  const items = makeItems(5);
  items[0].itemName = '【ふるさと納税】収納ボックス';
  items.push({ ...items[1], itemCode: 'other:dup' });
  mock = installFetchMock({
    rakuten: () => json(200, { items, pageCount: 1 }),
    openai: (body) => {
      assert.doesNotMatch(body.messages[1].content, /ふるさと納税/);
      return aiReply({ picks: [{ id: 0, reason: 'r', intro: GOOD_INTRO }] });
    }
  });
  const { data } = await call();
  assert.equal(data.products.length, 1);
  assert.equal(mock.calls.openai.length, 1);
});

test('ランダムなページが範囲外なら存在するページで取り直す', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      const page = Number(url.searchParams.get('page'));
      return page > 1 ? json(200, { items: [], pageCount: 1 }) : json(200, { items: makeItems(12), pageCount: 1 });
    },
    openai: () => aiReply({ picks: [{ id: 1, reason: 'r', intro: GOOD_INTRO }] })
  });
  const { status, data } = await call();
  assert.equal(status, 200);
  assert.equal(data.products.length, 1);
});

test('商品0件でも止まらない', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: [], pageCount: 0 }),
    openai: () => { throw new Error('呼ばれないはず'); }
  });
  const { status, data } = await call();
  assert.equal(status, 200);
  assert.equal(data.products.length, 0);
  assert.ok(data.notice);
});

test('楽天APIエラーは分かりやすいメッセージで返す', async () => {
  mock = installFetchMock({
    rakuten: () => json(403, { errors: { errorMessage: 'REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING' } }),
    openai: () => aiReply({})
  });
  const { status, data } = await call();
  assert.equal(status, 502);
  assert.match(data.detail, /403/);
  assert.equal(mock.calls.rakuten.length, 1); // 認証エラーは繰り返さない
});

test('AIのJSONが壊れていても予備の選定で表示する', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply('ごめんなさい、これはJSONではありません')
  });
  const { status, data } = await call();
  assert.equal(status, 200);
  assert.equal(data.products.length, 5);
  assert.ok(data.notice);
});

test('モデルが無ければ次の低コストモデルを試す', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: (body, n) => n === 1
      ? json(404, { error: { message: 'The model does not exist', code: 'model_not_found' } })
      : aiReply('```json\n' + JSON.stringify({ picks: [{ id: 2, reason: 'r', intro: GOOD_INTRO }] }) + '\n```')
  });
  const { data } = await call();
  assert.equal(mock.calls.openai.length, 2);
  assert.notEqual(mock.calls.openai[0].model, mock.calls.openai[1].model);
  assert.equal(data.products.length, 1);
  assert.equal(data.notice, '今回は1件見つかりました。');
});

test('虚偽の体験談・根拠のない表現・絵文字は取り除く', async () => {
  const bad = '毎日愛用しています。' + GOOD_INTRO + '絶対おすすめです！✨';
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [{ id: 0, reason: '最安でお得😊', intro: bad }] })
  });
  const { data } = await call();
  const p = data.products[0];
  assert.doesNotMatch(p.intro, /愛用|絶対|✨/);
  assert.ok(p.intro.includes('シンプルな見た目'));
  assert.doesNotMatch(p.reason, /最安|😊/);
});

test('合言葉が違えば401、合っていれば動く', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [{ id: 0, reason: 'r', intro: GOOD_INTRO }] })
  });
  const env = { ...ENV, APP_PASSCODE: 'hello' };
  assert.equal((await call(env, { 'x-app-passcode': 'nope' })).status, 401);
  assert.equal(mock.calls.rakuten.length, 0);
  assert.equal((await call(env, { 'x-app-passcode': 'hello' })).status, 200);
});

test('APIキー未設定でも落ちずにエラーを返す', async () => {
  const { status, data } = await call({});
  assert.equal(status, 500);
  assert.match(data.error, /設定/);
});

test('ジャンル記録を受け取り、ジャンルIDを返す', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [{ id: 0, reason: 'r', intro: GOOD_INTRO }] })
  });
  const req = { method: 'POST', headers: { host: 'x.app' }, body: { stats: { coffee: { shown: 1, copied: 50 } } } };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  const data = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.match(data.genreId, /^[a-z_]+$/);
  assert.ok(data.genre);
});

test('APIキー前後の空白・改行を取り除いて送る', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [{ id: 0, reason: 'r', intro: GOOD_INTRO }] })
  });
  let auth;
  const orig = globalThis.fetch;
  globalThis.fetch = (url, opts) => { if (String(url).includes('openai')) auth = opts.headers.Authorization; return orig(url, opts); };
  try {
    const { data } = await call({ ...ENV, OPENAI_API_KEY: '  sk-test\n' });
    assert.equal(auth, 'Bearer sk-test');
    assert.equal(data.notice, '今回は1件見つかりました。');
  } finally { globalThis.fetch = orig; }
});

test('使えない設定（reasoning_effortなど）は外して同じモデルでやり直す', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: (body) => 'reasoning_effort' in body
      ? json(400, { error: { message: "Unsupported value: 'reasoning_effort'", param: 'reasoning_effort', code: 'unsupported_value' } })
      : aiReply({ picks: [{ id: '候補2', reason: 'r', intro: GOOD_INTRO }] })
  });
  const { data } = await call();
  assert.equal(mock.calls.openai.length, 2);
  assert.equal(mock.calls.openai[0].model, mock.calls.openai[1].model);
  assert.equal(data.products.length, 1);
});

test('認証エラーは他モデルを試さず、伏せ字の原因を画面用に返す', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => json(401, { error: { message: 'Incorrect API key provided: sk-proj-abcd1234. You can find your API key at ...', code: 'invalid_api_key' } })
  });
  const { data } = await call();
  assert.equal(mock.calls.openai.length, 1);
  assert.equal(data.products.length, 5);
  assert.match(data.detail, /401/);
  assert.doesNotMatch(data.detail, /abcd1234/);
});

test('応答が空なら次のモデルを試す', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: (body, n) => n === 1
      ? json(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }] })
      : aiReply({ picks: [{ id: 1, reason: 'r', intro: GOOD_INTRO }] })
  });
  const { data } = await call();
  assert.equal(mock.calls.openai.length, 2);
  assert.equal(data.products.length, 1);
  assert.equal(data.detail, undefined);
});
