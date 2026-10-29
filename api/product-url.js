// 楽天にない新商品：公式サイトの商品URLから、商品名・画像・価格を読んで候補にするAPI。
// 読めなかった項目は画面で手入力できる（取得できなくても登録はできる）。
import { send, checkAccess, readBody } from '../lib/http.js';
import { fetchOfficialProduct } from '../lib/official.js';

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  try {
    const product = await fetchOfficialProduct(body.url);
    if (!product.name) return send(res, 200, { product, notice: '商品名を読み取れませんでした。手入力してください。' });
    return send(res, 200, { product, notice: product.price ? '' : '価格を読み取れませんでした。必要なら手入力してください。' });
  } catch (e) {
    return send(res, 400, { error: e.message || 'ページを読めませんでした' });
  }
}
