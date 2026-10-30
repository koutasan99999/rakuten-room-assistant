// バイヤー発掘便のAPI：画面の「発掘開始」で呼ぶ（自動では呼ばない）。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { THEMES, readFeedback, scout } from '../lib/buyer.js';
import { maskSecrets } from '../lib/ai.js';

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method === 'GET') return send(res, 200, { themes: THEMES });
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  try {
    const r = await scout({ theme: THEMES[body.theme] ? body.theme : 'auto', feedback: readFeedback(body.feedback), env, referer: requestReferer(req, env), startedAt });
    return send(res, 200, r);
  } catch (e) {
    return send(res, 502, { error: '発掘できませんでした。少し時間をおいてもう一度お試しください。', detail: maskSecrets(e.message).slice(0, 200) });
  }
}
