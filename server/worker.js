// 自律運営のAPI（2026-11-14）：/api/worker
// action: tick（定期実行：GitHub Actions／Vercel Cron。合言葉 CRON_SECRET が必要）／pause・resume（社長の停止スイッチ）／sync（アプリ→サーバー：仕事を選ぶための情報）／state（サーバー→アプリ：状態・成果物・記録）
// 保存場所（Upstash Redis の無料枠）が設定されていなければ「未接続」と返し、何もしない（今までの機能には影響しない）。
import crypto from 'node:crypto';
import { send, readBody, requestReferer } from '../lib/http.js';
import { kvFrom } from '../lib/kv.js';
import { tick, state, readSnapshot, setPaused, WORKER_KEYS } from '../lib/worker.js';
import { maskSecrets } from '../lib/ai.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  const url = new URL(req.url || '/', 'http://localhost');
  const body = req.method === 'POST' ? await readBody(req) : {};
  const action = String(body.action || url.searchParams.get('action') || (req.method === 'GET' ? 'tick' : 'state'));
  const kv = kvFrom(env);
  if (action === 'tick') {
    // 定期実行：合言葉が一致したときだけ（GitHub Actions も Vercel Cron も Authorization: Bearer で送る）
    if (!env.CRON_SECRET || !same(String(req.headers.authorization || ''), `Bearer ${env.CRON_SECRET}`)) return send(res, 401, { error: '定期実行の合言葉が違います' });
    if (!kv) return send(res, 200, { ok: false, configured: false, notice: '保存場所（Upstash Redis）が未接続のため、自律運営は動きません' });
    try {
      // 起動のきっかけ（schedule＝GitHubの定期実行／workflow_dispatch＝手動／vercel-cron）を記録する（定期実行が本当に動いたかの証拠）
      const trigger = String(req.headers['x-trigger'] || (req.method === 'GET' ? 'vercel-cron' : 'unknown')).replace(/[^a-z_-]/gi, '').slice(0, 30);
      return send(res, 200, await tick({ kv, env, referer: requestReferer(req, env), startedAt, trigger }));
    } catch (e) {
      return send(res, 200, { ok: false, error: maskSecrets(String(e && e.message || e)).slice(0, 300) });
    }
  }
  // 画面から：合言葉
  if (env.APP_PASSCODE && !same(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  if (!kv) return send(res, 200, { configured: false, notice: '保存場所（Upstash Redis の無料枠）が未接続のため、自律運営は動いていません。アプリを開いたときだけ動く今までの機能は、そのまま使えます。' });
  try {
    if (action === 'sync') {
      const snap = readSnapshot(body.snapshot);
      await kv.setJson(WORKER_KEYS.snap, snap);
      return send(res, 200, { ok: true, at: snap.at, outreachPosts: snap.outreachPosts.length, themes: snap.themes.length });
    }
    if (action === 'state') return send(res, 200, await state(kv, env));
    // 停止スイッチ：止めている間は定期実行が何もしない（AIを呼ばない）。途中の仕事・成果物・記録は消さない
    if (action === 'pause' || action === 'resume') return send(res, 200, { ok: true, paused: await setPaused(kv, action === 'pause', String(body.reason || '').slice(0, 100)) });
    return send(res, 400, { error: '操作が分かりません' });
  } catch (e) {
    return send(res, 200, { configured: true, ok: false, error: maskSecrets(String(e && e.message || e)).slice(0, 300) });
  }
}
