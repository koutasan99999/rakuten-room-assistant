// KOT-16：AIの予算が尽きても、ROOMの新規紹介が停止中でも、0円で実際にできる仕事は止めない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { withUsage } from '../lib/ai-usage.js';
import * as V from '../lib/v2/company.js';
import { funnelProblems, funnelAuditWork, measureGapWork } from '../lib/v2/free-work.js';

const prod = (n, url = 'https://item.rakuten.co.jp/s/') => Array.from({ length: n }, (_, i) => ({ name: `商品${i}`, price: 1000 + i, url: `${url}${i}/`, room: `紹介文${i}` }));
const set = (id, extra = {}) => ({ id, title: `完成品${id}`, caption: '本文 #PR', image: { mediaId: 'm', url: '/api/media?id=m' }, products: prod(6), deliveredAt: '2026-11-20T00:00:00.000Z', ...extra });
async function seed(kv, sets, status = 'adopted') {
  for (const s of sets) await kv.setJson(`v2:set:${s.id}`, s);
  await kv.setJson('v2:sets', sets.map((s) => ({ id: s.id, title: s.title, status })));
}

test('販売導線の点検：不足と楽天以外のURLを実データから見つける。点検済みは仕事にしない', async () => {
  assert.deepEqual(funnelProblems(set('a')), []);
  assert.match(funnelProblems(set('b', { products: prod(6, 'https://example.com/') })).join(), /楽天以外のURL/);
  const kv = memoryKv();
  await seed(kv, [set('a'), set('b', { caption: '本文' })]);
  const w = await funnelAuditWork(kv);
  assert.equal(w.est, 0);
  const r = await w.run();
  assert.match(r.done, /完成品a|完成品b/);
  await (await funnelAuditWork(kv)).run();
  assert.equal(await funnelAuditWork(kv), null, '点検済みなら仕事にしない（稼働の演出をしない）');
  assert.match(JSON.stringify((await kv.getJson('v2:set:b')).funnel.problems), /PR表記/);
  await kv.setJson('v2:set:a', { ...(await kv.getJson('v2:set:a')), deliveredAt: new Date(Date.now() + 5000).toISOString() });
  assert.ok(await funnelAuditWork(kv), '納品し直したら点検し直す');
});

test('計測不足の解消案：実績の無い完成品だけ書き出す・変わらなければ作り直さない・利益は未計測のまま', async () => {
  const kv = memoryKv();
  assert.equal(await measureGapWork(kv), null, '対象が無ければ仕事にしない');
  await seed(kv, [set('a')]);
  const w = await measureGapWork(kv);
  const r = await w.run();
  assert.match(r.done, /完成品a/);
  assert.match(r.done, /利益は未計測/);
  assert.equal(await measureGapWork(kv), null);
  await kv.setJson('v2:perf', [{ id: 'p', setId: 'a', views: 10, roomClicks: 1, orders: 0, reward: 0 }]);
  assert.equal(await measureGapWork(kv), null, '登録がそろえば不足は無い');
});

test('予算が尽きていても、0円の仕事は進む（AIを使う仕事だけ止まる）', async () => {
  const kv = memoryKv();
  await seed(kv, [set('a', { caption: '本文' })]);
  await kv.setJson('v2:sets', [{ id: 'a', title: '完成品a', status: 'adopted', recheckedAt: new Date().toISOString() }]); // 楽天の確かめ直しは済み
  const env = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', __noWait: true, BUDGET_MONTHLY_YEN: '1' };
  const ym = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  await kv.set(`budget:month:${ym}`, '5'); // 今月の上限を超えている
  const r = await withUsage(() => V.tick({ kv, env, origin: 'https://app.test/', startedAt: Date.now(), trigger: 'test' }));
  assert.ok((r.steps || []).some((x) => /funnel-audit:done/.test(x)), `予算が尽きていても点検が進む：${JSON.stringify(r.steps)}`);
  assert.ok((await kv.getJson('v2:set:a')).funnel, '点検の結果が保存されている');
});
