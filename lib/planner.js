// 発掘条件（ジャンル・選び方の型・自由入力）から、楽天で何をどう探すかを決める。
// 自由入力の自然な文章から「何を・誰向けに・何に使う・予算いくら」をAIに読み取ってもらい、
// 楽天の検索語と価格帯に変換する。AIが使えないときは簡単なルールで代わりに組み立てる。
import { CURATION_TYPES } from './themes.js';
import { AiError, cleanText, runWithModels } from './ai.js';

const MAX_FREE_TEXT = 120;

export function sanitizeFreeText(text) {
  return String(text || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/[\s　]+/g, ' ').trim().slice(0, MAX_FREE_TEXT);
}

// 「1万円以下」「5,000円前後」「3千円から」などを価格帯にする（AIが使えないときの予備）
export function parseBudget(text) {
  const num = String.raw`(\d+(?:[.,]\d+)*)\s*(万|千)?\s*円?`;
  const toYen = (n, unit) => {
    const v = parseFloat(n.replace(/,/g, ''));
    return Math.round(unit === '万' ? v * 10000 : unit === '千' ? v * 1000 : v);
  };
  let m = text.match(new RegExp(`${num}\\s*(?:〜|~|-|から)\\s*${num}`));
  if (m) return { minPrice: toYen(m[1], m[2]), maxPrice: toYen(m[3], m[4]) };
  m = text.match(new RegExp(`${num}\\s*(以下|以内|まで|未満)`));
  if (m) return { maxPrice: toYen(m[1], m[2]) };
  m = text.match(new RegExp(`${num}\\s*(以上|から|〜)`));
  if (m) return { minPrice: toYen(m[1], m[2]) };
  m = text.match(new RegExp(`${num}\\s*(前後|くらい|ぐらい|程度|位)`));
  if (m) {
    const v = toYen(m[1], m[2]);
    return { minPrice: Math.round(v * 0.7), maxPrice: Math.round(v * 1.3) };
  }
  return {};
}

function validPrice(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 100 && n <= 2000000 ? n : undefined;
}

function cleanKeyword(k) {
  return cleanText(k).replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

const PLAN_PROMPT = `あなたは楽天市場の検索プランを立てる担当です。JSONだけを返してください。
ユーザーの発掘条件（ジャンル・選び方の型・自由入力）を読み、「何を探しているのか」「誰向けなのか」「どんな用途なのか」「いくらくらいなのか」を自然な文章から読み取って、楽天で検索する方法に変換します。
ジャンル名だけで機械的に検索せず、自由入力の意図を必ず反映してください。

出力する項目:
- summary: 今回探すものを一文で（60字以内。例:「30代男性が最初に買う香水。仕事でも使いやすいもの」「北欧系の白い食器で、本命ブランドと安い代替品」）
- title: まとめの見出し（30字以内）
- audience: 誰向けか（年齢・性別・関係性。読み取れなければ空文字）
- minPrice / maxPrice: 予算の下限・上限（円、数値。読み取れなければ null。「1万円以下」→ maxPrice 10000、「5000円前後」→ 3500〜6500 程度）
- brand: ブランドイメージや贈り物としての印象が判断に影響するなら true
- keywords: 楽天の検索語を3〜4個。商品名に含まれやすい名詞を2〜3語スペース区切りで（文章・助詞・「おすすめ」「プレゼント向け」のような曖昧な語は入れない）。ブランドや具体的な商品カテゴリが思い浮かぶなら入れてよい
- slots: 選び方の型が指定されているときだけ、型に沿った2〜5個の枠。各枠は label（役割10字以内）, keyword（楽天の検索語）, minPrice, maxPrice（数値またはnull）。予算が指定されていれば枠の価格帯はその範囲に収める
  - 本命＋安い代替: 5枠にして、ブランド・価格帯・用途がばらけるようにする。例:「本命ブランド」（知名度・実績のあるブランド名を検索語に。高価格）／「手が届く本命」（同じブランドの入口の商品や、別の定番ブランド。中〜高価格）／「実力派の代替」（実績のある国内メーカーなど。中価格）／「かなり安い代替」（雰囲気や用途が近い手頃な商品。低価格）／「用途違い」か「ギフト向き」（形・サイズ・使い方が違うもの）。枠どうしの価格帯は重ならないようにする
  - 予算別: 同じ検索語で低・中・高の価格帯を重ならないように分ける
  - 初心者向け／まず1個買うなら／用途別／プレゼント: 枠ごとに役割が分かる検索語にする

出力形式:
{"summary":"...","title":"...","audience":"...","minPrice":null,"maxPrice":10000,"brand":true,"keywords":["...","..."],"slots":[{"label":"...","keyword":"...","minPrice":null,"maxPrice":null}]}`;

function parsePlan(content, { type }) {
  let data;
  try {
    data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]);
  } catch {
    throw new AiError('検索プランを読み取れませんでした');
  }
  const keywords = [...new Set((Array.isArray(data.keywords) ? data.keywords : []).map(cleanKeyword).filter(Boolean))].slice(0, 4);
  const slots = (Array.isArray(data.slots) ? data.slots : [])
    .map((x) => ({
      label: cleanText(x && x.label).slice(0, 12),
      keyword: cleanKeyword(x && x.keyword),
      minPrice: validPrice(x && x.minPrice),
      maxPrice: validPrice(x && x.maxPrice)
    }))
    .filter((x) => x.label && x.keyword)
    .slice(0, 5);
  if (!keywords.length && slots.length < 2) throw new AiError('検索プランに検索語がありませんでした');
  if (type && slots.length < 2) throw new AiError('検索プランの枠が足りませんでした');
  let minPrice = validPrice(data.minPrice);
  let maxPrice = validPrice(data.maxPrice);
  if (minPrice && maxPrice && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
  return {
    summary: cleanText(data.summary).slice(0, 80),
    title: cleanText(data.title).slice(0, 40),
    audience: cleanText(data.audience).slice(0, 60),
    minPrice,
    maxPrice,
    brand: data.brand === true,
    keywords: keywords.length ? keywords : slots.map((x) => x.keyword),
    slots
  };
}

