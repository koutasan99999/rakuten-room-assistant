// 「この商品を楽天で探す」ための検索と照合（商品ドロボー・社長、これどうすか？の初期候補で使う）。
// ブランド＋型番 → 型番だけ → ブランド＋主な言葉 → ブランドの別表記 → 情報の少ない言葉から外す → ブランド＋種類 → 種類＋主な言葉、の順に段階的に検索し、
// 見つかった商品を「同一商品（型番が一致）」「類似商品」「未確認」に分ける。画像は照合しない（写真が同じでも別の商品のことがあるため）。
// 2026-11-02 修正：ハイフン付き・数字だけの型番、辞書にないブランド（推定）、「〇〇風」「〇〇対応」のブランド誤検出、
// 言葉を外す順番（情報の少ない言葉から）、同じ型番の別ショップ・仕様違いをまとめすぎて候補が少なくなる問題。
import { searchPage } from './rakuten.js';
import { norm, findBrand, brandForms, mentionsBrand, findKind, findColors, stripPromo } from './product-analysis.js';

export const MATCH = { same: '同一商品', similar: '類似商品', unknown: '未確認' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 本体ではなく、対応品・付属品・消耗品であることを示す言葉（探している商品の名前に無いときだけ）
const ACCESSORY_WORDS = ['対応', '専用', 'ケース', 'カバー', 'フィルム', '保護', '交換用', '替え', '互換', 'ストラップ', '部品', 'パーツ', 'スキンシール', 'フィルター', 'パッキン', 'イヤーパッド', '焼き網', 'バッテリー', 'ペーパー'];
const NOISE_RE = /送料無料|正規品|公式|新作|新品|限定|人気|おすすめ|ギフト|プレゼント|メンズ|レディース|ユニセックス|即納|あす楽|ポイント\d*倍|\d+%OFF/gi;
// 型番ではない英数字（単位・容量・端末名・規格）
const UNIT_RE = /^\d+(\.\d+)?(MAH|ML|L|CM|MM|M|GB|TB|W|V|KG|G|CC|P|K|HZ|INCH|IN|PCS|個口?|枚|本|個|色|口)$/;
const NOT_MODEL_RE = /^(IPHONE|IPAD|PIXEL|GALAXY|XPERIA|AQUOS|USB|TYPE|WIFI|WI|BT|BLUETOOTH|HDMI|PS|SWITCH|ANDROID|IOS|MACBOOK|APPLEWATCH|4K|8K|5G|4G|3IN1|2IN1)\d*/;
// 型番の末尾の色の記号（「K11A-BK」「SM-ZB48-BA」）。これ以外の違いは仕様違いとみなす
const COLOR_CODES = new Set(['B', 'W', 'G', 'H', 'N', 'R', 'S', 'P', 'K', 'BK', 'WH', 'GR', 'GY', 'BL', 'RD', 'NV', 'BE', 'BR', 'PK', 'KM', 'BA', 'WA', 'HA', 'XA', 'SV']);
// 商品名の先頭に来ても、ブランドではない言葉（素材・機能・形容）
const NOT_BRAND_WORDS = /^(ワイヤレス|コードレス|ステンレス|シリコン|シリコーン|レザー|マグネット|おしゃれ|北欧|大容量|軽量|コンパクト|シンプル|充電式|電動|折りたたみ|ポータブル|スマート|ミニ|ビッグ|オーバーサイズ|ヴィンテージ|ビンテージ|ナチュラル|プレミアム|スリム|クリア|ホワイト|ブラック|グレー|ネイビー|ベージュ|ブラウン|メンズ|レディース|キッズ|ベビー|NEW|THE|USB|LED|PC|AI|iPhone|スマホ|日本製|国産|送料無料)$/i;
const ADJECTIVE_RE = /^(おしゃれ|北欧|大容量|軽量|コンパクト|シンプル|かわいい|可愛い|高級|人気|白|黒|厚底|充電式|卓上|デスク|小型|大型|長時間|静音|防水|超音波|本体|セット|単品)$/;
const words = (...xs) => xs.map((x) => String(x || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
const modelKey = (m) => String(m || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');

// 商品名から型番を1つ選ぶ（ハイフン・スラッシュ付きもそのまま。括弧の中の色の記号は外す）。
// 英字と数字が混ざった言葉を優先し、数字だけ（3〜4桁）はブランドのすぐ後ろにあるときだけ型番とみなす（例: New Balance 574）
export function extractModel(text, brand = '') {
  const tokens = String(text || '').normalize('NFKC').replace(/\([^)]{0,6}\)/g, '').split(/[\s【】\[\]（）「」『』、。,／|｜×]+/).filter(Boolean);
  let digitOnly = '';
  for (const [i, raw] of tokens.entries()) {
    const tok = raw.toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
    if (!/^[A-Z0-9]+(?:[-/][A-Z0-9]+)*$/.test(tok) || !/\d/.test(tok) || tok.length < 3 || tok.length > 22) continue;
    const key = modelKey(tok);
    if (UNIT_RE.test(key) || NOT_MODEL_RE.test(key) || /^\d+IN\d+$/.test(key) || /^20\d{2}(SS|AW|FW)?$/.test(key)) continue;
    if (/[A-Z]/.test(key)) return tok;
    if (!digitOnly && /^\d{3,4}$/.test(key) && brand && i > 0 && mentionsBrand(tokens.slice(0, i).join(' '), brand)) digitOnly = tok;
  }
  return digitOnly;
}

// 辞書にないブランドの推定：商品名の先頭の、英字の言葉か長めのカタカナの言葉（種類・色・素材・形容の言葉でなければ）
export function guessBrand(name) {
  const first = stripPromo(name).split(/\s+/)[0] || '';
  if (!first || NOT_BRAND_WORDS.test(first) || findKind(first) || findColors(first).length || /\d/.test(first)) return '';
  if (/^[A-Za-z][A-Za-z&.'-]{1,19}$/.test(first)) return first;
  if (/^[ァ-ヿ]{3,10}$/.test(first)) return first;
  return '';
}

// 探したい商品（Instagramで見た商品・社長が入力した商品）。name は必須、brand・model・aliases は分かれば
export function readTarget(x) {
  const t = x && typeof x === 'object' ? x : {};
  const s = (v, n) => String(v == null ? '' : v).normalize('NFKC').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const name = s(t.name, 120);
  const brandIn = s(t.brand, 40);
  const aliases = (Array.isArray(t.aliases) ? t.aliases : []).map((a) => s(a, 40)).filter(Boolean).slice(0, 5);
  const known = brandIn ? null : findBrand(name);
  const guessed = brandIn || known ? '' : guessBrand(name);
  const brand = brandIn || (known ? known.name : guessed);
  const model = s(t.model, 30).toUpperCase() || extractModel(name, brand);
  return { name, brand, brandGuessed: !!guessed, model, modelKey: modelKey(model), aliases };
}

// 言葉の情報の多さ（多いほど残す）：種類 > 英字の商品名（シリーズ名） > 長い言葉 > 色・形容・数量
function wordScore(w) {
  if (findKind(w)) return 5;
  if (/^[A-Za-z][A-Za-z0-9&.'-]+$/.test(w)) return 4;
  if (ADJECTIVE_RE.test(w) || findColors(w).length) return 1;
  if (/^\d+(\.\d+)?[a-zA-Zぁ-んァ-ヶ]*$/.test(w)) return 0;
  return w.length >= 4 ? 3 : 2;
}

// 商品名から、ブランド・型番・宣伝文句を除いた主な言葉（最大5語。元の並び順のまま）
export function coreWords(t) {
  let s = stripPromo(t.name).replace(NOISE_RE, ' ');
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const f of t.brand ? [t.brand, ...brandForms(t.brand)] : []) if (f.length >= 2) s = s.replace(new RegExp(esc(f), 'ig'), ' ');
  if (t.model) s = s.replace(new RegExp(esc(t.model).replace(/\\-|\//g, '[\\s\\-/]?'), 'ig'), ' ');
  // 「ナイキ風」「北欧系」は、検索語に入れても絞り込みにならない（その言葉で書かれた商品はほとんどない）
  return s.replace(/[「」『』"'、。,.!?！？()（）[\]【】/／|｜×]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !/^[-]+$/.test(w) && !/.(風|系|似|タイプ)$/.test(w)).slice(0, 5);
}

// 情報の多い言葉から n 個（元の並び順のまま）
function topWords(core, n) {
  const ranked = core.map((w, i) => ({ w, i, s: wordScore(w) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n);
  return ranked.sort((a, b) => a.i - b.i).map((x) => x.w);
}

// 検索語の段階（きつい順）。同じ言葉は1回だけ
export function queryLadder(t) {
  const core = coreWords(t);
  const kind = findKind(t.name);
  // ブランドの表記ゆれ（英字・カタカナ）。辞書にないブランドは入力のまま
  const brandVariants = t.brand ? [...new Set([t.brand, ...brandForms(t.brand).filter((f) => f.length >= 2 && !/^[a-z0-9]+$/.test(f))])].slice(0, 3) : [];
  const steps = [];
  if (t.model) {
    if (t.brand) steps.push({ keyword: words(t.brand, t.model), why: 'ブランド＋型番' });
    steps.push({ keyword: t.model, why: '型番だけ' });
    // 楽天の商品名では、ハイフンを省いて書かれていることもある
    if (t.modelKey !== t.model && t.modelKey.length >= 4) steps.push({ keyword: t.modelKey, why: '型番（記号なし）' });
  }
  if (t.brand && core.length) steps.push({ keyword: words(t.brand, topWords(core, 3).join(' ')), why: 'ブランド＋主な言葉' });
  for (const b of brandVariants.slice(1)) if (core.length) steps.push({ keyword: words(b, topWords(core, 2).join(' ')), why: 'ブランドの別の表記' });
  for (const a of t.aliases) steps.push({ keyword: a, why: '別名' });
  // 情報の少ない言葉（色・形容・数量）から外していく。種類だけの1語は最後に回す
  for (let n = Math.min(3, core.length); n >= 2; n--) steps.push({ keyword: topWords(core, n).join(' '), why: n === core.length ? '主な言葉' : '情報の少ない言葉を外して' });
  if (t.brand && kind) steps.push({ keyword: words(t.brand, kind), why: 'ブランド＋種類' });
  const notKind = core.filter((w) => !findKind(w));
  if (kind && notKind.length) steps.push({ keyword: words(topWords(notKind, 1)[0], kind), why: '種類＋主な言葉' });
  if (core.length === 1 || (!steps.length && core.length)) steps.push({ keyword: topWords(core, 1)[0], why: '主な言葉' });
  // 候補が少ないときの最後の手：種類だけ（ブランドが分からない商品で、似た商品を出すため）
  if (kind) steps.push({ keyword: kind, why: '種類だけ（似た商品）', broad: true });
  if (!steps.length && t.name) steps.push({ keyword: t.name.slice(0, 40), why: '商品名そのまま' });
  const seen = new Set();
  return steps.filter((s) => s.keyword && s.keyword.replace(/\s/g, '').length >= 2 && !seen.has(norm(s.keyword)) && seen.add(norm(s.keyword)));
}

// 型番の一致の度合い：exact（一致・色の記号違いを含む）／prefix（先頭だけ一致＝仕様違いの可能性）／series（数字だけの型番が、英字の付いた型番の数字と一致）
function modelMatch(t, text) {
  if (!t.modelKey) return { level: '', other: '' };
  const tokens = String(text || '').normalize('NFKC').toUpperCase().replace(/\([^)]{0,6}\)/g, ' ').split(/[\s【】\[\]（）「」『』、。,／|｜×]+/).filter(Boolean);
  let level = '';
  let hitTok = '';
  let other = '';
  for (const [i, raw] of tokens.entries()) {
    let k = modelKey(raw);
    // 「WH-1000XM5 B」のように、色の記号が1語として離れているとき
    if (!k) continue;
    const next = modelKey(tokens[i + 1] || '');
    if (k === t.modelKey || (k.startsWith(t.modelKey) && COLOR_CODES.has(k.slice(t.modelKey.length)))) return { level: 'exact', tok: raw };
    if (k.startsWith(t.modelKey) && /^[A-Z0-9]{1,6}$/.test(k.slice(t.modelKey.length)) && !/^\d/.test(k.slice(t.modelKey.length))) { level = level || 'prefix'; hitTok = hitTok || raw; continue; }
    if (/^\d{3,4}$/.test(t.modelKey) && /^[A-Z]{1,3}\d{3,4}$/.test(k) && k.endsWith(t.modelKey)) { level = level || 'series'; hitTok = hitTok || raw; continue; }
    if (!other && /[A-Z]/.test(k) && /\d/.test(k) && k.length >= 3 && !UNIT_RE.test(k) && !NOT_MODEL_RE.test(k) && !COLOR_CODES.has(next)) other = raw;
  }
  return { level, tok: hitTok, other };
}

// 楽天の商品が、探している商品と同じかを判定する。画像は使わない
export function classifyMatch(t, item) {
  const name = String(item.name || '');
  const text = `${name} ${String(item.caption || '').slice(0, 300)}`;
  // ブランド：辞書・入力のブランドは「入っていなければ違う」。推定したブランドは、入っていれば手がかり、無くても違うとは言わない
  const brandIn = t.brand ? mentionsBrand(name, t.brand) || mentionsBrand(String(item.shop || ''), t.brand) : null;
  const brandOk = t.brand && t.brandGuessed && !brandIn ? null : brandIn;
  const accessory = ACCESSORY_WORDS.find((w) => name.includes(w) && !t.name.includes(w) && !(w === 'バッテリー' && /バッテリー/.test(findKind(t.name))));
  const core = coreWords(t).map(norm);
  const n = norm(name);
  const hit = core.filter((w) => n.includes(w)).length;
  const overlap = core.length ? hit / core.length : 0;
  if (accessory) return { match: 'similar', note: `本体ではなく、対応品・付属品の可能性があります（「${accessory}」）` };
  const mm = modelMatch(t, text);
  if (mm.level === 'exact') {
    if (brandOk === false) return { match: 'similar', note: `型番 ${t.model} は同じですが、ブランドが確認できません` };
    return { match: 'same', note: `型番 ${t.model} が一致${brandIn ? '・ブランドも一致' : ''}（画像は照合していません）` };
  }
  if (mm.level === 'prefix') return { match: 'similar', note: `型番の先頭が一致（${mm.tok}）。仕様違い・別モデルの可能性があります` };
  if (mm.level === 'series') return { match: 'similar', note: `型番の数字が一致（${mm.tok}）。同じシリーズの別の型番の可能性があります` };
  if (t.model && mm.other) return { match: brandOk ? 'similar' : 'unknown', note: `型番が違います（${mm.other}）${brandOk ? '。同じブランドの別の商品の可能性' : ''}` };
  if (brandOk && overlap >= 0.5) return { match: 'similar', note: 'ブランドと名前の言葉は一致（型番では確認できないため、同一とは断定しません）' };
  if (brandOk) return { match: 'similar', note: '同じブランドの商品です（同じ商品かは未確認）' };
  if (overlap >= 0.67 && brandOk === null) return { match: 'similar', note: '名前の言葉は一致（ブランド・型番が分からないため未確認）' };
  return { match: 'unknown', note: '同じ商品かどうか確認できません' };
}

const RANK = { same: 0, similar: 1, unknown: 2 };

// 同じ商品の重複を除く：商品番号・URL・商品名がまったく同じものだけ（型番が同じでも、色・仕様違いは残す）
function dedupeExact(items) {
  const seen = new Set();
  return items.filter((it) => {
    const keys = [it.code && `c:${it.code}`, it.url && `u:${String(it.url).replace(/[?#].*$/, '')}`, `n:${norm(it.name)}`].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}
const wordSet = (k) => new Set(norm(k).length ? String(k).normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean) : []);

// 段階的に検索して、照合した結果を返す。
// 同一商品が見つかり、候補がある程度そろったら止める。前の検索で全件取れた（30件未満）言葉に言葉を足しただけの検索は、結果が増えないので飛ばす
export async function findOnRakuten({ target, env, referer, until = Date.now() + 25000, maxCalls = 5, want = 10, enough = 5 }) {
  const t = readTarget(target);
  const ladder = queryLadder(t);
  const tried = [];
  let found = [];
  let sameAt = -1;
  for (const step of ladder) {
    if (tried.length >= maxCalls || Date.now() + 1500 > until) break;
    const ws = wordSet(step.keyword);
    // 記号なしの型番は、記号ありの型番で見つからなかったときだけ
    if (step.why === '型番（記号なし）' && tried.some((p) => p.why === '型番だけ' && p.count > 0)) continue;
    // 種類だけの検索は、候補が少ないときだけ
    if (step.broad && found.length >= enough) continue;
    if (tried.some((p) => !p.error && p.count < 30 && [...wordSet(p.keyword)].every((w) => ws.has(w)))) continue;
    if (tried.length > 0) await sleep(1100); // 楽天APIは1秒1回まで
    try {
      const r = await searchPage({ keyword: step.keyword, env, referer, hits: 30 });
      tried.push({ ...step, count: r.items.length });
      found = dedupeExact(found.concat(r.items));
    } catch (e) {
      tried.push({ ...step, count: 0, error: e.message });
      if (/40[13]/.test(e.message)) break;
      continue;
    }
    const useful = found.filter((it) => classifyMatch(t, it).match !== 'unknown').length;
    // 同一商品が見つかったら、類似の候補を足すための検索をあと1回だけして止める（呼び出し回数を増やしすぎない）
    if (sameAt === -1 && found.some((it) => classifyMatch(t, it).match === 'same')) sameAt = tried.length;
    if (sameAt !== -1 && (useful >= enough || tried.length > sameAt)) break;
  }
  const items = found.map((it) => ({ ...it, caption: String(it.caption || '').slice(0, 200), ...classifyMatch(t, it) }))
    .sort((a, b) => RANK[a.match] - RANK[b.match])
    .slice(0, want);
  return { target: t, items, tried };
}

// 初期候補など、1回の検索結果から「探している商品らしいもの」を1つ選ぶ（未確認・付属品は選ばない）
export function bestMatch(target, items) {
  const t = readTarget(target);
  const ranked = items.map((it) => ({ it, ...classifyMatch(t, it) })).filter((x) => x.match !== 'unknown' && !/付属品/.test(x.note));
  ranked.sort((a, b) => RANK[a.match] - RANK[b.match]);
  return ranked[0] || null;
}
