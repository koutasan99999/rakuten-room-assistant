import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import trendsApi from '../server/trends.js';
import furusatoApi from '../server/furusato.js';
import { parseTrendsRss } from '../lib/trends.js';
import { guessBrand, aggregateBrands } from '../lib/brand-discovery.js';
import { parseQuantity, parseDelivery, parseTeiki, perTenThousand, toFurusatoItem } from '../lib/furusato.js';
import { installFetchMock, json } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());
async function call(handler, body, method = 'POST') {
  const req = { method, headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}
const rankItem = (rank, name, price, url = `https://item.rakuten.co.jp/shop/${rank}/`) => ({ rank, itemName: name, itemPrice: price, itemUrl: url, itemCode: `shop:${rank}`, mediumImageUrls: [], shopName: 'ショップ', reviewAverage: 4.2, reviewCount: 10 });

test('売れ筋：楽天ランキングAPIを使い、ふるさと納税は混ぜない。スニーカーは靴のランキングから商品名で絞る', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      assert.ok(url.pathname.includes('/IchibaItem/Ranking/20220601'));
      return json(200, { title: '【楽天市場】ランキング市場 靴', lastBuildDate: 'Thu, 29 Oct 2026 10:00:00 +0900', Items: [
        rankItem(1, '【ふるさと納税】牛肉 1kg', 10000, 'https://item.rakuten.co.jp/f012345-town/a/'),
        rankItem(2, 'New Balance 1906R スニーカー メンズ', 19800),
        rankItem(3, 'レインブーツ 長靴', 3980),
        rankItem(4, '【KANGOL】スニーカー キャンバス', 6980)
      ] });
    }
  });
  const r = await call(trendsApi, { kind: 'ranking', genre: 'sneaker' });
  assert.equal(r.status, 200);
  assert.equal(mock.calls.rakuten[0].url.searchParams.get('genreId'), '558885');
  assert.deepEqual(r.data.items.map((x) => x.rank), [2, 4]);
  assert.equal(r.data.items[0].source, '楽天市場ランキング');
  assert.ok(r.data.note.includes('スニーカー'));
  assert.ok(r.data.brands.some((b) => b.name === 'New Balance' && !b.guessed));
  assert.ok(r.data.brands.some((b) => b.name === 'KANGOL' && b.guessed));
});

test('売れ筋：リアルタイムが使えなければ通常のランキングに戻し、そのことを知らせる', async () => {
  mock = installFetchMock({
    rakuten: (url) => url.searchParams.get('period') === 'realtime' ? json(400, { error: 'wrong_parameter' }) : json(200, { Items: [rankItem(1, 'Anker 充電器', 3990)] })
  });
  const r = await call(trendsApi, { kind: 'ranking', genre: 'appliance', period: 'realtime' });
  assert.equal(r.status, 200);
  assert.equal(r.data.period, 'daily');
  assert.ok(r.data.notice.includes('リアルタイム'));
});

test('検索急上昇：GoogleトレンドのRSSを読み、売れ筋とは別に返す', async () => {
  const xml = `<rss><channel><item><title>新型スマホ</title><ht:approx_traffic>20万+</ht:approx_traffic><pubDate>Thu, 29 Oct 2026 09:00:00 +0900</pubDate>
    <ht:news_item><ht:news_item_title>新型スマホ発表 &amp; 発売日</ht:news_item_title><ht:news_item_url>https://news.example.jp/a</ht:news_item_url><ht:news_item_source>Example</ht:news_item_source></ht:news_item></item>
    <item><title><![CDATA[台風]]></title><ht:approx_traffic>5万+</ht:approx_traffic></item></channel></rss>`;
  assert.deepEqual(parseTrendsRss(xml).map((x) => x.term), ['新型スマホ', '台風']);
  assert.equal(parseTrendsRss(xml)[0].news[0].title, '新型スマホ発表 & 発売日');
  mock = installFetchMock({ trends: () => new Response(xml, { status: 200 }) });
  const r = await call(trendsApi, { kind: 'search' });
  assert.equal(r.status, 200);
  assert.equal(r.data.items[0].traffic, '20万+');
  assert.ok(r.data.source.includes('Googleトレンド'));
  mock.restore();
  mock = installFetchMock({ trends: () => new Response('', { status: 429 }) });
  assert.equal((await call(trendsApi, { kind: 'search' })).status, 502);
});

test('ブランドの推定：辞書にあれば確定、なければ【】や先頭の英字から（宣伝の言葉は除く）', () => {
  assert.deepEqual(guessBrand('ニューバランス 2002R'), { name: 'New Balance', guessed: false, known: true });
  assert.equal(guessBrand('【送料無料】【MOUNTAIN RESEARCH】ジャケット').name, 'MOUNTAIN RESEARCH');
  assert.equal(guessBrand('Hender Scheme レザー ポーチ').name, 'Hender Scheme');
  assert.equal(guessBrand('【楽天1位】収納ボックス'), null);
  const b = aggregateBrands([{ name: 'KANGOL バッグ', price: 3000, rank: 5 }, { name: 'KANGOL キャップ', price: 4500, rank: 2 }], { genreLabel: 'バッグ' });
  assert.equal(b[0].count, 2);
  assert.equal(b[0].bestRank, 2);
  assert.deepEqual([b[0].minPrice, b[0].maxPrice], [3000, 4500]);
});

