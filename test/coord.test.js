import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import coordApi from '../server/coord.js';
import { slotOf, normalizeLooks, readCoordConditions, slotCaps, relaxSteps, genderOf } from '../lib/coord.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await coordApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const HERO = { name: 'New Balance 2002R メンズ スニーカー グレー', code: 'nb:1', price: 19800, url: 'https://item.rakuten.co.jp/nb/1/', image: 'https://thumbnail.image.rakuten.co.jp/nb/1.jpg' };

let n = 0;
function item(name, price = 6000) {
  n++;
  return { itemCode: `s:${n}`, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${n}/`, mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/s/${n}.jpg`], shopName: `店${n % 3}`, itemCaption: '説明' };
}

// 検索語の種類ごとに実在っぽい商品を返す楽天の偽物（グレーのニットは0件 → ゆるめて探す）
function rakuten(url) {
  const kw = url.searchParams.get('keyword');
  if (/グレー/.test(kw) && /ニット/.test(kw)) return json(200, { items: [], pageCount: 0 });
  const kind = (kw.match(/ニット|スラックス|バッグ|ブルゾン|Tシャツ|デニム|スウェット|チノパン|スニーカー/) || ['アイテム'])[0];
  return json(200, { pageCount: 2, items: [
    item(`UNIQLO メンズ ${kind} ベーシック ネイビー`, 3990), item(`GU メンズ ${kind} ワイド ブラック`, 2990), item(`BEAMS メンズ ${kind} 定番 ベージュ`, 12000),
    item('メンズ 靴下 5足セット', 1500) // 違う種類の商品は入れない
  ] });
}

const LOOKS = { looks: [
  { name: 'きれいめカジュアル', style: 'きれいめ', concept: '落ち着いた色でまとめる', items: [
    { slot: 'tops', kind: 'ニット', keyword: 'メンズ クルーネック ニット グレー', color: 'グレー' }, { slot: 'bottoms', kind: 'スラックス', keyword: 'メンズ スラックス' },
    { slot: 'shoes', kind: 'スニーカー', keyword: 'メンズ スニーカー' }, // 起点と同じ枠 → 出さない
    { slot: 'bag', kind: 'レザーバッグ', keyword: 'レザー ショルダーバッグ UNIQLO' }] },
  { name: '大人ストリート', style: 'ストリート', concept: 'ゆるいシルエット', items: [
    { slot: 'outer', kind: 'ブルゾン', keyword: 'メンズ ブルゾン' }, { slot: 'tops', kind: 'Tシャツ', keyword: 'メンズ Tシャツ' }, { slot: 'bottoms', kind: 'ワイドデニム', keyword: 'メンズ ワイド デニム' }] },
  { name: '休日カジュアル', style: '大人カジュアル', concept: '動きやすさ優先', items: [
    { slot: 'tops', kind: 'スウェット', keyword: 'メンズ スウェット' }, { slot: 'bottoms', kind: 'チノパン', keyword: 'メンズ チノパン' }, { slot: 'bag', kind: 'ショルダーバッグ', keyword: 'メンズ ショルダーバッグ' }] }
] };

test('アイテムの枠を見分ける（靴下は靴ではない）', () => {
  assert.equal(slotOf('ニューバランス スニーカー'), 'shoes');
  assert.equal(slotOf('メンズ 靴下 5足'), 'accessory');
  assert.equal(slotOf('ナイロン ブルゾン'), 'outer');
  assert.equal(slotOf('ワイドデニム'), 'bottoms');
  assert.equal(slotOf('ワンピース 花柄'), 'onepiece');
  assert.equal(genderOf(readCoordConditions({}), HERO), 'mens');
  assert.equal(genderOf(readCoordConditions({ gender: 'ladies' }), HERO), 'ladies');
});

