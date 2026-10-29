// Instagramのハッシュタグを組み立てる（15〜25個）。
// A: 大きなカテゴリ、B: テーマ別（ジャンルごと）、C: 検索意図、の3種類を混ぜ、
// アカウントのタグ（#ganka_kuma #眼科医くま）は必ず入れる。関係ないタグで数合わせはしない。
import { CATALOG } from './catalog.js';
import { allowTag, themeGenres, normalizeTag as ruleNormalize } from './tag-rules.js';

export const ACCOUNT_TAGS = ['#ganka_kuma', '#眼科医くま'];
export const MIN_TAGS = 15;
export const MAX_TAGS = 25;

const CATEGORY_TAGS = ['#楽天ROOM', '#楽天購入品', '#おすすめ商品'];
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
  tags.push('#買ってよかった', '#何を買えばいい');
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

const GENERAL_TAGS = ['#本気出して考えてみた', '#楽天市場', '#楽天お買い物', '#選び方', '#買い物記録', '#暮らしの道具', '#ROOMに載せてます'];

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

  const out = [];
  const add = (list) => list.forEach((t) => { if (t && !out.includes(t) && out.length < MAX_TAGS) out.push(t); });
  add(CATEGORY_TAGS);
  if (!genreIds.length || genreIds.some((g) => LIFE_GENRES.includes(g))) add(LIFE_TAGS);
  // 主ジャンルのテーマ別タグを優先し、AIのタグ、ほかのジャンル、検索意図の順で足す
  add((genres[0] && genres[0].hashtags) || []);
  add(ai.slice(0, 6));
  add(intentTags({ genreIds, postType, text: `${topic} ${category}` }));
  add(themeTags);
  add(ai);
  // それでも足りないときは、どの投稿にも当てはまる一般的なタグだけで補う
  for (const t of GENERAL_TAGS) {
    if (out.length >= MIN_TAGS - ACCOUNT_TAGS.length) break;
    add([t]);
  }
  // アカウントのタグは必ず最後に入れる
  out.splice(MAX_TAGS - ACCOUNT_TAGS.length);
  return out.concat(ACCOUNT_TAGS);
}

// ふるさと納税の投稿：ROOM・楽天購入品・お得の系統のタグは付けない（ROOMの対象か未確認、ポイント付与は原則対象外のため）
const FURUSATO_TAGS = ['#ふるさと納税', '#ふるさと納税返礼品', '#ふるさと納税おすすめ', '#返礼品'];
const FURUSATO_CATEGORY_TAGS = { 米: ['#お米', '#新米'], 肉: ['#お肉'], 海鮮: ['#海鮮'], 果物: ['#フルーツ'], お酒: ['#お酒'], 日用品: ['#日用品'], 家電: ['#家電'], 旅行: ['#旅行'], 定期便: ['#定期便'] };
const FURUSATO_NG = /ROOM|楽天購入|ポイント|お得|節税|還元|実質|プレゼント|ギフト|買ってよかった|本気出して/;
export function buildFurusatoHashtags({ topic = '', aiTags = [] } = {}) {
  const out = [...FURUSATO_TAGS];
  Object.entries(FURUSATO_CATEGORY_TAGS).forEach(([k, tags]) => { if (topic.includes(k)) tags.forEach((t) => { if (!out.includes(t)) out.push(t); }); });
  (Array.isArray(aiTags) ? aiTags : []).map(normalizeTag).filter((t) => t && !FURUSATO_NG.test(t) && !ACCOUNT_TAGS.includes(t) && !out.includes(t)).slice(0, 6).forEach((t) => out.push(t));
  return out.slice(0, 14).concat(ACCOUNT_TAGS);
}
