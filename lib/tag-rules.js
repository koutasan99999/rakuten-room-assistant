// ハッシュタグの「関係あるか」の判断（楽天ROOM用・Instagram用で共通）。
// 商品のカテゴリだけで決めず、「今回なぜこの商品を紹介しているのか（企画のテーマ・購入目的）」を最優先にする。
// 例：防災企画のカセットコンロに #キッチン用品 は付けない（今回の購入目的は料理ではなく防災だから）。
import { CATALOG } from './catalog.js';

// 意味が広すぎるタグ。投稿の中で本当にその意味があるとき（紹介文などにその言葉があり、AIの評価も高い）だけ使う
export const GENERIC_TAGS = ['#プチプラ', '#おしゃれ', '#かわいい', '#おすすめ', '#便利', '#人気', '#話題', '#日用品', '#人気商品', '#おすすめアイテム', '#便利アイテム', '#おしゃれ家電', '#プチプラ食器'];

// 商品カテゴリの名前そのもの・趣味の広いタグ。企画の文脈に合うとき（テーマや紹介文にその言葉がある）だけ使う
export const CATEGORY_TAGS = ['#キッチン用品', '#キッチン雑貨', '#食器好き', '#器好き', '#おうちごはん', '#ガジェット好き', '#スマホ用品', '#スマホグッズ', '#旅行グッズ', '#旅行用品', '#アウトドア用品', '#靴', '#ファッション', '#家電', '#生活家電', '#雑貨', '#インテリア雑貨'];

// テーマの文字から、企画のジャンル（lib/catalog.js の id）を見分ける目印
export const THEME_HINTS = {
  disaster: /防災|災害|停電|断水|避難|備蓄|非常/,
  baby: /出産|ベビー|赤ちゃん|育児/,
  scent: /香水|フレグランス|香り/,
  gift: /プレゼント|ギフト|贈り物|誕生日|お祝い/,
  gadget: /ガジェット|iPhone|充電|モバイルバッテリー|イヤホン|デスク/,
  kitchen: /食器|器|うつわ|キッチン|マグ|グラス/,
  travel: /旅行|旅|アウトドア|キャンプ/,
  living: /一人暮らし|寝具|インテリア|タオル|新生活/,
  fashion: /ファッション|財布|バッグ|服|コーデ|スニーカー|靴/,
  stationery: /文房具|ペン|手帳|ノート/,
  appliance: /家電/,
  useful: /便利|収納|掃除|時短/
};

// 企画のテーマ（タイトル・型など）から、ジャンルを見分ける。最初のものが主なジャンル
export function themeGenres(text) {
  return Object.entries(THEME_HINTS).filter(([, re]) => re.test(String(text || ''))).map(([id]) => id);
}

const TAG_RE = /^#[\p{L}\p{N}_ー・]{1,30}$/u;

export function normalizeTag(t) {
  let s = String(t || '').trim().replace(/^＃/, '#').replace(/\s+/g, '');
  if (!s) return '';
  if (!s.startsWith('#')) s = '#' + s;
  return TAG_RE.test(s) ? s : '';
}

// ほかのジャンルのテーマ別タグ（例：防災企画から見た #北欧食器）
function otherGenreTags(genreIds) {
  return new Set(CATALOG.filter((g) => !genreIds.includes(g.id)).flatMap((g) => g.hashtags || []));
}

function themeTagSet(genreIds) {
  return new Set(CATALOG.filter((g) => genreIds.includes(g.id)).flatMap((g) => g.hashtags || []));
}

// タグを使ってよいか。score: AIの関連性の点数（0〜100）、context: その投稿・商品の文章（テーマ・紹介文・用途など）
// 「このタグだけ見た人が、今回の投稿内容を誤解しないか」を、次の順で確かめる
export function allowTag(tag, { score = 0, genreIds = [], context = '' } = {}) {
  const core = tag.slice(1);
  const mentioned = String(context).replace(/\s+/g, '').includes(core);
  if (themeTagSet(genreIds).has(tag)) return true; // 企画のテーマのタグ
  if (GENERIC_TAGS.includes(tag)) return score >= 90 && mentioned; // 広すぎるタグは、文章にその意味があるときだけ
  if (CATEGORY_TAGS.includes(tag) || otherGenreTags(genreIds).has(tag)) return mentioned && score >= 80; // カテゴリ名・ほかのテーマのタグ
  return score >= 70;
}
