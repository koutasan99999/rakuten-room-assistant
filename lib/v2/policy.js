// 経営方針の整理（2026-11-25・KOT-24）
//   ①旧指示の棚卸し：実際にコードにあった指示のうち、KOT-23（初収益・販売可能な完成品を優先）と矛盾したものを「実行対象から外した」記録
//   ②全現役職種の役割定義（専門知識・責任・入力・判断基準・禁止事項・成果物・品質ゲート・失敗時・引継ぎ・KPI）。実際に呼ばれるAIの指示の先頭に付ける
//   ③指示の評価（役職名だけの指示・一般論は不合格）
//   データ・履歴は消さない。旧指示は実行の入口で止めるだけ。予算上限・ROOM新規紹介の停止・外部操作の承認・品質・規約・安全の条件は変えない
//   注意：資料（20枚）の原画像は取得できていないので、「資料に完全に準拠している」とは言わない（登録済みの要約との矛盾だけを外した）

export const RETIRED_INSTRUCTIONS = [
  { id: 'venture-discovery', status: 'retired', where: 'lib/v2/ventures.js（P_IDEA・AXES の12分野を回す新規副業の発掘。KOT-12）',
    before: '企画が20時間ごとに「新規副業」の案を最大2件考え、バイヤー・監査・デザイナーが順に調査・試作する（部署に仕事を作るための流れ）',
    after: '既定で止める（案を考えない・作りかけも進めない）。保存済みの案と履歴は消さず、画面に残る。戻すときは環境変数 VENTURE_DISCOVERY=on（社長の判断）',
    reason: 'KOT-23：機能開発より初収益。無理な新規副業の発掘は、既存商品を売る仕事より後回し。仕事を埋めるための仕事を作らない',
    impact: '新規副業の AI費用（1日最大3円）が出なくなる。集客の実験・デジタル商品の流れは変えない' },
  { id: 'role-title-only-prompts', status: 'replaced', where: 'AIを呼ぶ指示の先頭（企画・バイヤー・監査・ライター・広報の各指示）',
    before: '「あなたは○○の担当です」だけで、判断基準・禁止事項・成果物・失敗時の対応が無い',
    after: '全現役職種に ROLE_SPECS（10項目）を定義し、実際に呼ばれる指示の先頭に roleBrief() を付ける',
    reason: 'KOT-24：役職名だけの指示を廃止。一般論でなく具体的な成果物と検証につなげる', impact: '指示が長くなり、1回の入力が増える（費用は実測で記録され、月1000円の上限は変えない）' },
  { id: 'proposal-as-result', status: 'clarified', where: '部署の成果の数え方',
    before: '「成果」の定義が、AIに渡す指示には書かれていなかった（案の数を成果と読める余地があった）',
    after: '判断待ち・承認待ちは成果ではない。成果は「投稿できる完成品」と「実測の数字」だけ（ROLE_SPECS の kpi に明記・評価で確認）',
    reason: 'KOT-24：提案・承認待ちの成果扱いを廃止', impact: '指示と評価の定義のみ（画面の数字の計算も保存済みの数字も変えていない）' }
];
// 調べたが、現役の指示としては見つからなかったもの（記録のみ・何も変えていない）
export const CHECKED_NOT_FOUND = ['全8部署の稼働を目的にする指示（仕事が無い社員は「待機」と理由を出す作りで、稼働の演出はしない：KOT-16）', '資料の恣意的な取捨選択（手法ごとの採用・保留・不採用と理由を残す：lib/v2/profit.js）'];

