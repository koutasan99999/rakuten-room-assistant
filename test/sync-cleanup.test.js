// 同期の大量の競合の根本対策と、データの整理（2026-11-15）
//   ・点検や棚の入れ替えで更新番号が上がっただけ（中身は同じ）なら、端末の修正は競合にしない
//   ・まだ誰も判断していない投稿セットへの判断は、番号が違っても競合にしない
//   ・本当にほかで中身が変わっていたら、今までどおり競合（書けなかった中身は残す）
//   ・整理は消さずに「整理済み」へ移す。投稿済み・採用・却下は残す。確認なしでは何も変えない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { memoryKv } from '../lib/kv.js';
import * as S from '../lib/store.js';
import data from '../server/data.js';
import { backlog } from '../lib/worker.js';

const set = (id, extra = {}) => ({ id, title: `企画 ${id}`, items: [{ name: '商品', price: 1000, code: `c:${id}` }], createdAt: '2026-11-14T00:00:00Z', ...extra });

test('点検で番号が上がっただけなら、端末の修正（baseDigest つき）は競合にしない。点検の記録も消さない', async () => {
  const kv = memoryKv();
  const { rec } = await S.create(kv, { id: 'a', set: set('a') });
  const base = S.digest(rec.set);
  await S.update(kv, 'a', 1, { set: { ...rec.set, inspection: { at: 'x', problems: [] } }, by: 'server:棚の点検' });
  const r = await S.update(kv, 'a', 1, { set: set('a', { title: '社長の修正' }), baseDigest: base, by: 'device:A' });
  assert.equal(r.rev, 3); assert.equal(r.set.title, '社長の修正');
  assert.ok(r.set.inspection, 'サーバーだけの点検の記録は残る');
});

test('ほかで中身が本当に変わっていたら競合（書けなかった中身は残す）', async () => {
  const kv = memoryKv();
  const { rec } = await S.create(kv, { id: 'b', set: set('b') });
  const base = S.digest(rec.set);
  await S.update(kv, 'b', 1, { set: set('b', { title: '端末Bの修正' }), by: 'device:B' });
  await assert.rejects(S.update(kv, 'b', 1, { set: set('b', { title: '端末Aの修正' }), baseDigest: base }), (e) => e instanceof S.ConflictError);
  assert.equal((await S.get(kv, 'b')).set.title, '端末Bの修正');
  assert.equal((await S.conflicts(kv, 'b'))[0].set.title, '端末Aの修正');
  await assert.rejects(S.update(kv, 'b', 1, { set: set('b', { title: 'C' }) }), (e) => e instanceof S.ConflictError, 'baseDigest が無ければ今までどおり');
});

test('判断：まだ誰も判断していなければ番号が違っても通る。別の判断が先に入っていたら競合', async () => {
  const kv = memoryKv();
  await S.create(kv, { id: 'c', set: set('c'), state: 'ready' });
  await S.update(kv, 'c', 1, { set: { ...set('c'), inspection: { at: 'x' } }, by: 'server:棚の点検' });
  const r = await S.decide(kv, 'c', 1, { action: 'approve' });
  assert.equal(r.state, 'approved');
  await S.create(kv, { id: 'd', set: set('d'), state: 'ready' });
  await S.decide(kv, 'd', 1, { action: 'reject', reason: '合わない' });
  await assert.rejects(S.decide(kv, 'd', 1, { action: 'approve' }), (e) => e instanceof S.ConflictError);
});

