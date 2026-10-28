import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadHistory() {
  const data = {};
  const localStorage = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../js/history.js', import.meta.url), 'utf8'), { window, localStorage, Date, JSON, Math, Promise });
  return window.PostHistory;
}

test('投稿履歴：記録・更新・新しい順・企画づくり用の直近10件', async () => {
  const H = loadHistory();
  const a = await H.add({ title: 'A', topic: 'A', genre: '食器・キッチン', postType: '本命＋安い代替' });
  const b = await H.add({ title: 'B', topic: 'B', genre: 'ガジェット', postType: 'まずコレ' });
  await H.update(a, { status: 'posted', brands: ['iittala'], products: [{ name: 'x', brand: 'iittala', price: 3000 }] });
  const list = await H.list();
  assert.deepEqual(list.map((p) => p.topic), ['B', 'A']);
  assert.equal(list[1].status, 'posted');
  // 実際に作った・投稿した企画を先に、選んだだけの企画は後に
  const recent = await H.recentForIdeas();
  assert.deepEqual(recent.map((r) => r.topic), ['A', 'B']);
  assert.deepEqual(recent[0].brands, ['iittala']);
  for (let i = 0; i < 15; i++) await H.add({ topic: 'x' + i });
  assert.equal((await H.recentForIdeas()).length, 10);
  await H.remove(b);
  assert.ok(!(await H.list()).some((p) => p.id === b));
});

test('ROOM登録の記録：コレクション名の提案・商品ごとの投稿済み・コレクション登録済み', async () => {
  const H = loadHistory();
  assert.equal(H.collectionNameFor('出産祝い'), '出産祝い｜本気出して考えてみた');
  assert.equal(H.collectionNameFor('香水初心者について本気出して考えてみた'), '香水初心者｜本気出して考えてみた');
  const id = await H.add({ topic: '出産祝い' });
  await H.update(id, { products: [{ id: 'a:1' }, { id: 'a:2' }], roomDone: { 'a:1': true }, collectionName: '出産祝い｜本気出して考えてみた' });
  await H.update(id, { collectionDone: true });
  const rec = await H.get(id);
  assert.deepEqual(rec.roomDone, { 'a:1': true });
  assert.equal(rec.collectionDone, true);
  assert.equal(await H.get('none'), null);
});
