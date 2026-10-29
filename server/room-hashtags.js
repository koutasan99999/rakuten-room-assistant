// 楽天ROOMに投稿するときのハッシュタグを、投稿（企画）単位で作るAPI。ROOM登録準備の画面から呼ぶ（作り直しもできる）。
import { send, checkAccess, readBody } from '../lib/http.js';
import { generateRoomHashtags } from '../lib/room-hashtags.js';
import { maskSecrets } from '../lib/ai.js';

const MAX_ITEMS = 20;
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const campaign = {
    campaignTheme: str(body.campaignTheme, 80),
    campaignType: str(body.campaignType, 30),
    targetAudience: str(body.targetAudience, 60),
    priceRange: str(body.priceRange, 30)
  };
  if (!campaign.campaignTheme) return send(res, 400, { error: '企画のテーマがありません' });
  const items = (Array.isArray(body.items) ? body.items : []).filter((x) => x && x.productName).slice(0, MAX_ITEMS).map((x) => ({
    productName: str(x.productName, 200), productCategory: str(x.productCategory, 30), productUseCase: str(x.productUseCase, 60),
    roomDescription: str(x.roomDescription, 400), brand: str(x.brand, 30)
  }));
  if (!items.length) return send(res, 400, { error: '商品がありません' });
  const r = await generateRoomHashtags({ campaign, items, env, deadline: startedAt + 40000 });
  return send(res, 200, {
    common: r.common,
    products: r.products,
    notice: r.fallback ? 'AIでタグを作れなかったため、企画のテーマと商品名から簡易的に作りました。' : '',
    detail: r.fallback ? `原因: ${maskSecrets(r.error || '')}`.slice(0, 300) : undefined
  });
}
