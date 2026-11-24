// 2026-11-24 KOT-13：新規ROOM商品紹介の停止（既定で停止・社長の明示の再開だけで解除）
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { withUsage } from '../lib/ai-usage.js';
import * as V from '../lib/v2/company.js';
import v2api from '../server/v2.js';
import { installFetchMock, aiReply } from './mock.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', APP_PASSCODE: 'pw' };
const run = (kv) => withUsage(() => V.tick({ kv, env: ENV, origin: 'https://x.app', startedAt: Date.now(), trigger: 'test' }));
const call = async (kv, body) => { const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await v2api({ method: 'POST', url: '/api/v2', headers: { 'x-app-passcode': 'pw' }, body }, res, { ...ENV, __kv: kv }); return { status: res.statusCode, data: JSON.parse(res.body) }; };

test('既定で停止：保存が無くても・壊れていても停止。自動では解除しない', async () => {
  const kv = memoryKv();
  assert.equal((await V.roomStopState(kv)).stopped, true);
  await kv.set('v2:room:stop', '{壊れた');
  assert.equal((await V.roomStopState(kv)).stopped, true);
  await kv.setJson('v2:room:stop', { on: false }); // 確認の言葉・社長の操作が無い解除は認めない
  assert.equal((await V.roomStopState(kv)).stopped, true);
  await kv.setJson('v2:room:stop', { on: false, by: 'auto', confirm: '再開する' });
  assert.equal((await V.roomStopState(kv)).stopped, true);
});

test('停止中：新しい案件を始めず、作りかけの紹介は消さずに「停止中」で保存し、AIを呼ばない。新商品の探索もしない。社長の修正依頼は進む', async () => {
  mock = installFetchMock({ rakuten: () => new Response(JSON.stringify({ Items: [] })), openai: () => aiReply({}) });
  const kv = memoryKv();
  await kv.setJson('v2:pr:state', { sitesAt: new Date().toISOString(), siteChecks: Object.fromEntries(Object.keys((await import('../lib/ig-discovery.js')).OFFICIAL_SITES).map((b) => [b, new Date().toISOString()])) });
  await kv.setJson(V.V2_KEYS.cases, [{ id: 'a', kind: 'make', step: 'find', createdAt: new Date().toISOString(), attempts: 0, runs: [], wait: null, data: { theme: '企画A', keyword: '企画A' } }, { id: 'b', kind: 'make', step: 'copy', createdAt: new Date().toISOString(), attempts: 0, runs: [], wait: { kind: 'retry', until: new Date(Date.now() - 1000).toISOString() }, data: { theme: '企画B' } }]);
  const r = await run(kv);
  assert.equal(r.roomStopped, true);
  assert.ok(!(r.steps || []).some((x) => /planner:propose|buyer:find|writer:copy|buyer:scout/.test(x)), `紹介の工程を進めない：${r.steps}`);
  const cases = await kv.getJson(V.V2_KEYS.cases);
  assert.equal(cases.length, 2, '消さない');
  assert.ok(cases.every((c) => c.wait && c.wait.kind === 'stopped'));
  assert.equal(cases.find((c) => c.id === 'b').wait.prev.kind, 'retry', '元の待ちを覚えておく');
  assert.match((await V.findWork('buyer', { kv, env: ENV, cases })).none, /停止中/);
  const st = await V.officeState(kv, ENV);
  assert.equal(st.roomStop.stopped, true);
  assert.equal(st.summary.stopped, 2);
  assert.match(st.idle, /停止中/);
  // 2回目も同じ（増えない・二重に記録しない）
  await run(kv);
  assert.equal((await kv.getJson(V.V2_KEYS.cases)).length, 2);
});

test('再開は社長の明示の操作だけ（確認の言葉が違えば再開しない）。再開すると止めていた案件は元の待ちに戻って続きから', async () => {
  mock = installFetchMock({ rakuten: () => new Response(JSON.stringify({ Items: [] })), openai: () => aiReply({}) });
  const kv = memoryKv();
  await kv.setJson(V.V2_KEYS.cases, [{ id: 'b', kind: 'make', step: 'copy', createdAt: new Date().toISOString(), attempts: 0, runs: [], wait: { kind: 'stopped', why: 'x', prev: { kind: 'slot', why: '枠待ち' } }, data: { theme: '企画B' } }]);
  assert.equal((await call(kv, { action: 'roomResume', confirm: 'はい' })).status, 400);
  assert.equal((await V.roomStopState(kv)).stopped, true);
  const r = await call(kv, { action: 'roomResume', confirm: '再開する' });
  assert.equal(r.status, 200); assert.equal(r.data.roomStop.stopped, false);
  await run(kv);
  const c = (await kv.getJson(V.V2_KEYS.cases))[0];
  assert.ok(!c.wait || c.wait.kind !== 'stopped', '停止中ではなくなり、続きから進む（元は枠待ち）');
  assert.equal((await call(kv, { action: 'roomStop' })).data.roomStop.stopped, true, '社長はいつでも止め直せる');
});
