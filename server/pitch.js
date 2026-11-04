// 「社長、これどうすか？」のAPI：画面のボタンで呼ぶ（自動では呼ばない）。
// action: roomtext（ROOM紹介文とハッシュタグ）／expand（この商品から広げる）／set（投稿セットの自動制作。社長が採用した商品を優先）／alternatives（差し替えの候補）／replace（1商品の差し替え・旧）／seed（初期候補）／scout（新しく探す）／more（もっと見せて）／intro（ROOM紹介文）／feature（看板商品の特集原稿）／verify（登録前の確認）
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { readTaste, readExclude, readRefs, scout, seed, verify, featurePlan } from '../lib/pitch.js';
import { generateIntros } from '../lib/explore.js';
import { buildSet, replaceItem, alternatives, readHistory, readAdopted, PATTERNS } from '../lib/postset.js';
import { expand, readBase, readPath } from '../lib/expand.js';
import { generateRoomHashtags } from '../lib/room-hashtags.js';
import { maskSecrets, AiError } from '../lib/ai.js';

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
      return send(res, 200, await scout({ taste: readTaste(body.taste), refs: readRefs(body.refs), exclude: readExclude(body.exclude), base, env, referer, startedAt }));
    }
    // 投稿セット（1企画・3〜6商品）の自動制作と、1商品の差し替え
    if (action === 'set') {
      const ex = readExclude(body.exclude);
      const recent = (Array.isArray(body.recentPatterns) ? body.recentPatterns : []).map(String).filter((x) => PATTERNS[x]).slice(0, 5);
      const set = await buildSet({ history: readHistory(body.history), recentPatterns: recent, adopted: readAdopted(body.adopted), exclude: new Set([...ex.codes, ...ex.names]), note: String(body.note || '').slice(0, 120), env, referer, startedAt });
      return send(res, 200, { set });
    }
    if (action === 'replace') {
      const set = body.set && typeof body.set === 'object' ? body.set : null;
      if (!set || !Array.isArray(set.items)) return send(res, 400, { error: '投稿セットがありません' });
      return send(res, 200, { set: await replaceItem({ set, index: Number(body.index), env, referer, startedAt }) });
    }
    // この商品から広げる（関連する実在の商品を探す。探索は何段階でも続けられる）
    if (action === 'expand') {
      const base = readBase(body.base);
      if (!base.name) return send(res, 400, { error: '起点の商品がありません' });
      const ex = readExclude(body.exclude);
      return send(res, 200, await expand({ base, mode: str(body.mode, 20), path: readPath(body.path), exclude: new Set([...ex.codes, ...ex.names]), want: Number(body.want) || 0, env, referer, startedAt }));
    }
    // 楽天ROOMの紹介文とハッシュタグ（投稿セットの1商品。企画のテーマに合わせた切り口で）
    if (action === 'roomtext') {
      const it = body.item && typeof body.item === 'object' ? body.item : {};
      const set = body.set && typeof body.set === 'object' ? body.set : {};
      const item = { name: str(it.name, 200), price: Number(it.price) || 0, role: str(it.role, 20), brand: str(it.brand, 30), reason: str([it.feature, it.why].filter(Boolean).join('。'), 200), caption: str(it.caption, 300) };
      if (!item.name) return send(res, 400, { error: '商品がありません' });
      const theme = str(set.title, 60);
      const rules = `\n追加の決まり（楽天ROOMの1商品の投稿）:\n- 紹介文は150〜200字。絵文字は使わない\n- 企画「${theme}」（${str(set.patternLabel, 40)}${set.target ? `・${str(set.target, 40)}` : ''}）の中での、この商品の役割（${item.role || 'なし'}）に合った切り口にする\n- 商品データで確認できない性能・仕様は書かない。必要なら買う前の注意点を1つ書く`;
      const [ir, hr] = await Promise.all([
        generateIntros({ title: theme, items: [item], env, deadline: startedAt + 45000, extraRules: rules }),
        generateRoomHashtags({ campaign: { campaignTheme: theme || item.name, campaignType: str(set.patternLabel, 30), targetAudience: str(set.target, 60), priceRange: '' }, items: [{ productName: item.name, productCategory: '', productUseCase: item.role, roomDescription: item.reason, brand: item.brand }], env, deadline: startedAt + 45000 })
      ]);
      const tags = [...new Set([...((hr.products && hr.products[0] && hr.products[0].tags) || []), ...(hr.common || [])])].slice(0, 10);
      return send(res, 200, { intro: (ir.intros[0] || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ''), tags, notice: [ir.fallback ? 'AIで紹介文を作れなかったため、簡易的な紹介文にしました' : '', hr.fallback ? 'ハッシュタグは企画のテーマと商品名から簡易的に作りました' : ''].filter(Boolean).join('。') });
    }
    if (action === 'alternatives') {
      const set = body.set && typeof body.set === 'object' ? body.set : null;
      if (!set || !Array.isArray(set.items)) return send(res, 400, { error: '投稿セットがありません' });
      return send(res, 200, await alternatives({ set, index: Number(body.index), reason: String(body.reason || '').slice(0, 100), adopted: readAdopted(body.adopted), env, referer, startedAt }));
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
    // 広げる：理由の分かる失敗（ブランドが分からない・条件に合う商品がない）は、やり直さずにそのまま伝える（同じ検索を何度も呼ばない）
    if (action === 'expand' && e instanceof AiError) return send(res, 422, { error: e.message });
    return send(res, 502, { error: 'うまくいきませんでした。少し時間をおいてもう一度お試しください。', detail: maskSecrets(e.message).slice(0, 200) });
  }
}
