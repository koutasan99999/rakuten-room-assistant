import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import searchApi from '../server/search.js';
import planTitlesApi from '../server/plan-titles.js';
import exploreApi from '../server/explore.js';
import { analyzeProduct, isSameProduct, dedupeProducts, findModels } from '../lib/product-analysis.js';
import { planAxis, relatedSearch, freeSteps } from '../lib/related.js';
import { diversifyAngles } from '../lib/explore.js';
import { parseProductPage, checkPublicUrl, isPrivateAddress } from '../lib/official.js';
import { readPlanForTitles, cleanTitle } from '../lib/plan-titles.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(handler, body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const HERO = { name: '【送料無料】New Balance × BEAMS 別注 ML2002R グレー スニーカー メンズ', code: 'nb:hero', url: 'https://item.rakuten.co.jp/nb/hero/', price: 22000 };

let n = 0;
function item(name, price = 15000, shop = 'ショップA') {
  n++;
  return { itemCode: `s:${n}`, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${n}/`, mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/s/${n}.jpg`], shopName: shop, itemCaption: '' };
}

// 楽天の偽物：「コラボ」で探すと、起点と同じコラボ・別ショップの起点・他ブランドのコラボが混ざって返る
function rakuten(url) {
  const kw = url.searchParams.get('keyword');
  if (/コラボ|別注/.test(kw)) {
    return json(200, { pageCount: 2, items: [
      item('New Balance × BEAMS 別注 ML2002R グレー', 22000, '別ショップ'), // 起点そのもの（別ショップ）
      item('【楽天1位】ニューバランス ビームス 別注 2002R ブラック スニーカー', 22000), // 同じコラボの色違い → 同じシリーズなので出さない
      item('adidas Originals × CLOT スーパースター ホワイト スニーカー', 18000),
      item('adidas Originals × CLOT スーパースター ホワイト スニーカー 送料無料', 18000, '別ショップ'), // 別ショップの同じ商品
      item('ASICS × KITH GEL-LYTE III ネイビー スニーカー コラボ', 24000),
      item('VANS × NEIGHBORHOOD オールドスクール ブラック スニーカー', 13000),
      item('PUMA × atmos スウェード 別注 スニーカー レッド', 14000),
      item('CONVERSE ALL STAR 別注 スニーカー アイボリー', 12000),
      item('NIKE × sacai コラボ スニーカー ホワイト', 30000),
      item('Onitsuka Tiger × KILL BILL コラボ スニーカー イエロー', 19000),
      item('スニーカー メンズ 定番 ホワイト', 5000) // コラボではない
    ] });
  }
  return json(200, { pageCount: 1, items: [item(`${kw} 定番モデル A100 ホワイト`), item(`${kw} 人気 B200 ブラック`), item(`New Balance ${kw} CM996 グレー`)] });
}

test('コラボ商品を分析して、ブランド・コラボ相手・種類・型番・色に分ける', () => {
  const a = analyzeProduct(HERO);
  assert.equal(a.brand, 'New Balance');
  assert.equal(a.partner, 'BEAMS');
  assert.equal(a.collab, true);
  assert.equal(a.category, 'スニーカー');
  assert.deepEqual(a.models, ['ML2002R']);
  assert.equal(a.color, 'グレー');
  // カタカナ表記・区切りなしの別注でも相手が分かる
  const b = analyzeProduct({ name: 'ニューバランス ビームス 別注 2002R スニーカー' });
  assert.equal(b.brand, 'New Balance');
  assert.equal(b.partner, 'BEAMS');
  // 種類が書いていない英字の商品名は、ブランドのよくあるジャンルで補う
  assert.equal(analyzeProduct({ name: 'BEAMS別注 New Balance M990v6 ネイビー' }).category, 'スニーカー');
  // 容量・サイズは型番にしない
  assert.deepEqual(findModels('Anker 621 モバイルバッテリー 5000mAh USB-C 20W'), []);
});

