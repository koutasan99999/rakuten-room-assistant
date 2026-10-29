import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import seedApi from '../server/seed-ideas.js';
import exploreApi from '../server/explore.js';
import { fallbackSeedIdeas, readSeedProduct } from '../lib/seed.js';
import { installFetchMock, makeItems, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(handler, body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const PRODUCT = {
  name: 'UGREEN Nexode 急速充電器 65W Type-C 2C1A 3ポート', code: 'ugreen:65w', price: 4280,
  url: 'https://item.rakuten.co.jp/ugreen/65w/', image: 'https://thumbnail.image.rakuten.co.jp/x.jpg', shop: 'UGREEN公式', caption: '3ポート同時充電'
};

const IDEAS = [
  { topic: 'iPhoneの充電まわり', type: 'first_pick', typeLabel: 'まずコレ', role: 'main', howUsed: '本命の1つとして基準にする', searchGenres: ['USB-C 充電器', 'ワイヤレス充電器', 'USB-Cケーブル'], expectedCount: 18, whyWorks: '種類が多く迷う人が多い', target: 'iPhoneユーザー', priceBand: '1,500〜6,000円' },
  { topic: 'AnkerとUGREEN、結局どっちを選ぶ？', type: 'brand', typeLabel: 'ブランド比較', role: 'main', howUsed: 'UGREEN側の代表', searchGenres: ['Anker 充電器', 'UGREEN 充電器'], expectedCount: 40, whyWorks: '2ブランドで迷う', axis: 'ブランド vs 価格' },
  { topic: '旅行に持っていく充電グッズ', type: 'use_case', typeLabel: '用途別', role: 'trigger', howUsed: '1台で複数充電できる枠', searchGenres: ['モバイルバッテリー', '変換プラグ', 'ケーブル 収納'], expectedCount: 18, whyWorks: '旅行前にまとめて揃える' },
  { topic: '旅行に持っていく充電グッズ', type: 'use_case', role: 'trigger', searchGenres: ['重複', 'した案'] }, // 同じ切り口は落とす
  { topic: 'デスクの充電ケーブルを減らす方法', type: 'nope', typeLabel: '悩み解決', role: 'trigger', howUsed: '解決策の1つ', searchGenres: ['ケーブルトレー', 'USBハブ'], expectedCount: 16, whyWorks: '配線は多くの人の悩み' }
];

test('この商品から企画を考える：切り口の違う3〜5案を、主役型・きっかけ型・追加で探すジャンルつきで返す', async () => {
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply({ analysis: '出力が高い3ポート充電器', ideas: IDEAS }) });
  const { status, data } = await call(seedApi, { product: PRODUCT });
  assert.equal(status, 200);
  assert.equal(data.ideas.length, 4);
  const [a, b, c, d] = data.ideas;
  assert.equal(a.title, 'iPhoneの充電まわりについて本気出して考えてみた');
  assert.equal(a.postType, 'まずコレ');
  assert.equal(a.curationType, 'first_pick');
  assert.equal(a.seedRole, 'main');
  assert.deepEqual(a.searchGenres, ['USB-C 充電器', 'ワイヤレス充電器', 'USB-Cケーブル']);
  assert.equal(b.expectedCount, 20); // 想定候補数は10〜20に収める
  assert.equal(c.seedRole, 'trigger');
  assert.equal(d.curationType, 'omakase'); // 知らない型はおまかせ
  assert.ok(data.ideas.every((x) => x.edited && x.seeded && x.seed.code === 'ugreen:65w'));
  const [system, user] = mock.calls.openai[0].messages.map((m) => m.content);
  assert.match(system, /主役型/);
  assert.match(system, /きっかけ型/);
  assert.match(user, /起点の商品: UGREEN/);
  assert.match(user, /価格: 4280円/);
});

test('AIが使えなくても3案（型の違う企画）を返す／商品がなければ400', async () => {
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const { data } = await call(seedApi, { product: PRODUCT });
  assert.equal(data.ideas.length, 3);
  assert.ok(data.notice);
  assert.equal(new Set(data.ideas.map((x) => x.curationType)).size, 3);
  assert.ok(data.ideas.some((x) => x.seedRole === 'trigger'));
  assert.equal((await call(seedApi, { product: {} })).status, 400);
  assert.equal(readSeedProduct({ name: 'x', url: 'javascript:alert(1)' }).url, '');
  assert.equal(fallbackSeedIdeas({ name: '充電式 ポータブルジューサー 380mL', price: 1480 }).length, 3);
});

test('この企画で広げる：起点の商品を「必ず採用」で先頭に残し、検索では同じ商品を除き、追加で探すジャンルをヒントにする', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword').replace(/\s/g, '');
      // どの検索にも起点の商品が混ざっている
      const items = [{ itemCode: 'ugreen:65w', itemName: PRODUCT.name, itemPrice: 4280, itemUrl: PRODUCT.url, mediumImageUrls: [], shopName: 'UGREEN公式', itemCaption: '' }]
        .concat(makeItems(8, kw).map((it, i) => ({ ...it, itemPrice: 2000 + i * 300, shopName: `${kw}${i % 3}` }))); // 企画の価格帯（1,500〜6,000円）に入る値段
      return json(200, { items, pageCount: 1 });
    },
    openai: (body) => body.messages[0].content.includes('探索係')
      ? aiReply({ angles: ['USB-C 充電器', 'ワイヤレス充電器', 'USB-Cケーブル', 'MagSafe スタンド'].map((keyword) => ({ label: keyword.slice(0, 8), keyword })) })
      : aiReply({ items: Array.from({ length: 16 }, (_, id) => ({ id, role: ['本命', 'コスパ', '変わり種', 'トレンド枠', '実用品', '2番手'][id % 6], shortName: `候補${id}`, brand: `B${id}`, kind: `種類${id}`, reason: '理由', memo: '' })) })
  });
  const idea = (await (async () => {
    const m = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply({ ideas: IDEAS }) });
    const r = await call(seedApi, { product: PRODUCT });
    m.restore();
    return r.data.ideas[0];
  })());
  const { status, data } = await call(exploreApi, { idea, seed: PRODUCT });
  assert.equal(status, 200);
  const [first, ...rest] = data.candidates;
  assert.equal(first.code, 'ugreen:65w');
  assert.equal(first.role, '起点商品');
  assert.ok(first.pinned && first.picked);
  assert.equal(first.postRole, '本命'); // 主役型なので、Instagram画像では本命
  assert.equal(first.reason, '本命の1つとして基準にする');
  assert.ok(rest.length >= 15, String(rest.length));
  assert.ok(rest.every((c) => c.code !== 'ugreen:65w'), '起点の商品は追加候補に重ねない');
  // 起点の商品からは、AIの検索語ではなく検索軸で広げる（企画の「追加で探すジャンル」も探す）
  assert.ok(!mock.calls.openai.some((b) => b.messages[0].content.includes('探索係')));
  const kws = mock.calls.rakuten.map((c) => c.url.searchParams.get('keyword'));
  assert.ok(kws.includes('USB-C 充電器') && kws.includes('ワイヤレス充電器'), kws.join(' / '));
  assert.ok(kws.every((k) => !k.includes('Nexode')), '商品名をそのまま検索しない');
  // 選ぶAIには、起点の商品のことと、どの方向から集めたかを伝える
  const selectText = mock.calls.openai.map((b) => b.messages.map((m) => m.content).join('\n')).join('\n');
  assert.match(selectText, /起点の商品（すでに候補に入っているので、同じ商品は選ばない）: UGREEN/);
  assert.match(selectText, /似た他ブランドの商品・ほかのコラボ/);
});
