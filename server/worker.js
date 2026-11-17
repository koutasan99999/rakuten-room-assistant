// 自律運営のAPI（2026-11-14）：/api/worker
// action: tick（定期実行：QStash（署名）／GitHub Actions・Vercel Cron（合言葉 CRON_SECRET））／pause・resume（社長の停止スイッチ）／sync（アプリ→サーバー：仕事を選ぶための情報）／state（サーバー→アプリ：状態・成果物・記録）
// 保存場所（Upstash Redis の無料枠）が設定されていなければ「未接続」と返し、何もしない（今までの機能には影響しない）。
import crypto from 'node:crypto';
import { send, readBody, requestReferer } from '../lib/http.js';
import { kvFrom } from '../lib/kv.js';
import { tick, state, readSnapshot, setPaused, WORKER_KEYS } from '../lib/worker.js';
import * as V2 from '../lib/v2/company.js';
import { v1Enabled } from '../lib/v1-retired.js';
const V = V2;
const V2_CHAIN_MS = 6000; // 1.0がこの時間までに終わったら、同じ回で2.0を進める（関数の上限60秒の内側）
import { maskSecrets } from '../lib/ai.js';
import { verifyQstash, keyInfo, readRawBody } from '../lib/qstash.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

// このアプリ自身のURL（表紙画像の生成で、マスター画像を自分のサイトから取るため）
function appOrigin(req, env) {
  const prod = String(env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  if (prod) return `https://${prod.replace(/^https?:\/\//, '')}/`;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `https://${host}/`;
}

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  const url = new URL(req.url || '/', 'http://localhost');
  // QStash の呼び出し（署名つき）は、req.body に触れる前に生の本文を読む（署名の検証に、加工されていない本文が必要）
  const signed = !!req.headers['upstash-signature'];
  const rawBody = signed ? await readRawBody(req) : null;
  const body = signed ? {} : req.method === 'POST' ? await readBody(req) : {};
  // QStash の呼び出し（署名つき）は、URLに ?action=tick が無くても定期実行として扱う
  const action = String(body.action || url.searchParams.get('action') || (req.method === 'GET' || req.headers['upstash-signature'] ? 'tick' : 'state'));
  const kv = kvFrom(env);
  if (action === 'tick') {
    // 定期実行の認証：(1) QStash の署名（Upstash-Signature）か、(2) 合言葉（GitHub Actions・Vercel Cron が Authorization: Bearer で送る）
    let trigger = '';
    if (req.headers['upstash-signature']) {
      // 生の本文そのもので厳密に確かめる（本文を作り直したり、候補を試したりしない）
      const keys = [env.QSTASH_CURRENT_SIGNING_KEY, env.QSTASH_NEXT_SIGNING_KEY];
      const v = verifyQstash({ signature: req.headers['upstash-signature'], body: rawBody, keys });
      if (!v.ok) {
        // 断った理由を残す（定期実行が動かないときの原因を、手動の実行のログと画面で確かめられるように）
        // 鍵の値・署名そのものは残さない（設定の有無・形・本文の長さ・呼び先のパスだけ）
        let sub = '';
        try { sub = new URL(JSON.parse(Buffer.from(String(req.headers['upstash-signature']).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).sub).pathname; } catch { sub = '読めない'; }
        if (kv) await kv.setJson('worker:qstash:reject', { at: new Date().toISOString(), why: v.why, keyInfo: keyInfo(keys), method: req.method, contentType: String(req.headers['content-type'] || '').slice(0, 60), rawBodyRead: Buffer.isBuffer(rawBody), bodyLength: Buffer.isBuffer(rawBody) ? rawBody.length : null, subPath: sub.slice(0, 60) }).catch(() => {});
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
      // サングラスくま株式会社 2.0（2026-11-15）：社長が切り替えた（v2:active）とき、または手動の実行で target=v2 と指定したときだけ2.0を動かす。それ以外は今までどおり1.0
      // 切り替えの前（動作確認中）は、QStash の定期実行を1.0と2.0で交互に使う（2026-11-16：2.0が手動の実行のときしか動かず、オフィスで誰も働いて見えなかったため）
      // 1.0は運用終了（2026-11-17）：定期実行・手動の実行（target=v1）・Vercelの1日1回は、すべて2.0だけを動かす（V1_ENABLED=1 のときだけ今までどおり）
      let runV2 = !v1Enabled(env) || (await V2.isActive(kv)) || (trigger !== 'qstash' && (body.target === 'v2' || url.searchParams.get('target') === 'v2'));
      if (!runV2 && trigger === 'qstash') runV2 = (await kv.incr('v2:alt')) % 2 === 0;
      if (runV2) return send(res, 200, { company: 'v2', ...(await V2.tick({ kv, env, referer: requestReferer(req, env), origin: appOrigin(req, env), startedAt, trigger })) });
      const r1 = await tick({ kv, env, referer: requestReferer(req, env), origin: appOrigin(req, env), startedAt, trigger });
      // 1.0の番でも、1.0がすぐに終わった（仕事が無い・止まっている）ときは、同じ回で2.0を進める（2026-11-16：1.0の番の15分が空回りしていた）
      if (trigger === 'qstash' && !r1.worked && Date.now() - startedAt < V2_CHAIN_MS) return send(res, 200, { ...r1, v2: { company: 'v2', ...(await V.tick({ kv, env, referer: requestReferer(req, env), origin: appOrigin(req, env), startedAt: Date.now(), trigger: 'qstash' })) } });
      return send(res, 200, r1);
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
    if (action === 'state') {
      const st = await state(kv, env);
      // 1.0は運用終了：途中だった1.0の仕事は保存したまま、「仕事中・途中」とは表示しない（定期実行では進めない）
      if (!v1Enabled(env)) return send(res, 200, { ...st, job: null, stoppedJob: st.job, retired: true, notice: '1.0は運用を終了しました（2026-11-17）。途中だった仕事は保存したまま止めています' });
      return send(res, 200, st);
    }
    // 停止スイッチ：止めている間は定期実行が何もしない（AIを呼ばない）。途中の仕事・成果物・記録は消さない
    if (action === 'pause' || action === 'resume') return send(res, 200, { ok: true, paused: await setPaused(kv, action === 'pause', String(body.reason || '').slice(0, 100)) });
    return send(res, 400, { error: '操作が分かりません' });
  } catch (e) {
    return send(res, 200, { configured: true, ok: false, error: maskSecrets(String(e && e.message || e)).slice(0, 300) });
  }
}
