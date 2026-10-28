// 商品探索：「AIが6商品を決める」のではなく「AIが広く候補を集め、編集長（ユーザー）が選ぶ」ための仕組み。
// 1. 企画・条件から、検索の角度を5〜10個考える（王道ブランド・価格を抑えた代替・新興ブランド・話題のもの・実用品…）
// 2. 角度ごとに楽天で検索して、候補をたくさん集める（同じ商品・過去に出した商品は後ろへ）
// 3. AIが15〜20個に絞り、役割（本命・コスパ・変わり種など）を付ける。同じブランド・同じ種類・同じ役割が偏らないようにする
// ROOMの紹介文は、ユーザーが投稿に使う商品を選んだあとで、その分だけ作る（generateIntros）。
import { CURATION_TYPES, THEMES, isBrandTheme } from './themes.js';
import { CATALOG } from './catalog.js';
import { searchSlot, nameKey } from './rakuten.js';
import { memoIssues, fallbackShortName } from './instagram.js';
import { parseBudget } from './planner.js';
import { BRAND_RULES, WRITING_RULES, AiError, compact, cleanText, runWithModels, refineIntros, fallbackPicks } from './ai.js';

export const ROLE_TAGS = ['本命', '2番手', '王道', 'コスパ', '安い代替', 'ブランド枠', 'トレンド枠', '変わり種', 'プレゼント向き', '実用品', '少し奮発', '失敗しても許せる価格', '個人的に気になる', '知っておきたい'];
export const MIN_CANDIDATES = 15;
export const MAX_CANDIDATES = 20;
export const MORE_COUNT = 10;
const MAX_PER_BRAND = 2;
const MAX_PER_ROLE = 3;
const MAX_PER_KIND = 3;
const MAX_PER_SHOP_IN_POOL = 6; // AIに見せる候補の時点で、1ショップの商品ばかりにならないように
const MAX_POOL = 90; // AIに見せる候補の上限（料金を抑える）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/[\s　]+/g, ' ').trim().slice(0, n);

function validPrice(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 100 && n <= 2000000 ? n : undefined;
}

