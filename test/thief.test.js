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
  // 型番もブランドも無いときは、情報の少ない言葉から外す（種類の言葉「マッシャー」は最後まで残す）
  assert.deepEqual(queryLadder(readTarget({ name: 'つぶしやすい スプーン マッシャー' })).map((s) => s.keyword), ['つぶしやすい スプーン マッシャー', 'つぶしやすい マッシャー', 'マッシャー']);
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
  // 同一商品が見つかったら、類似の候補を足すための検索をあと1回だけして止める
  assert.deepEqual(asked, ['マーナ K829DGY', 'K829DGY', 'マーナ つぶしやすいスプーンマッシャー']);
  // 同じ型番でも別ショップの掲載は残す（安いショップを選べるように。まとめすぎると候補が少なくなるため）
  assert.deepEqual(r.data.items.map((x) => x.match), ['same', 'same', 'unknown', 'unknown']);
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

test('コメント案：投稿の文章から短い一言を2つ。宣伝・体験の言葉の案は落とす', async () => {
  mock = installFetchMock({ openai: () => aiReply({ comments: ['グレーのセットアップ、靴の色で印象が変わりますね', '私も使ってます！最高です', 'プロフ見てください'] }) });
  const r = await call({ action: 'comment', caption: 'グレーのセットアップに白スニーカーを合わせました' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.comments, ['グレーのセットアップ、靴の色で印象が変わりますね']);
  assert.equal((await call({ action: 'comment', caption: '' })).status, 400);
});

test('コメントの品質：「！」の多用・絵文字・決まり文句の褒め言葉・投稿に触れていないものを見つける', async () => {
  const { commentIssues } = await import('../lib/thief.js');
  const cap = 'グレーのセットアップに白スニーカーを合わせました';
  assert.deepEqual(commentIssues('グレーに白スニーカー、季節を問わず使えそうですね', cap), []);
  assert.ok(commentIssues('めっちゃ素敵ですね！！', cap).includes('「！」が多い'));
  assert.ok(commentIssues('グレー、最高ですね', cap).includes('決まり文句の褒め言葉'));
  assert.ok(commentIssues('グレーのセットアップ好きです😊', cap).includes('絵文字'));
  assert.ok(commentIssues('今日はいい天気でしたね', cap).includes('投稿の内容に触れていない'));
});

test('参考アカウントの自動調査：止めてあるときは動かない。実際に参照したURLがあるときだけ内容を出し、使用量から料金を計算する', async () => {
  const { researchAccount, _resetServerLedger } = await import('../lib/reference-research.js');
  _resetServerLedger();
  const callEnv = async (body, env) => { const req = { method: 'POST', headers: { host: 'x.app' }, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await thiefApi(req, res, env); return JSON.parse(res.body); };
  assert.equal((await callEnv({ action: 'research', handle: 'kose_wear' }, { ...ENV, REFERENCE_RESEARCH: 'off' })).status, 'off');
  const reply = (text, urls, searches = 2) => async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.max_tool_calls, 3);
    return new Response(JSON.stringify({ usage: { input_tokens: 20000, output_tokens: 2000 }, output: [...Array.from({ length: searches }, () => ({ type: 'web_search_call' })), { type: 'message', content: [{ type: 'output_text', text, annotations: urls.map((u) => ({ type: 'url_citation', url: u })) }] }] }), { status: 200 });
  };
  const json = JSON.stringify({ found: true, summary: 'メンズのキレイめカジュアル', themes: ['キレイめ'], keywords: ['169cm'], audience: '20〜30代男性（推測）', learn: ['身長を名前に入れる'], angles: ['服に合う小物'], unknown: ['フォロワー数'] });
  const ok = await researchAccount({ handle: 'kose_wear', env: { OPENAI_API_KEY: 'k' }, deadline: Date.now() + 30000, fetchImpl: reply(`調べました。${json}`, ['https://www.threads.com/@kose_wear']) });
  assert.equal(ok.status, 'done');
  assert.deepEqual(ok.sources, ['https://www.threads.com/@kose_wear']);
  // 料金：検索2回×0.01ドル＋入力2万×0.25/100万＋出力2千×2/100万 = 0.029ドル → 160円/ドルで4.64円。上限管理用は検索0.025ドルで計算
  assert.equal(ok.cost.searches, 2);
  assert.equal(ok.cost.yen, 4.64);
  assert.equal(ok.cost.yenCap, 9.44);
  const none = await researchAccount({ handle: 'gift_yasan', env: { OPENAI_API_KEY: 'k' }, deadline: Date.now() + 30000, fetchImpl: reply(json, []) });
  assert.equal(none.status, 'insufficient');
  assert.equal(none.summary, '');
});

test('月の上限：今月の上限管理用の料金に1回分の最大額を足して500円を超えるなら、APIを呼ばずに止める', async () => {
  const { budgetCheck, MAX_RUN_YEN, recordServer, _resetServerLedger } = await import('../lib/reference-research.js');
  _resetServerLedger();
  assert.ok(MAX_RUN_YEN > 10 && MAX_RUN_YEN < 30, String(MAX_RUN_YEN));
  assert.equal(budgetCheck({ env: {}, spentYenCap: 0 }).ok, true);
  assert.equal(budgetCheck({ env: {}, spentYenCap: 500 - MAX_RUN_YEN + 1 }).ok, false);
  // 端末の記録が消えても、サーバーが数えた分で止まる
  recordServer({ yenCap: 499 });
  assert.equal(budgetCheck({ env: {}, spentYenCap: 0 }).ok, false);
  _resetServerLedger();
  let called = 0;
  mock = installFetchMock({ openai: () => { called++; return aiReply({}); } });
  const req = { method: 'POST', headers: { host: 'x.app' }, body: { action: 'research', handle: 'kose_wear', budget: { month: new Date().toISOString().slice(0, 7), spentYenCap: 495 } } };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await thiefApi(req, res, ENV);
  const d = JSON.parse(res.body);
  assert.equal(d.status, 'budget');
  assert.equal(called, 0);
});

test('調査の失敗は200で返す（検索ジョブの自動のやり直しで料金が重ならないように）', async () => {
  const { _resetServerLedger } = await import('../lib/reference-research.js');
  _resetServerLedger();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 });
  try {
    const r = await call({ action: 'research', handle: 'kose_wear' });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'error');
  } finally { globalThis.fetch = original; }
});
