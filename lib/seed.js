// 「この商品から企画を考える」：ランダム発掘で「これ良いかも」と思った1商品を起点に、
// Instagram企画を3〜5案つくる。商品を主役にする企画（主役型）と、そこから連想して広げる企画（きっかけ型）を混ぜ、
// 同じ切り口の言い換えにならないようにする。
import { CURATION_TYPES } from './themes.js';
import { AiError, compact, cleanText, runWithModels } from './ai.js';
import { fallbackShortName } from './instagram.js';

export const MIN_SEED_IDEAS = 3;
export const MAX_SEED_IDEAS = 5;
const SERIES = 'について本気出して考えてみた';

const PROMPT = `あなたはInstagramアカウント「眼科医くま」の編集長です。JSONだけを返してください。
ユーザーがランダム発掘で見つけて「これ良いかも」と思った1商品を起点に、Instagram投稿の企画を${MIN_SEED_IDEAS}〜${MAX_SEED_IDEAS}案考えます。
投稿タイトルは「○○について本気出して考えてみた」のシリーズです（○○の部分を topic に入れる）。アカウントの役割は「結局どれを選べばいいかを整理する」こと。

まず商品を分析する（ジャンル・ブランド・価格・特徴・用途・ターゲット・見た目・トレンド性）。その上で:
- 切り口がそれぞれ違う企画にする。商品名を変えただけの似た案を並べない
  切り口の例: まずコレ（○○まわりで最初に買うなら）／ブランド比較（AとB、結局どっち？）／用途別（旅行に持っていく○○）／予算で比較（3,000円前後で買える○○）／悩み解決（デスクのケーブルを減らす）／プレゼント（○○な人への贈り物）／トレンド／変わり種
- 次の2つを使い分ける（両方を必ず含める）
  主役型（role:"main"）: その商品を中心に、同じ種類の商品と比べる。例: オニツカタイガー →「大人が履きやすい白スニーカー」
  きっかけ型（role:"trigger"）: その商品から連想して、より広い企画に広げる。起点の商品は候補の1つになる。例: ポータブルジューサー →「1,500円前後で生活が少し楽しくなるもの」
- どの案でも、起点の商品は候補に入れる前提で考える（無理なく入る企画にする）

各案の項目:
- topic: ○○の部分（24字以内）
- type: 選び方の型。次のidから1つ: ${Object.entries(CURATION_TYPES).map(([id, t]) => `${id}（${t.name}）`).join('、')}
- typeLabel: 画面に出す企画タイプ名（12字以内。例: まずコレ、ブランド比較、用途別、予算別、悩み解決）
- role: "main" か "trigger"
- howUsed: この商品をこの企画でどう使うか（25〜60字。例:「本命の1つとして、価格と出力のバランスの基準にする」）
- searchGenres: 追加で探す商品ジャンル（3〜6個。楽天で検索できる名詞。例: モバイルバッテリー、USB-Cケーブル、変換プラグ）
- expectedCount: 想定候補数（集まりそうな候補の数。10〜20の数値）
- whyWorks: なぜこの企画が成立するか（40〜80字。見る人が迷うポイントや、比べる意味）
- target: 想定ターゲット（30字以内）
- priceBand: 想定価格帯（例:「2,000〜6,000円」。起点の商品の価格も入る範囲）
- axis: 比較軸（比べる企画のときだけ。例:「出力 vs 持ち運びやすさ」）

出力形式:
{"analysis":"商品の分析を一言（40字以内）","ideas":[{"topic":"...","type":"...","typeLabel":"...","role":"main","howUsed":"...","searchGenres":["..."],"expectedCount":18,"whyWorks":"...","target":"...","priceBand":"...","axis":""}]}`;

