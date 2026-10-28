// 「商品を発掘する」ボタンから呼ばれるAPI。
// APIキーはVercelの環境変数に保存し、ブラウザには一切渡さない。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { pickGenres, sanitizeStats, shuffle, resolveFilterGenre } from '../lib/genres.js';
import { planSearch, sanitizeFreeText } from '../lib/planner.js';
import { searchCandidates, nameKey } from '../lib/rakuten.js';
import { selectWithAI, fallbackPicks, maskSecrets } from '../lib/ai.js';

const MAX_CANDIDATES = 40; // AIに見比べてもらう候補の最大数（多いほど厳選できるが、料金と時間が増える）
const TARGET_PICKS = 6;
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
  // 発掘条件：ジャンル（画面の選択肢）と自由入力。両方とも空なら今まで通りの完全ランダム発掘
  const filterGenre = resolveFilterGenre(body.genre);
  const free = sanitizeFreeText(body.free);
  const targeted = !!(filterGenre || free);

  let genre = null;
  let items = [];
  let plan = null;
  try {
    if (targeted) {
      // 自由入力があればAIに意図を読み取ってもらい、検索語と価格帯にする（ジャンルだけならその検索語で探す）
      plan = free
        ? await planSearch({ genre: filterGenre, type: null, free, env, deadline: startedAt + 15000 })
        : { summary: filterGenre.label, keywords: shuffle(filterGenre.keywords), brand: filterGenre.brand };
      genre = { id: null, name: filterGenre ? filterGenre.label : '指定なし', brand: plan.brand || (filterGenre && filterGenre.brand) };
      items = (await searchCandidates({
        keywords: plan.keywords, env, referer, minItems: MAX_CANDIDATES, maxCalls: 3,
        minPrice: plan.minPrice, maxPrice: plan.maxPrice,
        randomPage: !free // 自由入力があるときは関連度の高い1ページ目から
      })).filter((it) => !recentKeys.has(nameKey(it.name)));
    } else {
      for (const g of pickGenres(2, stats)) {
        genre = g;
        const keywords = shuffle(g.keywords);
        items = (await searchCandidates({ keywords, env, referer, minItems: MAX_CANDIDATES })).filter((it) => !recentKeys.has(nameKey(it.name)));
        if (items.length >= 3) break;
      }
    }
  } catch (e) {
    console.error('[rakuten]', e.message);
    return send(res, 502, { error: '楽天市場の商品を取得できませんでした。少し時間をおいてもう一度お試しください。', detail: e.message });
  }
  const condition = plan ? plan.summary : '';
  if (items.length === 0) {
    return send(res, 200, {
      genre: genre.name, genreId: genre.id, condition, products: [],
      notice: targeted ? 'この条件に合う商品が見つかりませんでした。条件を少しゆるめてもう一度お試しください。' : '条件に合う商品が見つかりませんでした。もう一度押してみてください。'
    });
  }

  const candidates = shuffle(items).slice(0, MAX_CANDIDATES);
  let picks;
  let notice = '';
  let detail;
  try {
    // Vercelの制限時間（60秒）内に収まるよう、AIに使える時間を決めておく
    const request = targeted
      ? [plan.summary && `探すもの: ${plan.summary}`, plan.audience && `誰向け: ${plan.audience}`, free && `ユーザーの言葉: ${free}`].filter(Boolean).join('\n')
      : '';
    picks = await selectWithAI({ items: candidates, genre: genre.name, brand: !!genre.brand, request, env, recent, deadline: startedAt + 52000 });
  } catch (e) {
    console.error('[openai] fallback:', e.message);
    picks = fallbackPicks(candidates);
    notice = 'AIでの選定に失敗したため、簡易的な選び方で表示しています。紹介文は投稿前に見直してください。';
    detail = `原因: ${maskSecrets(e.message)}`.slice(0, 400);
  }
  if (picks.length < TARGET_PICKS && !notice) notice = `今回は条件に合う商品が${picks.length}件でした。`;

  const products = picks.map((p) => {
    const it = candidates[p.index];
    return { name: it.name, code: it.code, price: it.price, url: it.url, image: it.image, shop: it.shop, role: p.role || '', basis: p.basis || '', reason: p.reason, intro: p.intro };
  });
  return send(res, 200, { genre: genre.name, genreId: genre.id, condition, products, notice, detail });
}
