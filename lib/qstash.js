// QStash（Upstash の定期実行・無料枠）からの呼び出しを確かめる（2026-11-16）。
// QStash は呼び出しごとに Upstash-Signature（JWT・HS256）を付ける。署名の鍵（QSTASH_CURRENT_SIGNING_KEY／QSTASH_NEXT_SIGNING_KEY）は
// Vercel の環境変数だけに置く。合言葉（CRON_SECRET）を QStash に預けなくてよい。
// 確かめること：署名（今の鍵か次の鍵）・発行者（Upstash）・有効期限・本文の要約値（定期実行は本文なしで送る）・呼び先のURLのパス。
import crypto from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const unpad = (s) => String(s || '').replace(/=+$/, '');
// 環境変数に貼り付けたときに付きやすい、前後の空白・改行・引用符だけを取り除く（鍵そのものは変えない。認証を緩めることにはならない）
export const cleanKey = (k) => String(k == null ? '' : k).trim().replace(/^(["'])(.*)\1$/, '$2').trim();
// 原因を調べるための情報（鍵の値は出さない：設定の有無・形・前後の余計な文字があったかだけ）
export function keyInfo(keys) {
  return keys.map((k) => { const raw = String(k == null ? '' : k); const c = cleanKey(raw); return { set: !!c, sigPrefix: /^sig_/.test(c), hadExtra: raw !== c }; });
}

export function verifyQstash({ signature, body = '', keys = [], path = '/api/worker', now = Date.now() }) {
  const parts = String(signature || '').split('.');
  if (parts.length !== 3) return { ok: false, why: '署名の形が違う' };
  const keyList = keys.map(cleanKey).filter(Boolean);
  if (!keyList.length) return { ok: false, why: '署名の鍵（QSTASH_CURRENT_SIGNING_KEY）が未設定' };
  // 署名の方式：HMAC-SHA256（HS256）だけを受け付ける（ほかの方式は受け付けない）
  let head = {};
  try { head = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return { ok: false, why: '署名の見出しを読めない' }; }
  if (head.alg !== 'HS256') return { ok: false, why: `署名の方式が HS256 ではない（${String(head.alg).slice(0, 10)}）` };
  const signed = `${parts[0]}.${parts[1]}`;
  const good = keyList.some((k) => {
    const want = b64url(crypto.createHmac('sha256', k).update(signed).digest());
    return want.length === parts[2].length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(parts[2]));
  });
  if (!good) return { ok: false, why: '署名が一致しない' };
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return { ok: false, why: '署名の中身を読めない' }; }
  const sec = Math.floor(now / 1000);
  if (claims.iss !== 'Upstash') return { ok: false, why: '発行者が Upstash ではない' };
  if (!(Number(claims.exp) > sec - 5)) return { ok: false, why: '署名の有効期限切れ' };
  if (claims.nbf && Number(claims.nbf) > sec + 5) return { ok: false, why: '署名がまだ有効になっていない' };
  try { if (new URL(String(claims.sub)).pathname !== path) return { ok: false, why: '呼び先のURLが違う' }; } catch { return { ok: false, why: '呼び先のURLが読めない' }; }
  // 本文の要約値は base64url と base64 のどちらの書き方でも受け付ける（どちらも同じ値）
  const digest = crypto.createHash('sha256').update(body).digest();
  if (![b64url(digest), unpad(digest.toString('base64'))].includes(unpad(claims.body))) return { ok: false, why: '本文が署名と一致しない（定期実行は本文なしで送る）' };
  return { ok: true, claims };
}
