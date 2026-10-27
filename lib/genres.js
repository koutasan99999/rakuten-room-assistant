// 検索ジャンルと、ジャンルごとの検索キーワード候補。
// 毎回「ジャンル → キーワード → 検索ページ」の順にランダムに選ぶ。
//
// id     : 記録用の固定ID（表示名を変えても記録が引き継がれるよう英字にしている）
// weight : 基本の選ばれやすさ（1 が標準。2 にすると2倍選ばれやすい）
// brand  : ブランドイメージが購買判断に影響するジャンル（ブランド・プレゼント適性も評価する）
export const GENRES = [
  { id: 'interior', name: 'インテリア', weight: 1.5, keywords: ['インテリア 雑貨 おしゃれ', 'インテリア 北欧', 'フラワーベース', 'ラグ おしゃれ', 'ウォールデコ', 'クッションカバー おしゃれ'] },
  { id: 'useful', name: '便利グッズ', weight: 1.5, keywords: ['便利グッズ', '便利グッズ 暮らし', '時短 グッズ', 'アイデア 便利グッズ', '生活雑貨 便利'] },
  { id: 'gadget', name: 'ガジェット', weight: 1.5, keywords: ['ガジェット', '便利 ガジェット', 'ワイヤレスイヤホン', 'スマートウォッチ', 'Bluetooth スピーカー 小型'] },
  { id: 'kitchen', name: 'キッチン雑貨', weight: 1.5, keywords: ['キッチン雑貨', 'キッチン 便利グッズ', 'キッチンツール おしゃれ', '保存容器 おしゃれ', 'マグカップ おしゃれ', '調味料ラック'] },
  { id: 'storage', name: '収納グッズ', weight: 1.5, keywords: ['収納グッズ', '収納ボックス おしゃれ', '隙間収納', '整理収納 グッズ', 'ファイルボックス おしゃれ', '吊り下げ収納'] },
  { id: 'appliance', name: '家電', weight: 1.5, keywords: ['小型家電 便利', '一人暮らし 家電 おしゃれ', 'キッチン家電 コンパクト', 'ハンディ 家電', '時短家電', 'USB 充電式 家電'] },
  { id: 'idea', name: 'アイデア商品', weight: 1.5, keywords: ['アイデア商品', 'ありそうでなかった', '便利 アイデアグッズ', '珍しい 便利グッズ', 'ちょっと便利 雑貨', '100均にない 便利'] },
  { id: 'pokeca', name: 'ポケモンカード', weight: 1, keywords: ['ポケモンカード', 'ポケモンカード スリーブ', 'ポケモンカード ファイル', 'ポケカ デッキケース', 'ポケモンカード ローダー'] },
  { id: 'mens_fashion', name: 'メンズファッション', weight: 1, brand: true, keywords: ['メンズファッション', 'メンズ シャツ', 'メンズ カーディガン', 'メンズ パーカー', 'メンズ ワイドパンツ', 'メンズ アウター'] },
  { id: 'health', name: 'ダイエット・健康グッズ', weight: 1.5, keywords: ['ダイエットグッズ', '筋膜ローラー', '体重計', 'トレーニング用品', 'プロテインシェイカー', 'マッサージガン'] },
  { id: 'fragrance', name: '香水・フレグランス', weight: 1, brand: true, keywords: ['香水', 'メンズ香水', 'フレグランス', 'オードパルファム', 'ルームフレグランス', 'ヘアミスト'] },
  { id: 'brand_goods', name: 'ブランド小物', weight: 1, brand: true, keywords: ['ブランド財布', 'ブランドカードケース', 'ブランドキーケース', 'ブランドバッグ', 'ブランド コインケース', 'ブランド ネクタイ'] },
  { id: 'mens_beauty', name: 'メンズ美容', weight: 1, keywords: ['メンズ 化粧水', 'メンズ 洗顔', 'メンズ オールインワン', 'メンズ BBクリーム', '電動シェーバー', 'メンズ 眉毛'] },
  { id: 'skincare', name: 'スキンケア', weight: 1, keywords: ['スキンケア', '化粧水', '美容液', '日焼け止め', 'クレンジング', 'フェイスパック'] },
  { id: 'haircare', name: 'ヘアケア', weight: 1, keywords: ['ヘアケア', 'ヘアオイル', 'シャンプー', 'ヘアドライヤー', 'ヘアアイロン', 'ヘアブラシ'] },
  { id: 'bag_wallet', name: 'バッグ・財布', weight: 1, brand: true, keywords: ['財布', 'ミニ財布', 'リュック', 'ショルダーバッグ', 'トートバッグ', 'ボディバッグ'] },
  { id: 'watch', name: '腕時計', weight: 1, brand: true, keywords: ['腕時計', 'メンズ 腕時計', 'レディース 腕時計', 'ソーラー 腕時計', '腕時計 ベルト'] },
  { id: 'sneaker', name: 'スニーカー', weight: 1, brand: true, keywords: ['スニーカー', 'メンズ スニーカー', 'レディース スニーカー', '白スニーカー', 'ランニングシューズ'] },
  { id: 'lighting', name: '照明', weight: 1, keywords: ['照明 おしゃれ', '間接照明', 'フロアライト', 'デスクライト', 'ペンダントライト', 'LED テープライト'] },
  { id: 'cleaning', name: '掃除グッズ', weight: 1, keywords: ['掃除グッズ', 'コードレス掃除機', 'ロボット掃除機', 'お風呂 掃除', 'フローリングワイパー', 'ハンディクリーナー'] },
  { id: 'travel', name: '旅行グッズ', weight: 1.5, keywords: ['旅行グッズ', 'スーツケース', 'トラベルポーチ', '圧縮袋 旅行', 'ネックピロー', '機内持ち込み バッグ'] },
  { id: 'car', name: '車用品', weight: 1, keywords: ['車用品', '車 スマホホルダー', 'ドライブレコーダー', '車 収納', '車 芳香剤', 'カー用品 便利'] },
  { id: 'phone_acc', name: 'スマホ周辺機器', weight: 1, keywords: ['スマホケース おしゃれ', 'モバイルバッテリー', 'ワイヤレス充電器', 'スマホスタンド', 'MagSafe', '充電ケーブル'] },
  { id: 'desk', name: 'デスク周り', weight: 1.5, keywords: ['デスク周り', 'デスクオーガナイザー', 'モニター台', 'キーボード', 'ケーブル収納', 'デスクマット'] },
  { id: 'disaster', name: '防災グッズ', weight: 1, keywords: ['防災グッズ', '防災セット', 'ポータブル電源', 'LED ランタン', '非常食', '簡易トイレ'] },
  { id: 'outdoor', name: 'アウトドア用品', weight: 1, keywords: ['アウトドア用品', 'キャンプ用品', 'アウトドアチェア', 'ランタン', 'クーラーボックス', 'シェラカップ'] },
  { id: 'pet', name: 'ペット用品', weight: 1, keywords: ['ペット用品', '猫 グッズ', '犬 グッズ', 'ペット ベッド', '猫 爪とぎ', '自動給餌器'] },
  { id: 'gift', name: 'ギフト向け商品', weight: 1, brand: true, keywords: ['ギフト', 'プチギフト', '誕生日プレゼント', '名入れ ギフト', 'ギフトセット おしゃれ', 'プレゼント 雑貨'] },
  { id: 'gourmet', name: 'お取り寄せ食品', weight: 1, keywords: ['お取り寄せ', 'お取り寄せ スイーツ', 'お取り寄せグルメ', 'ご当地グルメ', 'チーズケーキ お取り寄せ'] },
  { id: 'coffee', name: 'コーヒー用品', weight: 1, keywords: ['コーヒー用品', 'コーヒーミル', 'ドリッパー', 'コーヒーメーカー', 'コーヒー豆', 'タンブラー'] },
  { id: 'fitness', name: '筋トレ用品', weight: 1, keywords: ['筋トレ用品', 'ダンベル', 'ヨガマット', 'トレーニングチューブ', 'プッシュアップバー', '腹筋ローラー'] },
  { id: 'sleep', name: '睡眠グッズ', weight: 1, keywords: ['睡眠グッズ', '枕', 'アイマスク', '耳栓', 'ホットアイマスク', 'マットレス'] }
];

