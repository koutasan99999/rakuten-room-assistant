// 新作・予約・再販レーダー：「今まさに動いている商品」を集めて、状態（NEW・予約・再販など）と日付を付ける。
//
// 取得元は差し替えられる形にしてある（SOURCES）。今は楽天市場の商品検索APIだけ。
// ZOZOTOWN・公式サイト・ニュースリリースなどは公開APIがないため、追加するときは SOURCES に取得元を足す。
// 日付は商品名・説明文に書いてあるものだけを読む。書いていない日付は作らない。
import { searchRaw, nameKey } from './rakuten.js';
import { RADAR_GENRES, findRadarGenre } from './radar-genres.js';

export const STATUS = {
  NEW: '新発売',
  COMING_SOON: '発売予定',
  PRE_ORDER: '予約受付中',
  RESTOCK: '再販・再入荷',
  LIMITED: '限定',
  COLLAB: 'コラボ',
  NEW_COLOR: '新色',
  SPECIAL: '特別販売・期間限定'
};

// 何を探すか（ジャンルの言葉と組み合わせる）
export const QUERY_TYPES = ['予約', '新作', '発売予定', '再販', '限定', 'コラボ', '新色'];

// 商品として紹介しないもの（予約販売・限定品はレーダーでは残す）
const EXCLUDE_RE = /ふるさと納税|返礼品|寄附|寄付|定期便|自治体|業務用|中古|レンタル|オリパ|お試し券|商品券|ギフト券|送料のみ|訳あり|ジャンク/;

const MAX_QUERIES = 18;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 状態（ステータス）の判定 ----
const RULES = [
  ['PRE_ORDER', /予約|先行受注|受注生産|先行販売/],
  ['COMING_SOON', /発売予定|入荷予定|発送予定|出荷予定|お届け予定|近日発売|順次発送|頃発送|発売日未定/],
  // 「NEW」は大文字で単独のときだけ（New Balance などのブランド名を拾わない）
  ['NEW', /新作|新商品|新発売|新製品|ニューモデル|最新モデル|(?:^|[^A-Za-z])NEW(?![A-Za-z])|20[2-3]\d年?(春夏|秋冬|モデル|新作)/],
  ['RESTOCK', /再販|再入荷|再生産|復刻/],
  ['COLLAB', /コラボ|別注|collaboration|\S+×\S+/i],
  ['NEW_COLOR', /新色|新カラー|NEW\s?COLOR/i],
  ['SPECIAL', /期間限定|特別販売|特別価格|記念モデル|アニバーサリー/]
];

export function detectStatus(text, dates = {}, now = new Date()) {
  const s = String(text || '');
  const out = RULES.filter(([, re]) => re.test(s)).map(([k]) => k);
  // 「限定」は、期間限定（特別販売）だけのときは付けない
  if (/限定/.test(s.replace(/期間限定/g, ''))) out.push('LIMITED');
  // 発売日が先なら「発売予定」
  if (!out.includes('COMING_SOON') && dates.releaseDate && dates.releaseDate > isoDate(now)) out.push('COMING_SOON');
  return [...new Set(out)];
}

