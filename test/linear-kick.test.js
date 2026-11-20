// 2026-11-20 Linear → Claude Code の定期実行の起動役（QStash → /api/linear-kick → GitHub の workflow_dispatch）
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { memoryKv } from '../lib/kv.js';
import handler, { decide } from '../server/linear-kick.js';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function qsig(key, { sub = 'https://x.app/api/linear-kick', body = '' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: 'Upstash', sub, exp: now + 300, nbf: now - 1, iat: now, jti: 'j', body: crypto.createHash('sha256').update(body).digest('base64url') }));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', key).update(`${h}.${p}`).digest())}`;
}
const TOKEN = 'github_pat_TESTVALUE_should_never_appear_in_output_0123456789';
function fakeGitHub(runs, { dispatchStatus = 204 } = {}) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', auth: opts.headers && opts.headers.Authorization });
    if (String(url).endsWith('/dispatches')) return new Response(null, { status: dispatchStatus });
    return new Response(JSON.stringify({ workflow_runs: runs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { f, calls };
}
let orig = null;
afterEach(() => { if (orig) globalThis.fetch = orig; orig = null; });
const call = async (env, headers = {}, method = 'POST') => {
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler({ method, url: '/api/linear-kick', headers, rawBody: Buffer.from('') }, res, env);
  return { status: res.statusCode, data: JSON.parse(res.body), text: res.body };
};

test('起動の判断：実行中・待ちがあれば起動しない／直近4分以内の実行（GitHub の schedule を含む）があれば起動しない／無ければ main で workflow_dispatch', async () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  let g = fakeGitHub([{ run_number: 10, status: 'in_progress', event: 'schedule', created_at: '2026-11-20T09:40:00Z' }]);
  assert.match((await decide({ token: TOKEN, fetchImpl: g.f, now })).why, /実行中・待ち/);
  assert.ok(!g.calls.some((c) => c.method === 'POST'));
  g = fakeGitHub([{ run_number: 11, status: 'completed', event: 'schedule', created_at: '2026-11-20T09:57:30Z' }]);
  assert.match((await decide({ token: TOKEN, fetchImpl: g.f, now })).why, /直近4分以内/);
  g = fakeGitHub([{ run_number: 12, status: 'completed', event: 'workflow_dispatch', created_at: '2026-11-20T09:50:00Z' }]);
  const r = await decide({ token: TOKEN, fetchImpl: g.f, now });
  assert.equal(r.start, true);
  const post = g.calls.find((c) => c.method === 'POST');
  assert.match(post.url, /actions\/workflows\/linear-claude\.yml\/dispatches$/);
  g = fakeGitHub([], { dispatchStatus: 403 });
  assert.match((await decide({ token: TOKEN, fetchImpl: g.f, now })).why, /HTTP 403/);
});

test('QStash の署名が無い・違う呼び出しは断る。鍵が未設定なら何もしない。正しい呼び出しは1回だけ起動し、4分以内の再呼び出し・再送は何もしない。鍵の値は応答に出さない', async () => {
  const kv = memoryKv();
  const env = { __kv: kv, QSTASH_CURRENT_SIGNING_KEY: 'cur', QSTASH_NEXT_SIGNING_KEY: 'next' };
  assert.equal((await call(env, {})).status, 401);
  assert.equal((await call(env, { 'upstash-signature': qsig('bad') })).status, 401);
  assert.equal((await call(env, { 'upstash-signature': qsig('cur', { sub: 'https://x.app/api/worker' }) })).status, 401, '別の呼び先あての署名は使えない');
  assert.match((await call(env, { 'upstash-signature': qsig('cur') })).data.skipped, /GH_DISPATCH_TOKEN が未設定/);
  orig = globalThis.fetch;
  const g = fakeGitHub([]);
  globalThis.fetch = g.f;
  const env2 = { ...env, GH_DISPATCH_TOKEN: TOKEN };
  const r1 = await call(env2, { 'upstash-signature': qsig('cur'), 'upstash-message-id': 'm1' });
  assert.equal(r1.data.start, true);
  assert.ok(!r1.text.includes(TOKEN));
  assert.equal(g.calls.filter((c) => c.method === 'POST').length, 1);
  assert.match((await call(env2, { 'upstash-signature': qsig('cur'), 'upstash-message-id': 'm1' })).data.skipped, /再送/);
  assert.match((await call(env2, { 'upstash-signature': qsig('cur'), 'upstash-message-id': 'm2' })).data.skipped, /4分以内/);
  assert.equal(g.calls.filter((c) => c.method === 'POST').length, 1, '二重に起動しない');
  assert.equal((await kv.getJson('linear-kick:last')).start, true);
});
