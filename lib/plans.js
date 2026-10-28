// Instagram「眼科医くま」の最初の10投稿の企画。
// アカウントの役割は「商品を大量におすすめする」ことではなく「結局どれを選べばいいかを整理する」こと。
// タイトルは「○○について 本気出して考えてみた」シリーズ。
//
// 各企画は「選び方まとめ」のテーマと同じ形（type・slots）なので、そのまま /api/curate で作れる。
// 枠（slots）の label がそのまま各商品の役割になり、1枠から1商品ずつ選ぶ。
// postType は投稿タイプのローテーション（本命＋代替・まずコレ・初心者向け・プレゼント・価格縛り・トレンド）。

export const SERIES_PLANS = [
  {
    id: 'plan01_shussan', no: 1, topic: '出産祝い', category: '出産祝い', postType: 'プレゼント', type: 'gift', brand: true,
    audience: '出産したばかりの友人・同僚。予算は3,000〜15,000円くらい',
    purpose: '友人への出産祝いで迷っている人向け',
    slots: [
      { label: '迷ったらこれ', keyword: '出産祝い 今治タオル ギフト', minPrice: 3000, maxPrice: 8000 },
      { label: '実用性重視', keyword: '出産祝い スタイ ガーゼ セット', minPrice: 2000, maxPrice: 6000 },
      { label: 'もらうと嬉しい', keyword: '出産祝い 名入れ 木のおもちゃ', minPrice: 3000, maxPrice: 10000 },
      { label: 'センス重視', keyword: '出産祝い ベビー 北欧 おしゃれ', minPrice: 3000, maxPrice: 10000 },
      { label: '価格を抑えるなら', keyword: '出産祝い プチギフト', maxPrice: 3000 },
      { label: '少し奮発するなら', keyword: '出産祝い ブランド ベビー ギフトセット', minPrice: 10000, maxPrice: 25000 }
    ]
  },
  {
    id: 'plan02_kozara', no: 2, topic: '小皿', subtitle: '― 高い本命と安い代替 ―', category: '小皿', postType: '本命＋代替', type: 'premium_budget', brand: true,
    purpose: '食器初心者でも、ブランドと価格差を理解して選べるようにする',
    slots: [
      { label: 'ブランド込みの本命', keyword: 'イッタラ ティーマ 15cm プレート', minPrice: 2000 },
      { label: '本命より少し手頃', keyword: '白山陶器 小皿', minPrice: 1000, maxPrice: 4000 },
      { label: 'コスパ代替', keyword: '北欧 小皿 豆皿', maxPrice: 1200 },
      { label: '普段使い向け', keyword: '取り皿 小皿 セット 電子レンジ対応', maxPrice: 3000 },
      { label: 'ギフト向け', keyword: '小皿 ギフト セット 箱入り', minPrice: 3000, maxPrice: 8000 },
      { label: '迷ったらこれ', keyword: '小皿 白 シンプル 15cm', minPrice: 800, maxPrice: 3000 }
    ]
  },
  {
    id: 'plan03_iphone', no: 3, topic: 'iPhoneアクセ', category: 'iPhoneアクセ', postType: 'まずコレ', type: 'first_pick',
    purpose: '便利グッズ系で、保存・購入につなげる',
    slots: [
      { label: '充電器', keyword: 'Anker 充電器 USB-C 20W', maxPrice: 4000 },
      { label: 'ケーブル', keyword: 'USB-C ライトニング ケーブル 編み込み', maxPrice: 3000 },
      { label: 'スタンド', keyword: 'スマホスタンド アルミ 卓上 折りたたみ', maxPrice: 4000 },
      { label: 'モバイルバッテリー', keyword: 'モバイルバッテリー MagSafe 薄型', maxPrice: 7000 },
      { label: 'AirTag系', keyword: 'AirTag ケース', maxPrice: 3000 },
      { label: '迷ったらこれ', keyword: 'MagSafe 充電スタンド', maxPrice: 8000 }
    ]
  },
  {
    id: 'plan04_kosui', no: 4, topic: '香水初心者', category: '香水', postType: '初心者向け', type: 'beginner', brand: true,
    purpose: '香水を知らない人でも選べる投稿',
    slots: [
      { label: '最初の1本', keyword: '香水 オードトワレ 30ml', maxPrice: 8000 },
      { label: '仕事用', keyword: '香水 石鹸 ムスク', maxPrice: 9000 },
      { label: '休日用', keyword: '香水 シトラス ユニセックス', maxPrice: 9000 },
      { label: 'デート用', keyword: '香水 オードパルファム 甘い', maxPrice: 12000 },
      { label: '少し遊ぶなら', keyword: '香水 ウッディ ユニセックス', maxPrice: 20000 },
      { label: '価格を抑えるなら', keyword: '香水 ミニサイズ お試し', maxPrice: 3000 }
    ]
  },
  {
    id: 'plan05_men30', no: 5, topic: '30代男性へのプレゼント', category: 'プレゼント', postType: 'プレゼント', type: 'gift', brand: true,
    audience: '30代の男性（友人・同僚・パートナー）。ブランド選びに自信がない人が贈る',
    purpose: 'ブランド選びに自信がない人向け',
    slots: [
      { label: '外しにくい王道', keyword: 'メンズ キーケース 本革 ブランド', minPrice: 5000, maxPrice: 15000 },
      { label: 'センス良く見える', keyword: 'タンブラー 真空断熱 ブランド ギフト', minPrice: 3000, maxPrice: 9000 },
      { label: '実用品', keyword: '名刺入れ メンズ 本革', minPrice: 3000, maxPrice: 10000 },
      { label: 'もらうと嬉しい', keyword: 'バスタオル 高級 ギフト', minPrice: 4000, maxPrice: 10000 },
      { label: '5,000円前後', keyword: 'メンズ ギフト 雑貨 おしゃれ', minPrice: 4000, maxPrice: 6500 },
      { label: '1万円前後', keyword: 'メンズ 財布 ブランド 本革', minPrice: 8000, maxPrice: 13000 }
    ]
  },
  {
    id: 'plan06_1500', no: 6, topic: '1,500円以下で試せる便利グッズ', category: '1,500円以下', postType: '価格縛り', type: 'first_pick',
    purpose: '低価格商品の購入ハードルを下げる',
    note: '安いだけの商品ではなく、「ちょっと面白い」「失敗しても許せる価格」の商品を選ぶ。この企画に限り、無名ブランドでもアイデアや構造に面白さがあれば選んでよい',
    slots: [
      { label: 'キッチン', keyword: 'キッチン 便利グッズ アイデア', maxPrice: 1500 },
      { label: '収納', keyword: '収納 便利グッズ アイデア', maxPrice: 1500 },
      { label: '掃除', keyword: '掃除 便利グッズ アイデア', maxPrice: 1500 },
      { label: 'デスク', keyword: 'デスク 便利グッズ ケーブル', maxPrice: 1500 },
      { label: '旅行', keyword: '旅行 便利グッズ 小物', maxPrice: 1500 },
      { label: '迷ったらこれ', keyword: 'アイデア 便利グッズ 話題', maxPrice: 1500 }
    ]
  },
  {
    id: 'plan07_charger', no: 7, topic: '充電器', subtitle: '― 高い本命と安い代替 ―', category: '充電器', postType: '本命＋代替', type: 'premium_budget',
    purpose: 'Anker・UGREEN・CIOなど信頼できる商品を中心に価格差を整理する',
    note: '比較ポイントは「最大出力・ポート数・サイズ・ブランド信頼度・価格」。無名の安価品は選ばず、Anker・UGREEN・CIOなど信頼できるメーカーを中心にする',
    slots: [
      { label: 'ブランド込みの本命', keyword: 'Anker Prime 充電器', minPrice: 6000 },
      { label: '本命より少し手頃', keyword: 'UGREEN Nexode 充電器 65W', minPrice: 3000, maxPrice: 9000 },
      { label: '小さく持ち歩くなら', keyword: 'CIO NovaPort 充電器', minPrice: 2500, maxPrice: 8000 },
      { label: 'ポート数重視', keyword: 'Anker 充電器 3ポート 65W', minPrice: 4000, maxPrice: 10000 },
      { label: 'コスパ代替', keyword: 'Anker Nano 充電器 30W', maxPrice: 4000 },
      { label: '迷ったらこれ', keyword: 'UGREEN 充電器 45W 2ポート', maxPrice: 6000 }
    ]
  },
  {
    id: 'plan08_ureshii', no: 8, topic: '自分では買わないけど、もらうと嬉しいもの', category: 'ギフト', postType: 'プレゼント', type: 'gift', brand: true,
    audience: '友人・家族・お世話になった人（年齢は問わない）',
    purpose: 'ギフト需要を取る',
    slots: [
      { label: '少し良いタオル', keyword: '今治タオル バスタオル ギフト', minPrice: 3000, maxPrice: 10000 },
      { label: '香りもの', keyword: 'ルームフレグランス ディフューザー ギフト', minPrice: 3000, maxPrice: 9000 },
      { label: '食器', keyword: 'マグカップ ペア ギフト ブランド', minPrice: 3000, maxPrice: 10000 },
      { label: 'タンブラー', keyword: 'タンブラー 真空断熱 ギフト 名入れ', minPrice: 3000, maxPrice: 8000 },
      { label: '革小物', keyword: '本革 カードケース ギフト', minPrice: 4000, maxPrice: 12000 },
      { label: '高級日用品', keyword: 'ハンドソープ 高級 ギフト', minPrice: 2500, maxPrice: 8000 }
    ]
  },
  {
    id: 'plan09_hitorigurashi', no: 9, topic: '一人暮らしで最初に買うもの', category: '一人暮らし', postType: 'まずコレ', type: 'first_pick',
    purpose: '生活用品を「まずこれ」で整理する',
    slots: [
      { label: 'キッチン', keyword: '電気ケトル シンプル 0.8L', maxPrice: 6000 },
      { label: '収納', keyword: '収納ボックス フタ付き 積み重ね', maxPrice: 4000 },
      { label: '掃除', keyword: 'コードレス掃除機 スティック 軽量', maxPrice: 15000 },
      { label: '充電', keyword: '電源タップ USB付き おしゃれ', maxPrice: 4000 },
      { label: '寝具', keyword: '枕 高さ調整', maxPrice: 6000 },
      { label: '便利グッズ', keyword: '一人暮らし 便利グッズ', maxPrice: 3000 }
    ]
  },
  {
    id: 'plan10_10000', no: 10, topic: '1万円以下で満足度が高いもの', category: '1万円以下', postType: '価格縛り', type: 'first_pick', brand: true,
    purpose: 'ジャンル横断型の発掘。「自分ならこれに1万円払う」と思えるものを選ぶ',
    note: 'すべて1万円以下。家電・食器・香水・ガジェット・インテリアなどジャンルが混ざってよい。安さではなく「この値段でこの満足度なら払う」で選ぶ',
    slots: [
      { label: '家電', keyword: '電気ケトル 温度調節', minPrice: 4000, maxPrice: 10000 },
      { label: '食器', keyword: 'イッタラ マグ', minPrice: 2000, maxPrice: 10000 },
      { label: '香水', keyword: '香水 オードパルファム 50ml', minPrice: 4000, maxPrice: 10000 },
      { label: 'ガジェット', keyword: 'ワイヤレスイヤホン ノイズキャンセリング', minPrice: 5000, maxPrice: 10000 },
      { label: 'インテリア', keyword: '間接照明 フロアライト', minPrice: 4000, maxPrice: 10000 },
      { label: 'キッチン', keyword: '電動 コーヒーミル', minPrice: 3000, maxPrice: 10000 }
    ]
  }
];

