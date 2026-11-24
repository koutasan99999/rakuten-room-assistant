// 開発の進み具合を、アプリの開発管理画面（/api/dev）に送る（2026-11-24・KOT-14）
//   送り先：WORKER_URL（本番のアプリ）・認証：CRON_SECRET（どちらも既存の Secrets。新しい鍵は使わない）
//   送れなくても開発の処理は止めない（画面の表示が遅れるだけ）。秘密の値は送らない・表示しない
import { safeText } from './lib.mjs';

export async function report(payload, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const base = String(env.WORKER_URL || '').replace(/\/+$/, '');
  const secret = String(env.CRON_SECRET || '');
  if (!base || !secret) return { sent: false, why: 'WORKER_URL・CRON_SECRET が無い' };
  const body = JSON.stringify({ ...payload, run: env.RUN_URL || payload.run || '', at: new Date().toISOString() });
  try {
    const r = await fetchImpl(`${base}/api/dev`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body, signal: AbortSignal.timeout(10000) });
    return { sent: r.ok, status: r.status };
  } catch (e) { return { sent: false, why: safeText(e && e.name, 40) }; }
}

// コマンドラインから：node report.mjs <チケット番号> <段階> <状態> [説明] [リンク]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, name, status, detail = '', link = ''] = process.argv.slice(2);
  const extra = {};
  for (const k of ['PR_URL', 'TEST_TEXT', 'REVIEW_VERDICT', 'MERGE_SHA', 'PROD_COMMIT']) if (process.env[k]) extra[k.toLowerCase()] = safeText(process.env[k], 300);
  report({ ticket: { id }, stage: { name, status, detail: safeText(detail, 600), link }, ...extra }).then((r) => console.log(`開発管理画面への記録：${r.sent ? '送った' : `送れなかった（${r.why || r.status}）`}`));
}