function cleanKeyword(k) {
  return cleanText(k).replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

// ---- 探す内容（企画・条件指定・最初の10投稿のどれからでも同じ形にする） ----
// brief: { type, title, target, priceBand, minPrice, maxPrice, genre, axis, free, purpose: 'gift'|'self'|'',
//          age, brandFocus, trendFocus, note, hints: [検索語のヒント] }
export function readBrief(x) {
  if (!x || typeof x !== 'object') return null;
  const type = CURATION_TYPES[x.type] ? x.type : 'omakase';
  let minPrice = validPrice(x.minPrice);
  let maxPrice = validPrice(x.maxPrice);
  if (!minPrice && !maxPrice && x.priceBand) ({ minPrice, maxPrice } = parseBudget(String(x.priceBand)));
  if (minPrice && maxPrice && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
  const brief = {
    type,
    title: str(x.title, 60),
    target: str(x.target, 60),
    priceBand: str(x.priceBand, 30),
    minPrice: validPrice(minPrice),
    maxPrice: validPrice(maxPrice),
    genre: str(x.genre, 30),
    axis: str(x.axis, 40),
    free: str(x.free, 200),
    purpose: x.purpose === 'gift' || x.purpose === 'self' ? x.purpose : '',
    age: str(x.age, 10),
    brandFocus: x.brandFocus === true,
    trendFocus: x.trendFocus === true,
    note: str(x.note, 400),
    hints: (Array.isArray(x.hints) ? x.hints : []).map(cleanKeyword).filter(Boolean).slice(0, 8)
  };
  return brief.title || brief.free || brief.genre ? brief : null;
}

const SERIES_RE = /(について)?本気出して考えてみた$/;

export function briefFromIdea(idea) {
  const genre = CATALOG.find((c) => c.name === idea.genre);
  return readBrief({
    type: idea.curationType,
    title: idea.title,
    target: idea.target,
    priceBand: idea.priceBand,
    genre: idea.genre,
    axis: idea.axis,
    free: idea.free,
    note: [idea.whyInteresting && `この企画の狙い: ${idea.whyInteresting}`, genre && genre.note && `ジャンルの注意: ${genre.note}`].filter(Boolean).join('\n'),
    // 企画を編集したときは、元の企画の検索語は内容とずれるので使わない
    hints: idea.edited ? [] : (idea.slots || []).map((s) => s.keyword)
  });
}

export function briefFromPlan(plan) {
  return readBrief({
    type: plan.type,
    title: `${plan.topic}について本気出して考えてみた`,
    target: plan.audience,
    genre: plan.category,
    note: [`目的: ${plan.purpose}`, plan.note && `この企画のルール: ${plan.note}`].filter(Boolean).join('\n'),
    hints: plan.slots.map((s) => s.keyword)
  });
}

// 条件指定：filterGenre は lib/genres.js の resolveFilterGenre の結果
export function briefFromConditions({ filterGenre, type, free, details = {} }, random = Math.random) {
  const t = CURATION_TYPES[type] ? type : 'omakase';
  let title = free;
  let hints = filterGenre ? shuffled(filterGenre.keywords, random).slice(0, 6) : [];
  if (!title && filterGenre) title = `${filterGenre.label}（${CURATION_TYPES[t].name}）`;
  if (!title) {
    // 何も指定がないときは、用意してあるテーマか企画データベースから1つ選ぶ
    const pool = THEMES.filter((x) => x.type === t);
    if (pool.length) {
      const theme = pool[Math.floor(random() * pool.length)];
      title = theme.title;
      hints = theme.slots.map((s) => s.keyword);
    } else {
      const genre = CATALOG[Math.floor(random() * CATALOG.length)];
      title = genre.items[Math.floor(random() * genre.items.length)];
      hints = [title];
    }
  }
  return readBrief({
    type: t, title, free, genre: filterGenre ? filterGenre.label : '',
    target: details.target, age: details.age, purpose: details.purpose,
    minPrice: details.minPrice, maxPrice: details.maxPrice,
    brandFocus: details.brandFocus === true || !!(filterGenre && filterGenre.brand && t !== 'value'),
    trendFocus: details.trendFocus === true,
    hints
  });
}

function shuffled(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function priceText(min, max) {
  if (min && max) return `${min}〜${max}円`;
  if (min) return `${min}円以上`;
  if (max) return `${max}円以下`;
  return '';
}

function briefLines(brief) {
  const type = CURATION_TYPES[brief.type];
  return [
    `テーマ: ${brief.title || brief.free}`,
    `選び方の型: ${type.name}（${type.desc}）`,
    brief.target && `ターゲット: ${brief.target}`,
    brief.age && `年齢: ${brief.age}`,
    brief.purpose && `用途: ${brief.purpose === 'gift' ? 'プレゼント' : '自分用'}`,
    (brief.priceBand || brief.minPrice || brief.maxPrice) && `価格帯: ${brief.priceBand || priceText(brief.minPrice, brief.maxPrice)}`,
    brief.genre && `ジャンル: ${brief.genre}`,
    brief.axis && `比較軸: ${brief.axis}`,
    brief.free && brief.free !== brief.title && `自由条件（最優先）: ${brief.free}`,
    brief.brandFocus && '有名ブランドを重視する',
    brief.trendFocus && '最近話題のもの・トレンドを重視する',
    brief.note
  ].filter(Boolean).join('\n');
}

// ---- 1. 検索の角度 ----
const ANGLE_PROMPT = `あなたは楽天市場で商品を探す「探索係」です。JSONだけを返してください。
目的は、似たもの15個ではなく「こんなのもあるのか」と思える15〜20商品を集めること。そのために、1つの検索語だけで探さず、検索の角度を広げます。

角度の例: 王道ブランド／価格を抑えた代替／新興ブランド／SNSで話題・最近よく見る／実用品／消耗品／記念品・名入れ／体験寄り／デザイン重視／変わり種／セットで揃う／ターゲットの悩みから／少し奮発するなら
- 指定された数だけ角度を作る。角度どうしで検索語・商品の種類・価格帯・ブランドが重ならないようにする（同じ種類の商品を言い換えただけの角度を並べない）
- テーマが許す範囲で、商品の種類そのものを散らす（例: 出産祝いなら タオルだけでなく、スタイ・名入れ記念品・ママ向けのケア用品・おむつケーキ・木のおもちゃ・食器 など）
- keyword: 楽天で検索する語。商品名に含まれやすい名詞を2〜3語スペース区切り（文章・助詞・「おすすめ」「人気」「プレゼント向け」のような曖昧な語は入れない）。ブランド名を入れてよい
- label: 角度の名前（10字以内。ユーザーに「今回こんな方向から探しました」と見せる。例: 王道ブランド、価格を抑えた代替、SNSで話題、実用品、新興ブランド）
- minPrice / maxPrice: 予算があればその範囲に収める（円の数値か null）。角度ごとに価格帯を変えてよい
- 「避ける角度」が指定されていれば、それとは違う方向から探す

出力形式:
{"angles":[{"label":"...","keyword":"...","minPrice":null,"maxPrice":null}]}`;

function parseAngles(content, brief, count) {
  let data;
  try {
    data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]);
  } catch {
    throw new AiError('AIの応答を読み取れませんでした');
  }
  const seen = new Set();
  const angles = [];
  for (const a of Array.isArray(data.angles) ? data.angles : []) {
    const keyword = cleanKeyword(a && a.keyword);
    const label = cleanText(a && a.label).slice(0, 14);
    if (!keyword || !label || seen.has(keyword)) continue;
    seen.add(keyword);
    angles.push(clampAngle({ label, keyword, minPrice: validPrice(a.minPrice), maxPrice: validPrice(a.maxPrice) }, brief));
    if (angles.length >= count) break;
  }
  if (angles.length < 3) throw new AiError('検索の角度が足りませんでした');
  return angles;
}

// 予算が決まっているときは、角度の価格帯がそこから大きく外れないようにする
function clampAngle(angle, brief) {
  let { minPrice, maxPrice } = angle;
  if (brief.maxPrice && (!maxPrice || maxPrice > brief.maxPrice * 1.2)) maxPrice = brief.maxPrice;
  if (brief.minPrice && (!minPrice || minPrice < brief.minPrice * 0.8)) minPrice = brief.minPrice;
  if (minPrice && maxPrice && minPrice > maxPrice) minPrice = undefined;
  return { ...angle, minPrice, maxPrice };
}

// AIが使えないときの角度：企画の検索語とジャンルの品目を、価格帯を変えながら並べる
export function fallbackAngles(brief, count, prev = []) {
  const genre = CATALOG.find((c) => c.name === brief.genre);
  const base = [...brief.hints];
  if (genre) base.push(...genre.items.slice(0, 6));
  if (!base.length) base.push(cleanKeyword(brief.free || brief.title).split(' ').slice(0, 2).join(' '));
  const labels = ['定番', '価格を抑えるなら', '少し奮発するなら', '別の角度', '実用品', 'ブランドで選ぶ', '変わり種', '話題のもの'];
  const used = new Set(prev.map((a) => a.keyword));
  const out = [];
  const words = [...new Set(base.map(cleanKeyword).filter(Boolean))];
  for (const [i, keyword] of words.entries()) {
    if (out.length >= count) break;
    if (used.has(keyword)) continue;
    const tier = i % 3;
    out.push(clampAngle({
      label: labels[out.length % labels.length],
      keyword,
      minPrice: tier === 2 ? brief.minPrice || 5000 : brief.minPrice,
      maxPrice: tier === 1 ? Math.min(brief.maxPrice || 3000, 3000) : brief.maxPrice
    }, brief));
  }
  // 新しい検索語が尽きたときは、前回の角度の次のページを見る
  if (!out.length) return prev.slice(0, count).map((a) => ({ ...a, page: (a.page || 1) + 1 }));
  return out;
}

export async function planAngles({ brief, count, avoid = [], env, deadline }) {
  const userContent = [
    briefLines(brief),
    `型の考え方: ${CURATION_TYPES[brief.type].guide}`,
    brief.hints.length ? `検索語のヒント（そのまま使ってもよいし、広げてもよい）: ${brief.hints.join('／')}` : '',
    avoid.length ? `避ける角度（前回もう探した。これとは違う方向から）: ${avoid.map((a) => `${a.label}（${a.keyword}）`).join('／')}` : '',
    `作る角度の数: ${count}`
  ].filter(Boolean).join('\n');
  const { result } = await runWithModels({ env, deadline, system: ANGLE_PROMPT, userContent, parse: (c) => parseAngles(c, brief, count) });
  return result;
}

// ---- 2. 角度ごとに楽天で検索 ----
export async function searchAngles({ angles, env, referer, until }) {
  const results = [];
  let lastError = null;
  for (const [i, angle] of angles.entries()) {
    if (i > 0) {
      if (Date.now() + 1100 > until) break; // 時間切れになりそうなら、そこまでの候補で進める
      await sleep(1100); // 楽天APIは1秒1リクエストまで
    }
    try {
      const items = await searchSlot({ keyword: angle.keyword, minPrice: angle.minPrice, maxPrice: angle.maxPrice, page: angle.page || 1, env, referer, limit: 15 });
      results.push({ angle, items });
    } catch (e) {
      lastError = e;
      console.error('[rakuten]', e.message);
      if (/40[13]/.test(e.message)) break; // 認証エラーは繰り返さない
      results.push({ angle, items: [] });
    }
  }
  return { results, lastError };
}

function seenKey(name) {
  return nameKey(String(name || '')).slice(0, 12);
}

// 角度ごとの結果を1列に並べる：角度を順番に1つずつ取って混ぜ、同じ商品・除外する商品を外し、
// 過去に出した商品は後ろに回す
export function buildPool({ results, exclude = {}, seen = [] }) {
  const excludeCodes = new Set(exclude.codes || []);
  const excludeKeys = new Set((exclude.names || []).map(seenKey));
  const seenCodes = new Set(seen.map((s) => s.code).filter(Boolean));
  const seenKeys = new Set(seen.map((s) => seenKey(s.name)).filter(Boolean));
  const usedCodes = new Set();
  const usedKeys = new Set();
  const shopCount = {};
  const fresh = [];
  const old = [];
  const longest = Math.max(0, ...results.map((r) => r.items.length));
  for (let round = 0; round < longest; round++) {
    for (const r of results) {
      const it = r.items[round];
      if (!it) continue;
      const key = seenKey(it.name);
      if (usedCodes.has(it.code) || usedKeys.has(key) || excludeCodes.has(it.code) || excludeKeys.has(key)) continue;
      if ((shopCount[it.shop] || 0) >= MAX_PER_SHOP_IN_POOL) continue;
      usedCodes.add(it.code);
      usedKeys.add(key);
      shopCount[it.shop] = (shopCount[it.shop] || 0) + 1;
      const seenBefore = seenCodes.has(it.code) || seenKeys.has(key);
      (seenBefore ? old : fresh).push({ ...it, angle: r.angle.label, seenBefore });
    }
  }
  return fresh.concat(old).slice(0, MAX_POOL);
}

// ---- 3. AIが15〜20個に絞り、役割を付ける ----
function selectPrompt(brief, want, min) {
  const type = CURATION_TYPES[brief.type];
  return `あなたはInstagram「眼科医くま」の商品リサーチ担当です。JSONだけを返してください。
最終的に投稿に使う5〜6商品を選ぶのは編集長（ユーザー）です。あなたの仕事は、編集長が選びやすいように、候補の中から${want}個を選んで役割を付けて並べること。
目標は、似たもの${want}個ではなく「こんなのもあるのか」と思える${want}個。広さ・意外性・ブランドの幅を出してください。

選び方:
- ${want}個を目安に選ぶ。明らかに質の低い商品しかなければ減ってよいが、できるだけ${min}個以上
- 同じブランドは2個まで（同じブランドに非常に魅力的な候補が複数あるときだけ3個まで）
- 商品の種類（kind）を散らす。同じ種類は${MAX_PER_KIND}個まで。テーマが許す範囲で、消耗品・実用品・ブランド品・記念品・体験寄り・日用品・デザイン用品などに広げる
- 役割（role）は次から1つ: ${ROLE_TAGS.join('／')}
- 同じ役割は${MAX_PER_ROLE}個まで。本命2〜3・コスパ2〜3・安い代替2〜3・変わり種2・トレンド枠2・その他数個、のような幅を作る（この型で特に混ぜたい役割: ${type.roles.join('・')}）
- 並び順は「おすすめ順」（編集長に最初に見てほしい順）
- 候補の「（以前も候補に出た）」は、はっきりした理由があるときだけ選ぶ
- 候補にない商品は出さない。価格や仕様は候補の情報だけを根拠にする
- 安いだけの無名商品、なぜ選んだのか説明できない商品は入れない。トレンド枠は商品情報から根拠が読み取れるものだけ
- 型の考え方: ${type.guide}
${isBrandTheme({ type: brief.type, brand: brief.brandFocus }) ? `\n${BRAND_RULES}\n` : ''}
各項目:
- id: 候補の行頭の番号
- role: 上の役割から1つ
- tags: ほかにも当てはまる役割（0〜2個。例: プレゼントにも向くなら "プレゼント向き"）
- shortName: 意味が分かる短い商品名（16字以内。ブランド名は残し、型番・容量・送料無料・宣伝文句は削る）
- brand: ブランド名（商品名や販売元から分かるときだけ。推測で書かない）
- kind: 商品の種類（8字以内。例: タオル、スタイ、名入れ時計、入浴剤）
- reason: 選んだ理由（25〜60字。何が面白いか・誰に合うか。「おすすめ」「人気」「レビューが多い」「SNS映え」は使わない）
- memo: くまの一言（30字以内。友達に「これ良くない？」と話す感じで短く言い切る。使っていないので体験は書かない）

出力形式:
{"items":[{"id":0,"role":"...","tags":[],"shortName":"...","brand":"","kind":"...","reason":"...","memo":"..."}]}`;
}

function poolLines(pool) {
  return pool.map((it, i) => {
    const shop = it.shop ? ` / 販売: ${compact(it.shop, 20)}` : '';
    return `${i}: ${compact(it.name, 70)} / ${it.price}円${shop} / 探した角度: ${it.angle}${it.seenBefore ? '（以前も候補に出た）' : ''} / ${compact(it.caption, 80)}`;
  }).join('\n');
}

function readId(x) {
  const raw = x && (x.id ?? x.index ?? x.candidate ?? x.no);
  return parseInt(String(raw ?? '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/[^0-9]/g, ''), 10);
}

function findItemList(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'candidates', 'picks', 'products']) if (Array.isArray(data[key])) return data[key];
  for (const v of Object.values(data)) if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) return v;
  return [];
}

