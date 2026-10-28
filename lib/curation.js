// 「選び方まとめ」：枠ごとに集めた商品から、AIが順番・役割・どんな人に合うかを組み立てる
import { CURATION_TYPES, isBrandTheme } from './themes.js';
import { WRITING_RULES, BRAND_RULES, GIFT_CLASSES, BUYER_POLICY, BASIS_TYPES, AiError, compact, cleanText, runWithModels, refineIntros, fallbackPicks } from './ai.js';

const MAX_ITEMS = 6; // Instagramの1投稿で紹介しやすい数

function priceRange(slot) {
  if (slot.minPrice && slot.maxPrice) return `${slot.minPrice}〜${slot.maxPrice}円`;
  if (slot.minPrice) return `${slot.minPrice}円〜`;
  if (slot.maxPrice) return `〜${slot.maxPrice}円`;
  return '価格指定なし';
}

// 「本命＋安い代替」で、比較として面白く、違いが分かる6個にするための追加ルール
const COMPARE_RULES = `本命＋安い代替の組み立て（最重要）:
- 最初に「比較軸」を1〜2個決める（例: ブランド性／価格差／用途／センス感／プレゼント向きか／初心者向きか／見た目重視か実用性重視か）。axis に「ブランド性 × 価格差」のように書く
- 6個を基本に、違う役割を割り振る。例:
  A: 本命ブランド枠／本命だけど比較的手が届きやすい枠／安い代替枠／かなり安い代替枠／用途違いで選べる枠／迷ったらこれ枠
  B: センス重視の本命／実用重視の本命／コスパ重視の代替／初心者向け代替／ギフト向け代替／一番バランスがいい枠
- 本命側（side:"本命"）と代替側（side:"代替"）を両方入れる。本命と代替の差がはっきり分かる組み合わせにする
- 次が重複しすぎないようにする: ブランド（同じブランド・同じショップは2個まで）／価格帯（候補の「価格帯 高・中・低」がばらけるように。全部同じ価格帯にしない）／見た目（商品名から分かる形・色・素材を変える）／用途／サイズ感／役割
  例: 食器なら同じような小皿ばかりにせず、小皿・取り皿・ワンプレート向き・ギフト向き などに広げる
- 各商品に pick（その商品を選ぶ理由の一言、20字以内）を必ず入れる。本命なら「なぜ本命なのか」、代替なら「なぜ代替として成立するのか」が分かる言い方にする
  例:「ブランド込みで欲しいならこれ」「価格を抑えるならこのへん」「まず1枚試すならこれ」「ギフトっぽさを出すならこれ」「普段使いしやすいのはこれ」
- 避けること: 安いだけの無名商品を機械的に混ぜる／本命と代替の差が分からない／6個とも似た見た目／全部同じ価格帯／比較として弱い組み合わせ
- 目指すのは、見た人が「高い方の良さも分かるし、安い方で十分なパターンも分かる」状態`;

