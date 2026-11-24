// KOT-9：承認待ちが画面で「進行中」に数えられない／バイヤーの自律発掘が重複・水増しをしない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseSummary } from '../lib/v2/company.js';
import { mergeCandidates, scoutNone, SCOUT_MAX, SCOUT_ADD_MAX, SCOUT_EVERY_HOURS } from '../lib/v2/scout.js';

test('案件の内訳：承認待ちは進む案件に数えない', () => {
  const v = [
    { working: true, wait: null }, { working: false, wait: null },
    { wait: { kind: 'slot' } }, { wait: { kind: 'slot' } }, { wait: { kind: 'image' } },
    { wait: { kind: 'budget' } }, { wait: { kind: 'retry' } }
  ];
  const n = caseSummary(v);
  assert.deepEqual([n.total, n.running, n.queued, n.approval, n.image, n.budget, n.error, n.advancing], [7, 1, 1, 2, 1, 1, 1, 2]);
});
test('承認待ちだけでも、ほかの独立した案件は進む案件として数える', () => {
  const n = caseSummary([{ wait: { kind: 'slot' } }, { wait: { kind: 'slot' } }, { wait: null }]);
  assert.equal(n.advancing, 1);
  assert.equal(caseSummary([{ wait: { kind: 'slot' } }]).advancing, 0);
});
test('発掘：重複を入れない・1回の追加数と全体の上限を守る', () => {
  const found = Array.from({ length: 20 }, (_, i) => ({ code: `c${i}`, name: `n${i}`, price: 100 }));
  const a = mergeCandidates([], found, ['c0']);
  assert.equal(a.added, SCOUT_ADD_MAX);
  assert.ok(!a.items.some((x) => x.code === 'c0'));
  const b = mergeCandidates(a.items, found, []);
  assert.equal(new Set(b.items.map((x) => x.code)).size, b.items.length);
  const full = Array.from({ length: SCOUT_MAX }, (_, i) => ({ code: `f${i}` }));
  assert.equal(mergeCandidates(full, found, []).added, 0);
});
test('発掘：間隔と上限で止まる（無限に仕事を作らない）', () => {
  assert.match(scoutNone({ items: Array(SCOUT_MAX).fill({}), at: '' }), /上限/);
  const recent = new Date(Date.now() - 3600000).toISOString();
  assert.match(scoutNone({ items: [], at: recent }), new RegExp(`${SCOUT_EVERY_HOURS}時間`));
  assert.equal(scoutNone({ items: [], at: '' }), '');
});
