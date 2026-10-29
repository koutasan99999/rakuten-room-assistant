// AI着用イメージを作るAPI。画面で「完成コーデを生成」を押したときだけ呼ばれる（料金がかかるため自動では呼ばない）。
import { send, checkAccess, readBody } from '../lib/http.js';
import { readTryOnRequest, generateTryOn, COST_YEN, IMAGE_MODELS, BACKGROUNDS, POSES } from '../lib/tryon.js';
import { maskSecrets } from '../lib/ai.js';

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method === 'GET') {
    // 画面に出す選択肢と、1枚あたりの料金の目安
    const model = env.OPENAI_IMAGE_MODEL || IMAGE_MODELS[0];
    return send(res, 200, { model, cost: COST_YEN[model] || COST_YEN['gpt-image-2'], backgrounds: BACKGROUNDS, poses: POSES });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const r = readTryOnRequest(await readBody(req));
  if (!r) return send(res, 400, { error: 'コーデのアイテムがありません' });
  try {
    const out = await generateTryOn(r, env, { deadline: startedAt + 56000 });
    return send(res, 200, out);
  } catch (e) {
    return send(res, 502, { error: e.message.replace(/（\w[\s\S]*$/, '').slice(0, 120) || '画像を生成できませんでした', detail: maskSecrets(e.message).slice(0, 300) });
  }
}
