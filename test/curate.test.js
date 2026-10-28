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
  const kw = url.searchParams.get('keyword').replace(/\s/g, '').slice(0, 8);
  const items = makeItems(10, kw).map((it, i) => ({ ...it, itemPrice: min + i * 100, shopName: `${kw}ショップ${i}` }));
  return json(200, { items, pageCount: 1 });
}

const CURATION = {
  title: '迷ったらこの順', lead: 'まずは無難な1つ目。物足りなくなったら2つ目、という順番。',
  verdict: '迷ったら最初の1つで十分。',
  items: [
    { id: 0, role: '本命', forWho: '長く使いたい人に', why: '素材と仕上げが一段上で、置いたときの存在感がある。', tradeoff: '高い分、ブランドの品質にお金を払っている。', intro: GOOD_INTRO },
    { id: 30, role: '安い代替', forWho: 'まず雰囲気を試したい人に', why: '色と形が近く、半額以下で同じ雰囲気を出せる。', tradeoff: '重さと細部の仕上げは妥協する。', intro: GOOD_INTRO }
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
    items: CURATION.items.map((x, i) => ({ ...x, id: i * 10, brandNote: '老舗の革小物ブランドで、30代に渡しても若すぎない落ち着いたデザイン。', giftClass: i ? '価格を抑えたい場合の候補' : '外しにくい王道' }))
  };
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply(withBrand) });
  const { data } = await call({ type: 'gift' });
  const [system, user] = mock.calls.openai[0].messages.map((m) => m.content);
  assert.ok(system.includes('この人にこのブランドを贈る理由があるか'));
  assert.ok(system.includes('劣化版'));
  assert.ok(system.includes('プレゼントの相手'));
  assert.match(user, /販売: /);
  assert.equal(data.products[0].giftClass, '外しにくい王道');
  assert.ok(data.products[0].brandNote.includes('老舗'));
});

test('分類リストにない giftClass は表示しない', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply({ ...CURATION, items: CURATION.items.map((x) => ({ ...x, giftClass: '最強ギフト' })) }) });
  const { data } = await call({ type: 'gift' });
  assert.ok(data.products.every((p) => p.giftClass === ''));
});

test('ブランドが関係ない型ではプレゼント向けブランド評価ルールを付けない（料金節約）', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply(CURATION) });
  await call({ type: 'budget_tiers' });
  const [system, user] = mock.calls.openai[0].messages.map((m) => m.content);
  assert.ok(!system.includes('ブランド・プレゼント適性'));
  assert.match(user, /販売:/); // 作り手・販売元はどのテーマでも判断材料にする
  assert.ok(system.includes('基準ユーザー'));
});

test('偽物・正規品の断定や「劣化版」扱いは文章から取り除く', async () => {
  const items = CURATION.items.map((x) => ({ ...x, tradeoff: '本物と違い劣化版です。', intro: 'これは正規品なので安心。' + GOOD_INTRO }));
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply({ ...CURATION, items }) });
  const { data } = await call({ type: 'premium_budget' });
  assert.equal(data.products[0].intro, GOOD_INTRO);
  assert.equal(data.products[0].tradeoff, '');
});

test('AIの応答の形が揺れても読み取る（キー名・入れ子・全角番号・"候補3"）', async () => {
  const variants = [
    { picks: CURATION.items },
    { curation: { title: 't', items: CURATION.items } },
    { ...CURATION, items: CURATION.items.map((x) => ({ ...x, id: `候補${x.id}` })) },
    { ...CURATION, items: CURATION.items.map((x) => ({ ...x, id: String(x.id).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xFEE0)) })) },
    CURATION.items
  ];
  for (const v of variants) {
    mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply(v) });
    const { data } = await call({ type: 'premium_budget' });
    mock.restore();
    assert.equal(data.products.length, 2, JSON.stringify(v).slice(0, 60));
    assert.equal(data.notice, '', JSON.stringify(v).slice(0, 60));
  }
  mock = null;
});

