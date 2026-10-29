// 知らないブランド発見：売れ筋ランキング（実データ）に出てくる商品からブランドを集める。
// ブランド名は、よく知られたブランドの辞書（product-analysis.js）で見つかればそれ、見つからなければ商品名の【】や先頭の英字から推定する（推定と分かるように印を付ける）。
// 価格帯・代表的な商品・ランキングの順位は、取ってきた商品のデータそのもの（推測で補わない）。
import { findBrand, findKind } from './product-analysis.js';

const GENERIC = /送料無料|ポイント|公式|楽天|ランキング|SALE|セール|クーポン|限定|新作|予約|あす楽|即納|母の日|父の日|敬老|ギフト|プレゼント|送料|最大|OFF|％|%|倍|位|入荷|再販|在庫|期間|本日|週末|年|月|日|円|メール便|ネコポス|宅配|正規|国内|海外|人気|おすすめ|NEW|大容量|まとめ買い|個|枚|セット|サイズ|カラー|ポスト投函|お試し/i;

export function guessBrand(name) {
  const known = findBrand(name);
  if (known) return { name: known.name, guessed: false, known: true };
  const s = String(name || '').normalize('NFKC');
  for (const m of s.matchAll(/[【\[]([^】\]]{2,24})[】\]]/g)) {
    const t = m[1].trim();
    if (!GENERIC.test(t) && /^[A-Za-z0-9&'.\- ・ァ-ヶー]+$/.test(t) && /[A-Za-zァ-ヶ]{2}/.test(t)) return { name: t, guessed: true, known: false };
  }
  const rest = s.replace(/^(\s*[【\[][^】\]]*[】\]])+\s*/, '');
  const m = rest.match(/^([A-Z][A-Za-z0-9&'.-]+(?:\s[A-Z][A-Za-z0-9&'.-]+){0,2})(?=\s|$)/);
  if (m && m[1].length >= 3 && !GENERIC.test(m[1])) return { name: m[1], guessed: true, known: false };
  return null;
}

// items: ランキングの商品（rank つき）。ブランドごとにまとめる
export function aggregateBrands(items, { genreLabel = '' } = {}) {
  const map = new Map();
  for (const it of items) {
    const b = guessBrand(it.name);
    if (!b) continue;
    const key = b.name.toLowerCase();
    if (!map.has(key)) map.set(key, { name: b.name, guessed: b.guessed, known: b.known, items: [], kinds: new Set() });
    const e = map.get(key);
    e.items.push(it);
    const k = findKind(it.name);
    if (k) e.kinds.add(k);
  }
  return [...map.values()].map((e) => {
    const prices = e.items.map((x) => x.price).filter((p) => p > 0);
    const ranks = e.items.map((x) => x.rank).filter(Boolean);
    return {
      name: e.name, guessed: e.guessed, known: e.known,
      genre: genreLabel, kinds: [...e.kinds].slice(0, 4),
      count: e.items.length, bestRank: ranks.length ? Math.min(...ranks) : null,
      minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null,
      items: e.items.sort((a, b) => (a.rank || 999) - (b.rank || 999)).slice(0, 6)
    };
  }).sort((a, b) => (a.bestRank || 999) - (b.bestRank || 999));
}