function brandKey(brand) {
  return String(brand || '').toLowerCase().replace(/[\s　・\-_.]/g, '');
}

function toCandidate(it, x) {
  const memo = cleanText(x.memo).slice(0, 40);
  return {
    code: it.code, name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop,
    shortName: cleanText(x.shortName).slice(0, 20) || fallbackShortName(it.name),
    brand: cleanText(x.brand).slice(0, 30),
    role: x.role || '',
    tags: x.tags || [],
    kind: cleanText(x.kind).slice(0, 10),
    reason: cleanText(x.reason).slice(0, 90),
    memo: memo && !memoIssues(memo).length ? memo : '',
    angle: it.angle,
    seenBefore: !!it.seenBefore,
    caption: compact(it.caption, 160) // あとで紹介文を作るときの材料
  };
}

// ブランド・役割・種類が偏りすぎないように並べる。上限を超えたものは後回しにし、
// 数が足りないときだけ役割・種類の上限をゆるめて足す（同じブランドは3個目まで）
export function balanceSelection(list, { want, min }) {
  const brandCount = {};
  const roleCount = {};
  const kindCount = {};
  const kept = [];
  const overflow = [];
  for (const c of list) {
    const b = brandKey(c.brand);
    const k = c.kind;
    if (b && (brandCount[b] || 0) >= MAX_PER_BRAND) { overflow.push(c); continue; }
    let role = c.role;
    if ((roleCount[role] || 0) >= MAX_PER_ROLE) {
      // 同じ役割が多すぎるときは、ほかに当てはまる役割に回す
      const alt = c.tags.find((t) => (roleCount[t] || 0) < MAX_PER_ROLE);
      if (!alt) { overflow.push(c); continue; }
      c.tags = [role, ...c.tags.filter((t) => t !== alt)].slice(0, 2);
      role = c.role = alt;
    }
    if (k && (kindCount[k] || 0) >= MAX_PER_KIND) { overflow.push(c); continue; }
    if (b) brandCount[b] = (brandCount[b] || 0) + 1;
    roleCount[role] = (roleCount[role] || 0) + 1;
    if (k) kindCount[k] = (kindCount[k] || 0) + 1;
    kept.push(c);
    if (kept.length >= want) return kept;
  }
  for (const c of overflow) {
    if (kept.length >= Math.min(min, want)) break;
    const b = brandKey(c.brand);
    if (b && (brandCount[b] || 0) >= MAX_PER_BRAND + 1) continue;
    if (b) brandCount[b] = (brandCount[b] || 0) + 1;
    kept.push(c);
  }
  return kept;
}

