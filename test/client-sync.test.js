// アプリ側の同期（js/delivery-store.js・js/server-sync.js）の異常系：通信失敗・送れない変更・競合・合言葉・容量不足・移行の差異。
// ブラウザの代わりに vm で動かし、サーバーの応答を差し替える
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function makeLocalStorage(limit = Infinity) {
  const data = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      const size = Object.entries({ ...data, [k]: String(v) }).reduce((a, [kk, vv]) => a + kk.length + vv.length, 0);
      if (size > limit) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      data[k] = String(v);
    },
    removeItem: (k) => { delete data[k]; }
  };
}
function load({ responder, limit, seed = {} }) {
  const localStorage = makeLocalStorage(limit);
  Object.entries(seed).forEach(([k, v]) => { localStorage.data[k] = JSON.stringify(v); });
  const calls = [];
  const ctx = {
    console, JSON, Object, Array, Promise, String, Number, Math, Date, Error,
    localStorage, setTimeout: () => 0, setInterval: () => 0,
    document: { hidden: false, addEventListener() {} },
    AppKit: { showToast() {}, postJson: async (path, body) => { calls.push(body); return responder(body, calls.length); } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['../js/delivery-store.js', '../js/server-sync.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return { D: ctx.DeliveryStore, sync: ctx.ServerSync, localStorage, calls };
}
const set = (id, extra = {}) => ({ id, title: `企画${id}`, status: 'new', createdAt: '2026-11-14T00:00:00Z', items: [{ name: 'n', price: 1000, code: `c:${id}` }], ...extra });
const migrated = { 'room-data-sync': { deviceId: 'dTEST', migratedAt: '2026-11-14T00:00:00Z' } };
const listOk = (sets = []) => ({ status: 200, data: { configured: true, sets, capacity: {}, limits: {} } });
const delivery = (sets, outbox = []) => ({ 'room-delivery': { sets: Object.fromEntries(sets.map((x) => [x.id, x])), history: [], outbox, conflicts: [] } });

test('容量不足：保存できなくても既存の投稿セットは消さない。失敗を返し、成功として扱わない', () => {
  const sets = [set('a', { status: 'rejected' }), set('b', { status: 'rejected' }), set('c')];
  const seed = delivery(sets);
  const size = JSON.stringify(seed['room-delivery']).length + 'room-delivery'.length;
  const { D, localStorage } = load({ responder: () => listOk(), limit: size + 50, seed });
  const r = D.save(set('d', { caption: 'x'.repeat(5000) }));
  assert.equal(r, null, '保存できなかったら null');
  assert.match(D.lastError, /保存容量が足りません/);
  const stored = JSON.parse(localStorage.data['room-delivery']);
  assert.deepEqual(Object.keys(stored.sets).sort(), ['a', 'b', 'c'], '古い却下も含めて1件も消していない');
  assert.equal(D.decide('c', 'adopted', ''), null, '判断も保存できなければ失敗を返す（成功として扱わない）');
  assert.equal(JSON.parse(localStorage.data['room-delivery']).sets.c.status, 'new', '保存されていない判断を、保存されたことにしない');
});

test('通信失敗：送る予定は消さずに残し、次に自動で送る（回数を記録）', async () => {
  const seed = { ...migrated, ...delivery([set('a', { _server: { rev: 1, state: 'ready' } })], [{ op: 'put', id: 'a', at: 't1' }]) };
  const { D, sync } = load({ responder: () => { throw new Error('network'); }, seed });
  const r = await sync.syncData();
  assert.ok(r.error || r.ok !== true);
  const ob = D.outbox();
  assert.equal(ob.length, 1); assert.equal(ob[0].retry.count, 1);
  assert.equal(D.get('a').title, '企画a', '端末の中身はそのまま');
});

test('送れない変更（400）：無条件に消さず「送れなかった変更」として残す。もう一度送る・送らないを選べる', async () => {
  const seed = { ...migrated, ...delivery([set('a', { _server: { rev: 1, state: 'ready' } })], [{ op: 'decide', id: 'a', at: 't1', decision: 'approve', reason: '' }]) };
  let mode = 400;
  const { D, sync, calls } = load({ responder: (b) => (b.action === 'list' ? listOk() : mode === 400 ? { status: 400, data: { error: '「ready」から「approved」には変えられません' } } : { status: 200, data: { rec: { id: 'a', rev: 2, state: 'approved', set: set('a') } } }), seed });
  const r = await sync.syncData();
  assert.match(r.notes.join(' '), /送れなかった変更/);
  let ob = D.outbox();
  assert.equal(ob.length, 1, '消していない'); assert.equal(ob[0].blocked.status, 400);
  const before = calls.length;
  await sync.syncData();
  assert.equal(calls.filter((b) => b.action === 'decide').length, 1, '直すまで自動では送り直さない');
  mode = 200;
  await sync.retryOp(ob[0]);
  assert.equal(D.outbox().length, 0); assert.equal(D.get('a').status, 'adopted');
  assert.ok(calls.length > before);
});

test('競合（409）：この端末の中身・判断を「同期の問題」に残してから最新に入れ替える。あとで端末の中身に戻せる', async () => {
  const local = set('a', { titleEdit: '端末の修正', _server: { rev: 1, state: 'ready' } });
  const seed = { ...migrated, ...delivery([local], [{ op: 'put', id: 'a', at: 't1' }]) };
  let current = { id: 'a', rev: 3, state: 'ready', set: set('a', { titleEdit: 'ほかの端末の修正' }) };
  // サーバー役：更新番号が合えば書き、合わなければ409
  const { D, sync, calls } = load({ responder: (b) => {
    if (b.action === 'put') { if (b.expectedRev !== current.rev) return { status: 409, data: { conflict: true, current } }; current = { ...current, rev: current.rev + 1, set: b.set }; return { status: 200, data: { rec: current } }; }
    return listOk([current]);
  }, seed });
  const r = await sync.syncData();
  assert.match(r.notes.join(' '), /最新の内容に入れ替えました/);
  assert.equal(D.get('a').titleEdit, 'ほかの端末の修正');
  const cs = D.conflicts();
  assert.equal(cs.length, 1); assert.equal(cs[0].local.titleEdit, '端末の修正', '端末の中身を残す');
  // 社長が「この端末の中身で上書き」を選ぶ → 今の更新番号（3）で送る
  assert.equal(D.restoreConflict(cs[0].at), true);
  await sync.syncData();
  const put2 = calls.filter((b) => b.action === 'put').pop();
  assert.equal(put2.expectedRev, 3); assert.equal(put2.set.titleEdit, '端末の修正');
  assert.equal(D.get('a').titleEdit, '端末の修正');
  assert.equal(D.conflicts().length, 0);
});

test('合言葉の問題（401・503）：送る予定を消さずに止める', async () => {
  for (const status of [401, 503]) {
    const seed = { ...migrated, ...delivery([set('a', { _server: { rev: 1, state: 'ready' } })], [{ op: 'put', id: 'a', at: 't1' }, { op: 'decide', id: 'a', at: 't2', decision: 'reject' }]) };
    const { D, sync } = load({ responder: () => ({ status, data: { error: 'x' } }), seed });
    await sync.syncData();
    assert.equal(D.outbox().length, 2, `${status}：2件とも残る`);
  }
});

test('移行：サーバーと中身が違う投稿セットがあれば、黙って移行済みにしない。端末の中身を控えに残し、端末のデータは消さない', async () => {
  const seed = delivery([set('a'), set('b')]);
  const { D, sync, localStorage } = load({ seed, responder: (b) => {
    if (b.action === 'import') return { status: 200, data: { configured: true, created: ['a'], same: [], different: [{ id: 'b', why: '中身が違う' }] } };
    if (b.action === 'verify') return { status: 200, data: { matched: 1, missing: [], different: [{ id: 'b', why: '中身が違う' }] } };
    return listOk([{ id: 'a', rev: 1, state: 'ready', set: set('a') }, { id: 'b', rev: 2, state: 'ready', set: set('b', { title: 'サーバーの中身' }) }]);
  } });
  const r = await sync.syncData();
  const meta = JSON.parse(localStorage.data['room-data-sync']);
  assert.equal(meta.migratedAt, undefined, '移行済みにしない');
  assert.equal(meta.migrationIssue.different[0].id, 'b');
  assert.match(r.notes.join(' '), /違う投稿セットが 1件/);
  assert.equal(D.conflicts()[0].local.title, '企画b', '端末の中身を控えに残す');
  assert.equal(D.all().length, 2, '端末の投稿セットは消さない');
});

test('移行の失敗（サーバーに届かない）：元のデータはそのまま、理由を返す', async () => {
  const seed = delivery([set('a'), set('b')]);
  const before = JSON.stringify(seed['room-delivery']);
  const { sync, localStorage } = load({ seed, responder: () => ({ status: 500, data: { error: '保存場所のエラー' } }) });
  const r = await sync.syncData();
  assert.match(r.error, /移行できませんでした.*500.*端末のデータはそのまま/);
  assert.equal(localStorage.data['room-delivery'], before);
  assert.equal(JSON.parse(localStorage.data['room-data-sync']).migratedAt, undefined);
});
