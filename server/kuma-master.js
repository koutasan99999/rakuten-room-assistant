// サングラスくまのマスター画像のAPI（2026-11-14）：/api/kuma-master
// action: list（一覧と状態）／approve（社長の承認・画面で見た画像の指紋が必要）／revoke（承認の取り消し。画像は消さない）
// AIは呼ばない（費用0円）。合言葉（APP_PASSCODE）が必須。承認はサーバーの保存場所に残すため、未接続なら承認できない
import crypto from 'node:crypto';
import { send, readBody } from '../lib/http.js';
import { kvFrom } from '../lib/kv.js';
import { listMasters, usableMasters, approve, revoke, FIXED_TRAITS, MAX_MASTERS } from '../lib/kuma-master.js';
import { maskSecrets } from '../lib/ai.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!String(env.APP_PASSCODE || '').trim()) return send(res, 503, { error: 'サーバーの合言葉（APP_PASSCODE）が未設定のため、マスター画像の承認は使えません' });
  if (!same(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  const kv = kvFrom(env);
  const body = await readBody(req);
  const action = String(body.action || 'list');
  try {
    if (action === 'list') {
      const usable = await usableMasters(kv);
      return send(res, 200, { configured: !!kv, masters: await listMasters(kv), usable: { ok: usable.ok, reason: usable.reason, count: usable.masters.length }, traits: FIXED_TRAITS, max: MAX_MASTERS });
    }
    if (!kv) return send(res, 200, { configured: false, error: 'サーバーの保存場所が未接続のため、承認を記録できません' });
    if (action === 'approve') return send(res, 200, { configured: true, approved: await approve(kv, String(body.id || ''), String(body.sha256 || '')), masters: await listMasters(kv) });
    if (action === 'revoke') return send(res, 200, { configured: true, revoked: await revoke(kv, String(body.id || '')), masters: await listMasters(kv) });
    return send(res, 400, { error: '操作が分かりません' });
  } catch (e) {
    return send(res, 400, { configured: true, error: maskSecrets(String(e && e.message || e)).slice(0, 200) });
  }
}