function parseSelection(content, pool, { want, min }) {
  let data;
  try {
    data = JSON.parse(String(content).match(/[\[{][\s\S]*[\]}]/)[0]);
  } catch {
    throw new AiError(`AIの応答を読み取れませんでした（先頭: ${String(content).slice(0, 60)}）`);
  }
  const used = new Set();
  const list = [];
  for (const x of findItemList(data)) {
    const id = readId(x);
    if (!Number.isInteger(id) || !pool[id] || used.has(id)) continue;
    used.add(id);
    const role = ROLE_TAGS.includes(cleanText(x.role)) ? cleanText(x.role) : '';
    const tags = (Array.isArray(x.tags) ? x.tags : []).map((t) => cleanText(t)).filter((t) => ROLE_TAGS.includes(t) && t !== role).slice(0, 2);
    list.push(toCandidate(pool[id], { ...x, role: role || tags.shift() || '', tags }));
  }
  if (list.length < Math.min(5, pool.length)) throw new AiError(`AIが候補を選べませんでした（${list.length}件）`);
  return balanceSelection(list, { want, min });
}

export async function selectCandidates({ brief, pool, want, min, env, deadline }) {
  const { result } = await runWithModels({
    env, deadline, system: selectPrompt(brief, want, min),
    userContent: `${briefLines(brief)}\n\n候補:\n${poolLines(pool)}`,
    parse: (c) => parseSelection(c, pool, { want, min })
  });
  return result;
}

