import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { tick, state, readSnapshot, WORKER_KEYS, QUOTA, estimateFrom, nextBudgetReset, nextResume, stepEstimate } from '../lib/worker.js';
import { check, record } from '../lib/budget.js';
import { withUsage } from '../lib/ai-usage.js';
import worker from '../server/worker.js';
import router from '../api/[route].js';
import { installFetchMock, json, aiReply, GOOD_INTRO, imageResponse } from './mock.js';
import fs from 'node:fs';

let mock;
let setAuditUsers = [];
afterEach(() => { if (mock) mock.restore(); mock = null; setAuditUsers = []; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', CRON_SECRET: 'sec', __noWait: true };
const ritem = (code, name, price, caption) => ({ itemCode: code, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${code.replace(/\W/g, '')}/`, mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/x.jpg'], shopName: 'ショップ', itemCaption: caption, reviewCount: 150, reviewAverage: 4.5, affiliateRate: 4 });
const SHOP = [ritem('s:lid', 'ステンレス 鍋蓋スタンド', 1000, '水受けトレー付きで、水滴がたれにくい。'), ritem('s:tong', 'シリコン トング 耐熱', 1200, 'フライパンを傷つけにくいシリコン製。'), ritem('s:guard', '油はねガード 折りたたみ', 1500, '3面で油はねを防ぐ。')];
function fetchMock({ failAi = false } = {}) {
  let setAudits = 0;
  const m = installFetchMock({
    thumbnail: () => imageResponse(),
    rakuten: (url) => json(200, { Items: url.searchParams.get('itemCode') ? SHOP.filter((x) => x.itemCode === url.searchParams.get('itemCode')) : SHOP }),
    openai: (body) => {
      if (failAi) return json(500, { error: { message: 'server error' } });
      const sys = body.messages[0].content;
      const user = body.messages[1].content;
      // 制作ライン：企画担当AI・投稿セット制作AI・監査AI（投稿セット）・制作担当AI
      if (sys.includes('Instagram企画担当とバイヤー')) return aiReply({ pattern: 'discovery', title: 'キッチンの置き場所の工夫', target: '料理する人', reason: '置き場所に困る道具を並べる', appeal: '台所が片づく', adopted: [{ id: 0, role: '本命', feature: '水受けトレー付き', why: 'ふたの置き場所' }], slots: [{ role: '中価格帯', keyword: 'キッチン 道具' }, { role: '低価格帯', keyword: 'キッチン 便利' }] });
      if (sys.includes('企画の枠ごとに')) return aiReply({ picks: [{ slot: 0, id: 0, feature: 'シリコン製', why: 'フライパンを傷つけにくい' }, { slot: 1, id: 1, feature: '3面で油はねを防ぐ', why: 'コンロまわり' }] });
      if (sys.includes('投稿文字を作る担当')) return aiReply({ topicSlug: 'kitchen', category: 'キッチン', caption: '台所の置き場所、気づくと散らかりがち。\n\n今回は置き場所に困る道具を3つ並べました。\n\n買う前に見返せるよう、保存しておいてください。', hashtags: ['#キッチン用品'], cover: { title: 'キッチンの置き場所の工夫' }, items: [0, 1, 2].map((id) => ({ id, shortName: ['鍋蓋スタンド', 'シリコントング', '油はねガード'][id], subline: '置き場所が決まる', memo: '台所が片づく' })) });
      if (sys.includes('紹介文を書く担当')) return aiReply({ items: [0, 1, 2].map((id) => ({ id, intro: GOOD_INTRO })) });
      if (sys.includes('監査AIです') && sys.includes('投稿セット（Instagram')) {
        setAudits++;
        setAuditUsers.push(user);
        const sc = (a) => ({ accuracy: { score: a[0] }, compliance: { score: a[1] }, concept: { score: a[2] }, appeal: { score: a[3] }, room: { score: a[4] } });
        return setAudits === 1 ? aiReply({ scores: sc([22, 18, 15, 12, 12]), flags: {}, fixes: [{ target: 'caption', text: '誰のどんな場面かを1文足す' }], proposal: 'revise', summary: '場面が抽象的' })
          : aiReply({ scores: sc([24, 20, 18, 17, 13]), flags: {}, fixes: [], proposal: 'pass', summary: '商品データと一致し、場面も具体的' });
      }
      if (sys.includes('制作担当AIです')) return aiReply({ caption: '料理のたびに、ふたやトングの置き場所に迷う人へ。\n\n今回は置き場所に困る道具を3つ並べました。\n\n買う前に見返せるよう、保存しておいてください。', room: [], giveUp: '' });
      void user;
      if (sys.includes('検索語を決めます')) return aiReply({ keywords: [{ keyword: 'キッチン 便利', why: 'x' }] });
      if (sys.includes('候補を最大6件選びます')) return aiReply({ candidates: [{ ref: 'R1', quotes: ['水受けトレー付き'], reason: '水受けトレー付きで水滴がたれにくい', target: '料理する人', problem: 'ふたの置き場所', roomValue: '1,000円', cautions: '大きさを確認', motive: 'fix', whoBuys: '平日に自炊する社会人', whyNow: '鍋料理が増える季節', vsOthers: 'R2のトングと違い、水受けトレー付き', priceReason: '1,000円で送料はショップで確認', postIdea: 'くまが鍋のふたをスタンドに立てる' }] });
      if (sys.includes('監査AIです') && sys.includes('コメント案を')) return aiReply({ audits: [{ id: 'AAA1', scores: { specific: 23, natural: 21, relevance: 17, distance: 14, compliance: 15 }, flags: {}, fixes: [], proposal: 'pass' }] });
      if (sys.includes('監査AIです')) return aiReply({ audits: [{ id: 'c1', scores: { accuracy: 25, evidence: 22, usefulness: 17, revenue: 13, compliance: 15 }, flags: {}, fixes: [], proposal: 'pass' }] });
      if (sys.includes('表紙画像担当AIです')) return aiReply({ scenes: [{ usage: '鍋のふたを立てて置く', usageQuote: user.includes('水受けトレー付き') ? '水受けトレー付き' : (user.match(/商品の説明：([^。\n]{4,12})/) || [])[1] || '', place: 'キッチン', time: '夕方', action: '料理の途中で鍋のふたをスタンドに立てている', consistency: 'ふたはスタンドの溝に立つ', camera: '斜め上', productPlacement: '手前で大きく', outfit: 'エプロン', mood: '落ち着いた' }] });
      if (sys.includes('品質確認の担当')) return aiReply({ single: true, character: true, sameAsMaster: true, plush3d: true, productLarge: true, productMatches: true, usingProduct: true, consistent: true, noText: true, noLogo: true, handsOk: true, noMedical: true, warmScene: true, topSpace: true, issues: [] });
      if (sys.includes('営業・交流担当AIです')) return aiReply({ drafts: [{ id: 'AAA1', anchor: '水受けトレー付き', comment: '水受けトレー付きなら台が濡れにくそうですね', relevance: 80, relevanceWhy: 'x', follow: 70, followWhy: 'y' }] });
      return aiReply({});
    }
  });
  // 自分のサイトの静的ファイル（マスター画像・方向性の参考画像）は、リポジトリのファイルを返す
  const mocked = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const u = String(url); if (u.startsWith(APP)) return new Response(fs.readFileSync(new URL('../' + u.slice(APP.length), import.meta.url)), { status: 200, headers: { 'Content-Type': 'image/png' } }); return mocked(url, opts); };
  return m;
}
const APP = 'https://app.test/';
const SNAP = { themes: ['キッチンの便利グッズ'], avoid: [], past: [], outreachPosts: [{ id: 'AAA1', url: 'https://www.instagram.com/p/AAA1/', handle: 'k', caption: '鍋のふたの置き場所に困って、水受けトレー付きのスタンドを置きました。', source: '社長が追加' }], pendingBuyer: 0 };
const run = (kv, env = ENV) => withUsage(() => tick({ kv, env, origin: APP, startedAt: Date.now() }));

// 2026-11-15 社長の依頼：日次予算25円は維持したまま、0時まで止まらないように優先順位と配分を直す
test('費用の見込み：実測の記録（直近5件の最大の1.2倍）を使い、記録が無ければ初期値', () => {
  assert.equal(estimateFrom([2.11, 3.24, 2.22, 2.9], 4), 4); // 3.24×1.2=3.89 → 0.5円単位で4
  assert.equal(estimateFrom([1.0, 0.8], 4), 1.5);
  assert.equal(estimateFrom([], 4), 4);
  assert.equal(stepEstimate({ type: 'production', step: 'gather' }), 0, 'AIを使わない段階は0円');
  assert.ok(stepEstimate({ type: 'production', step: 'audit' }) > 0);
  assert.equal(nextBudgetReset(new Date('2026-11-15T13:30:00Z')), '2026-11-15T15:00:00.000Z', '日本時間の翌日0:00');
});

const cand = (code, motive = 'fix') => ({ id: 'c' + code, status: 'pass', versions: [{ data: { id: 'c' + code, code, name: code, price: 1000, url: 'https://item.rakuten.co.jp/s/x/', image: 'x', motive }, audit: { total: 90 } }] });

test('合格商品があれば、再審査・新規探索より投稿セットの制作を優先：残りが制作の見込みに足りれば制作を始め、足りなければほかのAIの仕事でも取り置きを崩さない', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot({ ...SNAP, outreachPosts: [] }));
  await kv.pushJson(WORKER_KEYS.buyer, { id: 's1', at: new Date().toISOString(), candidates: [cand('a')] }, 30);
  // 実測の制作の費用（3.24円）→ 見込み4円。今日の残り4.5円 → 制作を始める
  await kv.pushJson(WORKER_KEYS.prod, { id: 'p0', status: 'done', result: 'reject', runs: [{ yen: 3.24 }], endedAt: '2000-01-01' }, 20);
  await record(kv, 20.5, { auto: true });
  const r = await run(kv);
  assert.equal(r.worked && r.worked.agent, 'production', JSON.stringify(r).slice(0, 400));
});

test('制作できる状態なら、再審査・発掘・交流は制作の見込みを残せるときだけ始める（取り置き）。始められないときは理由と再開予定を返す', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  // 合格候補はあるが、今日の制作の上限に達していない／棚に空きがある。残り6円・制作4円・交流2円 → 交流を始めると制作の分が残らないので待つ
  await kv.setJson(WORKER_KEYS.snap, readSnapshot({ ...SNAP }));
  await kv.pushJson(WORKER_KEYS.buyer, { id: 's1', at: new Date().toISOString(), candidates: [cand('a')] }, 30);
  await kv.pushJson(WORKER_KEYS.prod, { id: 'p0', status: 'done', result: 'reject', runs: [{ yen: 3.24 }], endedAt: '2000-01-01' }, 20);
  await kv.incr(`worker:quota:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}:production`); // 1件作った
  await record(kv, 21.5, { auto: true }); // 残り3.5円：制作4円に足りない
  const r = await run(kv);
  assert.ok(r.idle, JSON.stringify(r).slice(0, 300));
  const by = Object.fromEntries(r.board.items.map((x) => [x.agent, x]));
  assert.match(by.production.reason, /費用の残り（3.5円）.*見込み（4円）/);
  assert.equal(by.outreach.status, 'wait');
  assert.match(by.outreach.reason, /取り置いている|費用の残り/);
  assert.equal(r.board.next.kind, 'budget');
  assert.match(r.board.next.reason, /投稿セット1件の見込み4円/);
  const st = await state(kv, ENV);
  assert.equal(st.health.blocked.kind, 'budget', '画面に出す理由と再開予定を保存');
  assert.ok(st.health.blocked.resumeAt);
  assert.equal(mock.calls.openai.length, 0);
});

test('取り置き：今日の制作の上限に達した日は取り置かない。制作が予算不足のときの再開予定は「明日0:00・最初に投稿セット」', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot({ ...SNAP }));
  await kv.pushJson(WORKER_KEYS.buyer, { id: 's1', at: new Date().toISOString(), candidates: [cand('a')] }, 30);
  await kv.pushJson(WORKER_KEYS.prod, { id: 'p0', status: 'done', result: 'reject', runs: [{ yen: 3.24 }], endedAt: '2000-01-01' }, 20);
  const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  for (let i = 0; i < QUOTA.production; i++) await kv.incr(`worker:quota:${day}:production`); // 今日の制作の上限に達した → 取り置きなし
  await record(kv, 23.5, { auto: true }); // 残り1.5円
  const r = await run(kv);
  assert.ok(r.idle);
  const by = Object.fromEntries(r.board.items.map((x) => [x.agent, x]));
  assert.ok(!/取り置/.test(by.outreach.reason), '制作できない日は取り置かない：' + by.outreach.reason);
  // nextResume：制作が予算不足なら「明日0:00に予算が戻ったら、最初に投稿セットを作る」
  const n = nextResume([{ agent: 'production', status: 'wait', kind: 'budget', reason: 'x' }], { left: 2, est: { production: 4 }, d: new Date('2026-11-15T13:00:00Z') });
  assert.match(n.resume, /最初に投稿セット/);
  assert.equal(n.resumeAt, '2026-11-15T15:00:00.000Z');
});
