// ふるさと納税コーナーのAPI：楽天ふるさと納税の返礼品を、条件で探して比べやすい形で返す。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { FURUSATO_CATEGORIES, searchFurusato, parseQuantity } from '../lib/furusato.js';
import { maskSecrets } from '../lib/ai.js';

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const yen = (v) => { const n = Math.round(Number(v)); return n >= 1000 && n <= 10000000 ? n : undefined; };

export default async function handler(req, res, env = process.env) {
  if (req.method === 'GET') return send(res, 200, { categories: Object.entries(FURUSATO_CATEGORIES).map(([id, c]) => ({ id, label: c.label })) });
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const b = await readBody(req);
  try {
    const r = await searchFurusato({
      category: FURUSATO_CATEGORIES[b.category] ? b.category : 'other',
      keyword: str(b.keyword, 40), municipality: str(b.municipality, 20),
      minPrice: yen(b.minPrice), maxPrice: yen(b.maxPrice),
      teiki: ['only', 'exclude'].includes(b.teiki) ? b.teiki : 'any',
      minReview: [3, 3.5, 4, 4.5].includes(Number(b.minReview)) ? Number(b.minReview) : 0,
      delivery: /^(stated|\d{1,2})$/.test(String(b.delivery || '')) ? String(b.delivery) : '',
      minQuantity: b.minQuantity ? parseQuantity(str(b.minQuantity, 20)) : null,
      sort: ['standard', 'review', 'price_asc', 'price_desc'].includes(b.sort) ? b.sort : 'standard',
      page: Math.max(1, Math.min(10, Number(b.page) || 1)),
      env, referer: requestReferer(req, env)
    });
    return send(res, 200, r);
  } catch (e) {
    return send(res, 502, { error: '楽天ふるさと納税の返礼品を取得できませんでした。少し時間をおいてもう一度お試しください。', detail: maskSecrets(e.message).slice(0, 200) });
  }
}
