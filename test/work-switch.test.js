// 仕事の切り替え（2026-11-15）：材料が無い・同じやり方で成果が出ないときに、ほかの価値ある仕事へ移る。意味のない繰り返しで費用を使わない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { rescuePool, buyerDry, WORKER_KEYS as WK, RESCUE_MAX } from '../lib/worker.js';
import * as P from '../lib/production.js';

const cand = (id, status, why, code) => ({ id, status, why, versions: [{ v: 1, data: { id, code, name: `商品${id}`, ref: 'R1' } }] });

test('候補の再審査：保留・修正しきれなかった候補だけを対象にし、情報源の無い主張や監査AIの却下は対象外。1つの候補は1回だけ', async () => {
  const kv = memoryKv();
  await kv.pushJson(WK.buyer, { id: 's1', at: '2026-11-15T00:00:00Z', date: '2026-11-15', theme: 'キッチン', results: [{ ref: 'R1' }], candidates: [
    cand('a', 'hold', '修正2回でも合格にならなかった', 'x:a'),
    cand('b', 'reject', 'コードの確認で不合格：購入者・購入理由・競合との比較がそろっている', 'x:b'),
    cand('c', 'reject', '監査AIが却下を提案：紹介に向かない', 'x:c'),
    cand('d', 'reject', 'コードの確認で不合格：情報源の無い主張', 'x:d'),
    cand('e', 'pass', '', 'x:e'),
    cand('f', 'hold', '追加調査が必要', 'x:used')
  ] }, 0);
  const rp = await rescuePool(kv, { setCodes: ['x:used'] });
  assert.deepEqual(rp.list.map((c) => c.id), ['a', 'b']);
  assert.ok(rp.list.length <= RESCUE_MAX);
  await kv.setJson(WK.rescued, ['s1:a', 's1:b']);
  assert.equal(await rescuePool(kv, { setCodes: ['x:used'] }), null, '一度再審査した候補はくり返さない');
});

test('再審査の結果（rescueOf）は、さらに再審査しない', async () => {
  const kv = memoryKv();
  await kv.pushJson(WK.buyer, { id: 'r1', rescueOf: 's0', date: '2026-11-15', candidates: [cand('a', 'hold', 'x', 'x:a')] }, 0);
  assert.equal(await rescuePool(kv, {}), null);
});

test('同じやり方の空振り：今日の発掘が最後から何回続けて合格0件かを数える（再審査は数えない。昨日の分は数えない）', async () => {
  const kv = memoryKv();
  const push = (x) => kv.pushJson(WK.buyer, x, 0);
  await push({ id: '1', date: '2026-11-14', candidates: [] });
  await push({ id: '2', date: '2026-11-15', candidates: [cand('a', 'pass', '', 'x')] });
  await push({ id: '3', date: '2026-11-15', candidates: [] });
  await push({ id: '4', date: '2026-11-15', candidates: [cand('b', 'hold', '', 'y')] });
  await push({ id: '5', date: '2026-11-15', rescueOf: '4', candidates: [] });
  assert.equal(await buyerDry(kv, '2026-11-15'), 2);
  assert.equal(await buyerDry(kv, '2026-11-16'), 0);
});

test('事実だけのROOM紹介文：商品データの言葉と楽天の価格だけで80〜280字。体験・効果の表現や商品データにない数字が入らない（コードの確認を通る）', () => {
  const it = { name: '【送料無料】電源タップ 8口 USB付き 雷ガード 2m OAタップ', price: 2980, caption: '雷ガード搭載。8個口でたくさんの機器をまとめて接続。ほこり防止シャッター付き。送料無料でお届け。ポイント10倍', url: 'https://item.rakuten.co.jp/s/x/', image: 'x', code: 's:x' };
  const t = P.factRoomIntro(it, { target: '在宅ワークの人' });
  assert.ok(t.length >= 80 && t.length <= 280, `${t.length}字`);
  assert.match(t, /2,980円/); assert.doesNotMatch(t, /送料無料|ポイント|使ってみ|おすすめ/);
  const c = P.codeCheck({ items: [it], roomTexts: [{ intro: t }], copy: null });
  for (const k of ['expression', 'price', 'numbers']) assert.equal(c.checks.find((x) => x.key === k).ok, true, k);
  const short = P.factRoomIntro({ name: '木のスプーン', price: 500, caption: '' }, {});
  assert.ok(short.length >= 40, '説明が無くても作れる');
});

test('引用の前後のかっこ（「」『』）は外して照合する（修正で「「…」」と二重に付いても、商品データにある言葉なら通る）', async () => {
  const { unquote } = await import('../lib/agents.js');
  assert.equal(unquote('「「防災士監修 防災セット」」'), '防災士監修 防災セット');
  assert.equal(unquote('『角度調節可能』'), '角度調節可能');
  assert.equal(unquote('そのまま'), 'そのまま');
});
