// 楽天ROOMに投稿するときのハッシュタグ（商品ごと、5〜10個）。
// 判断の順番：①企画のテーマ ②商品の用途 ③商品カテゴリ ④購入目的 ⑤商品の特徴。
// まず企画全体の共通タグを作り、そのうえで商品ごとに具体的なタグを2〜4個だけ足す（世界観をそろえる）。
// 数を埋めるために関係の薄いタグは入れない。商品カテゴリ名をそのままタグにしない。
import { AiError, compact, runWithModels } from './ai.js';
import { CATALOG } from './catalog.js';
import { normalizeTag, allowTag, themeGenres } from './tag-rules.js';
import { classify } from './pitch-genres.js';

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
  { re: /白.{0,6}スニーカー|スニーカー.{0,6}(白|ホワイト)|ホワイト.{0,6}スニーカー/, tags: ['#白スニーカー'] },
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

// ---- 商品のデータだけから作るタグ（AIを使わない。費用0円）----
// ①商品固有（商品名にある言葉だけ）②用途・悩み（商品名・特徴・ターゲット・企画にある言葉だけ）③ジャンル（商品名から分類）。
// 商品名にない特徴・ブランドは付けない。関係の高いタグが少なければ、少ないまま（数を埋めない）。
const NAME_TAGS = [
  [/モバイルバッテリー/, ['#モバイルバッテリー']], [/ポータブル電源/, ['#ポータブル電源']], [/充電器|充電スタンド/, ['#充電器']],
  [/ワイヤレスイヤホン|イヤホン/, ['#ワイヤレスイヤホン']], [/ヘッドホン/, ['#ヘッドホン']], [/スピーカー/, ['#スピーカー']],
  [/スマホスタンド/, ['#スマホスタンド']], [/キーボード/, ['#キーボード']], [/マウス(?!ピース)/, ['#マウス']],
  [/ランタン/, ['#ランタン']], [/懐中電灯|ヘッドライト/, ['#ライト']], [/デスクライト/, ['#デスクライト']], [/ランプ/, ['#ランプ']],
  [/非常用トイレ|簡易トイレ/, ['#簡易トイレ']], [/保存水/, ['#保存水']], [/非常食|保存食|アルファ米/, ['#非常食']], [/防災セット|防災リュック/, ['#防災セット']],
  [/カセットコンロ/, ['#カセットコンロ']], [/ラジオ/, ['#ラジオ']],
  [/白.{0,6}スニーカー|スニーカー.{0,6}(白|ホワイト)/, ['#白スニーカー']], [/スニーカー/, ['#スニーカー']], [/ローファー/, ['#ローファー']], [/ブーツ/, ['#ブーツ']], [/サンダル/, ['#サンダル']], [/ルームシューズ|スリッパ/, ['#ルームシューズ']],
  [/腕時計/, ['#腕時計']], [/置き時計|掛け時計/, ['#時計']], [/サングラス/, ['#サングラス']], [/リング|指輪/, ['#リング']], [/ブレスレット|バングル/, ['#ブレスレット']], [/ネックレス/, ['#ネックレス']],
  [/トートバッグ|トート/, ['#トートバッグ']], [/リュック/, ['#リュック']], [/ショルダーバッグ|ショルダー/, ['#ショルダーバッグ']], [/サコッシュ/, ['#サコッシュ']],
  [/ミニ財布/, ['#ミニ財布']], [/(?<!ミニ)財布|ウォレット/, ['#財布']], [/キーケース/, ['#キーケース']], [/カードケース/, ['#カードケース']], [/名刺入れ/, ['#名刺入れ']],
  [/香水|オードトワレ|オードパルファム|パルファム/, ['#香水']], [/ハンドクリーム/, ['#ハンドクリーム']], [/ディフューザー/, ['#ディフューザー']], [/お香/, ['#お香']], [/キャンドル/, ['#キャンドル']],
  [/爪切り/, ['#爪切り']], [/ヘアブラシ/, ['#ヘアブラシ']],
  [/花瓶|フラワーベース/, ['#花瓶']], [/スツール/, ['#スツール']], [/シェルフ/, ['#シェルフ']],
  [/ドリッパー/, ['#コーヒードリッパー']], [/コーヒーミル/, ['#コーヒーミル']], [/ケトル/, ['#ケトル']], [/急須|ティーポット/, ['#急須']],
  [/マグカップ|マグ(?!ネット|ボトル)/, ['#マグカップ']], [/グラス(?!ファイバー)/, ['#グラス']], [/プレート|皿/, ['#お皿']], [/ボウル/, ['#ボウル']], [/箸(?!置)/, ['#箸']],
  [/スキレット/, ['#スキレット']], [/フライパン/, ['#フライパン']], [/包丁/, ['#包丁']], [/まな板/, ['#まな板']],
  [/タンブラー/, ['#タンブラー']], [/水筒|マグボトル/, ['#水筒']], [/焚き火台/, ['#焚き火台']], [/シェラカップ/, ['#シェラカップ']],
  [/折りたたみ傘|折り畳み傘/, ['#折りたたみ傘']], [/(?<!折りたたみ|折り畳み)傘/, ['#傘']], [/タオル/, ['#タオル']], [/ブランケット/, ['#ブランケット']], [/枕/, ['#枕']],
  [/収納ボックス/, ['#収納ボックス']], [/ほうき/, ['#ほうき']], [/ランドリー/, ['#ランドリーグッズ']],
  [/ボールペン/, ['#ボールペン']], [/万年筆/, ['#万年筆']], [/手帳/, ['#手帳']], [/ノート/, ['#ノート']], [/ボードゲーム/, ['#ボードゲーム']], [/パズル/, ['#パズル']],
  [/ドライフラワー/, ['#ドライフラワー']], [/観葉植物/, ['#観葉植物']],
  [/Tシャツ|ティーシャツ/i, ['#Tシャツ']], [/カットソー/, ['#カットソー']], [/ニット|セーター/, ['#ニット']], [/カーディガン/, ['#カーディガン']], [/スウェット/, ['#スウェット']], [/パーカー/, ['#パーカー']],
  [/ジャケット/, ['#ジャケット']], [/コート/, ['#コート']], [/デニム|ジーンズ/, ['#デニム']], [/キャップ/, ['#キャップ']], [/ハット|帽子/, ['#帽子']],
  [/ベビー|赤ちゃん/, ['#ベビー用品']], [/スタイ|よだれかけ/, ['#スタイ']],
  // 商品名に書いてある特徴だけ
  [/日本製|国産/, ['#日本製']], [/本革|レザー/, ['#本革']], [/真鍮/, ['#真鍮']], [/名入れ|刻印/, ['#名入れギフト']], [/北欧/, ['#北欧雑貨']], [/ステンレス/, ['#ステンレス']]
];
// 用途・悩み（商品名・特徴・ターゲット・企画のどれかにその言葉があるときだけ）
const PURPOSE_TAGS = [
  [/プレゼント|ギフト|贈り物|贈る/, ['#プレゼント選び']], [/誕生日/, ['#誕生日プレゼント']], [/父の日/, ['#父の日ギフト']], [/母の日/, ['#母の日ギフト']],
  [/出産祝い/, ['#出産祝い']], [/クリスマス/, ['#クリスマスプレゼント']], [/結婚祝い/, ['#結婚祝い']], [/引っ越し祝い|新築祝い/, ['#引っ越し祝い']],
  [/一人暮らし/, ['#一人暮らし']], [/新生活/, ['#新生活準備']],
  [/防災|災害|非常時|非常用|備蓄/, ['#防災グッズ']], [/停電/, ['#停電対策']], [/断水/, ['#断水対策']],
  [/旅行|出張/, ['#旅行グッズ']], [/キャンプ/, ['#キャンプ用品']], [/アウトドア/, ['#アウトドア']],
  [/在宅|テレワーク|リモートワーク|デスク/, ['#デスク周り']], [/収納|片付け|整理/, ['#収納アイデア']], [/掃除/, ['#掃除グッズ']], [/時短/, ['#時短グッズ']],
  [/梅雨|雨の日/, ['#雨の日対策']], [/防寒|寒さ|冷え/, ['#防寒対策']], [/暑さ|熱中症|ひんやり|冷感/, ['#暑さ対策']],
  [/コーヒー/, ['#コーヒーのある暮らし']], [/おうち時間/, ['#おうち時間']], [/通勤/, ['#通勤スタイル']]
];
// ジャンル（商品名の分類から。企画のテーマと合わないときは付けない）
const GENRE_TAGS = {
  fashion: ['#ファッションアイテム'], shoes: ['#靴好き'], watch: ['#アクセサリー'], bag: ['#バッグ好き'], grooming: ['#身だしなみ'],
  gadget: ['#ガジェット'], interior: ['#インテリア雑貨'], kitchen: ['#キッチン雑貨'], living: ['#暮らしの道具'], outdoor: ['#アウトドアグッズ'], gift: ['#ギフト'], hobby: ['#文房具']
};
const SUB_GENRE = { bottle: ['#マイボトル'], bousai: ['#防災グッズ'], small_leather: ['#革小物'], wallet: ['#革小物'], watch: ['#腕時計好き'], perfume: ['#香水好き'], coffee: ['#コーヒー道具'], play: ['#大人の趣味'], flower: ['#花のある暮らし'] };