test('ふるさと納税：内容量・1万円あたり・配送時期・定期便は書いてあるものだけ読む（推測しない）', () => {
  assert.deepEqual(parseQuantity('【ふるさと納税】牛肉 切り落とし 500g×4パック'), { value: 2000, unit: 'g', text: '500g×4パック' });
  assert.deepEqual(parseQuantity('お米 10kg'), { value: 10000, unit: 'g', text: '10kg' });
  assert.equal(parseQuantity('人気の返礼品 おまかせセット'), null);
  assert.deepEqual(perTenThousand({ value: 2000, unit: 'g' }, 20000), { value: 1000, unit: 'g' });
  assert.equal(perTenThousand(null, 10000), null);
  assert.equal(parseDelivery('2026年12月上旬より順次発送いたします。'), '2026年12月上旬より順次発送');
  assert.equal(parseDelivery('寄附確認後、2週間程度で発送します'), '寄附確認後、2週間程度で発送');
  assert.equal(parseDelivery('冷凍でお届けします'), '');
  assert.deepEqual(parseTeiki('【定期便6回】お米 5kg'), { times: 6 });
  assert.equal(parseTeiki('お米 5kg'), null);
  const it = toFurusatoItem({ code: 'f1', name: '【ふるさと納税】いくら 250g', price: 15000, url: 'https://item.rakuten.co.jp/f012345-a/b/', shop: '北海道別海町', caption: '' });
  assert.equal(it.municipality, '北海道別海町');
  assert.equal(it.delivery, '');
  assert.equal(it.monetization, 'unknown');
});

test('ふるさと納税API：ふるさと納税を除外せずに探し、条件で絞る', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      assert.ok(url.searchParams.get('keyword').startsWith('ふるさと納税 米'));
      assert.ok(!(url.searchParams.get('NGKeyword') || '').includes('ふるさと納税'));
      return json(200, { items: [
        { itemCode: 'f:1', itemName: '【ふるさと納税】コシヒカリ 10kg', itemPrice: 15000, itemUrl: 'https://item.rakuten.co.jp/f150000-a/1/', mediumImageUrls: [], shopName: '新潟県魚沼市', itemCaption: '2026年11月中旬より順次発送', reviewAverage: 4.6, reviewCount: 120 },
        { itemCode: 'f:2', itemName: '【ふるさと納税】【定期便3回】ななつぼし 5kg', itemPrice: 30000, itemUrl: 'https://item.rakuten.co.jp/f010000-b/2/', mediumImageUrls: [], shopName: '北海道〇〇町', itemCaption: '', reviewAverage: 3.9, reviewCount: 8 },
        { itemCode: 'x:3', itemName: '普通のお米 5kg', itemPrice: 3000, itemUrl: 'https://item.rakuten.co.jp/shop/3/', mediumImageUrls: [], shopName: '米屋', itemCaption: '', reviewAverage: 4, reviewCount: 1 }
      ], pageCount: 1 });
    }
  });
  const r = await call(furusatoApi, { category: 'rice', minReview: 4, teiki: 'exclude', sort: 'review' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.items.map((x) => x.code), ['f:1']);
  assert.equal(r.data.items[0].per10k.value, 6666.7);
  assert.equal(mock.calls.rakuten[0].url.searchParams.get('sort'), '-reviewCount');
});

test('ふるさと納税の投稿：ポイント還元・節税の文を外し、ROOM・お得のタグを付けない', async () => {
  const { stripFurusatoClaims, assembleCaption } = await import('../lib/instagram.js');
  const { buildFurusatoHashtags } = await import('../lib/hashtags.js');
  assert.equal(stripFurusatoClaims('新米の季節です。ポイント還元でお得に寄付できます。量もしっかり。'), '新米の季節です。量もしっかり。');
  const cap = assembleCaption({ body: '本文です。実質2000円で受け取れます。', furusato: true, pr: true, hashtags: ['#ふるさと納税'] });
  assert.ok(!/実質|楽天ROOMにまとめ|楽天アフィリエイトを利用/.test(cap));
  assert.ok(cap.includes('控除の上限額') && cap.includes('#PR'));
  const tags = buildFurusatoHashtags({ topic: 'お米の返礼品', aiTags: ['#楽天ROOM', '#ポイント活用', '#新米', '#お米好き'] });
  assert.ok(tags.includes('#ふるさと納税') && tags.includes('#お米好き'));
  assert.ok(!tags.some((t) => /ROOM|ポイント/.test(t)));
});
