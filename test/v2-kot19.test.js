// KOT-19：改善キューを表示だけでなく実行可能な仕事に接続する（紹介番号の自動修正・投稿順と冒頭案の社員による決定）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import * as D from '../lib/v2/dept-work.js';

const prod = (n, base = 1000) => Array.from({ length: n }, (_, i) => ({ name: `商品${i}`, short: `商品${i}`, code: `c${base + i}`, price: base + i * 100, url: `https://item.rakuten.co.jp/s/${base + i}/`, image: `https://thumbnail.image.rakuten.co.jp/${i}.jpg`, room: `紹介文その${i}：用途と価格帯を整理した説明です`, no: `${i + 1}` }));
const set = (id, extra = {}) => ({ id, title: `完成品${id}`, caption: '本文はここに書きます。比較の観点を整理した投稿です。#PR', hashtags: ['#便利'], image: { mediaId: 'm', url: '/api/media?id=m', label: 'AI生成イメージ' }, products: prod(6), deliveredAt: '2026-11-20T00:00:00.000Z', ...extra });
const noNo = (id, base) => set(id, { products: prod(6, base).map(({ no, ...r }) => r) });
async function seed(kv, sets, status = 'adopted') {
  for (const s of sets) await kv.setJson(`v2:set:${s.id}`, s);
  await kv.setJson('v2:sets', sets.map((s) => ({ id: s.id, title: s.title, status, deliveredAt: s.deliveredAt })));
}

test('紹介番号の不足を編集が自動で直し、前後を記録して再点検。2回目は何もしない・番号は重複しない', async () => {
  const kv = memoryKv();
  await seed(kv, [noNo('a', 1000), noNo('b', 2000)]);
  const w = await D.numberFixWork(kv);
  assert.ok(w); assert.equal(w.est, 0);
  const r = await w.run();
  assert.match(r.done, /不足は0点/);
  const ex = await kv.getJson('v2:free:exec');
  assert.equal(ex.before.lacking, 12); assert.equal(ex.after.lacking, 0);
  const a = await kv.getJson('v2:set:a'); const b = await kv.getJson('v2:set:b');
  const nos = [...a.products, ...b.products].map((p) => p.no);
  assert.equal(new Set(nos).size, 12, '番号が重複しない');
  assert.ok(nos.every((n) => /^No\.\d{3}$/.test(n)));
  assert.equal(a.caption, set('a').caption, 'キャプションは書き換えない');
  const edit = await kv.getJson('v2:free:edit');
  assert.ok(!edit.rows.some((x) => x.issues.some((i) => /紹介番号/.test(i))), '再点検で不足が消えている');
  assert.equal(await D.numberFixWork(kv), null, '直した後は仕事にしない（重複防止）');
  assert.ok((await kv.listJson('v2:free:log', 10)).some((l) => l.kind === 'number-fix'));
  const kv2 = memoryKv(); await seed(kv2, [noNo('c', 3000)]);
  assert.equal((await D.deptFreeWork('editor', kv2)).kind, 'number-fix', '編集の仕事探しで点検より先に実行される');
});

test('広報が投稿順と冒頭案を根拠つきで決め、社長の「選ぶ」項目は選択済みの納品に置き換わる', async () => {
  const kv = memoryKv();
  await seed(kv, [set('a', { title: '安い物比較', deliveredAt: '2026-11-18T00:00:00.000Z', products: prod(6, 500) }), set('b', { title: '高い物比較', deliveredAt: '2026-11-19T00:00:00.000Z', products: prod(6, 9000) })]);
  const w = await D.deliveryDecisionWork(kv); assert.ok(w); assert.equal(w.est, 0);
  const r = await w.run();
  assert.match(r.done, /1番目/);
  const d = await kv.getJson('v2:free:decision');
  assert.equal(d.order[0].id, 'b', '報酬の目安が高い方が先');
  assert.ok(d.order[0].why && d.order[0].hookWhy && d.order[0].hook);
  assert.match(d.note, /暫定/);
  assert.equal(await D.deliveryDecisionWork(kv), null, '同じ状態では決め直さない');
  const t = await D.trackingDesignWork(kv); if (t) await t.run();
  const q = await D.collectQueue(kv);
  assert.ok(q.some((x) => x.exec === 'delivered' && x.need === 'owner'));
  assert.ok(!q.some((x) => /順番案|冒頭の別案/.test(x.task)), '社長に選ばせる項目は残らない');
});
