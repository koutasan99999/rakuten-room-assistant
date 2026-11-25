// 2026-11-24 KOT-13：収益の経営手法（不足条件・逆算・投稿ごとの数字・カレンダー・週ごとの見直し）。AIは呼ばない・新規ROOM紹介の停止は変えない
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import * as P from '../lib/v2/profit.js';
import * as KPI from '../lib/v2/kpi.js';
import * as V from '../lib/v2/company.js';
import v2api from '../server/v2.js';
import { installFetchMock } from './mock.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', APP_PASSCODE: 'pw' };
const call = async (kv, body) => { const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await v2api({ method: 'POST', url: '/api/v2', headers: { 'x-app-passcode': 'pw' }, body }, res, { ...ENV, __kv: kv }); return { status: res.statusCode, data: JSON.parse(res.body) }; };
const noAi = () => { mock = installFetchMock({ rakuten: () => new Response('{}'), openai: () => { throw new Error('AIは呼ばない'); } }); };

test('資料の手法：採用・保留・不採用それぞれに理由・担当・成果物・確かめ方がある。新規ROOM紹介の再開と自動投稿は不採用', () => {
  for (const m of P.METHODS) { assert.ok(['adopt', 'hold', 'reject'].includes(m.decision), m.id); for (const k of ['why', 'owner', 'deliverable', 'verify']) assert.ok(m[k], `${m.id}.${k}`); }
  assert.equal(P.METHODS.find((m) => m.id === 'new-room').decision, 'reject');
  assert.equal(P.METHODS.find((m) => m.id === 'auto-post').decision, 'reject');
  assert.equal(P.METHODS.find((m) => m.id === 'roadmap').decision, 'hold', '30日60投稿はノルマにしない');
});

test('投稿ごとの数字：CTR・CVR・利益を計算し、無い数字は null（未計測）。割合は両方ある投稿だけで出す', () => {
  const rows = [{ id: 'a', views: 1000, roomClicks: 20, orders: 1, reward: 90, cost: 10 }, { id: 'b', views: 500 }, { id: 'c', views: 200, linkClicks: 5 }].map(P.postRow);
  assert.equal(rows[0].ctr, 0.02); assert.equal(rows[0].cvr, 0.05); assert.equal(rows[0].profit, 80);
  assert.equal(rows[1].ctr, null); assert.equal(rows[1].profit, null);
  const t = P.funnelTotals(rows);
  assert.equal(t.views, 1700); assert.equal(t.clicks, 25);
  assert.equal(t.ctr, Math.round((25 / 1200) * 10000) / 10000, 'クリックの無い投稿の閲覧は分母に入れない');
  assert.equal(t.profit, 80);
  assert.equal(P.funnelTotals([P.postRow({ views: 10 })]).reward, null);
});

test('逆算：実績が無ければ仮説と明記し、実績が入ると置き換わる', () => {
  const h = P.reverse({ prices: [], totals: {} });
  assert.equal(h.allActual, false);
  for (const k of ['price', 'rate', 'cvr', 'ctr']) assert.equal(h.inputs[k].kind, 'hypothesis');
  assert.match(h.inputs.cvr.basis, /仮説/);
  // 3000円×3%＝90円 → 334件 → 6680クリック → 668000閲覧
  assert.equal(h.perOrder, 90); assert.equal(h.need.orders, 334); assert.equal(h.need.clicks, 6680); assert.equal(h.need.views, 668000);
  const a = P.reverse({ prices: [2000, 4000, 6000], totals: { ctr: 0.02, cvr: 0.1 }, rate: 0.04, recentViews30: 10000 });
  assert.equal(a.allActual, true); assert.equal(a.inputs.price.value, 4000);
  assert.equal(a.perOrder, 160); assert.equal(a.need.orders, 188); assert.equal(a.need.views, 94000); assert.equal(a.gap, 9.4);
});

