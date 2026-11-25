// 収益の経営手法（2026-11-24・KOT-13：社長の参考資料「楽天アフィ攻略」1〜20ページを一体として、ROOM以外の事業にも使う）
//   - すべてコードの計算（AIは使わない・費用0円）。新規ROOM商品紹介の停止（company.js の roomStopState）は変えない・再開しない
//   - 数字は「実績（アプリの記録・社長の登録）」と「仮説（資料の例示・未確認）」を必ず分ける。取れない数字は null（画面で「未計測」）
//   - 資料の例示の数字（30日60投稿・1商品10訴求・購入率5%・CTR1%・成果条件24時間/89日など）は仮説で、保証・ノルマにしない
//   - 料率・成果条件・セールの日付は公式で確認したものだけを事実として扱う（未確認は「要公式確認」）
// 社員の名前（company.js の STAFF と同じ。循環の読み込みを避けるためここにも置く）
const STAFF_NAMES = { buyer: 'バイヤー', auditor: '監査', planner: '企画', writer: 'ライター', editor: '編集', designer: 'デザイナー', pr: '広報', appraiser: '鑑定（廃止）' };

const K = { sets: 'v2:sets', set: (id) => `v2:set:${id}`, perf: 'v2:perf', sales: 'v2:sales', ventures: 'v2:ventures', reviews: 'v2:profit:reviews', calendar: 'v2:profit:calendar', kick: 'linear-kick:last', roomStop: 'v2:room:stop' };
export { K as PROFIT_KEYS };
export const TARGET_YEN = 30000; // 社長の目標：月3万円以上の安定した収益
export const REVIEW_EVERY_MS = 7 * 24 * 3600000;
const now = () => new Date().toISOString();
const jst = (d = new Date()) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const nn = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const ratio = (a, b) => (a == null || b == null || !b ? null : Math.round((a / b) * 10000) / 10000);

