// 楽天にない新商品を、公式サイトの商品URLから候補にする。
// ページの og:title / og:image / 価格のメタ情報 / JSON-LD（Product）だけを読む。読めない項目は画面で手入力してもらう。
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 1500000;

// 社内ネットワークなど、外から見えない場所への接続は断る
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s.startsWith('::ffff:')) return isPrivateAddress(s.slice(7));
    return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
  }
  return true;
}

export async function checkPublicUrl(raw, lookup = dns.lookup) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('URLが正しくありません'); }
  if (u.protocol !== 'https:') throw new Error('https:// で始まるURLを入れてください');
  if (u.username || u.password || (u.port && u.port !== '443')) throw new Error('このURLは使えません');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error('このURLは使えません');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('サイトが見つかりませんでした');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('このURLは使えません');
  return u;
}

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim();
}

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, 'i');
  const tag = (html.match(re) || [])[0];
  if (!tag) return '';
  return decode((tag.match(/content=["']([^"']*)["']/i) || [])[1]);
}

function findProductLd(html) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b.replace(/^<script[^>]*>|<\/script>$/gi, '')); } catch { continue; }
    const list = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
    for (const x of list) {
      const t = x && x['@type'];
      if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return x;
    }
  }
  return null;
}

// HTMLから商品の情報を読む（テストしやすいように取得とは分ける）
export function parseProductPage(html, pageUrl) {
  const ld = findProductLd(html) || {};
  const offers = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers || {};
  const name = decode(ld.name) || meta(html, 'og:title') || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const rawImage = (Array.isArray(ld.image) ? ld.image[0] : ld.image && ld.image.url ? ld.image.url : ld.image) || meta(html, 'og:image');
  let image = '';
  try { image = rawImage ? new URL(rawImage, pageUrl).toString() : ''; } catch {}
  const priceRaw = (offers && (offers.price || offers.lowPrice)) || meta(html, 'product:price:amount') || meta(html, 'og:price:amount');
  const price = Math.round(Number(String(priceRaw || '').replace(/[^\d.]/g, ''))) || 0;
  const brand = decode(typeof ld.brand === 'string' ? ld.brand : ld.brand && ld.brand.name);
  const shop = meta(html, 'og:site_name') || new URL(pageUrl).hostname.replace(/^www\./, '');
  return {
    name: name.slice(0, 200), price: price > 0 && price < 10000000 ? price : 0,
    image: /^https:\/\//.test(image) ? image.slice(0, 500) : '', url: pageUrl.slice(0, 500), shop: shop.slice(0, 60), brand: brand.slice(0, 40),
    caption: (decode(ld.description) || meta(html, 'og:description')).slice(0, 300)
  };
}

export async function fetchOfficialProduct(rawUrl, { lookup } = {}) {
  let u = await checkPublicUrl(rawUrl, lookup);
  let res;
  // 転送先も毎回確認する（最大3回）
  for (let i = 0; i < 4; i++) {
    res = await fetch(u.toString(), { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; room-assistant/1.0)', Accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (i === 3) throw new Error('転送が多すぎます');
      u = await checkPublicUrl(new URL(res.headers.get('location'), u).toString(), lookup);
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error(`ページを開けませんでした（${res.status}）`);
  const type = res.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml/.test(type)) throw new Error('商品ページ（HTML）ではありませんでした');
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value);
    if (size > MAX_BYTES) { try { await reader.cancel(); } catch {} break; }
  }
  const html = new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  return parseProductPage(html, u.toString());
}
