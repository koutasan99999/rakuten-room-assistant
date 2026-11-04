// 「社長、これどうすか？」のプレゼンの分類（大分類と細分類）と、ジャンルの偏りを防ぐ決まり。（検索画面のジャンル一覧は lib/genres.js。こちらはプレゼン専用）
// 分類は「何の商品か」で決める（検索語ではなく商品名から）。例：「香水 ギフトセット」は ギフトではなく 香水。
// 一覧にない新しい分類は、AIが見つけたものを「new:名前」として受け入れる（固定の12分類だけを巡回しない）。
// 決まり（通常のプレゼン）：同じ細分類を続けない／直近5件は原則ちがう大分類／直近10件で細分類7種類以上を目標。
// 「この商品から広げる」（深掘り）の結果は、この履歴に入れない（深掘りがプレゼンのジャンル選びを支配しないように）。

export const MAJORS = [
  { id: 'fashion', name: 'ファッション・Tシャツ', subs: [
    ['tshirt', 'Tシャツ・カットソー', /Tシャツ|ティーシャツ|カットソー|ロンT|ロングスリーブ/i, ['Tシャツ 厚手 メンズ', 'ポケットTシャツ メンズ 無地']],
    ['shirt', 'シャツ', /シャツ(?!.*(Tシャツ))|ブラウス/, ['オープンカラーシャツ 柄 メンズ', 'リネンシャツ メンズ']],
    ['knit', 'ニット・スウェット', /ニット|セーター|カーディガン|スウェット|パーカー/, ['畦編み ニット メンズ', 'ヘビーウェイト スウェット メンズ']],
    ['outer', 'アウター', /ジャケット|コート|ブルゾン|カバーオール|ダウン/, ['コーチジャケット メンズ', 'カバーオール メンズ']],
    ['pants', 'パンツ', /パンツ|スラックス|デニム|ジーンズ|チノ/, ['ワイドパンツ メンズ', 'カーゴパンツ メンズ']],
    ['cap', '帽子', /キャップ|ハット|帽子|ニット帽|ビーニー/, ['キャップ ウール メンズ', 'バケットハット メンズ']]
  ] },
  { id: 'shoes', name: 'スニーカー・革靴', subs: [
    ['sneaker', 'スニーカー', /スニーカー|シューズ(?!.*(ケア|クリーム))/, ['スニーカー レザー メンズ', 'スエード スニーカー メンズ']],
    ['leather_shoes', '革靴・ブーツ', /ローファー|革靴|ブーツ|ダービー|ドレスシューズ/, ['スエード ローファー メンズ', 'サイドゴアブーツ メンズ']],
    ['sandal', 'サンダル', /サンダル|スリッパ|ルームシューズ/, ['レザーサンダル メンズ', 'ルームシューズ フェルト']]
  ] },
  { id: 'watch', name: '腕時計・アクセサリー', subs: [
    ['watch', '腕時計', /腕時計|ウォッチ|watch/i, ['腕時計 シンプル メンズ', 'ミリタリーウォッチ メンズ']],
    ['jewelry', 'リング・ブレスレット・ネックレス', /リング|指輪|ブレスレット|バングル|ネックレス|ピアス/, ['シルバー リング メンズ', 'レザー ブレスレット メンズ']],
    ['eyewear', 'サングラス', /サングラス/, ['サングラス メンズ ボストン', '偏光 サングラス メンズ']]
  ] },
  { id: 'bag', name: 'バッグ・財布', subs: [
    ['bag', 'バッグ', /バッグ|トート|リュック|ショルダー|サコッシュ|ボストン/, ['キャンバス トートバッグ メンズ', 'レザー ショルダーバッグ メンズ']],
    ['wallet', '財布', /財布|ウォレット|コインケース/, ['ミニ財布 レザー メンズ', '二つ折り財布 本革']],
    ['small_leather', '革小物', /キーケース|カードケース|名刺入れ|キーホルダー|パスケース/, ['キーケース 経年変化 本革', '名刺入れ 本革 メンズ']]
  ] },
  { id: 'grooming', name: '香水・身だしなみ', subs: [
    ['perfume', '香水', /香水|フレグランス(?!.*(ルーム|ディフューザー))|オードトワレ|オードパルファム|パルファム|コロン/, ['香水 メンズ ウッディ', 'オードパルファム ユニセックス']],
    ['skincare', 'スキンケア・ハンドクリーム', /ハンドクリーム|化粧水|乳液|洗顔|スキンケア|リップ|ボディクリーム/, ['ハンドクリーム ギフト', 'メンズ スキンケア セット']],
    ['groom_tool', '身だしなみの道具', /シェーバー|髭剃り|爪切り|ヘアブラシ|ブラシ|コーム|ヘアワックス|ドライヤー/, ['爪切り 日本製', '木製 ヘアブラシ']]
  ] },
  { id: 'gadget', name: 'ガジェット・PC周辺機器', subs: [
    ['desk_gadget', 'デスクまわりのガジェット', /スマホスタンド|スタンド|充電器|モバイルバッテリー|ケーブル|USB|ハブ/, ['アルミ スマホスタンド', '充電スタンド デザイン']],
    ['audio', 'イヤホン・スピーカー', /イヤホン|ヘッドホン|スピーカー/, ['ワイヤレスイヤホン デザイン', 'Bluetooth スピーカー 木目']],
    ['pc_input', 'キーボード・マウス', /キーボード|マウス|トラックボール/, ['メカニカルキーボード コンパクト', 'トラックボール マウス']]
  ] },
  { id: 'interior', name: 'インテリア・照明', subs: [
    ['lighting', '照明', /ライト|ランプ|照明|ペンダント/, ['デスクライト 真鍮', 'テーブルランプ ガラス']],
    ['room_fragrance', '部屋の香り', /ディフューザー|ルームフレグランス|お香|キャンドル|アロマ/, ['ルームフレグランス ウッド', 'お香 日本製']],
    ['decor', '飾る物・花瓶・時計', /花瓶|フラワーベース|置物|オブジェ|ポスター|アート|掛け時計|置き時計|ミラー/, ['フラワーベース ガラス', '置き時計 木製']],
    ['furniture', '家具・収納家具', /チェア|椅子|スツール|テーブル|(?<!ブ)ラック|シェルフ/, ['スツール 木製', 'ウォールシェルフ アイアン']]
  ] },
  { id: 'kitchen', name: 'キッチン・コーヒー用品', subs: [
    ['coffee', 'コーヒー・お茶の道具', /ドリッパー|コーヒーミル|ケトル|コーヒー|急須|ティーポット/, ['コーヒードリッパー 陶器', '手挽き コーヒーミル']],
    ['tableware', '食器・グラス', /マグ|カップ|グラス|皿|プレート|ボウル|箸/, ['マグカップ 陶器 日本製', 'ロックグラス 手作り']],
    ['cookware', '調理道具', /フライパン|鍋|包丁|まな板|スキレット|トング/, ['スキレット 鋳鉄', '包丁 日本製 三徳']]
  ] },
  { id: 'living', name: '便利グッズ・生活雑貨', subs: [
    ['storage', '収納・整理', /収納|ボックス|ケース|(?<!ブ)ラック|ハンガー|フック/, ['収納ボックス 木製 フタ付き', 'マグネット フック 玄関']],
    ['cleaning', '掃除・洗濯', /掃除|ほうき|ちりとり|ブラシ|洗濯|ランドリー/, ['ほうき ちりとり セット デザイン', 'ランドリーバッグ']],
    ['umbrella', '傘・雨の日', /傘|レイン/, ['折りたたみ傘 軽量 メンズ', '長傘 ジャンプ メンズ']],
    ['towel', 'タオル・寝具', /タオル|ブランケット|枕|毛布|シーツ/, ['今治 タオル ギフト', 'ブランケット ウール']]
  ] },
  { id: 'outdoor', name: '防災・アウトドア', subs: [
    ['lantern', 'ランタン・ライト', /ランタン|ヘッドライト|懐中電灯/, ['LEDランタン 充電式', 'オイルランタン']],
    ['camp', 'キャンプ道具', /キャンプ|焚き火|テント|チェア.*アウトドア|クッカー|シェラカップ/, ['焚き火台 コンパクト', 'シェラカップ ステンレス']],
    ['bottle', '水筒・タンブラー', /タンブラー|水筒|ボトル|マグボトル/, ['真空断熱 タンブラー', 'ステンレス 水筒 おしゃれ']],
    ['bousai', '防災用品', /防災|非常用|保存水|簡易トイレ/, ['防災セット 1人用', 'ポータブル電源 小型']]
  ] },
  { id: 'gift', name: 'ギフト・プレゼント', subs: [
    ['gift_set', 'ギフトセット', /ギフトセット|詰め合わせ|プレゼントセット/, ['ギフトセット 男性 おしゃれ', 'プチギフト 女性']],
    ['flower', '花・グリーン', /花|ブーケ|ドライフラワー|観葉植物|植物/, ['ドライフラワー ギフト', '観葉植物 小さい']],
    ['name_gift', '名入れ・記念品', /名入れ|記念品|刻印/, ['名入れ ボールペン', '刻印 キーホルダー 革']]
  ] },
  { id: 'hobby', name: '文房具・趣味用品', subs: [
    ['pen', '筆記具', /ボールペン|万年筆|シャープペン|鉛筆/, ['ボールペン 真鍮', '万年筆 入門']],
    ['notebook', 'ノート・手帳', /ノート|手帳|メモ/, ['手帳 革 カバー', 'ノート 方眼 上質']],
    ['play', 'ゲーム・パズル・趣味', /パズル|ボードゲーム|プラモデル|カメラ|ストラップ|レコード/, ['ボードゲーム 大人', 'カメラストラップ レザー']]
  ] }
];