// ---- 資料の手法ごとの判断（採用・保留・不採用・理由・担当・成果物・確かめ方） ----
//   status は実際のデータから計算する（作っただけで「できた」にしない）
export const METHODS = [
  { id: 'pain', name: '商品ではなく顧客の具体的な悩みから需要を調べる', decision: 'adopt', why: '悩みが先にあると、紹介の理由と対象が決まる。ROOM以外の事業（デジタル商品・副業）にもそのまま使える', owner: 'planner', deliverable: '事業案ごとの「対象・課題」（KOT-12 の新規副業・デジタル商品の案）', verify: '案に対象と課題が書かれているか（コードの監査）' },
  { id: 'research', name: '公開SNS・レビュー・検索結果で需要を確かめる（出典・確認日時・事実と仮説を分ける）', decision: 'adopt', why: '確認できない情報を作らない方針と一致。楽天市場の検索は既に使える', owner: 'buyer', deliverable: '事業案の「調べた事実」（楽天市場の検索の件数・価格帯・確認日時）', verify: '出典つきの事実が1件以上あるか。AIの知識は「出典未確認」と表示' },
  { id: 'competitor', name: '競合の顧客層・訴求・冒頭・構成・導線を分析する（文章や画像は真似しない）', decision: 'hold', why: '他のアカウントの投稿を読む公式APIが無い（Instagramログイン方式では不可）。社長が見つけた投稿のURLを登録すれば分析できる', owner: 'pr', deliverable: '構造の分析メモ（真似ではなく型）', verify: '公式APIか社長の登録が来たら再開。それまで「未計測」' },
  { id: 'reviews', name: '既存の商品の購入理由・不満・合う人/合わない人を実レビューで確かめる（架空レビュー・体験談は禁止）', decision: 'hold', why: '楽天のレビュー本文を取る公式の手段が今のアプリに無い。推測で書くと方針違反', owner: 'auditor', deliverable: 'レビューの要点（出典URL・確認日つき）', verify: 'レビューの取得手段が用意できたら再開' },
  { id: 'reuse', name: '新しい紹介を作らずに、既存の完成品の訴求・導線を改善する', decision: 'adopt', why: '停止中でも使える。作った在庫を売上に近づける最短の仕事', owner: 'writer', deliverable: '完成品の冒頭の一言・検索の文言（hooks・seo）', verify: '投稿できる完成品のうち、冒頭の一言がある数' },
  { id: 'compare', name: '需要・競争・報酬/利益率・継続性・AIで代行できるか・社長の手間で事業を比べ、少数に絞る', decision: 'adopt', why: '量ではなく利益で選ぶ。KOT-12 の優先順（低コスト・手間・再現性）に、下の逆算を足す', owner: 'planner', deliverable: '事業の優先順・月3万円の逆算（このページ）', verify: '逆算に使った数字が実績か仮説か表示されているか' },
  { id: 'funnel', name: '閲覧→クリック→成約→確定報酬→費用を引いた利益を、投稿ごとに測る（CTR・CVR・利益）', decision: 'adopt', why: '月3万円に何が足りないかは、どの段階で落ちているかでしか分からない', owner: 'pr', deliverable: '投稿ごとの数字の表（未計測は未計測）', verify: '社長の登録（Instagramのインサイト・楽天のレポート）が入った投稿の数' },
  { id: 'official', name: '価格・在庫・料率・成果条件・規約は公式で確認する（資料の数字を現行の証拠にしない）', decision: 'adopt', why: '方針「確認できない情報は作らない」と同じ。料率・成果条件（資料は24時間・89日）は公式で未確認', owner: 'auditor', deliverable: '不足条件の一覧の「公式で未確認」の行', verify: '社長が公式の画面で確かめて登録するまで「要公式確認」' },
  { id: 'roles', name: '集客・興味・購入の役割ごとに中身を分け、広告でない有益な情報を優先する', decision: 'adopt', why: '売り込みだけでは見られない。資料の8:2は仮説で、ノルマにしない', owner: 'pr', deliverable: '集客の施策のボード（growth）と投稿の役割', verify: '施策を付けた投稿の効果の判定（1.3倍以上で効果あり）' },
  { id: 'angles', name: '1つの資産から違う訴求を少しずつ作って比べる', decision: 'adopt', why: '新しい商品を探さずに反応を比べられる。資料の「1商品10訴求」は仮説で、まず2〜3案', owner: 'writer', deliverable: '冒頭の一言（reveal・top3・caption の別案）', verify: '施策・訴求を付けた投稿の閲覧の比較' },
  { id: 'calendar', name: '季節の需要・販売イベントを公式の根拠つきでカレンダーにする（期限切れは出さない）', decision: 'adopt', why: '日付で需要が動く。楽天のセールの日付は公式で確認したものだけを載せる', owner: 'planner', deliverable: '販促カレンダー（このページ）', verify: '過ぎた日付が出ていないか・楽天のイベントは公式URLつきか' },
  { id: 'weekly', name: '週ごとの見直しで、いちばん詰まっている段階・次の検証・担当・成果物・やめる条件を決める', decision: 'adopt', why: '曜日で社員を待たせず、数字で次の仕事を決めて引き継ぐ', owner: 'pr', deliverable: '週ごとの見直しの記録（7日に1回・0円）', verify: '見直しが7日以内にあるか・担当と成果物が書かれているか' },
  { id: 'reverse', name: '月3万円の利益から、単価・料率・成約率・クリック率・必要な閲覧・費用を逆算する', decision: 'adopt', why: '必要な閲覧の量が分かると、今の差（何倍足りないか）が分かる', owner: 'pr', deliverable: '逆算の表（実績があれば実績、無ければ仮説と明記）', verify: '逆算の入力ごとに「実績」「仮説」の印があるか' },
  { id: 'roadmap', name: '30日のロードマップ（30日で60投稿など）', decision: 'hold', why: '投稿の数をノルマにしない方針。新規ROOM紹介も停止中。週ごとの見直しで次の一手を決める形に置き換える', owner: 'planner', deliverable: '（週ごとの見直しで代わりにする）', verify: '—' },
  { id: 'new-room', name: '資料のとおり新しい商品紹介を増やす', decision: 'reject', why: '社長の指示（KOT-13）で新規ROOM商品紹介は停止中。社長が画面で再開するまで、資料を理由に再開しない', owner: 'buyer', deliverable: '—', verify: '停止の印（v2:room:stop）が続いているか' },
  { id: 'auto-post', name: '投稿・いいね・フォロー・コメントの自動化', decision: 'reject', why: '楽天ROOM・Instagram の規約とアプリの方針で禁止。アプリは下書きまで、実行は社長が手で行う', owner: 'pr', deliverable: '—', verify: '—' }
];
export const DECISION_LABEL = { adopt: '採用', hold: '保留', reject: '不採用' };

