// 売れ筋（楽天市場ランキングAPI）：楽天市場で実際に売れている順位。検索数のランキングではない。
// 公式：楽天市場ランキングAPI（version 2022-06-01）。applicationId（＋accessKey）で無料で使える。
// ジャンルは楽天のジャンルID。変わったときは TREND_GENRES のIDだけ直す。
// 「スニーカー」「香水」のように楽天のジャンルIDで分けにくいものは、上のジャンルのランキングから商品名で絞る（画面にもそう出す）。
import { RakutenError, toItem } from './rakuten.js';

const ENDPOINT = 'https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TREND_GENRES = [
  { id: 'mens', label: 'メンズファッション', genreIds: [551177] },
  { id: 'ladies', label: 'レディースファッション', genreIds: [100371] },
  { id: 'sneaker', label: 'スニーカー', genreIds: [558885], match: /スニーカー/, note: '靴のランキングから、商品名に「スニーカー」とある商品' },
  { id: 'bag', label: 'バッグ・アクセサリー', genreIds: [216131, 216129] },
  { id: 'perfume', label: '香水・フレグランス', genreIds: [100939], match: /香水|フレグランス|オードトワレ|オードパルファ|パルファム|コロン|EDT|EDP/i, note: '美容・コスメ・香水のランキングから、商品名に香水などとある商品' },
  { id: 'cosme', label: '美容・コスメ', genreIds: [100939] },
  { id: 'gadget', label: 'ガジェット', genreIds: [564500, 100026] },
  { id: 'appliance', label: '家電', genreIds: [562637] },
  { id: 'interior', label: 'インテリア', genreIds: [100804] },
  { id: 'useful', label: '生活便利グッズ', genreIds: [215783, 558944] },
  { id: 'food', label: '食品・グルメ', genreIds: [100227, 551167] },
  { id: 'baby', label: 'ベビー・キッズ', genreIds: [100533] },
  { id: 'gift', label: 'ギフト', genreIds: [0], match: /ギフト|プレゼント|贈り物|内祝い/, note: '総合ランキングのうち、商品名にギフト・プレゼントとある商品' },
  { id: 'other', label: 'その他（総合）', genreIds: [0] }
];

// ふるさと納税は売れ筋に混ぜない（専用のコーナーで扱う）
const FURUSATO_RE = /ふるさと納税|返礼品|寄附|寄付/;
const FURUSATO_URL = /item\.rakuten\.co\.jp\/f\d{6}-/;
export function isFurusato(it) { return FURUSATO_RE.test(it.name || '') || FURUSATO_URL.test(it.url || ''); }

export function findTrendGenre(id) { return TREND_GENRES.find((g) => g.id === id) || null; }

async function fetchOne({ genreId, period, page, env, referer }) {
  const params = new URLSearchParams({ applicationId: env.RAKUTEN_APP_ID, formatVersion: '2', page: String(page || 1) });
  if (genreId) params.set('genreId', String(genreId));
  if (period === 'realtime') params.set('period', 'realtime');
  if (env.RAKUTEN_ACCESS_KEY) params.set('accessKey', env.RAKUTEN_ACCESS_KEY);
  if (env.RAKUTEN_AFFILIATE_ID) params.set('affiliateId', env.RAKUTEN_AFFILIATE_ID);
  let res;
  try {
    res = await fetch(`${env.RAKUTEN_RANKING_ENDPOINT || ENDPOINT}?${params}`, {
      headers: { Referer: referer, Origin: referer.replace(/\/$/, '') }, signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    throw new RakutenError(`楽天ランキングAPIに接続できませんでした（${e.name}）`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || !data) {
    const detail = data && (data.error_description || data.error);
    throw new RakutenError(`楽天ランキングAPIエラー（${res.status}${detail ? `: ${String(detail).slice(0, 100)}` : ''}）`);
  }
  const items = (data.Items || data.items || []).map((raw) => {
    const it = raw && raw.Item ? raw.Item : raw;
    const base = toItem(it);
    return base && { ...base, rank: Number(it.rank) || 0 };
  }).filter(Boolean);
  return { items, title: String(data.title || ''), lastBuildDate: String(data.lastBuildDate || '') };
}

// period: 'daily'（楽天の既定）/ 'realtime'。リアルタイムが使えないときは既定のランキングに戻し、そのことを返す
export async function fetchRanking({ genre, period = 'daily', env, referer, now = new Date() }) {
  const g = findTrendGenre(genre) || findTrendGenre('other');
  const out = [];
  const titles = [];
  let usedPeriod = period;
  let notice = '';
  for (const [i, genreId] of g.genreIds.entries()) {
    if (i > 0) await sleep(1100); // 楽天APIは1秒1回まで
    let r;
    try {
      r = await fetchOne({ genreId, period: usedPeriod, page: 1, env, referer });
    } catch (e) {
      if (usedPeriod !== 'realtime' || /40[13]/.test(e.message)) throw e;
      usedPeriod = 'daily';
      notice = 'リアルタイムのランキングを取れなかったため、楽天の通常のランキングを表示しています。';
      await sleep(1100);
      r = await fetchOne({ genreId, period: usedPeriod, page: 1, env, referer });
    }
    titles.push(r.title || r.lastBuildDate);
    r.items.forEach((it) => out.push({ ...it, genreId }));
  }
  const items = out
    .filter((it) => !isFurusato(it))
    .filter((it) => !g.match || g.match.test(it.name))
    .map((it) => ({ ...it, source: '楽天市場ランキング', sourceTitle: titles[0] || '', fetchedAt: now.toISOString(), category: g.label }));
  return {
    genre: g.id, genreLabel: g.label, note: g.note || '', period: usedPeriod, items,
    sourceTitles: titles.filter(Boolean), fetchedAt: now.toISOString(), notice
  };
}
