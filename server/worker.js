// 自律運営のAPI（2026-11-14）：/api/worker
// action: tick（定期実行：QStash（署名）／GitHub Actions・Vercel Cron（合言葉 CRON_SECRET））／pause・resume（社長の停止スイッチ）／sync（アプリ→サーバー：仕事を選ぶための情報）／state（サーバー→アプリ：状態・成果物・記録）
// 保存場所（Upstash Redis の無料枠）が設定されていなければ「未接続」と返し、何もしない（今までの機能には影響しない）。
import crypto from 'node:crypto';
import { send, readBody, requestReferer } from '../lib/http.js';
import { kvFrom } from '../lib/kv.js';
import { tick, state, readSnapshot, setPaused, WORKER_KEYS } from '../lib/worker.js';
import { maskSecrets } from '../lib/ai.js';
import { verifyQstash } from '../lib/qstash.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  const url = new URL(req.url || '/', 'http://localhost');
  const body = req.method === 'POST' ? await readBody(req) : {};
  // QStash の呼び出し（署名つき）は、URLに ?action=tick が無くても定期実行として扱う
  const action = String(body.action || url.searchParams.get('action') || (req.method === 'GET' || req.headers['upstash-signature'] ? 'tick' : 'state'));
  const kv = kvFrom(env);
  if (action === 'tick') {
    // 定期実行の認証：(1) QStash の署名（Upstash-Signature）か、(2) 合言葉（GitHub Actions・Vercel Cron が Authorization: Bearer で送る）
    let trigger = '';
    if (req.headers['upstash-signature']) {
      // 本文：Vercel が先に読んで形を変えることがあるため、ありうる元の形（文字列・空・{}・JSON）のどれかで要約値が一致すればよい（署名そのものは偽造できない）
      const bodies = [typeof req.body === 'string' ? req.body : '', '', '{}', req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : ''];
      const keys = [env.QSTASH_CURRENT_SIGNING_KEY, env.QSTASH_NEXT_SIGNING_KEY];
      const v = [...new Set(bodies)].map((b) => verifyQstash({ signature: req.headers['upstash-signature'], body: b, keys })).find((x) => x.ok) || verifyQstash({ signature: req.headers['upstash-signature'], body: bodies[0], keys });
      if (!v.ok) {
        // 断った理由を残す（定期実行が動かないときの原因を、手動の実行のログと画面で確かめられるように）
        if (kv) await kv.setJson('worker:qstash:reject', { at: new Date().toISOString(), why: v.why, keys: keys.filter(Boolean).length, method: req.method, contentType: String(req.headers['content-type'] || '').slice(0, 60) }).catch(() => {});
        return send(res, 401, { error: `QStash の署名を確かめられません：${v.why}` });
      }
      trigger = 'qstash';
    } else if (!env.CRON_SECRET || !same(String(req.headers.authorization || ''), `Bearer ${env.CRON_SECRET}`)) return send(res, 401, { error: '定期実行の合言葉が違います' });
    if (!kv) return send(res, 200, { ok: false, configured: false, notice: '保存場所（Upstash Redis）が未接続のため、自律運営は動きません' });
    try {
      // 起動のきっかけ（qstash＝QStashの定期実行／schedule＝GitHubの定期実行／workflow_dispatch＝手動／vercel-cron）を記録する（定期実行が本当に動いたかの証拠）
      trigger = trigger || String(req.headers['x-trigger'] || (req.method === 'GET' ? 'vercel-cron' : 'unknown')).replace(/[^a-z_-]/gi, '').slice(0, 30);
      // QStash のやり直し（同じ呼び出しの再送）は、2回目以降は何もしない（同じ仕事を二重に進めない）
      const mid = String(req.headers['upstash-message-id'] || '').replace(/[^\w-]/g, '').slice(0, 80);
      if (trigger === 'qstash' && mid && !(await kv.set(`worker:qstash:${mid}`, '1', { nx: true, ex: 3600 }))) return send(res, 200, { ok: true, skipped: '同じ呼び出しの再送のため、何もしません（二重実行の防止）' });
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
