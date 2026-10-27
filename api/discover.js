// 「商品を発掘する」ボタンから呼ばれるAPI。
// APIキーはVercelの環境変数に保存し、ブラウザには一切渡さない。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { pickGenres, sanitizeStats, shuffle } from '../lib/genres.js';
import { searchCandidates, nameKey } from '../lib/rakuten.js';
import { selectWithAI, fallbackPicks, maskSecrets } from '../lib/ai.js';

const MAX_CANDIDATES = 30;
const MAX_RECENT = 20;

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });

  if (!checkAccess(req, res, env)) return;

  const referer = requestReferer(req, env);

  // ジャンルを（反応の良さを加味して）ランダムに選び、商品が少なすぎたら別ジャンルでもう一度
  const body = await readBody(req);
  const stats = sanitizeStats(body.stats);
  // 最近表示した商品名（iPhone側で記録）。同じ商品は除き、似た商品はAIに避けてもらう
  const recent = (Array.isArray(body.recent) ? body.recent : [])
    .filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX_RECENT)
    .map((x) => x.replace(/[【\[].*?[】\]]/g, '').replace(/[\s　]+/g, ' ').trim().slice(0, 30));
  const recentKeys = new Set(recent.map(nameKey));
  let genre = null;
  let items = [];
  try {
    for (const g of pickGenres(2, stats)) {
      genre = g;
      const keywords = shuffle(g.keywords);
      items = (await searchCandidates({ keywords, env, referer, minItems: 15 })).filter((it) => !recentKeys.has(nameKey(it.name)));
      if (items.length >= 3) break;
    }
  } catch (e) {
    console.error('[rakuten]', e.message);
    return send(res, 502, { error: '楽天市場の商品を取得できませんでした。少し時間をおいてもう一度お試しください。', detail: e.message });
  }
  if (items.length === 0) {
    return send(res, 200, { genre: genre.name, genreId: genre.id, products: [], notice: '条件に合う商品が見つかりませんでした。もう一度押してみてください。' });
  }

  const candidates = shuffle(items).slice(0, MAX_CANDIDATES);
  let picks;
  let notice = '';
  let detail;
  try {
    // Vercelの制限時間（60秒）内に収まるよう、AIに使える時間を決めておく
    picks = await selectWithAI({ items: candidates, genre: genre.name, brand: !!genre.brand, env, recent, deadline: startedAt + 52000 });
  } catch (e) {
    console.error('[openai] fallback:', e.message);
    picks = fallbackPicks(candidates);
    notice = 'AIでの選定に失敗したため、簡易的な選び方で表示しています。紹介文は投稿前に見直してください。';
    detail = `原因: ${maskSecrets(e.message)}`.slice(0, 400);
  }
  if (picks.length < 5 && !notice) notice = `今回は${picks.length}件見つかりました。`;

  const products = picks.map((p) => {
    const it = candidates[p.index];
    return { name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop, basis: p.basis || '', reason: p.reason, intro: p.intro };
  });
  return send(res, 200, { genre: genre.name, genreId: genre.id, products, notice, detail });
}