// ---- 投稿ごとの数字（CTR・CVR・利益） ----
//   クリック：ROOMへのクリック（無ければリンクのタップ）。成約・確定報酬・費用は社長の登録（楽天アフィリエイトのレポート）だけ
export function postRow(r) {
  const views = nn(r.views != null ? r.views : r.reach);
  const clicks = nn(r.roomClicks != null ? r.roomClicks : r.linkClicks);
  const orders = nn(r.orders); const reward = nn(r.reward); const cost = nn(r.cost);
  return { id: r.id, title: r.title || r.theme || '（題名なし）', postedAt: r.postedAt || '', views, clicks, orders, reward, cost, ctr: ratio(clicks, views), cvr: ratio(orders, clicks), profit: reward == null ? null : Math.round((reward - (cost || 0)) * 10) / 10, tactics: r.tactics || [] };
}
export function funnelTotals(rows) {
  const sum = (k) => { const a = rows.filter((x) => x[k] != null); return a.length ? a.reduce((s, x) => s + x[k], 0) : null; };
  // 割合は「両方の数字がある投稿」だけで計算する（片方だけの投稿を混ぜない）
  const pair = (a, b) => { const xs = rows.filter((x) => x[a] != null && x[b] != null); return xs.length ? ratio(xs.reduce((s, x) => s + x[a], 0), xs.reduce((s, x) => s + x[b], 0)) : null; };
  const t = { posts: rows.length, views: sum('views'), clicks: sum('clicks'), orders: sum('orders'), reward: sum('reward'), cost: sum('cost'), ctr: pair('clicks', 'views'), cvr: pair('orders', 'clicks') };
  t.profit = t.reward == null ? null : Math.round((t.reward - (t.cost || 0)) * 10) / 10;
  return t;
}

// ---- 月3万円からの逆算 ----
//   単価：アプリの完成品の商品の価格の中央値（実績）。料率・成約率・クリック率：実績があれば実績、無ければ仮説（資料の例示・公式未確認）
export const HYPOTHESIS = {
  rate: { value: 0.03, basis: '仮説：楽天アフィリエイトの料率は商品のジャンルで違う（公式で未確認。社長が確認して登録すると置き換わる）' },
  cvr: { value: 0.05, basis: '仮説：資料の例示「購入率5%」（保証ではない）' },
  ctr: { value: 0.01, basis: '仮説：資料の例示「CTR1%」（保証ではない）' },
  price: { value: 3000, basis: '仮説：完成品の価格が無いときの仮の単価' }
};
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
export function reverse({ prices = [], totals = {}, rate = null, recentViews30 = null, target = TARGET_YEN } = {}) {
  const pick = (k, actual, basis) => (actual != null && actual > 0 ? { value: actual, kind: 'actual', basis } : { value: HYPOTHESIS[k].value, kind: 'hypothesis', basis: HYPOTHESIS[k].basis });
  const p = pick('price', median(prices.filter((x) => x > 0)), `実績：アプリの完成品の商品${prices.length}点の価格の中央値`);
  const r = pick('rate', rate, '社長が公式で確認して登録した料率');
  const cvr = pick('cvr', totals.cvr, '実績：社長が登録した成約÷クリック');
  const ctr = pick('ctr', totals.ctr, '実績：社長が登録したクリック÷閲覧');
  const perOrder = Math.round(p.value * r.value * 10) / 10;
  const orders = perOrder > 0 ? Math.ceil(target / perOrder) : null;
  const clicks = orders == null ? null : Math.ceil(orders / cvr.value);
  const views = clicks == null ? null : Math.ceil(clicks / ctr.value);
  const gap = views != null && recentViews30 ? Math.round((views / recentViews30) * 10) / 10 : null;
  return { target, inputs: { price: p, rate: r, cvr, ctr }, perOrder, need: { orders, clicks, views, viewsPerDay: views == null ? null : Math.ceil(views / 30) }, recentViews30, gap, allActual: [p, r, cvr, ctr].every((x) => x.kind === 'actual'), note: '仮説を含む逆算は目安で、収益の保証ではない。実績が入るたびに置き換わる' };
}

