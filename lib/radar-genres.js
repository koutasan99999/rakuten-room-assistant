// 新作・予約レーダーで見るジャンル。ジャンルはここに1行足すだけで増やせる。
// keyword: 楽天で探すときのジャンルの言葉、brands: おすすめブランド候補（フォロー・非表示を選べる）
// ng: そのジャンルに混ざりやすい別の商品の言葉（例：アクセサリーにカー用品）。商品名に入っていたら、そのジャンルの結果から外す
export const RADAR_GROUPS = [
  { id: 'fashion', label: 'ファッション' },
  { id: 'appliance', label: '家電' },
  { id: 'gadget', label: 'ガジェット' },
  { id: 'living', label: '生活用品' },
  { id: 'other', label: 'その他' }
];

export const RADAR_GENRES = [
  { id: 'mens', group: 'fashion', label: 'メンズ', keyword: 'メンズ ジャケット', brands: ['BEAMS', 'UNITED ARROWS', 'SHIPS', 'nano・universe', 'Champion'] },
  { id: 'ladies', group: 'fashion', label: 'レディース', keyword: 'レディース ワンピース', brands: ['SNIDEL', 'FRAY I.D', 'URBAN RESEARCH', 'IENA'] },
  { id: 'sneaker', group: 'fashion', label: 'スニーカー', keyword: 'スニーカー', brands: ['New Balance', 'adidas', 'NIKE', 'Onitsuka Tiger', 'ASICS', 'VANS'] },
  { id: 'shoes', group: 'fashion', label: '靴', keyword: 'ブーツ', brands: ['Dr.Martens', 'REGAL', 'Clarks', 'BIRKENSTOCK'] },
  { id: 'bag', group: 'fashion', label: 'バッグ', keyword: 'バッグ', brands: ['PORTER', 'MASTER-PIECE', 'THE NORTH FACE', 'Aer'] },
  { id: 'wallet', group: 'fashion', label: '財布', keyword: '財布', brands: ['GANZO', '土屋鞄', 'PORTER', 'abrAsus'] },
  { id: 'accessory', group: 'fashion', label: 'アクセサリー', keyword: 'アクセサリー ネックレス', brands: ['agete', 'ete', 'STAR JEWELRY'], ng: ['カー用品', 'カーアクセサリー', '車用', '車載', '自動車', 'カーナビ', 'バイク', 'ドリンクホルダー', 'ハンドルカバー', 'シートカバー', 'スマホ', 'iPhone', 'ペット', '首輪'] },
  { id: 'watch', group: 'fashion', label: '時計', keyword: '腕時計', brands: ['SEIKO', 'CASIO', 'G-SHOCK', 'Knot', 'CITIZEN'] },
  { id: 'glasses', group: 'fashion', label: '眼鏡', keyword: 'メガネ フレーム', brands: ['Zoff', 'JINS', '金子眼鏡', 'Ray-Ban'] },
  { id: 'sunglasses', group: 'fashion', label: 'サングラス', keyword: 'サングラス', brands: ['Ray-Ban', 'Oakley', 'EFFECTOR'] },
  { id: 'life_appliance', group: 'appliance', label: '生活家電', keyword: '家電', brands: ['BALMUDA', 'Panasonic', 'アイリスオーヤマ', 'dyson', 'SHARP'] },
  { id: 'beauty_appliance', group: 'appliance', label: '美容家電', keyword: '美容家電 ドライヤー', brands: ['ReFa', 'Panasonic', 'SALONIA', 'YA-MAN'] },
  { id: 'cooking', group: 'appliance', label: '調理家電', keyword: '調理家電', brands: ['BALMUDA', 'BRUNO', 'recolte', '象印', 'De\'Longhi'] },
  { id: 'seasonal', group: 'appliance', label: '季節家電', keyword: '加湿器 ヒーター', brands: ['BALMUDA', '山善', 'cado', 'PLUSMINUSZERO'] },
  { id: 'phone_acc', group: 'gadget', label: 'スマホアクセ', keyword: 'スマホケース', brands: ['Apple', 'Anker', 'CASETiFY', 'iFace'] },
  { id: 'charger', group: 'gadget', label: '充電器', keyword: '充電器 USB-C', brands: ['Anker', 'UGREEN', 'CIO', 'Belkin'] },
  { id: 'battery', group: 'gadget', label: 'モバイルバッテリー', keyword: 'モバイルバッテリー', brands: ['Anker', 'CIO', 'UGREEN', 'cheero'] },
  { id: 'earphone', group: 'gadget', label: 'イヤホン', keyword: 'ワイヤレスイヤホン', brands: ['Sony', 'Bose', 'Apple', 'Anker', 'JBL'] },
  { id: 'pc', group: 'gadget', label: 'PC周辺機器', keyword: 'キーボード マウス', brands: ['Logicool', 'Keychron', 'HHKB', 'エレコム'] },
  { id: 'desk', group: 'gadget', label: 'デスク用品', keyword: 'デスク 収納', brands: ['山崎実業', 'Bauhutte', 'KING JIM'] },
  { id: 'useful', group: 'living', label: '便利グッズ', keyword: '便利グッズ', brands: ['山崎実業', 'マーナ', 'OXO'] },
  { id: 'storage', group: 'living', label: '収納', keyword: '収納', brands: ['山崎実業', 'tower', '無印良品', 'like-it'] },
  { id: 'cleaning', group: 'living', label: '掃除用品', keyword: '掃除用品', brands: ['マーナ', 'レック', 'makita'] },
  { id: 'kitchen', group: 'living', label: 'キッチン用品', keyword: 'キッチン用品', brands: ['KINTO', 'HARIO', 'OXO', 'STAUB', 'THERMOS'] },
  { id: 'tableware', group: 'living', label: '食器', keyword: '食器', brands: ['イッタラ', 'KINTO', '波佐見焼', 'ARABIA', '白山陶器'] },
  { id: 'interior', group: 'living', label: 'インテリア', keyword: 'インテリア 照明', brands: ['IDEE', 'ACTUS', 'ニトリ'] },
  { id: 'daily', group: 'living', label: '日用品', keyword: '日用品', brands: ['無印良品', 'THERMOS', 'Joseph Joseph'] },
  { id: 'outdoor', group: 'other', label: 'アウトドア', keyword: 'アウトドア キャンプ', brands: ['Snow Peak', 'NANGA', 'Coleman', 'THE NORTH FACE', 'Helinox'] },
  { id: 'travel', group: 'other', label: '旅行用品', keyword: '旅行 グッズ', brands: ['Samsonite', 'ACE', 'Aer', 'PROTECA'] },
  { id: 'baby', group: 'other', label: 'ベビー用品', keyword: 'ベビー', brands: ['MARLMARL', 'エイデンアンドアネイ', 'ファミリア', 'BorneLund'] },
  { id: 'cosme', group: 'other', label: 'コスメ', keyword: 'コスメ', brands: ['SHISEIDO', 'THREE', 'ADDICTION', 'RMK'] },
  { id: 'perfume', group: 'other', label: '香水', keyword: '香水', brands: ['Jo Malone', 'Aesop', 'SHIRO', 'Diptyque'] },
  { id: 'food', group: 'other', label: '食品', keyword: 'スイーツ', brands: ['GODIVA', 'ルタオ', '資生堂パーラー'] },
  { id: 'otoriyose', group: 'other', label: 'お取り寄せ', keyword: 'お取り寄せ グルメ', brands: [] },
  { id: 'stationery', group: 'other', label: '文房具', keyword: '文房具', brands: ['LAMY', 'MIDORI', 'トンボ鉛筆', 'ほぼ日'] },
  { id: 'gift', group: 'other', label: 'ギフト', keyword: 'ギフト', brands: ['Aesop', 'Jo Malone', 'KINTO'] }
];

// 商品名が、そのジャンルに混ざった別の商品か（ng の言葉が入っているか）
export function isOffGenre(name, genre) {
  return !!(genre && genre.ng && genre.ng.some((w) => String(name || '').includes(w)));
}

export function findRadarGenre(id) {
  return RADAR_GENRES.find((g) => g.id === id) || null;
}
