import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import radarApi from '../server/radar.js';
import { parseDates, detectStatus, detectBrand, mergeItems, planQueries, QUERY_TYPES } from '../lib/radar.js';
import { RADAR_GENRES, RADAR_GROUPS } from '../lib/radar-genres.js';
import { installFetchMock, json } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
const NOW = new Date('2026-10-29T10:00:00+09:00');
let mock;
afterEach(() => mock && mock.restore());

async function call(body, method = 'POST') {
  const req = { method, headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await radarApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('日付：書いてあるものだけ読む（予約期間・発売日・「下旬」・年なし）', () => {
  assert.deepEqual(parseDates('【予約】2026年11月20日発売 予約受付期間：10/1〜11/5', NOW), {
    preorderStart: '2026-10-01', preorderEnd: '2026-11-05', releaseDate: '2026-11-20', releaseText: '2026年11月20日発売'
  });
  assert.deepEqual(parseDates('発売日：2027.1.15', NOW).releaseDate, '2027-01-15');
  // 年がなければ、今日から見て一番近い年（10月に「1月」→来年）
  assert.equal(parseDates('1/20頃発送予定', NOW).releaseDate, '2027-01-20');
  // 日付まで書いていないときは、書いてあるとおりの文字と月だけ（日付は作らない）
  const part = parseDates('11月下旬発売予定', NOW);
  assert.equal(part.releaseDate, undefined);
  assert.deepEqual([part.releaseMonth, part.releaseText], ['2026-11', '11月下旬発売']);
  assert.equal(parseDates('予約締切 11/10まで', NOW).preorderEnd, '2026-11-10');
  assert.equal(parseDates('12/3再入荷', NOW).restockDate, '2026-12-03');
  assert.equal(parseDates('発売日未定', NOW).releaseText, '発売日未定');
  assert.deepEqual(parseDates('サイズ 26cm 送料無料', NOW), {});
});

test('状態：予約・発売予定・新作・再販・限定・コラボ・新色・特別販売（複数つけてよい）', () => {
  const st = (t) => detectStatus(t, parseDates(t, NOW), NOW);
  assert.deepEqual(st('【予約】ジャケット 2026年11月20日発売').sort(), ['COMING_SOON', 'PRE_ORDER']);
  assert.deepEqual(st('New Balance 990v6'), []); // ブランド名の New は NEW にしない
  assert.ok(st('2026秋冬 新作 NEW').includes('NEW'));
  assert.deepEqual(st('再入荷しました'), ['RESTOCK']);
  assert.deepEqual(st('数量限定カラー'), ['LIMITED']);
  assert.deepEqual(st('期間限定 特別価格'), ['SPECIAL']); // 期間限定だけなら「限定」にはしない
  assert.ok(st('BEAMS×Champion 別注').includes('COLLAB'));
  assert.ok(st('新色 マグカップ').includes('NEW_COLOR'));
  assert.equal(detectBrand('ニューバランス New Balance 2002R'), 'New Balance');
  assert.equal(detectBrand('謎のブランド 充電器', ['謎のブランド']), '謎のブランド');
});

test('同じ商品が別のショップにあれば1つにまとめ、販売先を並べて一番安い価格にする', () => {
  const base = { productId: 'rakuten:x', status: ['NEW'], releaseDate: null, rakutenUrl: 'a', sourceUrl: 'a' };
  const merged = mergeItems([
    { ...base, price: 5000, shops: [{ name: 'A店', url: 'a', price: 5000 }] },
    { ...base, price: 4500, status: ['PRE_ORDER'], releaseDate: '2026-11-20', rakutenUrl: 'b', sourceUrl: 'b', shops: [{ name: 'B店', url: 'b', price: 4500 }] }
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual([merged[0].price, merged[0].rakutenUrl, merged[0].shops.length], [4500, 'b', 2]);
  assert.deepEqual(merged[0].status, ['NEW', 'PRE_ORDER']);
  assert.equal(merged[0].releaseDate, '2026-11-20');
});

test('巡回の検索語：ジャンルごとに探し方を2つ（回すたびに変わる）＋フォロー中のブランド', () => {
  const q0 = planQueries({ genres: ['sneaker', 'charger'], brands: ['Anker'], round: 0 }).map((q) => q.keyword);
  const q1 = planQueries({ genres: ['sneaker', 'charger'], brands: ['Anker'], round: 1 }).map((q) => q.keyword);
  assert.equal(q0.length, 5);
  assert.notDeepEqual(q0, q1);
  assert.ok(q0.every((k) => QUERY_TYPES.some((t) => k.endsWith(t)) || k.startsWith('Anker')));
  assert.ok(q0.some((k) => k.startsWith('Anker ')));
  // 対象ジャンルはファッションだけでなく、家電・ガジェット・生活用品・その他まで
  assert.deepEqual(RADAR_GROUPS.map((g) => g.id), ['fashion', 'appliance', 'gadget', 'living', 'other']);
  assert.ok(RADAR_GENRES.length >= 35);
  assert.ok(RADAR_GENRES.every((g) => RADAR_GROUPS.some((x) => x.id === g.group)));
});

test('レーダーAPI：新作・予約の商品だけを状態・日付つきで返す（ふるさと納税などは除く、状態のない商品も除く）', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword');
      return json(200, {
        items: [
          { itemCode: `a:${kw}`, itemName: `New Balance 2002R ${kw} 【予約】2026年11月20日発売`, itemPrice: 19800, itemUrl: 'https://item.rakuten.co.jp/a/1/', mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/1.jpg?_ex=128x128'], shopName: 'A店', itemCaption: '予約受付期間：10/1〜11/5' },
          { itemCode: `b:${kw}`, itemName: `New Balance 2002R ${kw} 【予約】2026年11月20日発売`, itemPrice: 18800, itemUrl: 'https://item.rakuten.co.jp/b/1/', mediumImageUrls: [], shopName: 'B店', itemCaption: '' },
          { itemCode: `c:${kw}`, itemName: 'ふるさと納税 新作 スニーカー', itemPrice: 10000, itemUrl: 'https://item.rakuten.co.jp/c/1/', mediumImageUrls: [], shopName: 'C', itemCaption: '' },
          { itemCode: `d:${kw}`, itemName: 'ふつうのスニーカー 26cm', itemPrice: 3000, itemUrl: 'https://item.rakuten.co.jp/d/1/', mediumImageUrls: [], shopName: 'D', itemCaption: '' }
        ],
        pageCount: 1
      });
    },
    openai: () => json(500, {})
  });
  const { status, data } = await call({ genres: ['sneaker', 'nope'], brands: ['New Balance'] });
  assert.equal(status, 200);
  assert.ok(mock.calls.rakuten.every((c) => c.url.searchParams.get('sort') === '-updateTimestamp'));
  assert.ok(mock.calls.rakuten.some((c) => c.url.searchParams.get('keyword').startsWith('New Balance ')));
  const it = data.items.find((x) => x.name.includes('スニーカー 予約') || x.status.includes('PRE_ORDER'));
  assert.ok(it);
  assert.equal(it.brand, 'New Balance');
  assert.equal(it.followedBrand, true);
  assert.deepEqual([it.releaseDate, it.preorderStart, it.preorderEnd], ['2026-11-20', '2026-10-01', '2026-11-05']);
  assert.equal(it.category, 'sneaker');
  assert.equal(it.source, 'rakuten');
  assert.equal(it.shops.length, 2); // 同じ商品のA店・B店をまとめる
  assert.equal(it.price, 18800);
  assert.ok(data.items.every((x) => !x.name.includes('ふるさと納税') && !x.name.includes('ふつうのスニーカー')));
  for (const k of ['productId', 'name', 'brand', 'category', 'price', 'imageUrl', 'releaseDate', 'preorderStart', 'preorderEnd', 'status', 'source', 'sourceUrl', 'rakutenUrl']) assert.ok(k in it, k);

  assert.equal((await call({ genres: [] })).status, 400);
  const meta = (await call(undefined, 'GET')).data;
  assert.ok(meta.genres.find((g) => g.id === 'sneaker').brands.includes('Onitsuka Tiger'));
  assert.equal(meta.statuses.length, 8);
});

test('アクセサリーにカー用品が混ざらない（ジャンルごとの除外語）', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword');
      return json(200, {
        items: [
          { itemCode: `n:${kw}`, itemName: 'agete ネックレス 新作 2026年11月20日発売', itemPrice: 22000, itemUrl: 'https://item.rakuten.co.jp/n/1/', mediumImageUrls: [], shopName: 'N', itemCaption: '' },
          { itemCode: `c:${kw}`, itemName: 'カー用品 車用 アクセサリー 新作 ドリンクホルダー', itemPrice: 1980, itemUrl: 'https://item.rakuten.co.jp/c/1/', mediumImageUrls: [], shopName: 'C', itemCaption: '' }
        ],
        pageCount: 1
      });
    },
    openai: () => json(500, {})
  });
  const { status, data } = await call({ genres: ['accessory'] });
  assert.equal(status, 200);
  assert.ok(data.items.some((x) => x.name.includes('ネックレス')));
  assert.ok(data.items.every((x) => !x.name.includes('カー用品')), data.items.map((x) => x.name).join('/'));
  const meta = (await call(undefined, 'GET')).data;
  assert.ok(meta.genres.find((g) => g.id === 'accessory').ng.includes('カー用品'));
});

