// Instagramの公式APIのAPI：action: status（設定と基本の数字）／insights（アカウントと最近の投稿の数字）／refresh（トークンの更新）／publish（自分の投稿）
// トークンが設定されていなければ「未設定」と返すだけ。他人へのフォロー・コメントの機能はない。
import { send, readBody } from '../lib/http.js';
import crypto from 'node:crypto';
import { igConfig, accountSummary, accountInsights, recentMedia, refreshToken, publish } from '../lib/ig-graph.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

export default async function handler(req, res, env = process.env) {
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
    if (action === 'refresh') { const r = await refreshToken(cfg); return send(res, 200, { ready: true, refreshed: true, expiresIn: r.expires_in, notice: '新しいトークンを環境変数に入れ直してください（Vercelの設定）。' }); }
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
