// 手元で画面を確認するための簡易サーバー（本番はVercelが動かすので不要）
// MOCK=1 で起動すると、APIキーなしで偽の商品データを表示できる
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import handler from '../server/discover.js';
import exploreHandler from '../server/explore.js';
import introsHandler from '../server/intros.js';
import instagramHandler from '../server/instagram.js';
import imageHandler from '../server/image.js';
import plansHandler from '../server/plans.js';
import ideasHandler from '../server/ideas.js';
import roomHashtagsHandler from '../server/room-hashtags.js';
import radarHandler from '../server/radar.js';
import assetsHandler from '../server/assets.js';
import seedIdeasHandler from '../server/seed-ideas.js';
import releaseIdeasHandler from '../server/release-ideas.js';
import searchHandler from '../server/search.js';
import planTitlesHandler from '../server/plan-titles.js';
import productUrlHandler from '../server/product-url.js';
import coordHandler from '../server/coord.js';
import coordImageHandler from '../server/coord-image.js';
import trendsHandler from '../server/trends.js';
import furusatoHandler from '../server/furusato.js';
import brandNoteHandler from '../server/brand-note.js';
import buyerHandler from '../server/buyer.js';
import pitchHandler from '../server/pitch.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
let env = process.env;

if (process.env.MOCK) {
  const sampleImage = await fs.readFile(path.join(root, 'test/fixtures/sample-product.png'));
  const { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } = await import('../test/mock.js');
  const kuma = await fs.readFile(path.join(root, 'assets/kuma.png')).catch(() => null);
  installFetchMock({
    // 画像生成の偽物：少し待ってから、くまの画像を「生成した画像」として返す
    trends: () => new Response(`<rss><channel>${['冬のボーナス', '新型スマホ', 'インフルエンザ', '加湿器 おすすめ', '日本シリーズ'].map((t, i) => `<item><title>${t}</title><ht:approx_traffic>${(5 - i) * 2}万+</ht:approx_traffic><pubDate>${new Date().toUTCString()}</pubDate><ht:news_item><ht:news_item_title>${t}のニュース</ht:news_item_title><ht:news_item_url>https://news.example.jp/${i}</ht:news_item_url><ht:news_item_source>Example</ht:news_item_source></ht:news_item></item>`).join('')}</channel></rss>`, { status: 200 }),
    images: async () => { await new Promise((r) => setTimeout(r, 1500)); return json(200, { data: [{ b64_json: kuma ? kuma.toString('base64') : '' }] }); },
    // 価格帯の指定があれば、その範囲の価格で偽の商品を返す
    rakuten: (url) => {
      // 商品画像の中継（api/image）用に、余白つきの見本画像を返す
      if (url.hostname.startsWith('thumbnail')) return new Response(sampleImage, { status: 200, headers: { 'Content-Type': 'image/png' } });
      // 売れ筋（楽天ランキングAPI）：ジャンルごとの偽のランキング（ブランドが分かる商品・推定する商品・ふるさと納税が混ざる）
      if (url.pathname.includes('/Ranking/')) {
        const g = url.searchParams.get('genreId') || '0';
        const names = ['New Balance 1906R スニーカー グレー', '【MOUNTAIN RESEARCH】マウンテンパーカー', 'KANGOL ショルダーバッグ', '【ふるさと納税】牛肉 1kg', 'Hender Scheme レザー ポーチ', 'Anker 充電器 65W',
          '【楽天1位】収納ボックス 3個セット', 'KANGOL キャップ', 'BALMUDA トースター', 'Aesop ハンドクリーム', '香水 オードトワレ 50ml ギフト', 'BEAMS スニーカー キャンバス', 'CHUMS トートバッグ', 'マキタ 掃除機 コードレス'];
        const items = names.map((n, i) => ({ rank: i + 1, itemName: n, itemPrice: 1980 + i * 1300, itemCode: `rank:${g}-${i}`, itemUrl: n.includes('ふるさと') ? `https://item.rakuten.co.jp/f012345-town/${i}/` : `https://item.rakuten.co.jp/rank${g}/${i}/`, mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/r/${i}.jpg?_ex=128x128`], shopName: `ショップ${i % 3}`, reviewAverage: 4.3, reviewCount: 10 + i }));
        return json(200, { title: `【楽天市場】ランキング市場（ジャンル${g}）`, lastBuildDate: new Date().toUTCString(), Items: items });
      }
      // ふるさと納税コーナー
      if ((url.searchParams.get('keyword') || '').startsWith('ふるさと納税')) {
        const kw = url.searchParams.get('keyword');
        const list = [['【ふるさと納税】コシヒカリ 10kg', 15000, '新潟県魚沼市', '2026年11月中旬より順次発送'], ['【ふるさと納税】ななつぼし 5kg×2袋', 13000, '北海道〇〇町', ''], ['【ふるさと納税】【定期便6回】お米 5kg', 60000, '秋田県〇〇市', '寄附確認後、翌月から毎月発送'],
          ['【ふるさと納税】牛肉 切り落とし 500g×4パック', 12000, '宮崎県〇〇町', '入金確認後、2週間程度で発送'], ['【ふるさと納税】ホタテ 1kg', 14000, '北海道△△町', '12月下旬発送'], ['【ふるさと納税】いくら醤油漬け 250g', 15000, '北海道別海町', ''],
          ['【ふるさと納税】トイレットペーパー 96ロール', 16000, '静岡県富士市', '順次発送'], ['【ふるさと納税】シャインマスカット 2房', 12000, '山梨県〇〇市', '2026年8月下旬より順次発送'], ['【ふるさと納税】おまかせ海鮮セット', 20000, '青森県〇〇町', '']];
        const items = list.map(([n, p, s, c], i) => ({ itemCode: `f:${i}`, itemName: n, itemPrice: p, itemUrl: `https://item.rakuten.co.jp/f0${10000 + i}-town/${i}/`, mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/f/${i}.jpg?_ex=128x128`], shopName: s, itemCaption: c, reviewAverage: 3.8 + (i % 4) * 0.3, reviewCount: 5 + i * 20 }));
        return json(200, { items: kw.includes('米') ? items.filter((x) => /米|コシヒカリ|ななつぼし/.test(x.itemName)) : items, pageCount: 1 });
      }
      if (url.searchParams.get('sort') === '-updateTimestamp') {
        // 新作レーダー用：予約・発売予定・再販・限定・コラボなどが混ざった商品
        const kw = url.searchParams.get('keyword');
        const brands = ['New Balance', 'Anker', 'KINTO', 'BEAMS', '', 'BALMUDA'];
        const tags = ['【予約】2026年11月20日発売 予約受付期間：10/1〜11/5', '11月下旬発売予定', '再入荷 12/3より順次発送', '数量限定', '× Champion 別注', '新色', '新作', '期間限定 特別価格'];
        const items = Array.from({ length: 10 }, (_, i) => ({
          itemCode: `radar:${kw}${i}`, itemName: `${brands[i % brands.length]} ${kw.split(' ')[0]} モデル${i} ${tags[(i + kw.length) % tags.length]}`.trim(),
          itemPrice: 1980 + i * 1500, itemUrl: `https://item.rakuten.co.jp/radar/${encodeURIComponent(kw)}${i}/`,
          mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/radar/${i}.jpg?_ex=128x128`], shopName: `ショップ${i % 4}`, itemCaption: tags[(i + 2) % tags.length]
        }));
        return json(200, { items, pageCount: 1 });
      }
      // コラボ・別注で探したとき：起点と同じコラボ・他ブランドのコラボ・別ショップの同じ商品が混ざる
      const rawKw = url.searchParams.get('keyword');
      if (/コラボ|別注/.test(rawKw)) {
        const pg = Number(url.searchParams.get('page')) || 1;
        const names = ['New Balance × BEAMS 別注 ML2002R グレー スニーカー', 'adidas Originals × CLOT スーパースター ホワイト スニーカー', '【送料無料】adidas Originals × CLOT スーパースター ホワイト スニーカー',
          'ASICS × KITH GEL-LYTE III ネイビー スニーカー コラボ', 'VANS × NEIGHBORHOOD オールドスクール ブラック スニーカー', 'PUMA × atmos スウェード 別注 スニーカー レッド',
          'NIKE × sacai コラボ スニーカー ホワイト', 'Onitsuka Tiger × KILL BILL コラボ スニーカー イエロー', 'CONVERSE × MHL 別注 オールスター アイボリー', 'Reebok × Maison Margiela コラボ スニーカー ベージュ'];
        const items = names.map((n, i) => ({ itemCode: `collab:${pg}-${i}`, itemName: pg > 1 ? n.replace('スニーカー', `スニーカー ${pg}号`) : n, itemPrice: 12000 + i * 1500, itemUrl: `https://item.rakuten.co.jp/collab/${pg}-${i}/`, mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/c/${i}.jpg?_ex=128x128`], shopName: `セレクト${i % 3}`, itemCaption: '' }));
        return json(200, { items, pageCount: 3 });
      }
      const min = Number(url.searchParams.get('minPrice')) || 1000;
      // 商品番号で1件引く（「社長、これどうすか？」の登録前の確認）
      if (url.searchParams.get('itemCode')) { const c = url.searchParams.get('itemCode'); return json(200, { items: [{ itemCode: c, itemName: `確認した商品 ${c}`, itemPrice: 3980, itemUrl: `https://item.rakuten.co.jp/${c.replace(':', '/')}/`, mediumImageUrls: [], shopName: 'テストショップ', itemCaption: '説明', postageFlag: 0 }], pageCount: 1 }); }
      const kw = url.searchParams.get('keyword').replace(/\s/g, '').slice(0, 10) + (url.searchParams.get('page') || '');
      const items = makeItems(20, kw).map((it, i) => ({ ...it, itemPrice: min + i * 100, shopName: `${kw}ショップ${i % 3}` }));
      return json(200, { items, pageCount: 3 });
    },
    openai: (body) => body.messages[0].content.includes('セレクトショップのバイヤーです。社長（オーナー）')
      ? aiReply({ queries: [{ category: '服', keyword: 'オープンカラーシャツ 柄', angle: '落ち着いた柄シャツ' }, { category: '香り', keyword: 'ルームフレグランス ウッド', angle: '部屋の香り' }, { category: 'ガジェット', keyword: 'アルミ スマホスタンド', angle: '机で絵になる' }], taste: 'まだ判断できない（履歴が少ない）' })
      : body.messages[0].content.includes('セレクトショップのバイヤーです。社長に')
      ? aiReply({ picks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => ({ id, brand: id % 2 ? '' : 'テストブランド', category: ['服', '香り', 'ガジェット', '雑貨'][id % 4], pitch: '社長、これどうすか？落ち着いた色なのに、よく見ると素材に表情があって、無難に見えないのがいいところです。休日のシャツの上に羽織っても、デスクに置いても絵になる感じ。説明を見るかぎり、普段使いしやすいサイズ感です。', fit: '落ち着いているのに無難ではない、という眼科医くまの基準に合う', caution: '色味は写真と違って見えることがあるので、商品ページの写真で確認したい' })) })
      : body.messages[0].content.includes('特集企画とカルーセル')
      ? aiReply({ title: '休日の机を少し良くする', target: '在宅の時間が長い30代男性', slides: ['1 表紙：休日の机、少し良くしたい人へ', '2 この商品のいいところ', '3 素材と見た目', '4 弱点も正直に', '5 楽天ROOMにまとめました'], caption: '【PR】楽天アフィリエイトを利用しています\n休日の机を、少し良くしたい人へ。', hashtags: ['#デスク周り', '#ガジェット', '#30代メンズ', '#ギフト', '#インテリア'] })
      : body.messages[0].content.includes('の商品バイヤーです')
      ? aiReply({ angles: [{ problem: '濡れた傘で玄関が濡れる', kind: '傘 吸水マット', keyword: '傘 水滴 吸水' }, { problem: '靴下が裏返しで出てくる', kind: '洗濯ネット', keyword: '靴下 裏返し 洗濯' }, { problem: '鍋のふたの置き場がない', kind: '鍋ふたスタンド', keyword: '鍋ふた スタンド' }, { problem: 'ケーブルが机の裏に落ちる', kind: 'ケーブルホルダー', keyword: 'ケーブル ホルダー マグネット' }] })
      : body.messages[0].content.includes('商品バイヤーと企画担当')
      ? aiReply({ picks: [0, 1, 2, 3, 4].map((id) => ({ id, surprise: 5 - (id % 3), solve: 4, everyday: 4 - (id % 2), reason: '説明に、小さな不便を片づける工夫が書かれている', buyerComment: 'こういうの、あったら地味に助かる', titles: ['玄関の水たまり、これで終わり', 'この不便、道具で片づくなんて', '知らなかった小さな便利もの'], target: '雨の日に玄関が濡れて困る人', pain: '傘の水滴で床が濡れる', slides: ['1 表紙：玄関の水たまり', '2 こんな不便ありませんか', '3 商品の特徴', '4 置き方のイメージ', '5 ROOMにまとめています'], intro: '傘を立てた時の水滴を受け止める商品です。説明には、水を吸う素材を使っていると書かれています。玄関の床が濡れやすい人には気になる道具かもしれません。気になる人は商品ページで詳細を確認してみてください。' })) })
      : body.messages[0].content.includes('ブランドに詳しい編集者')
      ? aiReply(body.messages[1].content.includes('KANGOL') ? { known: true, summary: 'イギリス発祥の帽子のブランド。カジュアルなバッグや小物もある。', taste: 'カジュアル' } : { known: false, summary: '', taste: '' })
      : body.messages[0].content.includes('コーディネーター')
      ? aiReply({ looks: [
        { name: 'きれいめカジュアル', style: 'きれいめ', concept: '落ち着いた色で、起点のアイテムを主役にする', items: [{ slot: 'tops', kind: 'ニット', keyword: 'メンズ ニット グレー' }, { slot: 'bottoms', kind: 'スラックス', keyword: 'メンズ スラックス' }, { slot: 'bag', kind: 'レザーバッグ', keyword: 'メンズ レザー バッグ' }] },
        { name: '大人ストリート', style: 'ストリート', concept: 'ゆるいシルエットで程よく力を抜く', items: [{ slot: 'outer', kind: 'ブルゾン', keyword: 'メンズ ブルゾン' }, { slot: 'tops', kind: 'Tシャツ', keyword: 'メンズ Tシャツ' }, { slot: 'bottoms', kind: 'ワイドデニム', keyword: 'メンズ ワイド デニム' }] },
        { name: '休日カジュアル', style: '大人カジュアル', concept: '動きやすさ優先の休日コーデ', items: [{ slot: 'tops', kind: 'スウェット', keyword: 'メンズ スウェット' }, { slot: 'bottoms', kind: 'チノパン', keyword: 'メンズ チノパン' }, { slot: 'bag', kind: 'ショルダーバッグ', keyword: 'メンズ ショルダーバッグ' }] }
      ] })
      : body.messages[0].content.includes('タイトル係')
      ? aiReply({ titles: [{ title: '大人が履きたい別注スニーカー', why: '落ち着いた色だけ' }, { title: 'コラボスニーカー、結局どれ？', why: '迷う人向け' }, { title: '別注スニーカーの選び方', why: '' }] })
      : body.messages[0].content.includes('新作特集の編集者')
      ? aiReply({ ideas: [
        { title: 'このバッグ、予約しないと後悔するかも', angle: '予約', searchGenres: ['同じブランドの新作', '秋の新作バッグ'], why: '予約受付中の新作を主役にする' },
        { title: '秋の新作、最初に見てほしいのはこれ', angle: '季節', searchGenres: ['秋の新作小物'], why: '季節の新作の入口にする' },
        { title: '完売確実の新作バッグ', angle: '煽り', searchGenres: ['新作'], why: 'NG確認用' },
        { title: '今月の新作で、いちばん気になったもの', angle: '編集部のおすすめ', searchGenres: ['新作 雑貨'], why: '個人の目線でまとめる' }
      ] })
      : body.messages[0].content.includes('楽天ROOMのハッシュタグを決める担当')
      ? aiReply({ common: [{ tag: '#防災', score: 98 }, { tag: '#防災グッズ', score: 96 }, { tag: '#災害対策', score: 92 }, { tag: '#防災準備', score: 88 }, { tag: '#備蓄', score: 80 }],
        items: Array.from({ length: 8 }, (_, id) => ({ id, tags: [{ tag: '#停電対策', score: 90 }, { tag: '#モバイルバッテリー', score: 85 }, { tag: '#キッチン用品', score: 75 }, { tag: '#プチプラ', score: 60 }] })) })
      : body.messages[0].content.includes('Reel と Story に展開')
      ? aiReply({
        reel: { title: '防災グッズ、まずコレ', hook: '防災グッズ、何から買えばいい？', cta: '詳しくは投稿にまとめました',
          scenes: [{ type: 'hook', seconds: 2, text: '防災グッズ、何から買えばいい？', narration: '防災グッズ、何から買えばいいか迷いますよね。' },
            { type: 'item', item: 0, seconds: 3, text: '①まず電源', narration: 'まずは電源。スマホが使えると安心です。' },
            { type: 'item', item: 2, seconds: 3, text: '②停電対策', narration: '停電したときの明かりも先に。' },
            { type: 'item', item: 3, seconds: 3, text: '③ここ忘れがち', narration: '意外と忘れがちなのがこれ。' },
            { type: 'cta', seconds: 3, text: '詳しくは投稿にまとめました', narration: '全部まとめた投稿は、プロフィールから見られます。' }] },
        story: { hook: '防災用品、ちゃんと揃ってる？', hookSub: '最低限だけでも先に', title: '今回はこの3つで選びました', points: ['電源', '明かり', 'トイレ'], text: '6商品まとめました', sub: '詳しくは最新投稿へ' }
      })
      : body.messages[0].content.includes('ランダム発掘で見つけて')
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
        ...(body.messages[0].content.includes('表紙）に載せる文字') ? { cover: { style: 'value_pick', title: '防災グッズ、\nまずコレを買え', accent: 'コレ', sub: '最初の1セットはここから' } } : {}),
        ...(body.messages[0].content.includes('caption') ? { caption: '5,000円のプレゼントって、安っぽく見えないか一番気になる予算だと思う。\n\n誕生日が続く時期なので、一度ちゃんと整理しておきたかった。\n\n今回は「渡して不自然じゃないか」「自分では買わないけど嬉しいか」で選びました。\n\n迷ったら1枚目、少し奮発するなら3枚目、という並びです。\n\n買う前に見返せるよう、保存しておいてください。', hashtags: ['#30代男性プレゼント', '#誕生日プレゼント', '#プレゼント選び'] } : {}),
        ...(body.messages[0].content.includes('2枚目') ? { summary: { title: '出産祝い、結局むずかしい。', points: ['ちゃんとして見える', '実際に使える', 'もらって困りにくい'], verdict: '今回はこの3つで選びました。' } } : {}),
        items: Array.from({ length: 20 }, (_, id) => ({ id, slug: `item${id}`, shortName: ['今治ガーゼタオル', 'スタイ3枚セット', 'ベビーブランケット', 'ストローマグ', '木のおもちゃ', 'おむつケーキ'][id % 6] + (id >= 6 ? ` ${id + 1}` : ''), subline: '名入れ対応、箱入りで渡しやすい', memo: ['出産祝いって迷うけど、こういう実用品は外しにくい。', '自分では後回しにしがちだから、もらうと嬉しい。', '見た目も良くて、ちゃんと選んだ感じが出る。', '安く済ませたいなら、このへんがちょうどいい。', '迷ったらまずこれでいい枠。', '高いけど、ブランドごと贈る意味があるやつ。'][id % 6] }))
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
  if (url.pathname === '/api/room-hashtags') return roomHashtagsHandler(req, res, env);
  if (url.pathname === '/api/radar') return radarHandler(req, res, env);
  if (url.pathname === '/api/assets') return assetsHandler(req, res, env);
  if (url.pathname === '/api/seed-ideas') return seedIdeasHandler(req, res, env);
  if (url.pathname === '/api/release-ideas') return releaseIdeasHandler(req, res, env);
  if (url.pathname === '/api/search') return searchHandler(req, res, env);
  if (url.pathname === '/api/plan-titles') return planTitlesHandler(req, res, env);
  if (url.pathname === '/api/product-url') return productUrlHandler(req, res, env);
  if (url.pathname === '/api/coord') return coordHandler(req, res, env);
  if (url.pathname === '/api/coord-image') return coordImageHandler(req, res, env);
  if (url.pathname === '/api/trends') return trendsHandler(req, res, env);
  if (url.pathname === '/api/furusato') return furusatoHandler(req, res, env);
  if (url.pathname === '/api/brand-note') return brandNoteHandler(req, res, env);
  if (url.pathname === '/api/buyer') return buyerHandler(req, res, env);
  if (url.pathname === '/api/pitch') return pitchHandler(req, res, env);
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