// ---- 選ばれやすさの調整（クリック・コピー・投稿などの反応を優先する仕組み） ----
//
// stats は { ジャンルid: { shown, clicked, copied, posted } } の形。
//   shown  : 発掘結果にそのジャンルが出た回数
//   clicked: 「楽天で商品を見る」を押した回数
//   copied : 「紹介文をコピー」を押した回数（ROOM投稿の目安）
//   posted : ROOMに投稿した回数（将来、記録できるようにする予定）
// 反応の良いジャンルほど最大 (1 + MAX_BOOST) 倍まで選ばれやすくなる。
// 反応のないジャンルも基本の重みで選ばれ続けるので、新しいジャンルの発掘も止まらない。
export const ACTION_POINTS = { clicked: 1, copied: 2, posted: 3 };
const MAX_BOOST = 2;
const PRIOR_SHOWN = 3; // 回数が少ないうちは過大評価しないための下駄

export function genreBoost(stat) {
  if (!stat) return 0;
  const points = Object.entries(ACTION_POINTS).reduce((sum, [k, p]) => sum + (stat[k] || 0) * p, 0);
  const rate = points / ((stat.shown || 0) + PRIOR_SHOWN);
  return Math.min(MAX_BOOST, rate);
}

export function genreWeight(genre, stats = {}) {
  return genre.weight * (1 + genreBoost(stats[genre.id]));
}

// ブラウザから送られてきた記録を安全な形に整える
export function sanitizeStats(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const g of GENRES) {
    const s = input[g.id];
    if (!s || typeof s !== 'object') continue;
    const clean = {};
    for (const k of ['shown', 'clicked', 'copied', 'posted']) {
      const n = Math.floor(Number(s[k]));
      if (n > 0) clean[k] = Math.min(n, 100000);
    }
    out[g.id] = clean;
  }
  return out;
}

// 重み付きで、重複なく count 個のジャンルを選ぶ（1つ目が本命、残りは商品が少なかったときの予備）
export function pickGenres(count, stats = {}, random = Math.random) {
  const pool = GENRES.map((g) => ({ g, w: genreWeight(g, stats) }));
  const picked = [];
  while (picked.length < count && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = random() * total;
    let i = 0;
    while (i < pool.length - 1 && r >= pool[i].w) { r -= pool[i].w; i++; }
    picked.push(pool.splice(i, 1)[0].g);
  }
  return picked;
}

export function shuffle(list, random = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