// AIが使えないときの予備プラン
export function fallbackPlan({ genre, type, free }) {
  const budget = parseBudget(free);
  const words = free
    .replace(/\d+(?:[.,]\d+)*\s*(万|千)?\s*円?\s*(以下|以内|まで|未満|以上|から|前後|くらい|ぐらい|程度)?/g, ' ')
    .split(/[、,。・/\s]+/)
    .map((w) => w.replace(/(への|向けの|向け|用の|用|っぽい|みたいな|もの|やつ|が欲しい|を探す)$/g, ''))
    .filter((w) => w.length >= 2 && !/^(おすすめ|プレゼント|ギフト|最近|安い|良い|いい)$/.test(w));
  const genreWords = genre ? genre.keywords : [];
  const freeKeyword = words.slice(0, 2).join(' ');
  const base = freeKeyword
    ? [genre ? `${genre.label} ${freeKeyword}` : freeKeyword, ...(genre ? [genreWords[0]] : [])]
    : genreWords.slice(0, 3);
  const keywords = [...new Set(base.map(cleanKeyword).filter(Boolean))];
  const k = keywords[0] || (genre && genre.label) || 'おしゃれ 雑貨';
  const max = budget.maxPrice;
  let slots = [];
  if (type === 'premium_budget') {
    slots = [
      { label: '本命', keyword: k, minPrice: budget.minPrice || 8000, maxPrice: max },
      { label: '手が届く本命', keyword: k, minPrice: 4000, maxPrice: 8000 },
      { label: '安い代替', keyword: k, minPrice: 1500, maxPrice: 4000 },
      { label: 'かなり安い代替', keyword: k, maxPrice: 1500 },
      { label: '用途違い', keyword: cleanKeyword(genreWords[1] || `${k} おしゃれ`), maxPrice: max }
    ];
  } else if (type === 'budget_tiers') {
    slots = [
      { label: '低価格', keyword: k, maxPrice: 3000 },
      { label: '中価格', keyword: k, minPrice: 3000, maxPrice: 10000 },
      { label: '高価格', keyword: k, minPrice: 10000, maxPrice: max }
    ];
  } else if (type) {
    const labels = { first_pick: ['迷ったらこれ', '2番手', '3番手'], beginner: ['最初の1個', '次に足す', '慣れたら'], gift: ['王道', 'センス枠', '実用品'], use_case: ['用途1', '用途2', '用途3'] }[type];
    const kws = [k, ...genreWords.slice(0, 2), `${k} おしゃれ`];
    slots = labels.map((label, i) => ({ label, keyword: cleanKeyword(kws[i] || k), minPrice: budget.minPrice, maxPrice: max }));
  }
  const summary = [genre && genre.label, free].filter(Boolean).join('／') || 'おまかせ';
  return {
    summary, title: summary.slice(0, 30), audience: '', ...budget,
    brand: !!(genre && genre.brand), keywords: keywords.length ? keywords : [k], slots, fallback: true
  };
}

export async function planSearch({ genre, type, free, env, deadline }) {
  const lines = [
    `ジャンル: ${genre ? genre.label : '指定なし'}`,
    `選び方の型: ${type ? `${CURATION_TYPES[type].name}（${CURATION_TYPES[type].guide}）` : '指定なし（単品で発掘）'}`,
    `自由入力: ${free || 'なし'}`
  ];
  if (genre) lines.push(`このジャンルの検索語の例: ${genre.keywords.slice(0, 6).join(' / ')}`);
  try {
    const { result } = await runWithModels({
      env, deadline, system: PLAN_PROMPT, userContent: lines.join('\n'),
      parse: (content) => parsePlan(content, { type })
    });
    return result;
  } catch (e) {
    console.error('[plan] fallback:', e.message);
    return fallbackPlan({ genre, type, free });
  }
}