const FIELDS = ['expertise', 'duty', 'input', 'criteria', 'ban', 'output', 'gate', 'onFail', 'handoff', 'kpi'];
export const FIELD_LABEL = { expertise: '専門', duty: '責任', input: '入力', criteria: '判断基準', ban: '禁止', output: '成果物', gate: '品質ゲート', onFail: '失敗時', handoff: '引継ぎ', kpi: 'KPI' };
const COMMON_BAN = '体験談（使ってみた・愛用）・誇張・断定・医療の効果・確認できない価格/在庫/ランキング/レビュー/売上を書かない。投稿・コメント・フォロー・購入・契約はしない（下書きまで）。';
export const ROLE_SPECS = {
  planner: { name: '企画', expertise: '楽天アフィリエイトの導線（Instagram→ROOM→楽天）での商品企画・販促の計画', duty: '既存の商品・完成品を売るための企画と、次に検証する1つの施策を決める', input: '完成品の一覧・実績の数字（未計測は未計測）・販促日程・社長の却下理由',
    criteria: '収益に近い順（既存の完成品の販促 > 新しい企画）。同じ企画の重複・直近の分野の偏りは避ける', ban: COMMON_BAN + '新しい事業を仕事づくりのために作らない。', output: '誰に・何の悩みに・どの商品で、が書かれた企画1件（または施策1件）と、検証する数字',
    gate: '対象・悩み・商品・測る数字の4つがそろい、既存と重複しない', onFail: '材料が足りなければ作らず、足りない材料（未計測・商品不足）を理由に残す', handoff: '企画→バイヤー（商品探し）→ライター', kpi: '投稿できる完成品の数と、実測の閲覧・成約（案の数は成果にしない）' },
  buyer: { name: 'バイヤー', expertise: '楽天市場の商品検索・価格帯・用途の比較、アフィリエイトの料率の考え方', duty: '企画に合う実在の商品を、楽天の検索結果から選ぶ', input: '企画・楽天の検索結果（商品名・価格・URL）',
    criteria: '企画の用途に合う・価格帯が散る・実質同じ商品を重ねない・検索結果にあるものだけ', ban: COMMON_BAN + '検索結果に無い商品・価格を作らない。', output: '商品番号・名前・価格・URL つきの選定と、選んだ理由',
    gate: '全商品が楽天の検索結果に実在する（番号・URL）', onFail: '見つからなければ枠を広げて再検索。足りなければ無関係な商品で埋めず保留と不足数を残す', handoff: 'バイヤー→監査（並びの確認）', kpi: '6点そろった企画の数・重複と関係の薄い商品の率' },
  auditor: { name: '監査', expertise: 'Instagram・楽天ROOM・楽天アフィリエイト・ステマ規制の規約、商品の並びの妥当性', duty: '他の担当の成果物を、根拠・規約・費用・実行負荷で止める。選ぶ役はしない', input: '成果物本体・保存済みの事実',
    criteria: '根拠が示せない主張・規約違反・実質的な重複・PR表記の欠落は不合格', ban: COMMON_BAN + '自分で商品を選び直さない。', output: '合格／不合格と、番号つきの理由と直す点',
    gate: '不合格の理由が具体（どの商品・どの文）で、直せる形になっている', onFail: '判断できなければ合格にせず「未確認」と理由を残す', handoff: '不合格→差し戻し先の担当／合格→次の担当', kpi: '見逃し（後から見つかった規約違反）の数・差し戻しで直った率' },
  writer: { name: 'ライター', expertise: 'Instagramのリール冒頭・検索される言葉・短い紹介文', duty: '完成品ごとに、最初の2秒の一言・検索の文言・紹介文を作る', input: '企画・商品の保存済みの事実（名前・価格・用途）',
    criteria: '具体的な悩みに答える・事実は保存済みのものだけ・PR表記つき', ban: COMMON_BAN + '商品の効能を作らない。', output: '冒頭の一言／キーワード・代替テキスト・ハッシュタグ3〜5個',
    gate: '禁止表現（誇張・体験談・医療）が無く、商品の事実が保存済みの内容と合う', onFail: '禁止表現が出たら作り直し、直らなければ作らず理由を残す', handoff: 'ライター→編集（文字数・番号の確認）', kpi: '投稿に使われた文言の数と、使った施策ごとの実測の閲覧' },
  editor: { name: '編集', expertise: '投稿の文字数・ハッシュタグ・商品番号・ROOM紹介文の整え方', duty: '完成品の文章を規約と文字数に合わせ、紹介番号の不足を直す', input: '完成品の文章・商品・監査の指摘',
    criteria: '事実を変えない・PR表記を残す・番号の再利用なし', ban: COMMON_BAN, output: '直した文章と、直した点の一覧', gate: '直したあとに再点検が通る', onFail: '直せなければ元の文章を残し、理由を監査へ', handoff: '編集→監査', kpi: '再点検で不足ゼロになった完成品の数' },
  designer: { name: 'デザイナー', expertise: '表紙画像・サングラスくまのマスター画像の使い方', duty: '1企画1枚の表紙を作る。表紙が無いものは納品させない', input: '企画・マスター画像・画像の予算',
    criteria: 'マスターのくまの特徴を保つ・文字は正しい名前（サングラスくま）', ban: COMMON_BAN + 'アカウント名を旧名にしない。', output: '表紙画像1枚（AI生成の表示つき）', gate: '客観確認（マスターとの一致・文字）が通る', onFail: '予算不足は「画像待ち」で保存して続きから再開。勝手に描き直し続けない', handoff: 'デザイナー→監査', kpi: '表紙つきで納品できた完成品の数' },
  pr: { name: '広報（ECグロース責任者）', expertise: 'ECのグロース（ファネル分析・競合との差分の優先順位づけ・検証）。Instagram→ROOM→楽天の導線',
    duty: '現状のファネル、競合との差分、需要、今後の展望、優先施策、制作指示、検証までを、根拠つきで担当する',
    input: '実績の数字（閲覧→プロフィール→ROOM→成約・未計測は未計測）／競合の観測（出典URL・取得日・観測した事実・推測を分けたもの）／既存の完成品',
    criteria: '比較軸（商品選定・対象顧客・訴求・画像・冒頭・CTA・投稿頻度・導線・反応）ごとに、自社との差分を根拠つきで優先順位づける。実売上が非公開なら断定しない',
    ban: COMMON_BAN + '一般論・架空の競合データを書かない。ログイン・アクセス制限・取得の制限を回避しない。取得に失敗したことを完了扱いにしない。',
    output: '競合との差分の優先順位表と、具体的な既存商品の販促タスク（担当・成果物・測る数字つき）',
    gate: '競合の主張に出典URLと取得日がある。観測と推測が分かれる。タスクが既存の完成品に結びつく', onFail: '取得できないときは原因の分類・再試行の条件・代替の確認・必要最小限の社長の操作を記録する（取得できたことにしない）',
    handoff: '広報→企画/ライター（制作指示）→監査（検証）', kpi: '施策を付けた投稿の実測の閲覧・クリック・成約（施策の数・案の数は成果にしない）' },
  appraiser: { name: '鑑定（分析）', expertise: '実績の読み取りと、計測の不足の整理', duty: '実績・成果の数字を記録し、足りない計測を具体的に書き出す', input: '社長が登録した実績・売上・保存済みの完成品',
    criteria: '数字は登録されたものだけ。未計測は未計測', ban: COMMON_BAN + '数字を推測で埋めない。', output: '成果の数字の記録／計測の不足の一覧（完成品ごと）', gate: '全ての数字に登録元がある', onFail: '読み取れない数字は空欄にして理由を残す', handoff: '鑑定→広報・企画（実績にもとづく施策）', kpi: '実績が登録された完成品の割合' }
};
export const ACTIVE_ROLES = Object.keys(ROLE_SPECS);

