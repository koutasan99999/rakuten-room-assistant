// Instagram「眼科医くま」の企画データベース。
// 毎回同じ商品・同じ企画にならず「今日はこんなのあるんだ」と思える幅を持たせるため、
// 企画を考えるときに、ここからジャンルと投稿の型を選んでAIに渡す。

// 商品ジャンル（brandImportant: ブランド背景が購買判断に効くジャンル）
export const CATALOG = [
  {
    id: 'kitchen', name: '食器・キッチン', brandImportant: true,
    items: ['小皿', '大皿', '取り皿', 'マグカップ', 'グラス', 'カトラリー', 'お椀', '箸', '保存容器', '弁当箱', 'フライパン', '包丁', 'まな板', '電気ケトル', 'トースター', '炊飯器', 'コーヒー器具'],
    brands: ['iittala', 'ARABIA', 'HASAMI PORCELAIN', 'KINTO', 'Cutipol', '柳宗理', 'RIEDEL', '木村硝子', 'HARIO', 'Kalita', 'BALMUDA', 'Aladdin', 'GLOBAL', '関孫六', 'Vermicular']
  },
  {
    id: 'appliance', name: '家電・生活家電', brandImportant: false,
    items: ['掃除機', 'ドライヤー', 'ヘアアイロン', '加湿器', '空気清浄機', '照明', 'デスクライト', 'ゴミ箱', '収納用品'],
    brands: ['Dyson', 'Shark', 'ReFa', 'SALONIA', 'BALMUDA', '山善', 'cado', '象印', 'simplehuman', '山崎実業'],
    pairs: ['Dyson vs Shark', 'ReFa vs SALONIA', 'BALMUDA vs 山善', 'cado vs 象印', 'simplehuman vs 山崎実業']
  },
  {
    id: 'gadget', name: 'ガジェット', brandImportant: false,
    items: ['急速充電器', 'USB-Cケーブル', 'モバイルバッテリー', 'スマホスタンド', 'スマートタグ', 'イヤホン', 'スピーカー', 'キーボード', 'マウス', 'PCケース', 'AirPodsケース'],
    brands: ['Anker', 'UGREEN', 'CIO', 'Apple', 'MOFT', 'ESR', 'Spigen', 'Bose', 'Sony', 'Soundcore', 'Marshall', 'JBL', 'Logicool', 'Keychron', 'HHKB']
  },
  {
    id: 'fashion', name: 'ファッション', brandImportant: true,
    items: ['スニーカー', '革靴', 'サンダル', '白T', 'ニット', 'アウター', 'バッグ', '財布', 'カードケース', '名刺入れ', 'キーケース', '眼鏡', 'サングラス', '腕時計'],
    brands: ['Onitsuka Tiger', 'New Balance', 'adidas', 'MoonStar', 'REGAL', 'Paraboot', 'Birkenstock', 'Teva', 'TUMI', 'Aer', 'PORTER', 'IL BISONTE', 'GANZO', 'Maison Margiela', 'LOEWE', 'SEIKO', 'Citizen', 'TISSOT', 'Ray-Ban', 'Oliver Peoples', 'EYEVAN', 'JINS', 'Zoff']
  },
  {
    id: 'scent', name: '香り・美容', brandImportant: true,
    items: ['香水', 'ルームフレグランス', 'キャンドル', 'ハンドソープ', 'ハンドクリーム', 'ボディソープ'],
    brands: ['Le Labo', 'Diptyque', 'Jo Malone', 'Aesop', 'Byredo', 'SHIRO', 'AUX PARADIS', "L'OCCITANE", 'MARKS&WEB']
  },
  {
    id: 'travel', name: '旅行・アウトドア', brandImportant: false,
    items: ['スーツケース', 'バックパック', '旅行ポーチ', 'パッキングキューブ', 'ネックピロー', 'アイマスク', 'タンブラー', '水筒', 'アウトドアチェア', 'キャンプテーブル', 'ランタン'],
    brands: ['RIMOWA', 'ACE', 'innovator', 'Peak Design', 'Aer', '無印良品', 'STANLEY', 'YETI', 'THERMOS', 'Hydro Flask', 'Helinox', 'Coleman', 'Snow Peak']
  },
  {
    id: 'living', name: '寝具・生活', brandImportant: false,
    items: ['枕', 'マットレス', '寝具', 'ルームウェア', 'タオル', 'ハンガー', '収納ケース', 'ティッシュケース', 'サイドテーブル', '時計', '花瓶'],
    brands: []
  },
  {
    id: 'baby', name: 'ベビー・出産祝い', brandImportant: true,
    items: ['スタイ', 'ベビー食器', 'おくるみ', 'タオル', 'おもちゃ', 'ブランケット', 'ママ・パパ向けギフト'],
    brands: ['MARLMARL', 'familiar', 'Aden + Anais', 'Le Creuset Baby', 'ezpz', 'Richell', 'OXO Tot', '今治系ブランド']
  },
  {
    id: 'gift', name: 'プレゼント', brandImportant: true,
    items: ['30代男性', '30代女性', '出産祝い', '結婚祝い', '新築祝い', '医療従事者', '5,000円予算', '1万円予算', '自分では買わないけど、もらうと嬉しいもの', '消耗品', 'ブランド小物', '実用品の上質版'],
    brands: []
  },
  {
    id: 'stationery', name: '文房具・仕事', brandImportant: true,
    items: ['ボールペン', '万年筆', 'ノート', '名刺入れ', 'PCアクセサリ', 'デスク収納'],
    brands: ['LAMY', 'PARKER', 'CROSS', 'PILOT', 'Montblanc', 'Moleskine', 'Leuchtturm', 'MD Notebook']
  }
];

