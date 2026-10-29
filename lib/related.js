// 関連商品を探す：起点の商品を「ブランド・コラボ相手・種類・型番・色・特徴」に分けてから、
// 探し方（検索軸）ごとに別の検索語を作る。起点の商品名やコラボ名をまるごと全部の検索に入れない。
// 結果が少なければ検索語をゆるめ、同じ商品ばかりなら別の軸に切り替える。
import { searchPage } from './rakuten.js';
import { analyzeProduct, brandNgWords, dedupeProducts, findBrand, hasBrand, isSameProduct, looksCollab } from './product-analysis.js';
import { slotOf, genderOf, fallbackLooks, readCoordConditions } from './coord.js';

export const AXES = {
  search: { label: '自分で検索', short: '検索' },
  same_brand: { label: '同ブランドから探す', short: '同ブランド' },
  other_brand: { label: '他ブランドから探す', short: '他ブランド' },
  other_collab: { label: '他のコラボを探す', short: '他のコラボ' },
  similar: { label: '似たデザインを探す', short: '似たデザイン' },
  same_price: { label: '同価格帯から探す', short: '同価格帯' },
  new_arrival: { label: '新作から探す', short: '新作' },
  match: { label: '合う服・小物を探す', short: '合う服・小物' }
};

// 同じ商品ばかり・見つからないときに切り替える先
const NEXT_AXIS = {
  same_brand: ['other_brand', 'similar'],
  other_brand: ['similar', 'same_price'],
  other_collab: ['other_brand', 'new_arrival'],
  similar: ['other_brand', 'same_price'],
  same_price: ['other_brand', 'similar'],
  new_arrival: ['other_brand', 'similar'],
  match: [],
  search: []
};