test('整理：確認（confirm）が無ければ件数だけ。確認後は公開待ち・控え・期限切れだけを整理済みへ移し、投稿済み・採用・却下は残す', async () => {
  const kv = memoryKv();
  const env = { APP_PASSCODE: 'pw', __kv: kv };
  const call = async (body) => { const req = { method: 'POST', url: '/api/data', headers: { 'x-app-passcode': 'pw' }, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await data(req, res, env); return { status: res.statusCode, data: JSON.parse(res.body) }; };
  await S.create(kv, { id: 'r1', set: set('r1'), state: 'ready' });
  await S.create(kv, { id: 's1', set: set('s1'), state: 'shelf' });
  await S.create(kv, { id: 'e1', set: set('e1'), state: 'expired' });
  await S.create(kv, { id: 'ap', set: set('ap'), state: 'approved' });
  await S.create(kv, { id: 'pb', set: set('pb'), state: 'published' });
  await S.create(kv, { id: 'rj', set: set('rj', { rejectReason: '画像に商品が無い' }), state: 'rejected' });
  await kv.setJson('worker:cover:wait', [{ id: 'w1' }]);
  const exp = await call({ action: 'export' });
  assert.equal(exp.data.records.length, 6, 'バックアップは全件');
  const dry = await call({ action: 'cleanup' });
  assert.deepEqual(dry.data.targets.map((t) => t.id).sort(), ['e1', 'r1', 's1']);
  assert.deepEqual(dry.data.keep.map((t) => t.id).sort(), ['ap', 'pb', 'rj']);
  assert.equal((await S.get(kv, 'r1')).state, 'ready', '確認前は何も変えない');
  assert.equal(((await kv.getJson('worker:cover:wait')) || []).length, 1);
  const run = await call({ action: 'cleanup', confirm: true });
  assert.deepEqual(run.data.moved.sort(), ['e1', 'r1', 's1']);
  for (const id of ['r1', 's1', 'e1']) { const r = await S.get(kv, id); assert.equal(r.state, 'archived'); assert.ok(r.set.items.length, '中身は消さない'); }
  assert.equal((await S.get(kv, 'rj')).set.rejectReason, '画像に商品が無い', '却下の理由は残る');
  assert.equal((await S.get(kv, 'pb')).state, 'published');
  assert.equal(((await kv.getJson('worker:cover:wait')) || []).length, 0);
  assert.equal((await kv.listJson('worker:cover:archived', 0))[0].items[0].id, 'w1', '表紙画像待ちも消さずに保管');
  const back = await call({ action: 'unarchive', id: 'r1' });
  assert.equal(back.data.rec.state, 'shelf', '整理は取り消せる');
});

test('整理のあと：それより前に見つけた合格候補は、制作に使わない（記録は残す）', async () => {
  const kv = memoryKv();
  const cand = (code) => ({ status: 'pass', versions: [{ data: { code, name: 'n', motive: 'fix' } }] });
  await kv.pushJson('worker:results:buyer', { at: '2026-11-10T00:00:00Z', candidates: [cand('old:1')] }, 0);
  const before = await backlog(kv, {});
  await kv.set('worker:stock:cutoff', '2026-11-15T00:00:00Z');
  const after = await backlog(kv, {});
  assert.ok(after.length <= before.length);
  assert.ok(!after.some((x) => JSON.stringify(x).includes('old:1')), '整理より前の候補は使わない');
  assert.equal((await kv.listJson('worker:results:buyer', 0)).length, 1, '記録は消さない');
});

// ---- 端末側：自動解決・まとめ・整理 ----
function load(seed) {
  const data = {}; Object.entries(seed).forEach(([k, v]) => { data[k] = JSON.stringify(v); });
  const localStorage = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
  const ctx = { console, JSON, Object, Array, Promise, String, Number, Math, Date, Error, localStorage, setTimeout: () => 0, setInterval: () => 0, document: { hidden: false, addEventListener() {} }, AppKit: { showToast() {}, postJson: async () => ({ status: 200, data: { configured: true, sets: [] } }) } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/delivery-store.js', import.meta.url), 'utf8'), ctx);
  return { D: ctx.DeliveryStore, data };
}
const lset = (id, extra = {}) => ({ id, title: `企画${id}`, status: 'new', items: [{ name: 'n', code: `c:${id}` }], ...extra });

test('端末：安全な同期の問題は自動で解決（中身が同じ・判断が反映済み・未判断なら判断を送り直す）。残りは違いの種類ごとにまとめる。控えは消さない', () => {
  const sets = {
    same: lset('same', { _server: { rev: 5 } }),
    done: lset('done', { status: 'adopted', _server: { rev: 3, decision: { action: 'approve' } } }),
    free: lset('free', { status: 'new', _server: { rev: 4, decision: null } }),
    diff1: lset('diff1', { title: 'サーバーの題', _server: { rev: 2 } }),
    diff2: lset('diff2', { title: 'サーバーの題2', _server: { rev: 2 } })
  };
  const conflicts = [
    { at: 't1', id: 'same', kind: 'put', local: lset('same', { status: 'new', _server: { rev: 1 }, inspection: { at: 'x' } }) },
    { at: 't2', id: 'done', kind: 'decide', decision: 'approve' },
    { at: 't3', id: 'free', kind: 'decide', decision: 'reject', reason: '合わない' },
    { at: 't4', id: 'diff1', kind: 'put', local: lset('diff1', { title: '端末の題' }) },
    { at: 't5', id: 'diff2', kind: 'put', local: lset('diff2', { title: '端末の題2' }) }
  ];
  const { D } = load({ 'room-delivery': { sets, history: [], outbox: [], conflicts } });
  const done = D.autoResolve();
  assert.equal(done.map((x) => x.id).sort().join(','), 'done,free,same');
  assert.ok(D.outbox().some((o) => o.op === 'decide' && o.id === 'free' && o.decision === 'reject'), '未判断なら社長の判断を送り直す');
  const g = D.conflictGroups();
  assert.equal(g.length, 1, 'タイトルの違い2件は1つのまとまり'); assert.equal(g[0].items.length, 2);
  assert.equal(D.conflicts().length, 2, '残りは2件');
});

test('端末：整理はこの端末にしか無い未投稿だけを整理済みにする（消さない・送る予定から外す・画面に出さない）', () => {
  const sets = { loc: lset('loc'), srv: lset('srv', { _server: { rev: 1 } }), pub: lset('pub', { status: 'adopted' }) };
  const { D, data } = load({ 'room-delivery': { sets, history: [], outbox: [{ op: 'import', id: 'loc', at: 'a' }], conflicts: [] } });
  assert.equal(D.localOnlyCount(), 1);
  assert.equal(D.archiveLocal(), 1);
  const st = JSON.parse(data['room-delivery']);
  assert.equal(st.sets.loc.status, 'archived'); assert.ok(st.sets.loc.items.length, '中身は残る');
  assert.equal(st.outbox.length, 0, '古い端末のデータをサーバーへ送り直さない');
  assert.ok(!D.all().some((x) => x.id === 'loc'), '画面には出さない');
  assert.ok(D.all({ archived: true }).some((x) => x.id === 'loc'));
  assert.equal(st.sets.pub.status, 'adopted', '採用は残す');
});
