// 「AIでタイトルを再提案」API：今の企画の内容から、タイトルを3〜5案返す（置き換えるかどうかは画面でユーザーが決める）。
import { send, checkAccess, readBody } from '../lib/http.js';
import { readPlanForTitles, suggestTitles } from '../lib/plan-titles.js';
import { maskSecrets } from '../lib/ai.js';

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const plan = readPlanForTitles((await readBody(req)).plan);
  if (!plan) return send(res, 400, { error: '企画の内容がありません' });
  const r = await suggestTitles({ plan, env, deadline: startedAt + 25000 });
  return send(res, 200, {
    titles: r.titles,
    notice: r.fallback ? 'AIでタイトルを考えられなかったため、簡易的な案を出しています。' : '',
    detail: r.fallback ? `原因: ${maskSecrets(r.error || '')}`.slice(0, 300) : undefined
  });
}
