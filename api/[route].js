// Vercel の無料プラン（Hobby）は、1回のデプロイで使えるサーバーの関数が12個まで。
// 機能が増えて12個を超え、デプロイが失敗していた（2026-10-29 の #39 以降）。そのため、機能ごとのAPI（server/*.js）を
// この1つの関数から呼び分ける。URLは今までどおり /api/○○（[route] の部分が ○○）。新しいAPIは server/ に置いて、下の一覧に足す。

import { withUsage, setBlocked, allCalls } from '../lib/ai-usage.js';
import { kvFrom } from '../lib/kv.js';
import { check as budgetCheck, record as budgetRecord } from '../lib/budget.js';
import agents from '../server/agents.js';
import assets from '../server/assets.js';
import brandNote from '../server/brand-note.js';
import buyer from '../server/buyer.js';
import company from '../server/company.js';
import coord from '../server/coord.js';
import coordImage from '../server/coord-image.js';
import discover from '../server/discover.js';
import explore from '../server/explore.js';
import furusato from '../server/furusato.js';
import health from '../server/health.js';
import ideas from '../server/ideas.js';
import ig from '../server/ig.js';
import image from '../server/image.js';
import instagram from '../server/instagram.js';
import intros from '../server/intros.js';
import pitch from '../server/pitch.js';
import planTitles from '../server/plan-titles.js';
import plans from '../server/plans.js';
import pr from '../server/pr.js';
import productUrl from '../server/product-url.js';
import radar from '../server/radar.js';
import releaseIdeas from '../server/release-ideas.js';
import roomHashtags from '../server/room-hashtags.js';
import search from '../server/search.js';
import seedIdeas from '../server/seed-ideas.js';
import thief from '../server/thief.js';
import trends from '../server/trends.js';
import worker from '../server/worker.js';
import data from '../server/data.js';
import kumaMaster from '../server/kuma-master.js';
import media from '../server/media.js';

export const ROUTES = {
  'agents': agents,
  'assets': assets,
  'brand-note': brandNote,
  'buyer': buyer,
  'company': company,
  'coord': coord,
  'coord-image': coordImage,
  'discover': discover,
  'explore': explore,
  'furusato': furusato,
  'health': health,
  'ideas': ideas,
  'ig': ig,
  'image': image,
  'instagram': instagram,
  'intros': intros,
  'pitch': pitch,
  'plan-titles': planTitles,
  'plans': plans,
  'pr': pr,
  'product-url': productUrl,
  'radar': radar,
  'release-ideas': releaseIdeas,
  'room-hashtags': roomHashtags,
  'search': search,
  'seed-ideas': seedIdeas,
  'thief': thief,
  'trends': trends,
  'worker': worker,
  'data': data,
  'kuma-master': kumaMaster,
  'media': media
};

export default async function handler(req, res) {
  const name = (req.query && req.query.route) || new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '').split('/').pop();
  const route = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;
  if (!route) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'このAPIはありません' }));
  }
  // このリクエストで呼んだAIの使用量をまとめる（応答に aiUsage として付く）
  // 保存場所があるときは、サーバー側で月の上限を確かめ（超えていればAIを呼ばない）、使った費用（実測）を記録する
  return withUsage(async () => {
    const env = process.env;
    let kv = null;
    try { kv = AI_ROUTES.has(name) ? kvFrom(env) : null; } catch { kv = null; }
    if (kv) {
      try { const c = await budgetCheck(kv, env, { estimate: 0 }); if (!c.ok) setBlocked(c.reason); } catch { /* 保存場所の障害では止めない（画面の上限は別にある） */ }
    }
    try {
      return await route(req, res);
    } finally {
      if (kv) {
        const yen = allCalls().reduce((a, c) => a + (c.yen || 0), 0);
        try { await budgetRecord(kv, yen, { auto: false }); } catch { /* 記録の失敗で画面を止めない */ }
      }
    }
  });
}

// AIを呼ぶことがあるAPI（予算の確認をするもの）。worker は自分で確認する
const AI_ROUTES = new Set(['pitch', 'company', 'agents', 'pr', 'explore', 'buyer', 'thief', 'intros', 'room-hashtags', 'instagram', 'assets', 'coord', 'coord-image', 'ideas', 'seed-ideas', 'release-ideas', 'plan-titles', 'plans', 'brand-note', 'discover', 'search', 'health']);