const squash = (s) => String(s || '').normalize('NFKC').replace(/[\s'’.・\-]/g, '').toLowerCase();

// 英字を含むタグ（ブランド名など）は、商品名にその文字があるときだけ使う
export function confirmedInName(tag, name) {
  const core = tag.slice(1);
  if (!/[A-Za-z]/.test(core)) return true;
  const n = squash(name);
  const m = core.match(/[A-Za-z0-9]+/g) || [];
  return m.every((w) => n.includes(w.toLowerCase()));
}

// 商品の種類を表すタグ（#タンブラー など）は、商品名にその種類が書いてあるときだけ使う（AIが別の商品の種類を出しても付けない）
const TYPE_TAG_RE = new Map();
NAME_TAGS.forEach(([re, tags]) => tags.forEach((t) => TYPE_TAG_RE.set(t, TYPE_TAG_RE.has(t) ? new RegExp(`${TYPE_TAG_RE.get(t).source}|${re.source}`, 'i') : re)));
export function typeMatchesName(tag, name) {
  const re = TYPE_TAG_RE.get(tag);
  return !re || re.test(String(name || '').normalize('NFKC'));
}

// item: { name, feature, useCase, target, theme, brand }。返り値：タグの配列（0〜10個。関係の高いものだけ）
export function productTags(item = {}) {
  const name = String(item.name || '').normalize('NFKC');
  const around = [item.feature, item.useCase, item.target, item.theme].map((x) => String(x || '').normalize('NFKC')).join(' ');
  const genreIds = themeGenres(item.theme);
  const own = [];
  const purpose = [];
  const genre = [];
  const push = (list, tags) => tags.forEach((t) => { const tag = normalizeTag(t); if (tag && !own.includes(tag) && !purpose.includes(tag) && !genre.includes(tag)) list.push(tag); });
  for (const [re, tags] of NAME_TAGS) if (re.test(name)) push(own, tags);
  for (const u of USE_CASES) if (u.re.test(name)) { push(own, u.tags); genreIds.forEach((g) => { if (u[g]) push(own, u[g]); }); }
  // ブランド：商品名にそのブランド名があるときだけ
  const b = brandTag(item.brand);
  if (b && squash(name).includes(squash(b.slice(1)))) push(own, [b]);
  for (const [re, tags] of PURPOSE_TAGS) if (re.test(`${name} ${around}`)) push(purpose, tags);
  if (purpose.includes('#プレゼント選び')) {
    if (/メンズ|男性|彼氏|父|夫|旦那/.test(`${name} ${around}`)) push(purpose, ['#メンズギフト']);
    else if (/レディース|女性|彼女|母|妻/.test(`${name} ${around}`)) push(purpose, ['#女性へのプレゼント']);
  }
  const c = classify(name);
  if (c) {
    const g = SUB_GENRE[c.sub] || GENRE_TAGS[c.major] || [];
    // 企画のテーマがあるときは、テーマと合うジャンルのタグだけ（例：出産祝いのベビー食器に #キッチン雑貨 は付けない）
    push(genre, g.filter((t) => !genreIds.length || allowTag(t, { score: 80, genreIds, context: `${item.theme} ${around}` })).slice(0, 2));
  }
  // 商品固有を先に（最大5）、用途・悩み（最大3）、ジャンル（最大2）
  return own.slice(0, 5).concat(purpose.slice(0, 3), genre.slice(0, 2)).slice(0, MAX_TOTAL);
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
function finalize(common, perItem, campaign, items, genreIds, maxPerItem = MAX_PER_ITEM) {
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
      if (!confirmedInName(tag, item.productName) || !typeMatchesName(tag, item.productName)) continue; // 商品名にないブランド名・商品の種類は付けない
      if (!allowTag(tag, { score: t.score, genreIds, context: contextOf(campaign, item) })) continue;
      own.push(tag);
      if (own.length >= maxPerItem) break;
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
  // 商品のデータだけから作ったタグ（AIの結果が少ないときの補い・AIが使えないときの代わり）
  const local = items.map((it) => productTags({ name: it.productName, feature: it.roomDescription, useCase: it.productUseCase, target: campaign.targetAudience, theme: `${campaign.campaignTheme} ${campaign.campaignType}`, brand: it.brand }));
  // AIのタグが5個より少ない商品は、商品のデータから作った関係の高いタグで補う（無理に増やさない）
  // 商品の種類のタグ（#タンブラー など）が1つも無ければ、商品名から分かる種類のタグを2個まで入れる（企画のタグだけにしない）
  const topUp = (out) => ({ ...out, products: out.products.map((p, i) => {
    let tags = p.tags.slice();
    const types = local[i].filter((t) => TYPE_TAG_RE.has(t) && !tags.includes(t)).slice(0, 2);
    if (types.length && !tags.some((t) => TYPE_TAG_RE.has(t))) tags = tags.slice(0, MAX_TOTAL - types.length).concat(types);
    if (tags.length < 5) for (const t of local[i]) { if (tags.length >= MAX_TOTAL) break; if (!tags.includes(t)) tags.push(t); }
    return { tags };
  }) });
  try {
    const { result } = await runWithModels({ env, deadline, system: PROMPT, userContent, parse: (c) => parse(c, items) });
    const out = finalize(result.common, result.perItem, campaign, items, genreIds);
    // AIの共通タグが全部はじかれたときは、企画のテーマのタグで補う
    if (!out.common.length) return { ...topUp(finalize(fallbackCommon(genreIds).map((tag) => ({ tag, score: 100 })), result.perItem, campaign, items, genreIds)), fallback: false };
    return { ...topUp(out), fallback: false };
  } catch (e) {
    console.error('[openai] room hashtags fallback:', e.message);
    // 企画のテーマのタグは4個まで。残りは商品ごとのタグ（商品名・特徴・用途から。関係の高いものだけ）
    const common = fallbackCommon(genreIds).slice(0, 4).map((tag) => ({ tag, score: 100 }));
    const perItem = items.map((it, i) => [...new Set(fallbackItemTags(it, genreIds).concat(local[i]))].map((tag) => ({ tag, score: 85 })));
    return { ...finalize(common, perItem, campaign, items, genreIds, MAX_TOTAL), fallback: true, error: e.message };
  }
}
