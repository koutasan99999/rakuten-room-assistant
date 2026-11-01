import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import thiefApi from '../server/thief.js';
import { readTarget, queryLadder, classifyMatch, bestMatch } from '../lib/product-match.js';
import { readHandle, readPostUrl } from '../lib/thief.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());
async function call(body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await thiefApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}
const item = (name, i, extra = {}) => ({ itemCode: extra.code || `s:${i}`, itemName: name, itemPrice: 3000 + i, itemUrl: `https://item.rakuten.co.jp/s/${i}/`, mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/x/${i}.jpg?_ex=128x128`], shopName: extra.shop || 'ショップ', itemCaption: extra.caption || '', reviewCount: 3, postageFlag: 0 });

test('検索語の段階：ブランド＋型番 → 型番だけ → ブランド＋主な言葉 → ブランドの別表記 → 言葉を減らす', () => {
  const t = readTarget({ name: 'THE NORTH FACE ヌプシジャケット ND92335 送料無料' });
  assert.equal(t.brand, 'THE NORTH FACE');
  assert.equal(t.model, 'ND92335');
  const ks = queryLadder(t).map((s) => s.keyword);
  assert.equal(ks[0], 'THE NORTH FACE ND92335');
  assert.equal(ks[1], 'ND92335');
  assert.ok(ks.includes('THE NORTH FACE ヌプシジャケット'));
  assert.ok(ks.some((k) => k.startsWith('ノースフェイス')), ks.join(' / '));
  assert.ok(!ks.some((k) => k.includes('送料無料')));
  assert.equal(new Set(ks).size, ks.length);
  // 型番もブランドも無いときは、主な言葉を前から減らす
  assert.deepEqual(queryLadder(readTarget({ name: 'つぶしやすい スプーン マッシャー' })).map((s) => s.keyword), ['つぶしやすい スプーン マッシャー', 'つぶしやすい スプーン', 'つぶしやすい']);
});

test('照合：型番が一致したときだけ同一商品。型番違い・付属品・型番なしは同一と断定しない', () => {
  const t = readTarget({ name: 'ヌプシジャケット', brand: 'THE NORTH FACE', model: 'ND92335' });
  assert.equal(classifyMatch(t, { name: 'ザ・ノースフェイス ヌプシジャケット ND92335' }).match, 'same');
  assert.equal(classifyMatch(t, { name: 'THE NORTH FACE ヌプシ ND92234' }).match, 'similar');
  assert.ok(classifyMatch(t, { name: 'ヌプシジャケット ND92335 対応 収納ケース' }).note.includes('付属品'));
  assert.equal(classifyMatch(t, { name: 'ダウンジャケット メンズ' }).match, 'unknown');
  // 型番が分からないときは、名前とブランドが合っても「類似」まで
  const noModel = readTarget({ name: 'つぶしやすいスプーンマッシャー', brand: 'マーナ' });
  const r = classifyMatch(noModel, { name: 'マーナ つぶしやすいスプーンマッシャー グレー' });
  assert.equal(r.match, 'similar');
  assert.ok(r.note.includes('断定しません'));
  // 1回の検索から選ぶとき：付属品・未確認は選ばない
  const best = bestMatch({ name: 'PLAUD NOTE' }, [{ name: 'PLAUD NOTE 専用ケース' }, { name: 'ボイスレコーダー 小型' }, { name: 'PLAUD NOTE ボイスレコーダー 本体' }]);
  assert.equal(best.it.name, 'PLAUD NOTE ボイスレコーダー 本体');
  assert.equal(bestMatch({ name: 'PLAUD NOTE' }, [{ name: 'ボイスレコーダー 小型' }]), null);
});

test('IDと投稿URLの読み取り', () => {
  assert.equal(readHandle('@Ken_Good_Item'), 'ken_good_item');
  assert.equal(readHandle('https://www.instagram.com/ken_good_item/'), 'ken_good_item');
  assert.equal(readHandle('https://www.instagram.com/p/ABCDE12345/'), '');
  assert.equal(readPostUrl('https://www.instagram.com/reel/ABCDE12345/?igsh=x'), 'https://www.instagram.com/reel/ABCDE12345/');
  assert.equal(readPostUrl('https://example.com/p/ABCDE12345/'), '');
});

test('楽天で探す：段階的に検索し、同一商品が見つかったら止めて、同一→類似→未確認の順に返す', async () => {
  const asked = [];
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword');
      asked.push(kw);
      if (kw === 'マーナ K829DGY') return json(200, { items: [] });
      if (kw === 'K829DGY') return json(200, { items: [item('マッシャー 便利 キッチン', 1), item('マーナ つぶしやすいスプーンマッシャー K829DGY', 2), item('marna スプーンマッシャー K829DGY グレー', 3, { shop: 'マーナ公式' })] });
      return json(200, { items: [item('ほかの商品', 9)] });
    }
  });
  const r = await call({ action: 'search', target: { name: 'つぶしやすいスプーンマッシャー', brand: 'マーナ', model: 'K829DGY' } });
  assert.equal(r.status, 200);
  assert.deepEqual(asked, ['マーナ K829DGY', 'K829DGY']);
  assert.deepEqual(r.data.items.map((x) => x.match), ['same', 'unknown']); // 同じ型番の2件は、同じ商品として1件にまとめる
  assert.ok(r.data.items[0].note.includes('型番 K829DGY が一致'));
  assert.equal(r.data.tried[0].count, 0);
  assert.equal((await call({ action: 'search', target: { name: 'a' } })).status, 400);
});

test('スクリーンショット：画像をAIに渡し、書かれている商品だけを返す。画像以外は受け付けない', async () => {
  let sent = null;
  mock = installFetchMock({
    openai: (body) => { sent = body.messages[1].content; return aiReply({ handle: '@Ken_Good_Item', products: [{ name: 'スプーンマッシャー K829DGY', brand: 'マーナ', model: 'K829DGY', aliases: ['marna'], evidence: '画像の上の文字' }, { name: '', brand: 'x' }] }); }
  });
  const r = await call({ action: 'extract', image: 'data:image/jpeg;base64,AAAA' });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(sent) && sent[1].type === 'image_url');
  assert.equal(r.data.products.length, 1);
  assert.equal(r.data.handle, 'ken_good_item');
  assert.equal((await call({ action: 'extract', image: 'https://example.com/a.jpg' })).status, 400);
});

test('候補のプレゼン：楽天の商品データのまま、出どころ（商品ドロボー）を付けて返す。AIが失敗しても商品は返す', async () => {
  mock = installFetchMock({ openai: () => aiReply({ picks: [{ id: 0, category: '雑貨', pitch: '社長、これどうすか？先っぽで割ってからつぶす形のマッシャーで、ポテサラの作業が少し楽になりそうです。見た目もすっきりしていて台所に置いても邪魔になりません。', fit: '日常の小さな面倒を減らす', caution: '大きな量を一度につぶすのには向かないかもしれない' }] }) });
  const c = { code: 's:2', name: 'マーナ つぶしやすいスプーンマッシャー K829DGY', price: 990, url: 'https://item.rakuten.co.jp/s/2/', image: 'https://thumbnail.image.rakuten.co.jp/x/2.jpg', shop: 'ショップ' };
  const r = await call({ action: 'pitch', candidate: c, source: { handle: 'ken_good_item' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.item.code, 's:2');
  assert.equal(r.data.item.origin, 'thief');
  assert.ok(r.data.item.angle.includes('@ken_good_item'));
  assert.ok(r.data.item.pitch.startsWith('社長、'));
  mock.restore();
  mock = installFetchMock({ openai: () => json(500, { error: { message: 'down' } }) });
  const r2 = await call({ action: 'pitch', candidate: c, source: { handle: 'ken_good_item' } });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.item.pitch, '');
  assert.ok(r2.data.item.caution.includes('確認'));
});