// ---- 日付の読み取り（書いてあるものだけ） ----
function toHalf(s) {
  return String(s || '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/[／]/g, '/').replace(/[～〜~]/g, '〜');
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 年が書いていないときは、今日から見て一番近い年にする（2か月以上前の月なら来年）
function yearFor(month, now) {
  const m = now.getMonth() + 1;
  return month < m - 2 ? now.getFullYear() + 1 : now.getFullYear();
}

function makeDate(y, m, d, now) {
  const month = Number(m);
  const day = Number(d);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const year = y ? Number(y) : yearFor(month, now);
  if (year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const DATE = String.raw`(?:(20\d{2})[年/.\-])?(\d{1,2})[月/.\-](\d{1,2})日?`;
const PART = String.raw`(?:(20\d{2})年)?(\d{1,2})月(上旬|中旬|下旬|末|頃|中)`;

export function parseDates(text, now = new Date()) {
  const s = toHalf(text);
  const out = {};
  // 予約期間：「予約受付期間：10/1〜10/31」「予約開始 2026年10月1日」「予約締切 11/5」
  let m = s.match(new RegExp(`予約[^。\\n]{0,8}?[:：]?\\s*${DATE}\\s*(?:\\(.\\))?\\s*(?:\\d{1,2}:\\d{2})?\\s*(?:〜|から|-)\\s*${DATE}`));
  if (m) {
    out.preorderStart = makeDate(m[1], m[2], m[3], now);
    out.preorderEnd = makeDate(m[4] || m[1], m[5], m[6], now);
  }
  if (!out.preorderStart) {
    m = s.match(new RegExp(`予約(?:受付)?開始[^。\\n]{0,4}?[:：]?\\s*${DATE}`));
    if (m) out.preorderStart = makeDate(m[1], m[2], m[3], now);
  }
  if (!out.preorderEnd) {
    m = s.match(new RegExp(`予約(?:受付)?(?:締切|締め切り|終了)[^。\\n]{0,4}?[:：]?\\s*${DATE}`)) || s.match(new RegExp(`${DATE}\\s*(?:まで|迄)[^。\\n]{0,6}予約`));
    if (m) out.preorderEnd = makeDate(m[1], m[2], m[3], now);
  }
  // 発売日・再販日：「2026年11月20日発売」「11/20頃発送予定」「発売日：2026.11.20」
  const after = String.raw`\s*(?:\(.\))?\s*(?:頃|ごろ|以降)?\s*(?:より|から)?\s*(?:順次)?\s*(発売|入荷|発送|出荷|お届け|再販|再入荷)`;
  m = s.match(new RegExp(`${DATE}${after}`)) || s.match(new RegExp(`(?:発売日|発売予定日|発送予定日|入荷予定日)[:：]?\\s*${DATE}()`));
  if (m) {
    const d = makeDate(m[1], m[2], m[3], now);
    if (d) {
      if (/再販|再入荷/.test(m[4] || '')) out.restockDate = d;
      else out.releaseDate = d;
      out.releaseText = m[0].trim().slice(0, 24);
    }
  }
  // 「11月下旬発売予定」のように日付まで書いていないときは、書いてあるとおりの文字だけ残す
  if (!out.releaseDate && !out.restockDate) {
    m = s.match(new RegExp(`${PART}${after}`));
    if (m) {
      const year = m[1] ? Number(m[1]) : yearFor(Number(m[2]), now);
      out.releaseMonth = `${year}-${String(m[2]).padStart(2, '0')}`;
      out.releaseText = m[0].trim().slice(0, 24);
    } else if (/発売日未定|近日発売/.test(s)) {
      out.releaseText = s.match(/発売日未定|近日発売/)[0];
    }
  }
  return out;
}

// ---- ブランドの見つけ方：おすすめブランド・フォロー中のブランドが商品名にあれば、そのブランド ----
const ALL_BRANDS = [...new Set(RADAR_GENRES.flatMap((g) => g.brands))];

export function detectBrand(name, followed = []) {
  const s = String(name || '').toLowerCase();
  const list = [...followed, ...ALL_BRANDS].filter(Boolean).sort((a, b) => b.length - a.length);
  return list.find((b) => s.includes(b.toLowerCase())) || '';
}

// ---- 1商品の形（保存する項目と同じ） ----
function toRadarItem(it, { genre, query, followed, now }) {
  const text = `${it.name} ${String(it.caption || '').slice(0, 500)}`;
  const dates = parseDates(text, now);
  const status = detectStatus(text, dates, now);
  if (!status.length) return null;
  const brand = detectBrand(it.name, followed);
  return {
    productId: `rakuten:${nameKey(it.name)}`,
    code: it.code,
    name: it.name,
    brand,
    category: genre.id,
    categoryLabel: genre.label,
    price: it.price,
    imageUrl: it.image,
    status,
    releaseDate: dates.releaseDate || null,
    releaseMonth: dates.releaseMonth || (dates.releaseDate ? dates.releaseDate.slice(0, 7) : null),
    releaseText: dates.releaseText || '',
    preorderStart: dates.preorderStart || null,
    preorderEnd: dates.preorderEnd || null,
    restockDate: dates.restockDate || null,
    source: 'rakuten',
    sourceLabel: '楽天市場',
    sourceUrl: it.url,
    rakutenUrl: it.url,
    shops: [{ name: it.shop, url: it.url, price: it.price }],
    followedBrand: !!(brand && followed.some((b) => b.toLowerCase() === brand.toLowerCase())),
    query
  };
}

// 同じ商品が別のショップにもあるときは1つにまとめ、販売先を並べる（一番安い価格を表示）
export function mergeItems(items) {
  const byId = new Map();
  for (const it of items) {
    const cur = byId.get(it.productId);
    if (!cur) { byId.set(it.productId, { ...it, shops: [...it.shops] }); continue; }
    for (const s of it.shops) if (!cur.shops.some((x) => x.url === s.url)) cur.shops.push(s);
    if (it.price && it.price < cur.price) { cur.price = it.price; cur.rakutenUrl = it.rakutenUrl; cur.sourceUrl = it.sourceUrl; }
    cur.status = [...new Set([...cur.status, ...it.status])];
    for (const k of ['releaseDate', 'releaseMonth', 'releaseText', 'preorderStart', 'preorderEnd', 'restockDate']) if (!cur[k] && it[k]) cur[k] = it[k];
  }
  return [...byId.values()];
}

// 注目度：状態の数・日付が分かる・フォロー中のブランド・予約の締切が近い、など
export function scoreItem(it, now = new Date()) {
  let s = it.status.length;
  if (it.followedBrand) s += 3;
  if (it.brand) s += 1;
  if (it.releaseDate || it.preorderEnd) s += 1;
  if (it.status.includes('PRE_ORDER') || it.status.includes('COMING_SOON')) s += 1;
  if (it.preorderEnd) {
    const days = (new Date(it.preorderEnd) - now) / 86400000;
    if (days >= 0 && days <= 7) s += 2;
  }
  if (it.shops.length > 1) s += 1;
  return s;
}

// ---- 取得元 ----
// 取得元を足すときは、{ id, label, search({ keyword, env, referer }) → 商品の配列 } を加える
export const SOURCES = [
  {
    id: 'rakuten',
    label: '楽天市場',
    async search({ keyword, env, referer }) {
      const r = await searchRaw({ keyword, env, referer, hits: 30, sort: '-updateTimestamp' });
      return r.items.filter((it) => it && it.name && it.price > 0 && /^https:\/\//.test(it.url) && !EXCLUDE_RE.test(it.name));
    }
  }
];

// 今回の巡回で使う検索語：ジャンルごとに探し方を2つ（回すたびに変える）＋フォロー中のブランド
export function planQueries({ genres = [], brands = [], round = 0 }) {
  const list = genres.map(findRadarGenre).filter(Boolean).slice(0, 6);
  const queries = [];
  list.forEach((g, i) => {
    const a = QUERY_TYPES[(round * 2 + i) % QUERY_TYPES.length];
    const b = QUERY_TYPES[(round * 2 + i + 3) % QUERY_TYPES.length];
    queries.push({ genre: g, keyword: `${g.keyword} ${a}`, type: a });
    queries.push({ genre: g, keyword: `${g.keyword} ${b}`, type: b });
  });
  brands.slice(0, 5).forEach((brand, i) => {
    const t = ['新作', '予約', '再販', 'コラボ'][(round + i) % 4];
    // ブランドのジャンルが分かれば、そのジャンルとして扱う
    const g = RADAR_GENRES.find((x) => x.brands.some((b) => b.toLowerCase() === brand.toLowerCase())) || list[0] || RADAR_GENRES[0];
    queries.push({ genre: g, keyword: `${brand} ${t}`, type: t, brand });
  });
  return queries.slice(0, MAX_QUERIES);
}

// 1つのブランドだけを詳しく探す（新作・予約・再販・コラボ）。フォローの設定とは別に使う
export function planBrandQueries(brand) {
  const g = RADAR_GENRES.find((x) => x.brands.some((b) => b.toLowerCase() === brand.toLowerCase())) || RADAR_GENRES[0];
  return ['新作', '予約', '再販', 'コラボ'].map((t) => ({ genre: g, keyword: `${brand} ${t}`, type: t, brand }));
}

export async function scanRadar({ genres, brands = [], round = 0, brand = '', env, referer, until = Date.now() + 45000, now = new Date() }) {
  const queries = brand ? planBrandQueries(brand) : planQueries({ genres, brands, round });
  const found = [];
  const scanned = [];
  let lastError = null;
  for (const [i, q] of queries.entries()) {
    if (i > 0) {
      if (Date.now() + 1100 > until) break; // 時間切れになりそうなら、そこまでの結果で返す
      await sleep(1100); // 楽天APIは1秒1リクエストまで
    }
    for (const src of SOURCES) {
      try {
        const items = await src.search({ keyword: q.keyword, env, referer });
        const radar = items.map((it) => toRadarItem(it, { genre: q.genre, query: q.keyword, followed: brands, now })).filter(Boolean);
        found.push(...radar);
        scanned.push({ genre: q.genre.id, keyword: q.keyword, source: src.id, count: radar.length });
      } catch (e) {
        lastError = e;
        scanned.push({ genre: q.genre.id, keyword: q.keyword, source: src.id, count: 0, error: e.message });
        if (/40[13]/.test(e.message)) return { items: mergeItems(found), scanned, lastError };
      }
    }
  }
  const items = mergeItems(found).map((it) => ({ ...it, score: scoreItem(it, now) }));
  return { items, scanned, lastError };
}
