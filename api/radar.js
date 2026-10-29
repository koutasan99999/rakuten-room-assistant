// 新作・予約・再販レーダーのAPI。
// GET: 画面で使うジャンル・おすすめブランド・状態の一覧
// POST: 指定したジャンル・フォロー中のブランドで巡回して、状態と日付つきの商品を返す（保存は画面側）
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { RADAR_GENRES, RADAR_GROUPS, findRadarGenre } from '../lib/radar-genres.js';
import { STATUS, SOURCES, scanRadar } from '../lib/radar.js';

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method === 'GET') {
    return send(res, 200, {
      groups: RADAR_GROUPS,
      genres: RADAR_GENRES.map((g) => ({ id: g.id, group: g.group, label: g.label, brands: g.brands })),
      statuses: Object.entries(STATUS).map(([id, label]) => ({ id, label })),
      sources: SOURCES.map((s) => ({ id: s.id, label: s.label }))
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GETかPOSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;

  const body = await readBody(req);
  const genres = (Array.isArray(body.genres) ? body.genres : []).map((g) => str(g, 30)).filter((g) => findRadarGenre(g)).slice(0, 6);
  if (!genres.length) return send(res, 400, { error: '見るジャンルを選んでください' });
  const brands = (Array.isArray(body.brands) ? body.brands : []).map((b) => str(b, 30)).filter(Boolean).slice(0, 5);
  const round = Math.max(0, parseInt(body.round, 10) || 0) % 1000;

  const r = await scanRadar({ genres, brands, round, env, referer: requestReferer(req, env), until: startedAt + 48000 });
  if (!r.items.length && r.lastError) {
    return send(res, 502, { error: '楽天市場の商品を取得できませんでした。少し時間をおいてもう一度お試しください。', detail: r.lastError.message });
  }
  return send(res, 200, {
    items: r.items,
    scanned: r.scanned,
    notice: r.items.length ? '' : '今回は新作・予約の商品が見つかりませんでした。ジャンルを変えて更新してみてください。'
  });
}
