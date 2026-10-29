// 楽天市場 商品検索API（2026年の新仕様：applicationId + accessKey + Referer）
const DEFAULT_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const HITS = 30;
const MAX_RANDOM_PAGE = 5;

// ROOMの商品紹介に向かないもの（ふるさと納税など）を除外する
const NG_KEYWORD = 'ふるさと納税 返礼品';
const EXCLUDE_RE = /ふるさと納税|返礼品|寄附|寄付|定期便|自治体|業務用|中古|レンタル|福袋|オリパ|抽選|予約販売|お試し券|商品券|ギフト券|送料のみ/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RakutenError extends Error {}

function toItem(raw) {
  const it = raw && raw.Item ? raw.Item : raw; // formatVersion 1 / 2 の両方に対応
  if (!it) return null;
  const images = (it.mediumImageUrls || []).map((m) => (typeof m === 'string' ? m : m && m.imageUrl)).filter(Boolean);
  return {
    code: String(it.itemCode || ''),
    name: String(it.itemName || '').trim(),
    price: Number(it.itemPrice) || 0,
    url: String(it.itemUrl || ''),
    image: images[0] ? images[0].replace(/\?_ex=\d+x\d+/, '?_ex=300x300') : '',
    shop: String(it.shopName || ''),
    caption: String(it.itemCaption || ''),
    reviewAverage: Number(it.reviewAverage) || 0,
    reviewCount: Number(it.reviewCount) || 0
  };
}

function isUsable(item) {
  return item && item.name && item.price > 0 && /^https:\/\//.test(item.url) && !EXCLUDE_RE.test(item.name);
}

// 同じ商品が別ショップで重複して並ぶことが多いので、商品名の先頭で重複を除く
export function nameKey(name) {
  return name.replace(/[【\[（(].*?[】\]）)]/g, '').replace(/[\s　]/g, '').slice(0, 18);
}