test('カレンダー：暦の行事は日付を計算し、過ぎたものは出さない。楽天のイベントは公式URLで登録したものだけ日付を出す', async () => {
  const d = new Date('2026-11-24T03:00:00Z');
  const c = P.calendar([], d);
  assert.ok(c.items.every((e) => e.end >= '2026-11-24'));
  assert.ok(c.items.some((e) => e.name === 'クリスマス' && e.start === '2026-12-25'));
  assert.ok(!c.items.some((e) => e.name === 'ハロウィン' && e.start === '2026-10-31'), '過ぎた行事は出さない');
  assert.ok(c.items.some((e) => e.name === 'バレンタインデー' && e.start === '2027-02-14'));
  assert.equal(P.seasonEvents(2027).find((e) => e.name === '母の日').start, '2027-05-09');
  assert.equal(c.unconfirmed.length, 3, '楽天のイベントは日付を推測しない');
  const kv = memoryKv(); noAi();
  assert.equal((await call(kv, { action: 'calendarAdd', event: { name: '楽天スーパーSALE', start: '2026-12-04', end: '2026-12-11', url: 'https://example.com/sale' } })).status, 400, '公式でないURLは断る');
  const ok = await call(kv, { action: 'calendarAdd', event: { name: '楽天スーパーSALE', start: '2026-12-04', end: '2026-12-11', url: 'https://event.rakuten.co.jp/campaign/supersale/' } });
  assert.equal(ok.status, 200);
  const c2 = P.calendar(await kv.getJson(P.PROFIT_KEYS.calendar), d);
  assert.ok(c2.items.some((e) => e.kind === 'rakuten' && e.start === '2026-12-04'));
  assert.equal(c2.unconfirmed.length, 2);
  assert.equal((await call(kv, { action: 'rateSet', rate: 3, url: 'https://affiliate.rakuten.co.jp/' })).status, 400, '料率は0〜1');
});

test('不足条件：実データで判定し、売上が無ければ「成約・確定報酬」が未解決。登録すると解決済みになる', async () => {
  noAi();
  const kv = memoryKv();
  let f = await P.gatherFacts(kv, {}, { budgetLeft: 1.6, budgetLimit: 1000 });
  const by = (id) => f.missing.find((m) => m.id === id);
  assert.equal(by('orders').status, 'open'); assert.equal(by('perf').status, 'open'); assert.equal(by('budget').status, 'open');
  for (const m of f.missing) for (const k of ['what', 'basis', 'impact', 'fix', 'cost', 'owner', 'priority']) assert.ok(m[k] != null && m[k] !== '', `${m.id}.${k}`);
  assert.equal(f.missing[0].status, 'open', '未解決が上');
  await call(kv, { action: 'perfAdd', perf: { views: 300, roomClicks: 6, orders: 1, reward: 45, postedAt: new Date().toISOString().slice(0, 10) } });
  f = await P.gatherFacts(kv, {}, { budgetLeft: 500 });
  assert.equal(by('orders').status, 'solved'); assert.equal(by('perf').status, 'solved'); assert.equal(by('clicks').status, 'solved');
  assert.equal(f.totals.profit, 45); assert.equal(f.recentViews30, 300);
});

test('週ごとの見直し：広報（2026-11-25 鑑定から移管）が7日に1回だけ行い、詰まっている段階・担当・成果物・やめる条件を決めて引き継ぐ（AI 0回・新規ROOM紹介は止まったまま）', async () => {
  noAi();
  const kv = memoryKv();
  assert.equal((await V.roomStopState(kv)).stopped, true);
  await (await KPI.kpiWork(kv)).run(); // 今日の成果の数字は記録済みにする
  let w = await P.reviewWork(kv, () => P.gatherFacts(kv, ENV));
  assert.equal(w.kind, 'profit-review');
  assert.equal(w.est, 0);
  const r = await w.run({ env: ENV });
  assert.match(r.done, /計測/);
  assert.equal(r.handoff, 'pr');
  const rv = (await kv.getJson(P.PROFIT_KEYS.reviews))[0];
  for (const k of ['bottleneck', 'evidence', 'nextTest', 'dept', 'deliverable', 'stopCondition']) assert.ok(rv[k], k);
  assert.equal(await P.reviewWork(kv, () => P.gatherFacts(kv, ENV)), null, '7日以内はもう一度しない');
  assert.equal((await V.roomStopState(kv)).stopped, true, '見直しで停止は解除しない');
  // 数字が入ると、詰まっている段階が変わる（CTRが低い → ライターへ）
  const f = { perfPosts: 2, totals: { views: 1000, clicks: 2, ctr: 0.002, orders: null, cvr: null }, reverse: { need: {} }, missing: [], salesMonth: 0 };
  const x = P.weeklyReview(f);
  assert.equal(x.dept, 'writer'); assert.match(x.bottleneck, /クリック/);
});

test('画面の状態：profit に不足条件・逆算・カレンダー・手法が入る', async () => {
  noAi();
  const kv = memoryKv();
  const st = await call(kv, { action: 'state' });
  assert.equal(st.status, 200);
  const p = st.data.profit;
  assert.ok(p && p.missing.length >= 8 && p.methods.length === P.METHODS.length && p.calendar.items.length > 0);
  assert.equal(p.target, 30000);
  assert.equal(st.data.roomStop.stopped, true);
});
