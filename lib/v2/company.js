// サングラスくま株式会社 2.0（2026-11-15 基本設計・2026-11-16 24時間の自律運営に改修・docs/v2/design.md）
//   社長の指示を待たずに、7人のAI社員が自分で仕事を見つけ、工程ごとに引き継いで投稿セットを完成させ、社長に納品する。
//   - 案件（投稿セット1件）を最大3件まで並行して進める。各社員は1回の定期実行で1工程まで（抱えすぎない・AIを無制限に呼ばない）
//   - 工程ごとに「開始・完成・引き継ぎ・待ち・再試行・停止・納品」を出来事の記録（v2:events）に残す。画面はこの記録と案件の状態だけから作る
//   - 失敗は時間を空けて再試行（最大3回）。予算待ち・画像待ちは、予算が戻った回に自動で続きから進める
//   - 中身の処理は1.0で動作を確かめたもの（楽天の検索・企画・文章・監査・修正・表紙画像）を呼ぶ
import crypto from 'node:crypto';
import { searchPage, lookupItem } from '../rakuten.js';
import { runWithModels, compact, maskSecrets, NG_RE } from '../ai.js';
import { takeCalls } from '../ai-usage.js';
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
  { id: 'pr', name: '広報', job: 'ハッシュタグ・投稿順・仕上げ' }
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

export const MAX_ACTIVE = 3;       // 同時に進める案件（画像待ち・予算待ちを除く）
export const MAX_IMAGE_WAIT = 2;   // 画像待ちの案件がこの数なら、新しい案件は始めない（画像は1日1枚のため、文章だけ作ってもたまるだけ）
export const MAX_WAITING = 3;      // 社長の確認待ちの完成品がこの数なら、新しい案件は始めない（見られない物に費用をかけない）
export const MAX_TRIES = 3;        // 1つの工程のやり直し（時間を空けて）
export const RETRY_MIN = 15;       // やり直しまでの間隔（分）× 回数
export const MAX_EDITS = 2;        // 監査→編集の差し戻し
export const MAX_REFIND = 2;       // 監査→バイヤーの差し戻し（商品が買えない）
export const MAX_IMAGE_ROUNDS = 3; // 画像の描き直し（日をまたぐ）
export const AGENT_PER_TICK = 2;   // 1人の社員が1回の定期実行で進める工程の数（抱えすぎない・AIを呼びすぎない）
export const TICK_BUDGET_MS = 25000; // 1回の定期実行で工程を進める時間の目安（関数の上限60秒の内側）
const THEMES = ['デスクまわりの便利グッズ', 'キッチンの時短グッズ', '部屋の収納', '防災の備え', '在宅ワーク', '旅行・出張の便利グッズ', '掃除の道具', '睡眠・リラックス', 'スマホまわりの小物', '季節の家電'];
const ANGLES = { premium: { label: '高級感・価格に見合う価値', sort: '-reviewCount', minReviews: 3, minPrice: 5000, maxPrice: 30000 }, value: { label: '高級品に迫る高コスパ', sort: '-reviewCount', minReviews: 5, maxPrice: 12000 }, classic: { label: '定番', sort: '-reviewCount', minReviews: 5 }, new: { label: '新商品', sort: '-updateTimestamp', minReviews: 0, word: '新作' }, preorder: { label: '予約商品', sort: '-updateTimestamp', minReviews: 0, word: '予約' }, season: { label: '季節商品', sort: '-reviewCount', minReviews: 3 }, gift: { label: 'ギフト需要', sort: '-reviewCount', minReviews: 5, word: 'ギフト' } };

