// 商品の分析：商品名から「ブランド・コラボ相手・商品の種類・型番・色・特徴」を分けて取り出す。
// 関連商品を探すときに、起点の商品名やコラボ名をまるごと検索語に入れないための部品（AIは使わない）。
// 同じ商品の別ショップ掲載・表記ゆれを見分けるキー（productKey / isSameProduct）もここに置く。
import { RADAR_GENRES } from './radar-genres.js';
import { CATALOG } from './catalog.js';

// ---- ブランド（英字の正式名と、商品名に出やすいカタカナ表記） ----
const ALIASES = {
  'New Balance': ['ニューバランス', 'newbalance'],
  NIKE: ['ナイキ'],
  adidas: ['アディダス'],
  ASICS: ['アシックス'],
  'Onitsuka Tiger': ['オニツカタイガー', 'onitsukatiger'],
  VANS: ['バンズ', 'ヴァンズ'],
  CONVERSE: ['コンバース'],
  PUMA: ['プーマ'],
  Reebok: ['リーボック'],
  HOKA: ['ホカ', 'ホカオネオネ'],
  Salomon: ['サロモン'],
  'THE NORTH FACE': ['ノースフェイス', 'ザ・ノース・フェイス', 'ザノースフェイス', 'northface'],
  Patagonia: ['パタゴニア'],
  'Snow Peak': ['スノーピーク', 'snowpeak'],
  Coleman: ['コールマン'],
  Champion: ['チャンピオン'],
  BEAMS: ['ビームス'],
  'UNITED ARROWS': ['ユナイテッドアローズ'],
  SHIPS: ['シップス'],
  'URBAN RESEARCH': ['アーバンリサーチ'],
  'JOURNAL STANDARD': ['ジャーナルスタンダード'],
  "FREAK'S STORE": ['フリークスストア'],
  Supreme: ['シュプリーム'],
  'Stussy': ['ステューシー', 'stüssy'],
  Carhartt: ['カーハート'],
  "Levi's": ['リーバイス'],
  UNIQLO: ['ユニクロ'],
  PORTER: ['ポーター', '吉田カバン'],
  Herschel: ['ハーシェル'],
  MANHATTAN_PORTAGE: ['マンハッタンポーテージ', 'manhattan portage'],
  Anker: ['アンカー'],
  KINTO: ['キントー'],
  BALMUDA: ['バルミューダ'],
  Apple: ['アップル'],
  Sony: ['ソニー'],
  Dyson: ['ダイソン'],
  Panasonic: ['パナソニック'],
  SEIKO: ['セイコー'],
  CASIO: ['カシオ'],
  'G-SHOCK': ['ジーショック', 'gショック'],
  CITIZEN: ['シチズン'],
  THERMOS: ['サーモス'],
  STANLEY: ['スタンレー'],
  marimekko: ['マリメッコ'],
  iittala: ['イッタラ'],
  ARABIA: ['アラビア'],
  'Ray-Ban': ['レイバン'],
  Disney: ['ディズニー'],
  Sanrio: ['サンリオ'],
  'Hello Kitty': ['ハローキティ', 'キティ'],
  Pokemon: ['ポケモン', 'ポケットモンスター', 'pokémon'],
  PEANUTS: ['スヌーピー', 'snoopy'],
  Miffy: ['ミッフィー'],
  Moomin: ['ムーミン'],
  'Sesame Street': ['セサミストリート'],
  Starbucks: ['スターバックス', 'スタバ'],
  MLB: [],
  NBA: [],
  'New Era': ['ニューエラ', 'newera'],
  KITH: ['キス'],
  'Aimé Leon Dore': ['エメレオンドレ', 'aime leon dore'],
  JJJJound: ['ジョウンド'],
  'Dr.Martens': ['ドクターマーチン', 'drmartens'],
  BIRKENSTOCK: ['ビルケンシュトック', 'ビルケン'],
  Crocs: ['クロックス'],
  'L.L.Bean': ['エルエルビーン', 'llbean'],
  Barbour: ['バブアー'],
  Arcteryx: ["arc'teryx", 'アークテリクス'],
  Montbell: ['モンベル', 'mont-bell'],
  Gregory: ['グレゴリー'],
  CASETiFY: ['ケースティファイ'],
  Logicool: ['ロジクール', 'logitech']
};
// 「キス」のように一般語と重なる短いカタカナは、誤検出しやすいので商品名からの検出には使わない
const WEAK_ALIASES = new Set(['キス', 'キティ']);

