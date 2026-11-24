// 0円の仕事（2026-11-24・KOT-16）：AIの予算が尽きても、ROOMの新規紹介が停止中でも、実際にできる仕事（コードの計算だけ・AIも外部サイトも使わない）
//   ①販売導線の点検（監査）：納品済みの完成品が「投稿して売るために必要なもの」をそろえているかを、保存データから確かめる
//   ②計測不足の解消案（鑑定）：利益を数字で見るために足りない登録を、完成品ごとに具体的に書き出す
//   実績の数字・売上は作らない。未計測は未計測のまま。変化が無ければ仕事にしない（稼働の演出をしない）
import { postable } from './kpi.js';

const K = { sets: 'v2:sets', set: (id) => `v2:set:${id}`, perf: 'v2:perf', gap: 'v2:free:gap' };
const now = () => new Date().toISOString();
const RAKUTEN_URL = /^https:\/\/([\w-]+\.)*(rakuten\.co\.jp|rakuten\.com)\//;
export const FUNNEL_VER = 1; // 点検の基準を変えたら上げる（古い点検は直し直す）

// 完成品1件の販売導線の不足（表紙・PR表記・商品数・URL・ROOM紹介文＋商品URLが楽天のものか）
export function funnelProblems(s) {
  const p = postable(s);
  const problems = [...p.missing];
  const bad = ((s && s.products) || []).filter((x) => x.url && !RAKUTEN_URL.test(String(x.url))).length;
  if (bad) problems.push(`楽天以外のURLの商品${bad}点（収益にならない）`);
  return problems;
}

// 監査：まだ点検していない（または納品し直された）完成品を1件
export async function funnelAuditWork(kv) {
  const list = ((await kv.getJson(K.sets)) || []).filter((x) => ['waiting', 'adopted'].includes(x.status)).slice(0, 40);
  for (const x of list) {
    const s = await kv.getJson(K.set(x.id));
    if (!s) continue;
    const f = s.funnel;
    if (f && f.ver === FUNNEL_VER && Date.parse(f.at) >= Date.parse(s.deliveredAt || 0)) continue;
    return { kind: 'funnel-audit', task: `完成品「${s.title}」が、投稿して売るために必要なもの（表紙・PR表記・商品6点・楽天のURL・ROOM紹介文）をそろえているか点検する（AIは使わない・0円）`, doing: '完成品の販売導線を点検しています', est: 0, run: () => funnelAuditRun(kv, s.id) };
  }
  return null;
}
async function funnelAuditRun(kv, id) {
  const s = await kv.getJson(K.set(id));
  if (!s) return { fail: '完成品が見つからない' };
  const problems = funnelProblems(s);
  await kv.setJson(K.set(id), { ...s, funnel: { ver: FUNNEL_VER, at: now(), ok: !problems.length, problems } });
  if (!problems.length) return { done: `「${s.title}」は投稿して売るために必要なものがそろっている（点検済み）`, title: s.title };
  return { done: `「${s.title}」の販売導線の不足：${problems.join('・')}`, title: s.title, handoff: 'editor', what: `不足の補い（${problems.join('・')}）` };
}

// 鑑定：実績が登録されていない完成品と、足りない登録を書き出す（変わったときだけ）
export async function measureGapPlan(kv) {
  const [list, perf] = await Promise.all([kv.getJson(K.sets), kv.getJson(K.perf)]);
  const rows = perf || [];
  const need = [];
  for (const x of (list || []).filter((y) => ['adopted', 'posted'].includes(y.status)).slice(0, 40)) {
    const s = await kv.getJson(K.set(x.id));
    if (!s) continue;
    const reg = rows.filter((r) => r.setId === x.id || (r.title && String(r.title).includes(String(s.title).slice(0, 12))));
    const lacks = [];
    if (!reg.length) lacks.push('閲覧・クリック（Instagramのインサイト）');
    if (!reg.some((r) => r.orders != null)) lacks.push('成約件数');
    if (!reg.some((r) => r.reward != null)) lacks.push('確定報酬（楽天アフィリエイトのレポート）');
    if (lacks.length) need.push({ id: x.id, title: s.title, status: x.status, lacks });
  }
  return { need, rows: rows.length };
}
export async function measureGapWork(kv) {
  const plan = await measureGapPlan(kv);
  if (!plan.need.length) return null;
  const sig = JSON.stringify([plan.rows, plan.need.map((n) => [n.id, n.lacks.length])]);
  const last = await kv.getJson(K.gap);
  if (last && last.sig === sig) return null; // 状況が変わっていなければ、同じ案を作り直さない
  return { kind: 'measure-gap', task: `利益を数字で見るために足りない登録を、完成品ごとに書き出す（採用・投稿済み${plan.need.length}件・AIは使わない・0円）`, doing: '足りない計測の登録を整理しています', est: 0, run: async () => {
    const p = await measureGapPlan(kv);
    const sg = JSON.stringify([p.rows, p.need.map((n) => [n.id, n.lacks.length])]);
    await kv.setJson(K.gap, { at: now(), sig: sg, need: p.need.slice(0, 20), note: '数字は社長の登録だけを使う。利益は未計測（登録が無いものを推測しない）' });
    return { done: `計測の不足：${p.need.length}件の完成品で登録が足りない（例：「${p.need[0].title}」＝${p.need[0].lacks.join('・')}）。利益は未計測。社長の登録を待つ`, title: '計測の不足の整理' };
  } };
}
export async function gapState(kv) { return (await kv.getJson(K.gap)) || null; }