test('紹介文が短くても商品は残し、書き直しでも足りなければ予備の文にする', async () => {
  const short = { ...CURATION, items: CURATION.items.map((x) => ({ ...x, intro: '愛用しています。' })) };
  mock = installFetchMock({
    rakuten: rakutenByPrice,
    openai: (body, n) => n === 1 ? aiReply(short) : aiReply({ fixes: [{ id: 0, reason: CURATION.items[0].why, intro: GOOD_INTRO }] })
  });
  const { data } = await call({ type: 'premium_budget' });
  assert.equal(data.products.length, 2);
  assert.equal(data.products[0].intro, GOOD_INTRO);
  assert.ok(data.products[1].intro.length >= 60); // 予備の文
  assert.equal(data.notice, '');
});

test('組み立てに失敗したときは、何が足りなかったかを原因に書く', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply({ title: 't', items: [{ id: 999 }, { id: 0 }, { id: 0 }] }) });
  const { data } = await call({ type: 'premium_budget' });
  assert.match(data.detail, /項目3件・番号不正1・重複1/);
});

test('まとめは最大6件、本命・代替を枠ごとに複数選べる', async () => {
  const items = [0, 1, 2, 10, 11, 12, 13].map((id, i) => ({ id, role: i < 3 ? `本命${i}` : `代替${i}`, why: '理由', intro: GOOD_INTRO }));
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply({ ...CURATION, items }) });
  const { data } = await call({ type: 'premium_budget' });
  assert.equal(data.products.length, 6);
  assert.ok(mock.calls.openai[0].messages[0].content.includes('本命側3個＋代替側3個'));
});

test('AIが失敗したときの予備表示も、枠が少なければ2巡して増やす（最大6件）', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply('JSONではない') });
  const { data } = await call({ type: 'gift' }); // 3枠のテーマ → 2巡で6件
  assert.equal(data.products.length, 6);
});

test('本命＋安い代替：比較軸・一言・本命/代替を返し、候補に価格帯を付けて渡す', async () => {
  const items = [0, 10, 20, 30, 40, 1].map((id, i) => ({
    id, role: `役割${i}`, side: i < 2 ? '本命' : '代替', pick: ['ブランド込みで欲しいならこれ', 'ギフトっぽさを出すならこれ', '価格を抑えるならこのへん', '普段使いしやすいのはこれ', 'まず1枚試すならこれ', '迷ったらこれ'][i],
    why: '理由', intro: GOOD_INTRO
  }));
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply({ ...CURATION, axis: 'ブランド性 × 価格差', items }) });
  const { data } = await call({ type: 'premium_budget' });
  assert.equal(data.axis, 'ブランド性 × 価格差');
  assert.equal(data.products[0].pick, 'ブランド込みで欲しいならこれ');
  assert.equal(data.products[0].side, '本命');
  assert.equal(data.products[2].side, '代替');
  assert.equal(mock.calls.rakuten.length, 5); // 5つの枠で幅広く集める
  const [system, user] = mock.calls.openai[0].messages.map((m) => m.content);
  assert.ok(system.includes('比較軸'));
  assert.match(user, /価格帯 [高中低]/);
});

test('比較ルールは本命＋安い代替のときだけ付ける', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply(CURATION) });
  await call({ type: 'first_pick' });
  assert.ok(!mock.calls.openai[0].messages[0].content.includes('本命＋安い代替の組み立て'));
});

test('同じショップ3個目・ほぼ同じ商品名は間引き、価格差が小さい・代替が無いときは知らせる', async () => {
  const { checkComparison } = await import('../lib/curation.js');
  const flat = [
    { name: 'イッタラ ティーマ 17cm ホワイト', shop: 'A', price: 3000 },
    { name: 'イッタラ ティーマ 17cm ホワイト 2枚', shop: 'B', price: 5000 },
    { name: 'ティーマ マグ', shop: 'A', price: 2800 },
    { name: 'ティーマ ボウル', shop: 'A', price: 2600 },
    { name: '波佐見焼 取り皿', shop: 'C', price: 2400 }
  ];
  const items = flat.map((_, index) => ({ index, side: '本命' }));
  const r = checkComparison(items, flat);
  assert.deepEqual(r.items.map((x) => x.index), [0, 2, 4]); // 1は名前がほぼ同じ、3はショップAの3個目
  assert.ok(r.warnings.includes('今回は価格差が小さめです'));
  assert.ok(r.warnings.includes('代替側に当たる商品が見つかりませんでした'));
});