const MAJOR_BY_ID = Object.fromEntries(MAJORS.map((m) => [m.id, m]));
export function majorName(id) { return MAJOR_BY_ID[id] ? MAJOR_BY_ID[id].name : String(id || '').replace(/^new:/, '') || '不明'; }
export function subName(majorId, subId) {
  const m = MAJOR_BY_ID[majorId];
  const s = m && m.subs.find((x) => x[0] === subId);
  return s ? s[1] : String(subId || '').replace(/^new:/, '');
}

// 商品名から分類を決める（何の商品か）。見つからなければ null
export function classify(name) {
  const t = String(name || '').normalize('NFKC');
  // 順番が大事：香りの道具（ディフューザー）は香水より先に、時計（置き時計）は腕時計と分ける など
  const order = ['interior:room_fragrance', 'interior:decor', 'watch:watch', 'grooming:perfume'];
  for (const k of order) {
    const [mid, sid] = k.split(':');
    const sub = MAJOR_BY_ID[mid].subs.find((s) => s[0] === sid);
    if (sub[2].test(t) && !(sid === 'watch' && /置き時計|掛け時計/.test(t))) return { major: mid, sub: sid };
  }
  for (const m of MAJORS) for (const s of m.subs) if (s[2].test(t)) return { major: m.id, sub: s[0] };
  return null;
}

