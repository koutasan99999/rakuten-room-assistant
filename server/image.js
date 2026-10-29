// 楽天の商品画像を中継するAPI。
// ブラウザで画像の余白を切り取ったり大きさを整えたりするには、同じサイトから読み込む必要があるため。
// 楽天の画像サーバー以外のURLは受け付けない。
import { send, checkAccess } from '../lib/http.js';
import { checkPublicUrl } from '../lib/official.js';

export const ALLOWED_HOST = /(^|\.)(rakuten\.co\.jp|r10s\.jp|rakuten\.ne\.jp)$/;
const MAX_BYTES = 6 * 1024 * 1024;

// 楽天のサムネイルは ?_ex=幅x高さ で大きさを指定できるので、Instagram用に大きめを取る
export function largeImageUrl(raw) {
  const u = new URL(raw);
  if (u.hostname === 'thumbnail.image.rakuten.co.jp') u.searchParams.set('_ex', '800x800');
  return u.toString();
}

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GETで呼び出してください' });
  if (!checkAccess(req, res, env)) return;

  let target;
  const params = new URL(req.url, 'http://localhost').searchParams;
  try {
    target = new URL(params.get('url'));
  } catch {
    return send(res, 400, { error: '画像のURLが正しくありません' });
  }
  // 公式サイトのURLから登録した商品（楽天にない新商品）の画像だけは、公開されているサイトなら中継する
  if (params.get('src') === 'official' && !ALLOWED_HOST.test(target.hostname)) {
    try {
      await checkPublicUrl(target.toString());
      const r = await fetch(target.toString(), { redirect: 'error', signal: AbortSignal.timeout(10000) });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\/(png|jpe?g|webp|gif|avif)/.test(type)) return send(res, 502, { error: '商品画像を取得できませんでした' });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) return send(res, 502, { error: '商品画像が大きすぎます' });
      res.statusCode = 200;
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.end(buf);
    } catch (e) {
      return send(res, 400, { error: '画像を使えませんでした', detail: e.message });
    }
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOST.test(target.hostname)) {
    return send(res, 400, { error: '楽天の画像以外は使えません' });
  }

  try {
    let r = await fetch(largeImageUrl(target.toString()), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) r = await fetch(target.toString(), { signal: AbortSignal.timeout(10000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return send(res, 502, { error: '商品画像を取得できませんでした' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return send(res, 502, { error: '商品画像が大きすぎます' });
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(buf);
  } catch (e) {
    return send(res, 502, { error: '商品画像を取得できませんでした', detail: e.message });
  }
}
