// AIコーデスタジオ：起点のファッションアイテムから、実在の商品で全身コーデを3パターン提案するAPI。
// AIはコーデの方向性と検索語だけを考え、商品は楽天の検索結果から入れる（架空の商品名・価格・URLは作らない）。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { readCoordHero, readCoordConditions, buildCoords } from '../lib/coord.js';
import { maskSecrets } from '../lib/ai.js';

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const hero = readCoordHero(body.hero);
  if (!hero) return send(res, 400, { error: '起点にするアイテムがありません' });
  const cond = readCoordConditions(body.conditions);
  try {
    const r = await buildCoords({ hero, cond, env, referer: requestReferer(req, env), startedAt });
    return send(res, 200, { hero, conditions: cond, ...r, detail: r.detail ? maskSecrets(r.detail) : undefined });
  } catch (e) {
    return send(res, 502, { error: '楽天市場で商品を探せませんでした。少し時間をおいてもう一度お試しください。', detail: maskSecrets(e.message).slice(0, 200) });
  }
}
