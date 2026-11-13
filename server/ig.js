// Instagramの公式APIのAPI：action: status（設定と基本の数字）／insights（アカウントと最近の投稿の数字）／media（P0：投稿ごとの実績）／refresh（トークンの更新）／publish（自分の投稿）
// トークンが設定されていなければ「未設定」と返すだけ。他人へのフォロー・コメントの機能はない。
import { send, readBody } from '../lib/http.js';
import crypto from 'node:crypto';
import { igConfig, accountSummary, accountInsights, recentMedia, followTypeBreakdown, refreshToken, publish, publishNext } from '../lib/ig-graph.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

function baseUrlOf(req, env) {
  return String(env.PUBLIC_BASE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host || ''}`).replace(/\/$/, '');
}

// 予定の投稿を1件出す（Vercelの定期実行と、アプリの両方から使う）
async function runPublishNext(req, env, cfg) {
  const base = baseUrlOf(req, env);
  const q = await fetch(`${base}/data/post-queue.json`, { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!q) return { done: false, reason: '投稿の予定（data/post-queue.json）を読めませんでした' };
  return publishNext(cfg, { queue: q, baseUrl: base });
}

export default async function handler(req, res, env = process.env) {
  // Vercelの定期実行（1日1回）：CRON_SECRET が一致したときだけ、予定の投稿を1件出す
  if (req.method === 'GET') {
    const auth = String(req.headers.authorization || '');
    if (!env.CRON_SECRET || !same(auth, `Bearer ${env.CRON_SECRET}`)) return send(res, 401, { error: '定期実行の合言葉が違います' });
    const cfg = igConfig(env);
    if (!cfg.ready || !cfg.publishEnabled) return send(res, 200, { done: false, reason: '投稿の設定（IG_ACCESS_TOKEN・IG_PUBLISH_ENABLED=1）がまだです' });
    try { const r = await runPublishNext(req, env, cfg); console.log('[ig cron]', JSON.stringify(r)); return send(res, 200, r); } catch (e) { console.error('[ig cron] error', e.message); return send(res, 502, { done: false, error: e.message }); }
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (env.APP_PASSCODE && !same(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  const cfg = igConfig(env);
  const body = await readBody(req);
  const action = String(body.action || 'status');
  if (!cfg.ready) return send(res, 200, { ready: false, notice: 'Instagramの公式APIのトークン（IG_ACCESS_TOKEN）がまだ設定されていません。' });
  try {
    if (action === 'status') return send(res, 200, { ready: true, publishEnabled: cfg.publishEnabled, dailyLimit: cfg.dailyLimit, account: await accountSummary(cfg) });
    if (action === 'insights') {
      const days = Math.max(1, Math.min(30, Number(body.days) || 7));
      return send(res, 200, { ready: true, account: await accountSummary(cfg), insights: await accountInsights(cfg, { days }), media: await recentMedia(cfg, { limit: 10 }) });
    }
    // P0：投稿ごとの実績（最近の投稿・最大12件。追加の指標と、アカウント全体のフォロワー以外の内訳も）。取れない指標は null／error のまま返す（推測で埋めない）
    if (action === 'media') {
      const limit = Math.max(1, Math.min(12, Number(body.limit) || 12));
      return send(res, 200, { ready: true, fetchedAt: new Date().toISOString(), account: await accountSummary(cfg), followType: await followTypeBreakdown(cfg, { days: 7 }), media: await recentMedia(cfg, { limit, extra: true }) });
    }
    if (action === 'refresh') {
      // 長期トークンの期限を延ばす。返ってきたトークンが今と同じなら、入れ直しは要らない（違うときだけ知らせる。トークン自体は返さない）
      const r = await refreshToken(cfg);
      const changed = !!r.access_token && r.access_token !== cfg.token;
      return send(res, 200, { ready: true, refreshed: true, expiresIn: r.expires_in, changed, notice: changed ? '新しいトークンが発行されました。Vercelの環境変数 IG_ACCESS_TOKEN の入れ直しが必要です。' : '期限を延ばしました（入れ直しは不要）。' });
    }
    if (action === 'publish-next') return send(res, 200, { ready: true, ...(await runPublishNext(req, env, cfg)) });
    if (action === 'publish') {
      const kind = String(body.kind || '');
      const caption = String(body.caption || '').slice(0, 2200);
      const imageUrls = (Array.isArray(body.imageUrls) ? body.imageUrls : []).map(String).slice(0, 10);
      return send(res, 200, { ready: true, published: await publish(cfg, { kind, imageUrls, videoUrl: String(body.videoUrl || ''), caption }) });
    }
    return send(res, 400, { error: '操作が分かりません' });
  } catch (e) {
    return send(res, 502, { ready: true, error: e.message });
  }
}
