import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import replace from '../api/replace.js';
import curate from '../api/curate.js';
import { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(handler, body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const CONTEXT = {
  type: 'gift', title: '30代男性への5,000円プレゼント', audience: '30代男性', brand: true, pick: true, request: '企画の狙い',
  slots: [{ label: '迷ったらこれ', keyword: 'タンブラー', minPrice: 3000, maxPrice: 7000 }, { label: 'センス枠', keyword: 'ハンカチ ブランド' }]
};

test('まとめの結果に、差し替え用の条件（枠）と各商品の枠名が付く', async () => {
  mock = installFetchMock({
    rakuten: (url) => json(200, { items: makeItems(10, url.searchParams.get('keyword')).map((it, i) => ({ ...it, itemPrice: (Number(url.searchParams.get('minPrice')) || 1000) + i * 10 })), pageCount: 3 }),
    openai: () => aiReply({ title: 't', lead: 'l', verdict: 'v', items: [0, 1, 12].map((id) => ({ id, role: '役割' + id, intro: GOOD_INTRO })) })
  });
  const { data } = await call(curate, { type: 'gift' });
  assert.ok(data.context && data.context.slots.length >= 2);
  assert.equal(data.context.type, 'gift');
  assert.ok(data.products.every((p) => p.slot), JSON.stringify(data.products.map((p) => p.slot)));
});

test('外した商品の代わりを、同じ枠から・外した商品と今の商品を除いて1つ選ぶ（役割はそのまま）', async () => {
  mock = installFetchMock({
    rakuten: (url) => json(200, { items: makeItems(10, url.searchParams.get('keyword')), pageCount: 3 }),
    openai: () => aiReply({ items: [{ id: 0, role: '別の役割', memo: '迷ったらまずこれでいい枠。', why: '取っ手が畳めて、引き出しにそのまま入る形が良い。', intro: GOOD_INTRO }] })
  });
  const first = makeItems(10, 'ハンカチ ブランド');
  const { status, data } = await call(replace, {
    context: CONTEXT, slot: 'センス枠', role: 'センス枠', tries: 0,
    exclude: [first[0].itemCode, first[1].itemCode],
    others: [{ name: '今あるタンブラー', role: '迷ったらこれ' }]
  });
  assert.equal(status, 200);
  assert.equal(mock.calls.rakuten[0].url.searchParams.get('keyword'), 'ハンカチ ブランド');
  assert.equal(data.product.role, 'センス枠');
  assert.equal(data.product.slot, 'センス枠');
  assert.ok(![first[0].itemCode, first[1].itemCode].includes(data.product.code), data.product.code);
  const msg = mock.calls.openai[0].messages;
  assert.match(msg[0].content, /1個だけ選ぶ/);
  assert.match(msg[1].content, /今あるタンブラー/);
  assert.ok(!msg[1].content.includes(first[0].itemName.slice(0, 20))); // 外した商品は候補に出さない
});

test('AIが失敗しても同じ枠の候補で入れ替える／候補が無ければ知らせる／条件が無ければ400', async () => {
  mock = installFetchMock({ rakuten: () => json(200, { items: makeItems(5), pageCount: 1 }), openai: () => aiReply('だめ') });
  const fb = (await call(replace, { context: CONTEXT, slot: 'センス枠', role: '少しセンスよく' })).data;
  assert.equal(fb.product.role, '少しセンスよく');
  assert.match(fb.notice, /AIでの選び直しに失敗/);
  mock.restore();

  const all = makeItems(5).map((x) => x.itemCode);
  mock = installFetchMock({ rakuten: () => json(200, { items: makeItems(5), pageCount: 1 }), openai: () => aiReply('だめ') });
  const none = (await call(replace, { context: CONTEXT, slot: 'センス枠', exclude: all })).data;
  assert.equal(none.product, null);
  assert.match(none.notice, /見つかりませんでした/);
  assert.equal(mock.calls.rakuten.length, 2); // 1ページ目で足りなければ2ページ目も見る

  const bad = await call(replace, { context: { type: 'nope', slots: [] } });
  assert.equal(bad.status, 400);
});
