// 商品を検索して企画に追加するAPI（企画の編集画面で使う）。
// axis: search（自分で検索）/ same_brand / other_brand / other_collab / similar / same_price / new_arrival
// 起点の商品（reference）を分析して、探し方ごとに別の検索語を作る。起点の商品・企画に入っている商品・表示済みの商品は除く。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { AXES, relatedSearch } from '../lib/related.js';
import { maskSecrets } from '../lib/ai.js';

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const SORTS = ['', '-updateTimestamp', '+itemPrice', '-itemPrice', '-reviewCount'];

function readProduct(x) {
  if (!x || typeof x !== 'object' || !x.name) return null;
  return {
    name: str(x.name, 200), code: str(x.code, 80), url: str(x.url, 300), price: Number(x.price) || 0,
    brand: str(x.brand, 30), caption: str(x.caption, 300), categoryLabel: str(x.categoryLabel, 20)
  };
}

function readList(list, n) {
  return (Array.isArray(list) ? list : []).slice(0, n).map((x) => (x && (x.code || x.name || x.url) ? { code: str(x.code, 80), name: str(x.name, 120), url: str(x.url, 300) } : null)).filter(Boolean);
}

function price(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 100 && n <= 5000000 ? n : undefined;
}

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const axis = AXES[body.axis] ? body.axis : 'search';
  const keyword = str(body.keyword, 60);
  if (axis === 'search' && keyword.replace(/\s/g, '').length < 2) return send(res, 400, { error: '検索する言葉を2文字以上入れてください（商品名・ブランド名・型番・カテゴリなど）' });
  const reference = readProduct(body.reference);
  const cursor = body.cursor && typeof body.cursor === 'object' && AXES[body.cursor.axis]
    ? { axis: body.cursor.axis, step: Math.max(0, Math.min(10, Number(body.cursor.step) || 0)), page: Math.max(1, Math.min(5, Number(body.cursor.page) || 1)) }
    : null;
  let minPrice = price(body.minPrice);
  let maxPrice = price(body.maxPrice);
  if (minPrice && maxPrice && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
  try {
    const r = await relatedSearch({
      axis: cursor ? cursor.axis : axis, reference, keyword, cursor,
      exclude: readList(body.exclude, 40), shown: readList(body.shown, 300),
      minPrice, maxPrice, sort: SORTS.includes(body.sort) ? body.sort || undefined : undefined,
      // want: 1回に返す件数（コーデの起点を選ぶときなどは多めに。最大30）
      want: Math.max(5, Math.min(30, Number(body.want) || 10)),
      env, referer: requestReferer(req, env), until: startedAt + 40000
    });
    const a = r.analysis;
    return send(res, 200, {
      items: r.items,
      axis: r.axis,
      axisLabel: AXES[r.axis].label,
      switched: r.switched,
      cursor: r.cursor,
      queries: r.queries.map((q) => ({ axis: q.axis, keyword: q.keyword, page: q.page, fresh: q.fresh })),
      analysis: a && { brand: a.brand, partner: a.partner, collab: a.collab, category: a.category, models: a.models, color: a.color, features: a.features },
      notice: r.items.length ? r.notice : [r.notice, '新しい候補が見つかりませんでした。言葉を変えるか、別の探し方を試してください。'].filter(Boolean).join('。')
    });
  } catch (e) {
    return send(res, 502, { error: /楽天/.test(e.message) ? '楽天市場で検索できませんでした。少し時間をおいてもう一度お試しください。' : e.message, detail: maskSecrets(e.message).slice(0, 200) });
  }
}