test('AIの提案は「枠と検索語」だけ：起点と同じ枠は外し、性別の言葉を入れ、避けたいブランドを検索語から外す', () => {
  const cond = readCoordConditions({ avoidBrands: 'UNIQLO' });
  const looks = normalizeLooks(LOOKS, { heroSlot: 'shoes', gender: 'mens', cond });
  assert.equal(looks.length, 3);
  assert.ok(looks.every((l) => l.items.every((i) => i.slot !== 'shoes')));
  const bag = looks[0].items.find((i) => i.slot === 'bag');
  assert.ok(/^メンズ /.test(bag.keyword) && !/UNIQLO/.test(bag.keyword), bag.keyword);
  // ワンピースのときはトップス・ボトムスを入れない
  const one = normalizeLooks({ looks: [{ name: 'x', items: [{ slot: 'onepiece', kind: 'ワンピース', keyword: 'ワンピース' }, { slot: 'tops', keyword: 'ニット' }, { slot: 'bag', keyword: 'かごバッグ' }] }] }, { heroSlot: 'shoes', gender: 'ladies', cond: readCoordConditions({}) });
  assert.deepEqual(one[0].items.map((i) => i.slot), ['onepiece', 'bag']);
  // 予算は起点の分を引いて、枠の重みで分ける
  const caps = slotCaps([{ slot: 'tops' }, { slot: 'bottoms' }], readCoordConditions({ budget: '30000' }), 19800);
  assert.ok(caps[0] < caps[1] && caps[0] + caps[1] <= 12100, String(caps));
  assert.deepEqual(relaxSteps('メンズ クルーネック ニット グレー', 'ニット', 'メンズ').map((s) => s.keyword), ['メンズ クルーネック ニット グレー', 'メンズ クルーネック ニット', 'メンズ ニット']);
});

test('3パターンのコーデを、楽天の実在商品で組み立てる（AIの書いた商品名は使わない・違う種類・避けたいブランドは除く・少なければゆるめる）', async () => {
  mock = installFetchMock({ rakuten, openai: () => aiReply(LOOKS) });
  const r = await call({ hero: HERO, conditions: { avoidBrands: 'GU', budget: '50000', style: 'おまかせ' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.heroSlot, 'shoes');
  assert.equal(r.data.looks.length, 3);
  const all = r.data.looks.flatMap((l) => l.items);
  assert.ok(all.every((i) => i.slot !== 'shoes'));
  const products = all.map((i) => i.product).filter(Boolean);
  assert.ok(products.length >= 9, String(products.length));
  for (const p of products) {
    assert.match(p.url, /^https:\/\/item\.rakuten\.co\.jp\/s\//, '楽天の検索結果の商品だけ');
    assert.ok(p.name && p.price && p.image && p.shop && p.category && p.fetchedAt);
    assert.ok(!/GU/.test(p.name) && !/靴下/.test(p.name), p.name);
  }
  // グレーのニットは見つからない → 「メンズ クルーネック ニット」にゆるめて見つける
  const knit = r.data.looks[0].items.find((i) => i.slot === 'tops');
  assert.equal(knit.keyword, 'メンズ クルーネック ニット');
  assert.ok(knit.options.length >= 1 && knit.options.length <= 4);
  // 同じ商品を2つのコーデで使い回さない
  const codes = products.map((p) => p.code);
  assert.equal(new Set(codes).size, codes.length);
  // 予算は楽天の上限価格として渡す
  assert.ok(mock.calls.rakuten.every((c) => Number(c.url.searchParams.get('maxPrice')) > 0));
  assert.match(mock.calls.rakuten[0].url.searchParams.get('NGKeyword'), /GU/);
});

test('AIが使えないときは、定番の3パターンで実在商品を探す', async () => {
  mock = installFetchMock({ rakuten, openai: () => json(500, { error: { message: 'down' } }) });
  const r = await call({ hero: HERO, conditions: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.looks.length, 3);
  assert.match(r.data.notice, /定番の組み合わせ/);
  assert.ok(r.data.looks.every((l) => l.items.some((i) => i.product)));
  assert.equal((await call({ hero: null })).status, 400);
});
