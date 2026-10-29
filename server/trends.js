// トレンド発掘のAPI。3種類を混ぜずに返す。
//   kind=ranking : 売れ筋（楽天市場ランキング。販売の順位）
//   kind=search  : 検索急上昇（Googleトレンドの急上昇ワード。検索が急に増えた言葉）
// 新作・話題の商品は、新作レーダー（api/radar）で集めたもの（商品名・説明に書かれた発売・予約の情報）を画面側で使う。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { TREND_GENRES, fetchRanking } from '../lib/ranking.js';
import { fetchTrending } from '../lib/trends.js';
import { aggregateBrands } from '../lib/brand-discovery.js';
import { maskSecrets } from '../lib/ai.js';

export default async function handler(req, res, env = process.env) {
  if (req.method === 'GET') return send(res, 200, { genres: TREND_GENRES.map((g) => ({ id: g.id, label: g.label, note: g.note || '' })) });
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  try {
    if (body.kind === 'search') return send(res, 200, await fetchTrending());
    const r = await fetchRanking({ genre: body.genre, period: body.period === 'realtime' ? 'realtime' : 'daily', env, referer: requestReferer(req, env) });
    return send(res, 200, { ...r, brands: aggregateBrands(r.items, { genreLabel: r.genreLabel }) });
  } catch (e) {
    return send(res, 502, { error: body.kind === 'search' ? 'Googleトレンドを読み込めませんでした。CSVの取り込みも使えます。' : '楽天ランキングを取得できませんでした。少し時間をおいてもう一度お試しください。', detail: maskSecrets(e.message).slice(0, 200) });
  }
}