test('検索軸ごとに検索語を変える。「他ブランドのコラボ」の検索語に起点のコラボ名・型番を入れない', () => {
  const a = analyzeProduct(HERO);
  const all = ['same_brand', 'other_brand', 'other_collab', 'similar', 'same_price', 'new_arrival'].map((axis) => [axis, planAxis(axis, a)]);
  // 検索語・価格帯・並び順の組み合わせが軸ごとに違う
  const firstWords = new Set(all.map(([, p]) => [p.steps[0].keyword, p.steps[0].minPrice, p.steps[0].sort].join('|')));
  assert.equal(firstWords.size, all.length, '軸ごとに違う検索');
  for (const [axis, p] of all) {
    for (const s of p.steps) {
      assert.ok(!/ML2002R/i.test(s.keyword), `${axis}: 型番を入れない ${s.keyword}`);
      assert.ok(!(/New Balance/i.test(s.keyword) && /BEAMS/i.test(s.keyword)), `${axis}: コラボ名をそのまま入れない ${s.keyword}`);
    }
  }
  const collab = planAxis('other_collab', a);
  for (const s of collab.steps) assert.ok(!/New Balance|BEAMS|ニューバランス|ビームス/i.test(s.keyword), s.keyword);
  assert.ok(collab.ng.includes('BEAMS') && collab.ng.includes('ニューバランス'));
  assert.ok(planAxis('same_brand', a).steps[0].keyword.startsWith('New Balance'));
  assert.equal(planAxis('same_price', a).steps[0].minPrice, 15400);
  // 自由入力は、最後の言葉を外しながらゆるめる
  assert.deepEqual(freeSteps('白 スニーカー 厚底').map((s) => s.keyword), ['白 スニーカー 厚底', '白 スニーカー', '白']);
});

test('コラボ商品を起点に「他のコラボを探す」：起点・同じコラボ・別ショップの重複・コラボでない商品を除いて、他ブランドのコラボだけ返す', async () => {
  mock = installFetchMock({ rakuten, openai: () => aiReply({}) });
  const r = await relatedSearch({ axis: 'other_collab', reference: HERO, env: ENV, referer: 'https://x.app/', until: Date.now() + 60000 });
  const names = r.items.map((x) => x.name);
  assert.equal(r.axis, 'other_collab');
  assert.ok(names.length >= 6, names.join('\n'));
  assert.ok(names.every((x) => !/New Balance|ニューバランス|BEAMS|ビームス/i.test(x)), names.join('\n'));
  assert.equal(names.filter((x) => /CLOT/.test(x)).length, 1, '別ショップの同じ商品は1つ');
  assert.ok(!names.some((x) => /定番 ホワイト/.test(x)), 'コラボでない商品は出さない');
  assert.ok(names.some((x) => /KITH/.test(x)) && names.some((x) => /sacai/.test(x)));
  // 楽天に渡した検索語にも、起点のコラボ名・型番は入っていない
  const kws = mock.calls.rakuten.map((c) => c.url.searchParams.get('keyword'));
  assert.ok(kws.every((k) => !/New Balance|BEAMS|ML2002R/i.test(k)), kws.join(' / '));
  assert.match(mock.calls.rakuten[0].url.searchParams.get('NGKeyword'), /BEAMS/);
  assert.equal(r.items[0].axis, 'other_collab');
  assert.ok(r.items.every((x) => x.brand !== 'New Balance'));
});

test('「さらに10件」：表示済み・企画に追加済みの商品を除いて、続きから探す', async () => {
  mock = installFetchMock({ rakuten, openai: () => aiReply({}) });
  const first = await relatedSearch({ axis: 'other_collab', reference: HERO, want: 3, env: ENV, referer: 'https://x.app/', until: Date.now() + 60000 });
  assert.equal(first.items.length, 3);
  assert.ok(first.cursor, '続きがある');
  const inPlan = [{ name: 'VANS × NEIGHBORHOOD オールドスクール ブラック スニーカー' }];
  const second = await relatedSearch({ axis: first.cursor.axis, cursor: first.cursor, reference: HERO, shown: first.items, exclude: inPlan, want: 10, env: ENV, referer: 'https://x.app/', until: Date.now() + 60000 });
  const shownNames = new Set(first.items.map((x) => x.name));
  assert.ok(second.items.length >= 1);
  assert.ok(second.items.every((x) => !shownNames.has(x.name) && !/NEIGHBORHOOD/.test(x.name)), second.items.map((x) => x.name).join('\n'));
});

