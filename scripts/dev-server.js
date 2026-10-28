// 手元で画面を確認するための簡易サーバー（本番はVercelが動かすので不要）
// MOCK=1 で起動すると、APIキーなしで偽の商品データを表示できる
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/discover.js';
import exploreHandler from '../api/explore.js';
import introsHandler from '../api/intros.js';
import instagramHandler from '../api/instagram.js';
import imageHandler from '../api/image.js';
import plansHandler from '../api/plans.js';
import ideasHandler from '../api/ideas.js';
import seedIdeasHandler from '../api/seed-ideas.js';

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
      const kw = url.searchParams.get('keyword').replace(/\s/g, '').slice(0, 10) + (url.searchParams.get('page') || '');
      const items = makeItems(20, kw).map((it, i) => ({ ...it, itemPrice: min + i * 100, shopName: `${kw}ショップ${i % 3}` }));
      return json(200, { items, pageCount: 3 });
    },
    openai: (body) => body.messages[0].content.includes('ランダム発掘で見つけて')
      ? aiReply({ analysis: '3ポートで出力が高い、デスクにも旅行にも使える充電器', ideas: [
        { topic: 'iPhoneの充電まわり', type: 'first_pick', typeLabel: 'まずコレ', role: 'main', howUsed: '本命の1つとして、出力と価格のバランスの基準にする', searchGenres: ['USB-C 充電器', 'ワイヤレス充電器', 'USB-Cケーブル', 'MagSafe スタンド'], expectedCount: 18, whyWorks: '充電器は種類が多く、何を基準に選べばいいか迷う人が多い', target: 'iPhoneを使っている人', priceBand: '1,500〜6,000円', axis: '' },
        { topic: 'AnkerとUGREEN、結局どっちを選ぶ？', type: 'brand', typeLabel: 'ブランド比較', role: 'main', howUsed: 'UGREEN側の代表として、Ankerの同クラスと並べる', searchGenres: ['Anker 充電器', 'UGREEN 充電器', 'CIO 充電器'], expectedCount: 15, whyWorks: '有名な2ブランドで迷う人が多く、違いを整理する価値がある', target: '充電器を買い替えたい人', priceBand: '2,000〜8,000円', axis: 'ブランドの安心感 vs 価格' },
        { topic: '旅行に持っていく充電グッズ', type: 'use_case', typeLabel: '用途別', role: 'trigger', howUsed: '1台で複数充電できる枠として入れる', searchGenres: ['モバイルバッテリー', '変換プラグ', 'ケーブル 収納', 'スマホスタンド'], expectedCount: 18, whyWorks: '旅行前にまとめて揃える人が多く、セットで見せやすい', target: '旅行が多い人', priceBand: '1,000〜6,000円', axis: '' },
        { topic: '3,000円前後で買える便利なガジェット', type: 'budget_tiers', typeLabel: '予算別', role: 'trigger', howUsed: '価格帯の目安になる1つとして入れる', searchGenres: ['ガジェット 便利', 'デスク 便利グッズ', 'Bluetooth トラッカー'], expectedCount: 18, whyWorks: 'プレゼントにも自分用にもなる価格帯で、探す人が多い', target: 'ちょっとしたガジェットが好きな人', priceBand: '2,000〜4,000円', axis: '' },
        { topic: 'デスクの充電ケーブルを減らす方法', type: 'must_buy', typeLabel: '悩み解決', role: 'trigger', howUsed: 'ケーブルをまとめる解決策の1つとして入れる', searchGenres: ['ケーブルトレー', 'ケーブル 収納', 'USBハブ', '電源タップ'], expectedCount: 16, whyWorks: '配線のごちゃつきは多くの人の悩みで、解決策を並べやすい', target: '在宅ワークの人', priceBand: '1,000〜5,000円', axis: '' }
      ] })
      : body.messages[0].content.includes('探索係')
      ? aiReply({ angles: [['王道ブランド', '今治タオル ギフト'], ['価格を抑えた代替', 'ガーゼ スタイ'], ['SNSで話題', 'おむつケーキ'], ['記念品', '名入れ 木製'], ['実用品', 'ベビー 食器'], ['新興ブランド', 'オーガニック ベビー'], ['ママ向け', 'ママ ハンドクリーム'], ['変わり種', 'ベビー 写真 ボード']].map(([label, keyword]) => ({ label, keyword: (body.messages[1].content.includes('避ける角度') ? 'さらに ' : '') + keyword, minPrice: null, maxPrice: null })) })
      : body.messages[0].content.includes('リサーチ担当')
      ? aiReply({ items: Array.from({ length: body.messages[0].content.includes('10個') ? 10 : 18 }, (_, i) => ({
        id: i * 4, role: ['本命', '2番手', 'コスパ', '安い代替', '変わり種', 'トレンド枠', 'プレゼント向き', '実用品', 'ブランド枠', '少し奮発', '失敗しても許せる価格', '知っておきたい', '王道', '個人的に気になる', '本命', 'コスパ', '変わり種', 'トレンド枠'][i],
        tags: i % 3 === 0 ? ['プレゼント向き'] : [], shortName: ['今治ガーゼタオル', 'スタイ3枚セット', 'おむつケーキ', '名入れフォトフレーム', '木のおもちゃ', 'ベビー食器セット', 'ママ用ハンドクリーム', 'ベビーブランケット', '授乳クッション', 'ベビーシューズ', '沐浴剤', 'ベビー綿棒', 'おくるみ', '手形スタンプ', 'ベビーカー用フック', '歯固め', 'ベビー写真ボード', 'ガラガラ'][i],
        brand: ['今治', 'MARLMARL', '', 'ハンドメイド工房', 'BorneLund', 'KINTO', 'L\'OCCITANE', 'エイデンアンドアネイ', '', 'ファミリア', '', '', 'エイデンアンドアネイ', '', '', '', '', ''][i],
        kind: ['タオル', 'スタイ', 'おむつケーキ', '記念品', 'おもちゃ', '食器', 'ママケア', 'ブランケット', '授乳グッズ', '靴', '沐浴', '日用品', 'おくるみ', '記念品', 'ベビーカー用品', 'おもちゃ', '記念品', 'おもちゃ'][i],
        reason: '自分ではなかなか買わないけど、もらうと毎日使える。箱入りで渡しやすい。', memo: ['出産祝いって迷うけど、こういう実用品は外しにくい。', '自分では後回しにしがちだから、もらうと嬉しい。', '見た目も良くて、ちゃんと選んだ感じが出る。'][i % 3]
      })) })
      : body.messages[0].content.includes('紹介文を書く担当')
      ? aiReply({ items: Array.from({ length: 10 }, (_, id) => ({ id, intro: GOOD_INTRO })) })
      : body.messages[0].content.includes('編集長')
      ? aiReply({ ideas: [
        { topic: '30代男性への5,000円プレゼント', postType: 'プレゼントならコレ', target: '30代男性の友人・同僚に贈る人', priceBand: '4,000〜6,000円', genre: 'プレゼント', brands: ['IL BISONTE', 'STANLEY'], whyInteresting: '5,000円は安っぽく見えやすい予算。選び方の基準を作ると迷わない', slots: ['迷ったらこれ', '王道', 'センス枠', '実用性重視', '価格を抑えるなら', '少し奮発するなら'].map((label) => ({ label, keyword: label + ' ギフト', minPrice: 3000, maxPrice: 7000 })) },
        { topic: 'タンブラー', subtitle: '― 高い本命と安い代替 ―', postType: '本命＋安い代替', target: '毎日コーヒーを持ち歩く人', priceBand: '1,500〜6,000円', genre: '旅行・アウトドア', brands: ['STANLEY', 'THERMOS', 'Hydro Flask'], axis: '所有満足感 vs 実用性', whyInteresting: '値段差が大きいのに見た目が似ているので、違いを整理する価値がある', slots: ['本命ブランド', '本命の中では買いやすい', 'コスパ代替', 'まず試す代替', '用途違いの別解', '一番バランスが良い'].map((label) => ({ label, keyword: 'タンブラー 真空断熱' })) },
        { topic: '旅行前に買っておくと楽なもの', postType: '旅行向け', target: '年末に旅行する人', priceBand: '〜5,000円', genre: '寝具・生活', brands: [], whyInteresting: '出発前の小さな不安を先回りで消せる', slots: ['迷ったらこれ', '機内用', '整理用', '充電用', '寝る用', '価格を抑えるなら'].map((label) => ({ label, keyword: '旅行 便利グッズ' })) }
      ] })
      : body.messages[0].content.includes('眼科医くま')
      ? aiReply({
        topicSlug: 'shussan-iwai', category: '出産祝い',
        ...(body.messages[0].content.includes('caption') ? { caption: '5,000円のプレゼントって、安っぽく見えないか一番気になる予算だと思う。\n\n誕生日が続く時期なので、一度ちゃんと整理しておきたかった。\n\n今回は「渡して不自然じゃないか」「自分では買わないけど嬉しいか」で選びました。\n\n迷ったら1枚目、少し奮発するなら3枚目、という並びです。\n\n買う前に見返せるよう、保存しておいてください。', hashtags: ['#30代男性プレゼント', '#誕生日プレゼント', '#プレゼント選び'] } : {}),
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
  if (url.pathname === '/api/explore') return exploreHandler(req, res, env);
  if (url.pathname === '/api/intros') return introsHandler(req, res, env);
  if (url.pathname === '/api/instagram') return instagramHandler(req, res, env);
  if (url.pathname === '/api/image') return imageHandler(req, res, env);
  if (url.pathname === '/api/plans') return plansHandler(req, res, env);
  if (url.pathname === '/api/ideas') return ideasHandler(req, res, env);
  if (url.pathname === '/api/seed-ideas') return seedIdeasHandler(req, res, env);
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
