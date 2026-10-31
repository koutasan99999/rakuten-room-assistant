import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pitchApi from '../server/pitch.js';
import { readTaste, readExclude, NG_RE } from '../lib/pitch.js';
import { PITCH_SEED } from '../lib/pitch-seed.js';
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
const item = (name, i, extra = {}) => ({ itemCode: extra.code || `s:${i}`, itemName: name, itemPrice: 4980 + i * 100, itemUrl: `https://item.rakuten.co.jp/s/${i}/`, mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/x/${i}.jpg?_ex=128x128`], shopName: 'ショップ', itemCaption: extra.caption || '説明', reviewCount: 12, reviewAverage: 4.2, postageFlag: i % 2 });
const PITCH = '社長、これどうすか？落ち着いた色なのに、よく見ると生地に表情があって、無難に見えないのがいいところです。休日にさらっと羽織れる感じです。';

test('好みの材料と除外：判断と理由だけを受け取り、前に出した商品は名前の先頭でも外す', () => {
  const t = readTaste({ history: [{ status: 'adopt', name: 'リネンシャツ', reason: '素材感がいい' }, { status: 'x', name: 'a' }, { status: 'reject', name: '' }], note: 'n' });
  assert.equal(t.history.length, 1);
  assert.equal(t.history[0].reason, '素材感がいい');
  const ex = readExclude({ codes: ['s:1'], names: ['【送料無料】柄シャツ メンズ 半袖'] });
  assert.ok(ex.codes.has('s:1') && ex.names.size === 1);
  assert.ok(NG_RE.test('愛用しています') && NG_RE.test('最安値') && !NG_RE.test('素材感がいい'));
  assert.equal(PITCH_SEED.length, 10);
});

test('新しく探す：履歴を渡して検索語を決め、前に出した商品を外し、体験・煽りの言葉のプレゼンは落とす', async () => {
  let planUser = '';
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword');
      return json(200, { pageCount: 1, items: [item(`前に出したシャツ ${kw}`, 0, { code: 'old:1' }), item(`柄シャツ オープンカラー ${kw}`, 1), item(`ルームフレグランス ウッド ${kw}`, 2), item(`スマホスタンド アルミ ${kw}`, 3)] });
    },
    openai: (body) => {
      const sys = body.messages[0].content;
      if (sys.includes('社長（オーナー）')) { planUser = body.messages[1].content; return aiReply({ queries: [{ category: '服', keyword: '柄シャツ メンズ', angle: '柄もの' }, { category: '香り', keyword: 'ルームフレグランス', angle: '香り' }], taste: '素材感を重視している可能性（まだ断定できない）' }); }
      return aiReply({ picks: [
        { id: 0, brand: '', category: '服', pitch: PITCH, fit: '落ち着いていて無難ではない', caution: 'サイズ感は商品ページで確認したい' },
        { id: 1, brand: '', category: '香り', pitch: '社長、これ愛用してるんですけど最高です。部屋がいい香りになって、来客にもウケます。間違いないです。', fit: '香り', caution: '香りの好みが分かれる' },
        { id: 2, brand: '', category: 'ガジェット', pitch: PITCH, fit: '机に置いて絵になる', caution: '' }
      ] });
    }
  });
  const r = await call({ action: 'scout', taste: { history: [{ status: 'adopt', name: 'リネンシャツ', category: '服', reason: '素材感がいい' }, { status: 'reject', name: '黒い財布', reason: 'ありきたり' }] }, exclude: { codes: ['old:1'], names: [] } });
  assert.equal(r.status, 200);
  assert.ok(planUser.includes('素材感がいい') && planUser.includes('ありきたり'), '理由がAIに渡っていない');
  assert.equal(r.data.items.length, 1, JSON.stringify(r.data.items.map((x) => x.name)));
  const p = r.data.items[0];
  assert.ok(!p.name.includes('前に出した'));
  assert.ok(p.pitch.startsWith('社長、'));
  assert.ok(p.caution && p.fit && p.url.startsWith('https://') && p.image);
  assert.ok(p.price > 0 && ['送料込み', '送料別'].includes(p.postage));
  assert.equal(r.data.taste, '素材感を重視している可能性（まだ断定できない）');
});

test('もっと見せて：元の商品を渡し、元の商品は除いて探す', async () => {
  let planUser = '';
  mock = installFetchMock({
    rakuten: () => json(200, { pageCount: 1, items: [item('元のシャツ', 0, { code: 'base:1' }), item('上のブランドのシャツ', 1)] }),
    openai: (body) => {
      if (body.messages[0].content.includes('社長（オーナー）')) { planUser = body.messages[1].content; return aiReply({ queries: [{ category: '服', keyword: 'シャツ 上質', angle: '上のブランド' }, { category: '服', keyword: 'シャツ 柄', angle: '似た商品' }] }); }
      return aiReply({ picks: [{ id: 0, category: '服', pitch: PITCH, fit: '近い雰囲気', caution: '価格が少し上がる' }] });
    }
  });
  const r = await call({ action: 'more', base: { name: '元のシャツ', price: 4980, category: '服', code: 'base:1' }, exclude: { codes: ['base:1'] } });
  assert.equal(r.status, 200);
  assert.ok(planUser.includes('base（もっと見せて）: 元のシャツ'));
  assert.equal(r.data.items[0].name, '上のブランドのシャツ');
  assert.ok(r.data.items[0].angle.startsWith('もっと見せて'));
});

test('初期候補：これまでの発掘商品を楽天で探し直し、見つからない商品は「見つからなかった」に入れる', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword');
      if (kw.includes('Luna')) return json(200, { pageCount: 0, items: [] });
      return json(200, { pageCount: 1, items: [item(`${kw} 本体`, kw.length)] });
    },
    openai: (body) => {
      const n = (body.messages[1].content.match(/^\d+:/gm) || []).length;
      return aiReply({ picks: Array.from({ length: n }, (_, id) => ({ id, category: '雑貨', pitch: PITCH, fit: '合う', caution: '注意点' })) });
    }
  });
  const r = await call({ action: 'seed', exclude: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 9);
  assert.deepEqual(r.data.missing, ['Luna Display']);
  assert.ok(r.data.items.every((x) => x.origin === 'seed'));
});

test('登録前の確認：商品番号で今の価格・送料を確かめ、価格が変わっていれば知らせる。見つからなければそう返す', async () => {
  let asked = null;
  mock = installFetchMock({
    rakuten: (url) => { asked = url; return url.searchParams.get('itemCode') === 's:5' ? json(200, { items: [item('シャツ', 5, { code: 's:5' })] }) : json(200, { items: [] }); }
  });
  const r = await call({ action: 'verify', product: { name: 'シャツ', code: 's:5', price: 4000 } });
  assert.equal(r.status, 200);
  assert.equal(asked.searchParams.get('itemCode'), 's:5');
  assert.equal(asked.searchParams.get('keyword'), null);
  assert.ok(r.data.found && r.data.priceChanged && r.data.message.includes('価格が変わっています'));
  assert.equal(r.data.postage, '送料別');
  const gone = await call({ action: 'verify', product: { name: 'x', code: 's:9', price: 100 } });
  assert.equal(gone.data.found, false);
});

test('看板商品：特集原稿はPR表記をキャプションの1行目に入れ、ハッシュタグは5個まで（#PRは本文で表記）', async () => {
  mock = installFetchMock({
    openai: () => aiReply({ title: '休日の机', target: '30代男性', slides: ['1 表紙', '2 中身'], caption: '休日の机を少し良くしたい人へ。', hashtags: ['#PR', '#a', '#b', '#c', '#d', '#e', '#f'] })
  });
  const r = await call({ action: 'feature', product: { name: 'スタンド', price: 3000, pitch: PITCH } });
  assert.equal(r.status, 200);
  assert.ok(r.data.caption.startsWith('【PR】楽天アフィリエイトを利用しています'));
  assert.equal(r.data.hashtags.length, 5);
  assert.ok(!r.data.hashtags.includes('#PR'));
});

test('紹介文：採用した商品の紹介文を1件だけ作る。商品がなければ400', async () => {
  mock = installFetchMock({ openai: () => aiReply({ picks: [{ id: 0, intro: 'シンプルな見た目で、部屋のどこに置いてもなじみやすそうなスタンドです。アルミの素材感が机の上を少し引き締めてくれそう。角度を変えられると説明にあるので、動画を見るときにも使いやすそうです。気になる人は商品ページで詳細を確認してみてください。' }] }) });
  const r = await call({ action: 'intro', product: { name: 'スタンド', price: 3000, fit: '机で絵になる' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.intro.length >= 60);
  assert.equal((await call({ action: 'intro', product: {} })).status, 400);
  assert.equal((await call({ action: 'nope', product: { name: 'a' } })).status, 400);
});