test('検索ジョブ用：検索語だけを返す（楽天は呼ばない）・一部の検索語だけ探す・全部失敗したときだけエラー', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword');
      if (kw.includes('壊れる')) return json(500, { error: 'x' });
      return json(200, { items: [{ itemCode: `a:${kw}`, itemName: `New Balance 2002R ${kw} 【予約】2026年11月20日発売`, itemPrice: 19800, itemUrl: 'https://item.rakuten.co.jp/a/1/', mediumImageUrls: [], shopName: 'A店', itemCaption: '' }], pageCount: 1 });
    },
    openai: () => json(500, {})
  });
  const plan = await call({ mode: 'plan', genres: ['sneaker', 'bag'], brands: ['New Balance'], round: 1 });
  assert.equal(plan.status, 200);
  assert.ok(plan.data.queries.length >= 4);
  assert.equal(mock.calls.rakuten.length, 0);
  assert.ok(plan.data.queries.every((q) => q.genre && q.keyword));
  const brandPlan = await call({ mode: 'plan', brand: 'BEAMS' });
  assert.ok(brandPlan.data.queries.every((q) => q.keyword.startsWith('BEAMS ')));

  const part = await call({ mode: 'part', queries: plan.data.queries.slice(0, 2), brands: ['New Balance'] });
  assert.equal(part.status, 200);
  assert.equal(mock.calls.rakuten.length, 2);
  assert.ok(part.data.items.length >= 1);
  const half = await call({ mode: 'part', queries: [{ genre: 'sneaker', keyword: 'スニーカー 予約' }, { genre: 'sneaker', keyword: '壊れる 予約' }] });
  assert.equal(half.status, 200); // 一部でも取れたら、その分を返す
  assert.ok(half.data.scanned.some((s) => s.error));
  const bad = await call({ mode: 'part', queries: [{ genre: 'sneaker', keyword: '壊れる' }] });
  assert.equal(bad.status, 502);
  assert.equal((await call({ mode: 'part', queries: [] })).status, 400);
});