function displayName(key) {
  return key === 'MANHATTAN_PORTAGE' ? 'Manhattan Portage' : key;
}

const BASE_BRANDS = [
  ...RADAR_GENRES.flatMap((g) => g.brands),
  ...CATALOG.flatMap((c) => c.brands || []),
  ...Object.keys(ALIASES).map(displayName)
];

// 比べやすい形にする：全角→半角、小文字、記号・空白を消す
export function norm(s) {
  return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[\s　・\-_.'’!！]/g, '');
}

// { name: 正式名, forms: [比べる形…] } の一覧（長い名前から先に見る）
const BRANDS = (() => {
  const map = new Map();
  for (const b of BASE_BRANDS) {
    const n = norm(b);
    if (n.length < 2 || map.has(n)) continue;
    map.set(n, { name: b, forms: new Set([n]) });
  }
  for (const [key, list] of Object.entries(ALIASES)) {
    const entry = map.get(norm(displayName(key)));
    if (!entry) continue;
    for (const a of list) if (!WEAK_ALIASES.has(a)) entry.forms.add(norm(a));
  }
  return [...map.values()].map((x) => ({ name: x.name, forms: [...x.forms] }))
    .sort((a, b) => Math.max(...b.forms.map((f) => f.length)) - Math.max(...a.forms.map((f) => f.length)));
})();

export function findBrand(text) {
  const s = norm(text);
  if (!s) return null;
  for (const b of BRANDS) if (b.forms.some((f) => s.includes(f))) return b;
  return null;
}

// 商品名に出てくるブランドを、出てくる順にすべて（同じブランドの表記ゆれは1つ）
export function allBrands(text) {
  const s = norm(text);
  const hits = [];
  for (const b of BRANDS) {
    let at = -1;
    let len = 0;
    for (const f of b.forms) { const i = s.indexOf(f); if (i !== -1 && (at === -1 || i < at)) { at = i; len = f.length; } }
    // 長いブランド名の一部（例: THE NORTH FACE の中の別ブランド）は数えない
    if (at !== -1 && !hits.some((h) => at >= h.at && at < h.end)) hits.push({ name: b.name, at, end: at + len });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name);
}

// 正式名・カタカナ表記など、そのブランドが商品名に出るときの形
export function brandForms(name) {
  const n = norm(name);
  if (!n) return [];
  const b = BRANDS.find((x) => x.forms.includes(n));
  return b ? b.forms : [n];
}

// 楽天の除外キーワード（NGKeyword）に渡す形：空白を含まない表記だけ（空白があると別々の言葉として除外されてしまう）
export function brandNgWords(brand) {
  if (!brand) return [];
  const key = Object.keys(ALIASES).find((k) => norm(displayName(k)) === norm(brand));
  const list = [brand, ...(key ? ALIASES[key] : [])].filter((w) => !WEAK_ALIASES.has(w) && w.length >= 2 && !/\s/.test(w) && !/^[a-z]+$/.test(w));
  return [...new Set(list)].slice(0, 3);
}

// 商品名にそのブランドが入っているか（表記ゆれ込み）
export function hasBrand(text, brand) {
  const s = norm(text);
  return !!brand && brandForms(brand).some((f) => f.length >= 2 && s.includes(f));
}

// ---- 商品の種類（長い言葉を優先して1つ選ぶ） ----
const KINDS = [
  'ランニングシューズ', 'ウォーキングシューズ', 'スニーカー', 'スリッポン', 'ローファー', 'サンダル', 'スリッパ', 'ブーツ', 'パンプス', 'シューズ',
  'ロングTシャツ', 'ロンT', 'Tシャツ', 'パーカー', 'スウェット', 'トレーナー', 'ニット', 'カーディガン', 'シャツ', 'ブラウス',
  'ダウンジャケット', 'ジャケット', 'コート', 'ベスト', 'ジーンズ', 'デニム', 'パンツ', 'スカート', 'ワンピース',
  'キャップ', 'ニット帽', 'ビーニー', 'バケットハット', 'ハット', '帽子', 'ソックス', '靴下', 'マフラー', '手袋',
  'バックパック', 'リュック', 'トートバッグ', 'ショルダーバッグ', 'ボディバッグ', 'ウエストバッグ', 'サコッシュ', 'ボストンバッグ', 'スーツケース', 'バッグ',
  '長財布', 'ミニ財布', '二つ折り財布', '財布', 'キーケース', 'カードケース', 'パスケース', 'ポーチ', 'キーホルダー', 'キーリング',
  '腕時計', 'スマートウォッチ', 'ネックレス', 'ピアス', 'イヤリング', 'リング', 'ブレスレット', 'サングラス', 'メガネ', '眼鏡', '傘',
  'タンブラー', 'マグカップ', 'マグ', 'グラス', '小皿', 'プレート', 'ボウル', 'カトラリー', '水筒', 'ボトル', '弁当箱', '保存容器',
  '電気ケトル', 'ケトル', 'トースター', 'コーヒーメーカー', 'ドライヤー', 'ヘアアイロン', '加湿器', '空気清浄機', '掃除機', '扇風機', 'サーキュレーター', 'ヒーター',
  'デスクライト', 'ランタン', 'ライト', 'ランプ', '照明',
  'ワイヤレス充電器', '充電器', 'モバイルバッテリー', 'ケーブル', 'ワイヤレスイヤホン', 'イヤホン', 'ヘッドホン', 'スピーカー', 'キーボード', 'マウス',
  'スマホケース', 'iPhoneケース', 'スマホスタンド', 'スマホショルダー',
  'バスタオル', 'タオル', 'ハンカチ', 'スタイ', 'ブランケット', 'クッション', '枕', 'パジャマ',
  '香水', 'フレグランス', 'ハンドクリーム', 'リップ', 'ノート', 'ボールペン', 'ペン', '手帳', 'ぬいぐるみ', 'フィギュア', 'ステッカー', 'チェア', 'テント'
].sort((a, b) => b.length - a.length);

// 種類 → 同じジャンルの広い言葉（「同じジャンルの他ブランド」で結果が少ないときにゆるめる先）
const BROADER = [
  [/シューズ|スニーカー|スリッポン|ローファー|サンダル|ブーツ|パンプス/, 'シューズ'],
  [/Tシャツ|ロンT|パーカー|スウェット|トレーナー|ニット|カーディガン|シャツ|ブラウス|ジャケット|コート|ベスト|ジーンズ|デニム|パンツ|スカート|ワンピース/, 'ウェア'],
  [/キャップ|帽子|ハット|ビーニー/, '帽子'],
  [/バッグ|リュック|バックパック|サコッシュ|スーツケース/, 'バッグ'],
  [/財布|ケース|ポーチ|キーホルダー|キーリング/, '小物'],
  [/タンブラー|マグ|グラス|皿|プレート|ボウル|カトラリー|水筒|ボトル|弁当箱|容器/, 'キッチン雑貨'],
  [/充電器|バッテリー|ケーブル|イヤホン|ヘッドホン|スピーカー|キーボード|マウス|スマホ|iPhone/, 'ガジェット']
];

export function findKind(text) {
  const s = String(text || '').normalize('NFKC');
  const lower = s.toLowerCase();
  for (const k of KINDS) if (lower.includes(k.toLowerCase())) return k;
  return '';
}

export function broaderKind(kind) {
  const hit = BROADER.find(([re]) => re.test(kind));
  return hit ? hit[1] : '';
}

// ---- 色（1つの商品に1色だけ書いてあるときだけ「色」として扱う。全色まとめた掲載は色なし） ----
const COLORS = [
  ['ブラック', /ブラック|黒|black|blk/i], ['ホワイト', /ホワイト|白|white|wht/i], ['グレー', /グレー|グレイ|gr[ae]y/i],
  ['ネイビー', /ネイビー|紺|navy/i], ['ベージュ', /ベージュ|beige/i], ['ブラウン', /ブラウン|茶|brown/i],
  ['グリーン', /グリーン|緑|green/i], ['カーキ', /カーキ|khaki/i], ['オリーブ', /オリーブ|olive/i], ['レッド', /レッド|赤|red\b/i],
  ['ピンク', /ピンク|pink/i], ['ブルー', /ブルー|青|blue/i], ['イエロー', /イエロー|黄|yellow/i], ['オレンジ', /オレンジ|orange/i],
  ['パープル', /パープル|紫|purple/i], ['アイボリー', /アイボリー|ivory/i], ['シルバー', /シルバー|silver/i], ['ゴールド', /ゴールド|gold/i],
  ['クリーム', /クリーム|cream/i], ['チャコール', /チャコール|charcoal/i], ['ミント', /ミント|mint/i], ['ラベンダー', /ラベンダー|lavender/i]
];

export function findColors(text) {
  const s = String(text || '').normalize('NFKC');
  return COLORS.filter(([, re]) => re.test(s)).map(([c]) => c);
}

// ---- 特徴・用途の言葉（似たデザイン・用途で探すときに使う） ----
const FEATURES = ['防水', '撥水', '軽量', '大容量', '折りたたみ', 'ワイヤレス', 'コードレス', '急速充電', 'マグネット', '保温', '保冷', '抗菌',
  '本革', 'レザー', 'スエード', 'キャンバス', 'ナイロン', 'ウール', 'コットン', 'リネン', 'ステンレス', '木製', 'ガラス', '陶器', '琺瑯',
  '厚底', 'レトロ', 'ヴィンテージ', '北欧', 'ミニ', 'コンパクト', 'ユニセックス', '通勤', '旅行', 'キャンプ', 'アウトドア', 'ランニング', 'ゴルフ', 'ギフト'];

export function findFeatures(text) {
  const s = String(text || '').normalize('NFKC');
  return FEATURES.filter((f) => s.includes(f)).slice(0, 4);
}

// ---- 型番（英字＋数字。容量・サイズ・電力などの単位は除く） ----
const UNIT_RE = /^(\d+)(ml|l|mah|cm|mm|m|gb|tb|w|v|kg|g|cc|号|個|枚|足|本|色|点|才|歳|代|年|月|日|円|%|インチ|inch|in|p|pcs|s|xl|l)$/i;

export function findModels(text) {
  const s = String(text || '').normalize('NFKC').toUpperCase();
  const out = [];
  const re = /(?<![A-Z0-9])([A-Z]{1,6}[-]?\d{2,5}[A-Z0-9]{0,4}|\d{3,5}[A-Z]{1,3})(?![A-Z0-9])/g;
  let m;
  while ((m = re.exec(s))) {
    const v = m[1].replace(/-/g, '');
    if (UNIT_RE.test(v.toLowerCase())) continue;
    if (/^(US|UK|EU|JP|SIZE|NO|VOL|TYPE|VER|COL|SS|AW|FW)\d/.test(v)) continue; // サイズ表記・シーズン
    if (/^20\d{2}(SS|AW|FW)?$/.test(v)) continue; // 年
    if (!out.includes(v)) out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}

// ---- コラボの見つけ方：「A × B」「A x B」「A コラボ B」「A別注」「A for B」 ----
const COLLAB_SEP = /\s*[×✕✖╳]\s*|\s+[xX]\s+|\s*コラボ(?:レーション)?\s*|\s+collaboration\s+|\s+collab\s+/;
const COLLAB_RE = /[×✕✖╳]|\s[xX]\s|コラボ|別注|collab|for\s+[A-Z]/i;

export function looksCollab(text) {
  return COLLAB_RE.test(String(text || '').normalize('NFKC'));
}

// 区切りの左右にある「名前っぽい部分」（英字・カタカナの連なり、最大3語）
function sideName(chunk, fromEnd) {
  const words = String(chunk || '').replace(/[【】\[\]（）()「」『』〈〉<>]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const pick = fromEnd ? words.slice(-3) : words.slice(0, 3);
  // ブランド名として知っているものがあれば、それを使う
  const known = findBrand(pick.join(' '));
  if (known) return known.name;
  const w = fromEnd ? pick[pick.length - 1] : pick[0];
  if (!w || findKind(w) || findColors(w).length || /^(別注|限定|モデル|新作|メンズ|レディース|キッズ)$/.test(w)) return '';
  return /^[A-Za-z0-9&.'゠-ヿ・ー]{2,20}$/.test(w) ? w : '';
}

const PROMO_WORDS = /送料無料|ポイント\d*倍|ポイントアップ|クーポン(利用で|対象)?|正規品|日本正規|国内正規|公式|即納|即日発送|あすつく|あす楽|楽天\d*位|ランキング\d*位|\d+%OFF|SALE|セール|在庫あり|在庫限り|翌日配送|返品OK|交換OK|期間限定価格|\d+円OFF|母の日|父の日|プレゼント|ギフト対応|ラッピング(無料|可)?/gi;

const PROMO_TEST = new RegExp(PROMO_WORDS.source, 'i');

export function stripPromo(name) {
  return String(name || '').normalize('NFKC')
    .replace(/[【\[]([^】\]]*)[】\]]/g, (m, inner) => (PROMO_TEST.test(inner) || /^\s*$/.test(inner) ? ' ' : ` ${inner} `))
    .replace(PROMO_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 起点の商品を分析する。product: { name, brand?, price?, caption?, categoryLabel? }
export function analyzeProduct(product) {
  const p = product || {};
  const raw = String(p.name || '');
  const name = stripPromo(raw);
  const known = p.brand ? { name: p.brand } : findBrand(name);
  let brand = known ? known.name : '';
  let partner = '';
  let collab = false;

  const sep = name.match(COLLAB_SEP);
  if (sep) {
    const left = sideName(name.slice(0, sep.index), true);
    const right = sideName(name.slice(sep.index + sep[0].length), false);
    if (left && right && norm(left) !== norm(right)) {
      collab = true;
      if (brand && hasBrand(right, brand) && !hasBrand(left, brand)) partner = left;
      else if (brand && hasBrand(left, brand)) partner = right;
      else { brand = brand || left; partner = norm(right) === norm(brand) ? left : right; }
    }
  }
  // 「BEAMS別注」「ポケモン コラボ」：区切りが無くても、コラボの言葉があればコラボ。ブランドが2つあれば、もう1つが相手
  if (!collab && looksCollab(name)) collab = true;
  if (collab && !partner) {
    const other = allBrands(name).find((b) => norm(b) !== norm(brand));
    if (other && brand) partner = other;
    else if (other && !brand) brand = other;
  }
  if (!brand && partner) [brand, partner] = [partner, ''];

  // 種類が商品名に無いとき（英字の型番だけなど）は、ブランドのよくあるジャンル（レーダーのジャンル）で補う
  const brandGenre = brand ? RADAR_GENRES.find((g) => g.brands.some((b) => norm(b) === norm(brand))) : null;
  const kind = findKind(name) || findKind(p.caption) || (brandGenre ? findKind(brandGenre.keyword) || brandGenre.label : '');
  const colors = findColors(name);
  return {
    name: raw,
    brand,
    partner,
    collab,
    category: kind || String(p.categoryLabel || '').slice(0, 12),
    broader: broaderKind(kind) || String(p.categoryLabel || '').slice(0, 12),
    genre: String(p.categoryLabel || ''),
    models: findModels(name),
    color: colors.length === 1 ? colors[0] : '',
    features: findFeatures(`${name} ${p.caption || ''}`),
    price: Number(p.price) || 0
  };
}

// ---- 同じ商品の見分け方 ----
// 別ショップの掲載・表記ゆれは同じ商品として1つにまとめる。色違い・型番違い・数字（サイズや容量）違いは別の商品
function core(name) {
  return norm(stripPromo(name)).replace(/[【】\[\]（）()「」『』〈〉<>/／|｜:：,，、。~〜+＋#＃&＆*※★☆◆◇■□●○♪]/g, '');
}

function numbers(name) {
  return (stripPromo(name).normalize('NFKC').match(/\d+(\.\d+)?/g) || []).sort().join(',');
}

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function similarity(a, b) {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return a === b ? 1 : 0;
  let hit = 0;
  for (const g of x) if (y.has(g)) hit++;
  return (2 * hit) / (x.size + y.size);
}

function sig(item) {
  const name = String((item && item.name) || '');
  const colors = findColors(name);
  return {
    code: String((item && item.code) || ''),
    url: String((item && item.url) || '').replace(/[?#].*$/, ''),
    core: core(name),
    models: findModels(name).join(','),
    color: colors.length === 1 ? colors[0] : colors.length ? 'multi' : '',
    nums: numbers(name)
  };
}

export function productKey(item) {
  const s = sig(item);
  return s.models ? `m:${s.models}|${s.color}` : `n:${s.core.slice(0, 24)}|${s.color}|${s.nums}`;
}

export function isSameProduct(a, b) {
  const x = sig(a);
  const y = sig(b);
  if (x.code && x.code === y.code) return true;
  if (x.url && x.url === y.url) return true;
  if (x.color !== y.color) return false; // 色違いは別の商品
  if (x.models || y.models) return !!x.models && x.models === y.models; // 型番があれば型番で決める
  if (x.nums !== y.nums) return false; // サイズ・容量・番号違い
  if (x.core === y.core) return true;
  return similarity(x.core, y.core) >= 0.86;
}

// 一覧から同じ商品を除く。exclude（起点の商品・企画に入っている商品・表示済みの商品）と同じものも除く
export function dedupeProducts(items, exclude = []) {
  const kept = [];
  let dup = 0;
  for (const it of items) {
    if (exclude.some((e) => isSameProduct(it, e)) || kept.some((k) => isSameProduct(it, k))) { dup++; continue; }
    kept.push(it);
  }
  return { items: kept, dup };
}