const K = {
  trial: 'v2:trial',
  cases: 'v2:cases', job: 'v2:job', events: 'v2:events', sets: 'v2:sets', set: (id) => `v2:set:${id}`, imagewait: 'v2:imagewait', fixq: 'v2:fixq', requests: 'v2:requests',
  used: 'v2:used', themes: 'v2:themes', themeIdx: 'v2:themeIdx', sales: 'v2:sales', active: 'v2:active', lock: 'worker:lock', health: 'v2:health', metrics: 'v2:metrics', notices: 'v2:notices'
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

// ---- 成果の数字（AIを呼んだ回数ではなく、完成品・品質・重複・費用） ----
async function bump(kv, patch) {
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
出力形式: {"theme":"テーマ（20字以内）","keyword":"楽天の検索語","angle":"classic","target":"誰に（30字以内）","aim":"狙い：どんな悩みを解決し、なぜ今か（60字以内）"}`;
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
  const custom = String(ctx.env.V2_THEMES || '').split(/[,、]/).map((t) => t.trim()).filter(Boolean); // 探すテーマを固定したいとき（環境変数）
  const sets = (await ctx.kv.getJson(K.sets)) || [];
  const adopted = sets.filter((x) => x.status === 'adopted' || x.status === 'posted').slice(0, 8).map((x) => x.title);
  const rejected = sets.filter((x) => x.status === 'rejected').slice(0, 8).map((x) => x.title);
  const m = new Date(Date.now() + 9 * 3600000);
  const user = [`今日: ${m.getUTCMonth() + 1}月${m.getUTCDate()}日`, `今の季節・行事: ${seasonWords().join('・')}`, custom.length ? `社長が決めた探すテーマ（この中から）: ${custom.join('・')}` : `テーマの例: ${THEMES.join('・')}`,
    `最近の企画（避ける）: ${recent.map((x) => x.theme).join('・') || 'なし'}`, `社長が採用した企画: ${adopted.join('・') || 'なし'}`, `社長が却下した企画（避ける）: ${rejected.join('・') || 'なし'}`, job.data.avoid ? `今回は次と違うものにする: ${job.data.avoid}` : ''].filter(Boolean).join('\n');
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
  return { done: `企画「${theme}」を提案した（${ANGLES[job.data.angle].label}・${job.data.target || '対象未定'}）`, next: 'find', what: '主役の商品' };
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
  if (!ib.ok) return { wait: `画像の予算（${ib.reason}）。明日、続きから描きます` };
  const cv = job.data.cover;
  const d = await C.imageStep({ kv: ctx.kv, env: ctx.env, origin: ctx.origin, scene: cv.scene, item: cv.item, startedAt: ctx.startedAt, trial });
  if (d.run) job.runs.push({ ...d.run, yen: 0 }); // 画像の費用は画像の予算で数える（記録には残す）
  if (d.skip) return { wait: `画像を描けなかった（${d.skip}）。明日、続きから描きます` };
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
  return { wait: `画像に直したい点があった（${d.check.ng.slice(0, 3).map((k) => C.CHECK_LABEL[k] || k).join('・')}）。明日、描き直します`, back: 'image' };
}


// ---- 編集：投稿全体の整合性（価格・商品数・PR表記・紹介文の数。コード・0円）。問題があれば編集で直す ----
async function review(job) {
  const s = job.data.set;
  const check = P.codeCheck(s);
  const issues = check.checks.filter((k) => k.hard && k.ok === false).map((k) => `${k.label}（${k.detail}）`);
  const eq = [((s.copy || {}).body) || '', ...(s.roomTexts || []).map((x) => x.intro || '')].map((t) => (String(t).match(EQUIV_RE) || [])[0]).filter(Boolean);
  if (eq.length) issues.push(`確認できない「高級品と同等」の断定（${eq[0]}）。商品データにある事実の言い方に直す`);
  if ((s.roomTexts || []).length !== s.items.length) issues.push(`ROOM紹介文の数（${(s.roomTexts || []).length}）と商品の数（${s.items.length}）が合わない`);
  if (!issues.length) return { done: `全体を確認した（商品${s.items.length}点・価格・PR表記・紹介文の数がそろっている）`, next: job.kind === 'fix' ? 'pack' : 'scene', what: job.kind === 'fix' ? '仕上げ' : '表紙画像' };
  if ((job.data.edits || 0) < MAX_EDITS) { job.data.lastAudit = { check, audit: { fixes: issues.map((t) => ({ target: 'caption', text: t })), summary: issues.join('／'), flags: {} } }; return { done: `直す所を見つけた（${issues[0].slice(0, 40)}）`, next: 'edit', what: '整合性の修正' }; }
  return { fail: `全体の整合性がそろわなかった（${issues[0].slice(0, 60)}）`, final: true };
}

// ---- 広報：投稿の準備をそろえて納品する（ハッシュタグ・投稿の順番・本命と代替の比較・注意事項。コード） ----
export function buildDelivery(job) {
  const s = job.data.set;
  const hero = s.items[0];
  const verified = (it, i) => (i === 0 && job.data.hero && job.data.hero.checkedAt ? `楽天で再確認済み（${job.data.hero.checkedAt.slice(0, 16).replace('T', ' ')}）` : it.priceNote ? `未確認：${it.priceNote}` : it.priceCheckedAt ? `楽天の検索結果で確認（${String(it.priceCheckedAt).slice(0, 16).replace('T', ' ')}）` : '未確認（価格を確かめた日時が無い）');
  const products = s.items.map((it, i) => ({
    role: i === 0 ? '本命' : '代替・比較', band: bandOf(Number(it.price) || 0), name: it.name, short: short(it.name), price: it.price, url: it.url, image: it.image, shop: it.shop,
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
    '表紙画像はAIで作ったイメージです。投稿では「AI生成イメージ」と分かるようにしてください（実際に使った写真ではありません）',
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
  if (!s.coverImage || s.coverImage.status !== 'ok') return { fail: '表紙画像が無い', final: true };
  const d = buildDelivery(job);
  const plan = job.data.plan || {};
  const out = {
    id: job.data.setId || s.id, title: s.title, theme: job.data.theme || '', aim: job.data.aim || plan.reason || plan.appeal || '', target: job.data.target || s.target || '',
    who: (job.data.hero || {}).who || s.target || '', problem: (job.data.hero || {}).problem || '', whyNow: (job.data.hero || {}).whyNow || '',
    pickReason: (job.data.hero || {}).reason || '', band: (job.data.hero || {}).band || '', caption: cap, products: d.products, compare: d.compare, hashtags: d.tags, notes: d.notes, order: d.order,
    image: { mediaId: s.coverImage.mediaId, url: `/api/media?id=${s.coverImage.mediaId}`, label: 'AI生成イメージ' },
    status: 'waiting', deliveredAt: now(), jobId: job.id, revisions: (job.data.revisionCount || 0) + (job.kind === 'fix' ? 1 : 0), ownerNote: job.data.ownerNote || '',
    dev: { audits: job.data.audits || [], yen: yenOf(job.runs), imageYen: s.coverImage.costYen || 0, scene: s.coverImage.scene }
  };
  await ctx.kv.setJson(K.set(out.id), { ...out, raw: s });
  const list = ((await ctx.kv.getJson(K.sets)) || []).filter((x) => x.id !== out.id);
  await ctx.kv.setJson(K.sets, [{ id: out.id, title: out.title, status: 'waiting', deliveredAt: out.deliveredAt, image: out.image.url, unverified: d.products.filter((p) => p.unverified).length }, ...list].slice(0, 80));
  await ctx.kv.setJson(K.used, [...new Set([...s.items.map((it) => it.code), ...((await ctx.kv.getJson(K.used)) || [])])].slice(0, 800));
  if (job.kind !== 'fix') await bump(ctx.kv, { delivered: 1, yen: yenOf(job.runs) + (Number(s.coverImage.costYen) || 0), products: d.products.length, verifiedProducts: d.products.filter((p) => !p.unverified).length });
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
  const active = cases.filter((c) => !c.wait || c.wait.kind === 'retry' || c.wait.kind === 'budget');
  const imgWait = cases.filter((c) => c.wait && c.wait.kind === 'image');
  if (active.length >= MAX_ACTIVE) return `進行中の案件が${active.length}件（上限${MAX_ACTIVE}件）`;
  // 画像は1日の枚数が決まっているため、進行中と画像待ちを合わせて上限まで（文章だけ先に作っても、納品まで何日もたまるだけ。2026-11-16 本番で3件が画像待ちになった）
  if (active.length + imgWait.length >= MAX_ACTIVE) return `進行中${active.length}件・画像待ち${imgWait.length}件（合わせて上限${MAX_ACTIVE}件）。先に今の案件を完成させる`;
  if (imgWait.length >= MAX_IMAGE_WAIT) return `画像待ちの案件が${imgWait.length}件あるため、新しくは始めない（画像の予算が戻ったら続きを描く）`;
  const w = await waitingCount(kv);
  if (w >= MAX_WAITING) return `社長の確認待ちの完成品が${w}件あるため、新しくは始めない（見られない物に費用をかけない）`;
  return '';
}

// ---- 1回の定期実行：予定どおり再開 → 新しい仕事を自分で始める → 時間の許す限り、各社員が1工程ずつ進める ----
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
    for (const c of cases) {
      if (!c.wait) continue;
      const k = c.wait.kind;
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
    // 3. 新しい仕事を自分で始める（社長の指定テーマがあれば優先）
    const why = await canStart(kv, env, cases);
    if (!why && b0.ok) {
      const reqs = (await kv.getJson(K.requests)) || [];
      const req = reqs.shift() || null;
      if (req) await kv.setJson(K.requests, reqs);
      const c = { id: newId('job'), kind: 'make', step: 'propose', createdAt: now(), attempts: 0, runs: [], wait: null, data: req ? { request: req } : {} };
      cases.push(c);
      await bump(kv, { started: 1 });
      await record(kv, { job: c.id, agent: 'planner', type: 'start', text: req ? `社長の指定（${req.text || '商品の指定'}）で新しい案件を始めた` : '社長の指示を待たずに、新しい案件を始めた', title: '新しい企画' });
    } else if (why) health.noStart = why;
    if (!why) delete health.noStart;
    await saveCases(kv, cases);
    // 4. 進める：各社員は1回の実行で2工程まで（抱えすぎない）。完成に近い案件から。画像（時間がかかる）は回の始めにだけ
    const busy = {};
    for (let n = 0; n < 14; n++) {
      if (n > 0 && Date.now() - startedAt > TICK_BUDGET_MS) break;
      const order = [...cases].filter((c) => !c.wait && STEPS[c.step] && (busy[STEPS[c.step].agent] || 0) < AGENT_PER_TICK && !(c.step === 'image' && n > 0 && Date.now() - startedAt > 4000))
        .sort((a, b) => (a.kind === 'fix' ? -1 : 0) - (b.kind === 'fix' ? -1 : 0) || FLOW.indexOf(b.step) - FLOW.indexOf(a.step)); // 完成に近い案件から（画像の確認・納品を後回しにしない。画像を描く工程は回の始めにだけ）
      const job = order[0];
      if (!job) break;
      const st = STEPS[job.step];
      let bc = await budgetCheck(kv, env, { estimate: Math.max(0.01, st.est), auto: !inTrial });
      if (bc.ok) { const ta = await trialAllows(kv, env, job.step === 'image' ? IMAGE_ESTIMATE_YEN : Math.max(0.01, st.est)); if (!ta.ok) bc = ta; }
      if (!bc.ok) { job.wait = { kind: 'budget', why: bc.reason, at: now() }; health.blocked = bc.reason; await record(kv, { job: job.id, agent: st.agent, type: 'budget', text: `${String(bc.reason || '予算の上限').replace(/ため.*$/, '')}ため、「${titleOf(job)}」は予算が戻ったら続ける`, title: titleOf(job) }); await saveCases(kv, cases); break; }
      delete health.blocked;
      busy[st.agent] = (busy[st.agent] || 0) + 1;
      job.current = { step: job.step, agent: st.agent, doing: st.doing, at: now() };
      await saveCases(kv, cases); // 画面に「今この社員がこの仕事をしている」と出すため、始める前に保存
      const before = job.runs.length;
      const agent = st.agent;
      const ctx = { kv, env, referer, origin, startedAt };
      let r;
      try { r = await RUN[job.step](job, ctx); } catch (e) { r = { fail: String(e && e.message || e).slice(0, 200) }; }
      job.runs.push(...takeCalls().map((c) => ({ ...c, role: agent })));
      const yen = yenOf(job.runs.slice(before));
      await budgetRecord(kv, yen, { auto: true });
      delete job.current; job.updatedAt = now();
      const w = { job: job.id, step: job.step, agent, yen };
      worked.push(w);
      const title = titleOf(job);
      if (r.fail) {
        job.attempts = (job.attempts || 0) + 1;
        if (job.attempts >= MAX_TRIES || r.final) {
          await record(kv, { job: job.id, agent, type: 'stop', text: `止まった：${r.fail}`, dev: r.dev || r.fail, title });
          cases.splice(cases.indexOf(job), 1); w.final = 'stop';
          if (job.kind !== 'fix') await bump(kv, { stopped: 1, yenStopped: yenOf(job.runs) });
        } else {
          const mins = r.quick ? 0 : RETRY_MIN * job.attempts;
          job.wait = mins ? { kind: 'retry', until: new Date(Date.now() + mins * 60000).toISOString(), why: r.fail } : null;
          await record(kv, { job: job.id, agent, type: 'retry', text: mins ? `うまくいかなかったので、${mins}分後にやり直す（${r.fail}）` : `やり直す（${r.fail}）`, dev: r.dev || r.fail, title });
        }
      } else if (r.wait) {
        job.step = r.back || job.step; job.data.imageRounds = (job.data.imageRounds || 0) + 1; job.attempts = 0;
        if (job.data.imageRounds > MAX_IMAGE_ROUNDS) { await record(kv, { job: job.id, agent, type: 'stop', text: `止まった：画像が${MAX_IMAGE_ROUNDS}日続けて完成しなかった`, title }); cases.splice(cases.indexOf(job), 1); w.final = 'stop'; await bump(kv, { stopped: 1, yenStopped: yenOf(job.runs) }); }
        else { job.data.waitWhy = r.wait; job.wait = { kind: 'image', why: r.wait, at: now() }; await record(kv, { job: job.id, agent, type: 'wait', text: r.wait, title }); w.final = 'wait'; }
      } else {
        await record(kv, { job: job.id, agent, type: 'done', text: r.done, yen: yen || undefined, title });
        job.attempts = 0;
        if (r.deliver) {
          await record(kv, { job: job.id, agent: 'pr', type: 'deliver', text: r.deliver, set: job.data.setId || job.data.set.id, title });
          cases.splice(cases.indexOf(job), 1); w.final = 'deliver';
        } else {
          await handoff(kv, job, STEPS[r.next].agent, r.what);
          job.step = r.next;
        }
      }
      await saveCases(kv, cases);
    }
    if (worked.length) { out.worked = worked[worked.length - 1]; out.steps = worked.map((x) => `${x.agent}:${x.step}${x.final ? `:${x.final}` : ''}`); out.jobs = [...new Set(worked.map((x) => x.job))]; }
    if (!worked.length) out.idle = health.noStart || (cases.length ? `進行中の案件${cases.length}件はすべて待ち（${cases.map((c) => (c.wait ? c.wait.kind : c.step)).join('・')}）` : '今できる仕事はありません');
    await kv.setJson(K.health, health);
    // 定期実行の記録（GitHub Actions）でも流れが分かるように：案件の状態と直近の出来事（開発者向けの記録・画像のID・鍵は付けない）
    { const t = await trialState(kv, env); const sp = await budgetSpent(kv); const isp = await imageSpent(kv); out.budget = { month: sp.month, dayAuto: sp.dayAuto, imageMonth: isp.month, imageToday: isp.dayYen, trial: t ? { start: t.start, end: t.end, base: t.base.spent, used: t.used, left: t.left } : null }; }
    out.cases = cases.map((c) => `「${titleOf(c)}」：${STEPS[c.step] ? STEPS[c.step].task : c.step}${c.wait ? `（${({ image: '画像待ち', budget: '予算待ち', retry: '再試行待ち' })[c.wait.kind]}）` : ''}`);
    out.recent = ((await kv.listJson(K.events, 12)) || []).map((e) => `${new Date(Date.parse(e.at) + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ')}${e.via ? `［${e.via}］` : ''} ${staffName(e.agent)}${e.to ? `→${staffName(e.to)}` : ''}：${e.text}`);
    return out;
  } finally {
    currentTrigger = '';
    await kv.delIf(K.lock, token).catch(() => {});
  }
}

// ---- 社長の画面に渡す状態（点数・技術ログは渡さない） ----
//   社員の状態：work（今この瞬間に処理中）／turn（担当中：自分の工程の案件がある）／handoff（引き継ぎ中：直前に次の部署へ渡した）
//   ／error（エラー：再試行待ち）／budget（予算待ち）／wait（画像待ち）／idle（待機）
export async function officeState(kv, env) {
  const [cases0, events, sets, health, active, sales, metrics, reqs, notices] = await Promise.all([kv.getJson(K.cases), kv.listJson(K.events, 200), kv.getJson(K.sets), kv.getJson(K.health), kv.get(K.active), kv.getJson(K.sales), kv.getJson(K.metrics), kv.getJson(K.requests), kv.listJson(K.notices, 10)]);
  const cases = Array.isArray(cases0) ? cases0 : [];
  const evs = (events || []).map(({ dev, ...e }) => e);
  const lastOf = (agent) => evs.find((e) => e.agent === agent && (e.type === 'done' || e.type === 'deliver'));
  const caseView = (c) => ({ id: c.id, title: titleOf(c), kind: c.kind, step: c.step, task: STEPS[c.step] ? STEPS[c.step].task : c.step, agent: STEPS[c.step] ? STEPS[c.step].agent : '', next: nextOf(c.step) ? STEPS[nextOf(c.step)].task : '', nextAgent: nextOf(c.step) ? staffName(STEPS[nextOf(c.step)].agent) : '', wait: c.wait ? { kind: c.wait.kind, why: c.wait.why || '', until: c.wait.until || '' } : null, working: !!c.current, createdAt: c.createdAt || '' });
  const views = cases.map(caseView);
  const staff = STAFF.map((s) => {
    const mine = views.filter((v) => v.agent === s.id);
    const last = lastOf(s.id);
    const lastEv = evs.find((e) => e.agent === s.id);
    let status = 'idle';
    if (mine.some((v) => v.working)) status = 'work';
    else if (mine.some((v) => !v.wait)) status = 'turn';
    else if (mine.some((v) => v.wait && v.wait.kind === 'retry')) status = 'error';
    else if (mine.some((v) => v.wait && v.wait.kind === 'budget')) status = 'budget';
    else if (mine.some((v) => v.wait && v.wait.kind === 'image')) status = 'wait';
    else if (lastEv && lastEv.type === 'handoff' && Date.now() - Date.parse(lastEv.at) < 10 * 60000) status = 'handoff';
    const cur = mine.find((v) => v.working) || mine.find((v) => !v.wait) || mine[0] || null;
    const doing = !cur ? (status === 'handoff' ? `「${lastEv.title || ''}」を${staffName(lastEv.to)}へ引き継いだところ` : '') : cur.working ? STEPS[cur.step].doing : cur.wait ? `${({ image: '画像待ち', budget: '予算待ち', retry: 'エラー・再試行待ち' })[cur.wait.kind]}：${cur.wait.why}` : `次の番：${cur.task}（次の定期実行で進めます）`;
    return { ...s, status, doing, cases: mine.map((v) => ({ title: v.title, task: v.task, wait: v.wait, next: v.next, nextAgent: v.nextAgent })), title: cur ? cur.title : '', last: last ? { at: last.at, text: last.text, title: last.title || '' } : null, next: cur && cur.next ? `${cur.nextAgent}：${cur.next}` : '' };
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
    drafts, stopped, trial: tr,
    at: now(), active: active === '1', staff, cases: views,
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
export async function getSet(kv, id) { const s = await kv.getJson(K.set(String(id).replace(/[^\w.:-]/g, ''))); if (!s) return null; const { raw, dev, ...pub } = s; return pub; }

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
