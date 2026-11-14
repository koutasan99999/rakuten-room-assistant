// PR #91 再々レビュー（2026-11-14）：作成にも控えの上限を原子的に／未解決の競合記録を件数で消さない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import * as S from '../lib/store.js';

const set = (id, extra = {}) => ({ id, title: `企画${id}`, items: [{ name: 'n', price: 1000, code: `c:${id}` }], createdAt: new Date().toISOString(), ...extra });

test('作成：控えは同時に作っても6件まで。超えた分は消さずに期限切れとして保存する（移行でもデータを失わない）', async () => {
  const kv = memoryKv();
  const slow = (ms) => ({ ...kv, eval: async (...a) => { await new Promise((r) => setTimeout(r, ms)); return kv.eval(...a); } });
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => S.create(i % 2 ? slow(i) : kv, { id: `n${i}`, set: set(`n${i}`), state: 'shelf' })));
  const c = await S.counts(kv);
  assert.equal(c.shelf, 6, `控え ${c.shelf}件`);
  assert.equal(c.expired, 4);
  assert.equal(rs.filter((r) => r.created).length, 10, '10件とも保存された（消えていない）');
  assert.equal((await S.list(kv)).length, 10);
  const over = (await S.list(kv, { states: ['expired'] }))[0];
  assert.match(over.history[0].change, /控えが満杯/);
  // 移行：端末の確認待ち8件 → 控え6件＋期限切れ2件（どれも保存）。照合も一致する
  const kv2 = memoryKv();
  const local = Array.from({ length: 8 }, (_, i) => ({ ...set(`m${i}`), status: 'new' }));
  const r = await S.importSets(kv2, local);
  assert.equal(r.created.length, 8);
  const c2 = await S.counts(kv2);
  assert.equal(c2.shelf, 6); assert.equal(c2.expired, 2);
  assert.equal((await S.verify(kv2, local)).ok, true, '上限で期限切れに回ったものも、照合では端末の確認待ちと一致とみなす');
});

test('作成：公開待ちに作るときも3件まで（満杯なら控え、控えも満杯なら期限切れ）', async () => {
  const kv = memoryKv();
  await Promise.all(Array.from({ length: 12 }, (_, i) => S.create(kv, { id: `r${i}`, set: set(`r${i}`), state: 'ready' })));
  const c = await S.counts(kv);
  assert.equal(c.ready, 3); assert.equal(c.shelf, 6); assert.equal(c.expired, 3);
});

test('競合の記録：11件以上発生しても、未解決の記録はすべて残す（更新・移行の両方）', async () => {
  const kv = memoryKv();
  await S.create(kv, { id: 'a', set: set('a') });
  await S.update(kv, 'a', 1, { set: set('a', { title: '最新' }) });
  for (let i = 0; i < 15; i++) await assert.rejects(S.update(kv, 'a', 1, { set: set('a', { title: `古い${i}` }), by: `device:${i}` }), S.ConflictError);
  for (let i = 0; i < 12; i++) await S.importSets(kv, [{ ...set('a', { title: `移行${i}` }), status: 'new' }], { deviceId: `d${i}` });
  const cs = await S.conflicts(kv, 'a');
  assert.equal(cs.length, 27, `競合の記録 ${cs.length}件`);
  assert.equal(cs.filter((x) => x.kind === '移行のときの差異').length, 12);
  assert.ok(cs.some((x) => x.set.title === '古い0'), '最初の記録も残る');
});
