// 「選び方まとめ」：枠ごとに集めた商品から、AIが順番・役割・どんな人に合うかを組み立てる
import { CURATION_TYPES, isBrandTheme } from './themes.js';
import { WRITING_RULES, BRAND_RULES, GIFT_CLASSES, BUYER_POLICY, BASIS_TYPES, AiError, compact, cleanText, runWithModels, refineIntros, fallbackPicks } from './ai.js';

const MAX_ITEMS = 5;

function priceRange(slot) {
  if (slot.minPrice && slot.maxPrice) return `${slot.minPrice}〜${slot.maxPrice}円`;
  if (slot.minPrice) return `${slot.minPrice}円〜`;
  if (slot.maxPrice) return `〜${slot.maxPrice}円`;
  return '価格指定なし';
}

function buildSystemPrompt(theme) {
  const type = CURATION_TYPES[theme.type];
  const brand = isBrandTheme(theme);
  const audience = theme.audience || '';
  return `あなたは楽天ROOMの「選び方まとめ」を作る編集者です。JSONだけを返してください。
目的は、見た人が「結局どれを買えばいいの？」「高いのと安いの、両方知りたい」「初心者なら何から？」「プレゼントなら何を？」と迷わずに済むこと。
商品をたくさん並べることより「なぜこの順番なのか」「どんな人にどれが合うのか」が分かることを優先し、「この投稿だけ見れば、自分がどれを買えばいいか決められる」状態にする。

まとめの型: ${type.name}
${type.guide}

選び方:
- 各枠から原則1つずつ選ぶ。枠に合う良い商品がなければ、その枠は飛ばしてよい
- 候補にない商品は出さない。価格や仕様は候補の情報だけを根拠にする
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
${BUYER_POLICY}

${WRITING_RULES}

出力形式:
{"title":"...","lead":"...","verdict":"...","items":[{"id":候補番号,"role":"...","forWho":"...","why":"...","tradeoff":"...","basis":"...",${brand ? '"brandNote":"...","giftClass":"...",' : ''}"intro":"..."}]}`;
}

function buildUserContent(theme, slots) {
  let id = 0;
  const lines = [`テーマ: ${theme.title}${theme.audience ? `（相手: ${theme.audience}）` : ''}`];
  for (const slot of slots) {
    lines.push(`\n[枠: ${slot.label}（${priceRange(slot)}）]`);
    for (const it of slot.items) {
      const shop = it.shop ? ` / 販売: ${compact(it.shop, 20)}` : '';
      lines.push(`${id}: ${compact(it.name, 70)} / ${it.price}円${shop} / ${compact(it.caption, 90)}`);
      id++;
    }
  }
  return lines.join('\n');
}

function parseCuration(content, flat) {
  let data;
  try {
    data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]);
  } catch {
    throw new AiError('AIの応答を読み取れませんでした');
  }
  const used = new Set();
  const items = [];
  for (const x of Array.isArray(data.items) ? data.items : []) {
    const id = parseInt(String(x && x.id).replace(/[^0-9]/g, ''), 10);
    if (!Number.isInteger(id) || !flat[id] || used.has(id)) continue;
    const intro = cleanText(x.intro);
    if (intro.length < 60) continue;
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
      intro
    });
    if (items.length >= MAX_ITEMS) break;
  }
  if (items.length < 2) throw new AiError('AIがまとめを組み立てられませんでした');
  return {
    title: cleanText(data.title).slice(0, 40),
    lead: cleanText(data.lead),
    verdict: cleanText(data.verdict),
    items
  };
}

function toProduct(it, x) {
  return {
    name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop,
    role: x.role, forWho: x.forWho, why: x.why, tradeoff: x.tradeoff,
    brandNote: x.brandNote || '', giftClass: x.giftClass || '', basis: x.basis || '', intro: x.intro
  };
}

export async function buildCuration({ theme, slots, env, deadline }) {
  // 全枠の候補を通し番号で並べる（AIへの番号 = flat の位置）
  const flat = slots.flatMap((slot) => slot.items.map((it) => ({ ...it, slotLabel: slot.label })));
  const { result, model, apiKey } = await runWithModels({
    env, deadline, system: buildSystemPrompt(theme), userContent: buildUserContent(theme, slots),
    parse: (content) => parseCuration(content, flat)
  });
  // 紹介文・理由に定型表現などが残っていれば、その商品だけ書き直す
  const refined = await refineIntros({
    picks: result.items.map((x) => ({ index: x.index, reason: x.why, intro: x.intro })),
    items: flat, model, apiKey, deadline
  });
  const items = result.items.map((x, i) => ({ ...x, why: refined[i].reason, intro: refined[i].intro }));
  return {
    title: result.title || theme.title,
    lead: result.lead,
    verdict: result.verdict,
    products: items.map((x) => toProduct(flat[x.index], x))
  };
}

// AIが使えないときの予備：各枠の先頭の商品を、枠の役割名つきで並べる
export function fallbackCuration({ theme, slots }) {
  const products = slots.filter((s) => s.items.length).map((slot) => {
    const it = slot.items[0];
    const [fb] = fallbackPicks([it]);
    return toProduct(it, { role: slot.label, forWho: '', why: '', tradeoff: '', intro: fb.intro });
  });
  return { title: theme.title, lead: '', verdict: '', products };
}
