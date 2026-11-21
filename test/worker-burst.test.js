// KOT-10：承認待ちがあっても独立した仕事が進む／1回の定期実行で複数段階（上限つき）／滞留の診断
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { tick, state, readSnapshot, WORKER_KEYS, MAX_BURST, diagnoseFlow, STALL_MIN } from '../lib/worker.js';
import { withUsage } from '../lib/ai-usage.js';
import { installFetchMock, json, aiReply } from './mock.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', CRON_SECRET: 'sec', __noWait: true };
const ritem = (code, name, price, caption) => ({ itemCode: code, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${code.replace(/\W/g, '')}/`, mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/x.jpg'], shopName: 'ショップ', itemCaption: caption, reviewCount: 150, reviewAverage: 4.5, affiliateRate: 4 });
const SHOP = [ritem('s:lid', 'ステンレス 鍋蓋スタンド', 1000, '水受けトレー付きで、水滴がたれにくい。')];
function fetchMock() {
  return installFetchMock({
    rakuten: () => json(200, { Items: SHOP }),
    openai: (body) => {
      const sys = body.messages[0].content;
      if (sys.includes('検索語を決めます')) return aiReply({ keywords: [{ keyword: 'キッチン 便利', why: 'x' }] });
      if (sys.includes('監査AIです') && sys.includes('コメント案を')) return aiReply({ audits: [{ id: 'AAA1', scores: { specific: 23, natural: 21, relevance: 17, distance: 14, compliance: 15 }, flags: {}, fixes: [], proposal: 'pass' }] });
      if (sys.includes('営業・交流担当AIです')) return aiReply({ drafts: [{ id: 'AAA1', anchor: '水受けトレー付き', comment: '水受けトレー付きなら台が濡れにくそうですね', relevance: 80, relevanceWhy: 'x', follow: 70, followWhy: 'y' }] });
      return aiReply({});
    }
  });
}
const APP = 'https://app.test/';
// 承認待ち（社長の確認待ち）が満杯でも、営業・交流とバイヤーは独立して進む
const SNAP = { themes: ['キッチンの便利グッズ'], avoid: [], past: [], pendingSets: 6, outreachPosts: [{ id: 'AAA1', url: 'https://www.instagram.com/p/AAA1/', handle: 'k', caption: '鍋のふたの置き場所に困って、水受けトレー付きのスタンドを置きました。', source: '社長が追加' }] };
const run = (kv, maxSteps) => withUsage(() => tick({ kv, env: ENV, origin: APP, startedAt: Date.now(), maxSteps }));

test('承認待ち6件でも独立した仕事（交流→バイヤー）が進み、1回の実行で複数段階を進める。初期（maxSteps 未指定）は従来どおり1段階', async () => {
  mock = fetchMock();
  const kv1 = memoryKv();
  await kv1.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  const one = await run(kv1);
  assert.equal(one.worked.step, 'draft');
  assert.equal(one.burst, undefined, '従来どおり1段階だけ');

  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  const r = await run(kv, 3);
  assert.ok(r.burst, JSON.stringify(r));
  assert.equal(r.burst.steps, 3);
  assert.deepEqual(r.burst.worked.map((w) => `${w.agent}:${w.step}`), ['outreach:draft', 'outreach:audit', 'buyer:buyer']);
  const st = await state(kv, ENV);
  const by = Object.fromEntries(st.board.items.map((x) => [x.agent, x]));
  assert.equal(by.production.status, 'none');
  assert.equal(st.flow.throughput.ticks, 1); assert.equal(st.flow.throughput.steps, 3);
  assert.equal(st.flow.throughput.stepsPerTick, 3);
  // 1日の上限（交流3件・バイヤー8件）と費用の上限は tickOnce が段階ごとに確かめ直す。同じ交流候補は二度作らない（重複防止）
  assert.equal(st.outreach.filter((o) => o.postId === 'AAA1').length, 1);
});

test('上限：maxSteps は MAX_BURST を超えない。失敗した段階で止まる。実行の機会を逃したあと（30分以上）は上限まで進めて遅れを取り戻す', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  const r = await run(kv, 99);
  assert.ok(r.burst.steps <= MAX_BURST && r.burst.max === MAX_BURST);
  const kv2 = memoryKv();
  await kv2.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  await kv2.setJson(WORKER_KEYS.health, { failures: 0, lastTickAt: new Date(Date.now() - 2 * 3600000).toISOString() });
  const c = await run(kv2, 2);
  assert.equal(c.burst.catchUp, true);
  assert.equal(c.burst.max, MAX_BURST);
  // 停止中は進めない
  const kv3 = memoryKv();
  await kv3.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  await kv3.setJson('worker:paused', { on: true, at: new Date().toISOString(), reason: 't' });
  const p = await run(kv3, 5);
  assert.match(p.skipped, /停止中/);
  assert.equal(p.burst, undefined);
});

test('流れの診断：滞留・実行機会の喪失・エラー・承認待ちを、記録から分けて出す（偽の「稼働中」にしない）', () => {
  const nowMs = Date.parse('2026-11-21T12:00:00Z');
  const ago = (m) => new Date(nowMs - m * 60000).toISOString();
  const board = { capacity: { ready: 3, shelf: 2 }, items: [{ agent: 'buyer', status: 'work' }] };
  const base = { health: { lastTickAt: ago(5) }, board, nowMs };
  const queued = diagnoseFlow(base);
  assert.equal(queued.state, 'queued'); assert.equal(queued.approval.waiting, 5);
  assert.equal(diagnoseFlow({ ...base, board: { ...board, items: [{ agent: 'buyer', status: 'none' }] } }).state, 'idle');
  assert.equal(diagnoseFlow({ ...base, job: { type: 'buyer' }, log: [{ at: ago(2) }] }).state, 'running');
  const missed = diagnoseFlow({ ...base, health: { lastTickAt: ago(STALL_MIN + 10) } });
  assert.equal(missed.state, 'stalled'); assert.equal(missed.stall.kind, 'missed');
  const stuck = diagnoseFlow({ ...base, job: { type: 'production' }, log: [{ at: ago(STALL_MIN + 5) }] });
  assert.equal(stuck.stall.kind, 'stuck');
  const err = diagnoseFlow({ ...base, health: { lastTickAt: ago(5), pausedUntil: new Date(nowMs + 3600000).toISOString(), lastError: 'API' } });
  assert.equal(err.state, 'error');
  assert.equal(diagnoseFlow({ ...base, health: { lastTickAt: ago(5), blocked: { kind: 'budget', reason: '予算' } } }).stall.kind, 'budget');
  assert.equal(diagnoseFlow({ ...base, paused: { on: true } }).stall.kind, 'paused');
  assert.equal(diagnoseFlow({ board }).stall.kind, 'never');
});
