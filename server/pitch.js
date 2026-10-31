// 「社長、これどうすか？」のAPI：画面のボタンで呼ぶ（自動では呼ばない）。
// action: seed（初期候補）／scout（新しく探す）／more（もっと見せて）／intro（ROOM紹介文）／feature（看板商品の特集原稿）／verify（登録前の確認）
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { readTaste, readExclude, scout, seed, verify, featurePlan } from '../lib/pitch.js';
import { generateIntros } from '../lib/explore.js';
import { maskSecrets } from '../lib/ai.js';

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
function readProduct(x) {
  const p = x && typeof x === 'object' ? x : {};
  return {
    name: str(p.name, 200), brand: str(p.brand, 40), price: Number(p.price) || 0, category: str(p.category, 10),
    code: str(p.code, 120), caption: str(p.caption, 400), pitch: str(p.pitch, 300), fit: str(p.fit, 120), caution: str(p.caution, 120)
  };
}

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const referer = requestReferer(req, env);
  const action = str(body.action, 20);
  try {
    if (action === 'seed') return send(res, 200, await seed({ exclude: readExclude(body.exclude), env, referer, startedAt }));
    if (action === 'scout' || action === 'more') {
      const base = action === 'more' ? readProduct(body.base) : null;
      if (base && !base.name) return send(res, 400, { error: '元の商品がありません' });
      return send(res, 200, await scout({ taste: readTaste(body.taste), exclude: readExclude(body.exclude), base, env, referer, startedAt }));
    }
    const p = readProduct(body.product);
    if (action === 'verify') {
      if (!p.code) return send(res, 400, { error: '商品番号がありません' });
      return send(res, 200, await verify({ code: p.code, price: p.price, env, referer }));
    }
    if (!p.name) return send(res, 400, { error: '商品がありません' });
    if (action === 'intro') {
      const r = await generateIntros({ title: p.category || '', items: [{ name: p.name, price: p.price, brand: p.brand, reason: p.fit, caption: p.caption }], env, deadline: startedAt + 50000 });
      return send(res, 200, { intro: r.intros[0] || '', notice: r.fallback ? 'AIでの紹介文作成に失敗したため、簡易的な紹介文にしました。直してから使ってください。' : '' });
    }
    if (action === 'feature') return send(res, 200, await featurePlan({ product: p, env, deadline: startedAt + 50000 }));
    return send(res, 400, { error: '操作が分かりません' });
  } catch (e) {
    return send(res, 502, { error: 'うまくいきませんでした。少し時間をおいてもう一度お試しください。', detail: maskSecrets(e.message).slice(0, 200) });
  }
}
