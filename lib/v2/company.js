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
import { check as budgetCheck, record as budgetRecord, spent as budgetSpent, limits as budgetLimits, imageCheck, imageSpent, imageLimits, imageDayAllowance, jstDate, IMAGE_ESTIMATE_YEN } from '../budget.js';
import * as P from '../production.js';
import { toItem, qualityCheck, MIN_ITEMS } from '../postset.js';
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
  copy: { task: 'Instagramの文章を書く', agent: 'writer', doing: 'Instagramの文章を書いています', est: 1 },
  room: { task: '楽天ROOMの紹介文を書く', agent: 'writer', doing: '楽天ROOMの紹介文を書いています', est: 1 },
  auditText: { task: '文章を確かめる', agent: 'auditor', doing: '文章に作り話や誇張がないか確かめています', est: 1 },
  edit: { task: '指摘された文章を直す', agent: 'editor', doing: '指摘された文章を直しています', est: 1 },
  review: { task: '投稿全体の整合性を確かめる', agent: 'editor', doing: '価格・商品数・表記がそろっているか確かめています', est: 0 },
  scene: { task: 'くまが商品を使う場面を考える', agent: 'designer', doing: 'くまが商品を使う場面を考えています', est: 1 },
  image: { task: '表紙画像を描く', agent: 'designer', doing: '表紙画像を描いています', est: 0 },
  checkImage: { task: '画像を確かめる', agent: 'auditor', doing: '画像に間違いがないか確かめています', est: 1 },
  pack: { task: '投稿の準備をそろえて納品する', agent: 'pr', doing: 'ハッシュタグ・投稿の順番・注意事項をそろえています', est: 0 }
};
// 画面の「次の工程」の目安（実際の分かれ道は工程の結果で決まる）
export const FLOW = ['propose', 'find', 'checkHero', 'plan', 'gather', 'pick', 'copy', 'room', 'auditText', 'review', 'scene', 'image', 'checkImage', 'pack'];
export const nextOf = (step) => (step === 'edit' ? 'auditText' : FLOW[FLOW.indexOf(step) + 1] || '');