// 企画を「選び方まとめ」のテーマとして使える形にする
export function planToTheme(plan) {
  const roles = plan.slots.map((s) => s.label).join('／');
  return {
    id: plan.id,
    type: plan.type,
    title: `${plan.topic}について本気出して考えてみた`,
    audience: plan.audience || '',
    brand: !!plan.brand,
    plan: { id: plan.id, no: plan.no, topic: plan.topic, subtitle: plan.subtitle || '', category: plan.category, postType: plan.postType },
    request: [
      `Instagram「眼科医くま」の企画${plan.no}「${plan.topic}について本気出して考えてみた」${plan.subtitle ? ` ${plan.subtitle}` : ''}`,
      `目的: ${plan.purpose}`,
      plan.note ? `この企画のルール: ${plan.note}` : '',
      `構成: 枠の名前（${roles}）をそのまま各商品の役割（role）にして、1枠から1個ずつ選ぶ。合う商品が無い枠は飛ばしてよい`,
      '各商品に「なぜこれを選ぶのか」（why・pick）と「誰ならこれを選ぶべきか」（forWho）を必ず書く。「おすすめ○選」のような並べ方にしない'
    ].filter(Boolean).join('\n'),
    slots: plan.slots
  };
}

export function findPlan(id) {
  return SERIES_PLANS.find((p) => p.id === id) || null;
}
