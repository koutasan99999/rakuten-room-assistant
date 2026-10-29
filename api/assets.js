// 「投稿素材をまとめて作る」のうち、Reel（台本・テロップ・シーン構成）と Story（3枚）の文字を作るAPI。
// カルーセルと同じ企画・同じ商品を使う。投稿管理から、まだ作っていないものだけ後から作るときにも使う。
import { send, checkAccess, readBody } from '../lib/http.js';
import { buildReelStory } from '../lib/assets.js';
import { normalizeTopic } from '../lib/instagram.js';
import { maskSecrets } from '../lib/ai.js';

const MAX_ITEMS = 8;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const items = (Array.isArray(body.items) ? body.items : []).filter((x) => x && (x.name || x.shortName)).slice(0, MAX_ITEMS).map((x) => ({
    name: str(x.name, 200), shortName: str(x.shortName, 30), price: Number(x.price) || 0, role: str(x.role, 20), reason: str(x.reason, 200)
  }));
  if (!items.length) return send(res, 400, { error: '商品が選ばれていません' });
  const topic = normalizeTopic(str(body.theme, 60));
  if (!topic) return send(res, 400, { error: '投稿テーマがありません' });
  const criteria = (Array.isArray(body.criteria) ? body.criteria : []).map((c) => str(c, 20)).filter(Boolean).slice(0, 3);
  const r = await buildReelStory({ topic, title: str(body.title, 60), criteria, items, env, deadline: startedAt + 40000 });
  return send(res, 200, {
    reel: r.reel,
    story: r.story,
    notice: r.fallback ? 'AIでReel・Storyの文字を作れなかったため、簡易的な文字で作りました。' : '',
    detail: r.fallback ? `原因: ${maskSecrets(r.error || '')}`.slice(0, 300) : undefined
  });
}
