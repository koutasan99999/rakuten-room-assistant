// 「選び方まとめ」のテーマ一覧。
// 1テーマ = まとめの型（type）＋ 楽天で探す枠（slots）。枠ごとにキーワードと価格帯を決めて商品を集め、
// AIが「どれを・なぜこの順番で・どんな人に」を組み立てる。
// テーマを増やすときは、この一覧に1つ足すだけでよい。

export const CURATION_TYPES = {
  beginner: {
    name: '初心者向け',
    guide: '「最初の1個として無難なもの」→「次に追加すると楽しめるもの」の順に並べる。初心者には不要な高機能品は選ばない。例:「香水初心者ならまずこれ。少し遊びたいなら2本目はこれ。」'
  },
  premium_budget: {
    name: '本命＋安い代替',
    guide: '有名ブランド・定番の本命と、雰囲気や用途が近くてより安い代替品を並べ、見た人が「高い方の良さも分かるし、安い方で十分なパターンも分かる」「自分ならどれか考えやすい」状態にする。単なるコピー商品ではなく、デザイン・用途・雰囲気・サイズ感・機能のうち何が似ているのかを明確にする。本命で何にお金を払っているのか、代替で何を妥協するのかも書く。例:「王道ならこれ。ただし高いので、価格を抑えたいならこちら。」'
  },
  budget_tiers: {
    name: '予算別',
    guide: '同じ用途の商品を低価格・中価格・高価格に分ける。高い商品では何にお金を払っているのか、安い商品では何を妥協するのかを簡潔に書く。'
  },
  first_pick: {
    name: 'まず1個買うなら',
    guide: '選択肢を並べすぎず「迷ったらまずこれ」を1つ決める。その上で「もう少し○○したい人はこれ」という2番手・3番手を出す。'
  },
  gift: {
    name: 'プレゼント',
    guide: '「誰に」「予算」「関係性」「趣味」に合わせて選ぶ。サイズ選びが難しすぎない、好みが極端に分かれない、自分では少し買いにくい、見た目に特別感がある、価格に対して安っぽく見えない、を重視する。'
  },
  use_case: {
    name: '用途別',
    guide: '同じジャンル内で用途ごとに1つずつ選ぶ。それぞれ「この用途ならなぜこれか」が分かるようにする。'
  }
};

