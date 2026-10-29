// API共通の小さな部品（応答の送信・合言葉の確認・リクエスト本文の読み取り）
import crypto from 'node:crypto';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// Vercelでは req.body が用意されるが、手元の簡易サーバーでは自分で読む
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  if (typeof req.on !== 'function') return {};
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200000) break;
  }
  try { return JSON.parse(raw); } catch { return {}; }
}

// 合言葉（APP_PASSCODE）とAPIキーの設定を確認する。問題があれば応答を返して false
export function checkAccess(req, res, env) {
  if (env.APP_PASSCODE && !safeEqual(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) {
    send(res, 401, { error: '合言葉が違います', needPasscode: true });
    return false;
  }
  if (!env.RAKUTEN_APP_ID || !env.OPENAI_API_KEY) {
    send(res, 500, { error: 'サーバーの設定（APIキー）がまだ完了していません' });
    return false;
  }
  return true;
}

export function requestReferer(req, env) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return env.RAKUTEN_REFERER || `https://${host}/`;
}