// ---- 販促カレンダー（季節の行事は暦で計算・楽天のイベントは公式で確認したものだけ日付を載せる） ----
const nthWeekday = (y, m, wd, n) => { const d = new Date(Date.UTC(y, m - 1, 1)); const off = (wd - d.getUTCDay() + 7) % 7; return `${y}-${String(m).padStart(2, '0')}-${String(1 + off + (n - 1) * 7).padStart(2, '0')}`; };
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export function seasonEvents(year) {
  return [
    ['正月・初売り', ymd(year, 1, 1)], ['バレンタインデー', ymd(year, 2, 14)], ['ひな祭り', ymd(year, 3, 3)], ['ホワイトデー', ymd(year, 3, 14)], ['新生活（4月）', ymd(year, 4, 1)],
    ['こどもの日', ymd(year, 5, 5)], ['母の日', nthWeekday(year, 5, 0, 2)], ['父の日', nthWeekday(year, 6, 0, 3)], ['七夕', ymd(year, 7, 7)], ['敬老の日', nthWeekday(year, 9, 1, 3)],
    ['ハロウィン', ymd(year, 10, 31)], ['クリスマス', ymd(year, 12, 25)], ['大みそか・年末', ymd(year, 12, 31)]
  ].map(([name, date]) => ({ name, start: date, end: date, kind: 'season', basis: '暦（日付は計算で確定）' }));
}
export const RAKUTEN_EVENTS = [
  { name: '楽天スーパーSALE', basis: '要公式確認：開催日は楽天市場の公式ページで確認して登録する（推測で日付を入れない）' },
  { name: 'お買い物マラソン', basis: '要公式確認：開催日は不定期。公式ページで確認して登録する' },
  { name: 'ポイントアップの日（5と0のつく日など）', basis: '要公式確認：条件・対象は変わることがある。公式ページで確認する' }
];
export const OFFICIAL_EVENT_URL = 'https://event.rakuten.co.jp/';
export const OFFICIAL_URL_RE = /^https:\/\/([\w-]+\.)*rakuten\.(co\.jp|com)\//;
export function calendar(saved = [], d = new Date(), days = 120) {
  const today = jst(d); const until = jst(new Date(d.getTime() + days * 86400000));
  const y = Number(today.slice(0, 4));
  const season = [...seasonEvents(y), ...seasonEvents(y + 1)];
  const confirmed = (saved || []).filter((e) => e && OFFICIAL_URL_RE.test(e.url || '')).map((e) => ({ name: e.name, start: e.start, end: e.end || e.start, kind: 'rakuten', url: e.url, basis: `公式で確認（${String(e.at || '').slice(0, 10)}・社長の登録）` }));
  const items = [...season, ...confirmed].filter((e) => e.end >= today && e.start <= until).sort((a, b) => a.start.localeCompare(b.start));
  return { from: today, until, items, unconfirmed: RAKUTEN_EVENTS.filter((r) => !confirmed.some((c) => c.name.includes(r.name.slice(0, 4)))).map((r) => ({ ...r, url: OFFICIAL_EVENT_URL })) };
}
// 社長が公式で確かめたイベントを登録する（楽天の公式のURLだけ・過ぎたものは自然に出なくなる）
export async function addCalendar(kv, x = {}) {
  const name = str(x.name, 40); const start = String(x.start || ''); const end = String(x.end || x.start || ''); const url = String(x.url || '');
  if (!name) throw new Error('イベントの名前を入れてください');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) throw new Error('日付は YYYY-MM-DD で入れてください（終わりは始まり以降）');
  if (!OFFICIAL_URL_RE.test(url)) throw new Error('楽天の公式ページのURL（https://…rakuten.co.jp/…）を入れてください');
  const list = ((await kv.getJson(K.calendar)) || []).filter((e) => e.end >= jst());
  const e = { name, start, end, url: url.slice(0, 300), at: now() };
  await kv.setJson(K.calendar, [e, ...list.filter((y) => !(y.name === name && y.start === start))].slice(0, 40));
  return e;
}

