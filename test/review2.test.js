// PR #91 再レビュー（2026-11-14）の5項目：修正前に失敗し、修正後に成功することを確かめるテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { memoryKv } from '../lib/kv.js';
import * as S from '../lib/store.js';

// ---- アプリ側（vm で js/delivery-store.js・js/server-sync.js を動かす） ----
function makeLocalStorage() { const data = {}; return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } }; }
function load({ responder, seed = {} }) {
  const localStorage = makeLocalStorage();
  Object.entries(seed).forEach(([k, v]) => { localStorage.data[k] = JSON.stringify(v); });
  const calls = [];
  const ctx = { console, JSON, Object, Array, Promise, String, Number, Math, Date, Error, localStorage, setTimeout: () => 0, setInterval: () => 0, document: { hidden: false, addEventListener() {} }, AppKit: { showToast() {}, postJson: async (p, b) => { calls.push(b); return responder(b); } } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ['../js/delivery-store.js', '../js/server-sync.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return { D: ctx.DeliveryStore, sync: ctx.ServerSync, calls, localStorage };
}
const set = (id, extra = {}) => ({ id, title: `企画${id}`, status: 'new', createdAt: '2026-11-14T00:00:00Z', items: [{ name: 'n', price: 1000, code: `c:${id}` }], ...extra });
const migrated = { 'room-data-sync': { deviceId: 'dT', migratedAt: '2026-11-14T00:00:00Z' } };
const listOk = (sets = []) => ({ status: 200, data: { configured: true, sets, capacity: {}, limits: {} } });

test('1. 未送信の変更：件数の上限で消さない（送信の成功か、社長の明示的な破棄まで残す）', () => {
  const sets = Array.from({ length: 260 }, (_, i) => set(`a${i}`, { _server: { rev: 1, state: 'ready' } }));
  const { D } = load({ responder: () => listOk(), seed: { 'room-delivery': { sets: Object.fromEntries(sets.map((x) => [x.id, x])), history: [], outbox: [], conflicts: [] } } });
  sets.forEach((x) => D.decide(x.id, 'rejected', ''));
  assert.equal(D.outbox().length, 260, '260件の判断がすべて残る');
});

test('2. 競合の記録：未解決のものは件数にかかわらず残す。整理できるのは解決済みだけ', () => {
  const { D } = load({ responder: () => listOk(), seed: { 'room-delivery': { sets: { a: set('a') }, history: [], outbox: [], conflicts: [] } } });
  for (let i = 0; i < 45; i++) D.addConflict({ id: 'a', kind: 'put', local: set('a', { titleEdit: `修正${i}` }) });
  assert.equal(D.conflicts().length, 45, '未解決45件がすべて残る');
  const first = D.conflicts()[0];
  D.removeConflict(first.at); // 「サーバーの内容のままにする」＝解決済み
  assert.equal(D.conflicts().length, 44, '未解決の一覧から外れる');
  assert.ok(D.conflicts({ all: true }).some((c) => c.at === first.at && c.resolved), '解決済みとして記録は残る（あとで整理してよいのは解決済みだけ）');
});

test('3. 競合の復旧：サーバーへの書き込みが成功するまで原本を消さない。再競合・通信切断・送れない変更でも復旧できる', async () => {
  const local = set('a', { titleEdit: '端末の修正', _server: { rev: 1, state: 'ready' } });
  let current = { id: 'a', rev: 3, state: 'ready', set: set('a', { titleEdit: 'サーバーの修正' }) };
  let mode = 'conflict-again';
  const { D, sync } = load({ seed: { ...migrated, 'room-delivery': { sets: { a: local }, history: [], outbox: [], conflicts: [] } }, responder: (b) => {
    if (b.action !== 'put') return listOk([current]);
    if (mode === 'offline') throw new Error('network');
    if (mode === 'bad') return { status: 400, data: { error: '中身が正しくありません' } };
    if (mode === 'conflict-again') { current = { ...current, rev: current.rev + 1, set: set('a', { titleEdit: 'さらに別の修正' }) }; return { status: 409, data: { conflict: true, current } }; }
    if (b.expectedRev !== current.rev) return { status: 409, data: { conflict: true, current } };
    current = { ...current, rev: current.rev + 1, set: b.set }; return { status: 200, data: { rec: current } };
  } });
  D.addConflict({ id: 'a', kind: 'put', local: { ...local } });
  const c = D.conflicts()[0];
  // (1) 復旧を始めても、原本はすぐには消えない
  assert.equal(D.restoreConflict(c.at), true);
  assert.equal(D.conflicts().length, 1, '書き込みの成功を確かめるまで残る');
  // (2) 再競合：原本は残り、もう一度選べる
  await sync.syncData();
  assert.equal(D.conflicts().length, 1); assert.equal(D.conflicts()[0].local.titleEdit, '端末の修正');
  assert.notEqual(D.conflicts()[0].restoring, true, '復旧中の印は外れ、もう一度選べる');
  // (3) 通信切断：原本も送る予定も残る
  mode = 'offline';
  D.restoreConflict(D.conflicts()[0].at);
  await sync.syncData();
  assert.equal(D.conflicts().length, 1); assert.equal(D.outbox().length, 1);
  // (4) 送れない変更（400）：原本は残る
  mode = 'bad';
  await sync.syncData();
  assert.equal(D.conflicts().length, 1); assert.ok(D.outbox()[0].blocked);
  // (5) 成功：ここで初めて解決済み
  mode = 'ok';
  await sync.retryOp(D.outbox()[0]);
  assert.equal(D.conflicts().length, 0);
  assert.equal(D.get('a').titleEdit, '端末の修正');
  assert.ok(D.conflicts({ all: true })[0].resolved);
});

test('4. 棚の整理：更新に失敗したものを成功として数えない。同時に何回走っても公開待ちは3件・控えは6件を超えない', async () => {
  const kv = memoryKv();
  for (let i = 1; i <= 2; i++) await S.create(kv, { id: `r${i}`, set: set(`r${i}`), state: 'ready', score: 90 });
  for (let i = 1; i <= 10; i++) await S.create(kv, { id: `s${i}`, set: set(`s${i}`, { createdAt: new Date(Date.now() - i * 1000).toISOString() }), state: 'shelf', score: 80 + i });
  // 同時に4つの棚整理（それぞれ読んだあと少し待ってから書く）
  const slow = (ms) => ({ ...kv, eval: async (...a) => { await new Promise((r) => setTimeout(r, ms)); return kv.eval(...a); } });
  await Promise.all([S.rebalance(slow(5)), S.rebalance(slow(10)), S.rebalance(slow(15)), S.rebalance(kv)]);
  const c = await S.counts(kv);
  assert.ok(c.ready <= 3, `公開待ち ${c.ready}件`);
  assert.equal(c.ready, 3);
  assert.ok(c.shelf <= 6, `控え ${c.shelf}件`);
  assert.equal(c.ready + c.shelf + c.expired, 12, '何も消えない');
  // どの道を通っても公開待ちは3件まで：公開待ち2件のときに、別々の控え2件を同時に公開待ちへ（棚の整理と社長の「戻す」が重なった場合など）
  const kv3 = memoryKv();
  for (let i = 1; i <= 2; i++) await S.create(kv3, { id: `q${i}`, set: set(`q${i}`), state: 'ready' });
  await S.create(kv3, { id: 'q3', set: set('q3'), state: 'shelf' });
  await S.create(kv3, { id: 'q4', set: set('q4'), state: 'expired' });
  const res = await Promise.allSettled([S.update(kv3, 'q3', 1, { state: 'ready', by: 'server:棚の整理' }), S.decide(kv3, 'q4', 1, { action: 'restore' })]);
  const c3 = await S.counts(kv3);
  assert.equal(c3.ready, 3, `公開待ち ${c3.ready}件（上限3）：${res.map((r) => r.status).join(',')}`);
  assert.equal(c3.ready + c3.shelf + c3.expired, 4, '溢れた方は控えに回り、消えない');
  // 更新に失敗（競合）したら成功として数えない：繰り上げの直前に別の処理が書き換える
  const kv2 = memoryKv();
  await S.create(kv2, { id: 't1', set: set('t1'), state: 'shelf', score: 99 });
  await S.create(kv2, { id: 't2', set: set('t2'), state: 'shelf', score: 50 });
  let first = true;
  const racing = { ...kv2, eval: async (name, keys, args) => { if (first && name === 'casMove' && keys[0] === 'data:set:t1') { first = false; const r = await S.get(kv2, 't1'); await S.update(kv2, 't1', r.rev, { set: set('t1', { title: '割り込み' }) }); } return kv2.eval(name, keys, args); } };
  await S.rebalance(racing);
  const after = await S.counts(kv2);
  assert.equal(after.ready, 1, '競合した t1 の代わりに t2 が繰り上がり、公開待ちの数え間違いがない');
});

test('5. 移行の照合：サーバーが足す点検情報などは端末の編集と区別する（正常な同期を止めない）。端末の実際の編集は見逃さない', async () => {
  const kv = memoryKv();
  const local = set('m1');
  await S.importSets(kv, [local]);
  const rec = await S.get(kv, 'm1');
  await S.update(kv, 'm1', rec.rev, { set: { ...rec.set, inspection: { at: 'x', checked: 1, problems: [] } }, by: 'server:棚の点検' });
  const ok = await S.verify(kv, [local]);
  assert.equal(ok.ok, true, JSON.stringify(ok.different));
  const edited = await S.verify(kv, [{ ...local, titleEdit: '端末で直した' }]);
  assert.equal(edited.ok, false); assert.match(edited.different[0].why, /中身が違う/);
  const again = await S.importSets(kv, [local]);
  assert.equal(again.same.length, 1, '点検情報だけの違いは差異にしない');
});

test('Upstash の検証手順：すべての鍵に印を付け、片付けでは自分が使った鍵だけを消す（ほかのデータに触れない）', async () => {
  const { prefixKv } = await import('../lib/kv.js');
  const base = memoryKv();
  await base.set('data:set:real', 'production-like');
  const kv = prefixKv(base, 'e2e:t1:');
  await S.create(kv, { id: 'p1', set: set('p1'), state: 'shelf' });
  await S.update(kv, 'p1', 1, { state: 'ready' });
  assert.ok(kv.usedKeys().every((k) => k.startsWith('e2e:t1:')));
  assert.equal(await base.get('data:set:p1'), null, '印の無い鍵には書いていない');
  const n = await kv.cleanup();
  assert.ok(n >= 4);
  assert.equal(await base.get('data:set:real'), 'production-like', 'ほかの鍵は消さない');
  assert.equal(await base.get('e2e:t1:data:set:p1'), null);
});
