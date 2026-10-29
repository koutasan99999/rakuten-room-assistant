// 楽天ROOMに投稿するときのハッシュタグ（商品ごと、5〜10個）。
// 判断の順番：①企画のテーマ ②商品の用途 ③商品カテゴリ ④購入目的 ⑤商品の特徴。
// まず企画全体の共通タグを作り、そのうえで商品ごとに具体的なタグを2〜4個だけ足す（世界観をそろえる）。
// 数を埋めるために関係の薄いタグは入れない。商品カテゴリ名をそのままタグにしない。
import { AiError, compact, runWithModels } from './ai.js';
import { CATALOG } from './catalog.js';
import { normalizeTag, allowTag, themeGenres } from './tag-rules.js';

export const MIN_SCORE = 70;
const MAX_COMMON = 6;
const MAX_PER_ITEM = 4;
const MAX_TOTAL = 10;

const PROMPT = `あなたは楽天ROOMのハッシュタグを決める担当です。JSONだけを返してください。
一番大事なのは「この商品を、今回なぜ紹介しているのか」が伝わること。数を増やすことではありません。

判断の順番: ①企画のテーマ ②商品の用途 ③商品カテゴリ ④購入目的 ⑤商品の特徴
タグの優先度:
- A 企画テーマ（例: #防災 #出産祝い #一人暮らし #旅行グッズ #メンズギフト）
- B 購入目的・悩み（例: #災害対策 #停電対策 #防災準備 #プレゼント選び #新生活準備）
- C 商品の用途（例: #非常用トイレ #モバイルバッテリー #LEDランタン #保存水）
- D 商品ジャンル（例: #ガジェット #家電 #スニーカー #食器）
- E 価格や特徴（例: #5000円以下 #コンパクト #コードレス）
D・Eだけでタグを作らない。

作り方:
1. common: 企画全体で共通のタグを3〜6個（主にA・B）
2. items: 商品ごとに、その商品の具体的な用途のタグを2〜4個（主にC。必要ならB・D・E）。共通タグと合わせて5〜10個になるようにする
- 商品カテゴリ名や楽天のジャンル名をそのままタグにしない。今回の投稿の文脈で自然かを判断する
  例: 防災企画のカセットコンロに #キッチン用品 は付けない（今回の購入目的は料理ではなく防災）
- 紹介文（ROOM紹介文）と内容をそろえる。紹介文にない目的（例: 停電対策の紹介文なのに #旅行用品 #アウトドア用品）は付けない
- 次のような広いタグは、その投稿で本当にその意味があるときだけ: #プチプラ #キッチン用品 #おしゃれ #かわいい #おすすめ #便利 #人気 #話題 #日用品
- 各タグに関連性の点数 score（0〜100）を付ける。基準: 企画テーマに直接関係するか／購入目的に関係するか／商品の実際の用途に関係するか／そのタグで商品を探す人がいるか。カテゴリに形式上入るだけなら高くしない
- 最後に「このタグだけ見た人が、今回の投稿内容を誤解しないか」を確かめ、誤解しそうなタグは入れない
- 関係の高いタグが少なければ、少ないままでよい

出力形式:
{"common":[{"tag":"#防災","score":98}],"items":[{"id":0,"tags":[{"tag":"#停電対策","score":92}]}]}`;

// 商品名・紹介文から分かる具体的な用途のタグ（AIが使えないときの予備。企画のテーマで足すものを変える）
const USE_CASES = [
  { re: /モバイルバッテリー|ポータブル電源/, tags: ['#モバイルバッテリー'], disaster: ['#停電対策', '#非常用電源'] },
  { re: /ランタン|懐中電灯|LEDライト/, tags: ['#ランタン'], disaster: ['#停電対策', '#防災ライト'] },
  { re: /トイレ/, tags: ['#非常用トイレ', '#簡易トイレ'] },
  { re: /保存水|飲料水|天然水/, tags: ['#保存水'], disaster: ['#備蓄'] },
  { re: /非常食|保存食|アルファ米|備蓄食/, tags: ['#非常食', '#保存食'] },
  { re: /カセットコンロ|ガスコンロ/, tags: ['#カセットコンロ'] },
  { re: /ラジオ/, tags: ['#ラジオ'], disaster: ['#防災ラジオ'] },
  { re: /リュック|持ち出し/, tags: [], disaster: ['#防災リュック', '#非常用持ち出し袋'] },
  { re: /スニーカー/, tags: ['#スニーカー選び', '#大人スニーカー'] },
  { re: /白.{0,6}スニーカー|スニーカー.{0,6}白|ホワイト/, tags: ['#白スニーカー'] },
  { re: /食器|プレート|ボウル|マグ/, tags: [], baby: ['#ベビー食器'] },
  { re: /スタイ|よだれかけ/, tags: ['#スタイ'] },
  { re: /香水|フレグランス|オードトワレ|オードパルファム/, tags: ['#香水選び'] },
  { re: /充電器/, tags: ['#充電器'] },
  { re: /イヤホン/, tags: ['#ワイヤレスイヤホン'] }
];