function buildSystemPrompt(theme) {
  const compare = theme.type === 'premium_budget';
  const type = CURATION_TYPES[theme.type];
  const brand = isBrandTheme(theme);
  const audience = theme.audience || '';
  return `あなたは楽天ROOMの「選び方まとめ」を作る編集者です。JSONだけを返してください。
目的は、見た人が「結局どれを買えばいいの？」「高いのと安いの、両方知りたい」「初心者なら何から？」「プレゼントなら何を？」と迷わずに済むこと。
商品をたくさん並べることより「なぜこの順番なのか」「どんな人にどれが合うのか」が分かることを優先し、「この投稿だけ見れば、自分がどれを買えばいいか決められる」状態にする。

まとめの型: ${type.name}
${type.guide}

選び方:
件数（Instagramの1投稿で並べても、全部に選ぶ理由があるように）:
- 合計6個を目安に、各枠の候補全体を見比べて厳選する（上から順に取らない）。比較が中心で少ない方が自然なまとめは3〜5個でよい
- 「本命＋安い代替」は本命側3個＋代替側3個のように、枠ごとに複数選んでよい。「予算別」は各価格帯から1〜2個
- 6個にはそれぞれ違う役割を持たせる（例: 一番外しにくい／実用性重視／自分では買わないけど、もらうと嬉しい／少しセンスが良く見える／価格を抑えるなら／少し奮発するなら）。同じような商品・用途が重複する商品・実質同一商品は並べない
- 件数を増やすために質の低い商品を混ぜない。安いだけの無名商品、プレゼントとしてブランドや品質に不安があるもの、なぜ選んだのか説明できないものは数合わせで入れない。魅力的な商品が4個しかなければ4個でよい
- 枠に合う良い商品がなければ、その枠は飛ばしてよい
- 候補にない商品は出さない。価格や仕様は候補の情報だけを根拠にする
- items[].id は候補の行頭の数字（全枠を通した通し番号）をそのまま数値で書く
- 並び順そのものに意味を持たせる（例: 迷ったらまずこれ → 2番手 → 3番手、本命 → 安い代替、低価格 → 中価格 → 高価格）
- 運営者本人が「これなら自分も欲しい」と思えるものを選ぶ。レビュー数や売れ筋だけで選ばない

各項目:
- title: 投稿のタイトル（30字以内。テーマを自然に言い換える）
- lead: 結論と、この順番にした理由（80〜150字）
- verdict: 迷った人への一言の結論（40〜80字。「迷ったら○○」の形）
- items[].role: まとめの中での役割（10字以内。例: 迷ったらまずこれ／2本目に／本命／安い代替／低価格／中価格／高価格／仕事用）
- items[].forWho: どんな人に合うか（20〜40字。ここでは「〜な人に」と書いてよい）
- items[].why: なぜこの位置・この役割なのか（50〜90字）
- items[].tradeoff: 価格差があるとき、高い方は何にお金を払っているのか／安い方は何を妥協するのか（30〜80字。本命と代替なら何が似ていて何が違うのか。不要なら空文字）
- items[].basis: 選んだ根拠。「${BASIS_TYPES.join('」「')}」のどれか
- items[].intro: その商品単体で楽天ROOMに投稿する紹介文。まとめの中での立ち位置が分かる一言を自然に入れてよい（例:「王道ならこれ」「最初の1本ならこれ」）
${brand ? `- items[].brandNote: ブランド・贈り物としての評価（40〜90字）。そのブランドを選ぶ意味、価格の根拠、年齢・印象との相性。判断材料が弱ければ正直にそう書く
- items[].giftClass: 次から1つ（当てはまらなければ空文字）: ${GIFT_CLASSES.join('／')}
${audience ? `\nプレゼントの相手: ${audience}\n` : ''}
${BRAND_RULES}
` : ''}
${compare ? COMPARE_RULES + '\n' : ''}
${BUYER_POLICY}

${WRITING_RULES}

出力形式:
{"title":"...",${compare ? '"axis":"...",' : ''}"lead":"...","verdict":"...","items":[{"id":候補番号,"role":"...",${compare ? '"side":"本命か代替","pick":"...",' : ''}"forWho":"...","why":"...","tradeoff":"...","basis":"...",${brand ? '"brandNote":"...","giftClass":"...",' : ''}"intro":"..."}]}`;
}

// 全候補の価格を3等分して「高・中・低」を付ける（価格帯がばらけるよう選んでもらうため）
function priceTierOf(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)] || 0;
  const hi = sorted[Math.floor((sorted.length * 2) / 3)] || 0;
  return (p) => (p >= hi ? '高' : p >= lo ? '中' : '低');
}

function buildUserContent(theme, slots) {
  const tier = priceTierOf(slots.flatMap((sl) => sl.items.map((it) => it.price)));
  let id = 0;
  const lines = [`テーマ: ${theme.title}${theme.audience ? `（相手: ${theme.audience}）` : ''}`];
  // ユーザーが条件を指定したときは、その意図を最優先にする
  if (theme.request) lines.push(`ユーザーの発掘条件（最優先。この意図に合う商品・説明にする）:\n${theme.request}`);
  for (const slot of slots) {
    lines.push(`\n[枠: ${slot.label}（${priceRange(slot)}）]`);
    for (const it of slot.items) {
      const shop = it.shop ? ` / 販売: ${compact(it.shop, 20)}` : '';
      lines.push(`${id}: ${compact(it.name, 70)} / ${it.price}円（価格帯 ${tier(it.price)}）${shop} / ${compact(it.caption, 90)}`);
      id++;
    }
  }
  return lines.join('\n');
}

