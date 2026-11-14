// 表紙画像の配信（2026-11-14）：/api/media?id=…（推測できない32文字のID）。サーバーの保存場所に置いた画像（JPEG）を返す。
// アプリの <img> で読むため合言葉は求めない（IDを知っている人だけが見られる）。画像を消す操作は無い
import { kvFrom } from '../lib/kv.js';
import { getMedia } from '../lib/kuma-cover.js';

export default async function handler(req, res, env = process.env) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
  const kv = kvFrom(env);
  const b64 = kv ? await getMedia(kv, id).catch(() => null) : null;
  if (!b64) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('見つかりません'); }
  const buf = Buffer.from(b64, 'base64');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(buf);
}
