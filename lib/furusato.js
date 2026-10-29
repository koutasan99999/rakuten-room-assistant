// ふるさと納税コーナー：楽天ふるさと納税の返礼品を探して、比べやすい形にする。
// 表示する数値は、楽天の商品データ（商品名・説明・寄付額・レビュー）に書いてあるものだけ。読み取れなかった項目は空のまま（推測で補わない）。
// ポイント還元や節税額は扱わない（2025年10月から楽天ふるさと納税の寄付は原則ポイント付与の対象外。控除の上限は人によって違う）。
import { searchFurusatoPage } from './rakuten.js';

export const FURUSATO_CATEGORIES = {
  meat: { label: '肉', keyword: '肉' },
  seafood: { label: '海鮮', keyword: '海鮮' },
  rice: { label: '米', keyword: '米' },
  fruit: { label: '果物', keyword: 'フルーツ' },
  sake: { label: 'お酒', keyword: '酒' },
  daily: { label: '日用品', keyword: 'トイレットペーパー ティッシュ 洗剤' },
  appliance: { label: '家電', keyword: '家電' },
  travel: { label: '旅行・宿泊', keyword: '宿泊 旅行' },
  subscription: { label: '定期便', keyword: '定期便' },
  other: { label: 'その他', keyword: '' }
};
// 日用品などは「どれかの言葉」を含む商品を探したいので、言葉ごとに分けて1つ目だけ使う（楽天の検索はすべての言葉を含む商品になるため）
function categoryKeyword(c) { return (FURUSATO_CATEGORIES[c] || FURUSATO_CATEGORIES.other).keyword.split(' ')[0]; }

const FURUSATO_URL = /item\.rakuten\.co\.jp\/f\d{6}-/;
const FURUSATO_RE = /ふるさと納税|返礼品|寄附|寄付/;
export function isFurusatoItem(it) { return FURUSATO_URL.test(it.url || '') || FURUSATO_RE.test(it.name || ''); }

// 内容量：商品名（なければ説明の最初の方）に書いてある量。「500g×4」のような書き方は合計にする。
// 単位をそろえる（kg→g、L→ml）。決められないときは null
const UNIT = { kg: ['g', 1000], キロ: ['g', 1000], g: ['g', 1], グラム: ['g', 1], l: ['ml', 1000], リットル: ['ml', 1000], ml: ['ml', 1], 合: ['合', 1], 個: ['個', 1], 本: ['本', 1], 枚: ['枚', 1], 袋: ['袋', 1], パック: ['パック', 1], ロール: ['ロール', 1], 缶: ['缶', 1], 尾: ['尾', 1], 玉: ['玉', 1], 食: ['食', 1] };
const QTY_RE = /(\d+(?:\.\d+)?)\s*(kg|キロ|g|グラム|l|リットル|ml|合|個|本|枚|袋|パック|ロール|缶|尾|玉|食)(?:\s*[×xX＊*]\s*(\d+)\s*(?:袋|個|本|パック|缶|箱|セット|p|P)?)?/i;
export function parseQuantity(text) {
  const s = String(text || '').normalize('NFKC').replace(/,/g, '');
  const m = s.match(QTY_RE);
  if (!m) return null;
  const u = UNIT[m[2].toLowerCase()] || UNIT[m[2]];
  if (!u) return null;
  const n = parseFloat(m[1]) * u[1] * (m[3] ? parseInt(m[3], 10) : 1);
  if (!(n > 0)) return null;
  return { value: Math.round(n * 100) / 100, unit: u[0], text: m[0] };
}
export function quantityText(q) {
  if (!q) return '';
  if (q.unit === 'g' && q.value >= 1000) return `${Math.round(q.value / 100) / 10}kg`;
  if (q.unit === 'ml' && q.value >= 1000) return `${Math.round(q.value / 100) / 10}L`;
  return `${q.value}${q.unit}`;
}
// 寄付額1万円あたりの量（量が読み取れたときだけ）
export function perTenThousand(q, price) {
  if (!q || !(price > 0)) return null;
  return { value: Math.round((q.value * 10000 / price) * 10) / 10, unit: q.unit };
}

