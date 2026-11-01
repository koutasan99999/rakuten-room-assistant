// 「この商品を楽天で探す」ための検索と照合（商品ドロボー・社長、これどうすか？の初期候補で使う）。
// 今までの検索は、入力をそのまま1回（またはお尻の言葉を1つずつ外して）検索し、先頭の商品をそのまま使っていた。
// ここでは、ブランド＋型番 → 型番だけ → ブランドの表記ゆれ＋主な言葉 → 言葉を減らす、の順に段階的に検索し、
// 見つかった商品を「同一商品（型番が一致）」「類似商品」「未確認」に分ける。画像は照合しない（写真が同じでも別の商品のことがあるため）。
import { searchPage } from './rakuten.js';
import { norm, findBrand, brandForms, hasBrand, findModels, findKind, stripPromo, dedupeProducts } from './product-analysis.js';

export const MATCH = { same: '同一商品', similar: '類似商品', unknown: '未確認' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 本体ではなく、対応品・付属品であることを示す言葉
const ACCESSORY_RE = /対応|専用|用ケース|ケース|カバー|フィルム|保護|交換用|替え|互換|スタンドのみ|ストラップ|部品|パーツ|スキンシール/;
const NOISE_RE = /送料無料|正規品|公式|新作|新品|限定|人気|おすすめ|ギフト|プレゼント|メンズ|レディース|ユニセックス|即納|あす楽|ポイント\d*倍|\d+%OFF/gi;
const words = (...xs) => xs.map((x) => String(x || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

// 探したい商品（Instagramで見た商品・社長が入力した商品）。name は必須、brand・model・aliases は分かれば
export function readTarget(x) {
  const t = x && typeof x === 'object' ? x : {};
  const s = (v, n) => String(v == null ? '' : v).normalize('NFKC').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const name = s(t.name, 120);
  const brandIn = s(t.brand, 40);
  const modelIn = s(t.model, 30).toUpperCase().replace(/[\s-]/g, '');
  const aliases = (Array.isArray(t.aliases) ? t.aliases : []).map((a) => s(a, 40)).filter(Boolean).slice(0, 5);
  const known = brandIn ? null : findBrand(name);
  const models = modelIn ? [modelIn] : findModels(name);
  return { name, brand: brandIn || (known ? known.name : ''), model: models[0] || '', aliases };
}

// 商品名から、ブランド・型番・宣伝文句を除いた主な言葉（最大4語）
export function coreWords(t) {
  let s = stripPromo(t.name).replace(NOISE_RE, ' ');
  for (const f of t.brand ? [t.brand, ...brandForms(t.brand)] : []) s = s.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  if (t.model) s = s.replace(new RegExp(t.model.split('').join('[\\s-]?'), 'ig'), ' ');
  return s.replace(/[「」『』"'、。,.!?！？()（）[\]【】/／|｜×]/g, ' ').split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
}

// 検索語の段階（きつい順）。同じ言葉は1回だけ
export function queryLadder(t) {
  const core = coreWords(t);
  const kind = findKind(t.name);
  // ブランドの表記ゆれ（英字・カタカナ）。辞書にないブランドは入力のまま
  const brandVariants = t.brand ? [...new Set([t.brand, ...brandForms(t.brand).filter((f) => f.length >= 2 && !/^[a-z0-9]+$/.test(f) || f === norm(t.brand))])].slice(0, 3) : [];
  const steps = [];
  if (t.model) {
    if (t.brand) steps.push({ keyword: words(t.brand, t.model), why: 'ブランド＋型番' });
    steps.push({ keyword: t.model, why: '型番だけ' });
  }
  if (t.brand && core.length) steps.push({ keyword: words(t.brand, core.slice(0, 3).join(' ')), why: 'ブランド＋主な言葉' });
  for (const b of brandVariants.slice(1)) if (core.length) steps.push({ keyword: words(b, core.slice(0, 2).join(' ')), why: 'ブランドの別の表記' });
  for (const a of t.aliases) steps.push({ keyword: a, why: '別名' });
  for (let n = Math.min(3, core.length); n >= 1; n--) steps.push({ keyword: core.slice(0, n).join(' '), why: n === core.length ? '主な言葉' : '言葉を減らして' });
  if (t.brand && kind) steps.push({ keyword: words(t.brand, kind), why: 'ブランド＋種類' });
  if (!steps.length && t.name) steps.push({ keyword: t.name.slice(0, 40), why: '商品名そのまま' });
  const seen = new Set();
  return steps.filter((s) => s.keyword && s.keyword.replace(/\s/g, '').length >= 2 && !seen.has(norm(s.keyword)) && seen.add(norm(s.keyword)));
}

// 楽天の商品が、探している商品と同じかを判定する。画像は使わない
export function classifyMatch(t, item) {
  const name = String(item.name || '');
  const itemModels = findModels(name).concat(findModels(String(item.caption || '').slice(0, 300)));
  const brandOk = t.brand ? hasBrand(name, t.brand) || hasBrand(String(item.shop || ''), t.brand) : null;
  const accessory = ACCESSORY_RE.test(name) && !ACCESSORY_RE.test(t.name);
  const core = coreWords(t).map(norm);
  const n = norm(name);
  const hit = core.filter((w) => n.includes(w)).length;
  const overlap = core.length ? hit / core.length : 0;
  if (accessory) return { match: 'similar', note: '本体ではなく、対応品・付属品の可能性があります' };
  if (t.model && itemModels.includes(t.model)) {
    if (brandOk === false) return { match: 'similar', note: `型番 ${t.model} は同じですが、ブランドが確認できません` };
    return { match: 'same', note: `型番 ${t.model} が一致${t.brand ? '・ブランドも一致' : ''}（画像は照合していません）` };
  }
  if (t.model && itemModels.length) return { match: brandOk ? 'similar' : 'unknown', note: `型番が違います（${itemModels[0]}）${brandOk ? '。同じブランドの別の商品の可能性' : ''}` };
  if (brandOk && overlap >= 0.5) return { match: 'similar', note: `ブランドと名前の言葉は一致（型番では確認できないため、同一とは断定しません）` };
  if (brandOk) return { match: 'similar', note: '同じブランドの商品です（同じ商品かは未確認）' };
  if (overlap >= 0.67 && brandOk === null) return { match: 'similar', note: '名前の言葉は一致（ブランド・型番が分からないため未確認）' };
  return { match: 'unknown', note: '同じ商品かどうか確認できません' };
}

const RANK = { same: 0, similar: 1, unknown: 2 };

// 段階的に検索して、照合した結果を返す。同一商品が見つかったら早めに止める
export async function findOnRakuten({ target, env, referer, until = Date.now() + 25000, maxCalls = 4, want = 8 }) {
  const t = readTarget(target);
  const ladder = queryLadder(t);
  const tried = [];
  let found = [];
  for (const [i, step] of ladder.entries()) {
    if (tried.length >= maxCalls || Date.now() + 1500 > until) break;
    if (i > 0) await sleep(1100); // 楽天APIは1秒1回まで
    try {
      const r = await searchPage({ keyword: step.keyword, env, referer, hits: 30 });
      tried.push({ ...step, count: r.items.length });
      found = dedupeProducts(found.concat(r.items)).items;
    } catch (e) {
      tried.push({ ...step, count: 0, error: e.message });
      if (/40[13]/.test(e.message)) break;
      continue;
    }
    // 型番が一致する商品が見つかったら、それ以上ゆるめた検索はしない（関係の薄い商品が混ざるだけなので）
    if (found.some((it) => classifyMatch(t, it).match === 'same')) break;
  }
  const items = found.map((it) => ({ ...it, caption: String(it.caption || '').slice(0, 200), ...classifyMatch(t, it) }))
    .sort((a, b) => RANK[a.match] - RANK[b.match])
    .slice(0, want);
  return { target: t, items, tried };
}

// 初期候補など、1回の検索結果から「探している商品らしいもの」を1つ選ぶ（未確認・付属品は選ばない）
export function bestMatch(target, items) {
  const t = readTarget(target);
  const ranked = items.map((it) => ({ it, ...classifyMatch(t, it) })).filter((x) => x.match !== 'unknown' && !/付属品/.test(x.note));
  ranked.sort((a, b) => RANK[a.match] - RANK[b.match]);
  return ranked[0] || null;
}
