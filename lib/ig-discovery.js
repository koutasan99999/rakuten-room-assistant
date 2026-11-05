// Instagram広報部の「自動発掘」：社長がInstagramを開いてアカウントを探す作業を減らす。
// 方法1（費用0円・設定不要）：ブランドの公式サイトのHTMLから、公式サイトがリンクしているInstagramのアカウントを読む。
//   公式サイトがリンクしている＝そのブランドが自分のアカウントだと示している、という根拠になる。リンクが無ければ候補に入れない（推測で作らない）。
//   Instagramのページそのものは開かない（ログインが必要で、自動で集めることはInstagramの規約で制限されているため）。
// 方法2（費用0円・社長の設定が必要）：Instagramの公式API「Facebookログイン方式」の Business Discovery で、
//   ビジネス／クリエイターのアカウントの最近の投稿（URL・本文・日時・コメント数）を取る。今のアプリの「Instagramログイン方式」では使えない。
// 方法3（同じ設定＋Metaの審査が必要）：ハッシュタグ検索（直近24時間の投稿。投稿者名は返ってこない。7日で30種類まで）。
import { fetchPublicHtml } from './official.js';

// 公式サイト（2026-11-06 にブラウザで開き、Instagramへのリンクがあることを確認したもの）。
// html: サーバーが取るHTMLの中にリンクがあったか（false のサイトは画面の表示後にリンクが作られるため、サーバーからは読めない可能性がある）
export const OFFICIAL_SITES = {
  KINTO: { url: 'https://kinto.co.jp/', checkedAt: '2026-11-06', html: true },
  HARIO: { url: 'https://www.hario.co.jp/', checkedAt: '2026-11-06', html: true },
  'Le Creuset': { url: 'https://www.lecreuset.co.jp/', checkedAt: '2026-11-06', html: true },
  'Snow Peak': { url: 'https://www.snowpeak.co.jp/', checkedAt: '2026-11-06', html: true },
  BALMUDA: { url: 'https://www.balmuda.com/jp/', checkedAt: '2026-11-06', html: true },
  THERMOS: { url: 'https://www.thermos.jp/', checkedAt: '2026-11-06', html: true },
  BODUM: { url: 'https://www.bodum.com/jp/ja', checkedAt: '2026-11-06', html: false }
};

// Instagramのアカウントではない道（/p/ など）
const RESERVED = /^(p|reel|reels|tv|explore|stories|accounts|direct|about|legal|developer|web|privacy|terms|static|emails|sharer|share|oauth|challenge|login|_n|_u)$/i;

