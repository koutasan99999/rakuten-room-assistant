// Instagram広報部の自動発掘のAPI。
// action: outreach_draft（営業・交流担当AI：コメント案＋コードの確認）／outreach_audit（監査AI：採点・判定）／status（使える方法）／sites（公式サイトからアカウントを探す）／recent（候補アカウントの最近の投稿：Facebookログイン方式の設定が必要）／hashtag（ハッシュタグの直近の投稿：Metaの審査が必要）
// フォロー・コメントは送らない（公式APIに第三者への操作は無い）。
import { send, readBody } from '../lib/http.js';
import crypto from 'node:crypto';
import { draftStep, auditStep as outreachAudit, checkComment, decide as outreachDecide, readPosts } from '../lib/outreach.js';
import { MAX_REVISIONS } from '../lib/agents.js';
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
    // 営業・交流担当AI（第2段階）：文章を確認できた投稿だけにコメント案を作り、コードで確認する。送信はしない
    if (action === 'outreach_draft' || action === 'outreach_audit') {
      if (!env.OPENAI_API_KEY) return send(res, 200, { ok: false, failedStep: '準備', error: 'サーバーの設定（OpenAIのキー）がありません' });
      const posts = readPosts(body.posts);
      if (!posts.length) return send(res, 400, { ok: false, failedStep: '準備', error: '投稿がありません（InstagramのURLが必要です）' });
      const past = strs(body.past, 50, 120);
      if (action === 'outreach_draft') {
        const revise = Array.isArray(body.revise) ? body.revise.slice(0, 5).map((r) => ({ id: String(r && r.id || '').slice(0, 40), comment: String(r && r.comment || '').slice(0, 120), anchor: String(r && r.anchor || '').slice(0, 80), why: String(r && r.why || '').slice(0, 200), fixes: strs(r && r.fixes, 4, 140) })).filter((r) => r.id) : null;
        const r = await draftStep({ posts, themes: strs(body.themes, 12, 40), past, env, startedAt, revise: revise && revise.length ? revise : null });
        if (r.ok) r.checks = r.drafts.map((d) => checkComment(d, posts.find((p) => p.id === d.id), past));
        return send(res, 200, r);
      }
      const drafts = (Array.isArray(body.drafts) ? body.drafts : []).slice(0, 5).map((d) => ({ id: String(d && d.id || '').slice(0, 40), comment: String(d && d.comment || '').slice(0, 120), anchor: String(d && d.anchor || '').slice(0, 80) })).filter((d) => d.id);
      // コードの確認は、サーバーでやり直す（画面から送られた結果を信じない）
      const checks = drafts.map((d) => checkComment(d, posts.find((p) => p.id === d.id) || {}, past));
      const r = await outreachAudit({ posts, drafts, checks, model: String(body.model || '').slice(0, 40), env, startedAt });
      if (r.ok) {
        const rev = body.revisions && typeof body.revisions === 'object' ? body.revisions : {};
        r.checks = checks;
        r.decisions = drafts.map((d) => ({ id: d.id, ...outreachDecide({ check: checks.find((k) => k.id === d.id), audit: r.audits.find((a) => a.id === d.id) || null, revisions: Math.max(0, Math.min(MAX_REVISIONS, Number(rev[d.id]) || 0)) }) }));
      }
      return send(res, 200, r);
    }
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