// ブランド名のタグ（英字・カタカナだけのとき。例: Onitsuka Tiger → #OnitsukaTiger）
function brandTag(brand) {
  const s = String(brand || '').replace(/[\s'’.・-]/g, '');
  return /^[A-Za-z0-9ァ-ヶー]{2,24}$/.test(s) ? `#${s}` : '';
}

function contextOf(campaign, item) {
  return [campaign.campaignTheme, campaign.campaignType, campaign.targetAudience, item.productName, item.productUseCase, item.roomDescription].join(' ');
}

// 企画全体の共通タグ（予備）：企画のテーマのジャンルのタグから数個
function fallbackCommon(genreIds) {
  const g = CATALOG.find((c) => c.id === genreIds[0]);
  return g ? (g.hashtags || []).slice(0, 5) : [];
}

function fallbackItemTags(item, genreIds) {
  const text = `${item.productName} ${item.productUseCase} ${item.roomDescription}`;
  const tags = [];
  for (const u of USE_CASES) {
    if (!u.re.test(text)) continue;
    tags.push(...u.tags);
    genreIds.forEach((g) => { if (u[g]) tags.push(...u[g]); });
  }
  const b = brandTag(item.brand);
  if (b) tags.push(b);
  return tags;
}

// 共通タグ＋商品ごとのタグを合わせ、関係の薄いもの・重なりを除いて10個までにする
function finalize(common, perItem, campaign, items, genreIds) {
  const commonOk = [];
  for (const c of common) {
    const tag = normalizeTag(c.tag);
    if (tag && !commonOk.includes(tag) && allowTag(tag, { score: c.score, genreIds, context: `${campaign.campaignTheme} ${campaign.campaignType} ${campaign.targetAudience}` })) commonOk.push(tag);
    if (commonOk.length >= MAX_COMMON) break;
  }
  const products = items.map((item, i) => {
    const own = [];
    for (const t of perItem[i] || []) {
      const tag = normalizeTag(t.tag);
      if (!tag || commonOk.includes(tag) || own.includes(tag)) continue;
      if (!allowTag(tag, { score: t.score, genreIds, context: contextOf(campaign, item) })) continue;
      own.push(tag);
      if (own.length >= MAX_PER_ITEM) break;
    }
    return { tags: commonOk.concat(own).slice(0, MAX_TOTAL) };
  });
  return { common: commonOk, products };
}

function parse(content, items) {
  let data;
  try { data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]); } catch { throw new AiError('AIの応答を読み取れませんでした'); }
  const common = (Array.isArray(data.common) ? data.common : []).map((c) => (typeof c === 'string' ? { tag: c, score: 80 } : c)).filter((c) => c && c.tag);
  const perItem = items.map(() => []);
  for (const x of Array.isArray(data.items) ? data.items : []) {
    const id = parseInt(String(x && x.id).replace(/[^0-9]/g, ''), 10);
    if (!Number.isInteger(id) || !perItem[id]) continue;
    perItem[id] = (Array.isArray(x.tags) ? x.tags : []).map((t) => (typeof t === 'string' ? { tag: t, score: 80 } : t)).filter((t) => t && t.tag);
  }
  if (!common.length) throw new AiError('共通のタグがありませんでした');
  return { common, perItem };
}

// campaign: { campaignTheme, campaignType, targetAudience, priceRange }
// items: [{ productName, productCategory, productUseCase, roomDescription, brand }]
export async function generateRoomHashtags({ campaign, items, env, deadline }) {
  const genreIds = themeGenres(`${campaign.campaignTheme} ${campaign.campaignType}`);
  const userContent = [
    `企画のテーマ: ${campaign.campaignTheme}`,
    campaign.campaignType && `企画の型: ${campaign.campaignType}`,
    campaign.targetAudience && `想定する人: ${campaign.targetAudience}`,
    campaign.priceRange && `価格帯: ${campaign.priceRange}`,
    '商品:',
    ...items.map((it, i) => `${i}: ${compact(it.productName, 60)}${it.productCategory ? ` / カテゴリ: ${it.productCategory}` : ''}${it.productUseCase ? ` / 今回の役割・用途: ${compact(it.productUseCase, 40)}` : ''}\n   ROOM紹介文: ${compact(it.roomDescription, 160)}`)
  ].filter(Boolean).join('\n');
  try {
    const { result } = await runWithModels({ env, deadline, system: PROMPT, userContent, parse: (c) => parse(c, items) });
    const out = finalize(result.common, result.perItem, campaign, items, genreIds);
    // AIの共通タグが全部はじかれたときは、企画のテーマのタグで補う
    if (!out.common.length) return { ...finalize(fallbackCommon(genreIds).map((tag) => ({ tag, score: 100 })), result.perItem, campaign, items, genreIds), fallback: false };
    return { ...out, fallback: false };
  } catch (e) {
    console.error('[openai] room hashtags fallback:', e.message);
    const common = fallbackCommon(genreIds).map((tag) => ({ tag, score: 100 }));
    const perItem = items.map((it) => fallbackItemTags(it, genreIds).map((tag) => ({ tag, score: 85 })));
    return { ...finalize(common, perItem, campaign, items, genreIds), fallback: true, error: e.message };
  }
}
