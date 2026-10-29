// 商品を探すAPI（企画・条件指定・最初の10投稿の共通）。
// 検索の角度を広げて楽天で候補を集め、AIが15〜20件に絞って役割を付ける。投稿に使う5〜6件は画面でユーザーが選ぶ。
// more を付けると、すでに表示した商品と前回の角度を避けて、さらに10件探す。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { CURATION_TYPES } from '../lib/themes.js';
import { resolveFilterGenre } from '../lib/genres.js';
import { findPlan } from '../lib/plans.js';
import { normalizeIdea } from '../lib/ideas.js';
import { sanitizeFreeText } from '../lib/planner.js';
import { readBrief, briefFromIdea, briefFromPlan, briefFromConditions, explore, seedCandidate } from '../lib/explore.js';
import { readSeedProduct } from '../lib/seed.js';
import { coverStyleFor } from '../lib/covers.js';
import { maskSecrets } from '../lib/ai.js';

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

function readList(list, n, map) {
  return (Array.isArray(list) ? list : []).slice(0, n).map(map).filter(Boolean);
}

function readDetails(d) {
  if (!d || typeof d !== 'object') return {};
  return {
    minPrice: d.minPrice, maxPrice: d.maxPrice, target: str(d.target, 40), age: str(d.age, 10),
    purpose: d.purpose, brandFocus: d.brandFocus === true, trendFocus: d.trendFocus === true
  };
}

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;

  const body = await readBody(req);
  let brief = null;
  let idea = null;
  let plan = null;
  // 「この商品から企画を考える」の起点の商品：必ず候補に残し（先頭・必ず採用）、検索では同じ商品を除く
  const seed = body.idea && body.seed ? readSeedProduct(body.seed) : null;
  const more = body.more && typeof body.more === 'object' ? body.more : null;
  if (more) {
    // さらに10件：前回の内容（brief）をそのまま使う（企画の情報は画面側が持っている）
    brief = readBrief(more.brief);
  } else if (body.idea) {
    idea = normalizeIdea(body.idea);
    if (idea) brief = briefFromIdea(idea, seed);
  } else if (body.planId) {
    const p = findPlan(body.planId);
    if (p) {
      brief = briefFromPlan(p);
      plan = { id: p.id, no: p.no, topic: p.topic, subtitle: p.subtitle || '', category: p.category, postType: p.postType };
    }
  } else {
    const filterGenre = resolveFilterGenre(body.genre);
    brief = briefFromConditions({ filterGenre, type: body.type, free: sanitizeFreeText(body.free), details: readDetails(body.details) });
  }
  if (!brief) return send(res, 400, { error: '探す内容が分かりませんでした。企画か条件を選び直してください。' });

  const exclude = {
    codes: readList(body.exclude && body.exclude.codes, 200, (c) => str(c, 80)),
    names: readList(body.exclude && body.exclude.names, 200, (n) => str(n, 80))
  };
  if (seed) {
    if (seed.code) exclude.codes.push(seed.code);
    exclude.names.push(seed.name);
  }
  const seen = readList(body.seen, 50, (s) => (s && (s.code || s.name) ? { code: str(s.code, 80), name: str(s.name, 80) } : null));
  const prevAngles = more ? readList(more.angles, 20, (a) => (a && a.keyword ? { label: str(a.label, 14), keyword: str(a.keyword, 30), minPrice: a.minPrice, maxPrice: a.maxPrice, page: Math.min(5, Number(a.page) || 1) } : null)) : [];

  try {
    const result = await explore({ brief, more: !!more, prevAngles, exclude, seen, env, referer: requestReferer(req, env), startedAt });
    return send(res, 200, {
      brief,
      title: brief.title || brief.free,
      typeName: CURATION_TYPES[brief.type].name,
      // 表紙のシリーズ：企画（本気出して考えてみた）は今までの表紙、条件指定は選び方の型に対応する表紙
      coverStyle: coverStyleFor({ type: brief.type, title: brief.title, series: !!(idea || plan) }),
      idea: idea && { topic: idea.topic, title: idea.title, subtitle: idea.subtitle, postType: idea.postType, genre: idea.genre, target: idea.target, priceBand: idea.priceBand, brands: idea.brands, axis: idea.axis },
      plan,
      angles: result.angles,
      candidates: seed ? [seedCandidate(seed, idea), ...result.candidates] : result.candidates,
      notice: result.notice,
      detail: result.detail ? maskSecrets(result.detail) : undefined
    });
  } catch (e) {
    return send(res, 502, { error: e.message, detail: e.detail ? maskSecrets(e.detail).slice(0, 300) : undefined });
  }
}
