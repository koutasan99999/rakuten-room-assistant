// 手元で画面を確認するための簡易サーバー（本番はVercelが動かすので不要）
// MOCK=1 で起動すると、APIキーなしで偽の商品データを表示できる
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/discover.js';
import curateHandler from '../api/curate.js';
import instagramHandler from '../api/instagram.js';
import imageHandler from '../api/image.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
let env = process.env;

if (process.env.MOCK) {
  const sampleImage = await fs.readFile(path.join(root, 'test/fixtures/sample-product.png'));
  const { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } = await import('../test/mock.js');
  installFetchMock({
    // 価格帯の指定があれば、その範囲の価格で偽の商品を返す
    rakuten: (url) => {
      // 商品画像の中継（api/image）用に、余白つきの見本画像を返す
      if (url.hostname.startsWith('thumbnail')) return new Response(sampleImage, { status: 200, headers: { 'Content-Type': 'image/png' } });
      const min = Number(url.searchParams.get('minPrice')) || 1000;
      const items = makeItems(20, url.searchParams.get('keyword').split(' ')[0]).map((it, i) => ({ ...it, itemPrice: min + i * 100 }));
      return json(200, { items, pageCount: 3 });
    },
    openai: (body) => body.messages[0].content.includes('眼科医くま')
      ? aiReply({
        topicSlug: 'shussan-iwai', category: '出産祝い',
        items: [0, 1, 2, 3, 4, 5].map((id) => ({ id, slug: ['towel', 'bib', 'blanket', 'bottle', 'toy', 'set'][id], shortName: ['今治ガーゼタオル', 'スタイ3枚セット', 'ベビーブランケット', 'ストローマグ', '木のおもちゃ', 'おむつケーキ'][id], subline: '名入れ対応、箱入りで渡しやすい', memo: ['出産祝いって迷うけど、こういう実用品は外しにくい。', '自分では後回しにしがちだから、もらうと嬉しい。', '見た目も良くて、ちゃんと選んだ感じが出る。', '安く済ませたいなら、このへんがちょうどいい。', '迷ったらまずこれでいい枠。', '高いけど、ブランドごと贈る意味があるやつ。'][id] }))
      })
      : body.messages[0].content.includes('検索プラン')
      ? aiReply({ summary: '30代男性が最初に買う香水。仕事でも使いやすいもの', title: '30代男性の最初の香水', audience: '30代男性', maxPrice: 10000, brand: true, keywords: ['メンズ 香水'], slots: [{ label: '最初の1本', keyword: 'メンズ 香水', maxPrice: 8000 }, { label: '2本目', keyword: 'オードパルファム', maxPrice: 10000 }] })
      : body.messages[0].content.includes('選び方まとめ')
      ? aiReply({
        title: '迷ったらこの順で選べばいい', lead: 'まずは無難な1つ目で十分。物足りなくなったら2つ目、こだわりたくなったら3つ目、という順番にしています。',
        verdict: '迷ったら、最初の1つだけ買っておけば困らない。',
        items: [0, 8, 16].map((id, i) => ({ id, role: ['迷ったらまずこれ', '2番手', '本気なら'][i], forWho: '初めて買う人に', why: '価格と見た目のバランスが良く、最初の1つとして外しにくい位置づけ。', tradeoff: i ? '高い分、素材と仕上げにお金を払っている。' : '', brandNote: '老舗ブランドで、30代に渡しても若すぎない落ち着いたデザイン。', giftClass: ['外しにくい王道', '価格を抑えたい場合の候補', '大人向け'][i], intro: GOOD_INTRO }))
      })
      : aiReply({ picks: [0, 4, 8, 12, 16, 19].map((id, i) => ({ id, want: 8, role: ['一番外しにくい', '実用性重視', 'もらうと嬉しい', 'センスが良く見える', '価格を抑えるなら', '少し奮発するなら'][i], basis: ['ブランドで選ぶ', 'トレンド枠', '機能で選ぶ', 'デザインで選ぶ', '', ''][i], reason: '中身が見えないフタ付きで、棚に並べてもごちゃっと見えない。', intro: GOOD_INTRO })) })
  });
  env = { RAKUTEN_APP_ID: 'mock', OPENAI_API_KEY: 'mock', ...(process.env.APP_PASSCODE ? { APP_PASSCODE: process.env.APP_PASSCODE } : {}) };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/discover') return handler(req, res, env);
  if (url.pathname === '/api/curate') return curateHandler(req, res, env);
  if (url.pathname === '/api/instagram') return instagramHandler(req, res, env);
  if (url.pathname === '/api/image') return imageHandler(req, res, env);
  const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await fs.readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