// ---- 不足条件（何が足りないか・根拠・利益への影響・解決策・費用・担当・社長の操作・優先・解決状況） ----
//   すべて実際のデータから判定する。解決したら自動で「解決済み」になる
export function missingConditions(f) {
  const out = [];
  const add = (x) => out.push({ status: x.ok ? 'solved' : 'open', ...x });
  add({ id: 'perf', what: '投稿の実績（閲覧・クリック）', ok: f.perfPosts > 0, basis: `登録された投稿の実績 ${f.perfPosts}件（v2:perf）`, impact: '何が届いているか分からず、次の一手を数字で決められない', fix: 'Instagramのインサイトの数字を「成果」タブで登録する（スクショの読み取りもある）', cost: '0円（スクショの読み取りは1回約1円）', owner: 'pr', ownerAction: '投稿したら、インサイトのスクショを「成果」タブから登録', priority: 1 });
  add({ id: 'clicks', what: '楽天へのクリック数', ok: f.totals.clicks != null, basis: f.totals.clicks == null ? 'クリックの登録が無い（未計測）' : `クリック ${f.totals.clicks}`, impact: 'CTR（閲覧のうち楽天へ進んだ割合）が出せない', fix: '楽天アフィリエイトのレポートのクリック数を、投稿ごとに登録する', cost: '0円', owner: 'pr', ownerAction: '楽天アフィリエイトのレポート画面のクリック数を登録', priority: 1 });
  add({ id: 'orders', what: '成約・確定報酬（実際の売上）', ok: f.totals.reward != null || f.salesMonth > 0, basis: f.totals.reward == null && !f.salesMonth ? '成約・確定報酬の登録が無い（未計測）' : `確定報酬 ${f.totals.reward ?? '未計測'}・今月の売上の登録 ${f.salesMonth}円`, impact: '利益が1円でも出ているかを確かめられない（いちばん大事な数字）', fix: '楽天アフィリエイトのレポートの成果件数・確定報酬を登録する（売上は捏造しない）', cost: '0円', owner: 'pr', ownerAction: '楽天アフィリエイトのレポートの「確定報酬」を月に1回以上登録', priority: 1 });
  add({ id: 'rate', what: '料率・成果の条件（資料は24時間・89日）の公式の確認', ok: f.rateConfirmed, basis: f.rateConfirmed ? '社長が公式で確認した料率がある' : '資料の記載だけで、現行の公式条件は未確認', impact: '逆算の「1件あたりの報酬」が仮説のまま', fix: '楽天アフィリエイトの公式ページで料率・成果条件を確認する', cost: '0円', owner: 'auditor', ownerAction: '楽天アフィリエイトの公式の料率の表を確認し、数字を伝える（AIはWebの調査をしていない）', priority: 2 });
  add({ id: 'postable', what: '投稿できる完成品（表紙・PR表記・商品URLがそろったもの）', ok: f.postable > 0, basis: `投稿できる完成品 ${f.postable}件（kpi）`, impact: '既存の在庫で売上の検証ができない', fix: '既存の完成品の足りない部分（表紙など）をそろえる。新しい紹介は作らない', cost: '表紙は1枚約10〜18円', owner: 'designer', ownerAction: '', priority: 2 });
  add({ id: 'budget', what: 'AIの予算の残り', ok: f.budgetLeft >= 50, basis: `今月の残り 約${Math.round(f.budgetLeft)}円（上限 ${f.budgetLimit}円・引き上げない）`, impact: '残りが少ないと、AIを使う仕事（文章・画像）が止まる。無料の仕事（逆算・見直し・カレンダー）を優先', fix: '月が変わるまで無料の仕事を優先する（上限は社長の方針で1000円のまま）', cost: '0円', owner: 'pr', ownerAction: '', priority: 3 });
  add({ id: 'ig-api', what: 'Instagramの公式APIの鍵（自分の投稿の数字の自動取得）', ok: f.igToken, basis: f.igToken ? 'IG_ACCESS_TOKEN が設定されている' : 'IG_ACCESS_TOKEN が未設定（数字は社長の手入力だけ）', impact: '投稿ごとの数字の登録が社長の手作業になる', fix: 'Meta の開発者画面で鍵を作り、Vercel の環境変数に入れる（秘密の情報なので社長の承認・操作が必要）', cost: '0円', owner: 'pr', ownerAction: '必要になったら、Meta の開発者画面で長期の鍵を作って Vercel に登録', priority: 3 });
  add({ id: 'sell-channel', what: 'デジタル商品の販売先（アカウント）', ok: f.adoptedDigital > 0 && f.sellChannel, basis: `採用されたデジタル商品・副業の案 ${f.adoptedDigital}件。販売先のアカウントはアプリの記録に無い`, impact: '下書きができても、売る場所が無いと最初の有償取引にならない', fix: '採用した案の販売先（note など）を社長が選んでアカウントを用意する（アカウント作成・公開は社長の承認が必要）', cost: '販売先の手数料（販売先で違う・未確認）', owner: 'editor', ownerAction: '採用した案があれば、販売先を選んでアカウントを作る', priority: 2 });
  add({ id: 'room-stop', what: '新規ROOM商品紹介（停止中）', ok: true, basis: f.roomStopped ? '社長の指示（KOT-13）で停止中。既存の完成品の改善と、ROOM以外の事業は動いている' : '再開済み', impact: '新しい紹介は増えない（指示どおり）', fix: '社長が画面で「再開する」と入力したときだけ再開（自動では再開しない）', cost: '0円', owner: 'buyer', ownerAction: '', priority: 9, note: '不足ではなく社長の判断。参考として表示' });
  add({ id: 'autodev', what: '自動開発の5分ごとの起動', ok: !!(f.kick && !/HTTP \d{3}|未設定|署名|接続できない/.test(f.kick.why || '')), basis: f.kick ? `最後の起動の確認：${f.kick.why || ''}（${String(f.kick.at || '').slice(0, 16)}）` : '起動の記録が無い（動いているか未確認）', impact: 'ChatGPT→Linear の依頼が、GitHub の定期実行（数時間おき）でしか始まらない', fix: 'GitHub の鍵（GH_DISPATCH_TOKEN）に Actions の書き込み権限を付けて作り直し、Vercel に登録し直す', cost: '0円', owner: 'pr', ownerAction: 'GitHub で鍵を作り直して Vercel に登録（手順は開発タブ・報告を参照）', priority: 2 });
  return out.sort((a, b) => (a.status === b.status ? a.priority - b.priority : a.status === 'open' ? -1 : 1));
}

