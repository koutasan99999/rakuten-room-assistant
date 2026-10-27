// 「商品を発掘する」ボタンから呼ばれるAPI。
// APIキーはVercelの環境変数に保存し、ブラウザには一切渡さない。
import crypto from 'node:crypto';
import { GENRES, GENRE_NAMES, pickRandom } from '../lib/genres.js';
import { searchCandidates } from '../lib/rakuten.js';
import { selectWithAI, fallbackPicks } from '../lib/ai.js';

const MAX_CANDIDATES = 30;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });

  // 合言葉（APP_PASSCODE）を設定している場合は、知っている人だけが使えるようにする
  if (env.APP_PASSCODE && !safeEqual(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) {
    return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  }
  if (!env.RAKUTEN_APP_ID || !env.OPENAI_API_KEY) {
    return send(res, 500, { error: 'サーバーの設定（APIキー）がまだ完了していません' });
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const referer = env.RAKUTEN_REFERER || `https://${host}/`;

  // ジャンルをランダムに選び、商品が少なすぎたら別ジャンルでもう一度
  const genreOrder = shuffle(GENRE_NAMES);
  let genre = null;
  let items = [];
  try {
    for (const g of genreOrder.slice(0, 2)) {
      genre = g;
      const keywords = shuffle(GENRES[g]);
      items = await searchCandidates({ keywords, env, referer });
      if (items.length >= 3) break;
    }
  } catch (e) {
    console.error('[rakuten]', e.message);
    return send(res, 502, { error: '楽天市場の商品を取得できませんでした。少し時間をおいてもう一度お試しください。', detail: e.message });
  }
  if (items.length === 0) {
    return send(res, 200, { genre, products: [], notice: '条件に合う商品が見つかりませんでした。もう一度押してみてください。' });
  }

  const candidates = shuffle(items).slice(0, MAX_CANDIDATES);
  let picks;
  let notice = '';
  try {
    picks = await selectWithAI({ items: candidates, genre, env });
  } catch (e) {
    console.error('[openai]', e.message);
    picks = fallbackPicks(candidates);
    notice = 'AIでの選定に失敗したため、簡易的な選び方で表示しています。紹介文は投稿前に見直してください。';
  }
  if (picks.length < 5 && !notice) notice = `今回は${picks.length}件見つかりました。`;

  const products = picks.map((p) => {
    const it = candidates[p.index];
    return { name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop, reason: p.reason, intro: p.intro };
  });
  return send(res, 200, { genre, products, notice });
}
