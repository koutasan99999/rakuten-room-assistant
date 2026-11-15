// サングラスくま株式会社 2.0 の画面用API（2026-11-15）：/api/v2
// action: state（オフィス・仕事の流れ・完成品の一覧・お金）／set（完成品1件）／decide（採用・却下・修正依頼）／sales（売上の手入力）／activate（2.0に切り替え・戻す）
// 合言葉（APP_PASSCODE）が必要。AIは呼ばない（仕事は定期実行 /api/worker が進める）。鍵の値は応答・記録に出さない
import crypto from 'node:crypto';
import { send, readBody } from '../lib/http.js';
import { kvFrom } from '../lib/kv.js';
import { maskSecrets } from '../lib/ai.js';
import * as V from '../lib/v2/company.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!String(env.APP_PASSCODE || '').trim()) return send(res, 503, { error: 'サーバーの合言葉（APP_PASSCODE）が未設定です' });
  if (!same(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  const kv = kvFrom(env);
  if (!kv) return send(res, 200, { configured: false, error: 'サーバーの保存場所が未接続です' });
  const body = await readBody(req);
  const action = String(body.action || 'state');
  try {
    if (action === 'state') return send(res, 200, { configured: true, ...(await V.officeState(kv, env)) });
    if (action === 'set') { const s = await V.getSet(kv, body.id); return s ? send(res, 200, { set: s }) : send(res, 404, { error: 'その完成品はありません' }); }
    if (action === 'decide') return send(res, 200, await V.decide(kv, { id: String(body.id || ''), action: String(body.decision || ''), note: body.note }));
    if (action === 'sales') return send(res, 200, { sales: await V.setSales(kv, { month: body.month, yen: body.yen }) });
    if (action === 'activate') return send(res, 200, { active: await V.setActive(kv, body.on === true) });
    return send(res, 400, { error: 'この操作はありません' });
  } catch (e) {
    return send(res, 400, { error: maskSecrets(String(e && e.message || e)).slice(0, 200) });
  }
}