// AIが使えないときの予備：角度を混ぜた順のまま、役割の代わりに探した角度を付ける
export function fallbackSelection(pool, want) {
  return pool.slice(0, want).map((it) => toCandidate(it, { role: '', tags: [], reason: `「${it.angle}」の方向で見つけた候補` }));
}

// ---- まとめて実行 ----
// exclude: すでに表示した商品（さらに10件探すとき）、seen: 過去に出した・使った商品（直近50件）
// prevAngles: 前回使った角度（さらに探すときは、これと違う方向から）
export async function explore({ brief, more = false, prevAngles = [], exclude = {}, seen = [], env, referer, startedAt = Date.now() }) {
  const want = more ? MORE_COUNT : MAX_CANDIDATES;
  const min = more ? MORE_COUNT : MIN_CANDIDATES;
  const count = more ? 6 : 8;
  let notice = '';
  let detail;

  let angles;
  try {
    angles = await planAngles({ brief, count, avoid: prevAngles, env, deadline: startedAt + 14000 });
  } catch (e) {
    console.error('[openai] angles fallback:', e.message);
    angles = fallbackAngles(brief, count, prevAngles);
  }

  const { results, lastError } = await searchAngles({ angles, env, referer, until: startedAt + 32000 });
  const pool = buildPool({ results, exclude, seen });
  const usedAngles = results.map((r) => ({ ...r.angle, count: r.items.length }));
  if (!pool.length) {
    if (lastError && !results.some((r) => r.items.length)) {
      const err = new Error('楽天市場の商品を取得できませんでした。少し時間をおいてもう一度お試しください。');
      err.detail = lastError.message;
      throw err;
    }
    return { angles: usedAngles, candidates: [], notice: more ? '新しい候補が見つかりませんでした。条件を変えて探してみてください。' : 'この内容では商品が見つかりませんでした。条件を少しゆるめてもう一度お試しください。' };
  }

  let candidates;
  try {
    candidates = await selectCandidates({ brief, pool, want, min, env, deadline: startedAt + 56000 });
  } catch (e) {
    console.error('[openai] select fallback:', e.message);
    candidates = fallbackSelection(pool, want);
    notice = 'AIでの選定に失敗したため、見つけた候補をそのまま並べています。';
    detail = `原因: ${e.message}`.slice(0, 300);
  }
  if (!notice && candidates.length < min) notice = `今回は良さそうな候補が${candidates.length}件でした。「さらに10件探す」で別の方向からも探せます。`;
  return { angles: usedAngles, candidates, notice, detail };
}

