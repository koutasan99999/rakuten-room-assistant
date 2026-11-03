import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pitchApi from '../server/pitch.js';
import { priceTiers, sameish } from '../lib/expand.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());
async function call(body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await pitchApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}
const item = (name, price, code, extra = {}) => ({ itemCode: code, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${code.replace(':', '')}/`, mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/x/${code}.jpg?_ex=128x128`], shopName: 'ショップ', itemCaption: '綿100%', reviewCount: extra.reviews || 5, reviewAverage: 4.4 });
const BASE = { code: 'beams:1', name: 'BEAMS ポケット Tシャツ ホワイト メンズ', price: 6000, url: 'https://item.rakuten.co.jp/beams/1/', image: 'https://img/1.jpg' };
const pickAll = (relation = '同じ無地で約半額') => (body) => {
  const ids = [...body.messages[1].content.matchAll(/^ {2}(\d+-\d+): /gm)].map((m) => m[1]);
  return aiReply({ picks: ids.map((id) => ({ id, relation, similar: '無地', differ: '生地が薄い', feature: '綿100%', look: 0 })) });
};

test('広げる（似たデザインでもっと安い）：価格の上限を付けて楽天で探し、起点より高い・同じ商品・ほぼ同じ商品・関係を書けない商品を外す', async () => {
  const asked = [];
  mock = installFetchMock({
    rakuten: (url) => {
      asked.push({ kw: url.searchParams.get('keyword'), max: url.searchParams.get('maxPrice') });
      return json(200, { items: [item('BEAMS ポケット Tシャツ ホワイト メンズ', 6000, 'beams:1'), item('無地 厚手 Tシャツ ホワイト メンズ', 2900, 'a:1'), item('無地 厚手 Tシャツ ブラック メンズ', 2900, 'a:2'),
        item('ヘビーウェイト Tシャツ 白', 1900, 'b:1'), item('オーガニック Tシャツ', 4200, 'c:1'), item('高い Tシャツ', 4400, 'd:1'), item('写真なし Tシャツ', 1000, 'e:1')].map((x, i) => (i === 6 ? { ...x, mediumImageUrls: [] } : x)) });
    },
    openai: (body) => {
      if (body.messages[0].content.includes('探すための検索語を決めます')) return aiReply({ queries: [{ keyword: '無地 厚手 Tシャツ', label: 'Tシャツ' }, { keyword: '無地 厚手 Tシャツ', label: '重複' }] });
      const ids = [...body.messages[1].content.matchAll(/^ {2}(\d+-\d+): /gm)].map((m) => m[1]);
      return aiReply({ picks: ids.map((id) => ({ id, relation: id === '0-4' ? '' : '同じ無地で約半額', similar: '無地', differ: '生地', feature: '綿100%' })) });
    }
  });
  const r = await call({ action: 'expand', base: BASE, mode: 'cheaper', path: [{ name: BASE.name, code: BASE.code }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(asked, [{ kw: '無地 厚手 Tシャツ', max: '4500' }]); // 同じ検索語は1回、上限は起点の75%
  const names = r.data.items.map((x) => x.name);
  assert.ok(!names.includes(BASE.name), '起点の商品は出さない');
  assert.ok(!names.includes('無地 厚手 Tシャツ ブラック メンズ'), '色違いだけの商品は出さない');
  assert.ok(!names.includes('写真なし Tシャツ'));
  assert.ok(!names.includes('高い Tシャツ'), '関係を書けない商品は出さない');
  assert.ok(r.data.items.every((x) => x.price < 6000 && x.url && x.image && x.relation && x.similar && x.differ && x.tier));
  assert.equal(r.data.modeLabel, '似たデザインでもっと安い');
  assert.ok(r.data.notice.includes('件でした'), '5件に届かないときは、そう伝える');
});

test('広げる（同じブランド）：ブランド名を検索語に入れ、1語目はレビューの多い順。別ブランドは外す。ブランドが分からなければ理由を返す（やり直さない）', async () => {
  const asked = [];
  mock = installFetchMock({
    rakuten: (url) => { asked.push([url.searchParams.get('keyword'), url.searchParams.get('sort')]); return json(200, { items: [item('BEAMS 別注 Tシャツ', 5000, 'x:1', { reviews: 800 }), item('UNITED ARROWS Tシャツ', 5000, 'x:2'), item('ビームス ロングスリーブ Tシャツ', 7000, 'x:3')] }); },
    openai: (body) => (body.messages[0].content.includes('探すための検索語を決めます') ? aiReply({ queries: [{ keyword: 'Tシャツ 別注', label: 'Tシャツ' }, { keyword: 'BEAMS キャップ', label: 'キャップ' }] }) : pickAll('同じBEAMSの別の形')(body))
  });
  const r = await call({ action: 'expand', base: BASE, mode: 'brand' });
  assert.equal(r.status, 200);
  assert.deepEqual(asked[0], ['BEAMS Tシャツ 別注', '-reviewCount']);
  assert.equal(asked[1][1], null);
  assert.ok(r.data.items.every((x) => /BEAMS|ビームス/.test(x.name)));
  assert.ok(r.data.items.some((x) => x.byReviews && x.reviewCount === 800));
  const noBrand = await call({ action: 'expand', base: { name: '無地 Tシャツ', price: 2000 }, mode: 'brand' });
  assert.equal(noBrand.status, 422);
  assert.ok(noBrand.data.error.includes('ブランド'));
});

test('広げる（同じ価格帯の他ブランド・コーデ）：価格の幅を付け、同じブランドを外す。コーデは組み合わせの案ごとに分ける', async () => {
  const asked = [];
  mock = installFetchMock({
    rakuten: (url) => { asked.push([url.searchParams.get('keyword'), url.searchParams.get('minPrice'), url.searchParams.get('maxPrice')]); const k = url.searchParams.get('keyword'); return json(200, { items: [item(`BEAMS ${k}`, 6000, `b:${k}`), item(`URBAN RESEARCH ${k} A`, 5500, `u:${k}`), item(`CHUMS ${k} B`, 6500, `c:${k}`)] }); },
    openai: (body) => {
      const sys = body.messages[0].content;
      if (sys.includes('探すための検索語を決めます')) {
        return body.messages[1].content.includes('same_price')
          ? aiReply({ queries: [{ keyword: 'BEAMS ポケット Tシャツ', label: 'Tシャツ' }] })
          : aiReply({ queries: [{ keyword: 'カーゴパンツ', label: 'パンツ' }, { keyword: '白 スニーカー', label: 'スニーカー' }], looks: [{ name: '休日', concept: '白でまとめる', labels: ['パンツ'] }] });
      }
      return pickAll('このTシャツに合わせる')(body);
    }
  });
  const r = await call({ action: 'expand', base: BASE, mode: 'same_price' });
  assert.equal(r.status, 200);
  assert.deepEqual(asked[0], ['ポケット Tシャツ', '4200', '8100']); // 起点のブランド名は外して、70%〜135%
  assert.ok(r.data.items.every((x) => !x.name.startsWith('BEAMS')));
  asked.length = 0;
  const c = await call({ action: 'expand', base: BASE, mode: 'coord' });
  assert.equal(c.status, 200);
  assert.equal(asked.length, 2);
  assert.equal(c.data.looks[0].name, '休日');
  assert.ok(c.data.items.some((x) => x.group === 'パンツ') && c.data.items.some((x) => x.group === 'スニーカー'));
});

test('価格帯：同じ分類の中で真ん中の価格と比べる。ほぼ同じ商品の判定', () => {
  const t = priceTiers([{ group: 'a', price: 1000 }, { group: 'a', price: 3000 }, { group: 'a', price: 9000 }, { group: 'b', price: 500 }], 1000);
  assert.deepEqual(t.map((x) => x.tier), ['low', 'mid', 'high', 'low']);
  assert.ok(sameish('【送料無料】BEAMS ヘビーウェイト Tシャツ 白', 'BEAMS ヘビーウェイト Tシャツ 黒'));
  assert.ok(!sameish('BEAMS 定番 Tシャツ', 'CHUMS 定番 Tシャツ'));
});
