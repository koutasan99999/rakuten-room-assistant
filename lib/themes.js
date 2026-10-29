// 「選び方まとめ」のテーマ一覧。
// 1テーマ = まとめの型（type）＋ 楽天で探す枠（slots）。枠ごとにキーワードと価格帯を決めて商品を集め、
// AIが「どれを・なぜこの順番で・どんな人に」を組み立てる。
// テーマを増やすときは、この一覧に1つ足すだけでよい。

// 選び方の型。desc は選択画面に出す短い説明、guide はAIへの指示、roles はこの型で候補一覧に混ぜたい役割の例
export const CURATION_TYPES = {
  omakase: {
    name: 'おまかせ',
    desc: 'AIに選び方も任せる',
    guide: 'テーマに一番合う選び方をAIが決める。本命・代替・変わり種・トレンドなどを自然に混ぜる。',
    roles: ['本命', '2番手', 'コスパ', '安い代替', '変わり種', 'トレンド枠', '知っておきたい']
  },
  first_pick: {
    name: 'まずコレ',
    desc: '「結局1個ならどれ？」に答える',
    guide: '「迷ったらまずこれ」を決められるよう、本命候補を複数と、もう少し○○したい人向けの2番手・3番手を出す。',
    roles: ['本命', '2番手', '王道', 'コスパ', '少し奮発', '実用品']
  },
  premium_budget: {
    name: '本命と代替',
    desc: 'ちゃんと高い理由がある本命と、価格を抑えた別解',
    guide: '有名ブランド・定番の本命と、雰囲気や用途が近くてより安い代替品の両方を出す。単なるコピー商品ではなく、デザイン・用途・雰囲気・サイズ感・機能のうち何が似ているのかが説明できるものにする。本命は「なぜ高いのか」、代替は「何を妥協するのか」が分かるようにする。',
    roles: ['本命', 'ブランド枠', '少し奮発', '安い代替', 'コスパ', '失敗しても許せる価格']
  },
  budget_tiers: {
    name: '予算で比較',
    desc: '3,000円 / 5,000円 / 1万円など価格別',
    guide: '同じ用途の商品を低価格・中価格・高価格に分けて出す。価格帯がばらけるようにし、高い商品は何にお金を払っているのか、安い商品は何を妥協するのかが分かるものにする。',
    roles: ['失敗しても許せる価格', 'コスパ', '2番手', '本命', '少し奮発']
  },
  gift: {
    name: 'プレゼント',
    desc: '相手・年齢・関係性から選ぶ',
    guide: '「誰に」「予算」「関係性」「趣味」に合わせる。サイズ選びが難しすぎない、好みが極端に分かれない、自分では少し買いにくい、見た目に特別感がある、価格に対して安っぽく見えない、を重視する。消耗品・実用品・記念品・体験寄りなど、贈り物の種類も散らす。',
    roles: ['プレゼント向き', '王道', 'ブランド枠', '実用品', '変わり種', '少し奮発']
  },
  beginner: {
    name: '初心者セット',
    desc: '1個目 / 2個目 / 遊び枠',
    guide: '「最初の1個として無難なもの」→「次に追加すると楽しめるもの」→「慣れたら遊べるもの」が揃うようにする。初心者には不要な高機能品は選ばない。',
    roles: ['本命', '2番手', 'コスパ', '変わり種', '知っておきたい']
  },
  use_case: {
    name: '用途で選ぶ',
    desc: '仕事用 / 家用 / 旅行用など',
    guide: '同じジャンル内で用途（仕事用・家用・旅行用・休日用など）が違う商品を出し、それぞれ「この用途ならなぜこれか」が分かるようにする。',
    roles: ['本命', '実用品', 'コスパ', '2番手', '変わり種']
  },
  brand: {
    name: 'ブランドから選ぶ',
    desc: '王道 / 新興 / 知っておきたいブランド',
    guide: 'ブランドの背景で選ぶ。誰もが知る王道ブランド、伸びている新興ブランド、知っていると少しセンスが良く見えるブランドを混ぜる。同じブランドは2個まで。',
    roles: ['王道', 'ブランド枠', '知っておきたい', 'トレンド枠', 'コスパ']
  },
  value: {
    name: 'コスパ重視',
    desc: '安いだけでなく、価格に対して満足度が高い',
    guide: '安さだけで選ばない。素材・作り・機能・メーカーの実績など、価格以上の理由が説明できるものを出す。無名で安いだけの商品は入れない。',
    roles: ['コスパ', '安い代替', '実用品', '失敗しても許せる価格', '2番手']
  },
  trend: {
    name: 'トレンド',
    desc: '最近よく見るもの、SNS・テレビなどで話題のもの',
    guide: '最近よく見る・話題になっているもの。根拠（商品情報の記載や広く知られたトレンド）があるものだけにし、「話題」と書くなら商品情報から読み取れる範囲にとどめる。',
    roles: ['トレンド枠', '知っておきたい', '変わり種', 'コスパ', '王道']
  },
  unusual: {
    name: '変わり種',
    desc: '王道から少し外れるけど面白いもの',
    guide: '王道から少し外れるが「こんなのもあるのか」と思えるもの。奇抜なだけでなく、ちゃんと使い道や選ぶ理由があるものにする。',
    roles: ['変わり種', '個人的に気になる', '知っておきたい', '失敗しても許せる価格']
  },
  // 新商品専用（新作・予約・再販レーダーから作る企画）。条件指定の選択肢には出さない
  new_release: {
    name: '新商品',
    desc: '新作・予約・再販を、何それ？と思わせる形で',
    hidden: true,
    guide: '新作・予約受付中・発売予定・再販・限定・コラボ・新色の商品を中心に選ぶ。起点の商品と同じジャンル・同じブランドの新作、今月の新作など「今動いている」商品を優先し、定番の旧モデルばかりにしない。',
    roles: ['本命', 'トレンド枠', '知っておきたい', '変わり種', 'コスパ', '少し奮発']
  },
  must_buy: {
    name: '買っとけ',
    desc: '防災用品・便利グッズなど「最低限これだけ」',
    guide: '「最初にこれを揃えれば大丈夫」という最低限のものを、商品の種類が重ならないように出す（同じ種類の商品ばかりにしない）。防災グッズは不安を煽らず、「何を揃えればいいか分からない」を整理する。',
    roles: ['本命', '実用品', 'コスパ', '2番手', '知っておきたい']
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
  return theme.brand || ['gift', 'premium_budget', 'brand'].includes(theme.type);
}