export const MAX_ACTIVE = 3;       // 同時に進める案件（画像待ちを除く。2026-11-16：画像待ちと合わせて数えるのをやめ、画像待ちの間もほかの案件を進める）
export const MAX_IMAGE_WAIT = 2;   // 画像待ちの案件がこの数なら、新しい案件は始めない（画像は1日1枚のため、文章だけ作ってもたまるだけ）
export const MAX_WAITING = 5;      // 社長の確認待ちの完成品がこの数なら、新しい案件は始めない（見られない物に費用をかけない）
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
  used: 'v2:used', staff: 'v2:staff', quota: 'v2:quota', themes: 'v2:themes', themeIdx: 'v2:themeIdx', sales: 'v2:sales', active: 'v2:active', lock: 'worker:lock', health: 'v2:health', metrics: 'v2:metrics', notices: 'v2:notices'
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
const PROPOSE_PROMPT = `あなたは「サングラスくま株式会社」の企画担当です。忙しい社会人の「買い物の失敗を減らす」Instagram・楽天ROOMの投稿企画を1つ提案します。JSONだけを返してください。
- 誰に・どんな悩みを解決するために・なぜ今その商品を買ってもらうのか、が言える企画にする
- 会社の方針：特に (A) 高級感があり価格に見合う価値のある商品（基本3万円以内。デザイン・素材・機能・品質・ブランドに魅力があり、自分で使いたい・贈りたいと思えるもの）と、(B) 高級品に迫る高コスパ商品（単に安いのではなく「この価格でここまで」と思えるもの）を重視する
- 価格帯の目安（企画のルールではない）：3,000円未満＝手頃な高コスパ／3,000〜10,000円＝ちょっといいもの／10,000〜20,000円＝ご褒美・プレミアム／20,000〜30,000円＝高級・特別なギフト。1つの企画で混ぜても、1つに絞ってもよい
- 渡された「今の季節・行事」を使ってよい。発掘の方向（angle）は premium（高級感・価格に見合う価値）／value（高級品に迫る高コスパ）／classic（定番）／new（新商品）／preorder（予約商品）／season（季節商品）／gift（ギフト需要）から1つ
- 「最近の企画」「社長が却下した企画」と同じ・似たテーマは出さない。「社長が採用した企画」の方向は参考にしてよい（同じテーマの繰り返しは不可）
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
  const custom = String(ctx.env.V2_THEMES || '').split(/[,、]/).map((t) => t.trim()).filter(Boolean); // 探すテーマを固定したいとき（環境変数）
  const sets = (await ctx.kv.getJson(K.sets)) || [];
  const adopted = sets.filter((x) => x.status === 'adopted' || x.status === 'posted').slice(0, 8).map((x) => x.title);
  const rejected = sets.filter((x) => x.status === 'rejected').slice(0, 8).map((x) => x.title);
  const m = new Date(Date.now() + 9 * 3600000);
  const user = [`今日: ${m.getUTCMonth() + 1}月${m.getUTCDate()}日`, `今の季節・行事: ${seasonWords().join('・')}`, custom.length ? `社長が決めた探すテーマ（この中から）: ${custom.join('・')}` : `テーマの例: ${THEMES.join('・')}`,
    `最近の企画（避ける）: ${recent.map((x) => x.theme).join('・') || 'なし'}`, `社長が採用した企画: ${adopted.join('・') || 'なし'}`, `社長が却下した企画（避ける）: ${rejected.join('・') || 'なし'}`, leads.length ? `広報が交流先で見つけたブランド・話題（参考。合うなら1つを使い、使ったら lead にその番号を入れる）: ${leads.map((l, i) => `[${i + 1}] ${l.topic}`).join('・')}` : '', job.data.avoid ? `今回は次と違うものにする: ${job.data.avoid}` : ''].filter(Boolean).join('\n');
  let d;
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: ctx.startedAt + 30000, system: PROPOSE_PROMPT, userContent: user, parse: (c) => { const x = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]); if (!x.theme || !x.keyword) throw new Error('企画が空でした'); return x; } });
    d = result;
  } catch (e) { return { fail: `企画を考えられなかった：${String(e.message || e).slice(0, 80)}` }; }
  const theme = String(d.theme).slice(0, 30), keyword = String(d.keyword).slice(0, 30);
  await bump(ctx.kv, { proposals: 1 });
  const dup = recent.slice(0, 20).find((x) => similar(x.theme, theme) || normTheme(x.keyword) === normTheme(keyword)) || rejected.find((t) => similar(t, theme));
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
  list = list.slice(0, 10).map((it, n) => ({ ...it, ref: `R${n + 1}` }));
  if (!list.length) { job.data.noHit = (job.data.noHit || 0) + 1; if (job.data.noHit > MAX_REFIND) return { fail: `企画を${job.data.noHit}回変えても、条件に合う商品が見つからなかった`, final: true }; job.data.avoid = `${theme}（商品が見つからなかった）`; job.data.theme = ''; job.data.keyword = ''; return { done: `「${keyword}」で条件に合う商品が見つからなかったので、企画に差し戻す`, next: 'propose', what: '別の企画' }; }
  const lines = list.map((it) => `${it.ref}: ${compact(it.name, 80)} / ${it.price}円（${bandOf(it.price)}） / レビュー${it.reviewCount}件（平均${it.reviewAverage}） / 説明: ${compact(it.caption, 150)}`).join('\n');
  let pick = null;
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: ctx.startedAt + 40000, system: HERO_PROMPT, userContent: `テーマ: ${theme}（${ang.label}）${job.data.target ? `\n企画の対象: ${job.data.target}` : ''}${job.data.aim ? `\n企画の狙い: ${job.data.aim}` : ''}\n${lines}`, parse: (c) => { const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]); const it = list.find((x) => x.ref === String(d.ref || '').trim()); if (!it) throw new Error('選んだ商品が検索結果にありません'); return { it, who: String(d.who || '').slice(0, 40), problem: String(d.problem || '').slice(0, 60), whyNow: String(d.whyNow || '').slice(0, 60), reason: EQUIV_RE.test(String(d.reason || '')) ? '' : String(d.reason || '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 80) }; } });
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
  const d = take(job, await P.planStep({ source, history: [], recentPatterns: job.data.recentPatterns || [], env: ctx.env, startedAt: ctx.startedAt }));
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
  // AIの選んだ商品が3点に届かないとき（重複を外した等）は、集めた候補から重複しない商品をレビューの多い順に補う（説明はその商品データの言葉だけ）
  if (d.set.items.length < MIN_ITEMS) {
    const have = new Set(d.set.items.map((it) => it.code));
    const pool = [];
    g.slotResults.forEach((sl, si) => sl.candidates.forEach((c) => { if (c.code && !have.has(c.code) && c.image && c.url) pool.push({ slot: si, item: c }); }));
    pool.sort((a, b) => (Number(b.item.reviewCount) || 0) - (Number(a.item.reviewCount) || 0));
    for (const p of pool) {
      if (d.set.items.length >= MIN_ITEMS) break;
      if (have.has(p.item.code)) continue;
      have.add(p.item.code);
      const feature = P.factPhrases(p.item, { max: 30 })[0] || short(p.item.name);
      d.set.items.push({ ...toItem({ slot: p.slot, item: p.item, feature, why: '' }, (job.data.plan.slots[p.slot] || {}).role || '候補', new Date()), filledBy: 'program' });
    }
    d.set.issues = qualityCheck(d.set);
  }
  if (d.set.issues.length) return { fail: `商品が3点そろわなかった（${d.set.issues.join('／').slice(0, 80)}）` };
  job.data.set = d.set; delete job.data.gathered;
  return { done: `${d.set.items.length}点の商品をそろえた`, next: 'copy', what: '文章' };
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

// ---- デザイナー：表紙画像（画像の予算を使い切っていたら、画像待ちにして翌日続きから） ----
async function scene(job, ctx) {
  const d = take(job, await C.sceneStep({ set: job.data.set, history: await C.sceneHistory(ctx.kv), env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  if (d.skip) return { fail: `場面を決められなかった（${d.skip}）`, final: d.retry === false };
  job.data.cover = { scene: d.scene, item: d.item, tries: 0 };
  return { done: `場面を決めた（${String(d.scene.place).slice(0, 20)}・${String(d.scene.usage || d.scene.action).slice(0, 30)}）`, next: 'image' };
}
async function image(job, ctx) {
  const trial = await trialOn(ctx.kv, ctx.env);
  const ib = await imageCheck(ctx.kv, ctx.env, { trial });
  if (!ib.ok) return { wait: `画像の予算（${ib.reason}）。予算に余裕ができたら、続きから描きます` };
  const cv = job.data.cover;
  const d = await C.imageStep({ kv: ctx.kv, env: ctx.env, origin: ctx.origin, scene: cv.scene, item: cv.item, startedAt: ctx.startedAt, trial });
  if (d.run) job.runs.push({ ...d.run, yen: 0 }); // 画像の費用は画像の予算で数える（記録には残す）
  if (d.skip) return { wait: `画像を描けなかった（${d.skip}）。次の機会に続きから描きます` };
  cv.tries += 1;
  if (!d.ok) return { fail: d.error };
  cv.mediaId = await C.saveMedia(ctx.kv, d.b64); cv.costYen = d.cost.yen; cv.model = d.model;
  return { done: '表紙画像を描いた', next: 'checkImage', what: '画像の確認' };
}
async function checkImage(job, ctx) {
  const cv = job.data.cover;
  const b64 = await C.getMedia(ctx.kv, cv.mediaId);
  if (!b64) return { fail: '描いた画像が見つからない' };
  const { MASTERS } = await import('../kuma-master-manifest.js');
  const master = MASTERS.find((m) => m.kind === 'front') || MASTERS[0];
  const d = take(job, await C.checkStep({ b64, masterUrl: new URL(`/assets/kuma-master/${master.file}`, ctx.origin).toString(), productUrl: cv.item.image, scene: cv.scene, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  if (d.check.pass) {
    job.data.set.coverImage = { status: 'ok', mediaId: cv.mediaId, scene: cv.scene, item: cv.item.name, label: 'AI生成イメージ', model: cv.model, costYen: cv.costYen, at: now() };
    await C.pushScene(ctx.kv, cv.scene);
    return { done: '画像を確認した（問題なし）', next: 'pack', what: '仕上げ' };
  }
  job.data.imageNg = d.check.ng;
  return { wait: `画像に直したい点があった（${d.check.ng.slice(0, 3).map((k) => C.CHECK_LABEL[k] || k).join('・')}）。${(await trialOn(ctx.kv, ctx.env)) ? '次の定期実行で描き直します' : '画像の予算に余裕があれば、次の定期実行で描き直します'}`, back: 'image' };
}


// ---- 編集：投稿全体の整合性（価格・商品数・PR表記・紹介文の数。コード・0円）。問題があれば編集で直す ----
async function review(job, ctx = { env: process.env }) {
  const s = job.data.set;
  const check = P.codeCheck(s);
  const issues = check.checks.filter((k) => k.hard && k.ok === false).map((k) => `${k.label}（${k.detail}）`);
  const eq = [((s.copy || {}).body) || '', ...(s.roomTexts || []).map((x) => x.intro || '')].map((t) => (String(t).match(EQUIV_RE) || [])[0]).filter(Boolean);
  if (eq.length) issues.push(`確認できない「高級品と同等」の断定（${eq[0]}）。商品データにある事実の言い方に直す`);
  if ((s.roomTexts || []).length !== s.items.length) issues.push(`ROOM紹介文の数（${(s.roomTexts || []).length}）と商品の数（${s.items.length}）が合わない`);
  if (!issues.length) return { done: `全体を確認した（商品${s.items.length}点・価格・PR表記・紹介文の数がそろっている）`, next: job.kind === 'fix' || !C.aiImageEnabled(ctx.env) ? 'pack' : 'scene', what: job.kind === 'fix' || !C.aiImageEnabled(ctx.env) ? '仕上げ（表紙画像は社長が追加）' : '表紙画像' };
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
    dev: { audits: job.data.audits || [], yen: yenOf(job.runs), imageYen: (cover && cover.costYen) || 0, scene: cover ? cover.scene : null }
  };
  await ctx.kv.setJson(K.set(out.id), { ...out, raw: s });
  const list = ((await ctx.kv.getJson(K.sets)) || []).filter((x) => x.id !== out.id);
  await ctx.kv.setJson(K.sets, [{ id: out.id, title: out.title, status: 'waiting', deliveredAt: out.deliveredAt, image: out.image ? out.image.url : '', unverified: d.products.filter((p) => p.unverified).length }, ...list].slice(0, 80));
  await ctx.kv.setJson(K.used, [...new Set([...s.items.map((it) => it.code), ...((await ctx.kv.getJson(K.used)) || [])])].slice(0, 800));
  if (job.kind !== 'fix') await bump(ctx.kv, { delivered: 1, yen: yenOf(job.runs) + (Number(cover && cover.costYen) || 0), products: d.products.length, verifiedProducts: d.products.filter((p) => !p.unverified).length });
  await ctx.kv.pushJson(K.notices, { at: now(), id: out.id, title: out.title, fix: job.kind === 'fix' }, 30);
  return { done: `ハッシュタグ${d.tags.length}個・投稿の順番・注意事項をそろえた`, deliver: `社長に完成品「${s.title}」を届けた${job.kind === 'fix' ? '（修正版）' : ''}` };
}

const RUN = { propose, find: findHero, checkHero, plan, gather, pick, copy, room, auditText, edit, review, scene, image, checkImage, pack };
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
  const active = cases.filter((c) => !c.wait || c.wait.kind === 'retry' || c.wait.kind === 'budget' || c.wait.kind === 'quota');
  const imgWait = cases.filter((c) => c.wait && c.wait.kind === 'image');
  if (active.length >= MAX_ACTIVE) return `進行中の案件が${active.length}件（上限${MAX_ACTIVE}件）`;
  if (imgWait.length >= MAX_IMAGE_WAIT) return `画像待ちの案件が${imgWait.length}件あるため、新しくは始めない（画像の予算が戻ったら続きを描く）`;
  const w = await waitingCount(kv);
  if (w >= MAX_WAITING) return `社長の確認待ちの完成品が${w}件あるため、新しくは始めない（見られない物に費用をかけない）`;
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

export async function tick({ kv, env, referer = '', origin = '', startedAt = Date.now(), trigger = '' }) {
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
        c.step = 'pack'; c.attempts = 0; if (c.wait && c.wait.kind !== 'budget') c.wait = null;
        await record(kv, { job: c.id, agent: 'designer', to: 'pr', type: 'handoff', text: '広報へ引き継ぎ（AIの画像生成を止めたので、表紙画像なしで仕上げる。表紙は社長がChatGPTで作って追加）', title: titleOf(c) });
      }
    }
    // 残高待ち：前の実行までに「残高不足」で再試行待ちになった案件は、失敗の回数を戻して残高待ちに移す（既存の案件を消さない）
    let quota = await kv.getJson(K.quota);
    for (const c of cases) {
      if (c.wait && c.wait.kind === 'retry' && isQuotaError(c.wait.why)) {
        c.wait = { kind: 'quota', why: 'OpenAIの残高がありません（残高が戻ったら続きから再開します）', at: now() }; c.attempts = 0;
        if (!quota) quota = { since: now(), until: now(), tries: 0 }; // すぐに1件だけ試して、残高が戻っているか確かめる
      }
    }
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
      const job = cases.filter((c) => !c.wait && STEPS[c.step] && !inflight.has(c.id) && free(STEPS[c.step].agent) && !(c.step === 'image' && elapsed() > 8000) && (!paid(c.step) || aiAllowed()))
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
          await record(kv, { job: job.id, agent: 'pr', type: 'deliver', text: r.deliver, set: job.data.setId || job.data.set.id, title });
          cases.splice(cases.indexOf(job), 1); w.final = 'deliver';
          for (const a of job.contrib) await staffBump(kv, a, { delivered: 1 }); // 完成品への貢献（この案件で工程を完成させた社員）
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
    // 確かめる1件に選んだが、ほかの案件で残高不足が分かったときは、残高待ちに戻す
    if (quota) { for (const c of cases) if (c.id === probeCase && !c.wait) c.wait = { kind: 'quota', why: 'OpenAIの残高がありません（残高が戻ったら続きから再開します）', at: now() }; await saveCasesNow(kv, cases); }
    health.board = board; health.boardAt = now();
    health.peak = peak; health.lanes = worked.slice(0, 20).map((x) => ({ lane: x.lane, from: x.from, to: x.to, agent: x.agent, step: x.step, side: !!x.side, final: x.final || '' }));
    if (worked.length) { out.worked = worked[worked.length - 1]; out.steps = worked.map((x) => `${x.agent}:${x.step}${x.final ? `:${x.final}` : ''}`); out.jobs = [...new Set(worked.filter((x) => x.job).map((x) => x.job))]; out.parallel = { peak, lanes: worked.map((x) => `L${x.lane} ${x.from}-${x.to}s ${x.agent}:${x.step}`) }; }
    if (!worked.length) out.idle = health.noStart || (cases.length ? `進行中の案件${cases.length}件はすべて待ち（${cases.map((c) => (c.wait ? c.wait.kind : c.step)).join('・')}）` : '今できる仕事はありません');
    out.board = board;
    out.quota = quota ? { since: quota.since, until: quota.until, tries: quota.tries } : null;
    await kv.setJson(K.health, health);
    { const t = await trialState(kv, env); const sp = await budgetSpent(kv); const isp = await imageSpent(kv); out.budget = { month: sp.month, dayAuto: sp.dayAuto, imageMonth: isp.month, imageToday: isp.dayYen, trial: t ? { start: t.start, end: t.end, base: t.base.spent, used: t.used, left: t.left } : null }; }
    out.cases = cases.map((c) => `「${titleOf(c)}」：${STEPS[c.step] ? STEPS[c.step].task : c.step}${c.wait ? `（${({ image: '画像待ち', budget: '予算待ち', retry: '再試行待ち', quota: '残高待ち' })[c.wait.kind]}）` : ''}`);
    out.waitingOwner = await waitingCount(kv);
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
  designer: 'AIの画像生成は停止中（表紙画像は社長がChatGPTで作って、完成品のページから追加する）',
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
export async function findWork(agent, { kv, env, elapsed = () => 0 }) {
  if (agent === 'editor') return (await memoWork(kv)) || { none: NONE.editor };
  if (agent === 'pr') return prWork(kv, env, { elapsed });
  if (agent === 'auditor') return (await prAuditWork(kv)) || (await recheckWork(kv)) || { none: `完成品の確かめ直しは${RECHECK_HOURS}時間ごと（今は必要な完成品が無い）。採点待ちのコメント案も無い` };
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
    else if (mine.some((v) => v.wait && v.wait.kind === 'retry')) status = 'error';
    else if (mine.some((v) => v.wait && (v.wait.kind === 'budget' || v.wait.kind === 'quota'))) status = 'budget';
    else if (mine.some((v) => v.wait && v.wait.kind === 'image')) status = 'wait';
    else if (approvals || waitingSets) status = 'approval';
    else if (lastEv && lastEv.type === 'handoff' && Date.now() - Date.parse(lastEv.at) < 10 * 60000) status = 'handoff';
    const cur = mine.find((v) => v.working) || mine.find((v) => !v.wait) || mine[0] || null;
    let doing = '';
    if (s.id === 'appraiser' && postRunning) doing = 'ポストに届いたスクショの商品を調べています';
    else if (sd) doing = sd.doing || sd.task;
    else if (cur && cur.working) doing = STEPS[cur.step].doing;
    else if (cur && cur.wait) doing = `${({ image: '画像待ち', budget: '予算待ち', retry: 'エラー・再試行待ち', quota: 'OpenAIの残高待ち' })[cur.wait.kind]}：${cur.wait.why}`;
    else if (cur) doing = `次の番：${cur.task}（次の定期実行で進めます）`;
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
  pub.products = (pub.products || []).map((p, i) => ({ ...p, code: p.code || (items[i] || {}).code || '', shortName: ((copy.items || [])[i] || {}).shortName || p.short, subline: ((copy.items || [])[i] || {}).subline || '', memo: ((copy.items || [])[i] || {}).memo || '', roomDone: !!(s.roomDone || {})[(items[i] || {}).code || p.code] }));
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
