// 「別の候補を出す」ボタンから呼ばれるAPI。
// 選び方まとめで外した商品の代わりを、同じ枠（役割）の候補から1つ選び直す。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { CURATION_TYPES } from '../lib/themes.js';
import { searchSlot } from '../lib/rakuten.js';
import { buildReplacement, fallbackReplacement } from '../lib/curation.js';
import { maskSecrets } from '../lib/ai.js';

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const price = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 100 && n <= 2000000 ? n : undefined;
};

// クライアントから戻ってきた条件を、使える形に整える
export function readContext(c) {
  if (!c || typeof c !== 'object' || !CURATION_TYPES[c.type]) return null;
  const slots = (Array.isArray(c.slots) ? c.slots : []).slice(0, 8)
    .map((s) => ({ label: str(s && s.label, 14), keyword: str(s && s.keyword, 40), minPrice: price(s && s.minPrice), maxPrice: price(s && s.maxPrice) }))
    .filter((s) => s.label && s.keyword);
  if (!slots.length) return null;
  return {
    type: c.type, title: str(c.title, 60), audience: str(c.audience, 40), brand: c.brand === true,
    idea: c.pick === true ? {} : null, request: str(c.request, 1500), slots
  };
}

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;

  const body = await readBody(req);
  const theme = readContext(body.context);
  if (!theme) return send(res, 400, { error: 'このまとめは差し替えに対応していません。もう一度まとめを作ってください。' });
  const slotLabel = str(body.slot, 14);
  const role = str(body.role, 14) || slotLabel;
  // 同じ枠が無いとき（古い結果など）は、役割名が近い枠か最初の枠で探す
  const slot = theme.slots.find((s) => s.label === slotLabel) || theme.slots.find((s) => s.label === role) || theme.slots[0];
  const exclude = new Set((Array.isArray(body.exclude) ? body.exclude : []).map((x) => str(x, 80)).filter(Boolean));
  const others = (Array.isArray(body.others) ? body.others : []).slice(0, 8).map((o) => ({ name: str(o && o.name, 80), role: str(o && o.role, 14) })).filter((o) => o.name);
  const tries = Math.min(Math.max(parseInt(body.tries, 10) || 0, 0), 5);
  const referer = requestReferer(req, env);

  // 何度も差し替えるときは検索ページを進めて、新しい候補も混ぜる
  let items = [];
  try {
    const page = 1 + Math.floor(tries / 2);
    items = (await searchSlot({ ...slot, env, referer, page, limit: 20 })).filter((it) => !exclude.has(it.code));
    if (items.length < 3 && page === 1) {
      await new Promise((r) => setTimeout(r, 1100));
      items = items.concat((await searchSlot({ ...slot, env, referer, page: 2, limit: 20 })).filter((it) => !exclude.has(it.code) && !items.some((x) => x.code === it.code)));
    }
  } catch (e) {
    console.error('[rakuten]', e.message);
    return send(res, 502, { error: '楽天市場の商品を取得できませんでした。少し時間をおいてもう一度お試しください。', detail: e.message });
  }
  if (!items.length) return send(res, 200, { product: null, notice: 'この役割の別の候補が見つかりませんでした。' });

  const filled = { ...slot, items: items.slice(0, 15) };
  try {
    const product = await buildReplacement({ theme, slot: filled, role, others, env, deadline: startedAt + 50000 });
    return send(res, 200, { product, notice: '' });
  } catch (e) {
    console.error('[openai] fallback:', e.message);
    return send(res, 200, {
      product: fallbackReplacement({ slot: filled, role }),
      notice: 'AIでの選び直しに失敗したため、同じ役割の候補をそのまま表示しています。',
      detail: `原因: ${maskSecrets(e.message)}`.slice(0, 300)
    });
  }
}
