import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/curate.js';
import { THEMES, CURATION_TYPES, pickTheme } from '../lib/themes.js';
import { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', RAKUTEN_ACCESS_KEY: 'key', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(body = {}, env = ENV) {
  const req = { method: 'POST', headers: { host: 'room.example.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, env);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

// 価格帯の指定に合う偽商品を返す
function rakutenByPrice(url) {
  const min = Number(url.searchParams.get('minPrice')) || 500;
  const items = makeItems(10, url.searchParams.get('keyword').split(' ')[0]).map((it, i) => ({ ...it, itemPrice: min + i * 100 }));
  return json(200, { items, pageCount: 1 });
}

const CURATION = {
  title: '迷ったらこの順', lead: 'まずは無難な1つ目。物足りなくなったら2つ目、という順番。',
  verdict: '迷ったら最初の1つで十分。',
  items: [
    { id: 0, role: '本命', forWho: '長く使いたい人に', why: '素材と仕上げが一段上で、置いたときの存在感がある。', tradeoff: '高い分、ブランドの品質にお金を払っている。', intro: GOOD_INTRO },
    { id: 8, role: '安い代替', forWho: 'まず雰囲気を試したい人に', why: '色と形が近く、半額以下で同じ雰囲気を出せる。', tradeoff: '重さと細部の仕上げは妥協する。', intro: GOOD_INTRO }
  ]
};

test('テーマはすべて既知の型で、各テーマに2枠以上ある', () => {
  assert.ok(THEMES.length >= 20);
  for (const t of THEMES) {
    assert.ok(CURATION_TYPES[t.type], t.id);
    assert.ok(t.slots.length >= 2, t.id);
  }
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
  for (const type of Object.keys(CURATION_TYPES)) {
    for (let i = 0; i < 20; i++) assert.equal(pickTheme(type).type, type);
  }
});

test('指定した型でまとめを作り、本物の価格・URLを使う', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply(CURATION) });
  const { status, data } = await call({ type: 'premium_budget' });
  assert.equal(status, 200);
  assert.equal(data.typeName, '本命＋安い代替');
  assert.equal(data.products.length, 2);
  assert.equal(data.products[0].role, '本命');
  assert.equal(data.products[1].role, '安い代替');
  assert.match(data.products[0].url, /^https:\/\/item\.rakuten\.co\.jp\//);
  assert.ok(data.products[0].price > data.products[1].price); // 本命の方が高い
  assert.ok(data.verdict && data.lead && data.products[1].tradeoff);
  // 価格帯を楽天に指定している
  assert.ok(mock.calls.rakuten.some((c) => c.url.searchParams.get('minPrice')));
  // まとめの型の説明をAIに渡している
  assert.ok(mock.calls.openai[0].messages[0].content.includes('何が似ているのか'));
});

test('価格帯から外れた商品は候補にしない', async () => {
  mock = installFetchMock({
    rakuten: () => json(200, { items: makeItems(10).map((it, i) => ({ ...it, itemPrice: i % 2 ? 100000 : 1000 })), pageCount: 1 }),
    openai: () => aiReply(CURATION)
  });
  await call({ type: 'first_pick' }); // この型のテーマはすべての枠に上限価格がある
  const user = mock.calls.openai[0].messages[1].content;
  assert.match(user, /1000円/);
  assert.doesNotMatch(user, /100000円/);
});

test('AIが失敗しても枠ごとの商品で表示する', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply('JSONではない') });
  const { status, data } = await call({ type: 'gift' });
  assert.equal(status, 200);
  assert.ok(data.products.length >= 2);
  assert.ok(data.products.every((p) => p.role && p.intro));
  assert.ok(data.notice);
});

test('商品がほとんど見つからなければ止まらずに案内する', async () => {
  mock = installFetchMock({ rakuten: () => json(200, { items: [], pageCount: 0 }), openai: () => aiReply(CURATION) });
  const { status, data } = await call({ type: 'first_pick' });
  assert.equal(status, 200);
  assert.equal(data.products.length, 0);
  assert.ok(data.notice);
  assert.equal(mock.calls.openai.length, 0);
});

test('楽天の認証エラーは1回で打ち切ってエラーを返す', async () => {
  mock = installFetchMock({ rakuten: () => json(403, { errors: { errorMessage: 'REFERRER_MISSING' } }), openai: () => aiReply(CURATION) });
  const { status } = await call({ type: 'use_case' });
  assert.equal(status, 502);
  assert.equal(mock.calls.rakuten.length, 1);
});

test('合言葉が違えば401', async () => {
  const { status } = await call({}, { ...ENV, APP_PASSCODE: 'x' });
  assert.equal(status, 401);
});

test('プレゼントの型ではブランド評価・相手・ショップ名をAIに渡し、分類と評価を返す', async () => {
  const withBrand = {
    ...CURATION,
    items: CURATION.items.map((x, i) => ({ ...x, brandNote: '老舗の革小物ブランドで、30代に渡しても若すぎない落ち着いたデザイン。', giftClass: i ? '価格を抑えたい場合の候補' : '外しにくい王道' }))
  };
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply(withBrand) });
  const { data } = await call({ type: 'gift' });
  const [system, user] = mock.calls.openai[0].messages.map((m) => m.content);
  assert.ok(system.includes('この人にこのブランドを贈る理由があるか'));
  assert.ok(system.includes('劣化版'));
  assert.ok(system.includes('プレゼントの相手'));
  assert.match(user, /販売: テストショップ/);
  assert.equal(data.products[0].giftClass, '外しにくい王道');
  assert.ok(data.products[0].brandNote.includes('老舗'));
});

test('分類リストにない giftClass は表示しない', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply({ ...CURATION, items: CURATION.items.map((x) => ({ ...x, giftClass: '最強ギフト' })) }) });
  const { data } = await call({ type: 'gift' });
  assert.ok(data.products.every((p) => p.giftClass === ''));
});

test('ブランドが関係ない型ではブランド評価ルールを付けない（料金節約）', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply(CURATION) });
  await call({ type: 'budget_tiers' });
  const [system, user] = mock.calls.openai[0].messages.map((m) => m.content);
  assert.ok(!system.includes('ブランド・プレゼント適性'));
  assert.doesNotMatch(user, /販売:/);
});

test('偽物・正規品の断定や「劣化版」扱いは文章から取り除く', async () => {
  const items = CURATION.items.map((x) => ({ ...x, tradeoff: '本物と違い劣化版です。', intro: 'これは正規品なので安心。' + GOOD_INTRO }));
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply({ ...CURATION, items }) });
  const { data } = await call({ type: 'premium_budget' });
  assert.equal(data.products[0].intro, GOOD_INTRO);
  assert.equal(data.products[0].tradeoff, '');
});
