// サングラスくま株式会社 2.0（2026-11-15 基本設計・2026-11-16 24時間の自律運営に改修・docs/v2/design.md）
//   社長の指示を待たずに、7人のAI社員が自分で仕事を見つけ、工程ごとに引き継いで投稿セットを完成させ、社長に納品する。
//   - 案件（投稿セット1件）を最大3件まで並行して進める。各社員は1回の定期実行で1工程まで（抱えすぎない・AIを無制限に呼ばない）
//   - 工程ごとに「開始・完成・引き継ぎ・待ち・再試行・停止・納品」を出来事の記録（v2:events）に残す。画面はこの記録と案件の状態だけから作る
//   - 失敗は時間を空けて再試行（最大3回）。予算待ち・画像待ちは、予算が戻った回に自動で続きから進める
//   - 中身の処理は1.0で動作を確かめたもの（楽天の検索・企画・文章・監査・修正・表紙画像）を呼ぶ
import crypto from 'node:crypto';
import { searchPage, lookupItem } from '../rakuten.js';
import { runWithModels, compact, maskSecrets, NG_RE } from '../ai.js';
import { isolated } from '../ai-usage.js';
import { prWork, prAuditWork, prState, leadsFor, markLeadUsed } from './pr.js';
import { v1Enabled } from '../v1-retired.js';
import { hooksWork, plannerHint, reachState } from './reach.js';
import { check as budgetCheck, record as budgetRecord, spent as budgetSpent, limits as budgetLimits, imageCheck, imageSpent, imageLimits, imageDayAllowance, jstDate, IMAGE_ESTIMATE_YEN } from '../budget.js';
import * as P from '../production.js';
import { toItem, qualityCheck, MIN_ITEMS, gatherSlots } from '../postset.js';
import * as C from '../kuma-cover.js';
import { seasonWords } from '../buyer-angles.js';
import { PASS_SCORE } from '../agents.js';

// ---- 社員 ----
export const STAFF = [
  { id: 'buyer', name: 'バイヤー', job: '商品発掘・商品情報の収集' },
  { id: 'auditor', name: '監査', job: '商品情報・根拠・品質の確認' },
  { id: 'planner', name: '企画', job: 'テーマ・ターゲット・構成' },
  { id: 'writer', name: 'ライター', job: 'Instagram・楽天ROOMの文章' },
  { id: 'editor', name: '編集', job: '文章の改善・全体の整合性' },
  { id: 'designer', name: 'デザイナー', job: '表紙画像' },
  { id: 'pr', name: '広報', job: 'ハッシュタグ・投稿順・仕上げ' },
  { id: 'appraiser', name: '鑑定', job: 'スクショの商品を調べる（ポスト）' }
];
export const staffName = (id) => (STAFF.find((s) => s.id === id) || {}).name || (id === 'owner' ? '社長' : id);

// ---- 工程（仕事の型「投稿セット」）。将来の事業（note など）は別の型として工程の並びを足す（社員・記録・予定の仕組みは共通） ----
export const STEPS = {
  propose: { task: '新しい企画を提案する', agent: 'planner', doing: '季節・行事・これまでの成果から、新しい企画を考えています', est: 1 },
  find: { task: '主役の商品を探す', agent: 'buyer', doing: '楽天で主役の商品を探しています', est: 1 },
  checkHero: { task: '商品が買えるか確かめる', agent: 'auditor', doing: '商品が今も買えるか、楽天で確かめています', est: 0 },
  plan: { task: '投稿の構成を考える', agent: 'planner', doing: '投稿の構成を考えています', est: 1 },
  gather: { task: '一緒に紹介する商品を探す', agent: 'buyer', doing: '一緒に紹介する商品を楽天で探しています', est: 0 },
  pick: { task: '一緒に紹介する商品を選ぶ', agent: 'buyer', doing: '一緒に紹介する商品を選んでいます', est: 1 },
  curate: { task: '商品と企画の関係・重複・価格帯を確かめる', agent: 'auditor', doing: '商品が企画に合うか・重なっていないか・価格帯の付け方を確かめています', est: 1 },
  widen: { task: '探す範囲を広げる（6点に届くまで）', agent: 'buyer', doing: '関連商品・連想・価格帯へ探す範囲を広げています', est: 2 },
  copy: { task: 'Instagramの文章を書く', agent: 'writer', doing: 'Instagramの文章を書いています', est: 1 },
  room: { task: '楽天ROOMの紹介文を書く', agent: 'writer', doing: '楽天ROOMの紹介文を書いています', est: 1 },
  auditText: { task: '文章を確かめる', agent: 'auditor', doing: '文章に作り話や誇張がないか確かめています', est: 1 },
  edit: { task: '指摘された文章を直す', agent: 'editor', doing: '指摘された文章を直しています', est: 1 },
  review: { task: '投稿全体の整合性を確かめる', agent: 'editor', doing: '価格・商品数・表記がそろっているか確かめています', est: 0 },
  scene: { task: 'くまが商品を使う場面を考える', agent: 'designer', doing: 'くまが商品を使う場面を考えています', est: 1 },
  image: { task: '表紙画像を描く', agent: 'designer', doing: '表紙画像を描いています', est: 0 },
  checkImage: { task: '画像を確かめる', agent: 'auditor', doing: '画像を完成品に入れています', est: 0 }, // 2026-11-17：自動の描き直しをやめたので、AIでの確認はしない（前からの案件の受け皿）
  attach: { task: '完成品に表紙画像を入れる', agent: 'designer', doing: '作り直した表紙画像を完成品に入れています', est: 0 },
  pack: { task: '投稿の準備をそろえて納品する', agent: 'pr', doing: 'ハッシュタグ・投稿の順番・注意事項をそろえています', est: 0 }
};
// 画面の「次の工程」の目安（実際の分かれ道は工程の結果で決まる）
export const FLOW = ['propose', 'find', 'checkHero', 'plan', 'gather', 'pick', 'widen', 'curate', 'copy', 'room', 'auditText', 'review', 'scene', 'image', 'checkImage', 'pack'];
export const nextOf = (step) => (step === 'edit' ? 'auditText' : FLOW[FLOW.indexOf(step) + 1] || '');

export const MAX_ACTIVE = 3;       // 同時に進める案件（画像待ちを除く。2026-11-16：画像待ちと合わせて数えるのをやめ、画像待ちの間もほかの案件を進める）
export const MAX_IMAGE_WAIT = 2;   // 画像待ちの案件がこの数なら、新しい案件は始めない（画像は1日1枚のため、文章だけ作ってもたまるだけ）
export const MAX_WAITING = 5;
export const SLOT_STEP = 'copy'; // 確認待ちが上限のとき、新しい案件はこの工程（文章）の前で「完成品の枠待ち」になる（企画・商品はそろえて保存）
const SLOT_WHY = (n) => `完成品の枠待ち（社長の確認待ちが${n}件。企画と商品はそろえて保存してあり、枠が空いたら文章から続ける）`;      // 社長の確認待ちの完成品がこの数なら、新しい案件は始めない（見られない物に費用をかけない）
// 1企画の商品数（2026-11-17 社長の決定：3点では少ない。原則6点以上。6点ぴったりではなく余裕を持って探す）
export const V2_MIN_ITEMS = 6;
const REDO_RE = /磁気ケーブル|冬の小物を整える|コーヒーギフト/; // 2026-11-18 社長が名指しした、見直す完成品
export const V2_MAX_ITEMS = 10;
export const MAX_WIDEN = 2;        // 足りないときに探す範囲を広げる回数
export const HOLD_HOURS = 24;      // それでも足りないときの保留（無関係な商品で埋めない）
const PLAN_NOTE = `商品は本命を含めて7〜9点を探す（最低6点。在庫切れ・重複で外れる分の余裕を持つ）。同じ種類の商品を並べず、企画のテーマを中心に次を組み合わせる（固定の枠ではない。企画に合わせて考える）：本命（主役）／高価格帯（価格に見合う品質・機能・デザインの特徴がある上位候補）／低価格帯（安さだけでなく紹介する価値がある物）／関連商品（主役と一緒に使うと便利な物）／連想商品（同じ悩み・目的・場面から広げた別の種類の物）／変わり種（意外性があり紹介する価値がある物）。例：「デスク周りを快適にする」ならケーブルだけでなく、充電器・ケーブルホルダー・デスク収納・照明にも広げる。価格帯は機械的に均等にしなくてよいが、高い物と安い物を混ぜる`;
export const MAX_TRIES = 3;        // 1つの工程のやり直し（時間を空けて）
export const RETRY_MIN = 15;       // やり直しまでの間隔（分）× 回数
export const MAX_EDITS = 2;        // 監査→編集の差し戻し
export const MAX_REFIND = 2;       // 監査→バイヤーの差し戻し（商品が買えない）
export const MAX_IMAGE_ROUNDS = 3; // 画像の描き直し（日をまたぐ）
export const AGENT_PER_TICK = 3;   // 1人の社員が1回の定期実行で進める工程の数（抱えすぎない・AIを呼びすぎない）
export const TICK_BUDGET_MS = 25000;
// OpenAIの残高不足（2026-11-17 社長の依頼）：通常の失敗と分けて「残高待ち」にする。失敗の回数に数えず、案件は終わらせない
//   残高待ちの間はAIを呼ぶ工程を始めない。決まった時間ごとに1件だけ試し（30分→1時間→2時間→4時間）、通れば全部を続きから再開する
export const QUOTA_RE = /no credits remaining|insufficient_quota|exceeded your current quota|billing_hard_limit|check your plan and billing|OpenAIの残高/i;
export const QUOTA_WAIT_MIN = [30, 60, 120, 240];
export const isQuotaError = (t) => QUOTA_RE.test(String(t || '')); // 1回の定期実行で工程を進める時間の目安（関数の上限60秒の内側）
const THEMES = ['デスクまわりの便利グッズ', 'キッチンの時短グッズ', '部屋の収納', '防災の備え', '在宅ワーク', '旅行・出張の便利グッズ', '掃除の道具', '睡眠・リラックス', 'スマホまわりの小物', '季節の家電'];
const ANGLES = { premium: { label: '高級感・価格に見合う価値', sort: '-reviewCount', minReviews: 3, minPrice: 5000, maxPrice: 30000 }, value: { label: '高級品に迫る高コスパ', sort: '-reviewCount', minReviews: 5, maxPrice: 12000 }, classic: { label: '定番', sort: '-reviewCount', minReviews: 5 }, new: { label: '新商品', sort: '-updateTimestamp', minReviews: 0, word: '新作' }, preorder: { label: '予約商品', sort: '-updateTimestamp', minReviews: 0, word: '予約' }, season: { label: '季節商品', sort: '-reviewCount', minReviews: 3 }, gift: { label: 'ギフト需要', sort: '-reviewCount', minReviews: 5, word: 'ギフト' } };

