// 「この商品から企画を考える」API：ランダム発掘で見つけた1商品を起点に、Instagram企画を3〜5案返す。
import { send, checkAccess, readBody } from '../lib/http.js';
import { readSeedProduct, generateSeedIdeas, fallbackSeedIdeas } from '../lib/seed.js';
import { maskSecrets } from '../lib/ai.js';

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const product = readSeedProduct(body.product);
  if (!product) return send(res, 400, { error: '起点にする商品がありません' });
  try {
    const { analysis, ideas } = await generateSeedIdeas({ product, env, deadline: startedAt + 40000 });
    return send(res, 200, { product, analysis, ideas, notice: '' });
  } catch (e) {
    console.error('[openai] seed fallback:', e.message);
    return send(res, 200, {
      product, analysis: '', ideas: fallbackSeedIdeas(product),
      notice: 'AIで企画を考えられなかったため、簡易的な企画を出しています。',
      detail: `原因: ${maskSecrets(e.message)}`.slice(0, 300)
    });
  }
}
