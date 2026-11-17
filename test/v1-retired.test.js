// 1.0の運用終了（2026-11-17）：1.0の定期実行・AI社員・1.0だけのAPIを止める。2.0は止めない。データは消さない
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memoryKv } from '../lib/kv.js';
import router from '../api/[route].js';
import worker from '../server/worker.js';
import { V1_ONLY_ROUTES } from '../lib/v1-retired.js';

const saved = process.env.V1_ENABLED;
afterEach(() => { if (saved === undefined) delete process.env.V1_ENABLED; else process.env.V1_ENABLED = saved; globalThis.fetch = realFetch; });
const realFetch = globalThis.fetch;
const res = () => ({ statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } });
const ENV = { CRON_SECRET: 'sec', APP_PASSCODE: 'pw', OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', V1_ENABLED: '' };

test('1.0だけのAPIは、AI・楽天を呼ぶ前に「運用終了」と返す（OpenAIへの呼び出しが0回）', async () => {
  process.env.V1_ENABLED = '';
  let outside = 0;
  globalThis.fetch = async () => { outside += 1; throw new Error('外へは出ない'); };
  for (const name of V1_ONLY_ROUTES) {
    const r = res();
    await router({ method: 'POST', url: `/api/${name}`, query: { route: name }, headers: { 'x-app-passcode': 'pw' }, body: { action: 'x' } }, r);
    assert.equal(r.statusCode, 410, name);
    assert.match(JSON.parse(r.body).error, /運用を終了/);
  }
  assert.equal(outside, 0, 'OpenAI・楽天などへの呼び出しがない');
});

test('2.0が使うAPI（v2・worker・image・media・data）は止めない', () => {
  for (const name of ['v2', 'worker', 'image', 'media', 'data', 'kuma-master']) assert.ok(!V1_ONLY_ROUTES.has(name), name);
  // 2.0の画面が呼ぶAPIは、止めていない物だけ
  const used = new Set();
  for (const f of fs.readdirSync(new URL('../v2/', import.meta.url))) { const s = fs.readFileSync(new URL(`../v2/${f}`, import.meta.url), 'utf8'); for (const m of s.matchAll(/api\/([a-z0-9-]+)/g)) used.add(m[1]); }
  for (const name of used) assert.ok(!V1_ONLY_ROUTES.has(name), `2.0の画面が使う ${name} を止めていない`);
});

test('定期実行：QStash（1.0の番も）・手動の target=v1・Vercelの1日1回は、すべて2.0だけを動かす。1.0の途中の仕事は保存したまま「仕事中」と出さない', async () => {
  const kv = memoryKv();
  await kv.setJson('worker:job', { id: 'old', type: 'buyer', step: 'search', startedAt: '2026-11-16T00:00:00Z', attempts: 0 });
  const env = { ...ENV, __kv: kv };
  globalThis.fetch = async () => { throw new Error('外へは出ない'); };
  const call = async (body, headers) => { const r = res(); await worker({ method: 'POST', url: '/api/worker', headers: { authorization: 'Bearer sec', ...headers }, body }, r, env); return JSON.parse(r.body); };
  const a = await call({ action: 'tick', target: 'v1' }, { 'x-trigger': 'workflow_dispatch' });
  assert.equal(a.company, 'v2', '手動で v1 を選んでも2.0');
  await kv.del('worker:lock');
  const b = await call({ action: 'tick' }, { 'x-trigger': 'vercel-cron' });
  assert.equal(b.company, 'v2');
  assert.equal(await kv.get('v2:alt'), null, '1.0との交互の番を使わない');
  const st = await call({ action: 'state' }, { 'x-app-passcode': 'pw' });
  assert.equal(st.job, null, '「仕事中・途中」と出さない'); assert.equal(st.retired, true);
  assert.equal(st.stoppedJob.id, 'old', '途中だった1.0の仕事は保存したまま');
  assert.ok(await kv.getJson('worker:job'), '1.0のデータは消さない');
});

test('画面：1.0の入口は運用終了の案内。1.0の記録は閲覧用（/v1/）に残し、Vercelの1.0の定期実行は外した', () => {
  const top = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(top, /1.0は運用を終了しました/); assert.match(top, /href="v2\/"/); assert.match(top, /href="v1\/"/);
  assert.ok(!/js\/app\.js/.test(top), '入口では1.0のプログラムを動かさない');
  const v1 = fs.readFileSync(new URL('../v1/index.html', import.meta.url), 'utf8');
  assert.match(v1, /<base href="\/">/); assert.match(v1, /閲覧用/);
  const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(!(vercel.crons || []).length, 'Vercelの定期実行（1.0の実行・1.0の自動投稿）は無し（2.0はQStashで動く）');
});
