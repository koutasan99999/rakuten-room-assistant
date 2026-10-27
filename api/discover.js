// 「商品を発掘する」ボタンから呼ばれるAPI。
// APIキーはVercelの環境変数に保存し、ブラウザには一切渡さない。
import crypto from 'node:crypto';
import { pickGenres, sanitizeStats, shuffle } from '../lib/genres.js';
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

// Vercelでは req.body が用意されるが、手元の簡易サーバーでは自分で読む
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  if (typeof req.on !== 'function') return {};
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) break;
  }
  try { return JSON.parse(raw); } catch { return {}; }
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

  // ジャンルを（反応の良さを加味して）ランダムに選び、商品が少なすぎたら別ジャンルでもう一度
  const body = await readBody(req);
  const stats = sanitizeStats(body.stats);
  let genre = null;
  let items = [];
  try {
    for (const g of pickGenres(2, stats)) {
      genre = g;
      const keywords = shuffle(g.keywords);
      items = await searchCandidates({ keywords, env, referer });
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
  try {
    picks = await selectWithAI({ items: candidates, genre: genre.name, env });
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
  return send(res, 200, { genre: genre.name, genreId: genre.id, products, notice });
}
