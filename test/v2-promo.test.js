// KOT-25：既存の完成品の販売促進キュー（新規紹介が停止中でも動く）／新規副業・デジタル商品の凍結
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { promoWork, promoState, STAGES } from '../lib/v2/promo.js';
import { venturesWork, frozen } from '../lib/v2/ventures.js';

const prod = (n) => Array.from({ length: n }, (_, i) => ({ name: `商品${i}`, price: 1000 + i, url: `https://item.rakuten.co.jp/s/${i}/`, room: `紹介文${i}` }));
const set = (id, extra = {}) => ({ id, title: `完成品${id}`, caption: '本文 #PR', image: { mediaId: 'm' }, products: prod(6), deliveredAt: '2026-11-20T00:00:00.000Z', ...extra });
async function seed(kv, sets) {
  for (const s of sets) await kv.setJson(`v2:set:${s.id}`, s);
  await kv.setJson('v2:sets', sets.map((s) => ({ id: s.id, title: s.title, status: 'adopted' })));
}

test('販売促進キュー：既存の完成品1件について、6人が順に実成果物を作って引き継ぎ、0円で完了する', async () => {
  const kv = memoryKv();
  assert.equal(await promoWork('planner', kv), null, '完成品が無ければ仕事にしない');
  await seed(kv, [set('a')]);
  const handoffs = [];
  for (const st of STAGES) {
    const other = STAGES.find((x) => x.agent !== st.agent).agent;
    assert.equal(await promoWork(other, kv), null, '番でない社員は動かない');
    const w = await promoWork(st.agent, kv);
    assert.ok(w, `${st.agent} の番`);
    assert.equal(w.est, 0);
    const r = await w.run();
    assert.ok(r.done && !r.fail);
    handoffs.push(r.handoff);
  }
  assert.deepEqual(handoffs, ['writer', 'designer', 'pr', 'auditor', 'pr', undefined]);
  const kit = await kv.getJson('v2:promo:a');
  assert.equal(kit.status, 'done');
  assert.ok(kit.audit.ok);
  assert.ok(kit.write.storyFrames.length >= 3);
  assert.match(kit.write.firstComment, /PR/);
  assert.equal(await promoWork('planner', kv), null, '完成したら仕事にしない（空回りしない）');
  assert.equal((await promoState(kv)).done, 1);
  await kv.setJson('v2:set:a', set('a', { deliveredAt: '2026-11-25T00:00:00.000Z' }));
  assert.ok(await promoWork('planner', kv), '納品し直したら作り直す');
});

test('販売促進キュー：根拠のない主張は監査が止める（1回差し戻し→要確認）。投稿できない完成品は対象外', async () => {
  const kv = memoryKv();
  await seed(kv, [set('b', { caption: '芸能人も愛用 #PR' }), set('c', { image: null })]);
  for (let i = 0; i < 12; i++) {
    let any = false;
    for (const st of STAGES) { const w = await promoWork(st.agent, kv); if (w) { await w.run(); any = true; } }
    if (!any) break;
  }
  const kit = await kv.getJson('v2:promo:b');
  assert.equal(kit.status, 'done');
  assert.ok(kit.blocked && kit.blocked.length);
  assert.equal(kit.rework, 1);
  assert.equal(await kv.getJson('v2:promo:c'), null);
});

test('新規副業・デジタル商品は凍結（VENTURES_FROZEN=0 で戻せる）', async () => {
  const kv = memoryKv();
  assert.ok(frozen('venture', {}) && frozen('digital', {}) && !frozen('growth', {}) && !frozen('venture', { VENTURES_FROZEN: '0' }));
  const w = await venturesWork('planner', { kv, env: {} });
  assert.ok(!w.task || !/新規副業|デジタル/.test(w.task), `凍結中は新規の案を作らない：${w.task}`);
});
