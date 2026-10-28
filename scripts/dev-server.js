// 手元で画面を確認するための簡易サーバー（本番はVercelが動かすので不要）
// MOCK=1 で起動すると、APIキーなしで偽の商品データを表示できる
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/discover.js';
import curateHandler from '../api/curate.js';
import instagramHandler from '../api/instagram.js';
import imageHandler from '../api/image.js';
import plansHandler from '../api/plans.js';
import ideasHandler from '../api/ideas.js';

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
    openai: (body) => body.messages[0].content.includes('編集長')
      ? aiReply({ ideas: [
        { topic: '30代男性への5,000円プレゼント', postType: 'プレゼントならコレ', target: '30代男性の友人・同僚に贈る人', priceBand: '4,000〜6,000円', genre: 'プレゼント', brands: ['IL BISONTE', 'STANLEY'], whyInteresting: '5,000円は安っぽく見えやすい予算。選び方の基準を作ると迷わない', slots: ['迷ったらこれ', '王道', 'センス枠', '実用性重視', '価格を抑えるなら', '少し奮発するなら'].map((label) => ({ label, keyword: label + ' ギフト', minPrice: 3000, maxPrice: 7000 })) },
        { topic: 'タンブラー', subtitle: '― 高い本命と安い代替 ―', postType: '本命＋安い代替', target: '毎日コーヒーを持ち歩く人', priceBand: '1,500〜6,000円', genre: '旅行・アウトドア', brands: ['STANLEY', 'THERMOS', 'Hydro Flask'], axis: '所有満足感 vs 実用性', whyInteresting: '値段差が大きいのに見た目が似ているので、違いを整理する価値がある', slots: ['本命ブランド', '本命の中では買いやすい', 'コスパ代替', 'まず試す代替', '用途違いの別解', '一番バランスが良い'].map((label) => ({ label, keyword: 'タンブラー 真空断熱' })) },
        { topic: '旅行前に買っておくと楽なもの', postType: '旅行向け', target: '年末に旅行する人', priceBand: '〜5,000円', genre: '寝具・生活', brands: [], whyInteresting: '出発前の小さな不安を先回りで消せる', slots: ['迷ったらこれ', '機内用', '整理用', '充電用', '寝る用', '価格を抑えるなら'].map((label) => ({ label, keyword: '旅行 便利グッズ' })) }
      ] })
      : body.messages[0].content.includes('眼科医くま')
      ? aiReply({
        topicSlug: 'shussan-iwai', category: '出産祝い',
        ...(body.messages[0].content.includes('caption') ? { caption: '5,000円のプレゼントって、安っぽく見えないか一番気になる予算だと思う。\n\n今回は「渡して不自然じゃないか」「自分では買わないけど嬉しいか」で選びました。\n\n紹介したものはプロフィールの楽天ROOMにまとめています。\n\n#眼科医くま #本気出して考えてみた' } : {}),
        ...(body.messages[0].content.includes('2枚目') ? { summary: { title: '出産祝い、迷ったらこの順で見ればいい', lead: 'まずは外しにくい実用品から。次に、自分では買わないけどもらうと嬉しいもの。予算を抑えるなら後半の2つで十分で、価格差は素材と箱の特別感の差です。', verdict: '迷ったら今治ガーゼタオル。少し奮発するならおむつケーキ。' } } : {}),
        items: [0, 1, 2, 3, 4, 5].map((id) => ({ id, slug: ['towel', 'bib', 'blanket', 'bottle', 'toy', 'set'][id], shortName: ['今治ガーゼタオル', 'スタイ3枚セット', 'ベビーブランケット', 'ストローマグ', '木のおもちゃ', 'おむつケーキ'][id], subline: '名入れ対応、箱入りで渡しやすい', memo: ['出産祝いって迷うけど、こういう実用品は外しにくい。', '自分では後回しにしがちだから、もらうと嬉しい。', '見た目も良くて、ちゃんと選んだ感じが出る。', '安く済ませたいなら、このへんがちょうどいい。', '迷ったらまずこれでいい枠。', '高いけど、ブランドごと贈る意味があるやつ。'][id] }))
      })
      : body.messages[0].content.includes('検索プラン')
      ? aiReply({ summary: '30代男性が最初に買う香水。仕事でも使いやすいもの', title: '30代男性の最初の香水', audience: '30代男性', maxPrice: 10000, brand: true, keywords: ['メンズ 香水'], slots: [{ label: '最初の1本', keyword: 'メンズ 香水', maxPrice: 8000 }, { label: '2本目', keyword: 'オードパルファム', maxPrice: 10000 }] })
      : body.messages[0].content.includes('選び方まとめ')
      ? aiReply({
        title: '迷ったらこの順で選べばいい', axis: 'ブランド性 × 価格差', lead: 'まずは無難な1つ目で十分。物足りなくなったら2つ目、こだわりたくなったら3つ目、という順番にしています。',
        verdict: '迷ったら、最初の1つだけ買っておけば困らない。',
        items: [0, 8, 16, 24, 32, 40].map((id, i) => ({ id, role: ['迷ったらこれ', '王道', 'センス枠', '実用性重視', '価格を抑えるなら', '少し奮発するなら'][i], brand: ['IL BISONTE', 'STANLEY', 'KINTO', '', 'THERMOS', 'GANZO'][i], memo: '迷ったらまずこれでいい枠。', side: i ? '代替' : '本命', pick: ['ブランド込みで欲しいならこれ', '価格を抑えるならこのへん', 'まず1枚試すならこれ', '普段使いしやすいのはこれ', 'まず試すならこれ', 'ギフトっぽさを出すならこれ'][i], forWho: '初めて買う人に', why: '価格と見た目のバランスが良く、最初の1つとして外しにくい位置づけ。', tradeoff: i ? '高い分、素材と仕上げにお金を払っている。' : '', brandNote: '老舗ブランドで、30代に渡しても若すぎない落ち着いたデザイン。', giftClass: ['外しにくい王道', '価格を抑えたい場合の候補', '大人向け'][i], intro: GOOD_INTRO }))
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
  if (url.pathname === '/api/plans') return plansHandler(req, res, env);
  if (url.pathname === '/api/ideas') return ideasHandler(req, res, env);
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