// slot: { label: 枠の役割, keyword: 楽天の検索語, minPrice?, maxPrice? }
// audience: プレゼントの相手（年齢・関係性）。brand: ブランドイメージが判断に影響するテーマ
// （プレゼント・本命＋安い代替の型は、指定がなくてもブランド評価をする）
export const THEMES = [
  // 初心者向け
  { id: 'perfume_beginner', type: 'beginner', title: '香水初心者が最初に選ぶなら', brand: true, slots: [
    { label: '最初の1本', keyword: '香水 オードトワレ 30ml', maxPrice: 6000 },
    { label: '2本目で少し遊ぶ', keyword: '香水 ユニセックス オードパルファム', minPrice: 3000, maxPrice: 12000 },
    { label: '安く試す', keyword: '香水 アトマイザー お試し', maxPrice: 3000 }
  ] },
  { id: 'coffee_beginner', type: 'beginner', title: '家でコーヒーを淹れ始めるなら', slots: [
    { label: 'まず揃える', keyword: 'ハンドドリップ セット', maxPrice: 6000 },
    { label: '次に足す', keyword: 'コーヒーミル 手動', maxPrice: 8000 },
    { label: '慣れてきたら', keyword: 'ドリップケトル 温度計', maxPrice: 10000 }
  ] },
  { id: 'homegym_beginner', type: 'beginner', title: '家トレを始めるなら何から買うか', slots: [
    { label: '最初の1個', keyword: 'ヨガマット 厚め', maxPrice: 4000 },
    { label: '次に追加', keyword: 'トレーニングチューブ セット', maxPrice: 3000 },
    { label: '続いたら', keyword: '可変式ダンベル', maxPrice: 15000 }
  ] },
  { id: 'camp_beginner', type: 'beginner', title: 'キャンプ初心者がまず買うもの', slots: [
    { label: '最初の1個', keyword: 'アウトドアチェア 軽量', maxPrice: 6000 },
    { label: '次に追加', keyword: 'LEDランタン 充電式', maxPrice: 5000 },
    { label: '楽しみが広がる', keyword: 'シェラカップ セット', maxPrice: 4000 }
  ] },
  // 本命＋安い代替
  { id: 'lecreuset_alt', type: 'premium_budget', title: 'ル・クルーゼは憧れ。でも安く雰囲気を出すなら', brand: true, slots: [
    { label: '本命ブランド', keyword: 'ルクルーゼ ココットロンド', minPrice: 18000 },
    { label: '本命ブランドの入口', keyword: 'ルクルーゼ ストーンウェア', minPrice: 2000, maxPrice: 10000 },
    { label: '実力派メーカーの代替', keyword: '富士ホーロー 両手鍋', minPrice: 3000, maxPrice: 12000 },
    { label: 'かなり安い代替', keyword: 'ホーロー 両手鍋 鋳物', maxPrice: 5000 },
    { label: '用途違い', keyword: '鋳鉄 スキレット', maxPrice: 6000 }
  ] },
  { id: 'balmuda_alt', type: 'premium_budget', title: 'バルミューダのトースターと、雰囲気が近い安いトースター', slots: [
    { label: '本命ブランド', keyword: 'バルミューダ トースター', minPrice: 20000 },
    { label: '本命ブランドの入口', keyword: 'バルミューダ ケトル', minPrice: 8000, maxPrice: 20000 },
    { label: '実力派メーカーの代替', keyword: 'アラジン グラファイト トースター', minPrice: 9000, maxPrice: 25000 },
    { label: 'かなり安い代替', keyword: 'オーブントースター おしゃれ', maxPrice: 8000 },
    { label: '用途違い', keyword: 'ホットサンドメーカー 電気', maxPrice: 8000 }
  ] },
  { id: 'dyson_alt', type: 'premium_budget', title: 'ダイソンのドライヤーと、価格を抑えた大風量ドライヤー', slots: [
    { label: '本命ブランド', keyword: 'ダイソン ドライヤー', minPrice: 30000 },
    { label: '手が届く本命', keyword: 'パナソニック ナノケア ドライヤー', minPrice: 12000, maxPrice: 35000 },
    { label: '実力派の代替', keyword: 'サロニア ドライヤー', maxPrice: 12000 },
    { label: 'かなり安い代替', keyword: '速乾 ドライヤー 大風量', maxPrice: 5000 },
    { label: '用途違い', keyword: '折りたたみ ドライヤー 旅行', maxPrice: 6000 }
  ] },
  { id: 'iittala_alt', type: 'premium_budget', title: 'イッタラの器と、北欧っぽい雰囲気の手頃な器', brand: true, slots: [
    { label: '本命ブランド', keyword: 'イッタラ ティーマ プレート', minPrice: 2500 },
    { label: 'ギフト向きの本命', keyword: 'イッタラ ギフト ペア', minPrice: 5000 },
    { label: '実力派の代替', keyword: '波佐見焼 取り皿', minPrice: 1000, maxPrice: 4000 },
    { label: 'ワンプレート向き', keyword: 'ワンプレート 皿 北欧', maxPrice: 2500 },
    { label: 'かなり安い代替', keyword: '北欧 小皿 豆皿', maxPrice: 1200 }
  ] },
  { id: 'porter_alt', type: 'premium_budget', title: 'ポーターのショルダーと、手頃なナイロンショルダー', brand: true, slots: [
    { label: '本命ブランド', keyword: 'ポーター ショルダーバッグ', minPrice: 15000 },
    { label: '手が届く本命', keyword: 'ポーター サコッシュ', minPrice: 6000, maxPrice: 16000 },
    { label: '実力派の代替', keyword: 'ノースフェイス ショルダーバッグ', minPrice: 3000, maxPrice: 12000 },
    { label: 'かなり安い代替', keyword: 'ナイロン ショルダーバッグ メンズ 撥水', maxPrice: 4000 },
    { label: '用途違い', keyword: 'ボディバッグ メンズ 軽量', maxPrice: 8000 }
  ] },
  // 予算別
  { id: 'earphone_tiers', type: 'budget_tiers', title: 'ワイヤレスイヤホン、予算別の選び方', slots: [
    { label: '低価格', keyword: 'ワイヤレスイヤホン ノイズキャンセリング', maxPrice: 5000 },
    { label: '中価格', keyword: 'ワイヤレスイヤホン ノイズキャンセリング', minPrice: 8000, maxPrice: 20000 },
    { label: '高価格', keyword: 'ワイヤレスイヤホン ノイズキャンセリング', minPrice: 25000 }
  ] },
  { id: 'suitcase_tiers', type: 'budget_tiers', title: 'スーツケース、予算別に何が違うか', slots: [
    { label: '低価格', keyword: 'スーツケース 機内持ち込み', maxPrice: 8000 },
    { label: '中価格', keyword: 'スーツケース 機内持ち込み', minPrice: 10000, maxPrice: 25000 },
    { label: '高価格', keyword: 'スーツケース 機内持ち込み', minPrice: 35000 }
  ] },
  { id: 'pillow_tiers', type: 'budget_tiers', title: '枕を変えるなら、予算別の選び方', slots: [
    { label: '低価格', keyword: '枕 低反発', maxPrice: 4000 },
    { label: '中価格', keyword: '枕 高さ調整', minPrice: 5000, maxPrice: 12000 },
    { label: '高価格', keyword: '枕 高級', minPrice: 15000 }
  ] },
  { id: 'humidifier_tiers', type: 'budget_tiers', title: '加湿器、予算別に何にお金を払うか', slots: [
    { label: '低価格', keyword: '加湿器 卓上', maxPrice: 4000 },
    { label: '中価格', keyword: '加湿器 ハイブリッド', minPrice: 6000, maxPrice: 15000 },
    { label: '高価格', keyword: '加湿器 おしゃれ 大容量', minPrice: 18000 }
  ] },
  // まず1個買うなら
  { id: 'battery_first', type: 'first_pick', title: 'モバイルバッテリー、まず1個買うなら', slots: [
    { label: '迷ったらこれ', keyword: 'モバイルバッテリー 10000mAh 小型', maxPrice: 4000 },
    { label: 'ケーブルを減らしたい', keyword: 'モバイルバッテリー MagSafe', maxPrice: 6000 },
    { label: '旅行で多めに', keyword: 'モバイルバッテリー 20000mAh', maxPrice: 7000 }
  ] },
  { id: 'kettle_first', type: 'first_pick', title: '電気ケトル、まず1台買うなら', slots: [
    { label: '迷ったらこれ', keyword: '電気ケトル 0.8L', maxPrice: 5000 },
    { label: '見た目重視', keyword: '電気ケトル おしゃれ', minPrice: 5000, maxPrice: 15000 },
    { label: 'コーヒー用', keyword: '電気ケトル 温度調節 ドリップ', maxPrice: 15000 }
  ] },
  { id: 'cleaner_first', type: 'first_pick', title: 'コードレス掃除機、まず1台買うなら', slots: [
    { label: '迷ったらこれ', keyword: 'コードレス掃除機 軽量', maxPrice: 15000 },
    { label: '吸引重視', keyword: 'コードレス掃除機 サイクロン', minPrice: 15000, maxPrice: 40000 },
    { label: 'ちょい掃除用', keyword: 'ハンディクリーナー コードレス', maxPrice: 6000 }
  ] },
  // プレゼント
  { id: 'gift_30s_men', type: 'gift', title: '30代男性へ、5,000円前後のプレゼント', audience: '30代の男性。友人・同僚・パートナーなど。予算5,000円前後', slots: [
    { label: '身につける小物', keyword: 'メンズ キーケース 革 ギフト', minPrice: 3000, maxPrice: 7000 },
    { label: '消耗品', keyword: 'ハンドクリーム メンズ ギフト', minPrice: 2000, maxPrice: 6000 },
    { label: 'ちょっといい日用品', keyword: 'タンブラー 真空 ギフト 名入れ', minPrice: 3000, maxPrice: 7000 }
  ] },
  { id: 'gift_cook', type: 'gift', title: '料理好きへのプレゼント', audience: '料理が好きな大人（年齢・性別は問わない）。友人や家族', slots: [
    { label: '消えもの', keyword: 'オリーブオイル ギフト セット', minPrice: 2500, maxPrice: 7000 },
    { label: '道具', keyword: 'キッチンツール ギフト 木製', minPrice: 2000, maxPrice: 8000 },
    { label: '少し特別', keyword: 'スパイス セット ギフト', minPrice: 2000, maxPrice: 6000 }
  ] },
  { id: 'gift_newlife', type: 'gift', title: '一人暮らしを始める人へのプレゼント', audience: '一人暮らしを始める10代後半〜20代。後輩・友人・家族', slots: [
    { label: '毎日使う', keyword: '今治タオル ギフト', minPrice: 2000, maxPrice: 6000 },
    { label: '部屋が整う', keyword: 'ルームフレグランス ギフト', minPrice: 2000, maxPrice: 6000 },
    { label: '暮らしの道具', keyword: 'コーヒードリッパー セット ギフト', minPrice: 2000, maxPrice: 6000 }
  ] },
  { id: 'gift_consumable', type: 'gift', title: 'センスのいい消耗品ギフト', audience: '友人・同僚・取引先など幅広い相手。年齢は問わない', slots: [
    { label: 'お風呂', keyword: '入浴剤 ギフト おしゃれ', minPrice: 1500, maxPrice: 5000 },
    { label: '手元', keyword: 'ハンドソープ ギフト 高級', minPrice: 1500, maxPrice: 5000 },
    { label: '食べもの', keyword: 'ドリップコーヒー ギフト おしゃれ', minPrice: 1500, maxPrice: 5000 }
  ] },
  { id: 'gift_wont_buy', type: 'gift', title: '自分では買わないけど、もらうと嬉しいもの', audience: '30〜40代の大人。友人・家族・お世話になった人', slots: [
    { label: '少し高いタオル', keyword: 'バスタオル 高級 ギフト', minPrice: 4000, maxPrice: 10000 },
    { label: 'いいペン', keyword: 'ボールペン 高級 ギフト', minPrice: 3000, maxPrice: 10000 },
    { label: 'いい靴下', keyword: '靴下 ギフト 高級 メンズ', minPrice: 2000, maxPrice: 6000 }
  ] },
  // 用途別
  { id: 'perfume_usecase', type: 'use_case', title: '香水、用途別にどれを選ぶか', brand: true, slots: [
    { label: '仕事用', keyword: '香水 石鹸の香り', maxPrice: 8000 },
    { label: 'デート用', keyword: '香水 甘い ムスク', maxPrice: 10000 },
    { label: '休日用', keyword: '香水 シトラス', maxPrice: 8000 },
    { label: '少し個性的', keyword: '香水 ウッディ ユニセックス', maxPrice: 15000 }
  ] },
  { id: 'tableware_usecase', type: 'use_case', title: '食器、用途別にまず揃えるなら', brand: true, slots: [
    { label: 'まず揃える', keyword: '食器 セット 北欧 シンプル', maxPrice: 6000 },
    { label: '朝食用', keyword: 'ワンプレート 皿 おしゃれ', maxPrice: 3000 },
    { label: '来客用', keyword: 'ワイングラス ペア', maxPrice: 6000 },
    { label: '高級ブランド', keyword: 'イッタラ 食器', minPrice: 3000 }
  ] },
  { id: 'appliance_usecase', type: 'use_case', title: 'キッチン家電、用途別の選び方', slots: [
    { label: '最低限これ', keyword: '電子レンジ 単機能 シンプル', maxPrice: 15000 },
    { label: '時短重視', keyword: '電気圧力鍋', maxPrice: 20000 },
    { label: '見た目重視', keyword: 'トースター おしゃれ レトロ', maxPrice: 15000 },
    { label: 'コスパ重視', keyword: 'ホットサンドメーカー', maxPrice: 5000 }
  ] }
];

export function pickTheme(type, random = Math.random) {
  const pool = type && CURATION_TYPES[type] ? THEMES.filter((t) => t.type === type) : THEMES;
  return pool[Math.floor(random() * pool.length)];
}

export function isBrandTheme(theme) {
  return theme.brand || theme.type === 'gift' || theme.type === 'premium_budget';
}