function cleanKeyword(k) {
  return cleanText(k).replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

// 起点の商品（ランダム発掘の結果をクライアントから受け取る）
export function readSeedProduct(x) {
  if (!x || typeof x !== 'object' || !x.name) return null;
  const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
  const url = s(x.url, 300);
  const image = s(x.image, 300);
  return {
    name: s(x.name, 200), code: s(x.code, 80), price: Number(x.price) || 0,
    url: /^https:\/\//.test(url) ? url : '', image: /^https:\/\//.test(image) ? image : '',
    shop: s(x.shop, 60), brand: s(x.brand, 30), reason: s(x.reason, 200), caption: s(x.caption, 300)
  };
}

// 企画1案を検証して、通常の企画（編集した企画と同じ形）にそろえる
export function normalizeSeedIdea(x, product) {
  if (!x || typeof x !== 'object') return null;
  const topic = cleanText(x.topic).replace(/について本気出して考えてみた$/, '').replace(/について$/, '').slice(0, 30);
  const type = CURATION_TYPES[x.type] ? x.type : 'omakase';
  const searchGenres = [...new Set((Array.isArray(x.searchGenres) ? x.searchGenres : []).map(cleanKeyword).filter(Boolean))].slice(0, 6);
  if (!topic || searchGenres.length < 2) return null;
  const count = Math.round(Number(x.expectedCount));
  return {
    edited: true,
    seeded: true,
    topic,
    title: topic + SERIES,
    curationType: type,
    postType: cleanText(x.typeLabel).slice(0, 14) || CURATION_TYPES[type].name,
    seedRole: x.role === 'trigger' ? 'trigger' : 'main',
    howUsed: cleanText(x.howUsed).slice(0, 90),
    searchGenres,
    expectedCount: Number.isFinite(count) ? Math.min(20, Math.max(10, count)) : 18,
    whyInteresting: cleanText(x.whyWorks).slice(0, 120),
    target: cleanText(x.target).slice(0, 40),
    priceBand: cleanText(x.priceBand).slice(0, 24),
    axis: cleanText(x.axis).slice(0, 30),
    genre: '',
    free: '',
    seed: { name: product.name, code: product.code, price: product.price }
  };
}

function parseIdeas(content, product) {
  let data;
  try {
    data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]);
  } catch {
    throw new AiError('AIの応答を読み取れませんでした');
  }
  const seen = new Set();
  const ideas = [];
  for (const x of Array.isArray(data.ideas) ? data.ideas : []) {
    const idea = normalizeSeedIdea(x, product);
    if (!idea || seen.has(idea.topic)) continue;
    seen.add(idea.topic);
    ideas.push(idea);
    if (ideas.length >= MAX_SEED_IDEAS) break;
  }
  if (ideas.length < MIN_SEED_IDEAS) throw new AiError(`企画が${ideas.length}案しか作れませんでした`);
  // 主役型・きっかけ型の両方が入るように（どちらかしかなければ、そのまま使うが並びで分かるようにする）
  return { analysis: cleanText(data.analysis).slice(0, 60), ideas };
}

function priceRange(price) {
  if (!price) return '';
  const lo = Math.max(500, Math.round((price * 0.5) / 500) * 500);
  const hi = Math.round((price * 1.8) / 500) * 500;
  return `${lo.toLocaleString('ja-JP')}〜${hi.toLocaleString('ja-JP')}円`;
}

// AIが使えないときの予備：商品名から種類の言葉を取り出し、型を変えた3案
export function fallbackSeedIdeas(product) {
  const kind = fallbackShortName(product.name).replace(/^[A-Za-z0-9&'.\-]+\s*/, '').slice(0, 14) || '気になる商品';
  const band = priceRange(product.price);
  const yen = product.price ? `${(Math.round(product.price / 500) * 500).toLocaleString('ja-JP')}円前後` : '手頃な価格';
  const base = cleanKeyword(kind);
  const raw = [
    { topic: kind, type: 'first_pick', typeLabel: 'まずコレ', role: 'main', howUsed: '本命の1つとして、ほかの商品と比べる基準にする', searchGenres: [base, `${base} ブランド`, `${base} 人気`], whyWorks: '同じ種類の中で何を選べばいいか、迷う人が多いジャンル', priceBand: band },
    { topic: `${kind}、高いのと安いのは何が違う？`, type: 'premium_budget', typeLabel: '本命と代替', role: 'main', howUsed: '価格帯の目安として置き、高い本命と安い代替を並べる', searchGenres: [`${base} 高級`, `${base} 安い`, base], whyWorks: '価格差の理由が分かると、自分に合う価格帯を決めやすい', priceBand: '' },
    { topic: `${yen}で生活が少し楽しくなるもの`, type: 'value', typeLabel: '予算別', role: 'trigger', howUsed: '同じくらいの価格で見つけた面白いものの1つとして入れる', searchGenres: ['便利グッズ', 'キッチン雑貨', 'ガジェット', 'インテリア 雑貨'], whyWorks: '予算を決めて探す人が多く、ジャンルをまたいで比べられる', priceBand: band }
  ];
  return raw.map((x) => normalizeSeedIdea({ ...x, expectedCount: 18 }, product)).filter(Boolean);
}

export async function generateSeedIdeas({ product, env, deadline }) {
  const userContent = [
    `起点の商品: ${compact(product.name, 120)}`,
    `価格: ${product.price}円`,
    product.shop && `販売: ${product.shop}`,
    product.brand && `ブランド: ${product.brand}`,
    product.reason && `見つけたときの印象: ${compact(product.reason, 120)}`,
    product.caption && `商品情報: ${compact(product.caption, 250)}`
  ].filter(Boolean).join('\n');
  const { result } = await runWithModels({ env, deadline, system: PROMPT, userContent, parse: (c) => parseIdeas(c, product) });
  return result;
}
