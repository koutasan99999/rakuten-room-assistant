// KOT-17：全8部署のうち実行できる部署に、0円（AI・外部サイト不使用）で具体的な成果物を作る仕事がある
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import * as V from '../lib/v2/company.js';
import * as D from '../lib/v2/dept-work.js';

const prod = (n, base = 1000) => Array.from({ length: n }, (_, i) => ({ name: `商品${i}`, short: `商品${i}`, code: `c${base + i}`, price: base + i * 100, url: `https://item.rakuten.co.jp/s/${base + i}/`, image: `https://thumbnail.image.rakuten.co.jp/${i}.jpg`, room: `紹介文その${i}：用途と価格帯を整理した説明です`, no: `${i + 1}` }));
const set = (id, extra = {}) => ({ id, title: `完成品${id}`, caption: '本文はここに書きます。比較の観点を整理した投稿です。#PR', hashtags: ['#便利'], image: { mediaId: 'm', url: '/api/media?id=m', label: 'AI生成イメージ' }, products: prod(6), deliveredAt: '2026-11-20T00:00:00.000Z', ...extra });
async function seed(kv, sets, status = 'adopted') {
  for (const s of sets) await kv.setJson(`v2:set:${s.id}`, s);
  await kv.setJson('v2:sets', sets.map((s) => ({ id: s.id, title: s.title, status })));
}

test('バイヤー：商品の報酬・欠損・重複を比べる。料率は仮説と明記。変わらなければ作り直さない', async () => {
  const kv = memoryKv();
  assert.equal(await D.productCompareWork(kv), null, '完成品が無ければ仕事にしない');
  const a = set('a'); const b = set('b', { products: prod(6).map((p, i) => (i === 0 ? { ...p, image: '', code: '' } : p)) });
  await seed(kv, [a, b]);
  const w = await D.productCompareWork(kv);
  assert.equal(w.est, 0);
  const r = await w.run();
  assert.match(r.done, /商品12点/);
  const st = await kv.getJson('v2:free:products');
  assert.equal(st.rate.kind, 'hypothesis');
  assert.ok(st.gapCount >= 1);
  assert.ok(st.dups.length >= 1, '同じ商品番号が2つの完成品にある');
  assert.equal(await D.productCompareWork(kv), null);
  await kv.setJson('v2:profit:rate', { rate: 0.02, url: 'https://affiliate.rakuten.co.jp/', at: 'x' });
  assert.ok(await D.productCompareWork(kv), '公式の料率が登録されたら比べ直す');
});

test('企画・ライター・デザイナー・編集・広報・鑑定：それぞれ具体的な成果物と部署別キューを作る', async () => {
  const kv = memoryKv();
  const bad = set('b', { caption: '短い', hashtags: [], image: null, products: prod(6).map((p) => ({ ...p, room: '' })) });
  await seed(kv, [set('a', { title: 'スマホスタンド比較' }), set('c', { title: 'スマホスタンド比較まとめ' }), bad]);
  for (const f of [D.planOrganizeWork, D.reuseDraftWork, D.assetCheckWork, D.editCheckWork, D.trackingDesignWork]) {
    const w = await f(kv);
    assert.ok(w, f.name);
    assert.equal(w.est, 0);
    const r = await w.run();
    assert.ok(r.done && r.title, f.name);
  }
  assert.ok((await kv.getJson('v2:free:plan')).dup.length >= 1, '似た題名を重複候補にする');
  const reuse = await kv.getJson('v2:free:reuse');
  assert.ok(reuse.sets.a.variants.length >= 2);
  assert.ok(reuse.sets.a.variants.every((v) => /PR/.test(v.text) && !/使ってみ|愛用|絶対/.test(v.text)));
  assert.match(JSON.stringify((await kv.getJson('v2:free:assets')).rows), /表紙画像が無い/);
  assert.match(JSON.stringify((await kv.getJson('v2:free:edit')).rows), /ROOM紹介文が空/);
  assert.ok((await kv.getJson('v2:free:tracking')).order.length >= 1);
  const q = await D.priorityQueueWork(kv);
  assert.ok(q);
  await q.run();
  const st = await D.deptWorkState(kv);
  assert.ok(st.queue.length >= 3 && st.queue[0].rank === 1);
  assert.ok(st.log.length >= 6, '実行ログが残る');
  assert.ok(st.inventory.some((x) => x.kind === 'external' && x.impl === false), '未実装の外部データの仕事を実装済みと偽らない');
  assert.equal(await D.priorityQueueWork(kv), null, '同じ内容は繰り返さない');
  assert.equal(await D.editCheckWork(kv), null);
});

test('予算が尽き・ROOM新規紹介が停止中でも、バイヤーほか全員が0円の仕事を見つける。待機時は次の条件と社長の操作を出す', async () => {
  const kv = memoryKv();
  await seed(kv, [set('a')]);
  const env = { __noWait: true, BUDGET_MONTHLY_YEN: '1' };
  for (const agent of ['buyer', 'planner', 'writer', 'designer', 'editor', 'pr']) {
    const w = await V.findWork(agent, { kv, env, cases: [] });
    if (agent === 'writer' || agent === 'buyer' || agent === 'designer' || agent === 'editor' || agent === 'pr' || agent === 'planner') assert.ok(w.task || w.none, agent);
  }
  const b = await V.findWork('buyer', { kv, env, cases: [] });
  assert.equal(b.kind, 'product-compare');
  await b.run({ kv, env });
  const again = await V.findWork('buyer', { kv, env, cases: [] });
  assert.match(again.none, /次に必要な条件/);
  assert.match(again.none, /社長に必要な操作/);
  assert.match(again.none, /KOT-13/, '停止中の理由は変えない');
  assert.equal(await V.findWork('designer', { kv, env, cases: [] }).then((x) => x.kind), 'asset-check');
});
