import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENRES, pickGenres, genreWeight, sanitizeStats } from '../lib/genres.js';

test('ジャンルは30種類、IDは重複なし、各ジャンルにキーワードが複数ある', () => {
  assert.equal(GENRES.length, 30);
  assert.equal(new Set(GENRES.map((g) => g.id)).size, GENRES.length);
  for (const g of GENRES) {
    assert.ok(g.keywords.length >= 4, g.name);
    assert.equal(new Set(g.keywords).size, g.keywords.length, g.name);
  }
});

test('記録がなければ全ジャンルが同じ確率でまんべんなく選ばれる', () => {
  const count = {};
  for (let i = 0; i < 30000; i++) {
    const [g] = pickGenres(1);
    count[g.id] = (count[g.id] || 0) + 1;
  }
  assert.equal(Object.keys(count).length, 30);
  for (const n of Object.values(count)) assert.ok(n > 700 && n < 1300, String(n));
});

test('クリック・コピーが多いジャンルは選ばれやすくなるが、上限は3倍', () => {
  const stats = { fragrance: { shown: 10, clicked: 10, copied: 10 } };
  assert.equal(genreWeight(GENRES.find((g) => g.id === 'fragrance'), stats), 3);
  assert.equal(genreWeight(GENRES.find((g) => g.id === 'pet'), stats), 1);
  let hit = 0;
  for (let i = 0; i < 30000; i++) if (pickGenres(1, stats)[0].id === 'fragrance') hit++;
  const expected = 30000 * 3 / 32;
  assert.ok(Math.abs(hit - expected) < expected * 0.15, String(hit));
});

test('予備のジャンルは本命と重複しない', () => {
  for (let i = 0; i < 200; i++) {
    const [a, b] = pickGenres(2);
    assert.notEqual(a.id, b.id);
  }
});

test('ブラウザから届いた記録の不正な値は無視する', () => {
  const s = sanitizeStats({ fragrance: { clicked: '5', copied: -3, shown: 'abc', evil: 9 }, unknown: { clicked: 9 }, pet: 'x' });
  assert.deepEqual(s, { fragrance: { clicked: 5 } });
  assert.deepEqual(sanitizeStats(null), {});
});