function normHandle(h) {
  const x = String(h || '').trim().replace(/^@/, '').replace(/\.+$/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(x) && !RESERVED.test(x) ? x : '';
}

// HTMLの中の instagram.com/アカウント名 を集める（リンク・埋め込みのJSONの両方。重複は1つ）
export function extractHandles(html) {
  const s = String(html || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const out = [];
  for (const m of s.matchAll(/(?:https?:)?\/\/(?:www\.|m\.)?instagram\.com\/([A-Za-z0-9._]{1,30})(?![A-Za-z0-9._])/gi)) {
    const h = normHandle(m[1]);
    if (h && !out.includes(h)) out.push(h);
    if (out.length >= 5) break;
  }
  return out;
}

function brandKey(b) { return String(b || '').normalize('NFKC').toLowerCase().replace(/[\s・.'’-]/g, ''); }

// 調べる公式サイトを決める：社長が登録したURL（優先）→ アプリの公式サイト一覧。どちらにも無いブランドは調べない（URLを推測しない）
export function siteTargets(brands, registered = {}) {
  const reg = {};
  for (const [b, url] of Object.entries(registered || {})) if (/^https:\/\//.test(String(url))) reg[brandKey(b)] = { brand: b, url: String(url), from: '社長が登録した公式サイト' };
  const known = {};
  for (const [b, x] of Object.entries(OFFICIAL_SITES)) known[brandKey(b)] = { brand: b, url: x.url, from: `アプリの公式サイト一覧（${x.checkedAt} 確認）` };
  const out = [];
  const missing = [];
  const seen = new Set();
  for (const b of brands) {
    const k = brandKey(b);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const t = reg[k] || known[k];
    if (t) out.push({ ...t, brand: b }); else missing.push(b);
  }
  for (const [k, t] of Object.entries(reg)) if (!seen.has(k)) { seen.add(k); out.push(t); }
  return { targets: out, missing };
}

// 公式サイトを開いて、リンクされているアカウントを返す。1サイトずつ（相手のサーバーに負担をかけない）
export async function discoverFromSites(targets, { fetchHtml = fetchPublicHtml, now = () => new Date(), until = Date.now() + 40000 } = {}) {
  const results = [];
  for (const t of targets.slice(0, 10)) {
    if (Date.now() + 3000 > until) { results.push({ ...t, handles: [], error: '時間切れのため、今回は調べていません' }); continue; }
    try {
      const { html, url } = await fetchHtml(t.url);
      const handles = extractHandles(html);
      results.push({ ...t, pageUrl: url, handles, checkedAt: now().toISOString(), error: handles.length ? '' : '公式サイトのHTMLにInstagramへのリンクが見つかりませんでした（画面の表示後にリンクを作るサイトは、ここからは読めません）' });
    } catch (e) {
      results.push({ ...t, handles: [], checkedAt: now().toISOString(), error: `公式サイトを開けませんでした（${String(e.message || e).slice(0, 80)}）` });
    }
  }
  return results;
}

// ---- 方法2・3：Instagram API with Facebook Login（graph.facebook.com） ----
export class FbIgError extends Error {}

export function fbConfig(env) {
  const token = String(env.IG_FB_ACCESS_TOKEN || '').trim();
  const userId = String(env.IG_FB_USER_ID || '').trim();
  return { ready: !!(token && /^\d+$/.test(userId)), token, userId, base: `https://graph.facebook.com/${String(env.IG_FB_API_VERSION || 'v23.0').trim()}`, hashtagEnabled: String(env.IG_HASHTAG_SEARCH || '') === 'on' };
}

async function fbCall(cfg, path, params = {}, fetchImpl = fetch) {
  const qs = new URLSearchParams({ ...params, access_token: cfg.token });
  let res;
  try { res = await fetchImpl(`${cfg.base}${path}?${qs}`, { signal: AbortSignal.timeout(15000) }); } catch (e) { throw new FbIgError(`InstagramのAPIに接続できませんでした（${e.name}）`); }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    const msg = data && data.error ? String(data.error.message || '').replace(/access_token=[^&\s]+/g, 'access_token=***').slice(0, 200) : '';
    throw new FbIgError(`InstagramのAPIエラー（${res.status}${msg ? `: ${msg}` : ''}）`);
  }
  return data;
}

const MEDIA_FIELDS = 'id,caption,permalink,timestamp,comments_count,like_count,media_type';

// ビジネス／クリエイターのアカウントの公開情報と最近の投稿（個人アカウントは取れない）
export async function businessDiscovery(cfg, username, { limit = 6, fetchImpl } = {}) {
  const h = normHandle(username);
  if (!h) throw new FbIgError('アカウント名が読み取れません');
  const fields = `business_discovery.username(${h}){username,name,followers_count,media_count,media.limit(${Math.max(1, Math.min(12, limit))}){${MEDIA_FIELDS}}}`;
  const d = await fbCall(cfg, `/${cfg.userId}`, { fields }, fetchImpl);
  const b = d.business_discovery || {};
  return {
    handle: b.username || h, name: b.name || '', followers: b.followers_count ?? null, mediaCount: b.media_count ?? null,
    media: ((b.media && b.media.data) || []).map((m) => ({ url: m.permalink || '', caption: String(m.caption || '').slice(0, 1000), timestamp: m.timestamp || '', comments: m.comments_count ?? null, likes: m.like_count ?? null, type: m.media_type || '' })).filter((m) => /^https:\/\/www\.instagram\.com\//.test(m.url))
  };
}

// コメント候補にしてよい投稿：直近 hours 時間以内・本文がある・コメント欄が荒れていない（多すぎる投稿は埋もれるので外す）
export function freshPosts(media, { hours = 72, maxComments = 300, now = Date.now() } = {}) {
  return (media || []).filter((m) => m.caption && m.timestamp && now - new Date(m.timestamp).getTime() <= hours * 3600000 && (m.comments == null || m.comments <= maxComments));
}

// ハッシュタグの直近24時間の投稿（Metaの審査「Instagram Public Content Access」が必要。投稿者名は返らない）
export async function hashtagRecent(cfg, tag, { limit = 25, fetchImpl } = {}) {
  if (!cfg.hashtagEnabled) throw new FbIgError('ハッシュタグ検索はオフです（Metaの審査が通ったあと、IG_HASHTAG_SEARCH=on にします）');
  const q = String(tag || '').replace(/^#/, '').trim();
  if (!q) throw new FbIgError('ハッシュタグが空です');
  const s = await fbCall(cfg, '/ig_hashtag_search', { user_id: cfg.userId, q }, fetchImpl);
  const id = s.data && s.data[0] && s.data[0].id;
  if (!id) return [];
  const r = await fbCall(cfg, `/${id}/recent_media`, { user_id: cfg.userId, fields: 'id,caption,permalink,timestamp,comments_count,like_count,media_type', limit: String(Math.min(50, limit)) }, fetchImpl);
  return (r.data || []).map((m) => ({ url: m.permalink || '', caption: String(m.caption || '').slice(0, 1000), timestamp: m.timestamp || '', comments: m.comments_count ?? null, likes: m.like_count ?? null, tag: q })).filter((m) => /^https:\/\/www\.instagram\.com\//.test(m.url));
}
