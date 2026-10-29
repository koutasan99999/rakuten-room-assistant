// 新作・予約・再販レーダーのAPI。
// GET: 画面で使うジャンル・おすすめブランド・状態の一覧
// POST: 指定したジャンル・フォロー中のブランドで巡回して、状態と日付つきの商品を返す（保存は画面側）
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { RADAR_GENRES, RADAR_GROUPS, findRadarGenre } from '../lib/radar-genres.js';
import { STATUS, SOURCES, scanRadar, planQueries, planBrandQueries } from '../lib/radar.js';

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method === 'GET') {
    return send(res, 200, {
      groups: RADAR_GROUPS,
      genres: RADAR_GENRES.map((g) => ({ id: g.id, group: g.group, label: g.label, brands: g.brands, ng: g.ng || [] })),
      statuses: Object.entries(STATUS).map(([id, label]) => ({ id, label })),
      sources: SOURCES.map((s) => ({ id: s.id, label: s.label }))
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GETかPOSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;

  const body = await readBody(req);
  // 検索ジョブ用：巡回の検索語だけを返す（楽天は呼ばない）。画面側がこれを小さく分けて 'part' で少しずつ探す
  if (body.mode === 'plan') {
    const pb = body.brand ? str(body.brand, 30) : '';
    const pg = (Array.isArray(body.genres) ? body.genres : []).map((g) => str(g, 30)).filter((g) => findRadarGenre(g)).slice(0, 6);
    const pbrands = (Array.isArray(body.brands) ? body.brands : []).map((b) => str(b, 30)).filter(Boolean).slice(0, 5);
    const qs = pb ? planBrandQueries(pb) : planQueries({ genres: pg, brands: pbrands, round: Math.max(0, parseInt(body.round, 10) || 0) % 1000 });
    return send(res, 200, { queries: qs.map((q) => ({ genre: q.genre.id, keyword: q.keyword, type: q.type, brand: q.brand || '' })) });
  }
  if (body.mode === 'part') {
    const qs = (Array.isArray(body.queries) ? body.queries : []).slice(0, 4).map((q) => ({
      genre: findRadarGenre(str(q && q.genre, 30)), keyword: str(q && q.keyword, 60), type: str(q && q.type, 10), brand: str(q && q.brand, 30)
    })).filter((q) => q.genre && q.keyword);
    if (!qs.length) return send(res, 400, { error: '探す言葉がありません' });
    const followed = (Array.isArray(body.brands) ? body.brands : []).map((b) => str(b, 30)).filter(Boolean).slice(0, 5);
    const pr = await scanRadar({ queries: qs, brands: followed, env, referer: requestReferer(req, env), until: startedAt + 40000 });
    // 全部の検索が失敗したときだけエラーにする（一部でも取れたら、その分を返す）
    if (!pr.items.length && pr.scanned.length && pr.scanned.every((x) => x.error)) {
      return send(res, 502, { error: '楽天市場で検索できませんでした', detail: pr.lastError && pr.lastError.message });
    }
    return send(res, 200, { items: pr.items, scanned: pr.scanned });
  }
  // mode: 'brand' は1つのブランドだけを詳しく探す（フォローの設定は変えない）
  const brand = body.mode === 'brand' ? str(body.brand, 30) : '';
  const genres = (Array.isArray(body.genres) ? body.genres : []).map((g) => str(g, 30)).filter((g) => findRadarGenre(g)).slice(0, 6);
  if (!genres.length && !brand) return send(res, 400, { error: '見るジャンルを選んでください' });
  const brands = (Array.isArray(body.brands) ? body.brands : []).map((b) => str(b, 30)).filter(Boolean).slice(0, 5);
  const round = Math.max(0, parseInt(body.round, 10) || 0) % 1000;

  const r = await scanRadar({ genres, brands: brand ? [brand] : brands, round, brand, env, referer: requestReferer(req, env), until: startedAt + 48000 });
  if (!r.items.length && r.lastError) {
    return send(res, 502, { error: '楽天市場の商品を取得できませんでした。少し時間をおいてもう一度お試しください。', detail: r.lastError.message });
  }
  return send(res, 200, {
    items: r.items,
    scanned: r.scanned,
    notice: r.items.length ? '' : '今回は新作・予約の商品が見つかりませんでした。ジャンルを変えて更新してみてください。'
  });
}
