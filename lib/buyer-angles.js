// バイヤーAIの発掘の切り口（2026-11-14 社長の方針）：「レビューの多い商品を選ぶ」だけでなく、発掘理由を持って商品を提案する。
// 切り口ごとに、楽天の商品検索だけで確かめられるか（rakutenOnly）と、追加の情報源が必要か（needs）を分ける。
// 楽天だけで確かめられない主張（SNSで話題・テレビで紹介・芸能人が使用・メーカーの公式発表）は、情報源と日付が無い限り事実として扱わない。
// 新しいAI社員は作らない（バイヤーAIが切り口を順に担当する）。

export const ANGLES = [
  { id: 'classic', label: '長年評価されている定番・名作', rakutenOnly: true, sort: '-reviewCount',
    keep: (it) => it.reviewCount >= 100 && it.reviewAverage >= 4.3,
    criteria: '楽天のレビュー件数と平均点で、長く評価されていることを確かめる（件数・平均は確認日つきの楽天のデータだけ）' },
  { id: 'new_label', label: '新商品・新作（楽天の商品ページの表記）', rakutenOnly: true, sort: '-updateTimestamp',
    keep: (it) => /新発売|新商品|新作|NEW|ニューモデル|20[2-3][0-9]年(モデル|新作|発売)/i.test(`${it.name} ${it.caption}`),
    criteria: '商品名・説明に「新発売」「新作」などの表記があることを確かめる。メーカーの公式の発売日は、公式の情報源が無ければ書かない' },
  { id: 'old_model', label: '型落ち・旧モデルでも魅力がある商品', rakutenOnly: true, hint: '旧モデル 型落ち アウトレット',
    keep: (it) => /型落ち|旧モデル|旧型|前モデル|アウトレット|在庫処分|在庫限り/.test(`${it.name} ${it.caption}`),
    criteria: '商品名・説明に型落ち・旧モデルなどの表記があること。値下がりの幅・以前の価格は確認できないので書かない' },
  { id: 'season', label: '季節・行事で需要が高まる商品', rakutenOnly: true,
    criteria: '今の季節・行事（コードが日付から決める）に使う理由が、商品データにあること' },
  { id: 'sale', label: 'セール・値下げで買う魅力が増した商品', rakutenOnly: true, hint: 'セール 値下げ 特価',
    keep: (it) => /セール|値下げ|特価|OFF|半額|クーポン|期間限定/i.test(it.name),
    criteria: '確認した時点で商品名にセール等の表記があること。期間・割引率は「商品ページで確認」と書く（推測しない）' },
  { id: 'unique', label: 'レビューは少なくても、機能やデザインに独自性がある商品', rakutenOnly: true,
    keep: (it) => it.reviewCount < 30,
    criteria: '独自の機能・デザインが商品データに具体的に書かれていること（レビューの少なさは減点しない）' },
  { id: 'gift', label: 'プレゼント需要に合う商品', rakutenOnly: true, hint: 'ギフト プレゼント', minPrice: 2000, maxPrice: 15000,
    criteria: 'ギフト対応（ラッピング・のし・ギフトボックスなど）が商品データにあるか、贈る相手と場面がはっきりしていること' },
  // ここから下は、楽天の商品検索だけでは確かめられない（追加の情報源が必要）。今は使わない（情報源の仕組みは社長の承認後）
  { id: 'maker_new', label: '有名メーカーの新商品・発売予定（公式発表）', rakutenOnly: false, needs: 'メーカー公式サイト・プレスリリース（PR TIMES など）の発表ページと日付' },
  { id: 'sns', label: 'SNSで話題の商品', rakutenOnly: false, needs: 'SNSの投稿のURLと日付（件数や「話題」の根拠）' },
  { id: 'media', label: 'テレビ・メディアで紹介された商品', rakutenOnly: false, needs: '番組・記事の公式ページと放送日・掲載日' },
  { id: 'celebrity', label: '芸能人・著名人が使用・紹介した商品', rakutenOnly: false, needs: '本人の投稿か公式の発表と日付' }
];
export const ACTIVE_ANGLES = ANGLES.filter((a) => a.rakutenOnly);
export const angleById = (id) => ANGLES.find((a) => a.id === id) || null;

// 情報源が無いと事実として扱えない主張（話題性・メディア・著名人・公式発表）。楽天のデータだけの候補が書いたら、コードの確認で不合格
export const UNSOURCED_CLAIM = /SNSで|SNS上|話題の|話題に|バズ|インフルエンサー|テレビで|TVで|番組で|メディアで|雑誌で|芸能人|著名人|有名人|愛用者|公式発表|発売予定/;

// 今の季節・行事（日本時間の月から決める。AIに季節を推測させない）
const SEASONS = {
  1: ['新年', '冬の寒さ対策', '新生活の準備'], 2: ['バレンタイン', '冬の寒さ対策'], 3: ['ホワイトデー', '卒業・新生活'], 4: ['新生活', '花粉の季節の部屋の掃除'],
  5: ['母の日', '初夏のアウトドア'], 6: ['父の日', '梅雨の湿気対策'], 7: ['夏の暑さ対策', 'お中元'], 8: ['夏休み', '夏の暑さ対策'],
  9: ['秋の行楽', '敬老の日'], 10: ['秋のアウトドア', 'ハロウィン'], 11: ['冬の乾燥対策', '早めのクリスマスギフト', 'ブラックフライデー'], 12: ['クリスマスギフト', '年末の大掃除', '冬の寒さ対策']
};
export function seasonWords(d = new Date()) {
  const m = new Date(d.getTime() + 9 * 3600000).getUTCMonth() + 1;
  return SEASONS[m] || [];
}

// 次に担当する切り口：在庫（合格候補）に少ない切り口を優先し、同じ数なら順番に回す（同じような商品ばかりにならないように）
export function chooseAngle(stockAngles = [], turn = 0) {
  const count = Object.fromEntries(ACTIVE_ANGLES.map((a) => [a.id, 0]));
  stockAngles.forEach((id) => { if (count[id] != null) count[id] += 1; });
  const min = Math.min(...Object.values(count));
  const least = ACTIVE_ANGLES.filter((a) => count[a.id] === min);
  return least[turn % least.length];
}