// ---- 週ごとの見直し（7日に1回・コードだけ・0円）：いちばん詰まっている段階・次の検証・担当・成果物・やめる条件 ----
export function weeklyReview(f) {
  const t = f.totals; const H = HYPOTHESIS;
  let b;
  if (!f.perfPosts) b = { stage: '計測', evidence: '投稿の実績が1件も登録されていない（未計測）', next: '投稿できる完成品を1件投稿し、インサイトを登録する（社長の手で投稿）', dept: 'pr', deliverable: '投稿1件ぶんの実績の記録', stop: '2週続けて登録が無ければ、計測の方法（スクショの読み取り）を見直す' };
  else if (t.clicks == null) b = { stage: 'クリックの計測', evidence: `閲覧の記録は${t.views ?? '未計測'}あるが、楽天へのクリックが未計測`, next: '楽天アフィリエイトのレポートからクリック数を登録する', dept: 'pr', deliverable: 'クリック数つきの実績', stop: '—' };
  else if (t.ctr != null && t.ctr < H.ctr.value) b = { stage: '閲覧→クリック', evidence: `CTR ${(t.ctr * 100).toFixed(2)}%（仮説の目安 ${H.ctr.value * 100}%より低い）`, next: '既存の完成品で、冒頭の一言・導線の別案を2つ比べる（新しい紹介は作らない）', dept: 'writer', deliverable: '別案の冒頭の一言2つ・どの投稿で試すか', stop: '2投稿で比べて差が無ければ、訴求ではなく対象（誰に）を見直す' };
  else if (t.orders == null) b = { stage: '成約の計測', evidence: 'クリックはあるが、成約・確定報酬が未計測', next: '楽天アフィリエイトのレポートから成果件数・確定報酬を登録する', dept: 'pr', deliverable: '成約つきの実績', stop: '—' };
  else if (t.cvr != null && t.cvr < H.cvr.value) b = { stage: 'クリック→成約', evidence: `CVR ${(t.cvr * 100).toFixed(2)}%（仮説の目安 ${H.cvr.value * 100}%より低い）`, next: '紹介した商品が対象の人に合っているか（価格帯・用途）を監査が確かめ、合わない商品を外す', dept: 'auditor', deliverable: '合う人・合わない人の整理（実データだけ）', stop: '2週で成約が増えなければ、別の事業（デジタル商品）に時間を回す' };
  else b = { stage: '閲覧（集客）', evidence: `閲覧 ${t.views ?? '未計測'}。月3万円の逆算では1日 ${f.reverse.need.viewsPerDay ?? '未計算'} 回の閲覧が要る（仮説を含む）`, next: '効果ありの集客の施策を続け、新しい施策を1つだけ試す', dept: 'pr', deliverable: '施策1つの実験計画と投稿案', stop: '3投稿で平均以下なら見直し（集客の施策のボードの判定）' };
  return { at: now(), week: jst(), bottleneck: b.stage, evidence: b.evidence, nextTest: b.next, dept: b.dept, deptName: STAFF_NAMES[b.dept] || b.dept, deliverable: b.deliverable, stopCondition: b.stop, openMissing: f.missing.filter((m) => m.status === 'open').slice(0, 3).map((m) => m.what), funnel: t, profitYen: t.profit, salesMonth: f.salesMonth };
}