// AIの応答から商品リストを探す（キー名の揺れ・入れ子にも対応）
function findItemList(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'picks', 'products', 'list']) {
    if (Array.isArray(data[key])) return data[key];
  }
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) return v;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = findItemList(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

function readId(x) {
  const raw = x && (x.id ?? x.index ?? x.candidateId ?? x.candidate ?? x.no ?? x.number);
  return parseInt(String(raw ?? '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/[^0-9]/g, ''), 10);
}

function parseCuration(content, flat) {
  let data;
  try {
    data = JSON.parse(String(content).match(/[\[{][\s\S]*[\]}]/)[0]);
  } catch {
    throw new AiError(`AIの応答を読み取れませんでした（先頭: ${String(content).slice(0, 60)}）`);
  }
  const list = findItemList(data);
  const used = new Set();
  const items = [];
  const skipped = { badId: 0, dup: 0 };
  for (const x of list) {
    const id = readId(x);
    if (!Number.isInteger(id) || !flat[id]) { skipped.badId++; continue; }
    if (used.has(id)) { skipped.dup++; continue; }
    used.add(id);
    items.push({
      index: id,
      role: cleanText(x.role).slice(0, 14) || flat[id].slotLabel,
      forWho: cleanText(x.forWho),
      why: cleanText(x.why),
      tradeoff: cleanText(x.tradeoff),
      brandNote: cleanText(x.brandNote),
      basis: BASIS_TYPES.includes(cleanText(x.basis)) ? cleanText(x.basis) : '',
      giftClass: GIFT_CLASSES.includes(cleanText(x.giftClass)) ? cleanText(x.giftClass) : '',
      pick: cleanText(x.pick).slice(0, 30),
      side: /本命/.test(String(x.side || '')) ? '本命' : /代替/.test(String(x.side || '')) ? '代替' : '',
      // 紹介文が短い・NG表現の除去で短くなった場合も商品は残し、後の書き直しで補う
      intro: cleanText(x.intro)
    });
    if (items.length >= MAX_ITEMS) break;
  }
  if (items.length < 2) {
    const keys = data && typeof data === 'object' ? Object.keys(data).join(',') : typeof data;
    throw new AiError(`AIがまとめを組み立てられませんでした（項目${list.length}件・番号不正${skipped.badId}・重複${skipped.dup}・キー: ${keys}）`);
  }
  return {
    title: cleanText(data.title).slice(0, 40),
    axis: cleanText(data.axis).slice(0, 30),
    lead: cleanText(data.lead),
    verdict: cleanText(data.verdict),
    items
  };
}

function toProduct(it, x) {
  return {
    name: it.name, code: it.code, price: it.price, url: it.url, image: it.image, shop: it.shop,
    role: x.role, pick: x.pick || '', side: x.side || '', forWho: x.forWho, why: x.why, tradeoff: x.tradeoff,
    brandNote: x.brandNote || '', giftClass: x.giftClass || '', basis: x.basis || '', intro: x.intro
  };
}

function nearKey(name) {
  return String(name).replace(/[【\[（(].*?[】\]）)]/g, '').replace(/[\s　]+/g, '').slice(0, 10);
}

// 「本命＋安い代替」の選定結果を点検する：同じショップ・ほぼ同じ商品名が多すぎれば間引き、
// 価格差が小さい・本命側か代替側が無いときは知らせる
export function checkComparison(items, flat) {
  const shopCount = {};
  const seenName = new Set();
  const kept = [];
  for (const x of items) {
    const it = flat[x.index];
    const shop = it.shop || '';
    const key = nearKey(it.name);
    if (shop && (shopCount[shop] || 0) >= 2) continue;
    if (seenName.has(key)) continue;
    shopCount[shop] = (shopCount[shop] || 0) + 1;
    seenName.add(key);
    kept.push(x);
  }
  const warnings = [];
  const prices = kept.map((x) => flat[x.index].price);
  if (prices.length >= 2 && Math.max(...prices) < Math.min(...prices) * 1.8) warnings.push('今回は価格差が小さめです');
  const sides = new Set(kept.map((x) => x.side).filter(Boolean));
  if (sides.size && !sides.has('本命')) warnings.push('本命側に当たる商品が見つかりませんでした');
  if (sides.size && !sides.has('代替')) warnings.push('代替側に当たる商品が見つかりませんでした');
  return { items: kept.length >= 2 ? kept : items, warnings };
}

export async function buildCuration({ theme, slots, env, deadline }) {
  // 全枠の候補を通し番号で並べる（AIへの番号 = flat の位置）
  const flat = slots.flatMap((slot) => slot.items.map((it) => ({ ...it, slotLabel: slot.label })));
  const { result, model, apiKey } = await runWithModels({
    env, deadline, system: buildSystemPrompt(theme), userContent: buildUserContent(theme, slots),
    parse: (content) => parseCuration(content, flat)
  });
  // 紹介文・理由に定型表現などが残っていれば、その商品だけ書き直す
  let warnings = [];
  if (theme.type === 'premium_budget') {
    const checked = checkComparison(result.items, flat);
    result.items = checked.items;
    warnings = checked.warnings;
  }
  const refined = await refineIntros({
    picks: result.items.map((x) => ({ index: x.index, reason: x.why, intro: x.intro })),
    items: flat, model, apiKey, deadline
  });
  const items = result.items.map((x, i) => {
    const intro = refined[i].intro.length >= 60 ? refined[i].intro : fallbackPicks([flat[x.index]])[0].intro;
    return { ...x, why: refined[i].reason, intro };
  });
  return {
    title: result.title || theme.title,
    axis: result.axis || '',
    warnings,
    lead: result.lead,
    verdict: result.verdict,
    products: items.map((x) => toProduct(flat[x.index], x))
  };
}

// AIが使えないときの予備：各枠の先頭の商品を、枠の役割名つきで並べる
export function fallbackCuration({ theme, slots }) {
  // 各枠から順番に1つずつ取り、最大6件まで（枠が少ないときは2巡目も）
  const filled = slots.filter((s) => s.items.length);
  const products = [];
  for (let round = 0; round < 2 && products.length < MAX_ITEMS; round++) {
    for (const slot of filled) {
      const it = slot.items[round];
      if (!it || products.length >= MAX_ITEMS) continue;
      const [fb] = fallbackPicks([it]);
      products.push(toProduct(it, { role: slot.label, forWho: '', why: '', tradeoff: '', intro: fb.intro }));
    }
  }
  return { title: theme.title, lead: '', verdict: '', products };
}