export const WANT = 10;
const MAX_CALLS = 5;
const MAX_PAGE = 5;
const THIN = 3; // 1回の検索で新しい商品がこれより少なければ、検索語をゆるめる

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (...xs) => xs.map((x) => String(x || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
const uniqSteps = (steps) => {
  const seen = new Set();
  return steps.filter((s) => s.keyword && !seen.has(s.keyword + '|' + (s.sort || '')) && seen.add(s.keyword + '|' + (s.sort || '')));
};

// 自由入力の検索語：前から順に、最後の言葉を1つずつ外してゆるめる
export function freeSteps(keyword) {
  const parts = String(keyword || '').normalize('NFKC').replace(/[「」『』"'、。,!?！？]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const out = [];
  for (let n = parts.length; n >= 1; n--) out.push({ keyword: parts.slice(0, n).join(' ') });
  return out;
}

// 検索軸ごとの「検索語（きつい順）」「楽天に渡す除外語」「結果の絞り込み」
export function planAxis(axis, a, { keyword = '', year = new Date().getFullYear() } = {}) {
  const cat = a.category || a.genre || '';
  const broad = a.broader && a.broader !== cat ? a.broader : '';
  const genre = a.genre && a.genre !== cat && a.genre !== broad ? a.genre : '';
  const feat = a.features[0] || '';
  // 同じコラボ（ブランドとコラボ相手の両方が入っている商品）は、どの軸でも「起点と同じシリーズ」として外す
  const sameCollab = (name) => !!(a.partner && hasBrand(name, a.brand) && hasBrand(name, a.partner));
  const isHeroBrand = (name) => hasBrand(name, a.brand) || (a.partner && hasBrand(name, a.partner));

  switch (axis) {
    case 'search':
      return { steps: freeSteps(keyword), ng: [], filter: () => true };
    case 'same_brand':
      if (!a.brand) return { steps: [], ng: [], filter: () => false, missing: 'ブランドが分からなかったため' };
      return {
        steps: uniqSteps([{ keyword: words(a.brand, cat) }, { keyword: words(a.brand, broad) }, { keyword: words(a.brand) }]),
        ng: a.partner ? brandNgWords(a.partner) : [],
        filter: (name) => hasBrand(name, a.brand) && !sameCollab(name)
      };
    case 'other_brand':
      if (!cat) return { steps: [], ng: [], filter: () => false, missing: '商品の種類が分からなかったため' };
      return {
        steps: uniqSteps([{ keyword: words(cat, feat) }, { keyword: cat }, { keyword: broad }, { keyword: genre }]),
        ng: [...brandNgWords(a.brand), ...brandNgWords(a.partner)],
        filter: (name) => !isHeroBrand(name)
      };
    case 'other_collab':
      if (!cat) return { steps: [], ng: [], filter: () => false, missing: '商品の種類が分からなかったため' };
      return {
        steps: uniqSteps([{ keyword: words(cat, 'コラボ') }, { keyword: words(cat, '別注') }, { keyword: words(broad || genre, 'コラボ') }, { keyword: words(cat, '限定 コラボ') }]),
        ng: [...brandNgWords(a.brand), ...brandNgWords(a.partner)],
        filter: (name) => looksCollab(name) && !isHeroBrand(name)
      };
    case 'similar':
      if (!cat) return { steps: [], ng: [], filter: () => false, missing: '商品の種類が分からなかったため' };
      return {
        steps: uniqSteps([
          { keyword: words(cat, a.color, feat) }, { keyword: words(cat, a.color) }, { keyword: words(cat, feat) },
          { keyword: words(cat, a.features[1] || '') }, { keyword: cat }
        ]),
        ng: a.partner ? brandNgWords(a.partner) : [],
        filter: (name) => !sameCollab(name)
      };
    case 'same_price': {
      if (!cat || !a.price) return { steps: [], ng: [], filter: () => false, missing: !cat ? '商品の種類が分からなかったため' : '価格が分からなかったため' };
      const minPrice = Math.max(100, Math.round((a.price * 0.7) / 100) * 100);
      const maxPrice = Math.round((a.price * 1.3) / 100) * 100;
      return {
        steps: uniqSteps([{ keyword: cat }, { keyword: broad }, { keyword: genre }]).map((s) => ({ ...s, minPrice, maxPrice })),
        ng: a.partner ? brandNgWords(a.partner) : [],
        filter: (name) => !sameCollab(name),
        priceText: `${minPrice.toLocaleString('ja-JP')}〜${maxPrice.toLocaleString('ja-JP')}円`
      };
    }
    case 'new_arrival':
      if (!cat) return { steps: [], ng: [], filter: () => false, missing: '商品の種類が分からなかったため' };
      return {
        steps: uniqSteps([
          { keyword: words(cat, '新作'), sort: '-updateTimestamp' }, { keyword: words(cat, '新作', String(year)) },
          { keyword: words(cat, '新作') }, { keyword: words(broad || genre, '新作'), sort: '-updateTimestamp' }
        ]),
        ng: a.partner ? brandNgWords(a.partner) : [],
        filter: (name) => !sameCollab(name)
      };
    case 'match': {
      // 合わせる服・小物：コーデの定番の組み合わせから、起点の商品の種類（靴・バッグ…）以外を1つずつ探す
      const slot = slotOf(`${cat} ${a.genre} ${a.name || ''}`);
      if (!slot) return { steps: [], ng: [], filter: () => false, missing: '服・靴・バッグなどではないため' };
      const gender = genderOf(readCoordConditions({}), { name: a.name || '' });
      const seen = new Set();
      const steps = [];
      for (const look of fallbackLooks({ heroSlot: slot, gender, cond: readCoordConditions({}) })) {
        for (const it of look.items) if (!seen.has(it.kind)) { seen.add(it.kind); steps.push({ keyword: it.keyword, label: it.kind }); }
      }
      return { steps: steps.slice(0, 6), ng: [], filter: () => true, perStep: 2 };
    }
    default:
      return { steps: [], ng: [], filter: () => false, missing: '探し方が分かりませんでした' };
  }
}

function toResult(it, axis, query) {
  const brand = findBrand(it.name);
  return { code: it.code, name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop, caption: String(it.caption || '').slice(0, 160), brand: brand ? brand.name : '', axis, query };
}

// reference: 起点の商品（なければ企画の先頭の商品）、exclude: 起点・企画に入っている商品、shown: すでに表示した候補
// cursor: { axis, step, page }（「さらに10件探す」で続きから）
export async function relatedSearch({
  axis, reference = null, keyword = '', exclude = [], shown = [], cursor = null,
  minPrice, maxPrice, sort, env, referer, want = WANT, until = Date.now() + 40000, allowSwitch = true, maxCalls = MAX_CALLS, now = new Date()
}) {
  if (!AXES[axis]) throw new Error('探し方が分かりませんでした');
  if (axis !== 'search' && !reference) throw new Error('基準にする商品がありません。起点の商品を決めるか、企画に商品を1つ入れてください。');
  const analysis = reference ? analyzeProduct(reference) : null;
  const avoid = [...(reference ? [reference] : []), ...exclude];
  const found = [];
  const queries = [];
  const notes = [];
  let calls = 0;
  let lastError = null;
  let current = axis;
  const tried = new Set();
  let state = cursor && cursor.axis === axis ? { step: Number(cursor.step) || 0, page: Number(cursor.page) || 1 } : { step: 0, page: 1 };

  while (current) {
    tried.add(current);
    const plan = planAxis(current, analysis || { brand: '', partner: '', category: '', broader: '', genre: '', features: [], color: '', price: 0 }, { keyword, year: now.getFullYear() });
    if (!plan.steps.length && plan.missing) notes.push(`${AXES[current].label}は${plan.missing}使えませんでした`);
    let zeroStreak = 0; // 新しい商品が0件の検索が続いた回数（同じ商品ばかり出ている）
    let givenUp = false;
    while (state.step < plan.steps.length && calls < maxCalls && found.length < want) {
      if (calls > 0) {
        if (Date.now() + 1100 > until) break;
        await sleep(1100); // 楽天APIは1秒1リクエストまで
      }
      const st = plan.steps[state.step];
      const q = {
        keyword: st.keyword, page: state.page, sort: st.sort || (current === 'search' ? sort : undefined),
        minPrice: st.minPrice || (current === 'search' ? minPrice : undefined), maxPrice: st.maxPrice || (current === 'search' ? maxPrice : undefined)
      };
      calls++;
      let r;
      try {
        r = await searchPage({ ...q, ngWords: plan.ng, env, referer });
      } catch (e) {
        lastError = e;
        if (/40[13]/.test(e.message)) { state.step = plan.steps.length; break; }
        state = { step: state.step + 1, page: 1 };
        continue;
      }
      const matched = r.items.filter((it) => plan.filter(it.name));
      const { items: fresh } = dedupeProducts(matched, [...avoid, ...shown, ...found]);
      queries.push({ axis: current, keyword: q.keyword, page: q.page, hits: r.items.length, fresh: fresh.length });
      let taken = 0;
      for (const it of fresh) if (found.length < want && (!plan.perStep || taken < plan.perStep)) { found.push(toResult(it, current, q.keyword)); taken++; }
      zeroStreak = fresh.length ? 0 : zeroStreak + 1;
      if (zeroStreak >= 2 && found.length < THIN && allowSwitch && current !== 'search' && (NEXT_AXIS[current] || []).some((x) => !tried.has(x))) {
        givenUp = true; // この軸では同じ商品ばかり → 残りの検索語は使わずに別の軸へ
        break;
      }
      const more = r.pageCount > state.page && state.page < MAX_PAGE;
      if (plan.perStep) state = { step: state.step + 1, page: 1 }; // 1つの言葉から少しずつ、いろいろな種類を
      else if (fresh.length >= THIN && more) state = { step: state.step, page: state.page + 1 };
      else {
        if (state.step + 1 < plan.steps.length && fresh.length < THIN && state.page === 1) notes.push(`「${q.keyword}」では少なかったので、検索語をゆるめました`);
        state = { step: state.step + 1, page: 1 };
      }
    }
    const exhausted = givenUp || state.step >= plan.steps.length;
    // 同じ商品ばかり・ほとんど見つからない → 別の軸へ切り替える
    if (exhausted && found.length < THIN && allowSwitch && calls < maxCalls && Date.now() + 1100 < until) {
      const next = (NEXT_AXIS[current] || []).find((x) => !tried.has(x));
      if (next) {
        notes.push(`${AXES[current].label}では新しい商品がほとんど見つからなかったので、「${AXES[next].label}」に切り替えました`);
        current = next;
        state = { step: 0, page: 1 };
        continue;
      }
    }
    if (found.length === 0 && lastError && !queries.length) throw lastError;
    return {
      items: found,
      axis: current,
      requestedAxis: axis,
      switched: current !== axis,
      cursor: exhausted ? null : { axis: current, step: state.step, page: state.page },
      queries,
      analysis,
      notice: notes.slice(-2).join('。')
    };
  }
  return { items: found, axis, requestedAxis: axis, switched: false, cursor: null, queries, analysis, notice: '' };
}

// 同じ商品か（画面側の「企画に追加済み」の判定と同じ考え方）
export { isSameProduct };
