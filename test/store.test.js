import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// ブラウザの localStorage を真似た入れ物で js/store.js を動かす
function loadStore() {
  const data = {};
  const localStorage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); }
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'), { window, localStorage, Date, JSON, Object, Promise });
  return { Store: window.ProductStore, data };
}

const A = { code: 'shop:1', name: '商品A', price: 1200, url: 'https://item.rakuten.co.jp/shop/1/', intro: '紹介文A', reason: '理由A', role: '一番外しにくい', genreId: 'x' };
const B = { code: 'shop:2', name: '商品B', price: 3400, url: 'https://item.rakuten.co.jp/shop/2/', intro: '紹介文B' };

test('状態の保存・変更・未選択に戻す', async () => {
  const { Store } = loadStore();
  assert.equal(await Store.getStatus(A), 'none');
  await Store.setStatus(A, 'room_candidate');
  assert.equal(await Store.getStatus(A), 'room_candidate');
  await Store.setStatus(A, 'ig_waiting'); // 一度決めた後でも変えられる
  assert.equal(await Store.getStatus(A), 'ig_waiting');
  await Store.setStatus(A, 'none');
  assert.equal(await Store.getStatus(A), 'none');
  assert.equal((await Store.list()).length, 0);
});

test('状態ごとの一覧と件数、保存する項目', async () => {
  const { Store, data } = loadStore();
  await Store.setStatus(A, 'ig_waiting');
  await Store.setStatus(B, 'ig_waiting');
  await Store.setStatus({ ...B, name: undefined }, 'ig_posted'); // 情報が欠けても前の内容を引き継ぐ
  assert.deepEqual((await Store.list('ig_waiting')).map((x) => x.id), ['shop:1']);
  const posted = (await Store.list('ig_posted'))[0];
  assert.equal(posted.name, '商品B');
  const counts = await Store.counts();
  assert.equal(counts.ig_waiting, 1);
  assert.equal(counts.ig_posted, 1);
  // DBに移しやすいよう、バージョン付きの決まった形で保存している（画面用の一時項目は保存しない）
  const saved = JSON.parse(Object.values(data)[0]);
  assert.equal(saved.version, 1);
  assert.equal(saved.items['shop:1'].role, '一番外しにくい');
  assert.equal(saved.items['shop:1'].genreId, undefined);
  assert.ok(saved.items['shop:1'].createdAt && saved.items['shop:1'].updatedAt);
});

test('知らない状態名は受け付けない', async () => {
  const { Store } = loadStore();
  await assert.rejects(Store.setStatus(A, 'bad'));
  await assert.rejects(Store.setStatus({ name: 'id無し' }, 'room_candidate'));
});
