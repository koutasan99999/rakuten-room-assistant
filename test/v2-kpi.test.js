// 2026-11-18 成果の数字：投稿できる完成品・投稿の実績・リールの動画（実ファイル）・ROOMへの流入。分析は鑑定の仕事探し（0円）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import * as KPI from '../lib/v2/kpi.js';
import * as V from '../lib/v2/company.js';

const prod = (n) => Array.from({ length: n }, (_, i) => ({ name: `商品${i}`, price: 1000 + i, url: `https://item.rakuten.co.jp/s/${i}/`, room: `紹介文${i}` }));
const full = (id, status, extra = {}) => ({ id, title: `完成品${id}`, status, caption: '本文 #PR', image: { mediaId: 'm', url: '/api/media?id=m' }, products: prod(6), ...extra });

test('投稿できる完成品の判定：表紙・PR表記・商品6点・URL・ROOM紹介文がそろったものだけ。足りないものを返す', () => {
  assert.equal(KPI.postable(full('a', 'waiting')).ok, true);
  const p = KPI.postable(full('b', 'waiting', { image: null, caption: '本文', products: prod(3) }));
  assert.equal(p.ok, false);
  assert.deepEqual(p.missing, ['表紙画像', 'PR表記のあるキャプション', '商品6点（今3点）']);
  assert.deepEqual(KPI.postable(full('c', 'waiting', { products: prod(6).map((x, i) => (i ? x : { ...x, room: '' })) })).missing, ['ROOM紹介文']);
});

test('成果の数字：投稿できる完成品・投稿済み・実ファイルのあるリールだけ数える。社長が登録していない数字は「未取得」（推測しない）。鑑定が1日1回・変わったときだけ記録する', async () => {
  const kv = memoryKv();
  const sets = [full('a', 'waiting'), full('b', 'posted'), full('c', 'waiting', { image: null }), full('d', 'rejected')];
  for (const s of sets) await kv.setJson(`v2:set:${s.id}`, s);
  await kv.setJson('v2:sets', sets.map((s) => ({ id: s.id, title: s.title, status: s.status })));
  await kv.setJson('v2:reels', [{ setId: 'a', format: 'top3', bytes: 2000000, seconds: 16, mime: 'video/mp4' }, { setId: 'a', format: 'reveal' }]);
  let k = await KPI.computeKpi(kv);
  assert.equal(k.postable, 2); assert.equal(k.posted, 1); assert.equal(k.notPostable, 1); assert.equal(k.notPostableWhy['表紙画像'], 1);
  assert.equal(k.reelFiles, 1, '実ファイルの記録の無いリールは数えない');
  assert.equal(k.roomClicks, null, '未登録は未取得'); assert.equal(k.sales, null);
  await kv.setJson('v2:perf', [{ views: 300, roomClicks: 4 }, { views: 120 }]);
  k = await KPI.computeKpi(kv);
  assert.equal(k.views, 420); assert.equal(k.roomClicks, 4);
  const w = await V.findWork('appraiser', { kv, env: {} });
  assert.equal(w.kind, 'kpi'); assert.equal(w.est, 0);
  const r = await w.run();
  assert.match(r.done, /投稿できる完成品2件・投稿済み1件・リールの動画1本・ROOMへの流入4/);
  let again = await V.findWork('appraiser', { kv, env: {} });
  assert.notEqual(again.kind, 'kpi', '同じ日に数字が変わらなければ仕事にしない');
  if (again.kind === 'profit-review') { await again.run(); again = await V.findWork('appraiser', { kv, env: {} }); } // 次は週ごとの見直し（KOT-13・7日に1回）
  assert.ok(again.none, '同じ日に数字が変わらず、見直しも済んでいれば仕事にしない');
  const st = await V.officeState(kv, {});
  assert.equal(st.kpi.current.postable, 2);
  assert.equal(st.kpi.history.length, 1);
  assert.equal((await V.getSet(kv, 'c')).postable.ok, false);
});
