// Instagram広報部の自動発掘のAPI。
// action: status（使える方法）／sites（公式サイトからアカウントを探す）／recent（候補アカウントの最近の投稿：Facebookログイン方式の設定が必要）／hashtag（ハッシュタグの直近の投稿：Metaの審査が必要）
// フォロー・コメントは送らない（公式APIに第三者への操作は無い）。
import { send, readBody } from '../lib/http.js';
import crypto from 'node:crypto';
import { siteTargets, discoverFromSites, fbConfig, businessDiscovery, freshPosts, hashtagRecent, OFFICIAL_SITES } from '../lib/ig-discovery.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const strs = (v, n, m) => (Array.isArray(v) ? v : []).map((x) => String(x == null ? '' : x).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, m)).filter(Boolean).slice(0, n);

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (env.APP_PASSCODE && !same(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  const body = await readBody(req);
  const action = String(body.action || 'status');
  const fb = fbConfig(env);
  try {
    if (action === 'status') {
      return send(res, 200, { sites: true, knownSites: Object.keys(OFFICIAL_SITES).length, recent: fb.ready, hashtag: fb.ready && fb.hashtagEnabled });
    }
    if (action === 'sites') {
      const registered = {};
      const reg = body.registered && typeof body.registered === 'object' ? body.registered : {};
      for (const [b, u] of Object.entries(reg).slice(0, 30)) registered[String(b).slice(0, 40)] = String(u).slice(0, 300);
      const { targets, missing } = siteTargets(strs(body.brands, 40, 40), registered);
      const results = await discoverFromSites(targets, { until: startedAt + 45000 });
      return send(res, 200, { results, missing });
    }
    if (action === 'recent') {
      if (!fb.ready) return send(res, 200, { ready: false, notice: 'Facebookログイン方式の設定（IG_FB_ACCESS_TOKEN・IG_FB_USER_ID）がまだです。' });
      const out = [];
      const errors = [];
      for (const h of strs(body.handles, 8, 30)) {
        if (Date.now() + 4000 > startedAt + 45000) break;
        try {
          const b = await businessDiscovery(fb, h);
          out.push({ handle: b.handle, followers: b.followers, posts: freshPosts(b.media, { hours: Math.max(24, Math.min(168, Number(body.hours) || 72)) }) });
        } catch (e) { errors.push({ handle: h, error: e.message }); }
      }
      return send(res, 200, { ready: true, accounts: out, errors, checkedAt: new Date().toISOString() });
    }
    if (action === 'hashtag') {
      if (!fb.ready) return send(res, 200, { ready: false, notice: 'Facebookログイン方式の設定がまだです。' });
      const tag = String(body.tag || '').slice(0, 40);
      return send(res, 200, { ready: true, posts: freshPosts(await hashtagRecent(fb, tag), { hours: 24 }), checkedAt: new Date().toISOString() });
    }
    return send(res, 400, { error: '操作が分かりません' });
  } catch (e) {
    return send(res, 502, { error: String(e.message || e).slice(0, 200) });
  }
}