test('結果が少なければ検索語をゆるめ、同じ商品ばかりなら別の検索軸に切り替える', async () => {
  // 1. 最初の検索語は0件 → ゆるめた検索語で見つかる
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword');
      if (kw === '白 スニーカー 厚底') return json(200, { items: [], pageCount: 0 });
      return json(200, { pageCount: 1, items: [item('VANS 厚底 スニーカー ホワイト'), item('PUMA 厚底 スニーカー ブラック'), item('NIKE ダンク ロー ホワイト'), item('ASICS ゲルカヤノ ホワイト')] });
    },
    openai: () => aiReply({})
  });
  const relaxed = await relatedSearch({ axis: 'search', keyword: '白 スニーカー 厚底', env: ENV, referer: 'https://x.app/', until: Date.now() + 60000 });
  assert.equal(relaxed.items.length, 4);
  assert.deepEqual(mock.calls.rakuten.map((c) => c.url.searchParams.get('keyword')).slice(0, 2), ['白 スニーカー 厚底', '白 スニーカー']);
  assert.match(relaxed.notice, /ゆるめました/);
  mock.restore();

  // 2. 「他のコラボ」で起点と同じコラボしか出ない → 「他ブランドから探す」に切り替わる
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword');
      if (/コラボ|別注/.test(kw)) return json(200, { pageCount: 1, items: [item('New Balance × BEAMS 別注 ML2002R グレー'), item('ニューバランス × ビームス 2002R ブラック')] });
      return json(200, { pageCount: 1, items: [item('adidas サンバ スニーカー ホワイト'), item('ASICS GEL-1130 スニーカー シルバー'), item('VANS オーセンティック スニーカー ネイビー'), item('New Balance 574 スニーカー')] });
    },
    openai: () => aiReply({})
  });
  const switched = await relatedSearch({ axis: 'other_collab', reference: HERO, env: ENV, referer: 'https://x.app/', until: Date.now() + 60000 });
  assert.equal(switched.switched, true);
  assert.equal(switched.axis, 'other_brand');
  assert.match(switched.notice, /他ブランドから探す/);
  assert.equal(switched.items.length, 3);
  assert.ok(switched.items.every((x) => !/New Balance/.test(x.name)));
});

test('同じ商品の見分け方：別ショップ・表記ゆれは同じ、色違い・型番違い・サイズ違いは別', () => {
  assert.equal(isSameProduct({ name: '【楽天1位】New Balance ML2002R グレー 送料無料' }, { name: 'ニューバランス New Balance ML2002R グレー メンズ' }), true);
  assert.equal(isSameProduct({ name: 'New Balance ML2002R グレー' }, { name: 'New Balance ML2002R ブラック' }), false);
  assert.equal(isSameProduct({ name: 'New Balance ML2002R グレー' }, { name: 'New Balance M1906R グレー' }), false);
  assert.equal(isSameProduct({ name: 'KINTO トラベルタンブラー 350ml ホワイト' }, { name: 'KINTO トラベルタンブラー 500ml ホワイト' }), false);
  assert.equal(isSameProduct({ name: 'KINTO トラベルタンブラー 350ml ホワイト【送料無料】' }, { name: '【正規品】KINTO トラベルタンブラー 350ml ホワイト' }), true);
  assert.equal(isSameProduct({ code: 'a:1', name: 'x' }, { code: 'a:1', name: 'y' }), true);
  const { items, dup } = dedupeProducts([{ name: 'A ブラック 1' }, { name: 'A ブラック 1 送料無料' }, { name: 'A ホワイト 1' }], [{ name: 'A ホワイト 1' }]);
  assert.equal(items.length, 1);
  assert.equal(dup, 2);
});