const K = {
  trial: 'v2:trial',
  cases: 'v2:cases', job: 'v2:job', events: 'v2:events', sets: 'v2:sets', set: (id) => `v2:set:${id}`, imagewait: 'v2:imagewait', fixq: 'v2:fixq', requests: 'v2:requests',
  used: 'v2:used', staff: 'v2:staff', migrateCurate: 'v2:migrate:curate-1', migrateCurate2: 'v2:migrate:curate-2', genreIdx: 'v2:genreIdx', quota: 'v2:quota', themes: 'v2:themes', themeIdx: 'v2:themeIdx', sales: 'v2:sales', active: 'v2:active', lock: 'worker:lock', health: 'v2:health', metrics: 'v2:metrics', notices: 'v2:notices'
};
export { K as V2_KEYS };
const now = () => new Date().toISOString();
const newId = (p) => `${p}${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const short = (name) => P.programShortName(name);
const yenOf = (runs) => Math.round((runs || []).reduce((a, r) => a + (Number(r.yen) || 0), 0) * 1000) / 1000;
const titleOf = (c) => (c && c.data && (c.data.set || c.data.plan) ? (c.data.set || c.data.plan).title : c && c.data && c.data.theme ? `${c.data.theme}（企画中）` : '新しい企画');

// ---- 試験運用（2026-11-16 社長の決定）：14日間。期間中のAIの費用の合計（画面・1.0・2.0・画像すべて）が1,000円を超える有料の処理はしない
//   開始時点の今月の支出を記録し、それ以降の増分だけを数える（月の予算と二重に数えて使える額が増えないよう、使える残りは「試験の残り」と「今月の残り」の少ない方）
//   期間が終わっても上限は自動では増やさない（通常の上限のまま。続けるかは社長が費用と成果を見て決める）
export const TRIAL_DAYS = 14;
export const TRIAL_CAP_YEN = 1000;
export async function trialState(kv, env, { start = false } = {}) {
  let t = await kv.getJson(K.trial);
  if (!t && start) {
    const sp = await budgetSpent(kv);
    t = { start: now(), end: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(), cap: TRIAL_CAP_YEN, base: { month: jstDate().slice(0, 7), spent: sp.month } };
    await kv.setJson(K.trial, t);
    await record(kv, { agent: 'owner', type: 'owner', text: `14日間の試験運用を始めた（期間中の合計${TRIAL_CAP_YEN}円まで。開始時点の今月の支出 ${Math.round(sp.month * 10) / 10}円）` });
  }
  if (!t) return null;
  const months = []; for (let d = new Date(t.start); jstDate(d).slice(0, 7) <= jstDate().slice(0, 7); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 2))) { months.push(jstDate(d).slice(0, 7)); if (months.length > 3) break; }
  let used = 0;
  for (const m of [...new Set(months)]) { const v = Number(await kv.get(`budget:month:${m}`)) || 0; used += m === t.base.month ? Math.max(0, v - t.base.spent) : v; }
  const lim = budgetLimits(env); const sp = await budgetSpent(kv);
  const active = Date.now() < Date.parse(t.end);
  return { ...t, active, used: Math.round(used * 10) / 10, left: Math.round(Math.max(0, Math.min(t.cap - used, lim.month - sp.month)) * 10) / 10, monthLeft: Math.round(Math.max(0, lim.month - sp.month) * 10) / 10 };
}
// 試験運用中か（期間中は、1日25円・画像1日の目安・画像月200円を使わない。月1,000円と期間の合計1,000円だけで止める）
export async function trialOn(kv, env) { const t = await trialState(kv, env); return !!(t && t.active); }
async function trialAllows(kv, env, est) { const t = await trialState(kv, env); if (!t || !t.active) return { ok: true }; return t.used + est > t.cap ? { ok: false, reason: `14日間の試験運用の上限（合計${t.cap}円）に届くため、有料の処理はしない（期間中の支出 ${t.used}円）` } : { ok: true }; }

// 同じ保存場所の読み書きを1つずつ（並行処理で上書きし合わない）
const serialQ = new Map();
function serial(key, fn) { const prev = serialQ.get(key) || Promise.resolve(); const p = prev.then(() => fn(), () => fn()); serialQ.set(key, p.catch(() => {})); return p; }

// ---- 成果の数字（AIを呼んだ回数ではなく、完成品・品質・重複・費用） ----
async function bump(kv, patch) { return serial('metrics', () => bumpNow(kv, patch)); } // 並行して数えても、数え漏れしないよう1つずつ
async function bumpNow(kv, patch) {
  const m = (await kv.getJson(K.metrics)) || {};
  const month = jstDate().slice(0, 7);
  m[month] = m[month] || {};
  for (const [k, v] of Object.entries(patch)) { m[k] = (Number(m[k]) || 0) + v; m[month][k] = (Number(m[month][k]) || 0) + v; }
  await kv.setJson(K.metrics, m);
}

// ---- 出来事の記録（画面の唯一の材料） ----
let currentTrigger = ''; // 今の定期実行のきっかけ（qstash＝15分ごとの定期実行／workflow_dispatch＝手動）。記録に残し、定期実行で動いた証拠にする
export async function record(kv, e) {
  const ev = { at: now(), ...(currentTrigger ? { via: currentTrigger } : {}), ...e };
  if (ev.dev) ev.dev = maskSecrets(String(ev.dev)).slice(0, 300); // 開発者向けの記録（社長の画面には出さない）
  await kv.pushJson(K.events, ev, 500);
  return ev;
}
async function handoff(kv, job, to, what) {
  const from = STEPS[job.step].agent;
  if (from !== to) await record(kv, { job: job.id, agent: from, to, type: 'handoff', text: `${staffName(to)}へ引き継ぎ${what ? `（${what}）` : ''}`, title: titleOf(job) });
}

// ---- 企画：新しい企画を自分で提案する（季節・行事・これまでの成果・社長の判断。似た企画は繰り返さない） ----
// 商品の偏りを防ぐ（2026-11-17 社長の指摘：サングラス・メガネ・クロスばかりになった）
//   原因：会社名・キャラクター名「サングラスくま」への断り書きが無く、「採用した企画の方向を参考に」で同じジャンルが続き、重複の確認が言い回しだけだった
export const EYEWEAR_RE = /サングラス|眼鏡|メガネ|めがね|偏光|調光|アイウェア|レンズ|くもり止め|曇り止め|メガネ拭き|眼鏡拭き|ルーペ|老眼鏡/;
export const GENRES = ['キッチン・時短', 'デスク・在宅ワーク', 'ガジェット・スマホまわり', '防災・備え', '収納・片づけ', '掃除・洗濯', '睡眠・リラックス', '旅行・出張', '冬の乾燥・季節家電', 'ちょっといいギフト', '新商品・話題の便利グッズ', 'バス・洗面・身だしなみ', 'アウトドア・車'];
export function genreChoices(i) { return [0, 1, 2].map((k) => GENRES[(i * 3 + k) % GENRES.length]); }
async function rejectedWithNotes(kv, sets, n = 8) {
  const out = [];
  for (const x of sets.filter((y) => y.status === 'rejected').slice(0, n)) { const s = await kv.getJson(K.set(x.id)); out.push({ title: x.title, note: (s && s.ownerNote) || '' }); }
  return out;
}
const PROPOSE_PROMPT = `あなたは「サングラスくま株式会社」の企画担当です。忙しい社会人の「買い物の失敗を減らす」Instagram・楽天ROOMの投稿企画を1つ提案します。JSONだけを返してください。
- 誰に・どんな悩みを解決するために・なぜ今その商品を買ってもらうのか、が言える企画にする
- 「サングラスくま」はキャラクター（ぬいぐるみ風のくま）の名前。会社はサングラス・眼鏡の専門店ではない。便利グッズ・ガジェット・防災・生活用品・ギフト・新商品など、幅広い商品を扱う
- 「今回のジャンル」が渡されたら、その中から1つ選ぶ（同じジャンルを続けない）
- 「社長が却下した企画と理由」に書かれた社長のコメントは必ず守る（同じ理由で却下される企画は出さない）
- 会社の方針：特に (A) 高級感があり価格に見合う価値のある商品（基本3万円以内。デザイン・素材・機能・品質・ブランドに魅力があり、自分で使いたい・贈りたいと思えるもの）と、(B) 高級品に迫る高コスパ商品（単に安いのではなく「この価格でここまで」と思えるもの）を重視する
- 価格帯の目安（企画のルールではない）：3,000円未満＝手頃な高コスパ／3,000〜10,000円＝ちょっといいもの／10,000〜20,000円＝ご褒美・プレミアム／20,000〜30,000円＝高級・特別なギフト。1つの企画で混ぜても、1つに絞ってもよい
- 渡された「今の季節・行事」を使ってよい。発掘の方向（angle）は premium（高級感・価格に見合う価値）／value（高級品に迫る高コスパ）／classic（定番）／new（新商品）／preorder（予約商品）／season（季節商品）／gift（ギフト需要）から1つ
- 「最近の企画」「社長が却下した企画」と同じ・似たテーマ・同じジャンルは出さない。「社長が採用した企画」は良かった点（誰に・どんな悩み）だけを参考にし、同じジャンルの商品を続けない
- keyword は楽天の商品検索にそのまま使う短い言葉（2〜3語・商品の種類が分かる言葉）。医療・健康の効果をうたうテーマは出さない
出力形式: {"theme":"テーマ（20字以内）","keyword":"楽天の検索語","angle":"classic","target":"誰に（30字以内）","aim":"狙い：どんな悩みを解決し、なぜ今か（60字以内）","lead":0}（lead：広報の手がかりを使ったときだけ、その番号。使わないなら0）`;
const normTheme = (t) => String(t || '').normalize('NFKC').replace(/[\s　・、。「」『』（）()!！?？]/g, '').toLowerCase();
function bigrams(t) { const s = normTheme(t); const out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; }
export function similar(a, b) { const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return normTheme(a) === normTheme(b); let n = 0; A.forEach((x) => { if (B.has(x)) n += 1; }); return n / Math.min(A.size, B.size) >= 0.6; }
export function rakutenCodeFromUrl(url) { const m = String(url || '').match(/^https:\/\/item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/); return m ? `${m[1]}:${m[2]}` : ''; }
async function propose(job, ctx) {
  const reqs = (await ctx.kv.getJson(K.requests)) || [];
  const req = job.data.request || null;
  const recent = ((await ctx.kv.getJson(K.themes)) || []).slice(0, 30);
  if (req) {
    job.data.theme = req.text || 'ご指定の商品'; job.data.keyword = req.text || ''; job.data.angle = 'classic'; job.data.requestCode = rakutenCodeFromUrl(req.url); job.data.target = ''; job.data.aim = '社長の指定';
    await ctx.kv.setJson(K.themes, [{ theme: job.data.theme, keyword: job.data.keyword, at: now() }, ...recent].slice(0, 60));
    return { done: `社長の指定で企画を始めた（${req.url ? '指定の商品' : `テーマ「${job.data.theme}」`}）`, next: 'find', what: '主役の商品' };
  }
  void reqs;
  const leads = await leadsFor(ctx.kv, 4); // 広報が交流先で見つけたブランド・話題（参考）
  const perfHint = await plannerHint(ctx.kv); // Instagramの実績（社長が登録した数字。無ければ空）
  const custom = String(ctx.env.V2_THEMES || '').split(/[,、]/).map((t) => t.trim()).filter(Boolean); // 探すテーマを固定したいとき（環境変数）
  const sets = (await ctx.kv.getJson(K.sets)) || [];
  const adopted = sets.filter((x) => x.status === 'adopted' || x.status === 'posted').slice(0, 8).map((x) => x.title);
  const rejectedN = await rejectedWithNotes(ctx.kv, sets);
  const rejected = rejectedN.map((x) => x.title);
  const gi = Number(await ctx.kv.get(K.genreIdx)) || 0; await ctx.kv.set(K.genreIdx, String(gi + 1));
  const genres = genreChoices(gi);
  // 直近の企画・完成品に眼鏡関連があれば、今回は眼鏡関連を出さない（永久の禁止ではない）
  const eyewearRecent = [...recent.slice(0, 8).map((x) => x.theme), ...sets.slice(0, 8).map((x) => x.title)].filter((t) => EYEWEAR_RE.test(String(t || ''))).length;
  const m = new Date(Date.now() + 9 * 3600000);
  const user = [`今日: ${m.getUTCMonth() + 1}月${m.getUTCDate()}日`, `今の季節・行事: ${seasonWords().join('・')}`, custom.length ? `社長が決めた探すテーマ（この中から）: ${custom.join('・')}` : `テーマの例: ${THEMES.join('・')}`,
    `最近の企画（避ける）: ${recent.map((x) => x.theme).join('・') || 'なし'}`, `社長が採用した企画: ${adopted.join('・') || 'なし'}`, `社長が却下した企画と理由（同じ理由で却下される企画は出さない）: ${rejectedN.map((x) => `${x.title}${x.note ? `（社長のコメント：${x.note}）` : ''}`).join('／') || 'なし'}`, custom.length ? '' : `今回のジャンル（この中から1つ）: ${genres.join('・')}`, eyewearRecent ? `直近の企画に眼鏡関連（サングラス・メガネ・レンズ・メガネ拭きなど）が${eyewearRecent}件あるため、今回は眼鏡関連を出さない` : '', leads.length ? `広報が交流先で見つけたブランド・話題（参考。合うなら1つを使い、使ったら lead にその番号を入れる）: ${leads.map((l, i) => `[${i + 1}] ${l.topic}`).join('・')}` : '', job.data.avoid ? `今回は次と違うものにする: ${job.data.avoid}` : '', perfHint].filter(Boolean).join('\n');
  let d;
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: ctx.startedAt + 30000, system: PROPOSE_PROMPT, userContent: user, parse: (c) => { const x = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]); if (!x.theme || !x.keyword) throw new Error('企画が空でした'); return x; } });
    d = result;
  } catch (e) { return { fail: `企画を考えられなかった：${String(e.message || e).slice(0, 80)}` }; }
  const theme = String(d.theme).slice(0, 30), keyword = String(d.keyword).slice(0, 30);
  await bump(ctx.kv, { proposals: 1 });
  const dup = recent.slice(0, 20).find((x) => similar(x.theme, theme) || normTheme(x.keyword) === normTheme(keyword)) || rejected.find((t) => similar(t, theme));
  if (eyewearRecent && EYEWEAR_RE.test(`${theme} ${keyword}`)) { await bump(ctx.kv, { duplicates: 1 }); job.data.avoid = `${theme}（眼鏡関連が続いているため、別のジャンル：${genres.join('・')}）`; return { fail: `眼鏡関連の企画が続いている（「${theme}」）。別のジャンルで考え直す`, quick: true }; }
  if (dup) { await bump(ctx.kv, { duplicates: 1 }); job.data.avoid = `${theme}／${dup.theme || dup}`; return { fail: `最近と似た企画だった（「${theme}」）。別の企画を考え直す`, quick: true }; }
  job.data.theme = theme; job.data.keyword = keyword; job.data.angle = ANGLES[d.angle] ? d.angle : 'classic'; job.data.target = String(d.target || '').slice(0, 40); job.data.aim = String(d.aim || '').slice(0, 80);
  await ctx.kv.setJson(K.themes, [{ theme, keyword, at: now() }, ...recent].slice(0, 60));
  const lead = leads[Number(d.lead) - 1];
  if (lead) { job.data.lead = { topic: lead.topic, from: lead.from }; await markLeadUsed(ctx.kv, lead.key, theme); }
  return { done: `企画「${theme}」を提案した（${ANGLES[job.data.angle].label}・${job.data.target || '対象未定'}）${lead ? `。広報が見つけた「${lead.topic}」を使った` : ''}`, next: 'find', what: '主役の商品' };
}

// ---- バイヤー：主役の商品を探す（楽天の検索 → AIが1点選ぶ：誰に・どんな悩みを解決するか・なぜ今） ----
const HERO_PROMPT = `あなたは「サングラスくま株式会社」のバイヤーです。忙しい社会人の「買い物の失敗を減らす」ために、楽天の検索結果から、投稿の主役にする商品を1つ選びます。JSONだけを返してください。
- 会社の方針：特に (A) 高級感があり価格に見合う価値のある商品（基本3万円以内。デザイン・素材・機能・品質・ブランドに魅力があり、自分で使いたい・人に贈りたいと思えるもの）と、(B) 高級品に迫る高コスパ商品（単に安いのではなく「この価格でここまで」と思えるもの）を重視する。3万円を超えても特に魅力的なら選んでよい
- 選ぶ基準：誰に・どんな悩みを解決するか・なぜ今買う価値があるか、を商品データ（商品名・説明・価格・レビュー）だけで言えるもの
- 企画のテーマに合う商品だけを選ぶ（「サングラスくま」はキャラクター名。テーマに関係のないサングラス・眼鏡関連の商品は選ばない）
- 「社長の却下コメント」があれば、同じ理由で却下される商品は選ばない
- 確認できない性能・品質を「高級品と同等」「〇〇に匹敵」と断定しない。商品データに無い機能・効果・人気は書かない。体験したような表現・誇張・医療の効果は書かない
- reason：社長に1〜2行で伝わる選定理由（60字以内。商品データにある事実で）
- 出力形式: {"ref":"R1","who":"誰に（30字以内）","problem":"どんな悩みを解決するか（40字以内）","whyNow":"なぜ今（40字以内）","reason":"選定理由（60字以内）"}`;
export const PRICE_BANDS = [[0, 3000, '手頃な高コスパ'], [3000, 10000, 'ちょっといいもの'], [10000, 20000, 'ご褒美・プレミアム'], [20000, 30000, '高級・特別なギフト'], [30000, Infinity, '3万円超（特に魅力的な例外）']];
export const bandOf = (price) => (PRICE_BANDS.find(([a, b]) => price >= a && price < b) || PRICE_BANDS[0])[2];
const EQUIV_RE = /高級品(と|並み|に匹敵|顔負け|と同じ)|同等の(品質|性能|機能)|に匹敵|ハイブランド(並み|と同じ)|プロ仕様と同じ/;
export function heroFilter(items, used = new Set(), minReviews = 5) {
  return items.filter((it) => it.image && it.price >= 500 && it.price <= 50000 && it.reviewCount >= minReviews && !used.has(it.code) && !NG_RE.test(it.name)); // 3万円が通常の目安。特に魅力的なら5万円まで候補に残す
}
async function findHero(job, ctx) {
  const used = new Set((await ctx.kv.getJson(K.used)) || []);
  // 社長が商品を指定したとき：その商品を楽天で引いて主役にする
  if (job.data.requestCode) {
    const it = await lookupItem({ code: job.data.requestCode, env: ctx.env, referer: ctx.referer });
    if (!it) return { fail: '指定の商品が楽天で見つからなかった（URLを確かめてください）', final: true };
    job.data.hero = { code: it.code, name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop, caption: it.caption, reviewCount: it.reviewCount, reviewAverage: it.reviewAverage, checkedAt: '', who: job.data.target || '', problem: '', whyNow: '' };
    return { done: `指定の商品「${short(it.name)}」の情報を集めた（${it.price.toLocaleString('ja-JP')}円）`, next: 'checkHero', what: '商品の確認' };
  }
  let theme = job.data.theme, keyword = job.data.keyword;
  if (!theme) { const i = Number(await ctx.kv.get(K.themeIdx)) || 0; await ctx.kv.set(K.themeIdx, String(i + 1)); const themes = [...seasonWords(), ...THEMES]; theme = keyword = themes[i % themes.length]; job.data.theme = theme; }
  const ang = ANGLES[job.data.angle] || ANGLES.classic;
  const kw = ang.word && !String(keyword).includes(ang.word) ? `${keyword} ${ang.word}` : keyword;
  let r = await searchPage({ keyword: kw, env: ctx.env, referer: ctx.referer, sort: ang.sort, hits: 30, ...(ang.minPrice ? { minPrice: ang.minPrice } : {}), ...(ang.maxPrice ? { maxPrice: ang.maxPrice } : {}) });
  let list = heroFilter(r.items, used, ang.minReviews);
  if (!list.length && kw !== keyword) { r = await searchPage({ keyword, env: ctx.env, referer: ctx.referer, sort: '-reviewCount', hits: 30 }); list = heroFilter(r.items, used, 3); } // 新作・予約の言葉で見つからなければ、テーマだけで探し直す
  if (!EYEWEAR_RE.test(`${theme} ${keyword}`)) list = list.filter((it) => !EYEWEAR_RE.test(it.name)); // テーマが眼鏡でなければ、眼鏡関連の商品は候補から外す
  list = list.slice(0, 10).map((it, n) => ({ ...it, ref: `R${n + 1}` }));
  if (!list.length) { job.data.noHit = (job.data.noHit || 0) + 1; if (job.data.noHit > MAX_REFIND) return { fail: `企画を${job.data.noHit}回変えても、条件に合う商品が見つからなかった`, final: true }; job.data.avoid = `${theme}（商品が見つからなかった）`; job.data.theme = ''; job.data.keyword = ''; return { done: `「${keyword}」で条件に合う商品が見つからなかったので、企画に差し戻す`, next: 'propose', what: '別の企画' }; }
  const rejNotes = (await rejectedWithNotes(ctx.kv, (await ctx.kv.getJson(K.sets)) || [])).filter((x) => x.note).map((x) => x.note).slice(0, 6);
  const lines = list.map((it) => `${it.ref}: ${compact(it.name, 80)} / ${it.price}円（${bandOf(it.price)}） / レビュー${it.reviewCount}件（平均${it.reviewAverage}） / 説明: ${compact(it.caption, 150)}`).join('\n');
  let pick = null;
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: ctx.startedAt + 40000, system: HERO_PROMPT, userContent: `テーマ: ${theme}（${ang.label}）${job.data.target ? `\n企画の対象: ${job.data.target}` : ''}${job.data.aim ? `\n企画の狙い: ${job.data.aim}` : ''}${rejNotes.length ? `\n社長の却下コメント（同じ理由で却下される商品は選ばない）: ${rejNotes.join('／')}` : ''}\n${lines}`, parse: (c) => { const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]); const it = list.find((x) => x.ref === String(d.ref || '').trim()); if (!it) throw new Error('選んだ商品が検索結果にありません'); return { it, who: String(d.who || '').slice(0, 40), problem: String(d.problem || '').slice(0, 60), whyNow: String(d.whyNow || '').slice(0, 60), reason: EQUIV_RE.test(String(d.reason || '')) ? '' : String(d.reason || '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 80) }; } });
    pick = result;
  } catch (e) { return { fail: `商品を選べなかった：${String(e.message || e).slice(0, 80)}` }; }
  const it = pick.it;
  job.data.hero = { code: it.code, name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop, caption: it.caption, reviewCount: it.reviewCount, reviewAverage: it.reviewAverage, checkedAt: '', who: pick.who, problem: pick.problem, whyNow: pick.whyNow, reason: pick.reason, band: bandOf(it.price) };
  return { done: `「${short(it.name)}」を見つけた（${it.price.toLocaleString('ja-JP')}円・${bandOf(it.price)}・${String(pick.who).replace(/向け$/, '')}向け）`, next: 'checkHero', what: '商品の確認' };
}

// ---- 監査：主役の商品が今も買えるか（楽天で引き直す・コード） ----
async function checkHero(job, ctx) {
  const h = job.data.hero;
  const it = await lookupItem({ code: h.code, env: ctx.env, referer: ctx.referer });
  if (!it) { job.data.heroMiss = (job.data.heroMiss || 0) + 1; return job.data.heroMiss > MAX_REFIND ? { fail: '主役の商品が楽天で見つからなかった（販売終了の可能性）' } : { done: '楽天で見つからなかったので、探し直してもらう', next: 'find', what: '別の商品を探す' }; }
  h.price = it.price; h.url = it.url || h.url; h.checkedAt = now();
  return { done: `楽天で確認した（${it.price.toLocaleString('ja-JP')}円・購入できる）`, next: 'plan', what: '投稿の構成' };
}

// ---- 企画：構成を決める（1.0の planStep） ----
async function plan(job, ctx) {
  const h = job.data.hero;
  const source = P.fromCandidates([{ code: h.code, name: h.name, price: h.price, url: h.url, image: h.image, shop: h.shop, quotes: [String(h.caption || '').slice(0, 300)], reason: `${h.who}の「${h.problem}」に。${h.whyNow}`, target: h.who, score: null, checkedAt: h.checkedAt }]);
  if (!source.length) return { fail: '主役の商品のデータが足りない（楽天の商品URLが無い）' };
  job.data.source = source;
  const d = take(job, await P.planStep({ source, history: [], recentPatterns: job.data.recentPatterns || [], env: ctx.env, startedAt: ctx.startedAt, extraNote: PLAN_NOTE, maxItems: V2_MAX_ITEMS }));
  if (!d.ok) return { fail: d.error };
  job.data.plan = d.plan;
  return { done: `構成「${d.plan.title}」を作った（${d.plan.slots.length}枠）`, next: 'gather', what: '一緒に紹介する商品' };
}
async function gather(job, ctx) {
  const used = (await ctx.kv.getJson(K.used)) || [];
  const d = await P.gatherStep({ plan: job.data.plan, source: job.data.source, exclude: used, env: ctx.env, referer: ctx.referer, startedAt: ctx.startedAt });
  job.data.gathered = { fresh: d.fresh, missing: d.missing, slotResults: d.slotResults.map((x) => ({ ...x, candidates: x.candidates.slice(0, 6) })) };
  const n = d.slotResults.reduce((a, s) => a + s.candidates.length, 0);
  if (!n && !d.fresh.length) return { fail: '一緒に紹介する商品が楽天で見つからなかった' };
  return { done: `楽天で候補を${n}点集めた`, next: 'pick' };
}
async function pick(job, ctx) {
  const g = job.data.gathered;
  const d = take(job, await P.pickStep({ id: `set-${job.id}`, plan: job.data.plan, fresh: g.fresh, missing: g.missing, slotResults: g.slotResults, sourceCount: job.data.source.length, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  // AIの選んだ商品が6点に届かないとき（重複を外した等）は、集めた候補から重複しない商品をレビューの多い順に補う（説明はその商品データの言葉だけ）
  if (d.set.items.length < V2_MIN_ITEMS) {
    const have = new Set(d.set.items.map((it) => it.code));
    const pool = [];
    // 関係の薄い商品で数を埋めない（2026-11-17）：その枠の検索語の言葉が商品名に入っている候補だけで補う
    const words = (si) => String(((job.data.plan.slots || [])[si] || {}).keyword || '').split(/[\s　]+/).filter((w) => w.length >= 2);
    g.slotResults.forEach((sl, si) => sl.candidates.forEach((c) => { if (c.code && !have.has(c.code) && c.image && c.url && words(si).some((w) => String(c.name).includes(w))) pool.push({ slot: si, item: c }); }));
    pool.sort((a, b) => (Number(b.item.reviewCount) || 0) - (Number(a.item.reviewCount) || 0));
    for (const p of pool) {
      if (d.set.items.length >= V2_MIN_ITEMS) break;
      if (have.has(p.item.code)) continue;
      have.add(p.item.code);
      const feature = P.factPhrases(p.item, { max: 30 })[0] || short(p.item.name);
      d.set.items.push({ ...toItem({ slot: p.slot, item: p.item, feature, why: '' }, (job.data.plan.slots[p.slot] || {}).role || '候補', new Date()), filledBy: 'program' });
    }
  }
  d.set.issues = qualityCheck(d.set, V2_MIN_ITEMS);
  const other = d.set.issues.filter((x) => !/点に届かない/.test(x));
  if (other.length) return { fail: `商品の情報がそろわなかった（${other.join('／').slice(0, 80)}）` };
  job.data.set = d.set; delete job.data.gathered;
  // 6点に届かないときは、すぐエラーにせず、関連・連想・用途・価格帯へ探す範囲を広げる（widen）
  if (d.set.items.length < V2_MIN_ITEMS) return { done: `${d.set.items.length}点そろえた（あと${V2_MIN_ITEMS - d.set.items.length}点。探す範囲を広げる）`, next: 'widen', what: '探す範囲を広げる' };
  return { done: `${d.set.items.length}点の商品をそろえた`, next: 'curate', what: '企画との関係・重複・価格帯の確認' };
}
// ---- バイヤー：6点に届かないとき、関連商品・連想・用途・価格帯へ探す範囲を広げる（AIが枠を考え、楽天で探し、AIが選ぶ。無関係な商品で埋めない） ----
const WIDEN_PROMPT = `あなたは「サングラスくま株式会社」のバイヤーです。投稿の企画に商品がまだ足りません。今そろっている商品と重ならない「追加の商品の枠」を考えます。JSONだけを返してください。
- 企画のテーマ・誰に・悩みに関係のある物だけ。今の商品と同じ種類を増やさず、関連商品（一緒に使うと便利）・連想商品（同じ悩み・目的・場面の別の種類）・高価格帯・低価格帯・変わり種に広げる
- keyword は楽天で探す検索語（名詞2〜4語。型番は入れない）。「サングラスくま」はキャラクター名なので、テーマに関係のない眼鏡関連は入れない
出力形式: {"slots":[{"role":"関連商品","keyword":"..."}]}`;
async function widen(job, ctx) {
  const s = job.data.set;
  const need = V2_MIN_ITEMS - s.items.length;
  if (need <= 0) return { done: `${s.items.length}点そろっている`, next: 'curate', what: '企画との関係・重複・価格帯の確認' };
  job.data.widen = (job.data.widen || 0) + 1;
  let slots = [];
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: ctx.startedAt + 30000, system: WIDEN_PROMPT, userContent: `企画: ${s.title}／誰に: ${s.target || job.data.target || ''}／狙い: ${job.data.aim || ''}\n今の商品: ${s.items.map((it) => `${it.role || ''}：${compact(it.name, 40)}（${it.price}円）`).join('／')}\n追加で欲しい数: ${need}点（余裕を持って${need + 2}枠）`, parse: (c) => { const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]); const a = (Array.isArray(d.slots) ? d.slots : []).map((x) => ({ role: String(x && x.role || '追加').slice(0, 16), keyword: String(x && x.keyword || '').replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) })).filter((x) => x.keyword); if (!a.length) throw new Error('追加の枠がありませんでした'); return a.slice(0, need + 2); } });
    slots = result;
  } catch (e) { return { fail: `探す範囲を広げられなかった：${String(e.message || e).slice(0, 80)}` }; }
  const used = new Set([...((await ctx.kv.getJson(K.used)) || []), ...s.items.map((it) => it.code), ...(job.data.dropped || []).map((x) => x.code)]); // 外した商品は探し直さない
  const slotResults = await gatherSlots({ slots, exclude: used, env: ctx.env, referer: ctx.referer, until: ctx.startedAt + 45000 });
  const d = take(job, await P.pickStep({ id: s.id, plan: { ...job.data.plan, slots }, fresh: [], missing: [], slotResults, sourceCount: 0, env: ctx.env, startedAt: ctx.startedAt }));
  const have = new Set(s.items.map((it) => it.code));
  const add = d.ok ? d.set.items.filter((it) => it.code && !have.has(it.code) && it.price > 0 && /^https:\/\/item\.rakuten\.co\.jp\//.test(it.url || '') && it.image) : [];
  for (const it of add) { if (s.items.length >= V2_MAX_ITEMS) break; s.items.push({ ...it, addedBy: 'widen' }); have.add(it.code); }
  s.issues = qualityCheck(s, V2_MIN_ITEMS);
  if (s.items.length >= V2_MIN_ITEMS) return { done: `探す範囲を広げて${add.length}点を足した（${s.items.length}点。${slots.map((x) => x.keyword).join('・').slice(0, 40)}）`, next: 'curate', what: '企画との関係・重複・価格帯の確認' };
  if (job.data.widen < MAX_WIDEN) return { done: `探す範囲を広げたが、まだ${s.items.length}点（あと${V2_MIN_ITEMS - s.items.length}点）。もう一度広げる`, next: 'widen', what: '探す範囲を広げる' };
  // それでも足りない：無関係な商品で埋めず、保留（理由と不足数を残す）。24時間後にもう一度広げる
  job.data.widen = 0;
  return { hold: `商品が${s.items.length}点で、6点に${V2_MIN_ITEMS - s.items.length}点足りない（関連・連想・価格帯まで広げても、企画に合う商品が見つからなかった）。無関係な商品では埋めず、保留する` };
}

// ---- 監査：商品の並びを確かめる（2026-11-18 社長の指摘：関係の薄い本命・ほぼ同じ商品の重なり・価格帯の役割名のずれ） ----
//   AIが商品ごとに「企画との関係（用途・場面・悩み）」「実質的に同じ商品か」「同じ用途のまとまり」「役割（本命・関連・連想・変わり種・比較）」を判断し、
//   コードが決める：説明できない商品・比較の意図の無い重複は外す／本命は1つで先頭／高価格帯・低価格帯は同じ用途の商品が2つ以上あり価格に差があるときだけ付ける
//   外して6点を下回れば、代わりを探す（widen）→ もう一度確かめる。広げても足りなければ保留。AIが答えられなかったときは、コードの重複確認だけで先へ進める（止めない）
const CURATE_PROMPT = `あなたは「サングラスくま株式会社」の監査です（商品を選ぶ役はしない）。Instagram・楽天ROOMの1企画の商品の並びを確かめます。JSONだけを返してください。
- keep：その商品が企画のテーマ・誰に・悩みとつながるか。つながりを why に1文で書く（用途・利用場面・解決する悩み）。説明できなければ keep=false（無理に6点を埋めない）
- dupOf：商品名や商品番号が違っても、実質的に同じ商品・同じ用途で同じ仕様なら、残す方の番号。違えば0。高級品と廉価品の比較など明確な紹介の意図があるときは compare にその意図を書き、dupOf=0
- use：用途の短い名前（同じ用途の商品は同じ名前に。例：ハンドドリップ器具／コーヒー豆／ケーブル収納）
- role：本命（企画の中心。1つだけ）／関連商品（主役と一緒に使う）／連想商品（同じ悩み・目的・場面の別の種類）／変わり種（意外性があり紹介する価値がある）／比較（同じ用途の別の選択肢）。役割は価格では決めない
- diff：同じ用途の商品が他にあるとき、価格以外の違い（機能・品質・デザイン・容量など）を短く。商品データに無いことは書かない
- 企画のテーマが狭すぎて自然な6点にならないなら、broaderTitle に自然な範囲で広げた企画名を書いてよい（無ければ空）
出力形式: {"items":[{"n":1,"keep":true,"why":"...","dupOf":0,"compare":"","use":"...","role":"本命","diff":""}],"broaderTitle":""}`;
const ROLE_SET = ['本命', '関連商品', '連想商品', '変わり種', '比較'];
export function applyCurate(items, verdicts) {
  const dropped = []; const keep = [];
  items.forEach((it, i) => {
    const v = verdicts.find((x) => Number(x.n) === i + 1) || {};
    if (v.keep === false) { dropped.push({ code: it.code, name: short(it.name), why: `企画との関係を説明できない（${String(v.why || '').slice(0, 60)}）` }); return; }
    const dup = Number(v.dupOf) || 0;
    if (dup && dup !== i + 1 && !String(v.compare || '').trim() && keep.some((k) => k.n === dup)) { dropped.push({ code: it.code, name: short(it.name), why: `${dup}番と実質的に同じ商品（${String(v.why || '').slice(0, 40)}）` }); return; }
    keep.push({ n: i + 1, it, v });
  });
  // 本命は1つ・先頭（AIが本命と言ったものの先頭。無ければ今の先頭）
  const heroIdx = Math.max(0, keep.findIndex((k) => String(k.v.role || '') === '本命'));
  if (keep.length) keep.unshift(keep.splice(heroIdx, 1)[0]);
  // 価格帯：同じ用途の商品が2つ以上あり、価格に1.3倍以上の差があるときだけ
  const groups = {};
  keep.forEach((k) => { const u = String(k.v.use || '').trim(); if (u) (groups[u] = groups[u] || []).push(k); });
  const tier = new Map();
  Object.values(groups).forEach((g) => {
    if (g.length < 2) return;
    const sorted = [...g].sort((a, b) => Number(a.it.price) - Number(b.it.price));
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    if (Number(hi.it.price) >= Number(lo.it.price) * 1.3) { tier.set(hi, '高価格帯'); tier.set(lo, '低価格帯'); }
  });
  const out = keep.map((k, idx) => {
    const base = idx === 0 ? '本命' : ROLE_SET.includes(String(k.v.role)) && k.v.role !== '本命' ? k.v.role : '関連商品';
    const t = tier.get(k);
    return { ...k.it, role: t ? `${base}・${t}（${k.v.use}の中で）` : base, why: String(k.v.why || k.it.why || '').slice(0, 80) || k.it.why, use: String(k.v.use || ''), diff: String(k.v.diff || '').slice(0, 60), curated: true };
  });
  return { items: out, dropped };
}
async function curate(job, ctx) {
  const s = job.data.set;
  const lines = s.items.map((it, i) => `${i + 1}. ${compact(it.name, 70)}／${it.price}円／今の役割：${it.role || ''}／説明：${compact(it.caption || it.feature || '', 120)}`).join('\n');
  let verdicts = null; let broader = '';
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: ctx.startedAt + 35000, system: CURATE_PROMPT, userContent: `企画: ${s.title}／誰に: ${s.target || job.data.target || ''}／狙い: ${job.data.aim || ''}\n${lines}`, parse: (c) => { const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]); if (!Array.isArray(d.items) || !d.items.length) throw new Error('確認の結果がありませんでした'); return d; } });
    verdicts = result.items; broader = String(result.broaderTitle || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 30);
  } catch (e) {
    if (isQuotaError(e.message)) return { fail: e.message };
    verdicts = []; // AIが答えられないときは、コードの重複確認だけ（止めない）
  }
  // コードの重複確認（同じ商品名の言葉）：AIの判断が無いときの最低限
  if (!verdicts.length) { const seen = new Set(); verdicts = s.items.map((it, i) => { const k = short(it.name); const d = seen.has(k); seen.add(k); return { n: i + 1, keep: true, dupOf: d ? 1 : 0, role: i === 0 ? '本命' : '関連商品' }; }); }
  const r = applyCurate(s.items, verdicts);
  job.data.dropped = [...(job.data.dropped || []), ...r.dropped].slice(-30);
  s.items = r.items.slice(0, V2_MAX_ITEMS);
  if (broader && !job.data.broadened && s.items.length < V2_MIN_ITEMS) { job.data.broadened = s.title; s.title = broader; } // 狭すぎる企画は自然な範囲で広げる（1回まで）
  // 本命が変わったら、本命の確認の記録を新しい本命に合わせる（前の本命の確認を流用しない）
  if (s.items[0] && job.data.hero && s.items[0].code !== job.data.hero.code) job.data.hero = { ...job.data.hero, code: s.items[0].code, name: s.items[0].name, price: s.items[0].price, checkedAt: '', reason: s.items[0].why || '' };
  s.issues = qualityCheck(s, V2_MIN_ITEMS);
  const out = r.dropped.length ? `外した：${r.dropped.map((x) => `${x.name}（${x.why.slice(0, 30)}）`).join('・').slice(0, 120)}` : '外す商品は無かった';
  if (s.items.length >= V2_MIN_ITEMS) return { done: `商品の並びを確かめた（${s.items.length}点。${out}）`, next: 'copy', what: '文章' };
  if ((job.data.widen || 0) < MAX_WIDEN) return { done: `商品の並びを確かめた（${s.items.length}点に減った。${out}）。代わりを探す`, next: 'widen', what: '代わりの商品を探す' };
  job.data.widen = 0;
  return { hold: `企画に合う商品が${s.items.length}点で、6点に${V2_MIN_ITEMS - s.items.length}点足りない（${out}）。無関係な商品では埋めず、保留する` };
}

// ---- ライター ----
async function copy(job, ctx) {
  const d = take(job, await P.copyStep({ set: job.data.set, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  job.data.set.copy = d.copy;
  return { done: `Instagramの文章を書いた（${d.copy.body.length}字）`, next: 'room' };
}
async function room(job, ctx) {
  const d = take(job, await P.roomStep({ set: job.data.set, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  job.data.set.roomTexts = d.roomTexts;
  return { done: `楽天ROOMの紹介文を${d.roomTexts.length}件書いた`, next: 'auditText', what: '文章の確認' };
}

// ---- 監査：文章（コードの確認＋監査AI。点数は社長の画面に出さない） ----
async function auditText(job, ctx) {
  const check = P.codeCheck(job.data.set);
  const d = take(job, await P.auditSetStep({ set: job.data.set, check, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  const edits = job.data.edits || 0;
  const dc = P.decideSet({ check, audit: d.audit, revisions: edits });
  job.data.audits = [...(job.data.audits || []), { at: now(), total: d.audit.total, status: dc.status, why: dc.why }].slice(-4); // 品質の記録（開発者向け）
  job.data.lastAudit = { check, audit: d.audit };
  // 差し戻しを使い切ったとき：事実・規約の疑い（flag）もコードのNGも無く、合格ライン（80点）に届いていれば合格（言い回しの改善案は記録に残す。2026-11-16：2.0の4件中3件がここで止まっていた）
  const fl = d.audit.flags || {};
  const lastRound = dc.status !== 'pass' && edits >= MAX_EDITS && !fl.fabrication && !fl.unverified && !fl.policy && !check.hardFail && d.audit.total >= PASS_SCORE && d.audit.proposal !== 'reject';
  if (dc.status === 'pass' || lastRound) return { done: lastRound ? '文章を確認した（事実と表記の問題なし。細かな改善案は記録に残した）' : job.kind === 'fix' ? '直した文章を確認した（問題なし）' : '文章を確認した（問題なし）', next: 'review', what: '全体の整合性の確認' };
  if (dc.status === 'revise' && edits < MAX_EDITS) return { done: '直してほしい点を見つけた', next: 'edit', what: '文章の修正' };
  return { fail: `文章が基準に届かなかった（${edits}回直しても）`, dev: `${dc.why}／監査の要約：${String(d.audit.summary || '').slice(0, 120)}／指摘：${(d.audit.fixes || []).map((f) => `${f.target}:${f.text}`).join('｜').slice(0, 120)}`, final: true };
}
// ---- 編集：監査の指摘・社長の修正依頼で直す ----
async function edit(job, ctx) {
  const set = job.data.set;
  const owner = job.kind === 'fix' && !job.data.ownerApplied ? job.data.ownerNote : '';
  const audit = owner ? { fixes: [{ target: 'caption', text: `社長の修正依頼：${owner}` }, ...set.items.map((_, i) => ({ target: `room:${i + 1}`, text: `社長の修正依頼：${owner}` }))], summary: `社長の修正依頼：${owner}`, flags: {} } : job.data.lastAudit.audit;
  const check = owner ? { checks: [] } : job.data.lastAudit.check;
  const d = take(job, await P.editStep({ set, audit, check, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  const a = P.applyEdit(set, d.edit);
  job.data.set = a.set;
  // 監査が「商品データに無い表現」を指摘したROOM紹介文は、事実だけの紹介文（プログラム）に置き換える（AIの書き直しは再発するため）
  const fl = (audit && audit.flags) || {};
  if (fl.fabrication || fl.unverified) {
    const ns = [...new Set((audit.fixes || []).map((f) => String(f.target || '').replace(/\s/g, '')).filter((t) => /^room:\d+$/.test(t)).map((t) => Number(t.split(':')[1])))];
    ns.forEach((n) => { const it = job.data.set.items[n - 1]; if (it && job.data.set.roomTexts && job.data.set.roomTexts[n - 1]) { job.data.set.roomTexts[n - 1] = { ...job.data.set.roomTexts[n - 1], intro: P.factRoomIntro(it, job.data.set), introFrom: '商品データ（事実だけ）' }; if (!a.changed.includes(`room:${n}`)) a.changed.push(`room:${n}`); } });
  }
  if (owner) job.data.ownerApplied = true; else job.data.edits = (job.data.edits || 0) + 1;
  const where = a.changed.map((c) => (c === 'caption' ? 'Instagramの文章' : /^room/.test(c) ? `ROOM紹介文${c.split(':')[1]}` : `商品カード${c.split(':')[1]}`));
  return { done: where.length ? `${[...new Set(where)].join('・')}を直した` : '直す所が見つからなかった', next: 'auditText', what: '直した文章の確認' };
}

// ---- デザイナー：表紙画像（2026-11-17 社長の決定：1企画1枚・監査による自動の描き直しなし・失敗しても投稿セットの完成を止めない） ----
//   描けなかったとき（予算・失敗・場面が決まらない）は、表紙画像なしで仕上げへ。作り直しは社長が完成品のページから頼む（regenImage）
const afterImage = (job) => (job.kind === 'regen' ? 'attach' : 'pack');
const noImage = (job, why) => { job.data.noImage = String(why || '').slice(0, 120); return { done: `表紙画像なしで${job.kind === 'regen' ? '終える' : '仕上げへ進む'}（${String(why || '').slice(0, 60)}）`, next: afterImage(job), what: job.kind === 'regen' ? '' : '仕上げ（表紙画像は社長が作り直しを頼める）' }; };
async function scene(job, ctx) {
  if (!C.aiImageEnabled(ctx.env)) return noImage(job, C.AI_IMAGE_OFF);
  const d = take(job, await C.sceneStep({ set: job.data.set, history: await C.sceneHistory(ctx.kv), env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok && isQuotaError(d.error)) return { fail: d.error }; // 残高不足は残高待ちへ
  if (!d.ok) return noImage(job, `場面を決められなかった：${d.error}`);
  if (d.skip) return noImage(job, `場面を決められなかった：${d.skip}`);
  job.data.cover = { scene: d.scene, item: d.item, tries: 0 };
  return { done: `場面を決めた（${String(d.scene.place).slice(0, 20)}・${String(d.scene.usage || d.scene.action).slice(0, 30)}）`, next: 'image' };
}
async function image(job, ctx) {
  const cv = job.data.cover;
  if (!cv || cv.tries >= 1) return noImage(job, '1企画につき1枚まで（もう描いた）'); // 同じ案件で2枚目は描かない
  if (!C.aiImageEnabled(ctx.env)) return noImage(job, C.AI_IMAGE_OFF);
  const trial = await trialOn(ctx.kv, ctx.env);
  const ib = await imageCheck(ctx.kv, ctx.env, { trial });
  if (!ib.ok) return noImage(job, `画像の予算：${ib.reason}`);
  cv.tries += 1; // 呼ぶ前に数える（失敗しても2回目は描かない）
  const d = await C.imageStep({ kv: ctx.kv, env: ctx.env, origin: ctx.origin, scene: cv.scene, item: cv.item, startedAt: ctx.startedAt, trial });
  if (d.run) job.runs.push({ ...d.run, yen: 0 }); // 画像の費用は画像の予算で数える（imageStep が実測を記録する）
  if (d.skip) return noImage(job, `描けなかった：${d.skip}`);
  if (!d.ok && isQuotaError(d.error)) { cv.tries -= 1; return { fail: d.error }; } // 残高不足は描いていないので数えない
  if (!d.ok) return noImage(job, `描けなかった：${d.error}`);
  cv.mediaId = await C.saveMedia(ctx.kv, d.b64); cv.costYen = d.cost.yen; cv.model = d.model;
  job.data.set.coverImage = { status: 'ok', mediaId: cv.mediaId, scene: cv.scene, item: cv.item.name, label: 'AI生成イメージ', model: cv.model, costYen: cv.costYen, at: now() };
  await C.pushScene(ctx.kv, cv.scene);
  return { done: `表紙画像を1枚描いた（約${Math.round((Number(d.cost.yen) || 0) * 10) / 10}円）`, next: afterImage(job), what: job.kind === 'regen' ? '完成品に入れる' : '仕上げ' };
}
// 前から「画像の確認」にいた案件：AIでの確認・描き直しはせず、描いた画像をそのまま使う
async function checkImage(job) {
  const cv = job.data.cover;
  if (cv && cv.mediaId) job.data.set.coverImage = { status: 'ok', mediaId: cv.mediaId, scene: cv.scene, item: cv.item && cv.item.name, label: 'AI生成イメージ', model: cv.model, costYen: cv.costYen, at: now() };
  return { done: cv && cv.mediaId ? '描いた表紙画像を使う（自動の描き直しはしない）' : '表紙画像なしで仕上げへ', next: afterImage(job), what: '仕上げ' };
}
// 社長の作り直しの依頼：描いた画像を完成品に入れる（前の画像は消さずに履歴へ）
async function attach(job, ctx) {
  const s = await ctx.kv.getJson(K.set(job.data.setId));
  if (!s) return { fail: '完成品が見つからない', final: true };
  const cover = job.data.set.coverImage;
  if (!cover || cover.status !== 'ok') { await ctx.kv.setJson(K.set(s.id), { ...s, regenPending: false }); return { done: `表紙画像を作り直せなかった（${job.data.noImage || '理由不明'}）。今の画像のまま`, deliver: `「${s.title}」の表紙画像は作り直せなかった（今の画像のまま）` }; }
  const img = { mediaId: cover.mediaId, url: `/api/media?id=${cover.mediaId}`, label: 'AI生成イメージ', by: 'designer', at: now(), costYen: cover.costYen };
  await ctx.kv.setJson(K.set(s.id), { ...s, image: img, imageHistory: [...(s.imageHistory || []), ...(s.image ? [s.image] : [])].slice(-10), regenPending: false });
  const list = (await ctx.kv.getJson(K.sets)) || [];
  await ctx.kv.setJson(K.sets, list.map((x) => (x.id === s.id ? { ...x, image: img.url } : x)));
  return { done: '作り直した表紙画像を完成品に入れた（前の画像は残してある）', deliver: `「${s.title}」の表紙画像を作り直して届けた` };
}


// ---- 編集：投稿全体の整合性（価格・商品数・PR表記・紹介文の数。コード・0円）。問題があれば編集で直す ----
async function review(job, ctx = { env: process.env }) {
  const s = job.data.set;
  const check = P.codeCheck(s);
  const issues = check.checks.filter((k) => k.hard && k.ok === false).map((k) => `${k.label}（${k.detail}）`);
  const eq = [((s.copy || {}).body) || '', ...(s.roomTexts || []).map((x) => x.intro || '')].map((t) => (String(t).match(EQUIV_RE) || [])[0]).filter(Boolean);
  if (eq.length) issues.push(`確認できない「高級品と同等」の断定（${eq[0]}）。商品データにある事実の言い方に直す`);
  if ((s.roomTexts || []).length !== s.items.length) issues.push(`ROOM紹介文の数（${(s.roomTexts || []).length}）と商品の数（${s.items.length}）が合わない`);
  if (!issues.length) return { done: `全体を確認した（商品${s.items.length}点・価格・PR表記・紹介文の数がそろっている）`, next: job.kind === 'fix' || job.kind === 'redo' || !C.aiImageEnabled(ctx.env) ? 'pack' : 'scene', what: job.kind === 'fix' || job.kind === 'redo' ? '仕上げ（表紙画像は今のまま）' : !C.aiImageEnabled(ctx.env) ? '仕上げ（表紙画像は社長が追加）' : '表紙画像' };
  if ((job.data.edits || 0) < MAX_EDITS) { job.data.lastAudit = { check, audit: { fixes: issues.map((t) => ({ target: 'caption', text: t })), summary: issues.join('／'), flags: {} } }; return { done: `直す所を見つけた（${issues[0].slice(0, 40)}）`, next: 'edit', what: '整合性の修正' }; }
  return { fail: `全体の整合性がそろわなかった（${issues[0].slice(0, 60)}）`, final: true };
}

// ---- 広報：投稿の準備をそろえて納品する（ハッシュタグ・投稿の順番・本命と代替の比較・注意事項。コード） ----
export function buildDelivery(job) {
  const s = job.data.set;
  const hero = s.items[0];
  const verified = (it, i) => (i === 0 && job.data.hero && job.data.hero.checkedAt ? `楽天で再確認済み（${job.data.hero.checkedAt.slice(0, 16).replace('T', ' ')}）` : it.priceNote ? `未確認：${it.priceNote}` : it.priceCheckedAt ? `楽天の検索結果で確認（${String(it.priceCheckedAt).slice(0, 16).replace('T', ' ')}）` : '未確認（価格を確かめた日時が無い）');
  const products = s.items.map((it, i) => ({
    role: i === 0 ? '本命' : '代替・比較', band: bandOf(Number(it.price) || 0), code: it.code || '', name: it.name, short: short(it.name), price: it.price, url: it.url, image: it.image, shop: it.shop,
    check: verified(it, i), unverified: !(i === 0 && job.data.hero && job.data.hero.checkedAt) && (!!it.priceNote || !it.priceCheckedAt),
    room: ((s.roomTexts || [])[i] || {}).intro || '', tags: ((s.roomTexts || [])[i] || {}).tags || []
  }));
  const compare = products.slice(1).map((p) => {
    const diff = Number(p.price) - Number(hero.price);
    return { name: p.short, price: p.price, vsHero: diff === 0 ? '本命と同じ価格' : diff < 0 ? `本命より${Math.abs(diff).toLocaleString('ja-JP')}円安い` : `本命より${diff.toLocaleString('ja-JP')}円高い`, note: '機能の違いは各商品ページで確認（商品データにある範囲だけ紹介文に書いています）' };
  });
  const tags = [...new Set([...(((s.copy || {}).hashtags) || []), ...products.flatMap((p) => p.tags)].map((t) => String(t).trim()).filter((t) => /^#\S+$/.test(t)))].slice(0, 15);
  const notes = [
    'キャプションにPR（アフィリエイト）表記が入っています。消さないでください',
    s.coverImage && s.coverImage.status === 'ok' ? '表紙画像はAIで作ったイメージです。投稿では「AI生成イメージ」と分かるようにしてください（実際に使った写真ではありません）' : '表紙画像はまだありません。社長がChatGPTで作った画像を、完成品のページの「表紙画像を追加」から入れられます（AIで作った画像は「AI生成イメージ」と分かるようにしてください）',
    '価格・在庫は確認した時点のものです。投稿の直前に、各商品ページで価格を確かめてください',
    products.some((p) => p.unverified) ? '「未確認」と書かれた商品は、価格を楽天で確かめてから投稿してください' : '',
    '商品写真は楽天の商品画像です。Instagramでの使用条件は未確認のため、表紙はAI生成イメージを使ってください',
    '体験談・効果の断定は書いていません。投稿時に足さないでください',
    'Instagramの本文のURLは押せません。楽天ROOMとプロフィールのリンクから見られるように案内しています'
  ].filter(Boolean);
  const order = [
    '楽天ROOMに、本命の商品から順に登録し、それぞれの紹介文を貼る（ROOMの投稿は手作業。自動投稿はしません）',
    'Instagramにフィード投稿：表紙画像（AI生成イメージ）＋キャプション＋ハッシュタグ',
    'ストーリーズで本命の商品を紹介し、ROOMの商品ページへのリンクを付ける（リンクスタンプを使える場合）',
    '投稿したら、完成品の画面で「投稿した」を押す（閲覧・クリック・売上を記録できるように）'
  ];
  return { products, compare, tags, notes, order };
}
async function pack(job, ctx) {
  const s = job.data.set;
  const cap = (s.copy && s.copy.caption) || '';
  if (!/アフィリエイト|PR/.test(cap)) return { fail: 'PR（アフィリエイト）の表記が無い', final: true };
  const cover = s.coverImage && s.coverImage.status === 'ok' ? s.coverImage : null; // 2026-11-17：AIの画像生成を止めたので、表紙画像なしでも納品する（社長がChatGPTで作って追加）
  const d = buildDelivery(job);
  const plan = job.data.plan || {};
  const out = {
    id: job.data.setId || s.id, title: s.title, theme: job.data.theme || '', aim: job.data.aim || plan.reason || plan.appeal || '', target: job.data.target || s.target || '',
    who: (job.data.hero || {}).who || s.target || '', problem: (job.data.hero || {}).problem || '', whyNow: (job.data.hero || {}).whyNow || '',
    pickReason: (job.data.hero || {}).reason || '', band: (job.data.hero || {}).band || '', caption: cap, products: d.products, compare: d.compare, hashtags: d.tags, notes: d.notes, order: d.order,
    image: cover ? { mediaId: cover.mediaId, url: `/api/media?id=${cover.mediaId}`, label: 'AI生成イメージ' } : null,
    status: 'waiting', deliveredAt: now(), jobId: job.id, revisions: (job.data.revisionCount || 0) + (job.kind === 'fix' ? 1 : 0), ownerNote: job.data.ownerNote || '',
    dropped: (job.data.dropped || []).map((x) => ({ name: x.name, why: x.why })).slice(-20), // 監査が外した商品と理由（社長が見られるように残す）
    dev: { audits: job.data.audits || [], yen: yenOf(job.runs), imageYen: (cover && cover.costYen) || 0, scene: cover ? cover.scene : null }
  };
  const prev = await ctx.kv.getJson(K.set(out.id)); // 作り直し・修正版：社長の記録（ROOM登録・画像・作り直しの回数）と前の版を残す
  if (prev) { if (!out.image && prev.image) out.image = prev.image; Object.assign(out, { roomDone: prev.roomDone, imageHistory: prev.imageHistory, regenCount: prev.regenCount, versions: [...(prev.versions || []), { at: prev.deliveredAt, title: prev.title, products: (prev.products || []).map((p) => ({ name: p.name, price: p.price, url: p.url, role: p.role })), caption: prev.caption }].slice(-5) }); }
  await ctx.kv.setJson(K.set(out.id), { ...out, raw: s });
  const list = ((await ctx.kv.getJson(K.sets)) || []).filter((x) => x.id !== out.id);
  await ctx.kv.setJson(K.sets, [{ id: out.id, title: out.title, status: 'waiting', deliveredAt: out.deliveredAt, image: out.image ? out.image.url : '', unverified: d.products.filter((p) => p.unverified).length }, ...list].slice(0, 80));
  await ctx.kv.setJson(K.used, [...new Set([...s.items.map((it) => it.code), ...((await ctx.kv.getJson(K.used)) || [])])].slice(0, 800));
  if (job.kind !== 'fix' && job.kind !== 'redo') await bump(ctx.kv, { delivered: 1, yen: yenOf(job.runs) + (Number(cover && cover.costYen) || 0), products: d.products.length, verifiedProducts: d.products.filter((p) => !p.unverified).length });
  await ctx.kv.pushJson(K.notices, { at: now(), id: out.id, title: out.title, fix: job.kind === 'fix' || job.kind === 'redo' }, 30);
  return { done: `ハッシュタグ${d.tags.length}個・投稿の順番・注意事項をそろえた`, deliver: `社長に完成品「${s.title}」を届けた${job.kind === 'fix' ? '（修正版）' : job.kind === 'redo' ? '（商品を見直した版）' : ''}` };
}

const RUN = { propose, find: findHero, checkHero, plan, gather, pick, widen, curate, copy, room, auditText, edit, review, scene, image, checkImage, pack, attach };
function take(job, d) { job.runs.push(...(d.runs || [])); return d; }

// ---- 案件の保存（並行して進める）。旧形式（v2:job・v2:imagewait）は初回に案件へ移す（消さずに移す） ----
async function loadCases(kv) {
  let cases = await kv.getJson(K.cases);
  if (!Array.isArray(cases)) {
    cases = [];
    const j = await kv.getJson(K.job); if (j) cases.push({ ...j, wait: null });
    for (const w of (await kv.getJson(K.imagewait)) || []) cases.push({ ...w, wait: { kind: 'image', why: (w.data && w.data.waitWhy) || '画像の予算待ち' } });
    await kv.setJson(K.cases, cases);
    if (j) await kv.del(K.job);
    await kv.setJson(K.imagewait, []);
  }
  return cases;
}
const saveCases = (kv, cases) => kv.setJson(K.cases, cases);
async function waitingCount(kv) { return ((await kv.getJson(K.sets)) || []).filter((x) => x.status === 'waiting').length; }

// 新しい案件を始めてよいか（社長の指示は不要。無駄な費用を使わないための上限だけ確かめる）
export async function canStart(kv, env, cases) {
  const active = cases.filter((c) => !c.wait || c.wait.kind === 'retry' || c.wait.kind === 'budget' || c.wait.kind === 'quota' || c.wait.kind === 'slot');
  const imgWait = cases.filter((c) => c.wait && c.wait.kind === 'image');
  if (active.length >= MAX_ACTIVE) return `進行中の案件が${active.length}件（上限${MAX_ACTIVE}件）`;
  if (imgWait.length >= MAX_IMAGE_WAIT) return `画像待ちの案件が${imgWait.length}件あるため、新しくは始めない（画像の予算が戻ったら続きを描く）`;
  // 2026-11-17：確認待ちが上限でも、新しい案件は始める（企画・商品調査・在庫の確認は続ける）。文章を書く前で「完成品の枠待ち」にする（SLOT_STEP）
  return '';
}

// ---- 1回の定期実行（2026-11-16 並行処理に改修）：予定どおり再開 → 社長の修正依頼 → 新しい案件 → 「レーン」で、違う案件の工程を同時に進める ----
//   - 同じ案件の工程は順番どおり（1つの案件を2つのレーンで同時に進めない）。監査も今までどおり通る
//   - 1人の社員は同時に1つの仕事だけ（担当中＝本当に処理している間だけ）。1回の実行で AGENT_PER_TICK 件まで
//   - 進める工程が無い社員は、仕事探し（findWork）で本当に必要な仕事だけを見つける（再確認・広報のコメント案など。無ければ「仕事なし」と理由を残す）
//   - 予算は、同時に進めている工程の見込みを足して確かめる（同時に始めて上限を超えない）
export const MAX_PARALLEL = 3;     // 同時に進める工程の数（楽天は1秒1回・AIの同時呼び出しも抑える）
const saveCasesNow = (kv, cases) => serial('cases', () => kv.setJson(K.cases, cases));
const CURRENT_STALE_MS = 90000;    // 「処理中」の印が古い（実行が途中で切れた）ときは、処理中と見なさない

async function staffBump(kv, agent, patch) {
  return serial('staff', async () => {
    const st = (await kv.getJson(K.staff)) || {};
    const a = st[agent] || { steps: 0, side: 0, delivered: 0, stops: 0, retries: 0, yen: 0, days: {} };
    const day = jstDate();
    for (const [k, v] of Object.entries(patch)) a[k] = Math.round(((Number(a[k]) || 0) + v) * 1000) / 1000;
    if (patch.steps || patch.side) a.days[day] = (Number(a.days[day]) || 0) + (patch.steps || 0) + (patch.side || 0);
    a.days = Object.fromEntries(Object.entries(a.days).sort().slice(-14));
    st[agent] = a; await kv.setJson(K.staff, st);
  });
}

export async function tick({ kv, env, referer = '', origin = '', startedAt = Date.now(), trigger = '', probeNow = false }) {
  const token = `${startedAt}-${crypto.randomBytes(4).toString('hex')}`;
  if (!(await kv.set(K.lock, token, { nx: true, ex: 58 }))) return { ok: true, skipped: '前の実行がまだ動いています（二重実行の防止）' };
  const health = (await kv.getJson(K.health)) || {};
  health.lastTickAt = now(); health.trigger = trigger;
  currentTrigger = String(trigger || '').slice(0, 20);
  const worked = [];
  const out = { ok: true };
  try {
    const cases = await loadCases(kv);
    await trialState(kv, env, { start: true });
    // 1. 再開：再試行の時刻が来た・予算が戻った・画像の予算が戻った（画像は1日の枚数があるので1件ずつ）
    const inTrial = await trialOn(kv, env);
    let b0 = await budgetCheck(kv, env, { estimate: 1, auto: !inTrial });
    if (b0.ok && inTrial) b0 = await trialAllows(kv, env, 1);
    let imageOk = (await imageCheck(kv, env, { trial: inTrial })).ok;
    // AIの画像生成の停止（2026-11-17）：表紙画像の工程（場面・画像・画像の確認）にいる案件は、画像なしで仕上げへ進める（文章・商品はそのまま）
    if (!C.aiImageEnabled(env)) {
      for (const c of cases) {
        if (!['scene', 'image', 'checkImage'].includes(c.step)) continue;
        c.step = c.kind === 'regen' ? 'attach' : 'pack'; c.attempts = 0; if (c.wait && c.wait.kind !== 'budget') c.wait = null;
        await record(kv, { job: c.id, agent: 'designer', to: 'pr', type: 'handoff', text: '広報へ引き継ぎ（AIの画像生成を止めたので、表紙画像なしで仕上げる。表紙は社長がChatGPTで作って追加）', title: titleOf(c) });
      }
    }
    // 2026-11-18 一度だけ：商品の並びの確認（curate）より前にそろえた企画を、新しい基準で確かめ直す（消さない・適切な商品は残す）
    // 2026-11-18 2回目：見直しが途中で止まった名指しの完成品（前の版のまま）を、もう一度だけ見直す
    const curateRound = !(await kv.get(K.migrateCurate)) ? 1 : !(await kv.get(K.migrateCurate2)) ? 2 : 0;
    if (curateRound) {
      await kv.set(curateRound === 1 ? K.migrateCurate : K.migrateCurate2, now());
      for (const c of cases) {
        if (c.kind !== 'make' || c.step !== 'copy' || !c.data || !c.data.set || (c.data.set.items || []).some((it) => it.curated)) continue;
        c.step = 'curate'; if (c.wait && c.wait.kind === 'slot') c.wait = null;
        await record(kv, { job: c.id, agent: 'auditor', type: 'start', text: `「${titleOf(c)}」の商品を新しい基準（企画との関係・重複・価格帯）で確かめ直す`, title: titleOf(c) });
      }
      for (const x of ((await kv.getJson(K.sets)) || []).filter((y) => ['waiting', 'adopted'].includes(y.status) && REDO_RE.test(y.title || ''))) {
        const saved = await kv.getJson(K.set(x.id));
        const raw = saved && saved.raw;
        if (!raw || !(raw.items || []).length || raw.items.some((it) => it.curated) || (saved.versions || []).length || cases.some((c) => c.data && c.data.setId === x.id)) continue;
        const h = raw.items[0];
        const c = { id: newId('redo'), kind: 'redo', step: 'curate', createdAt: now(), attempts: 0, runs: [], wait: null, data: { set: raw, setId: saved.id, theme: saved.theme, aim: saved.aim, target: saved.target, hero: { code: h.code, name: h.name, price: h.price, who: saved.who, problem: saved.problem, whyNow: saved.whyNow, reason: saved.pickReason, checkedAt: '' }, plan: { title: saved.title, target: saved.target, slots: [] } } };
        cases.push(c);
        await record(kv, { job: c.id, agent: 'auditor', type: 'start', text: `完成品「${saved.title}」の商品を新しい基準で確かめ直す（社長の確認待ちのまま。見直した版で差し替える）`, title: saved.title });
      }
    }
    // 完成品の枠：社長の確認待ちが上限なら、文章を書く前の案件は「枠待ち」で保存。空いたら続きから（会社全体は止めない）
    const waitingNow = await waitingCount(kv);
    let freeSlots = Math.max(0, MAX_WAITING - waitingNow) - cases.filter((c) => c.kind === 'make' && !c.wait && FLOW.indexOf(c.step) > FLOW.indexOf(SLOT_STEP)).length; // 文章より先に進んでいる案件の分は使用中
    const slotFull = freeSlots <= 0;
    for (const c of cases) {
      if (c.wait && c.wait.kind === 'slot' && freeSlots > 0) { freeSlots -= 1; c.wait = null; await record(kv, { job: c.id, agent: 'writer', type: 'resume', text: `完成品の枠が空いたので「${titleOf(c)}」の文章を書き始める`, title: titleOf(c) }); }
      else if (!c.wait && slotFull && c.kind === 'make' && c.step === SLOT_STEP) { c.wait = { kind: 'slot', why: SLOT_WHY(waitingNow), at: now() }; }
    }
    // 残高待ち：前の実行までに「残高不足」で再試行待ちになった案件は、失敗の回数を戻して残高待ちに移す（既存の案件を消さない）
    let quota = await kv.getJson(K.quota);
    for (const c of cases) {
      if (c.wait && c.wait.kind === 'retry' && isQuotaError(c.wait.why)) {
        c.wait = { kind: 'quota', why: 'OpenAIの残高がありません（残高が戻ったら続きから再開します）', at: now() }; c.attempts = 0;
        if (!quota) quota = { since: now(), until: now(), tries: 0 }; // すぐに1件だけ試して、残高が戻っているか確かめる
      }
    }
    // 手動の実行（社長・開発担当が「今すぐ」動かしたとき）は、残高待ちの時刻を待たずに1件だけ試す（2026-11-17 社長の依頼：チャージ後すぐ再開したい）
    if (quota && probeNow && Date.parse(quota.until) > Date.now()) quota = { ...quota, until: now() };
    if (quota) await kv.setJson(K.quota, quota);
    let quotaBlocked = !!(quota && Date.now() < Date.parse(quota.until));
    let probeOpen = !!(quota && !quotaBlocked); // 残高が戻ったかを1件だけで確かめる
    let probing = false;
    let probeCase = '';
    for (const c of cases) {
      delete c.current; // 前の実行の「処理中」の印は残さない（途中で切れた実行の印）
      if (!c.wait) continue;
      const k = c.wait.kind;
      if (k === 'quota') {
        if (!quota) { await record(kv, { job: c.id, agent: STEPS[c.step].agent, type: 'resume', text: `OpenAIの残高が戻ったので「${titleOf(c)}」の続きを始めた`, title: titleOf(c) }); c.wait = null; }
        else if (probeOpen && !probeCase) { probeCase = c.id; c.wait = null; } // 確かめる1件
        continue;
      }
      if (k === 'hold' && Date.parse(c.wait.until) <= Date.now()) { c.wait = null; await record(kv, { job: c.id, agent: STEPS[c.step].agent, type: 'resume', text: `保留していた「${titleOf(c)}」の商品探しをもう一度始めた`, title: titleOf(c) }); continue; }
      if ((k === 'retry' && Date.parse(c.wait.until) <= Date.now()) || (k === 'budget' && b0.ok) || (k === 'image' && imageOk)) {
        if (k === 'image' && !inTrial) imageOk = false; // 通常は1件ずつ。試験運用中は日の制限を使わない
        if (k !== 'retry') await record(kv, { job: c.id, agent: STEPS[c.step].agent, type: 'resume', text: `${k === 'image' ? '画像の予算が戻ったので' : '予算が戻ったので'}「${titleOf(c)}」の続きを始めた`, title: titleOf(c) });
        c.wait = null;
      }
    }
    // 2. 社長の修正依頼（ほかの仕事より先に）
    const fixq = (await kv.getJson(K.fixq)) || [];
    while (fixq.length) {
      const f = fixq.shift();
      const saved = await kv.getJson(K.set(f.id));
      if (!saved || !saved.raw) continue;
      const c = { id: newId('fix'), kind: 'fix', step: 'edit', createdAt: now(), attempts: 0, runs: [], wait: null, data: { set: saved.raw, setId: f.id, ownerNote: f.note, theme: saved.theme, aim: saved.aim, target: saved.target, hero: { who: saved.who, problem: saved.problem, whyNow: saved.whyNow, checkedAt: (saved.products || [])[0] && /再確認済み/.test(saved.products[0].check) ? saved.deliveredAt : '' }, plan: { title: saved.title }, revisionCount: saved.revisions || 0 } };
      cases.unshift(c);
      await record(kv, { job: c.id, agent: 'editor', type: 'start', text: `社長の修正依頼で「${saved.title}」を直し始めた`, title: saved.title });
    }
    await kv.setJson(K.fixq, []);
    await saveCases(kv, cases);

    // 3. レーン：違う案件の工程を同時に進める
    const busy = {};          // 社員 → 今処理している工程（同時に1つ）
    const count = {};         // 社員 → この回に進めた工程の数
    const inflight = new Set(); // 今処理している案件
    let reserved = 0;         // 同時に進めている工程の費用の見込み（予算の確認に足す）
    let stopAll = '';         // 予算の上限で、この回はもう新しく始めない
    let running = 0; let peak = 0;
    let waiters = [];
    const changed = () => new Promise((r) => waiters.push(r));
    const notify = () => { const w = waiters; waiters = []; w.forEach((f) => f()); };
    const elapsed = () => Date.now() - startedAt;
    const free = (agent) => !busy[agent] && (count[agent] || 0) < AGENT_PER_TICK;
    const board = {}; // 社員ごとの仕事探しの結果（画面の「仕事なし」の理由）
    let started = 0;

    async function budgetFor(est, image = false) {
      let bc = await budgetCheck(kv, env, { estimate: Math.max(0.01, est) + reserved, auto: !inTrial });
      if (bc.ok) { const ta = await trialAllows(kv, env, (image ? IMAGE_ESTIMATE_YEN : Math.max(0.01, est)) + reserved); if (!ta.ok) bc = ta; }
      return bc;
    }
    const tried = new Set(); let startTried = false;
    const release = (agent, id) => { delete busy[agent]; if (id) inflight.delete(id); };
    const paid = (step) => step === 'image' || (STEPS[step] && STEPS[step].est > 0); // AIを呼ぶ工程
    const aiAllowed = () => !quotaBlocked && !(probeOpen && probing);
    async function quotaHit(why) {
      const tries = ((quota && quota.tries) || 0) + 1;
      const mins = QUOTA_WAIT_MIN[Math.min(tries - 1, QUOTA_WAIT_MIN.length - 1)];
      quota = { since: (quota && quota.since) || now(), until: new Date(Date.now() + mins * 60000).toISOString(), tries, why: String(why || '').slice(0, 200) };
      await kv.setJson(K.quota, quota);
      if (!quotaBlocked) await record(kv, { agent: 'owner', type: 'budget', text: `OpenAIの残高がないため、AIを使う仕事を止めた（${mins}分後に1件だけ試して、残高が戻っていれば続きから再開する。案件は終わらせない）` });
      quotaBlocked = true; probeOpen = false; probing = false;
    }
    async function quotaClear() {
      if (!quota) return;
      quota = null; quotaBlocked = false; probeOpen = false; probing = false;
      await kv.del(K.quota);
      for (const c of cases) if (c.wait && c.wait.kind === 'quota') { c.wait = null; await record(kv, { job: c.id, agent: STEPS[c.step].agent, type: 'resume', text: `OpenAIの残高が戻ったので「${titleOf(c)}」の続きを始めた`, title: titleOf(c) }); }
      await record(kv, { agent: 'owner', type: 'resume', text: 'OpenAIの残高が戻ったので、AIを使う仕事を再開した' });
    }
    // 案件の工程を1つ取る（完成に近い案件から。画像を描く工程は回の始めのうちだけ）。取った時点で印を付け、ほかのレーンが同じ案件・同じ社員を取らないようにする
    function claimCase() {
      const job = cases.filter((c) => !c.wait && STEPS[c.step] && !inflight.has(c.id) && free(STEPS[c.step].agent) && !(c.step === 'image' && elapsed() > 8000) && (!paid(c.step) || aiAllowed()) && !(slotFull && c.kind === 'make' && c.step === SLOT_STEP))
        .sort((a, b) => (a.kind === 'fix' ? -1 : 0) - (b.kind === 'fix' ? -1 : 0) || FLOW.indexOf(b.step) - FLOW.indexOf(a.step))[0];
      if (!job) return null;
      const agent = STEPS[job.step].agent;
      inflight.add(job.id); busy[agent] = job.id; count[agent] = (count[agent] || 0) + 1;
      if (probeOpen && paid(job.step)) probing = true;
      return job;
    }
    async function nextWork() {
      const job = claimCase();
      if (job) return { type: 'case', job };
      // 新しい案件：企画の社員が空いていて、上限に余裕があるとき（1回の実行で1件まで。量産しない）
      if (!startTried && free('planner') && !stopAll && b0.ok && !quota) {
        startTried = true; busy.planner = 'start';
        const why = await canStart(kv, env, cases);
        delete busy.planner;
        board.planner = why ? `新しい案件は始めない：${why}` : '';
        if (why) health.noStart = why;
        else {
          started += 1; delete health.noStart;
          const reqs = (await kv.getJson(K.requests)) || [];
          const req = reqs.shift() || null;
          if (req) await kv.setJson(K.requests, reqs);
          const c = { id: newId('job'), kind: 'make', step: 'propose', createdAt: now(), attempts: 0, runs: [], wait: null, data: req ? { request: req } : {} };
          cases.push(c);
          await bump(kv, { started: 1 });
          await record(kv, { job: c.id, agent: 'planner', type: 'start', text: req ? `社長の指定（${req.text || '商品の指定'}）で新しい案件を始めた` : '社長の指示を待たずに、新しい案件を始めた（仕事探し：進行中の案件に空きがある）', title: '新しい企画' });
          await saveCasesNow(kv, cases);
          const j = claimCase(); if (j) return { type: 'case', job: j };
        }
      }
      // 仕事探し：案件の工程が無い社員が、自分の担当で本当に必要な仕事を見つける（1回の実行で1人1件まで）
      for (const s of STAFF) {
        if (!free(s.id) || tried.has(s.id) || stopAll) continue;
        if (cases.some((c) => !c.wait && STEPS[c.step] && STEPS[c.step].agent === s.id)) continue; // 自分の工程がある社員は、その工程を先に
        tried.add(s.id); busy[s.id] = 'finding';
        let w = null;
        try { w = await findWork(s.id, { kv, env, cases, elapsed }); } catch (e) { w = { none: `仕事探しでエラー（${String(e.message || e).slice(0, 60)}）` }; }
        if (w && w.task && (w.est || 0) > 0 && !aiAllowed()) { delete busy[s.id]; board[s.id] = 'OpenAIの残高待ち（AIを使う仕事は、残高が戻ってから）'; continue; }
        if (w && w.task) { count[s.id] = (count[s.id] || 0) + 1; busy[s.id] = w.task; if (probeOpen && (w.est || 0) > 0) probing = true; return { type: 'side', agent: s.id, ...w }; }
        delete busy[s.id];
        if (board[s.id] === undefined) board[s.id] = (w && w.none) || '今は担当の仕事がない';
      }
      return null;
    }
    async function runCase(job, lane) {
      const st = STEPS[job.step];
      const agent = st.agent;
      const bc = await budgetFor(st.est, job.step === 'image');
      if (!bc.ok) { stopAll = bc.reason; job.wait = { kind: 'budget', why: bc.reason, at: now() }; health.blocked = bc.reason; release(agent, job.id); await record(kv, { job: job.id, agent, type: 'budget', text: `${String(bc.reason || '予算の上限').replace(/ため.*$/, '')}ため、「${titleOf(job)}」は予算が戻ったら続ける`, title: titleOf(job) }); await saveCasesNow(kv, cases); return; }
      delete health.blocked;
      const est = job.step === 'image' ? IMAGE_ESTIMATE_YEN : st.est;
      reserved += est;
      job.current = { step: job.step, agent, doing: st.doing, at: now(), lane };
      await saveCasesNow(kv, cases); // 画面に「今この社員がこの仕事をしている」と出すため、始める前に保存
      const t0 = Date.now();
      const ctx = { kv, env, referer, origin, startedAt };
      let r; let calls = [];
      try { const x = await isolated(() => RUN[job.step](job, ctx)); r = x.result; calls = x.calls; } catch (e) { r = { fail: String(e && e.message || e).slice(0, 200) }; }
      const before = job.runs.length;
      job.runs.push(...calls.map((c) => ({ ...c, role: agent })));
      const yen = yenOf(job.runs.slice(before));
      reserved -= est;
      await budgetRecord(kv, yen, { auto: true });
      delete job.current; job.updatedAt = now();
      const w = { job: job.id, step: job.step, agent, yen, lane, from: Math.round((t0 - startedAt) / 100) / 10, to: Math.round(elapsed() / 100) / 10 };
      worked.push(w);
      const title = titleOf(job);
      if (paid(job.step) && (isQuotaError(r.fail) || isQuotaError(r.wait) || isQuotaError(r.dev))) {
        // 残高不足：失敗の回数・画像の描き直しの回数に数えない。案件は残高待ちで保存する
        job.wait = { kind: 'quota', why: 'OpenAIの残高がありません（残高が戻ったら続きから再開します）', at: now() };
        w.final = 'quota';
        await record(kv, { job: job.id, agent, type: 'budget', text: `OpenAIの残高がないため、「${title}」は残高が戻ったら続きから進める`, dev: r.fail || r.wait, title });
        await quotaHit(r.fail || r.wait || r.dev);
        release(agent, job.id); await saveCasesNow(kv, cases); return;
      }
      if (paid(job.step) && calls.some((c) => c.ok)) await quotaClear(); // AIが応答した＝残高が戻っている
      if (r.fail) {
        job.attempts = (job.attempts || 0) + 1;
        if (job.attempts >= MAX_TRIES || r.final) {
          await record(kv, { job: job.id, agent, type: 'stop', text: `止まった：${r.fail}`, dev: r.dev || r.fail, title });
          cases.splice(cases.indexOf(job), 1); w.final = 'stop';
          if (job.kind !== 'fix') await bump(kv, { stopped: 1, yenStopped: yenOf(job.runs) });
          await staffBump(kv, agent, { stops: 1, yen });
        } else {
          const mins = r.quick ? 0 : RETRY_MIN * job.attempts;
          job.wait = mins ? { kind: 'retry', until: new Date(Date.now() + mins * 60000).toISOString(), why: r.fail } : null;
          await record(kv, { job: job.id, agent, type: 'retry', text: mins ? `うまくいかなかったので、${mins}分後にやり直す（${r.fail}）` : `やり直す（${r.fail}）`, dev: r.dev || r.fail, title });
          await staffBump(kv, agent, { retries: 1, yen });
        }
      } else if (r.hold) {
        // 保留（6点に届かない等）：エラーにせず、理由と不足数を残して24時間後にもう一度
        job.wait = { kind: 'hold', why: r.hold, until: new Date(Date.now() + HOLD_HOURS * 3600000).toISOString(), at: now() }; job.attempts = 0; w.final = 'hold';
        await record(kv, { job: job.id, agent, type: 'wait', text: `保留：${r.hold}`, title });
        await staffBump(kv, agent, { steps: 1, yen });
      } else if (r.wait) {
        job.step = r.back || job.step; job.data.imageRounds = (job.data.imageRounds || 0) + 1; job.attempts = 0;
        await staffBump(kv, agent, { steps: 1, yen });
        if (job.data.imageRounds > MAX_IMAGE_ROUNDS) { await record(kv, { job: job.id, agent, type: 'stop', text: `止まった：画像を${MAX_IMAGE_ROUNDS}回描き直しても完成しなかった`, title }); cases.splice(cases.indexOf(job), 1); w.final = 'stop'; await bump(kv, { stopped: 1, yenStopped: yenOf(job.runs) }); }
        else { job.data.waitWhy = r.wait; job.wait = { kind: 'image', why: r.wait, at: now() }; await record(kv, { job: job.id, agent, type: 'wait', text: r.wait, title }); w.final = 'wait'; }
      } else {
        await record(kv, { job: job.id, agent, type: 'done', text: r.done, yen: yen || undefined, title });
        job.attempts = 0;
        job.contrib = [...new Set([...(job.contrib || []), agent])];
        await staffBump(kv, agent, { steps: 1, yen });
        if (r.deliver) {
          await record(kv, { job: job.id, agent: job.kind === 'regen' ? 'designer' : 'pr', type: 'deliver', text: r.deliver, set: job.data.setId || job.data.set.id, title });
          cases.splice(cases.indexOf(job), 1); w.final = 'deliver';
          if (job.kind === 'regen') await kv.pushJson(K.notices, { at: now(), id: job.data.setId, title, fix: true }, 30); // 作り直しは完成品の数に数えない
          else for (const a of job.contrib) await staffBump(kv, a, { delivered: 1 }); // 完成品への貢献（この案件で工程を完成させた社員）
        } else {
          await handoff(kv, job, STEPS[r.next].agent, r.what);
          job.step = r.next;
        }
      }
      release(agent, job.id);
      await saveCasesNow(kv, cases);
    }
    async function runSide(w, lane) {
      const bc = await budgetFor(w.est || 0);
      if (!bc.ok) { stopAll = bc.reason; board[w.agent] = `予算待ち（${bc.reason}）`; release(w.agent); return; }
      reserved += w.est || 0;
      health.side = { ...(health.side || {}), [w.agent]: { task: w.task, doing: w.doing, at: now() } };
      await kv.setJson(K.health, health);
      await record(kv, { agent: w.agent, type: 'find', text: `仕事探し：${w.task}` });
      const t0 = Date.now();
      let r; let calls = [];
      try { const x = await isolated(() => w.run({ kv, env, referer, origin, startedAt })); r = x.result || {}; calls = x.calls; } catch (e) { r = { fail: String(e && e.message || e).slice(0, 200) }; }
      const yen = yenOf(calls);
      reserved -= w.est || 0;
      await budgetRecord(kv, yen, { auto: true });
      delete (health.side || {})[w.agent];
      if ((w.est || 0) > 0 && isQuotaError(r.fail)) { await quotaHit(r.fail); board[w.agent] = 'OpenAIの残高待ち（AIを使う仕事は、残高が戻ってから）'; release(w.agent); worked.push({ side: w.kind, step: w.kind, agent: w.agent, yen: 0, lane, final: 'quota' }); return; }
      if ((w.est || 0) > 0 && calls.some((c) => c.ok)) await quotaClear();
      worked.push({ side: w.kind, step: w.kind, agent: w.agent, yen, lane, from: Math.round((t0 - startedAt) / 100) / 10, to: Math.round(elapsed() / 100) / 10, final: r.fail ? 'fail' : 'done' });
      await record(kv, { agent: w.agent, type: r.fail ? 'retry' : 'done', side: w.kind, text: r.fail ? `うまくいかなかった（${r.fail}）。次の機会にやり直す` : r.done, yen: yen || undefined, ...(r.title ? { title: r.title } : {}) });
      if (!r.fail && r.handoff && r.handoff !== w.agent) {
        await record(kv, { agent: w.agent, to: r.handoff, type: 'handoff', side: w.kind, text: `${staffName(r.handoff)}へ引き継ぎ（${r.what || (w.kind === 'pr-draft' || w.kind === 'pr-revise' ? 'コメント案の採点' : 'コメント案の修正')}）` });
        tried.delete(r.handoff); delete board[r.handoff]; // 引き継がれた社員は、同じ回の中でもう一度仕事を探せる
      }
      await staffBump(kv, w.agent, r.fail ? { retries: 1, yen } : { side: 1, yen });
      board[w.agent] = r.fail ? `うまくいかなかった（${String(r.fail).slice(0, 60)}）` : '';
      release(w.agent);
    }
    async function lane(n) {
      for (;;) {
        if (stopAll || elapsed() > TICK_BUDGET_MS) return;
        const w = await nextWork();
        if (!w) { if (running > 0) { await changed(); continue; } return; }
        running += 1; peak = Math.max(peak, running);
        try { if (w.type === 'case') await runCase(w.job, n); else await runSide(w, n); }
        finally { running -= 1; notify(); }
      }
    }
    await Promise.all(Array.from({ length: MAX_PARALLEL }, (_, i) => lane(i + 1)));
    // この回の中で文章の前まで進んだ案件も、枠が無ければ「枠待ち」で保存する
    if (slotFull) { for (const c of cases) if (!c.wait && c.kind === 'make' && c.step === SLOT_STEP) { c.wait = { kind: 'slot', why: SLOT_WHY(waitingNow), at: now() }; await record(kv, { job: c.id, agent: 'buyer', to: 'writer', type: 'wait', text: `「${titleOf(c)}」は企画と商品をそろえて保存した（完成品の枠が空いたら文章へ）`, title: titleOf(c) }); } await saveCasesNow(kv, cases); }
    // 確かめる1件に選んだが、ほかの案件で残高不足が分かったときは、残高待ちに戻す
    if (quota) { for (const c of cases) if (c.id === probeCase && !c.wait) c.wait = { kind: 'quota', why: 'OpenAIの残高がありません（残高が戻ったら続きから再開します）', at: now() }; await saveCasesNow(kv, cases); }
    health.board = board; health.boardAt = now();
    health.peak = peak; health.lanes = worked.slice(0, 20).map((x) => ({ lane: x.lane, from: x.from, to: x.to, agent: x.agent, step: x.step, side: !!x.side, final: x.final || '' }));
    if (worked.length) { out.worked = worked[worked.length - 1]; out.steps = worked.map((x) => `${x.agent}:${x.step}${x.final ? `:${x.final}` : ''}`); out.jobs = [...new Set(worked.filter((x) => x.job).map((x) => x.job))]; out.parallel = { peak, lanes: worked.map((x) => `L${x.lane} ${x.from}-${x.to}s ${x.agent}:${x.step}`) }; }
    if (!worked.length) out.idle = health.noStart || (cases.length ? `進行中の案件${cases.length}件はすべて待ち（${cases.map((c) => (c.wait ? c.wait.kind : c.step)).join('・')}）` : '今できる仕事はありません');
    out.board = board;
    out.chainLast = await kv.getJson('v2:chain:last'); // 前の実行が次を呼んだか（連鎖の確認用）
    out.chainHour = Number(await kv.get(`v2:chain:${new Date().toISOString().slice(0, 13)}`)) || 0;
    // まだ進められる仕事が残っているか（残っていれば、15分の定期実行を待たずに次の実行を呼ぶ：server/worker.js の連鎖）
    //   予算・残高待ち・完成品の枠待ち・画像待ち・再試行待ちの案件は数えない（待つべきものは待つ）。この回に何も進まなかったときは呼ばない（空回りしない）
    out.more = !stopAll && !quota && worked.length > 0 && cases.some((c) => !c.wait && STEPS[c.step] && !(slotFull && c.kind === 'make' && c.step === SLOT_STEP));
    out.quota = quota ? { since: quota.since, until: quota.until, tries: quota.tries } : null;
    await kv.setJson(K.health, health);
    { const t = await trialState(kv, env); const sp = await budgetSpent(kv); const isp = await imageSpent(kv); out.budget = { month: sp.month, dayAuto: sp.dayAuto, imageMonth: isp.month, imageToday: isp.dayYen, trial: t ? { start: t.start, end: t.end, base: t.base.spent, used: t.used, left: t.left } : null }; }
    out.cases = cases.map((c) => `「${titleOf(c)}」：${STEPS[c.step] ? STEPS[c.step].task : c.step}${c.wait ? `（${({ image: '画像待ち', budget: '予算待ち', retry: '再試行待ち', quota: '残高待ち', slot: '完成品の枠待ち', hold: '保留（商品が足りない）' })[c.wait.kind]}）` : ''}`);
    out.waitingOwner = await waitingCount(kv);
    // 確認用：直近24時間に「見直した版」になった完成品の前後（前の商品・今の商品と役割・外した商品と理由）
    out.stopped = ((await kv.listJson(K.events, 300)) || []).filter((e) => e.type === 'stop').slice(0, 8).map((e) => `${e.at.slice(5, 16)} ${e.title || ''}：${String(e.text || '').slice(0, 120)}`); // 確認用：止まった案件と理由
    out.redone = [];
    for (const x of ((await kv.getJson(K.sets)) || []).slice(0, 20)) {
      const s = await kv.getJson(K.set(x.id));
      if (!s || !(s.versions || []).length || Date.now() - Date.parse(s.deliveredAt || 0) > 86400000) continue;
      const before = s.versions[s.versions.length - 1];
      out.redone.push({ title: s.title, beforeTitle: before.title, before: (before.products || []).map((p) => `${short(p.name)}（${p.price}円）`), after: (s.raw && s.raw.items || []).map((it) => ({ role: it.role, name: short(it.name), price: it.price, why: String(it.why || '').slice(0, 70), use: it.use || '' })), dropped: s.dropped || [] });
    }
    // 確認用：進行中の案件でそろえた商品（名前・価格・役割・選んだ理由・販売ページ）。社長の画面には完成品として出る
    out.items = cases.filter((c) => c.data && c.data.set && (c.data.set.items || []).length).map((c) => ({ title: titleOf(c), step: c.step, wait: c.wait ? c.wait.kind : '', items: c.data.set.items.map((it) => ({ role: it.role || '', name: short(it.name), price: it.price, why: [it.feature, it.why].filter(Boolean).join('／').slice(0, 80), url: it.url, by: it.addedBy || it.filledBy || 'ai' })) }));
    out.recent = ((await kv.listJson(K.events, 16)) || []).map((e) => `${new Date(Date.parse(e.at) + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ')}${e.via ? `［${e.via}］` : ''} ${staffName(e.agent)}${e.to ? `→${staffName(e.to)}` : ''}：${e.text}`);
    return out;
  } finally {
    currentTrigger = '';
    await kv.delIf(K.lock, token).catch(() => {});
  }
}

