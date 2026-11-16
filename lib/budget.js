// AIの費用の上限をサーバー側で守る（自律運営・2026-11-14）。保存場所（lib/kv.js）があるときだけ動く。
// 月の上限（BUDGET_MONTHLY_YEN・初期1000円）は、画面から呼んだAIも、自律運営のAIも、すべての実測の費用を合わせて数える。
// 自律運営だけの1日の上限（AUTONOMY_DAILY_YEN・初期25円）も別に持つ（月の上限を自律運営だけで使い切らないように）。
// 上限を超えたら、それ以上AIを呼ばない（画面から呼んだ場合も止める）。
const DEFAULT_MONTH = 1000;
const DEFAULT_DAY_AUTO = 25;

export function jstDate(d = new Date()) { return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function limits(env) {
  const month = Number(env.BUDGET_MONTHLY_YEN) > 0 ? Math.min(1000, Number(env.BUDGET_MONTHLY_YEN)) : DEFAULT_MONTH;
  const dayAuto = Number(env.AUTONOMY_DAILY_YEN) > 0 ? Math.min(month, Number(env.AUTONOMY_DAILY_YEN)) : DEFAULT_DAY_AUTO;
  return { month, dayAuto };
}
const keys = (d = new Date()) => ({ month: `budget:month:${jstDate(d).slice(0, 7)}`, dayAuto: `budget:auto:${jstDate(d)}` });

export async function spent(kv, d = new Date()) {
  const k = keys(d);
  const [m, a] = await Promise.all([kv.get(k.month), kv.get(k.dayAuto)]);
  return { month: Math.round((Number(m) || 0) * 1000) / 1000, dayAuto: Math.round((Number(a) || 0) * 1000) / 1000 };
}

// これから使う見込み（estimate 円）を足しても上限を超えないか。超えるなら理由を返す
export async function check(kv, env, { estimate = 0, auto = false, d = new Date() } = {}) {
  const lim = limits(env);
  const s = await spent(kv, d);
  if (s.month + estimate > lim.month) return { ok: false, reason: `今月のAIの費用が上限（${lim.month}円）に達するため止めました（今月の実測 ${s.month}円）`, spent: s, limits: lim };
  if (auto && s.dayAuto + estimate > lim.dayAuto) return { ok: false, reason: `今日の自律運営の費用が上限（${lim.dayAuto}円）に達するため止めました（今日 ${s.dayAuto}円）`, spent: s, limits: lim };
  return { ok: true, spent: s, limits: lim };
}

// 実際に使った費用（実測）を記録する
export async function record(kv, yen, { auto = false, d = new Date() } = {}) {
  const y = Number(yen) || 0;
  if (y <= 0) return;
  const k = keys(d);
  await kv.incrFloat(k.month, y);
  await kv.expire(k.month, 60 * 86400);
  if (auto) { await kv.incrFloat(k.dayAuto, y); await kv.expire(k.dayAuto, 3 * 86400); }
}

// ---- 画像生成の費用（社長の決定：画像専用に月200円。全体の月1,000円の中で数える） ----
// 2026-11-16 社長の決定：「画像は1日1枚」の固定制限をやめ、月200円の範囲で、枚数とタイミングはAI社員が判断する。
//   ただし月初に使い切らないよう、1日に使える目安を「画像の月の残り ÷ 月末までの日数 × 3」とする（必要な日には複数枚描ける）
//   また、画像だけで全体の予算を使い切らないよう、全体の月の予算のうち TEXT_RESERVE_YEN は文章などほかの工程に残す
// 画像は文章のAIより1回が高いので、自律運営の1日25円（文章のAI）とは別に数える（画像1枚で文章の仕事が止まらないように）
const DEFAULT_IMAGE_MONTH = 200;
export const IMAGE_PACE = 3;          // 1日に使える目安 = 月の残り ÷ 残りの日数 × この数
export const TEXT_RESERVE_YEN = 100;  // 全体の月の予算のうち、画像に使わずに残す額
export const IMAGE_ESTIMATE_YEN = 20; // 1枚を呼ぶ前に見込む額（推定 10〜18円に余裕を足した値）
export function imageLimits(env) {
  const lim = limits(env);
  const month = Number(env.IMAGE_MONTHLY_YEN) > 0 ? Math.min(lim.month, Number(env.IMAGE_MONTHLY_YEN)) : DEFAULT_IMAGE_MONTH;
  return { month, total: lim.month, reserve: TEXT_RESERVE_YEN };
}
const imageKeys = (d = new Date()) => ({ month: `budget:image:month:${jstDate(d).slice(0, 7)}`, day: `budget:image:count:${jstDate(d)}`, dayYen: `budget:image:yen:${jstDate(d)}` });
const daysLeft = (d = new Date()) => { const j = new Date(d.getTime() + 9 * 3600000); const last = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth() + 1, 0)).getUTCDate(); return last - j.getUTCDate() + 1; };
export async function imageSpent(kv, d = new Date()) {
  const k = imageKeys(d);
  const [m, c, y] = await Promise.all([kv.get(k.month), kv.get(k.day), kv.get(k.dayYen)]);
  return { month: Math.round((Number(m) || 0) * 1000) / 1000, dayCount: Number(c) || 0, dayYen: Math.round((Number(y) || 0) * 1000) / 1000 };
}
// 今日、画像に使える目安（円）
export function imageDayAllowance(lim, img, d = new Date()) {
  const left = Math.max(0, lim.month - (img.month - img.dayYen)); // 今日より前に使った分を引いた、今日の始めの残り
  return Math.round((left / daysLeft(d)) * IMAGE_PACE * 10) / 10;
}
// 画像を1枚作ってよいか（全体の月の上限と、ほかの工程に残す額・画像の月の上限・今日の目安）
export async function imageCheck(kv, env, { estimate = IMAGE_ESTIMATE_YEN, d = new Date() } = {}) {
  const lim = imageLimits(env);
  const all = await spent(kv, d);
  const img = await imageSpent(kv, d);
  if (all.month + estimate > lim.total - lim.reserve) return { ok: false, reason: `今月のAIの費用（${all.month}円）が全体の上限（${lim.total}円）に近いため、画像は作らない（文章などほかの工程に${lim.reserve}円を残す）`, limits: lim, spent: img };
  if (img.month + estimate > lim.month) return { ok: false, reason: `今月の画像の費用が上限（${lim.month}円）に達するため、画像は作らない（今月 ${img.month}円）`, limits: lim, spent: img };
  const allow = imageDayAllowance(lim, img, d);
  if (img.dayYen + estimate > Math.max(allow, estimate)) return { ok: false, reason: `今日の画像の目安（${allow}円：月の残りを月末まで配分）に達したため、続きは明日描く（今日 ${img.dayYen}円）`, limits: lim, spent: img };
  return { ok: true, limits: lim, spent: img, allowance: allow };
}
// 1枚呼んだら記録する（失敗・時間切れでも、OpenAI側で費用がかかった可能性があるので見込みの額で数える）
export async function imageRecord(kv, yen, { d = new Date() } = {}) {
  const k = imageKeys(d);
  const y = Math.max(0, Number(yen) || 0);
  await kv.incr(k.day); await kv.expire(k.day, 3 * 86400);
  if (y > 0) { await kv.incrFloat(k.dayYen, y); await kv.expire(k.dayYen, 3 * 86400); await kv.incrFloat(k.month, y); await kv.expire(k.month, 60 * 86400); await record(kv, y, { auto: false, d }); }
}