test('検索API：自分で検索（2文字未満は断る）・関連の検索軸・起点がないときの案内', async () => {
  mock = installFetchMock({ rakuten, openai: () => aiReply({}) });
  assert.equal((await call(searchApi, { axis: 'search', keyword: 'a' })).status, 400);
  const r = await call(searchApi, { axis: 'search', keyword: 'スニーカー 白', exclude: [{ name: 'スニーカー 白 定番モデル A100 ホワイト' }] });
  assert.equal(r.status, 200);
  assert.ok(r.data.items.length >= 1);
  assert.ok(r.data.items.every((x) => x.name && x.price && x.url && x.image && 'shop' in x));
  assert.ok(!r.data.items.some((x) => /A100/.test(x.name)), '企画に入っている商品は出さない');
  const noRef = await call(searchApi, { axis: 'other_brand' });
  assert.equal(noRef.status, 502);
  assert.match(noRef.data.error, /基準にする商品/);
  const collab = await call(searchApi, { axis: 'other_collab', reference: HERO });
  assert.equal(collab.status, 200);
  assert.equal(collab.data.analysis.partner, 'BEAMS');
  assert.ok(collab.data.items.every((x) => !/BEAMS|ビームス/.test(x.name)));
});

test('企画づくりの探索：AIがすべての角度に起点のコラボ名を入れても、1つだけ残して散らす', async () => {
  const a = analyzeProduct(HERO);
  const angles = ['New Balance BEAMS 別注', 'New Balance BEAMS スニーカー', 'BEAMS New Balance 2002R', 'ML2002R グレー', 'スニーカー 白'].map((keyword, i) => ({ label: `角度${i}`, keyword }));
  const out = diversifyAngles(angles, a);
  assert.equal(out.filter((x) => /New Balance/.test(x.keyword) && /BEAMS/.test(x.keyword)).length, 1);
  assert.ok(out.every((x) => !/ML2002R/.test(x.keyword)));

  mock = installFetchMock({
    rakuten: (url) => json(200, { pageCount: 1, items: Array.from({ length: 8 }, (_, i) => item(`${url.searchParams.get('keyword')} 商品${i} タイプ${i}`)) }),
    openai: (body) => body.messages[0].content.includes('探索係')
      ? aiReply({ angles: Array.from({ length: 8 }, (_, i) => ({ label: `角度${i}`, keyword: i < 6 ? `New Balance BEAMS ${['別注', 'スニーカー', 'グレー', 'メンズ', '限定', '2002R'][i]}` : `スニーカー ${i}` })) })
      : aiReply({ items: [] })
  });
  const idea = { edited: true, seeded: true, topic: '別注スニーカー', title: '別注スニーカーについて本気出して考えてみた', curationType: 'first_pick', postType: 'まずコレ', seedRole: 'main', searchGenres: ['スニーカー', 'コラボ スニーカー'], whyInteresting: '', target: '', priceBand: '', axis: '', genre: '', free: '' };
  const r = await call(exploreApi, { idea, seed: HERO });
  assert.equal(r.status, 200);
  // 起点の商品からは検索軸で広げる：コラボ名（ブランド＋相手）・型番をそのまま検索しない。ほかのコラボ・合わせる服も探す
  const kws = mock.calls.rakuten.map((c) => c.url.searchParams.get('keyword'));
  assert.ok(kws.filter((k) => /New Balance/.test(k) && /BEAMS/.test(k)).length <= 1, kws.join(' / '));
  assert.ok(kws.every((k) => !/ML2002R/.test(k)), kws.join(' / '));
  assert.ok(kws.some((k) => /コラボ|別注/.test(k)) && kws.some((k) => /ニット|スラックス|バッグ|パンツ/.test(k)), kws.join(' / '));
  assert.equal(r.data.candidates[0].role, '起点商品');
});