// ---- 事実を集める（AIは使わない） ----
export async function gatherFacts(kv, env = {}, { budgetLeft = null, budgetLimit = 1000, postable = 0, roomStopped = true } = {}) {
  const [perf0, list0, sales0, ventures0, cal0, kick] = await Promise.all([kv.getJson(K.perf), kv.getJson(K.sets), kv.getJson(K.sales), kv.getJson(K.ventures), kv.getJson(K.calendar), kv.getJson(K.kick)]);
  const rows = (perf0 || []).map(postRow);
  const totals = funnelTotals(rows);
  const prices = [];
  for (const x of (list0 || []).slice(0, 40)) { const s = await kv.getJson(K.set(x.id)); for (const p of (s && s.products) || []) if (Number(p.price) > 0) prices.push(Number(p.price)); }
  const since = Date.now() - 30 * 86400000;
  const recent = rows.filter((r) => r.views != null && r.postedAt && Date.parse(r.postedAt) >= since);
  const recentViews30 = recent.length ? recent.reduce((a, r) => a + r.views, 0) : null;
  const month = jst().slice(0, 7);
  const v = ventures0 || {};
  const vItems = Array.isArray(v.items) ? v.items : [];
  const confirmedRate = nn(((await kv.getJson('v2:profit:rate')) || {}).rate);
  const f = {
    rows, totals, perfPosts: rows.length, salesMonth: Number((sales0 || {})[month]) || 0, prices, recentViews30,
    budgetLeft: budgetLeft == null ? budgetLimit : budgetLeft, budgetLimit, postable,
    rateConfirmed: confirmedRate != null, igToken: !!String(env.IG_ACCESS_TOKEN || '').trim(), kick,
    adoptedDigital: vItems.filter((x) => x.status === 'adopted' && ['digital', 'venture'].includes(x.stream)).length, sellChannel: false,
    roomStopped
  };
  f.reverse = reverse({ prices, totals, rate: confirmedRate, recentViews30 });
  f.missing = missingConditions(f);
  f.calendar = calendar(cal0 || []);
  return f;
}
export async function setRate(kv, { rate, url }) {
  const r = Number(rate);
  if (!(r > 0 && r < 1)) throw new Error('料率は 0〜1 の数（例：3%なら 0.03）で入れてください');
  if (!OFFICIAL_URL_RE.test(String(url || ''))) throw new Error('確認した楽天の公式ページのURLを入れてください');
  const e = { rate: r, url: String(url).slice(0, 300), at: now() };
  await kv.setJson('v2:profit:rate', e);
  return e;
}

