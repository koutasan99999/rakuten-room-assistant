import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import router, { ROUTES } from '../api/[route].js';

// Vercel の無料プラン（Hobby）は、サーバーの関数（api/ の .js）が12個まで。超えるとデプロイが失敗して、本番が古いままになる
test('api/ の関数は12個以下（Vercelの無料プランの上限）', () => {
  const files = readdirSync(new URL('../api/', import.meta.url)).filter((f) => /\.(js|mjs|cjs|ts)$/.test(f));
  assert.ok(files.length <= 12, files.join(', '));
});

test('server/ のAPIは、すべて api/[route].js から呼べる', () => {
  const names = readdirSync(new URL('../server/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
  assert.deepEqual(Object.keys(ROUTES).sort(), names.sort());
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(v.functions).every((k) => k.startsWith('api/')));
});

async function call(url, query) {
  const req = { method: 'GET', url, query, headers: { host: 'x.app' } };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await router(req, res);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('api/[route].js：URLのAPI名で呼び分ける。ないAPIは404', async () => {
  const r = await call('/api/radar', { route: 'radar' });
  assert.equal(r.status, 200);
  assert.ok(r.data.genres.length > 10);
  const t = await call('/api/trends?x=1', {}); // query が無いときは URL から
  assert.equal(t.status, 200);
  assert.ok(t.data.genres.length > 5);
  assert.equal((await call('/api/nope', { route: 'nope' })).status, 404);
  assert.equal((await call('/api/__proto__', { route: '__proto__' })).status, 404);
});