// ---- 仕事探し（2026-11-16）：案件の工程が無い社員が、自分の担当で本当に必要な仕事だけを見つける ----
//   見つからなければ、理由つきで「仕事なし」（仕事をしているように見せるための処理はしない）
export const RECHECK_HOURS = 24;   // 納品した完成品の商品を、楽天で確かめ直す間隔
const RECHECK_MAX_ITEMS = 4;
const NONE = {
  buyer: '商品を探す工程が来たら担当（今は進行中の案件に、商品を探す工程が無い）',
  writer: '文章を書く工程が来たら担当（今は進行中の案件に、文章の工程が無い）',
  editor: '直す工程が来たら担当（監査の指摘・社長の修正依頼が無い）',
  designer: '表紙画像の工程が来たら担当（1企画1枚。作り直しは社長が完成品のページから頼める）',
  appraiser: 'ポストにスクショが届いたら担当'
};
async function recheckWork(kv) {
  const list = ((await kv.getJson(K.sets)) || []).filter((x) => ['waiting', 'adopted'].includes(x.status));
  const due = list.find((x) => Date.now() - Date.parse(x.recheckedAt || x.deliveredAt || 0) > RECHECK_HOURS * 3600000);
  if (!due) return null;
  return { kind: 'recheck', task: `完成品「${due.title}」の商品が今も買えるか・価格が変わっていないか、楽天で確かめ直す（AIは使わない）`, doing: '完成品の商品を楽天で確かめ直しています', est: 0, run: (ctx) => recheckRun(kv, ctx, due.id) };
}
async function recheckRun(kv, ctx, id) {
  const s = await kv.getJson(K.set(id));
  if (!s) return { fail: '完成品が見つからない' };
  const at = now(); const notes = [];
  const products = [];
  for (const [i, p] of (s.products || []).entries()) {
    if (i >= RECHECK_MAX_ITEMS || !p.code) { products.push(p); continue; }
    let it = null; let err = '';
    try { it = await lookupItem({ code: p.code, env: ctx.env, referer: ctx.referer }); } catch (e) { err = String(e.message || e).slice(0, 60); }
    if (err) { products.push({ ...p, recheck: { at, status: 'error', why: err } }); continue; }
    if (!it) { notes.push(`${p.short || short(p.name)}：楽天で見つからない（販売終了の可能性）`); products.push({ ...p, recheck: { at, status: 'missing' } }); continue; }
    const changed = Number(it.price) !== Number(p.price);
    if (changed) notes.push(`${p.short || short(p.name)}：${Number(p.price).toLocaleString('ja-JP')}円 → ${Number(it.price).toLocaleString('ja-JP')}円`);
    products.push({ ...p, recheck: { at, status: changed ? 'changed' : 'same', price: it.price } });
  }
  await ctx.kv.setJson(K.set(id), { ...s, products, recheckedAt: at, recheckNotes: notes });
  const list = (await kv.getJson(K.sets)) || [];
  await kv.setJson(K.sets, list.map((x) => (x.id === id ? { ...x, recheckedAt: at, recheckNotes: notes.length } : x)));
  if (notes.length) await kv.pushJson(K.notices, { at, id, title: s.title, recheck: true, text: notes.join('／').slice(0, 160) }, 30);
  const n = products.filter((p) => p.recheck && p.recheck.at === at && p.recheck.status !== 'error').length;
  return { done: notes.length ? `「${s.title}」の商品${n}点を楽天で確かめ直した。変わった点：${notes.join('／').slice(0, 100)}` : `「${s.title}」の商品${n}点を楽天で確かめ直した（価格・販売とも変わりなし）`, title: s.title };
}
// 編集：納品済みの完成品のくまの一言メモが、今の決まり（AIの一言をコードで確認）より前の作り方なら書き直す（2026-11-16 社長の指摘）
async function memoWork(kv) {
  const list = ((await kv.getJson(K.sets)) || []).filter((x) => ['waiting', 'adopted', 'fixing'].includes(x.status)).slice(0, 15);
  for (const x of list) {
    const s = await kv.getJson(K.set(x.id));
    const items = (s && s.raw && s.raw.copy && s.raw.copy.items) || [];
    const dupFallback = items.length - new Set(items.map((c) => c.memo)).size > 0; // 同じ一言が並んでいる（2026-11-16 本番）
    if (!items.length || (items.every((c) => c.memoV >= 2) && !(dupFallback && items.every((c) => c.memoV < 3))) || (s.memoTries || 0) >= 2) continue;
    return { kind: 'memo', task: `完成品「${s.title}」のくまの一言メモが意味の通らない文になっているので書き直す`, doing: 'くまの一言メモを書き直しています', est: 0.5, run: (ctx) => memoRun(kv, ctx, s.id) };
  }
  return null;
}
async function memoRun(kv, ctx, id) {
  const s = await kv.getJson(K.set(id));
  if (!s || !s.raw) return { fail: '完成品が見つからない' };
  const d = await P.memoStep({ set: s.raw, env: ctx.env, startedAt: Date.now() });
  if (!d.ok) { if (!isQuotaError(d.error)) await kv.setJson(K.set(id), { ...s, memoTries: (s.memoTries || 0) + 1 }); return { fail: d.error || '一言メモを作れなかった' }; } // 残高不足は数えない
  const before = s.raw.copy.items.map((c) => c.memo || '');
  const items = s.raw.copy.items.map((c, i) => ({ ...c, ...(d.memos[i] || {}), memoV: 3 }));
  await kv.setJson(K.set(id), { ...s, raw: { ...s.raw, copy: { ...s.raw.copy, items } }, memoFixedAt: now(), memoBefore: before });
  const fb = (d.memos || []).filter((m) => /決まった一言/.test(m.memoFrom || '')).length;
  return { done: `「${s.title}」のくまの一言メモを${items.length}件書き直した${fb ? `（うち${fb}件はAIの一言が決まりに合わず、決まった一言）` : ''}`, title: s.title };
}
// 監査：枠待ちで保存している企画の主役の商品が、今も買えるか・価格が変わっていないかを24時間ごとに確かめる（AIは使わない）
function stockCheckWork(cases) {
  const c = (cases || []).find((x) => x.wait && x.wait.kind === 'slot' && x.data && x.data.hero && x.data.hero.code && Date.now() - Date.parse(x.data.hero.checkedAt || x.wait.at || 0) > RECHECK_HOURS * 3600000);
  if (!c) return null;
  return { kind: 'stock-check', task: `保存している企画「${titleOf(c)}」の主役の商品が今も買えるか、楽天で確かめる（AIは使わない）`, doing: '保存している企画の商品を楽天で確かめています', est: 0, run: async (ctx) => {
    const h = c.data.hero;
    const it = await lookupItem({ code: h.code, env: ctx.env, referer: ctx.referer });
    if (!it) { c.wait = null; c.step = 'find'; c.attempts = 0; return { done: `「${titleOf(c)}」の主役の商品が楽天で見つからない（販売終了の可能性）。バイヤーが探し直す`, title: titleOf(c) }; }
    const before = h.price; h.price = it.price; h.checkedAt = now();
    return { done: `保存している企画「${titleOf(c)}」の主役の商品を確かめた（${before === it.price ? `${it.price.toLocaleString('ja-JP')}円・変わりなし` : `${Number(before).toLocaleString('ja-JP')}円 → ${it.price.toLocaleString('ja-JP')}円`}）`, title: titleOf(c) };
  } };
}
export async function findWork(agent, { kv, env, cases = [], elapsed = () => 0 }) {
  if (agent === 'editor') return (await memoWork(kv)) || { none: NONE.editor };
  if (agent === 'writer') return (await hooksWork(kv)) || { none: '完成品の冒頭の一言（リール・キャプション）は作り終えている。文章の工程が来たら担当' };
  if (agent === 'pr') return prWork(kv, env, { elapsed });
  if (agent === 'auditor') return (await prAuditWork(kv)) || stockCheckWork(cases) || (await recheckWork(kv)) || { none: `完成品の確かめ直しは${RECHECK_HOURS}時間ごと（今は必要な完成品が無い）。採点待ちのコメント案も無い` };
  if (agent === 'planner') return { none: '新しい案件は、進行中の案件に空きができたら始める' };
  return { none: NONE[agent] || '今は担当の仕事がない' };
}
// ---- 社長の画面に渡す状態（点数・技術ログは渡さない） ----
//   社員の状態：work（今この瞬間に処理中）／turn（担当中：自分の工程の案件がある）／handoff（引き継ぎ中：直前に次の部署へ渡した）
//   ／error（エラー：再試行待ち）／budget（予算待ち）／wait（画像待ち）／idle（待機）
export async function officeState(kv, env) {
  const [cases0, events, sets, health0, active, sales, metrics, reqs, notices, stats0, pr] = await Promise.all([kv.getJson(K.cases), kv.listJson(K.events, 300), kv.getJson(K.sets), kv.getJson(K.health), kv.get(K.active), kv.getJson(K.sales), kv.getJson(K.metrics), kv.getJson(K.requests), kv.listJson(K.notices, 10), kv.getJson(K.staff), prState(kv, env)]);
  const health = health0 || {};
  const quota0 = await kv.getJson(K.quota);
  const reach = await reachState(kv).catch(() => null); // 集客（リール・投稿の実績・冒頭の一言・探す場所）
  const stats = stats0 || {};
  const fresh = (at) => at && Date.now() - Date.parse(at) < CURRENT_STALE_MS;
  const cases = Array.isArray(cases0) ? cases0 : [];
  const evs = (events || []).map(({ dev, ...e }) => e);
  const lastOf = (agent) => evs.find((e) => e.agent === agent && (e.type === 'done' || e.type === 'deliver'));
  const caseView = (c) => ({ id: c.id, title: titleOf(c), kind: c.kind, step: c.step, task: STEPS[c.step] ? STEPS[c.step].task : c.step, agent: STEPS[c.step] ? STEPS[c.step].agent : '', next: nextOf(c.step) ? STEPS[nextOf(c.step)].task : '', nextAgent: nextOf(c.step) ? staffName(STEPS[nextOf(c.step)].agent) : '', wait: c.wait ? { kind: c.wait.kind, why: c.wait.why || '', until: c.wait.until || '' } : null, working: !!(c.current && fresh(c.current.at)), createdAt: c.createdAt || '' });
  const views = cases.map(caseView);
  const postIds = (await kv.getJson('v2:posts')) || [];
  const lastPost = postIds.length ? await kv.getJson(`v2:post:${postIds[0]}`) : null;
  const postRunning = !!(lastPost && lastPost.status === 'running' && Date.now() - Date.parse(lastPost.at) < 120000);
  // 社員の状態（2026-11-16）：work＝今この瞬間に処理している（担当中）／queued＝自分の工程の案件がある（次の定期実行待ち）
  //   ／error（再試行待ち）／budget（予算待ち）／wait（画像待ち）／approval（社長の承認待ち）／handoff（直前に次の部署へ渡した）／idle（仕事なし：仕事探しの理由つき）
  const board = health.board || {};
  const side = health.side || {};
  const day = jstDate();
  const staff = STAFF.map((s) => {
    const mine = views.filter((v) => v.agent === s.id);
    const last = lastOf(s.id);
    const lastEv = evs.find((e) => e.agent === s.id);
    const sd = side[s.id] && fresh(side[s.id].at) ? side[s.id] : null;
    const approvals = s.id === 'pr' ? pr.counts.approval + pr.counts.approved : 0;
    const waitingSets = s.id === 'pr' ? list0(sets).filter((x) => x.status === 'waiting').length : 0;
    let status = 'idle';
    if (mine.some((v) => v.working) || sd || (s.id === 'appraiser' && postRunning)) status = 'work';
    else if (mine.some((v) => !v.wait)) status = 'queued';
    else if (mine.some((v) => v.wait && (v.wait.kind === 'retry' || v.wait.kind === 'hold'))) status = 'error';
    else if (mine.some((v) => v.wait && (v.wait.kind === 'budget' || v.wait.kind === 'quota'))) status = 'budget';
    else if (mine.some((v) => v.wait && v.wait.kind === 'image')) status = 'wait';
    else if (mine.some((v) => v.wait && v.wait.kind === 'slot')) status = 'approval';
    else if (approvals || waitingSets) status = 'approval';
    else if (lastEv && lastEv.type === 'handoff' && Date.now() - Date.parse(lastEv.at) < 10 * 60000) status = 'handoff';
    const cur = mine.find((v) => v.working) || mine.find((v) => !v.wait) || mine[0] || null;
    let doing = '';
    if (s.id === 'appraiser' && postRunning) doing = 'ポストに届いたスクショの商品を調べています';
    else if (sd) doing = sd.doing || sd.task;
    else if (cur && cur.working) doing = STEPS[cur.step].doing;
    else if (cur && cur.wait) doing = `${({ image: '画像待ち', budget: '予算待ち', retry: 'エラー・再試行待ち', quota: 'OpenAIの残高待ち', slot: '完成品の枠待ち', hold: '保留（商品が足りない）' })[cur.wait.kind]}：${cur.wait.why}`;
    else if (cur) doing = `次の番：${cur.task}（前の仕事が終わりしだい続けて進めます）`;
    else if (status === 'approval') doing = [approvals ? `コメント案${approvals}件が社長の承認・送信の記録待ち` : '', waitingSets ? `完成品${waitingSets}件が社長の確認待ち` : ''].filter(Boolean).join('・');
    else if (status === 'handoff') doing = `「${lastEv.title || ''}」を${staffName(lastEv.to)}へ引き継いだところ`;
    else doing = board[s.id] ? `仕事なし：${board[s.id]}` : '仕事なし';
    const st = stats[s.id] || {};
    const history = evs.filter((e) => e.agent === s.id && ['done', 'deliver', 'stop', 'retry', 'find', 'wait', 'start'].includes(e.type)).slice(0, 10).map((e) => ({ at: e.at, type: e.type, text: e.text, title: e.title || '', via: e.via || '' }));
    return { ...s, status, doing, cases: mine.map((v) => ({ title: v.title, task: v.task, wait: v.wait, next: v.next, nextAgent: v.nextAgent })), title: cur ? cur.title : '', last: last ? { at: last.at, text: last.text, title: last.title || '' } : null, next: cur && cur.next ? `${cur.nextAgent}：${cur.next}` : '',
      stats: { today: Number((st.days || {})[day]) || 0, steps: Number(st.steps) || 0, side: Number(st.side) || 0, delivered: Number(st.delivered) || 0, stops: Number(st.stops) || 0, retries: Number(st.retries) || 0, yen: Math.round((Number(st.yen) || 0) * 10) / 10, days: st.days || {} }, history, board: board[s.id] || '' };
  });
  const [sp, lim, isp, ilim] = await Promise.all([budgetSpent(kv), Promise.resolve(budgetLimits(env)), imageSpent(kv), Promise.resolve(imageLimits(env))]);
  const month = jstDate().slice(0, 7);
  const m = metrics || {}; const mm = m[month] || {};
  const dupRate = (x) => (x.proposals ? Math.round(((x.duplicates || 0) / x.proposals) * 100) : null);
  const passRate = (x) => ((x.delivered || 0) + (x.stopped || 0) ? Math.round(((x.delivered || 0) / ((x.delivered || 0) + (x.stopped || 0))) * 100) : null);
  const list = sets || [];
  // 画像以外ができている制作物（画像ができたら正式に納品）
  const drafts = cases.filter((c) => c.data && c.data.set && c.data.set.copy && ['scene', 'image', 'checkImage'].includes(c.step)).map((c) => ({ id: c.id, title: titleOf(c), wait: c.wait ? c.wait.why || '' : '', step: STEPS[c.step].task, caption: (c.data.set.copy || {}).caption || '', products: (c.data.set.items || []).map((it, i) => ({ role: i === 0 ? '本命' : '代替・比較', name: it.name, price: it.price, url: it.url, image: it.image, room: ((c.data.set.roomTexts || [])[i] || {}).intro || '' })), pickReason: (c.data.hero || {}).reason || '' }));
  const stopped = evs.filter((e) => e.type === 'stop').slice(0, 10).map((e) => ({ at: e.at, title: e.title || '', why: String(e.text || '').replace(/^止まった：/, ''), agent: staffName(e.agent) }));
  const trial = await trialState(kv, env);
  const tr = trial ? { start: trial.start, end: trial.end, active: trial.active, cap: trial.cap, baseSpent: trial.base.spent, used: trial.used, left: trial.left, monthLeft: trial.monthLeft, delivered: list.filter((x) => x.deliveredAt >= trial.start).length, adopted: list.filter((x) => x.deliveredAt >= trial.start && (x.status === 'adopted' || x.status === 'posted')).length } : null;
  if (tr) tr.yenPerSet = tr.delivered ? Math.round((tr.used / tr.delivered) * 10) / 10 : null;
  return {
    reach,
    quota: quota0 ? { since: quota0.since, until: quota0.until, tries: quota0.tries || 0 } : null,
    drafts, stopped, trial: tr, pr, lanes: health.lanes || [], peak: Number(health.peak) || 0,
    at: now(), active: active === '1' || !v1Enabled(env), v1Retired: !v1Enabled(env), staff, cases: views,
    events: evs, sets: list, waiting: list.filter((x) => x.status === 'waiting').length, notices: notices || [], requests: (reqs || []).map((r) => ({ text: r.text, url: r.url, at: r.at })),
    idle: health && health.noStart ? health.noStart : '', blocked: health && health.blocked ? health.blocked : '', lastTickAt: health ? health.lastTickAt : '',
    results: {
      month, delivered: mm.delivered || 0, deliveredTotal: m.delivered || 0, adopted: list.filter((x) => x.status === 'adopted' || x.status === 'posted').length, posted: list.filter((x) => x.status === 'posted').length,
      passRate: passRate(mm), stopped: mm.stopped || 0, started: mm.started || 0, accuracy: mm.products ? Math.round(((mm.verifiedProducts || 0) / mm.products) * 100) : null, dupRate: dupRate(mm),
      yenPerSet: mm.delivered ? Math.round(((mm.yen || 0) + (mm.yenStopped || 0)) / mm.delivered * 10) / 10 : null
    },
    money: { spent: sp, limits: lim, image: isp, imageLimits: ilim, imageToday: imageDayAllowance(ilim, isp), salesMonth: Number((sales || {})[month]) || 0, month }
  };
}
function list0(x) { return Array.isArray(x) ? x : []; }
export async function getSet(kv, id) {
  const s = await kv.getJson(K.set(String(id).replace(/[^\w.:-]/g, '')));
  if (!s) return null;
  const { raw, dev, ...pub } = s;
  const items = (raw && raw.items) || [];
  const copy = (raw && raw.copy) || {};
  // 画面でInstagram用の画像（表紙・商品カード・ROOMへの案内）を作るための材料と、楽天ROOMの登録に使う商品番号（1.0と同じ作り方）
  pub.products = (pub.products || []).map((p, i) => ({ ...p, code: p.code || (items[i] || {}).code || '', shortName: ((copy.items || [])[i] || {}).shortName || p.short, subline: ((copy.items || [])[i] || {}).subline || '', memo: ((copy.items || [])[i] || {}).memo || '', roomDone: !!(s.roomDone || {})[(items[i] || {}).code || p.code], curatedRole: (items[i] || {}).role || '', use: (items[i] || {}).use || '', diff: (items[i] || {}).diff || '' }));
  pub.slides = { topic: copy.topic || s.title, category: (raw && raw.patternLabel) || '', sub: s.target || (raw && raw.target) || '' };
  return pub;
}
// 社長がChatGPTで作った表紙画像を、完成品に追加・差し替えする（2026-11-17。前の画像は消さずに履歴に残す）
export const OWNER_IMAGE_MAX_B64 = 1600 * 1024;
export async function setOwnerImage(kv, { id, image }) {
  const s = await kv.getJson(K.set(String(id || '')));
  if (!s) throw new Error('その完成品はありません');
  const m = String(image || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('画像を読み込めませんでした（JPEGで送ってください）');
  if (m[1].length > OWNER_IMAGE_MAX_B64) throw new Error('画像が大きすぎます');
  const mediaId = await C.saveMedia(kv, m[1]);
  const img = { mediaId, url: `/api/media?id=${mediaId}`, label: 'AI生成イメージ（社長がChatGPTで作成）', by: 'owner', at: now() };
  await kv.setJson(K.set(s.id), { ...s, image: img, imageHistory: [...(s.imageHistory || []), ...(s.image ? [s.image] : [])].slice(-10) });
  const list = (await kv.getJson(K.sets)) || [];
  await kv.setJson(K.sets, list.map((x) => (x.id === s.id ? { ...x, image: img.url } : x)));
  await record(kv, { job: s.jobId, agent: 'owner', type: 'owner', text: `社長が「${s.title}」の表紙画像を${s.image ? '差し替えた' : '追加した'}（ChatGPTで作成）`, title: s.title });
  return img;
}

// 社長の「AIで表紙画像を作り直す」：デザイナーが次の定期実行で1枚だけ描く（1つの完成品につき REGEN_MAX 回まで。予算は描く前に確かめる）
export const REGEN_MAX = 3;
export async function requestRegen(kv, { id }) {
  const s = await kv.getJson(K.set(String(id || '')));
  if (!s || !s.raw) throw new Error('その完成品はありません');
  if (s.regenPending) throw new Error('作り直しはもう頼んであります（次の定期実行で描きます）');
  if ((s.regenCount || 0) >= REGEN_MAX) throw new Error(`作り直しは1つの完成品につき${REGEN_MAX}回までです`);
  const cases = await loadCases(kv);
  const c = { id: newId('regen'), kind: 'regen', step: 'scene', createdAt: now(), attempts: 0, runs: [], wait: null, data: { set: { ...s.raw, coverImage: null }, setId: s.id, plan: { title: s.title } } };
  await saveCases(kv, [...cases, c]);
  await kv.setJson(K.set(s.id), { ...s, regenPending: true, regenCount: (s.regenCount || 0) + 1 });
  await record(kv, { job: c.id, agent: 'owner', type: 'owner', text: `社長が「${s.title}」の表紙画像の作り直しを頼んだ（${(s.regenCount || 0) + 1}回目）`, title: s.title });
  return { regenCount: (s.regenCount || 0) + 1, max: REGEN_MAX };
}

// 楽天ROOMに登録した（社長の申告の記録。ROOMへの投稿は自動化しない）
export async function markRoom(kv, { id, code, done = true }) {
  const s = await kv.getJson(K.set(String(id)));
  if (!s) throw new Error('その完成品はありません');
  const c = String(code || '').slice(0, 120);
  if (!c) throw new Error('商品番号がありません');
  const roomDone = { ...(s.roomDone || {}) };
  if (done) roomDone[c] = new Date().toISOString(); else delete roomDone[c];
  await kv.setJson(K.set(s.id), { ...s, roomDone });
  if (done) await record(kv, { job: s.jobId, agent: 'owner', type: 'owner', text: `社長が「${s.title}」の商品を楽天ROOMに登録した（社長の申告）`, title: s.title });
  return { roomDone };
}

// ---- 社長の判断：採用・却下・修正依頼・投稿した（修正依頼は編集→監査→編集→広報で直して届け直す） ----
export async function decide(kv, { id, action, note = '' }) {
  const s = await kv.getJson(K.set(id));
  if (!s) throw new Error('その完成品はありません');
  if (!['adopt', 'reject', 'revise', 'posted'].includes(action)) throw new Error('判断の種類が分かりません');
  const status = ({ adopt: 'adopted', reject: 'rejected', revise: 'fixing', posted: 'posted' })[action];
  const n = String(note || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 200);
  if (action === 'revise' && !n) throw new Error('どこを直すか書いてください');
  await kv.setJson(K.set(id), { ...s, status, decidedAt: now(), ...(action === 'posted' ? { postedAt: now() } : {}), ownerNote: n || s.ownerNote || '' });
  const list = ((await kv.getJson(K.sets)) || []).map((x) => (x.id === id ? { ...x, status } : x));
  await kv.setJson(K.sets, list);
  if (action === 'revise') await kv.setJson(K.fixq, [...((await kv.getJson(K.fixq)) || []).filter((x) => x.id !== id), { id, note: n, at: now() }]);
  if (action === 'adopt') await bump(kv, { adopted: 1 });
  if (action === 'posted') await bump(kv, { posted: 1 });
  await record(kv, { job: s.jobId, agent: 'owner', type: 'owner', text: `社長が「${s.title}」を${({ adopt: '採用', reject: '却下', revise: `修正依頼（${n}）`, posted: '投稿した' })[action]}`, title: s.title });
  return { id, status };
}
// 社長のテーマ・商品の指定（次の新しい案件で優先する）
export async function addRequest(kv, { text = '', url = '' }) {
  const t = String(text || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 40);
  const u = String(url || '').trim();
  if (u && !rakutenCodeFromUrl(u)) throw new Error('楽天市場の商品ページのURL（https://item.rakuten.co.jp/…）を入れてください');
  if (!t && !u) throw new Error('テーマか商品のURLを入れてください');
  const list = (await kv.getJson(K.requests)) || [];
  if (list.length >= 10) throw new Error('指定は10件までです');
  list.push({ text: t, url: u, at: now() });
  await kv.setJson(K.requests, list);
  await record(kv, { agent: 'owner', type: 'owner', text: `社長が${u ? '商品' : `テーマ「${t}」`}を指定した（次の新しい案件で優先）` });
  return list;
}
export async function setSales(kv, { month, yen }) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('月の形が違います');
  const v = Math.max(0, Math.min(10000000, Math.round(Number(yen) || 0)));
  const s = (await kv.getJson(K.sales)) || {}; s[month] = v; await kv.setJson(K.sales, s);
  return s;
}
export async function setActive(kv, on) { await kv.set(K.active, on ? '1' : '0'); await record(kv, { agent: 'owner', type: 'owner', text: on ? '社長が会社を2.0に切り替えた（定期実行は2.0だけが使う）' : '社長が1.0に戻した' }); return on; }
export async function isActive(kv) { return (await kv.get(K.active)) === '1'; }
