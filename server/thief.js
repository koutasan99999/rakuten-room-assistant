// 商品ドロボーのAPI：action: extract（スクリーンショットから商品名を読む）／search（楽天で探して照合）／pitch（候補のプレゼンを書く）
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { extractFromScreenshot, pitchCandidate } from '../lib/thief.js';
import { findOnRakuten } from '../lib/product-match.js';
import { maskSecrets } from '../lib/ai.js';

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const MAX_IMAGE = 3000000; // 画面で縮小してから送る（目安：数百KB）

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const action = str(body.action, 20);
  try {
    if (action === 'extract') {
      const image = str(body.image, MAX_IMAGE + 1);
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE) return send(res, 400, { error: '画像を読み込めませんでした（JPEG・PNGのスクリーンショットを選んでください）' });
      const r = await extractFromScreenshot({ image, env, deadline: startedAt + 50000 });
      return send(res, 200, { ...r, notice: r.products.length ? '' : '画像の中に、文字で書かれた商品名が見つかりませんでした。商品名を入力して登録してください。' });
    }
    if (action === 'search') {
      const target = body.target && typeof body.target === 'object' ? body.target : {};
      if (String(target.name || '').replace(/\s/g, '').length < 2) return send(res, 400, { error: '商品名を2文字以上入れてください' });
      const r = await findOnRakuten({ target, env, referer: requestReferer(req, env), until: startedAt + 40000 });
      return send(res, 200, r);
    }
    if (action === 'pitch') {
      const c = body.candidate && typeof body.candidate === 'object' ? body.candidate : null;
      if (!c || !c.name || !c.code) return send(res, 400, { error: '楽天の候補を選んでください' });
      const candidate = { code: str(c.code, 120), name: str(c.name, 200), price: Number(c.price) || 0, postage: str(c.postage, 10), url: str(c.url, 400), image: str(c.image, 400), shop: str(c.shop, 80), caption: str(c.caption, 300), reviewCount: Number(c.reviewCount) || 0 };
      const source = { handle: str(body.source && body.source.handle, 30) };
      return send(res, 200, { item: await pitchCandidate({ candidate, source, env, deadline: startedAt + 40000 }) });
    }
    return send(res, 400, { error: '操作が分かりません' });
  } catch (e) {
    return send(res, 502, { error: /楽天/.test(e.message) ? '楽天市場で検索できませんでした。少し時間をおいてもう一度お試しください。' : 'うまくいきませんでした。少し時間をおいてもう一度お試しください。', detail: maskSecrets(e.message).slice(0, 200) });
  }
}
