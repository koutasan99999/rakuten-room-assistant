// 検索急上昇（Googleトレンド「急上昇ワード」のRSS）。Googleで検索が急に増えている言葉で、売れ筋や新作とは別もの。
// 公式のGoogle Trends API は招待制のアルファ版（2025年〜）で、しかも急上昇ワードは含まれない。
// そのため、Googleトレンドの画面に用意されている公開RSS（日本）を読む。ジャンル分けはGoogleが付けていないので、こちらでは付けない。
// RSSが読めないときに備えて、画面ではGoogleトレンドから書き出したCSVを取り込めるようにしている（js側）。
const RSS = 'https://trends.google.com/trending/rss?geo=JP';

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim()) : '';
}
function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

export function parseTrendsRss(xml) {
  const items = [];
  for (const block of String(xml).split('<item>').slice(1)) {
    const body = block.split('</item>')[0];
    const term = tag(body, 'title');
    if (!term) continue;
    const news = [];
    for (const n of body.split('<ht:news_item>').slice(1)) {
      const t = tag(n, 'ht:news_item_title');
      const url = tag(n, 'ht:news_item_url');
      if (t && /^https?:\/\//.test(url)) news.push({ title: t.slice(0, 80), url, source: tag(n, 'ht:news_item_source').slice(0, 30) });
    }
    items.push({ term: term.slice(0, 60), traffic: tag(body, 'ht:approx_traffic').slice(0, 20), pubDate: tag(body, 'pubDate'), news: news.slice(0, 3) });
  }
  return items;
}

export async function fetchTrending({ now = new Date() } = {}) {
  let res;
  try {
    res = await fetch(RSS, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (rakuten-room-assistant)' } });
  } catch (e) {
    throw new Error(`Googleトレンドに接続できませんでした（${e.name}）`);
  }
  if (!res.ok) throw new Error(`Googleトレンドを読めませんでした（${res.status}）`);
  const items = parseTrendsRss(await res.text());
  return { items, source: 'Googleトレンド 急上昇ワード（日本・RSS）', sourceUrl: 'https://trends.google.com/trending?geo=JP', fetchedAt: now.toISOString() };
}
