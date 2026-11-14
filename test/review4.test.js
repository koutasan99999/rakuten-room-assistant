// PR #91（9aa88b3）レビュー：控えへ移すときも6件まで／「戻す」で両方満杯なら期限切れに保存／どの状態遷移からも上限を超えない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import * as S from '../lib/store.js';

const set = (id) => ({ id, title: `企画${id}`, items: [], createdAt: new Date().toISOString() });
const slow = (kv, ms) => ({ ...kv, eval: async (...a) => { await new Promise((r) => setTimeout(r, ms)); return kv.eval(...a); } });

test('控えへ移すとき（公開待ち→控え・期限切れ→控え）も6件まで。同時に移しても超えない', async () => {
  const kv = memoryKv();
  for (let i = 0; i < 6; i++) await S.create(kv, { id: `s${i}`, set: set(`s${i}`), state: 'shelf' });
  for (let i = 0; i < 3; i++) await S.create(kv, { id: `r${i}`, set: set(`r${i}`), state: 'ready' });
  for (let i = 0; i < 4; i++) await S.create(kv, { id: `e${i}`, set: set(`e${i}`), state: 'expired' });
  const moves = [...[0, 1, 2].map((i) => S.update(slow(kv, i * 3), `r${i}`, 1, { state: 'shelf' })), ...[0, 1, 2, 3].map((i) => S.update(slow(kv, i * 2), `e${i}`, 1, { state: 'shelf' }))];
  const rs = await Promise.allSettled(moves);
  const c = await S.counts(kv);
  assert.equal(c.shelf, 6, `控え ${c.shelf}件`);
  assert.ok(rs.every((r) => r.status === 'fulfilled' || r.reason instanceof S.CapacityError), '満杯は CapacityError（書かない）');
  assert.equal(c.ready + c.shelf + c.expired, 13, '何も消えない');
});

test('「戻す」：公開待ち3件・控え6件が両方満杯なら、削除せずに期限切れとして保存する', async () => {
  const kv = memoryKv();
  await S.create(kv, { id: 'x', set: set('x'), state: 'ready' });
  const rej = await S.decide(kv, 'x', 1, { action: 'reject' }); // 社長が却下
  assert.equal(rej.state, 'rejected');
  for (let i = 0; i < 3; i++) await S.create(kv, { id: `r${i}`, set: set(`r${i}`), state: 'ready' });
  for (let i = 0; i < 6; i++) await S.create(kv, { id: `s${i}`, set: set(`s${i}`), state: 'shelf' });
  const back = await S.decide(kv, 'x', rej.rev, { action: 'restore' });
  assert.equal(back.state, 'expired', '両方満杯なら期限切れに保存（消さない）');
  assert.match(back.history[0].change, /満杯/);
  const c = await S.counts(kv);
  assert.equal(c.ready, 3); assert.equal(c.shelf, 6);
  assert.equal((await S.list(kv)).length, 10);
});

test('同時実行：作成・繰り上げ・控えへの移動・「戻す」・棚の整理が重なっても、公開待ち3件・控え6件を超えない', async () => {
  const kv = memoryKv();
  for (let i = 0; i < 8; i++) await S.create(kv, { id: `e${i}`, set: set(`e${i}`), state: 'expired' });
  for (let i = 0; i < 5; i++) { await S.create(kv, { id: `j${i}`, set: set(`j${i}`), state: 'expired' }); const r = await S.get(kv, `j${i}`); await S.update(kv, `j${i}`, r.rev, { state: 'ready' }).catch(() => {}); }
  const jobs = [];
  for (let i = 0; i < 10; i++) jobs.push(S.create(slow(kv, i), { id: `n${i}`, set: set(`n${i}`), state: i % 2 ? 'ready' : 'shelf' }));
  for (let i = 0; i < 8; i++) jobs.push(S.get(kv, `e${i}`).then((r) => S.decide(slow(kv, i), `e${i}`, r.rev, { action: 'restore' })));
  for (let i = 0; i < 3; i++) jobs.push(S.rebalance(slow(kv, i * 4)));
  for (let i = 0; i < 5; i++) jobs.push(S.get(kv, `j${i}`).then((r) => S.update(slow(kv, i), `j${i}`, r.rev, { state: 'shelf' })));
  await Promise.allSettled(jobs);
  const c = await S.counts(kv);
  assert.ok(c.ready <= 3, `公開待ち ${c.ready}件`);
  assert.ok(c.shelf <= 6, `控え ${c.shelf}件`);
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), 23, '23件とも残る（消えない）');
  assert.equal((await S.list(kv)).length, 23);
});
