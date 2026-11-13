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