// 履歴（直近のプレゼン。古い順）の分類をそろえる（分類がない古い記録は商品名から決める）
export function normalizeRecent(list) {
  return (Array.isArray(list) ? list : []).slice(-30).map((h) => {
    const c = (h && h.major) ? { major: String(h.major).slice(0, 40), sub: String(h.sub || '').slice(0, 40) } : classify(h && h.name);
    return { name: String((h && h.name) || '').slice(0, 80), code: String((h && h.code) || '').slice(0, 120), status: String((h && h.status) || ''), major: c ? c.major : 'unknown', sub: c ? c.sub || c.major : 'unknown' };
  });
}

// 次に探す分類を選ぶ（採用率では選ばない。直近に出していない・長く出していない・まだ出したことがない分類を優先し、少しランダムにする）
export function chooseTargets(recent, { count = 6, random = Math.random } = {}) {
  const last4 = new Set(recent.slice(-4).map((h) => h.major));
  const recentSubs = new Set(recent.slice(-10).map((h) => h.sub));
  const lastSeen = {};
  recent.forEach((h, i) => { lastSeen[h.major] = i; lastSeen[`${h.major}:${h.sub}`] = i; });
  const scored = MAJORS.filter((m) => !last4.has(m.id)).map((m) => {
    const gap = lastSeen[m.id] == null ? 40 : recent.length - lastSeen[m.id];
    return { m, score: gap + random() * 6 };
  }).sort((a, b) => b.score - a.score).slice(0, count);
  return scored.map(({ m }) => {
    // 細分類：直近10件に出ていないもの、そのなかで長く出していないもの
    const subs = m.subs.filter((s) => !recentSubs.has(s[0]));
    const pool = (subs.length ? subs : m.subs).slice().sort((a, b) => (lastSeen[`${m.id}:${a[0]}`] ?? -1) - (lastSeen[`${m.id}:${b[0]}`] ?? -1));
    const s = pool[Math.floor(random() * Math.min(2, pool.length))];
    return { major: m.id, majorName: m.name, sub: s[0], subName: s[1], subOptions: m.subs.map((x) => `${x[0]}=${x[1]}`), seedKeyword: s[3][Math.floor(random() * s[3].length)] };
  });
}

// 並べ方：直近の履歴に続けて、同じ細分類を続けない・直近5件で大分類を重ねない順に並べる。条件に合わない商品は外して理由を残す
export function orderForDiversity(recent, picks) {
  const seq = recent.map((h) => ({ major: h.major, sub: h.sub }));
  const left = picks.slice();
  const out = [];
  const dropped = [];
  while (left.length) {
    const last4 = new Set(seq.slice(-4).map((h) => h.major));
    const prev = seq[seq.length - 1];
    const last9subs = new Set(seq.slice(-9).map((h) => h.sub));
    // 1番目の条件：大分類が直近4件と違う＋細分類が直前と違う。2番目：細分類が直近9件にない（あれば優先）
    const ok = left.filter((p) => !last4.has(p.major) && (!prev || prev.sub !== p.sub));
    if (!ok.length) { left.forEach((p) => dropped.push({ name: p.name, reason: `直近に同じ分類（${majorName(p.major)}／${subName(p.major, p.sub)}）が続くため見送り` })); break; }
    const best = ok.find((p) => !last9subs.has(p.sub)) || ok[0];
    out.push(best);
    seq.push({ major: best.major, sub: best.sub });
    left.splice(left.indexOf(best), 1);
  }
  return { items: out, dropped };
}