// ---- 投稿に使う商品が決まったら、その分だけROOMの紹介文を作る ----
const INTRO_PROMPT = `あなたは楽天ROOMに投稿する紹介文を書く担当です。JSONだけを返してください。
商品ごとに、その商品単体で楽天ROOMに投稿する紹介文（intro）を書きます。まとめの中での立ち位置（役割）が分かる一言を自然に入れてよい（例:「王道ならこれ」「最初の1本ならこれ」）。

${WRITING_RULES}

出力形式:
{"items":[{"id":0,"intro":"..."}]}`;

export async function generateIntros({ title = '', items, env, deadline }) {
  const lines = items.map((it, i) => `${i}: ${compact(it.name, 70)} / ${it.price}円${it.role ? ` / 役割: ${it.role}` : ''}${it.brand ? ` / ブランド: ${it.brand}` : ''} / 選んだ理由: ${compact(it.reason, 80)} / 商品情報: ${compact(it.caption, 120)}`);
  const parse = (content) => {
    let data;
    try { data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]); } catch { throw new AiError('AIの応答を読み取れませんでした'); }
    const out = items.map(() => '');
    for (const x of findItemList(data)) {
      const id = readId(x);
      if (Number.isInteger(id) && id < items.length && !out[id]) out[id] = cleanText(x.intro);
    }
    if (out.filter(Boolean).length < Math.ceil(items.length / 2)) throw new AiError('紹介文が足りませんでした');
    return out;
  };
  const fallback = (it) => fallbackPicks([it])[0].intro;
  try {
    const { result, model, apiKey } = await runWithModels({ env, deadline, system: INTRO_PROMPT, userContent: `テーマ: ${title}\n商品:\n${lines.join('\n')}`, parse });
    const refined = await refineIntros({
      picks: items.map((it, i) => ({ index: i, reason: it.reason || '', intro: result[i] || '' })),
      items, model, apiKey, deadline
    });
    return { intros: refined.map((p, i) => (p.intro.length >= 60 ? p.intro : fallback(items[i]))), fallback: false };
  } catch (e) {
    console.error('[openai] intros fallback:', e.message);
    return { intros: items.map(fallback), fallback: true, error: e.message };
  }
}