// 投稿の型（ローテーションする）。curation: 選び方まとめのどの型で商品を選ぶか
export const POST_TYPES = [
  { id: 'premium_alt', name: '本命＋安い代替', curation: 'premium_budget', note: '比較軸を毎回変える（ブランド価値 vs コスパ／所有満足感 vs 実用性／ギフト向け vs 普段使い／見た目重視 vs 手入れのしやすさ／王道ブランド vs 新興ブランド／高級素材 vs 気軽な素材／長く使う本命 vs まず試す代替）' },
  { id: 'first', name: 'まずコレ', curation: 'first_pick', note: '迷ったらまずこれ、を1つ決め、もう少し○○したい人の2番手以降を出す' },
  { id: 'beginner', name: '初心者向け', curation: 'beginner', note: '最初の1個として無難なもの → 次に足すと楽しめるもの。初心者に不要な高機能品は避ける' },
  { id: 'gift', name: 'プレゼントならコレ', curation: 'gift', note: '誰に・予算・関係性に合わせ、渡して不自然でないもの' },
  { id: 'budget', name: '予算別', curation: 'budget_tiers', note: '同じ用途を低・中・高価格で。高い方は何にお金を払っているか' },
  { id: 'brand_vs_cost', name: 'ブランド重視 vs コスパ重視', curation: 'premium_budget', note: 'ブランドで選ぶ側と、コスパで選ぶ側を並べ、どんな人ならどちらかが分かるようにする' },
  { id: 'look_vs_use', name: '見た目重視 vs 実用重視', curation: 'premium_budget', note: '見た目で選ぶ側と、実用で選ぶ側を並べる' },
  { id: 'wont_buy', name: '自分では買わないけど、もらうと嬉しい', curation: 'gift', note: '自分では後回しにするけど、もらうと嬉しい少し上質なもの' },
  { id: 'forgiving', name: '失敗しても許せる価格', curation: 'first_pick', note: '安いだけでなく「ちょっと面白い」「失敗しても許せる」価格のもの。無名でも独自性があれば可' },
  { id: 'trend', name: '最近流行っているもの', curation: 'first_pick', note: '今流行っている・話題のもの。根拠（商品情報の記載や広く知られたトレンド）があるものだけ' },
  { id: 'classic_vs_play', name: '王道 vs 少し遊ぶ', curation: 'use_case', note: '外さない王道と、少し遊び心のある選択肢を並べる' },
  { id: 'first_second', name: '最初の1個 vs 2個目', curation: 'beginner', note: '最初の1個と、慣れてから買い足す2個目' },
  { id: 'work_holiday', name: '仕事用 vs 休日用', curation: 'use_case', note: '仕事で使うものと、休日に使うものを分ける' },
  { id: 'gift_self', name: 'ギフト用 vs 自分用', curation: 'gift', note: '贈るならこれ、自分用ならこれ、を分ける' },
  { id: 'solo', name: '一人暮らし向け', curation: 'first_pick', note: '一人暮らしで最初に・あると楽になるもの' },
  { id: 'trip', name: '旅行向け', curation: 'first_pick', note: '旅行前に買っておくと楽なもの' },
  { id: 'age30', name: '30代向け', curation: 'first_pick', note: '30代が持って背伸びしすぎず、若すぎないもの' },
  { id: 'why_expensive', name: '高い理由を知りたい', curation: 'budget_tiers', note: '高いものは何にお金を払っているのかを、安いものと比べて分かるようにする' },
  { id: 'cheap_reason', name: '安いけどちゃんと選ぶ理由がある', curation: 'first_pick', note: '安いけれど、安さ以外に選ぶ理由がはっきりあるもの' },
  { id: 'brand_now', name: '今知っておきたいブランド', curation: 'use_case', note: '定番ブランドと、今知っておきたい新興ブランドを紹介する' }
];

