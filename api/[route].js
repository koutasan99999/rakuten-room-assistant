// Vercel の無料プラン（Hobby）は、1回のデプロイで使えるサーバーの関数が12個まで。
// 機能が増えて12個を超え、デプロイが失敗していた（2026-10-29 の #39 以降）。そのため、機能ごとのAPI（server/*.js）を
// この1つの関数から呼び分ける。URLは今までどおり /api/○○（[route] の部分が ○○）。新しいAPIは server/ に置いて、下の一覧に足す。

import assets from '../server/assets.js';
import brandNote from '../server/brand-note.js';
import buyer from '../server/buyer.js';
import coord from '../server/coord.js';
import coordImage from '../server/coord-image.js';
import discover from '../server/discover.js';
import explore from '../server/explore.js';
import furusato from '../server/furusato.js';
import ideas from '../server/ideas.js';
import image from '../server/image.js';
import instagram from '../server/instagram.js';
import intros from '../server/intros.js';
import pitch from '../server/pitch.js';
import planTitles from '../server/plan-titles.js';
import plans from '../server/plans.js';
import productUrl from '../server/product-url.js';
import radar from '../server/radar.js';
import releaseIdeas from '../server/release-ideas.js';
import roomHashtags from '../server/room-hashtags.js';
import search from '../server/search.js';
import seedIdeas from '../server/seed-ideas.js';
import trends from '../server/trends.js';

export const ROUTES = {
  'assets': assets,
  'brand-note': brandNote,
  'buyer': buyer,
  'coord': coord,
  'coord-image': coordImage,
  'discover': discover,
  'explore': explore,
  'furusato': furusato,
  'ideas': ideas,
  'image': image,
  'instagram': instagram,
  'intros': intros,
  'pitch': pitch,
  'plan-titles': planTitles,
  'plans': plans,
  'product-url': productUrl,
  'radar': radar,
  'release-ideas': releaseIdeas,
  'room-hashtags': roomHashtags,
  'search': search,
  'seed-ideas': seedIdeas,
  'trends': trends
};

export default async function handler(req, res) {
  const name = (req.query && req.query.route) || new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '').split('/').pop();
  const route = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;
  if (!route) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'このAPIはありません' }));
  }
  return route(req, res);
}
