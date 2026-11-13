// Instagramの公式API（Instagram API with Instagram Login）で、自分のアカウントの数字を読む・自分の投稿を出す。
// 他人へのフォロー・いいね・コメントはできない（公式APIにその機能はなく、ブラウザの自動操作は規約で禁止されているため作らない）。
// トークン（IG_ACCESS_TOKEN）はサーバーの環境変数だけに置き、画面には出さない。設定されていなければ何もしない。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class IgError extends Error {}

export function igConfig(env) {
  const token = String(env.IG_ACCESS_TOKEN || '').trim();
  return {
    ready: !!token,
    token,
    userId: String(env.IG_USER_ID || '').trim() || 'me',
    base: `https://graph.instagram.com/${String(env.IG_API_VERSION || 'v23.0').trim()}`,
    // 投稿は、社長が環境変数でオンにしたときだけ（IG_PUBLISH_ENABLED=1）。1日の上限も決めておく
    publishEnabled: String(env.IG_PUBLISH_ENABLED || '') === '1',
    dailyLimit: Math.max(1, Math.min(5, Number(env.IG_DAILY_POST_LIMIT) || 1))
  };
}

async function call(cfg, path, { method = 'GET', params = {} } = {}) {
  const qs = new URLSearchParams({ ...params, access_token: cfg.token });
  const url = `${path.startsWith('http') ? path : cfg.base + path}${method === 'GET' ? `?${qs}` : ''}`;
  let res;
  try {
    res = await fetch(url, { method, signal: AbortSignal.timeout(15000), ...(method === 'POST' ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs.toString() } : {}) });
  } catch (e) {
    throw new IgError(`InstagramのAPIに接続できませんでした（${e.name}）`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    const msg = data && data.error ? `${data.error.message || ''}`.replace(/access_token=[^&\s]+/g, 'access_token=***').slice(0, 200) : '';
    throw new IgError(`InstagramのAPIエラー（${res.status}${msg ? `: ${msg}` : ''}）`);
  }
  return data;
}

// アカウントの基本の数字
export async function accountSummary(cfg) {
  return call(cfg, `/${cfg.userId}`, { params: { fields: 'user_id,username,account_type,followers_count,follows_count,media_count' } });
}

// アカウントの数字（過去 days 日の合計）：閲覧・リーチ・プロフィールのリンクのタップ・反応したアカウント・フォロー
// 取れない指標があっても、ほかの指標は返す（指標名はMetaの資料による。変更されることがある）
const ACCOUNT_METRICS = ['views', 'reach', 'profile_links_taps', 'accounts_engaged', 'follows_and_unfollows'];
export async function accountInsights(cfg, { days = 7, now = Date.now() } = {}) {
  const until = Math.floor(now / 1000);
  const since = until - days * 86400;
  const out = {};
  for (const m of ACCOUNT_METRICS) {
    try {
      const d = await call(cfg, `/${cfg.userId}/insights`, { params: { metric: m, period: 'day', metric_type: 'total_value', since: String(since), until: String(until) } });
      const v = d.data && d.data[0] && d.data[0].total_value;
      out[m] = v ? (v.value != null ? v.value : v.breakdowns || null) : null;
    } catch (e) {
      out[m] = { error: e.message };
    }
  }
  return { days, since: new Date(since * 1000).toISOString(), until: new Date(until * 1000).toISOString(), metrics: out };
}

