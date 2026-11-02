// 楽天の商品検索・照合の比較用：同じ20商品で、修正の前後の精度を比べる（scripts/search-benchmark.js・test/search-benchmark.test.js）。
// target：社長が入力する・スクリーンショットから読み取る商品。expect：正しいブランド・型番（記号を除いた形）・種類。
// listing：楽天に出ていそうな「その商品」の商品名。others：同じ検索に混ざりそうな別の商品（型番違い・付属品・他ブランド）。
// sameOk：others の中で「同一商品」と判定してよいもの（なければ空）。
// 楽天APIを実際に呼んだ結果ではない（この環境からは楽天APIに接続できないため）。商品名は、楽天の商品名によくある書き方をまねて作った。
export const BENCH = [
  { target: { name: 'SONY WH-1000XM5 ヘッドホン' }, expect: { brand: 'Sony', model: 'WH1000XM5', kind: 'ヘッドホン' },
    listing: '【国内正規品】ソニー ワイヤレスノイズキャンセリングヘッドホン WH-1000XM5 B ブラック',
    others: ['ソニー ワイヤレスヘッドホン WH-1000XM4 ブラック', 'WH-1000XM5 対応 イヤーパッド 交換用', 'Anker Soundcore Space One ヘッドホン', 'Bose QuietComfort Ultra Headphones ヘッドホン'] },
  { target: { name: 'アラジン グラファイトトースター AET-GS13C' }, expect: { brand: 'アラジン', model: 'AETGS13C', kind: 'トースター' },
    listing: '【送料無料】Aladdin アラジン グラファイト トースター 4枚焼き AET-GS13C(G) グリーン',
    others: ['アラジン グラファイトトースター 2枚焼き AET-GS13B', 'バルミューダ ザ・トースター K11A', 'トースター 4枚焼き おしゃれ', 'アラジン トースター 焼き網 交換用'] },
  { target: { name: 'サンワサプライ スリムタップ TAP-SPSLIM8MG-2' }, expect: { brand: 'サンワサプライ', model: 'TAPSPSLIM8MG2', kind: '電源タップ' },
    listing: 'サンワサプライ 電源タップ スリムタップ 8個口 マグネット TAP-SPSLIM8MG-2W ホワイト 2m',
    others: ['サンワサプライ スリムタップ 4個口 TAP-SPSLIM4MG-2', '電源タップ 8個口 雷ガード 2m', 'エレコム 電源タップ T-K6A-2410'] },
  { target: { name: 'New Balance 574 スニーカー' }, expect: { brand: 'New Balance', model: '574', kind: 'スニーカー' },
    listing: 'ニューバランス スニーカー メンズ U574 ネイビー New Balance',
    others: ['ニューバランス 996 スニーカー グレー', 'New Balance 327 スニーカー', 'ナイキ エアフォース1 スニーカー'] },
  { target: { name: 'PLAUD NOTE ボイスレコーダー' }, expect: { brand: 'PLAUD', model: '', kind: 'ボイスレコーダー' },
    listing: 'PLAUD NOTE プラウドノート AI ボイスレコーダー 64GB 録音 文字起こし',
    others: ['PLAUD NOTE 専用ケース マグネット', 'PLAUD NotePin ウェアラブル AI ボイスレコーダー', 'ボイスレコーダー 小型 長時間'] },
  { target: { name: 'CHARMY クリスタ 予洗い専用泡スプレー' }, expect: { brand: 'CHARMY', model: '', kind: 'スプレー' },
    listing: 'ライオン CHARMY クリスタ 予洗い専用泡スプレー 本体 300ml',
    others: ['CHARMY クリスタ 食洗機用洗剤 つめかえ', '食器用洗剤 泡スプレー 詰め替え', 'キュキュット 泡スプレー 本体'] },
  { target: { name: 'つぶしやすいスプーンマッシャー K829DGY', brand: 'マーナ' }, expect: { brand: 'マーナ', model: 'K829DGY', kind: 'マッシャー' },
    listing: 'マーナ つぶしやすい スプーンマッシャー K829DGY グレー 食洗機対応',
    others: ['マーナ つぶせるすくえるスプーンマッシャー K673', 'ポテトマッシャー ステンレス'] },
  { target: { name: 'サンコー コードレス高圧ちょい洗浄機 HDHW26C' }, expect: { brand: 'サンコー', model: 'HDHW26C', kind: '洗浄機' },
    listing: 'サンコー コードレス 高圧 ちょい洗浄機 HDHW26CBK ペットボトル',
    others: ['ケルヒャー 高圧洗浄機 K2 サイレント', 'コードレス 高圧洗浄機 充電式'] },
  { target: { name: '象印 ステンレスマグ SM-ZB48' }, expect: { brand: '象印', model: 'SMZB48', kind: 'マグ' },
    listing: '象印 水筒 ステンレスマグ TUFF シームレスせん 480ml SM-ZB48-BA',
    others: ['象印 ステンレスマグ 360ml SM-ZB36', 'サーモス 真空断熱ケータイマグ JOK-500', 'SM-ZB48 対応 パッキン セット'] },
  { target: { name: 'タイガー 電気ケトル PCM-A080' }, expect: { brand: 'タイガー', model: 'PCMA080', kind: '電気ケトル' },
    listing: 'タイガー魔法瓶 電気ケトル わく子 0.8L PCM-A080 KM マットブラック',
    others: ['ティファール 電気ケトル 0.8L', 'タイガー 電気ケトル PCK-A080', 'ケトル おしゃれ 1L'] },
  { target: { name: 'シャープ プラズマクラスター 加湿空気清浄機 KI-RS40' }, expect: { brand: 'シャープ', model: 'KIRS40', kind: '空気清浄機' },
    listing: 'シャープ 加湿空気清浄機 プラズマクラスター7000 KI-RS40-W ホワイト',
    others: ['シャープ 空気清浄機 FU-S50', 'KI-RS40 対応 交換用 フィルター', 'ダイキン 加湿空気清浄機 MCK55Z'] },
  { target: { name: 'ハリオ V60 透過ドリッパー 02' }, expect: { brand: 'ハリオ', model: 'V60', kind: 'ドリッパー' },
    listing: 'HARIO ハリオ V60 透過ドリッパー 02 クリア VD-02T',
    others: ['カリタ ドリッパー 102-D', 'V60 ペーパーフィルター 02 100枚', 'ドリッパー 陶器 おしゃれ'] },
  { target: { name: 'Anker PowerCore 10000' }, expect: { brand: 'Anker', model: '', kind: '' },
    listing: 'Anker PowerCore 10000 モバイルバッテリー 10000mAh A1263',
    others: ['Anker PowerCore Essential 20000 モバイルバッテリー', 'モバイルバッテリー 10000mAh 軽量', 'Anker 充電器 Nano'] },
  { target: { name: '無印良品 ポータブルアロマディフューザー' }, expect: { brand: '無印良品', model: '', kind: 'ディフューザー' },
    listing: '無印良品 ポータブルアロマディフューザー 充電式 MJ-PAD1',
    others: ['アロマディフューザー 超音波 おしゃれ', '無印良品 超音波うるおいアロマディフューザー'] },
  { target: { name: 'KEEN ジャスパー スニーカー メンズ' }, expect: { brand: 'KEEN', model: '', kind: 'スニーカー' },
    listing: 'KEEN キーン JASPER ジャスパー メンズ スニーカー 1002661',
    others: ['KEEN ニューポート サンダル', 'スニーカー メンズ アウトドア'] },
  { target: { name: 'iPhone15 対応 ケース 手帳型' }, expect: { brand: '', model: '', kind: 'スマホケース' },
    listing: 'iPhone15 ケース 手帳型 カード収納 レザー',
    others: ['iPhone15 Pro ケース クリア', 'Apple純正 iPhone15 シリコーンケース'] },
  { target: { name: 'ナイキ風 スニーカー 白 レディース' }, expect: { brand: '', model: '', kind: 'スニーカー' },
    listing: 'スニーカー レディース 白 厚底 軽量',
    others: ['ナイキ エアフォース1 ホワイト スニーカー'] },
  { target: { name: 'マグネット ケーブルホルダー デスク' }, expect: { brand: '', model: '', kind: 'ホルダー' },
    listing: 'ケーブルホルダー マグネット 卓上 5本 デスク',
    others: ['マグネット 充電ケーブル 3in1 ライトグレー'] },
  { target: { name: 'BALMUDA The Toaster K11A' }, expect: { brand: 'BALMUDA', model: 'K11A', kind: 'トースター' },
    listing: 'バルミューダ ザ・トースター K11A-BK ブラック スチームトースター BALMUDA',
    others: ['バルミューダ ザ・トースター Pro K11A-SE BALMUDA', 'BALMUDA The Pot K07A 電気ケトル'],
    // 2番の others にある「バルミューダ ザ・トースター K11A」は同じ商品（別ショップの掲載）
    sameOk: ['バルミューダ ザ・トースター K11A'] },
  { target: { name: 'ダイソン V12 Detect Slim 掃除機' }, expect: { brand: 'Dyson', model: 'V12', kind: '掃除機' },
    listing: 'ダイソン Dyson V12 Detect Slim Absolute SV46ABL コードレス掃除機',
    others: ['Dyson V8 Slim Fluffy+ 掃除機', 'V12 対応 バッテリー 互換'] }
];

// 楽天のキーワード検索のまね：検索語の言葉がすべて商品名に含まれる商品だけを返す（全角半角・大文字小文字はそろえる。記号のハイフンはそろえない）
export function fakeRakutenSearch(keyword, catalog) {
  const n = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[\s　]/g, '');
  const words = String(keyword).normalize('NFKC').toLowerCase().split(/[\s　]+/).filter(Boolean);
  return catalog.filter((name) => words.every((w) => n(name).includes(w))).slice(0, 30);
}