// 配送時期：説明に書いてある文をそのまま短く抜き出す（書いていなければ空）
const DELIVERY_RE = /((?:\d{4}年)?\d{1,2}月(?:上旬|中旬|下旬|頃|末)?(?:頃)?(?:より|から|以降)?[^。\n]{0,12}(?:発送|お届け|配送|出荷))|((?:入金|寄附|寄付|決済)(?:確認|完了)?後[^。\n]{0,24}(?:発送|お届け|配送|出荷))|(順次(?:発送|お届け|配送|出荷))/;
export function parseDelivery(text) {
  const m = String(text || '').normalize('NFKC').match(DELIVERY_RE);
  return m ? m[0].trim().slice(0, 40) : '';
}

export function parseTeiki(name) {
  const s = String(name || '').normalize('NFKC');
  if (!/定期便/.test(s)) return null;
  const m = s.match(/(\d+)\s*(?:回|ヶ月|か月|カ月)/);
  return { times: m ? Number(m[1]) : null };
}

// 自治体：楽天ふるさと納税の店舗名（例：「新潟県上越市」）をそのまま使う
export function toFurusatoItem(it, now = new Date()) {
  const q = parseQuantity(it.name) || parseQuantity(String(it.caption || '').slice(0, 300));
  return {
    code: it.code, name: it.name, price: it.price, url: it.url, image: it.image,
    municipality: it.shop, reviewAverage: it.reviewAverage || 0, reviewCount: it.reviewCount || 0,
    quantity: q, quantityText: quantityText(q), per10k: perTenThousand(q, it.price),
    delivery: parseDelivery(it.caption), teiki: parseTeiki(it.name),
    caption: String(it.caption || '').slice(0, 300),
    source: '楽天ふるさと納税（楽天市場の商品検索API）', fetchedAt: now.toISOString(),
    // 楽天ROOM・楽天アフィリエイトの対象かどうかは、最新の規約で確認できていない
    monetization: 'unknown'
  };
}

const SORTS = { standard: undefined, review: '-reviewCount', price_asc: '+itemPrice', price_desc: '-itemPrice' };

// 条件で探す。寄付額・自治体・カテゴリは楽天の検索に渡し、内容量・配送時期・定期便・レビューは取ってきたデータで絞る
export async function searchFurusato({ category = 'other', keyword = '', municipality = '', minPrice, maxPrice, teiki = 'any', minReview = 0, delivery = '', minQuantity = null, sort = 'standard', page = 1, env, referer, now = new Date() }) {
  const kw = ['ふるさと納税', categoryKeyword(category), municipality, keyword].filter(Boolean).join(' ').trim();
  const r = await searchFurusatoPage({ keyword: kw, page, sort: SORTS[sort], minPrice, maxPrice, env, referer });
  let items = r.items.filter(isFurusatoItem).map((it) => toFurusatoItem(it, now));
  const total = items.length;
  if (teiki === 'only') items = items.filter((x) => x.teiki);
  if (teiki === 'exclude') items = items.filter((x) => !x.teiki);
  if (minReview) items = items.filter((x) => x.reviewAverage >= minReview);
  if (delivery === 'stated') items = items.filter((x) => x.delivery);
  if (delivery && /^\d{1,2}$/.test(delivery)) items = items.filter((x) => new RegExp(`(^|[^\\d])${Number(delivery)}月`).test(x.delivery));
  if (minQuantity && minQuantity.value) items = items.filter((x) => x.quantity && x.quantity.unit === minQuantity.unit && x.quantity.value >= minQuantity.value);
  // 同じ返礼品の重複を除く
  const seen = new Set();
  items = items.filter((x) => { const k = x.code || x.url; if (seen.has(k)) return false; seen.add(k); return true; });
  return { items, keyword: kw, page, pageCount: r.pageCount, filteredOut: total - items.length, fetchedAt: now.toISOString() };
}
