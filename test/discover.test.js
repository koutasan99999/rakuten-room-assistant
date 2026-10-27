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

test('ハッシュタグや強い断定（神・必須）も取り除く', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [{ id: 0, reason: 'r', intro: GOOD_INTRO + 'これは必須レベル。 #楽天ROOM #インテリア' }] })
  });
  const { data } = await call();
  assert.equal(data.products[0].intro, GOOD_INTRO);
});

test('紹介文の書き方ルールをAIに伝えている', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [{ id: 0, reason: 'r', intro: GOOD_INTRO }] })
  });
  await call();
  const system = mock.calls.openai[0].messages[0].content;
  for (const phrase of ['ハッシュタグ', '必要なら2つまで', '使わない表現', '良い例', '悪い例', '体験は作らない']) assert.ok(system.includes(phrase), phrase);
});

const STOCK_INTRO = '体重計のデザインが生活感を出しにくいタイプだと、部屋に置きっぱなしでも気になりにくいかなと思います。' +
  'こちらはホワイトカラーで統一感があり、底面を全面カバーする新設計が特徴。測定項目の表示もわかりやすい方向性なので、' +
  'ヘルスチェックを習慣化したい人のきっかけ作りに相性が良さそうです。';

test('定型表現の多い紹介文は、その商品だけAIに書き直してもらう', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: (body, n) => n === 1
      ? aiReply({ picks: [{ id: 0, reason: 'r', intro: GOOD_INTRO }, { id: 1, reason: 'r', intro: STOCK_INTRO }] })
      : aiReply({ intros: [{ id: 1, intro: GOOD_INTRO.replace('シンプル', 'すっきり') }] })
  });
  const { data } = await call();
  assert.equal(mock.calls.openai.length, 2);
  const rewriteReq = mock.calls.openai[1].messages[1].content;
  assert.match(rewriteReq, /id: 1/);
  assert.doesNotMatch(rewriteReq, /id: 0/); // 問題ない紹介文は送らない（料金節約）
  assert.equal(data.products[0].intro, GOOD_INTRO);
  assert.match(data.products[1].intro, /^すっきりな見た目/);
});

test('書き直しに失敗しても元の紹介文で表示する', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: (body, n) => n === 1
      ? aiReply({ picks: [{ id: 0, reason: 'r', intro: STOCK_INTRO }] })
      : json(500, { error: { message: 'server error' } })
  });
  const { status, data } = await call();
  assert.equal(status, 200);
  assert.equal(data.products[0].intro, STOCK_INTRO);
  assert.equal(data.detail, undefined);
});

test('「〜そう」「〜かも」を連発した紹介文は書き直しに回し、断定のルールをAIに伝える', async () => {
  const hedgy = 'ガラスと木の組み合わせがきれいで、キッチンに出しておいても絵になりそう。一杯分ずつ淹れられるサイズ感なので、朝にちょっとだけ飲みたいときにちょうど良さそう。' +
    '形がシンプルなので洗うのも面倒じゃないかも。見た目も落ち着いた色味で、ほかのキッチン道具ともなじむと思います。豆の味は好み次第。';
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: (body, n) => n === 1
      ? aiReply({ picks: [{ id: 0, reason: 'r', intro: hedgy }] })
      : aiReply({ intros: [{ id: 0, intro: GOOD_INTRO }] })
  });
  const { data } = await call();
  assert.equal(mock.calls.openai.length, 2);
  assert.match(mock.calls.openai[1].messages[1].content, /多すぎる/);
  assert.equal(data.products[0].intro, GOOD_INTRO);
  for (const req of mock.calls.openai) {
    const system = req.messages[0].content;
    assert.ok(system.includes('「絵になりそう」→「絵になる」'));
    assert.ok(system.includes('断定しない'));
  }
});

test('欲しい度（want）の高い順に並べ、低いものは外す（最低3件は残す）', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [
      { id: 0, want: 5, reason: '面倒が減る', intro: GOOD_INTRO },
      { id: 1, want: 9, reason: '面倒が減る', intro: GOOD_INTRO },
      { id: 2, want: 7, reason: '面倒が減る', intro: GOOD_INTRO },
      { id: 3, want: 8, reason: '面倒が減る', intro: GOOD_INTRO },
      { id: 4, want: 3, reason: '面倒が減る', intro: GOOD_INTRO }
    ] })
  });
  const { data } = await call();
  assert.equal(data.products.length, 3);
  const system = mock.calls.openai[0].messages[0].content;
  assert.ok(system.includes('運営者本人が欲しくなる商品'));
  assert.doesNotMatch(mock.calls.openai[0].messages[1].content.split('候補:')[1], /レビュー/); // 売れ筋で選ばせない
});