test('タイトルの再提案：シリーズの形に合わせ、今のタイトル・煽り・確認できない情報は出さない', async () => {
  const plan = readPlanForTitles({ series: 'serious', title: '別注スニーカーについて本気出して考えてみた', theme: '別注スニーカー', products: [{ name: HERO.name, brand: 'New Balance', price: 22000 }] });
  assert.equal(cleanTitle('別注スニーカーについて本気出して考えてみた', plan), '', '今のタイトルと同じ');
  assert.equal(cleanTitle('コラボスニーカーについて本気出して考えてみた', plan), 'コラボスニーカー');
  assert.equal(cleanTitle('完売確実のスニーカー', plan), '');
  const release = readPlanForTitles({ series: 'release', title: 'この新作、待ってた。', hero: { name: HERO.name, status: ['COLLAB'] } });
  assert.equal(cleanTitle('このコラボ、見逃せない。', release), 'このコラボ、見逃せない。');
  assert.equal(cleanTitle('予約できるうちに見ておきたい。', release), '', '予約は確認できていない');

  mock = installFetchMock({ rakuten: () => json(200, {}), openai: () => aiReply({ titles: [{ title: '別注スニーカー', why: '' }, { title: '大人のコラボスニーカー', why: '落ち着いたものだけ' }, { title: '別注スニーカー、結局どれ？', why: '' }] }) });
  const r = await call(planTitlesApi, { plan: { series: 'serious', title: '別注スニーカーについて本気出して考えてみた', theme: '別注スニーカー' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.titles.map((t) => t.title), ['大人のコラボスニーカー', '別注スニーカー、結局どれ？']);
  mock.restore();
  mock = installFetchMock({ rakuten: () => json(200, {}), openai: () => json(500, { error: { message: 'down' } }) });
  const fb = await call(planTitlesApi, { plan: { series: 'release', title: 'x', genre: 'スニーカー', hero: { name: HERO.name, brand: 'New Balance' } } });
  assert.equal(fb.status, 200);
  assert.ok(fb.data.titles.length >= 2 && fb.data.notice);
});

test('公式サイトのURL：JSON-LD・OGPから商品名・画像・価格を読み、社内ネットワークのURLは断る', async () => {
  const html = `<html><head><title>x</title><meta property="og:site_name" content="Brand Official">
    <meta property="og:image" content="/img/p.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"新作 キャンバストート &amp; ポーチ","brand":{"@type":"Brand","name":"BrandX"},"offers":{"@type":"Offer","price":"12,100","priceCurrency":"JPY"}}</script></head></html>`;
  const p = parseProductPage(html, 'https://brand.example/item/1');
  assert.equal(p.name, '新作 キャンバストート & ポーチ');
  assert.equal(p.price, 12100);
  assert.equal(p.image, 'https://brand.example/img/p.jpg');
  assert.equal(p.brand, 'BrandX');
  assert.equal(p.shop, 'Brand Official');
  assert.ok(isPrivateAddress('192.168.1.2') && isPrivateAddress('127.0.0.1') && isPrivateAddress('::1') && !isPrivateAddress('8.8.8.8'));
  await assert.rejects(checkPublicUrl('http://brand.example/'), /https/);
  await assert.rejects(checkPublicUrl('https://localhost/'), /使えません/);
  await assert.rejects(checkPublicUrl('https://internal.example/', async () => [{ address: '10.0.0.5' }]), /使えません/);
  const ok = await checkPublicUrl('https://brand.example/a', async () => [{ address: '93.184.216.34' }]);
  assert.equal(ok.hostname, 'brand.example');
});

test('合う服・小物を探す：靴を起点に、靴以外のアイテムを種類を変えながら少しずつ探す（商品名・型番は使わない）', async () => {
  let n = 0;
  mock = installFetchMock({ rakuten: (url) => json(200, { pageCount: 1, items: [0, 1, 2].map(() => item(`${url.searchParams.get('keyword')} 商品${n++}`)) }) });
  const r = await relatedSearch({ axis: 'match', reference: { name: 'NEW BALANCE × JJJJound U4751UK イエロー スエード スニーカー メンズ', price: 43890 }, env: ENV, referer: 'https://x.app/' });
  const kws = r.queries.map((q) => q.keyword);
  assert.ok(kws.length >= 3);
  assert.ok(kws.every((k) => k.startsWith('メンズ') && !/スニーカー|U4751UK|JJJJound/.test(k)), kws.join(' / '));
  assert.ok(new Set(r.items.map((x) => x.query)).size >= 3, '1つの種類ばかりにしない');
});