export function findPostType(nameOrId) {
  return POST_TYPES.find((t) => t.id === nameOrId || t.name === nameOrId) || null;
}

// 直近の履歴を見て、最近使っていないものほど選ばれやすくする（重み付きの抽選）
function weightedPick(list, keyOf, recentKeys, random) {
  const weights = list.map((x) => {
    const idx = recentKeys.indexOf(keyOf(x)); // 0 = いちばん最近
    if (idx === -1) return 6;
    return Math.max(0.2, idx * 0.5); // 最近使ったものほど小さく
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

// 企画3案の「たたき台」を作る：ジャンルと投稿の型が3案ともかぶらず、直近の履歴とも離れるように選ぶ
// history: 新しい順の [{ genre, postType, ... }]
export function sampleIdeaSeeds(history = [], count = 3, random = Math.random) {
  const recentGenres = history.map((h) => h.genre).filter(Boolean);
  const recentTypes = history.map((h) => h.postType).filter(Boolean);
  const seeds = [];
  const usedGenres = new Set();
  const usedTypes = new Set();
  for (let i = 0; i < count; i++) {
    const genres = CATALOG.filter((c) => !usedGenres.has(c.id));
    const types = POST_TYPES.filter((t) => !usedTypes.has(t.id));
    const genre = weightedPick(genres, (c) => c.name, recentGenres, random);
    const type = weightedPick(types, (t) => t.name, recentTypes, random);
    usedGenres.add(genre.id);
    usedTypes.add(type.id);
    // ジャンルの中の品目も3つほど候補として渡す（毎回違う品目に目が行くように）
    const items = [...genre.items].sort(() => random() - 0.5).slice(0, 3);
    seeds.push({ genre, type, items });
  }
  return seeds;
}

export function seasonOf(date = new Date()) {
  const m = date.getMonth() + 1;
  const events = { 1: '新年・冬', 2: 'バレンタイン・冬', 3: '新生活準備・春', 4: '新生活・春', 5: '母の日・初夏', 6: '父の日・梅雨', 7: '夏・旅行', 8: '夏休み・旅行', 9: '秋・敬老の日', 10: '秋', 11: '冬支度・ギフト準備', 12: 'クリスマス・年末ギフト' };
  return `${m}月（${events[m]}）`;
}