// 広報の仕事探し（2026-11-25 鑑定から移管）：週ごとの見直し（7日に1回）
export async function reviewWork(kv, ctxFacts) {
  const list = (await kv.getJson(K.reviews)) || [];
  if (list[0] && Date.now() - Date.parse(list[0].at) < REVIEW_EVERY_MS) return null;
  return { kind: 'profit-review', task: '週ごとの見直し：いちばん詰まっている段階・次の検証・担当・成果物・やめる条件を決める（コードの計算・0円）', doing: '今週の数字から、いちばん詰まっている段階を見ています', est: 0,
    run: async () => {
      const f = await ctxFacts();
      const r = weeklyReview(f);
      const cur = (await kv.getJson(K.reviews)) || [];
      if (cur[0] && Date.now() - Date.parse(cur[0].at) < REVIEW_EVERY_MS) return { done: '今週の見直しは済んでいた' };
      await kv.setJson(K.reviews, [r, ...cur].slice(0, 26));
      return { done: `週ごとの見直し：いちばん詰まっているのは「${r.bottleneck}」（${r.evidence}）。次の検証「${r.nextTest}」を${r.deptName}へ引き継ぐ（成果物：${r.deliverable}）`, handoff: r.dept, what: `次の検証「${r.nextTest}」`, title: `週の見直し（${r.week}）` };
    } };
}

// 画面に渡す状態（手法ごとの状況も実データで判定）
export async function profitState(kv, env, opts = {}) {
  const f = await gatherFacts(kv, env, opts);
  const reviews = (await kv.getJson(K.reviews)) || [];
  const done = {
    funnel: f.perfPosts > 0, reverse: true, calendar: true, weekly: !!(reviews[0] && Date.now() - Date.parse(reviews[0].at) < REVIEW_EVERY_MS + 86400000),
    official: f.rateConfirmed, reuse: null, research: null, pain: null, compare: true, roles: null, angles: null
  };
  const methods = METHODS.map((m) => ({ ...m, decisionLabel: DECISION_LABEL[m.decision], ownerName: STAFF_NAMES[m.owner] || m.owner, working: m.decision !== 'adopt' ? null : done[m.id] == null ? null : !!done[m.id] }));
  return { target: TARGET_YEN, methods, missing: f.missing, reverse: f.reverse, calendar: f.calendar, posts: f.rows.slice(0, 30), totals: f.totals, salesMonth: f.salesMonth, reviews: reviews.slice(0, 6), note: '数字は実績（アプリの記録・社長の登録）と仮説（資料の例示・未確認）を分けて表示。未計測は推測しない' };
}
