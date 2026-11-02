// Instagramのハッシュタグを組み立てる（5個まで。2025年12月からInstagramは1投稿5個までと報じられている）。
// 大きなカテゴリ1・テーマや悩み・用途のタグ3・アカウントのタグ（#眼科医くま）1。関係ないタグで数合わせはしない。
// （以前は15〜25個だった。2026-11-02 に5個までに変更）
import { CATALOG } from './catalog.js';
import { allowTag, themeGenres, normalizeTag as ruleNormalize } from './tag-rules.js';

export const ACCOUNT_TAGS = ['#眼科医くま'];
export const MAX_TAGS = 5;

// 暮らしまわりのジャンルだけに付ける大きなカテゴリ
const LIFE_TAGS = ['#便利グッズ', '#暮らしを整える'];
// （防災・旅行などは「便利グッズ」ではなく、そのテーマで探す人に向けたタグにする）
const LIFE_GENRES = ['useful', 'appliance', 'gadget', 'living', 'kitchen'];

// 検索意図のタグ（企画の型・ジャンルに合わせて選ぶ）
function intentTags({ genreIds, postType, text }) {
  const tags = [];
  if (/まずこれ|まずコレ|最初|迷ったら|最低限|初心者/.test(`${postType} ${text}`)) tags.push('#まずこれ', '#迷ったらこれ', '#何を買えばいい');
  if (genreIds.includes('gift') || genreIds.includes('baby') || /プレゼント|ギフト/.test(postType)) tags.push('#プレゼント迷子', '#おすすめギフト');
  if (genreIds.some((g) => g === 'useful' || g === 'living')) tags.push('#あると便利', '#生活便利グッズ');
  // 「#買ってよかった」は使った感想に見えるので付けない
  tags.push('#何を買えばいい');
  return tags;
}

// 企画のテーマ（投稿テーマ）から先に見分ける。カテゴリ（商品カード左上の小ラベル）は、テーマで分からないときだけ使う
// （例：防災の投稿でカテゴリが「キッチン」でも、#キッチン用品 などは付けない）
export function detectGenres({ genre = '', category = '', topic = '' }) {
  const ids = themeGenres(topic);
  const named = CATALOG.find((c) => c.name === genre);
  if (named && !ids.includes(named.id)) ids.push(named.id);
  if (!ids.length) ids.push(...themeGenres(category));
  return ids;
}

export const normalizeTag = ruleNormalize;

// aiTags: AIが投稿内容から考えたタグ（テーマ別・検索意図）。関係の薄いものが混ざらないよう個数は絞る
export function buildHashtags({ topic = '', category = '', genre = '', postType = '', aiTags = [] } = {}) {
  const genreIds = detectGenres({ genre, category, topic });
  const genres = genreIds.map((id) => CATALOG.find((c) => c.id === id)).filter(Boolean);
  const themeTags = genres.flatMap((g) => g.hashtags || []);
  // AIのタグも、企画のテーマと関係が薄いもの（広すぎるタグ・ほかのテーマのタグ）ははじく
  const context = `${topic} ${category} ${postType}`;
  const ai = (Array.isArray(aiTags) ? aiTags : []).map(normalizeTag)
    .filter((t) => t && !ACCOUNT_TAGS.includes(t) && allowTag(t, { score: 80, genreIds, context })).slice(0, 10);

  const room = MAX_TAGS - ACCOUNT_TAGS.length;
  const out = [];
  const add = (list) => list.forEach((t) => { if (t && !out.includes(t) && out.length < room) out.push(t); });
  // 1. 大きなカテゴリ（主ジャンルの代表のタグ。暮らしまわりは #便利グッズ）
  const lifeLike = !genreIds.length || genreIds.some((g) => LIFE_GENRES.includes(g));
  add([(genres[0] && (genres[0].hashtags || [])[0]) || (lifeLike ? LIFE_TAGS[0] : '')]);
  // 2〜4. 投稿の内容に合うタグ（AIのタグ）→ 検索意図 → 主ジャンルのテーマ別タグ
  add(ai.slice(0, 2));
  add(intentTags({ genreIds, postType, text: `${topic} ${category}` }).slice(0, 1));
  add((genres[0] && genres[0].hashtags) || []);
  add(ai);
  add(themeTags);
  if (lifeLike) add(LIFE_TAGS);
  // 5. アカウントのタグは必ず最後に入れる
  return out.concat(ACCOUNT_TAGS);
}

// ふるさと納税の投稿：ROOM・楽天購入品・お得の系統のタグは付けない（ROOMの対象か未確認、ポイント付与は原則対象外のため）
const FURUSATO_TAGS = ['#ふるさと納税', '#ふるさと納税返礼品', '#ふるさと納税おすすめ', '#返礼品'];
const FURUSATO_CATEGORY_TAGS = { 米: ['#お米', '#新米'], 肉: ['#お肉'], 海鮮: ['#海鮮'], 果物: ['#フルーツ'], お酒: ['#お酒'], 日用品: ['#日用品'], 家電: ['#家電'], 旅行: ['#旅行'], 定期便: ['#定期便'] };
const FURUSATO_NG = /ROOM|楽天購入|ポイント|お得|節税|還元|実質|プレゼント|ギフト|買ってよかった|本気出して/;
export function buildFurusatoHashtags({ topic = '', aiTags = [] } = {}) {
  // 5個までなので、大きなタグ1・返礼品の種類・投稿に合うタグの順に入れ、残りをふるさと納税の定番タグで埋める
  const out = [FURUSATO_TAGS[0]];
  const add = (t) => { if (t && !out.includes(t)) out.push(t); };
  Object.entries(FURUSATO_CATEGORY_TAGS).forEach(([k, tags]) => { if (topic.includes(k)) tags.forEach(add); });
  (Array.isArray(aiTags) ? aiTags : []).map(normalizeTag).filter((t) => t && !FURUSATO_NG.test(t) && !ACCOUNT_TAGS.includes(t)).slice(0, 6).forEach(add);
  FURUSATO_TAGS.forEach(add);
  return out.slice(0, MAX_TAGS - ACCOUNT_TAGS.length).concat(ACCOUNT_TAGS);
}