test('最近出した商品は候補から外し、AIにも伝える', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [{ id: 0, want: 8, reason: '面倒が減る', intro: GOOD_INTRO }] })
  });
  const req = { method: 'POST', headers: { host: 'x.app' }, body: { recent: ['商品3 おしゃれな収納ボックス タイプ3', 123, '別の商品'] } };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  const user = mock.calls.openai[0].messages[1].content;
  assert.match(user, /最近出した商品.*別の商品/);
  assert.doesNotMatch(user.split('候補:')[1], /商品3 /);
});

test('運営者目線の選定理由（SNS映え・人気など）は書き直しに回す', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: (body, n) => n === 1
      ? aiReply({ picks: [{ id: 0, want: 8, reason: '実用性が高く、SNSでも紹介しやすい人気商品です。', intro: GOOD_INTRO }] })
      : aiReply({ fixes: [{ id: 0, reason: 'ケーブルをまとめて隠せて、デスク下のごちゃつきが一気に片づく。', intro: GOOD_INTRO }] })
  });
  const { data } = await call();
  assert.equal(mock.calls.openai.length, 2);
  assert.equal(data.products[0].reason, 'ケーブルをまとめて隠せて、デスク下のごちゃつきが一気に片づく。');
  assert.equal(data.products[0].intro, GOOD_INTRO);
});

test('使用経験が必要な表現（これに変えてから・座り心地が良い）は取り除く', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [{ id: 0, want: 8, reason: '面倒が減る', intro: 'これに変えてから朝が楽。座り心地が良いのもポイント。' + GOOD_INTRO }] })
  });
  const { data } = await call();
  assert.equal(data.products[0].intro, GOOD_INTRO);
});

test('ブランド系ジャンル（香水など）ではブランド評価ルールを渡し、ショップ名は全ジャンルで渡す', async () => {
  const { GENRES } = await import('../lib/genres.js');
  const brandIds = GENRES.filter((g) => g.brand).map((g) => g.id);
  assert.ok(brandIds.includes('fragrance') && brandIds.includes('watch') && brandIds.includes('interior') && !brandIds.includes('gadget'));
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [{ id: 0, want: 8, reason: '面倒が減る', intro: GOOD_INTRO }] })
  });
  // ジャンルはランダムなので、ブランド系が選ばれるまで繰り返す
  for (let i = 0; i < 30; i++) {
    const { data } = await call();
    const user = mock.calls.openai[mock.calls.openai.length - 1].messages[1].content;
    const isBrand = brandIds.includes(data.genreId);
    assert.equal(user.includes('ブランド・プレゼント適性'), isBrand, data.genreId);
    assert.match(user, /販売: /); // 作り手・販売元はどのジャンルでも判断材料にする
    if (isBrand) return;
  }
});

test('選んだ根拠（basis）を返し、リストにない値は表示しない', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: () => aiReply({ picks: [
      { id: 0, want: 9, basis: 'ブランドで選ぶ', reason: '老舗メーカーの定番で、仕上げに理由がある。', intro: GOOD_INTRO },
      { id: 1, want: 8, basis: 'トレンド枠', reason: '最近よく見るウェーブ形の器で、今の流れを手頃に試せる。', intro: GOOD_INTRO },
      { id: 2, want: 7, basis: '安さで選ぶ', reason: '面倒が減る。', intro: GOOD_INTRO }
    ] })
  });
  const { data } = await call();
  assert.deepEqual(data.products.map((p) => p.basis), ['ブランドで選ぶ', 'トレンド枠', '']);
  const system = mock.calls.openai[0].messages[0].content;
  for (const phrase of ['基準ユーザー', 'トレンド枠', '値段を隠して見せても欲しいと思えるか', '根拠なく']) assert.ok(system.includes(phrase), phrase);
  assert.ok(!system.includes('安いのに妙に欲しくなる'));
});

test('「安いから」が理由の選定理由は書き直しに回す', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(20), pageCount: 3 }),
    openai: (body, n) => n === 1
      ? aiReply({ picks: [{ id: 0, want: 8, reason: 'とにかく安いから試しやすい。', intro: GOOD_INTRO }] })
      : aiReply({ fixes: [{ id: 0, reason: '取っ手が畳めて、引き出しにそのまま入る形が良い。', intro: GOOD_INTRO }] })
  });
  const { data } = await call();
  assert.equal(mock.calls.openai.length, 2);
  assert.equal(data.products[0].reason, '取っ手が畳めて、引き出しにそのまま入る形が良い。');
});
