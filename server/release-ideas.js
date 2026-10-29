// 新商品専用の企画（new_release）：レーダーの商品から、Instagram企画のタイトルを3〜5案返すAPI。
import { send, checkAccess, readBody } from '../lib/http.js';
import { readReleaseProduct, generateReleaseTitles, toReleaseIdea, moodOf } from '../lib/release.js';
import { maskSecrets } from '../lib/ai.js';

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const product = readReleaseProduct(body.product);
  if (!product) return send(res, 400, { error: '起点にする商品がありません' });
  const r = await generateReleaseTitles({ product, env, deadline: startedAt + 35000 });
  return send(res, 200, {
    product,
    mood: moodOf(product.category),
    ideas: r.ideas.map((x) => ({ ...x, idea: toReleaseIdea(x, product) })),
    notice: r.fallback ? 'AIでタイトルを作れなかったため、確認できた情報から簡易的なタイトルを出しています。' : '',
    detail: r.fallback ? `原因: ${maskSecrets(r.error || '')}`.slice(0, 300) : undefined
  });
}