// 最近の投稿と、投稿ごとの数字
const MEDIA_METRICS = 'views,reach,saved,shares,likes,comments';
export async function recentMedia(cfg, { limit = 10, extra = false } = {}) {
  const d = await call(cfg, `/${cfg.userId}/media`, { params: { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count', limit: String(limit) } });
  const items = [];
  for (const m of d.data || []) {
    let insights = {};
    try {
      const i = await call(cfg, `/${m.id}/insights`, { params: { metric: MEDIA_METRICS } });
      for (const x of i.data || []) insights[x.name] = x.values && x.values[0] ? x.values[0].value : x.total_value ? x.total_value.value : null;
    } catch (e) {
      insights = { error: e.message };
    }
    // P0：追加の指標（フォロー・プロフィールの訪問・反応の合計）。ログインの方式によって使えないことがあるので、別に頼み、失敗しても基本の数字は残す
    if (extra && !insights.error) {
      try {
        const i2 = await call(cfg, `/${m.id}/insights`, { params: { metric: MEDIA_EXTRA } });
        for (const x of i2.data || []) insights[x.name] = x.values && x.values[0] ? x.values[0].value : x.total_value ? x.total_value.value : null;
      } catch (e) {
        insights.extraError = e.message.slice(0, 160);
      }
    }
    items.push({ id: m.id, type: m.media_product_type || m.media_type, permalink: m.permalink, timestamp: m.timestamp, caption: String(m.caption || '').slice(0, 80), likes: m.like_count, comments: m.comments_count, insights });
  }
  return items;
}

// P0：アカウント全体の閲覧・リーチを、フォロワー／フォロワー以外に分けて（投稿ごとの内訳はAPIで取れるか未確認のため、アカウント全体で取る）
const MEDIA_EXTRA = 'follows,profile_visits,total_interactions';
export async function followTypeBreakdown(cfg, { days = 7, now = Date.now() } = {}) {
  const until = Math.floor(now / 1000);
  const since = until - days * 86400;
  const out = {};
  for (const m of ['views', 'reach']) {
    try {
      const d = await call(cfg, `/${cfg.userId}/insights`, { params: { metric: m, period: 'day', metric_type: 'total_value', breakdown: 'follow_type', since: String(since), until: String(until) } });
      const b = d.data && d.data[0] && d.data[0].total_value && d.data[0].total_value.breakdowns && d.data[0].total_value.breakdowns[0];
      const rows = (b && b.results) || [];
      const pick = (k) => { const r = rows.find((x) => (x.dimension_values || []).map(String).some((v) => v.toUpperCase() === k)); return r ? r.value : null; };
      out[m] = { total: d.data && d.data[0] && d.data[0].total_value ? d.data[0].total_value.value : null, follower: pick('FOLLOWER'), nonFollower: pick('NON_FOLLOWER') };
    } catch (e) {
      out[m] = { error: e.message.slice(0, 160) };
    }
  }
  return { days, since: new Date(since * 1000).toISOString(), until: new Date(until * 1000).toISOString(), metrics: out };
}

// 長期トークンの更新（期限は60日。期限の前に呼ぶ）
export async function refreshToken(cfg) {
  return call(cfg, 'https://graph.instagram.com/refresh_access_token', { params: { grant_type: 'ig_refresh_token' } });
}

// 自分の投稿を出す：画像（1枚）・カルーセル（2〜10枚）・リール（動画）。画像・動画は公開されたURLが必要（Metaのサーバーが取りに来る）
export async function publish(cfg, { kind, imageUrls = [], videoUrl = '', caption = '', waitMs = 3000, tries = 20 }) {
  if (!cfg.publishEnabled) throw new IgError('投稿はオフになっています（IG_PUBLISH_ENABLED=1 のときだけ投稿します）');
  const limit = await call(cfg, `/${cfg.userId}/content_publishing_limit`, { params: { fields: 'quota_usage' } }).catch(() => null);
  const used = limit && limit.data && limit.data[0] ? Number(limit.data[0].quota_usage) || 0 : 0;
  if (used >= cfg.dailyLimit) throw new IgError(`今日の投稿の上限（${cfg.dailyLimit}件）に達しています`);
  const httpsOnly = (u) => /^https:\/\//.test(u);
  let creationId;
  if (kind === 'reel') {
    if (!httpsOnly(videoUrl)) throw new IgError('動画の公開URL（https）が必要です');
    creationId = (await call(cfg, `/${cfg.userId}/media`, { method: 'POST', params: { media_type: 'REELS', video_url: videoUrl, caption } })).id;
  } else if (kind === 'carousel') {
    if (imageUrls.length < 2 || imageUrls.length > 10 || !imageUrls.every(httpsOnly)) throw new IgError('カルーセルは2〜10枚の画像の公開URL（https）が必要です');
    const children = [];
    for (const u of imageUrls) children.push((await call(cfg, `/${cfg.userId}/media`, { method: 'POST', params: { image_url: u, is_carousel_item: 'true' } })).id);
    creationId = (await call(cfg, `/${cfg.userId}/media`, { method: 'POST', params: { media_type: 'CAROUSEL', children: children.join(','), caption } })).id;
  } else if (kind === 'image') {
    if (!httpsOnly(imageUrls[0] || '')) throw new IgError('画像の公開URL（https）が必要です');
    creationId = (await call(cfg, `/${cfg.userId}/media`, { method: 'POST', params: { image_url: imageUrls[0], caption } })).id;
  } else throw new IgError('投稿の種類が分かりません');
  // 動画などは処理が終わるまで待つ
  for (let i = 0; i < tries; i++) {
    const st = await call(cfg, `/${creationId}`, { params: { fields: 'status_code' } });
    if (st.status_code === 'FINISHED' || st.status_code === undefined) break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new IgError(`投稿の準備に失敗しました（${st.status_code}）`);
    await sleep(waitMs);
  }
  const done = await call(cfg, `/${cfg.userId}/media_publish`, { method: 'POST', params: { creation_id: creationId } });
  return { id: done.id };
}

// 投稿の予定（data/post-queue.json）から、まだ投稿していない最初の1件を投稿する。
// 投稿済みかは、Instagramの最近の投稿のキャプションに marker が含まれるかで確かめる（記録を別に持たなくてよい）。
export async function publishNext(cfg, { queue, baseUrl, now = new Date() }) {
  const items = (queue && Array.isArray(queue.items) ? queue.items : []).filter((x) => x && x.id && x.marker && !x.hold && (!x.notBefore || x.notBefore <= now.toISOString().slice(0, 10)));
  if (!items.length) return { done: false, reason: '投稿の予定がありません' };
  const recent = await call(cfg, `/${cfg.userId}/media`, { params: { fields: 'caption,permalink,timestamp', limit: '25' } });
  const captions = (recent.data || []).map((m) => String(m.caption || ''));
  const next = items.find((x) => !captions.some((c) => c.includes(x.marker)));
  if (!next) return { done: false, reason: '予定の投稿はすべて投稿済みです' };
  const abs = (u) => (/^https:\/\//.test(u) ? u : `${baseUrl.replace(/\/$/, '')}/${String(u).replace(/^\//, '')}`);
  const r = await publish(cfg, { kind: next.kind, imageUrls: (next.images || []).map(abs), videoUrl: next.video ? abs(next.video) : '', caption: String(next.caption || '') });
  return { done: true, id: next.id, mediaId: r.id };
}