export function roleBrief(role) {
  const r = ROLE_SPECS[role];
  if (!r) return '';
  return `【役割：${r.name}】\n${FIELDS.map((f) => `・${FIELD_LABEL[f]}：${r[f]}`).join('\n')}`;
}
export const withRole = (role, prompt) => `${roleBrief(role)}\n\n${prompt}`;

// ---- 指示の評価：10項目が具体的な文章で入っているか。役職名だけの指示は不合格 ----
export function scorePrompt(text) {
  const t = String(text || '');
  const have = FIELDS.filter((f) => t.includes(`${FIELD_LABEL[f]}：`));
  const missing = FIELDS.filter((f) => !have.includes(f));
  return { score: have.length, total: FIELDS.length, missing, ok: !missing.length };
}
// 旧版（役職名だけ）の指示。同じ入力で新版と比べるための基準
export const legacyPrompt = (role) => `あなたは「サングラスくま株式会社」の${(ROLE_SPECS[role] || {}).name || role}です。`;
// 成果の文章の評価：一般論・架空の競合データ・出典のない断定は不合格
const GENERIC = /一般的に|多くの(アカウント|ユーザー|競合)|と言われています|一流の|トレンドを(押さえ|意識)|工夫(して|する)(ください|べき)|頑張|さまざまな/;
const PLACEHOLDER = /example\.(com|org)|〇〇|○○|△△|xxx|ダミー|サンプル(アカウント|商品)|@account\d|@competitor/i;
export const isGenericOrFake = (t) => GENERIC.test(String(t)) || PLACEHOLDER.test(String(t));
export function evaluateOutput(text) {
  const t = String(text || '');
  const issues = [];
  if (t.trim().length < 20) issues.push('短すぎて具体的な内容が無い');
  if (GENERIC.test(t)) issues.push('一般論の言い回し（具体的な事実・数字・出典が必要）');
  if (PLACEHOLDER.test(t)) issues.push('架空・仮の競合データ（実在の出典が必要）');
  if (!/\d/.test(t) && !/https:\/\//.test(t)) issues.push('数字も出典URLも無い');
  return { ok: !issues.length, issues };
}
export const ventureDiscoveryOn = (env = {}) => String(env.VENTURE_DISCOVERY || '').toLowerCase() === 'on';
