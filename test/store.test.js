// サーバーの正本（段階1）：更新番号による楽観的排他制御・冪等な移行・棚（公開待ち3件＋控え6件）・状態の移り変わり・API
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import * as S from '../lib/store.js';
import data from '../server/data.js';

const set = (id, extra = {}) => ({ id, title: `企画 ${id}`, items: [{ name: '商品', price: 1000, code: `c:${id}` }], createdAt: new Date().toISOString(), ...extra });

test('楽観的排他制御：読んだときの更新番号が今と違えば書かずに競合を返し、書けなかった内容は捨てずに残す', async () => {
  const kv = memoryKv();
  const { rec } = await S.create(kv, { id: 'a1', set: set('a1') });
  assert.equal(rec.rev, 1);
  const r2 = await S.update(kv, 'a1', 1, { set: set('a1', { title: '端末Aの修正' }), by: 'device:A' });
  assert.equal(r2.rev, 2);
  // 端末Bは古い番号（1）のまま書こうとする → 競合
  await assert.rejects(S.update(kv, 'a1', 1, { set: set('a1', { title: '端末Bの修正' }), by: 'device:B' }), (e) => e instanceof S.ConflictError && e.current.rev === 2);
  assert.equal((await S.get(kv, 'a1')).set.title, '端末Aの修正', '先に書いた方が残る');
  const c = await S.conflicts(kv, 'a1');
  assert.equal(c[0].set.title, '端末Bの修正', '書けなかった内容も残す（データを失わない）');
  assert.equal(c[0].expectedRev, 1); assert.equal(c[0].currentRev, 2);
});

test('同時の書き込み：同じ更新番号で同時に書いても、通るのは1つだけ（番号が飛ばない）', async () => {
  const kv = memoryKv();
  await S.create(kv, { id: 'b1', set: set('b1') });
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => S.update(kv, 'b1', 1, { set: set('b1', { title: `同時${n}` }), by: `device:${n}` })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason instanceof S.ConflictError).length, 4);
  assert.equal((await S.get(kv, 'b1')).rev, 2);
});

test('状態の移り変わり：許されない移り変わりは断る。社長の判断は更新番号つきで記録する', async () => {
  const kv = memoryKv();
  await S.create(kv, { id: 'c1', set: set('c1'), state: 'ready' });
  const r = await S.decide(kv, 'c1', 1, { action: 'reject', reason: '方向が違う' });
  assert.equal(r.state, 'rejected'); assert.equal(r.decision.reason, '方向が違う');
  await assert.rejects(S.update(kv, 'c1', r.rev, { state: 'published' }), S.StateError, '却下から公開はできない');
  await assert.rejects(S.decide(kv, 'c1', 1, { action: 'approve' }), S.ConflictError, '古い番号では判断できない');
  assert.ok((await S.meta(kv)).lastOwnerDecisionAt);
});

test('移行：端末の投稿セットを取り込む。何度送っても増えない。サーバーの判断を古い端末のデータで上書きしない。状態を読み替える', async () => {
  const kv = memoryKv();
  const local = [
    { ...set('s1'), status: 'new' },
    { ...set('s2'), status: 'adopted', decidedAt: '2026-11-10T00:00:00Z', reason: '' },
    { ...set('s3'), status: 'rejected', reason: '日用品' },
    { ...set('s4'), status: 'adopted', igPost: { url: 'https://www.instagram.com/p/X/' } },
    { ...set('s5'), status: 'new', supersededBy: 's1' },
    { id: '', status: 'new' }
  ];
  const r1 = await S.importSets(kv, local, { deviceId: 'iphone' });
  assert.equal(r1.created.length, 5); assert.equal(r1.invalid.length, 1);
  const byId = Object.fromEntries((await S.list(kv)).map((x) => [x.id, x]));
  assert.equal(byId.s1.state, 'shelf'); assert.equal(byId.s2.state, 'approved'); assert.equal(byId.s3.state, 'rejected'); assert.equal(byId.s4.state, 'published'); assert.equal(byId.s5.state, 'expired');
  assert.equal(byId.s1.set.status, undefined, '端末の status は中身に混ぜない（state が正本）');
  // サーバー側で社長が s1 を却下したあと、古い端末がもう一度送っても上書きしない
  await S.update(kv, 's1', byId.s1.rev, { state: 'ready', by: 'server' });
  const cur = await S.get(kv, 's1');
  await S.decide(kv, 's1', cur.rev, { action: 'reject' });
  const r2 = await S.importSets(kv, local, { deviceId: 'old-iphone' });
  assert.equal(r2.created.length, 0); assert.equal(r2.skipped.length, 5);
  assert.equal((await S.get(kv, 's1')).state, 'rejected');
  // 読み戻しの照合
  assert.deepEqual(await S.verify(kv, ['s1', 's2', 'zz']), { ok: false, total: 3, missing: ['zz'] });
  assert.equal((await S.verify(kv, ['s1', 's2', 's3', 's4', 's5'])).ok, true);
});

