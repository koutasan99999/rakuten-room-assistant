// Instagramのハッシュタグを組み立てる（15〜25個）。
// A: 大きなカテゴリ、B: テーマ別（ジャンルごと）、C: 検索意図、の3種類を混ぜ、
// アカウントのタグ（#ganka_kuma #眼科医くま）は必ず入れる。関係ないタグで数合わせはしない。
import { CATALOG } from './catalog.js';

export const ACCOUNT_TAGS = ['#ganka_kuma', '#眼科医くま'];
export const MIN_TAGS = 15;
export const MAX_TAGS = 25;

const CATEGORY_TAGS = ['#楽天ROOM', '#楽天購入品', '#おすすめ商品'];
// 暮らしまわりのジャンルだけに付ける大きなカテゴリ
const LIFE_TAGS = ['#便利グッズ', '#暮らしを整える'];
const LIFE_GENRES = ['disaster', 'useful', 'appliance', 'gadget', 'living', 'kitchen', 'travel'];

// テーマの文字からジャンルを見分けるための目印
const GENRE_HINTS = {
  disaster: /防災|災害|停電|断水|避難|備蓄|非常/,
  baby: /出産|ベビー|赤ちゃん|育児/,
  scent: /香水|フレグランス|香り|ルームフレグランス/,
  gift: /プレゼント|ギフト|贈り物|誕生日|お祝い/,
  gadget: /ガジェット|iPhone|充電|モバイルバッテリー|イヤホン|デスク/,
  kitchen: /食器|器|うつわ|キッチン|マグ|グラス/,
  travel: /旅行|旅|アウトドア|キャンプ/,
  living: /一人暮らし|寝具|インテリア|タオル/,
  fashion: /ファッション|財布|バッグ|服|コーデ/,
  stationery: /文房具|ペン|手帳|ノート/,
  appliance: /家電/,
  useful: /便利|収納|掃除|時短/
};

// 検索意図のタグ（企画の型・ジャンルに合わせて選ぶ）
function intentTags({ genreIds, postType, text }) {
  const tags = [];
  if (/まずこれ|まずコレ|最初|迷ったら|最低限|初心者/.test(`${postType} ${text}`)) tags.push('#まずこれ', '#迷ったらこれ', '#何を買えばいい');
  if (genreIds.includes('gift') || genreIds.includes('baby') || /プレゼント|ギフト/.test(postType)) tags.push('#プレゼント迷子', '#おすすめギフト');
  if (genreIds.some((g) => LIFE_GENRES.includes(g))) tags.push('#あると便利', '#生活便利グッズ');
  tags.push('#買ってよかった', '#何を買えばいい');
  return tags;
}

export function detectGenres({ genre = '', category = '', topic = '' }) {
  const ids = [];
  const named = CATALOG.find((c) => c.name === genre);
  if (named) ids.push(named.id);
  const text = `${topic} ${category} ${genre}`;
  for (const [id, re] of Object.entries(GENRE_HINTS)) {
    if (re.test(text) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

const GENERAL_TAGS = ['#本気出して考えてみた', '#楽天市場', '#楽天お買い物', '#選び方', '#買い物記録', '#暮らしの道具', '#ROOMに載せてます'];

const TAG_RE = /^#[\p{L}\p{N}_ー・]{1,30}$/u;

export function normalizeTag(t) {
  let s = String(t || '').trim().replace(/^＃/, '#').replace(/\s+/g, '');
  if (!s) return '';
  if (!s.startsWith('#')) s = '#' + s;
  return TAG_RE.test(s) ? s : '';
}

// aiTags: AIが投稿内容から考えたタグ（テーマ別・検索意図）。関係の薄いものが混ざらないよう個数は絞る
export function buildHashtags({ topic = '', category = '', genre = '', postType = '', aiTags = [] } = {}) {
  const genreIds = detectGenres({ genre, category, topic });
  const genres = genreIds.map((id) => CATALOG.find((c) => c.id === id)).filter(Boolean);
  const themeTags = genres.flatMap((g) => g.hashtags || []);
  const ai = (Array.isArray(aiTags) ? aiTags : []).map(normalizeTag).filter((t) => t && !ACCOUNT_TAGS.includes(t)).slice(0, 10);

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
