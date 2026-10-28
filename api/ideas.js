// 「今日の企画を考える」で呼ばれるAPI。商品ではなく、Instagram投稿の企画を3案返す。
import { send, checkAccess, readBody } from '../lib/http.js';
import { generateIdeas } from '../lib/ideas.js';
import { maskSecrets } from '../lib/ai.js';

// 画面から送られてくる直近の投稿履歴（重複を避けるために使う）を安全な形に整える
function cleanHistory(list) {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  return (Array.isArray(list) ? list : []).slice(0, 10).filter((h) => h && typeof h === 'object').map((h) => ({
    topic: str(h.topic || h.title, 40),
    genre: str(h.genre, 20),
    postType: str(h.postType, 30),
    target: str(h.target, 40),
    priceBand: str(h.priceBand, 24),
    brands: (Array.isArray(h.brands) ? h.brands : []).slice(0, 6).map((b) => str(b, 24))
  }));
}

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const result = await generateIdeas({ history: cleanHistory(body.history), env, deadline: startedAt + 40000 });
  return send(res, 200, {
    ideas: result.ideas,
    notice: result.fallback ? 'AIで企画を考えられなかったため、簡易的な企画を出しています。' : '',
    detail: result.fallback ? `原因: ${maskSecrets(result.error || '')}`.slice(0, 300) : undefined
  });
}