test('棚：公開待ちは最大3件（点数の高い順に繰り上げ）。控えは最大6件（超えた分・14日たった分は期限切れへ。消さない）', async () => {
  const kv = memoryKv();
  const old = new Date(Date.now() - 20 * 86400000).toISOString();
  for (let i = 1; i <= 11; i++) await S.create(kv, { id: `n${i}`, set: set(`n${i}`, { createdAt: i === 11 ? old : new Date(Date.now() - i * 60000).toISOString() }), score: 70 + i, state: 'shelf' });
  const changes = await S.rebalance(kv);
  const c = await S.counts(kv);
  assert.equal(c.ready, 3); assert.equal(c.shelf, 6); assert.equal(c.expired, 2);
  const ready = (await S.list(kv, { states: ['ready'] })).map((x) => x.id).sort();
  assert.deepEqual(ready, ['n10', 'n8', 'n9'], '14日たった n11 は点数が高くても期限切れ。残りの上位3件が公開待ち');
  assert.equal((await S.get(kv, 'n11')).state, 'expired');
  assert.ok(changes.length >= 5);
  assert.equal((await S.list(kv)).length, 11, '何も消さない');
  assert.deepEqual(await S.capacity(kv), { ...c, unpublished: 9, room: 0 });
});

test('API：/api/data は合言葉が必要。競合は409と今の中身を返す。移行・照合・一覧・判断', async () => {
  const kv = memoryKv();
  const env = { APP_PASSCODE: 'pw', __kv: kv };
  const call = async (body, headers = { 'x-app-passcode': 'pw' }) => { const req = { method: 'POST', url: '/api/data', headers, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await data(req, res, env); return { status: res.statusCode, data: JSON.parse(res.body) }; };
  assert.equal((await call({ action: 'list' }, {})).status, 401);
  const imp = await call({ action: 'import', deviceId: 'A', sets: [{ ...set('d1'), status: 'new' }] });
  assert.equal(imp.data.created.length, 1);
  assert.equal((await call({ action: 'verify', ids: ['d1'] })).data.ok, true);
  const l = await call({ action: 'list' });
  assert.equal(l.data.sets[0].id, 'd1'); assert.equal(l.data.limits.ready, 3);
  assert.equal(l.data.sets[0].state, 'ready', '取り込んだあと棚の整理で公開待ちへ');
  const rev = l.data.sets[0].rev;
  const put = await call({ action: 'put', id: 'd1', expectedRev: rev, set: { ...set('d1'), title: 'A' }, deviceId: 'A' });
  assert.equal(put.data.rec.rev, rev + 1);
  const stale = await call({ action: 'put', id: 'd1', expectedRev: rev, set: { ...set('d1'), title: 'B' }, deviceId: 'B' });
  assert.equal(stale.status, 409); assert.equal(stale.data.current.rev, rev + 1); assert.equal(stale.data.current.set.title, 'A');
  const bad = await call({ action: 'decide', id: 'd1', expectedRev: rev + 1, decision: 'publish' });
  assert.equal(bad.status, 400);
  assert.equal((await call({ action: 'decide', id: 'd1', expectedRev: rev + 1, decision: 'approve' })).data.rec.state, 'approved');
  assert.equal((await call({ action: 'list' }, { 'x-app-passcode': 'pw' })).data.capacity.approved, 1);
  assert.equal((await data({ method: 'POST', headers: {}, body: { action: 'list' } }, { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }, {})) , undefined);
});

test('公開の接続テストの準備：/api/ig の readiness は、必要な設定の有無（名前だけ）を返し、投稿はしない', async () => {
  const ig = (await import('../server/ig.js')).default;
  const call = async (env) => { const req = { method: 'POST', url: '/api/ig', headers: {}, body: { action: 'readiness' } }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await ig(req, res, env); return JSON.parse(res.body); };
  const r = await call({ KV_REST_API_URL: 'https://kv', IG_ACCESS_TOKEN: '' });
  assert.equal(r.readiness, true);
  assert.deepEqual(r.missing, ['IG_ACCESS_TOKEN', 'IG_PUBLISH_ENABLED']);
  assert.ok(!JSON.stringify(r).includes('https://kv'), '値は出さない');
  assert.match(r.imagePipeline, /未実装/);
});