// sort: 楽天の並び順（例: '-updateTimestamp' = 更新が新しい順）。省略すると関連度順
async function searchOnce({ keyword, page, env, referer, hits = HITS, minPrice, maxPrice, sort, ngWords = [] }) {
  const endpoint = env.RAKUTEN_ENDPOINT || DEFAULT_ENDPOINT;
  const params = new URLSearchParams({
    applicationId: env.RAKUTEN_APP_ID,
    keyword,
    page: String(page),
    hits: String(hits),
    formatVersion: '2',
    imageFlag: '1',
    availability: '1',
    NGKeyword: [NG_KEYWORD, ...ngWords].join(' '),
    elements: 'itemCode,itemName,itemPrice,itemUrl,mediumImageUrls,shopName,itemCaption,reviewAverage,reviewCount,count,pageCount'
  });
  if (sort) params.set('sort', sort);
  if (minPrice) params.set('minPrice', String(minPrice));
  if (maxPrice) params.set('maxPrice', String(maxPrice));
  if (env.RAKUTEN_ACCESS_KEY) params.set('accessKey', env.RAKUTEN_ACCESS_KEY);
  if (env.RAKUTEN_AFFILIATE_ID) params.set('affiliateId', env.RAKUTEN_AFFILIATE_ID);

  let res;
  try {
    res = await fetch(`${endpoint}?${params}`, {
      headers: { Referer: referer, Origin: referer.replace(/\/$/, '') },
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    throw new RakutenError(`楽天APIに接続できませんでした（${e.name}）`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  if (!res.ok) {
    // 範囲外のページ指定は「0件」として扱い、呼び出し側でページを調整する
    if (res.status === 400 && /page/i.test(text)) return { items: [], pageCount: 0 };
    const detail = data && (data.error_description || data.message || data.error || (data.errors && JSON.stringify(data.errors)));
    throw new RakutenError(`楽天APIエラー（${res.status}${detail ? `: ${String(detail).slice(0, 120)}` : ''}）`);
  }
  if (!data) throw new RakutenError('楽天APIの応答を読み取れませんでした');
  const rawItems = data.Items || data.items || [];
  return { items: rawItems.map(toItem), pageCount: Number(data.pageCount) || 0 };
}

// 1ページ目〜5ページ目からランダムに取得し、件数が少なければページやキーワードを変えて補う
// randomPage: false にすると1ページ目（関連度の高い順）から取る。条件を指定した発掘で使う
export async function searchCandidates({ keywords, env, referer, minItems = 8, maxCalls = 3, minPrice, maxPrice, randomPage = true }) {
  const seen = new Set();
  const results = [];
  const queue = [...keywords];
  let page = randomPage ? 1 + Math.floor(Math.random() * MAX_RANDOM_PAGE) : 1;
  let keyword = queue.shift();
  let lastError = null;

  for (let call = 0; call < maxCalls && keyword; call++) {
    if (call > 0) await sleep(1100); // 楽天APIは1秒1リクエストまで
    let r;
    try {
      r = await searchOnce({ keyword, page, env, referer, minPrice, maxPrice });
    } catch (e) {
      lastError = e;
      // 認証系のエラーは何度試しても同じなので打ち切る
      if (/40[13]/.test(e.message)) break;
      keyword = queue.shift();
      page = 1;
      continue;
    }
    for (const item of r.items) {
      if (!isUsable(item)) continue;
      if ((minPrice && item.price < minPrice) || (maxPrice && item.price > maxPrice)) continue;
      const key = nameKey(item.name);
      if (seen.has(item.code) || seen.has(key)) continue;
      seen.add(item.code);
      seen.add(key);
      results.push(item);
    }
    if (results.length >= minItems) break;

    if (page > 1 && r.pageCount > 0 && r.pageCount < page) {
      // 結果のページ数が少なかった → 存在するページの中から選び直す
      page = 1 + Math.floor(Math.random() * r.pageCount);
    } else if (page > 1 && r.items.length === 0) {
      page = 1;
    } else {
      keyword = queue.shift();
      page = 1;
    }
  }

  if (results.length === 0 && lastError) throw lastError;
  return results;
}

// まとめ用：キーワードと価格帯を指定して、上位の商品を少数だけ取る（ページはランダムにしない）
export async function searchSlot({ keyword, minPrice, maxPrice, env, referer, hits = 30, limit = 12, page = 1 }) {
  const r = await searchOnce({ keyword, page, env, referer, hits, minPrice, maxPrice });
  const seen = new Set();
  const out = [];
  for (const item of r.items) {
    if (!isUsable(item)) continue;
    if (minPrice && item.price < minPrice) continue;
    if (maxPrice && item.price > maxPrice) continue;
    const key = nameKey(item.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

// 新作・予約レーダー用：除外の条件をかけずに1ページ分を取る（予約販売・限定品も残すため、除外は呼び出し側で決める）
export async function searchRaw({ keyword, env, referer, hits = HITS, page = 1, sort, minPrice, maxPrice }) {
  return searchOnce({ keyword, page, env, referer, hits, sort, minPrice, maxPrice });
}

// 関連商品・手動検索用：1ページ分を取り、ROOMに向かない商品だけ除く。
// ngWords: 結果から外したい言葉（1語ずつ。空白を含む言葉は楽天側で別々の言葉として扱われるので、呼び出し側で除いておく）
export async function searchPage({ keyword, env, referer, page = 1, hits = HITS, sort, minPrice, maxPrice, ngWords = [] }) {
  const ng = ngWords.map((w) => String(w || '').trim()).filter((w) => w.length >= 2 && !/\s/.test(w)).slice(0, 6);
  const r = await searchOnce({ keyword, page, env, referer, hits, sort, minPrice, maxPrice, ngWords: ng });
  return {
    items: r.items.filter((it) => isUsable(it) && (!minPrice || it.price >= minPrice) && (!maxPrice || it.price <= maxPrice)),
    pageCount: r.pageCount
  };
}
