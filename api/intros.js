// 投稿に使う商品が決まったら、その商品の楽天ROOM紹介文だけを作るAPI（候補全部の紹介文は作らない＝料金を抑える）。
import { send, checkAccess, readBody } from '../lib/http.js';
import { generateIntros } from '../lib/explore.js';
import { maskSecrets } from '../lib/ai.js';

const MAX_ITEMS = 10;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const items = (Array.isArray(body.items) ? body.items : []).filter((x) => x && x.name).slice(0, MAX_ITEMS).map((x) => ({
    name: str(x.name, 200), price: Number(x.price) || 0, role: str(x.role, 20), brand: str(x.brand, 30), reason: str(x.reason, 200), caption: str(x.caption, 300)
  }));
  if (!items.length) return send(res, 400, { error: '商品が選ばれていません' });
  const r = await generateIntros({ title: str(body.title, 60), items, env, deadline: startedAt + 50000 });
  return send(res, 200, {
    intros: r.intros,
    notice: r.fallback ? 'AIでの紹介文作成に失敗したため、簡易的な紹介文にしました。' : '',
    detail: r.fallback ? `原因: ${maskSecrets(r.error || '')}`.slice(0, 300) : undefined
  });
}
