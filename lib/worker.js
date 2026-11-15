// 自律運営のワーカー（2026-11-14）：アプリを閉じていても、AI社員が定期的に仕事を進める。
// 定期実行（GitHub Actions：15分ごと／Vercel Cron：1日1回の予備）が /api/worker を呼ぶたびに、仕事を「1段階だけ」進めて保存する（1回60秒以内）。
// 守ること：
//  - 二重実行の防止：保存場所の鍵（worker:lock、58秒で自然に外れる）を取れたときだけ動く
//  - 無限ループの防止：1回1段階・修正は最大2回・1つの仕事は最大10段階・24時間で打ち切り・1日の仕事の数に上限
//  - API障害：同じ段階は3回まで。連続3回失敗したら6時間休む（失敗の理由を記録して画面に出す）
//  - 費用：サーバー側で、月の上限（全体）と自律運営の1日の上限を確かめてから動き、実測の費用を記録する（lib/budget.js）
//  - 対外的な行動（投稿・コメント・フォロー・商品の採用）はしない。成果物を作って、社長の承認待ちにするだけ
// AI社員の仕事：バイヤーAI（楽天で探す→コードの確認→監査AI→修正）、営業・交流担当AI（文章を確認できた投稿へのコメント案→監査AI→修正）、
//   制作ライン（2026-11-16：監査AIが合格にした候補を、社長の確認なしで 企画担当AI→投稿セット制作AI→監査AI→制作担当AI へ渡し、合格した投稿セットを社長の確認待ちにする）
// 仕事探し：定期実行のたびに、各社員が未処理の仕事（合格候補・交流候補・テーマ）を見て、自分ができる仕事があるかを確かめる（worker:board に記録）。
//   優先順位（売上に近い順）：制作ライン → 営業・交流 → バイヤー。今日の自律運営の費用の残りが、その仕事の見込みより少なければ始めない
import crypto from 'node:crypto';
import { buyerStep, checkStep, auditStep, reviseStep, decide, MAX_REVISIONS } from './agents.js';
import { draftStep, auditStep as outreachAudit, checkComment, decide as outreachDecide } from './outreach.js';
import { check as budgetCheck, record as budgetRecord, jstDate, imageCheck } from './budget.js';
import { usableMasters } from './kuma-master.js';
import { summarize } from './ai-usage.js';
import * as P from './production.js';
import { chooseAngle, angleById, ACTIVE_ANGLES, chooseMotive, motiveById } from './buyer-angles.js';
import * as C from './kuma-cover.js';
import * as S from './store.js';
import { lookupItem } from './rakuten.js';
import { igConfig, recentMedia, accountInsights } from './ig-graph.js';

export const QUOTA = { production: 3, buyer: 8, rescue: 4, outreach: 3, inspect: 2, measure: 1, cover: 2 }; // 1日に始める仕事の数の安全上限。バイヤーAIは在庫（目標10件）と自律運営の1日の費用の上限で止まる（回数で止めるのが主ではない）
export const ESTIMATE = { production: 4, outreach: 2, buyer: 4, rescue: 3, inspect: 0, measure: 0, cover: 1 }; // 1つの仕事の費用の見込みの初期値（円）。実測の記録があれば estimates() がそちらを使う（点検・効果測定はAIを使わない）
// 段階ごとの見込み（途中の仕事を1段階進めるとき）：AIを呼ばない段階は0円、AIを1〜2回呼ぶ段階は STEP_ESTIMATE 円
export const STEP_ESTIMATE = 0.8; // 実測：AIを呼ぶ1段階は0.1〜0.77円（2026-11-15 本番の記録）
const NO_AI_STEPS = new Set(['gather', 'check', 'inspect', 'measure']);
export function stepEstimate(job) { return !job || NO_AI_STEPS.has(job.step) || job.type === 'inspect' || job.type === 'measure' ? 0 : STEP_ESTIMATE; }
// 制作のための取り置き（2026-11-15 社長の方針：合格商品があれば、新規探索や再審査より投稿セットの完成を優先）：
//   制作できる状態（合格候補あり・棚に空き・今日の上限内）なら、ほかのAIの仕事は「制作の見込み」を残せるときだけ始める。
//   合格候補がまだ無くても、RESERVE_UNTIL_HOUR 時（日本時間）までは制作1件分を取り置く（その日に合格が出たら、その日のうちに作れるように）
export const RESERVE_UNTIL_HOUR = 20;
const jstHour = (d = new Date()) => new Date(d.getTime() + 9 * 3600000).getUTCHours();
// 次に自律運営の予算が戻る時刻（日本時間の翌日0:00）
export function nextBudgetReset(d = new Date()) { const j = new Date(d.getTime() + 9 * 3600000); j.setUTCHours(24, 0, 0, 0); return new Date(j.getTime() - 9 * 3600000).toISOString(); }
export const TICK_MINUTES = 15;
export const OWNER_IDLE_DAYS = 7;   // 社長の判断がこの日数ないときは、制作を1日1件に落とす（見られないものに費用をかけない）
export const PUBLISH_ENV = ['IG_ACCESS_TOKEN', 'IG_USER_ID', 'IG_PUBLISH_ENABLED', 'BLOB_READ_WRITE_TOKEN']; // 公開（段階2）に必要な設定
// 合格候補（投稿セットにまだ使っていない合格候補）は、数で打ち切らずに蓄積する（2026-11-14 社長の方針：物の在庫ではなく、発掘した商品の蓄え）。
// バイヤーAIの仕事は、自律運営の1日の費用の残りで優先順位をつけて行う（制作の分を残す）。STOCK_TARGET は、これより少ないときに優先して探す目安
export const STOCK_TARGET = 10;
export const STOCK_KEEP = 60; // 記録を残すバイヤーAIの仕事の回数（保存場所の容量のため）
export const MAX_CANDIDATE_TRIES = 2; // 文章が保留・不合格になった投稿セットに入っていた候補を、別の投稿セットで使い直せる回数
export const MAX_BACKLOG = STOCK_TARGET;
export const MAX_PENDING_SETS = 6;  // 社長の確認待ちの投稿セットがこれ以上あれば、新しく作らない（見られないものに費用をかけない）
export const MAX_PENDING_BUYER = MAX_BACKLOG; // 互換
const MAX_STEPS = 10;
const MAX_STEPS_PROD = 16; // 文章10段階まで＋表紙画像（場面・生成・確認、作り直し1回）
const MAX_ATTEMPTS = 3;
const PAUSE_MS = 6 * 3600000;
const JOB_TTL_MS = 24 * 3600000;
const K = { rescued: 'worker:rescued', tries: 'worker:candidate:tries', lessons: 'worker:buyer:lessons', coverWait: 'worker:cover:wait', lock: 'worker:lock', job: 'worker:job', health: 'worker:health', snap: 'worker:snapshot', log: 'worker:log', buyer: 'worker:results:buyer', outreach: 'worker:results:outreach', oruns: 'worker:runs:outreach', themeIdx: 'worker:themeIdx', prod: 'worker:results:production', used: 'worker:prod:used', board: 'worker:board', paused: 'worker:paused' };
const id = (p) => p + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
const now = () => new Date().toISOString();
const yenOf = (runs) => (runs || []).reduce((a, r) => a + (Number(r.yen) || 0), 0);

// ---- アプリから受け取る情報（社長のiPhoneの中のデータの要約。サーバーはこれを使って仕事を選ぶ） ----
const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
export function readSnapshot(b) {
  const x = b && typeof b === 'object' ? b : {};
  return {
    at: now(),
    themes: (Array.isArray(x.themes) ? x.themes : []).map((t) => s(t, 40)).filter(Boolean).slice(0, 12),
    avoid: (Array.isArray(x.avoid) ? x.avoid : []).map((t) => s(t, 80)).filter(Boolean).slice(0, 30),
    past: (Array.isArray(x.past) ? x.past : []).map((t) => s(t, 120)).filter(Boolean).slice(0, 50),
    outreachPosts: (Array.isArray(x.outreachPosts) ? x.outreachPosts : []).slice(0, 30).map((p) => ({ id: s(p && p.id, 40), url: s(p && p.url, 300), handle: s(p && p.handle, 40), caption: String(p && p.caption || '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 1000), source: s(p && p.source, 40) }))
      .filter((p) => p.id && /^https:\/\/www\.instagram\.com\/(p|reel)\//.test(p.url) && p.caption.length >= 5),
    pendingBuyer: Math.max(0, Math.min(99, Number(x.pendingBuyer) || 0)),
    auditModel: s(x.auditModel, 30),
    // 制作ラインが使う：社長の判断の履歴・直近の企画パターン・投稿セットに使った商品・社長が見送った商品・確認待ちの投稿セットの数
    history: (Array.isArray(x.history) ? x.history : []).slice(0, 30).map((e) => ({ status: s(e && e.status, 10), pattern: s(e && e.pattern, 20), title: s(e && e.title, 50), reason: s(e && e.reason, 100) })).filter((e) => e.status && e.title),
    recentPatterns: (Array.isArray(x.recentPatterns) ? x.recentPatterns : []).map((t) => s(t, 20)).filter(Boolean).slice(0, 5),
    setCodes: (Array.isArray(x.setCodes) ? x.setCodes : []).map((t) => s(t, 120)).filter(Boolean).slice(0, 600),
    skipCodes: (Array.isArray(x.skipCodes) ? x.skipCodes : []).map((t) => s(t, 120)).filter(Boolean).slice(0, 300),
    pendingSets: Math.max(0, Math.min(99, Number(x.pendingSets) || 0))
  };
}

async function log(kv, entry) { await kv.pushJson(K.log, { at: now(), ...entry }, 200); }

// 制作に渡す合格候補：監査の点数が高いものから、切り口が重ならないように選ぶ（同じような商品ばかりにならないように）
export function pickSource(stock, n) {
  const sorted = [...stock].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const out = [];
  for (const c of sorted) { if (out.length >= n) break; if (!out.some((x) => x.angle && x.angle === c.angle)) out.push(c); }
  for (const c of sorted) { if (out.length >= n) break; if (!out.includes(c)) out.push(c); }
  return out;
}

// バイヤーAIの成績（実行回数ではなく、合格候補の数・在庫・費用で見る）。直近10回の仕事から集計する（AIなし）
export async function buyerStats(kv, stock = null) {
  const sessions = ((await kv.listJson(K.buyer, 10)) || []);
  const count = { pass: 0, revise: 0, hold: 0, reject: 0, other: 0 };
  const reasons = {};
  const byAngle = {};
  let searched = 0, yen = 0, zero = 0;
  for (const sess of sessions) {
    searched += (sess.results || []).length;
    yen += yenOf(sess.runs);
    if (!(sess.candidates || []).length) zero += 1;
    for (const c of sess.candidates || []) {
      count[count[c.status] != null ? c.status : 'other'] += 1;
      const ag = ((c.versions[c.versions.length - 1] || {}).data || {}).angle || sess.angle || '不明';
      byAngle[ag] = byAngle[ag] || { candidates: 0, pass: 0 }; byAngle[ag].candidates += 1; if (c.status === 'pass') byAngle[ag].pass += 1;
      if (c.status === 'hold' || c.status === 'reject') { const k = String(c.why || '理由なし').replace(/[0-9]+点/g, 'N点').slice(0, 40); reasons[k] = (reasons[k] || 0) + 1; }
    }
  }
  const total = Object.values(count).reduce((a, b) => a + b, 0);
  return {
    sessions: sessions.length, stock, target: STOCK_TARGET, candidates: total, ...count, passRate: total ? Math.round((count.pass / total) * 100) : null,
    zeroSessions: zero, looked: searched, yen: Math.round(yen * 10) / 10, yenPerPass: count.pass ? Math.round((yen / count.pass) * 10) / 10 : null,
    byAngle,
    topReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([why, n]) => ({ why, n }))
  };
}

// ---- 仕事探し：各社員が、今ある未処理の仕事から自分ができるものを探す ----
// 投稿セットにまだ使っていない合格候補（新しい順）
export async function backlog(kv, snap) {
  const used = new Set((await kv.getJson(K.used)) || []);
  const skip = new Set([...(snap.setCodes || []), ...(snap.skipCodes || [])]);
  const out = [];
  const seen = new Set();
  // 整理（2026-11-15）より前に見つけた合格候補は使わない（記録は残す）
  const cutoff = (await kv.get('worker:stock:cutoff')) || '';
  for (const sess of (await kv.listJson(K.buyer, STOCK_KEEP)) || []) {
    if (cutoff && String(sess.at || '') < cutoff) continue;
    for (const c of sess.candidates || []) {
      if (c.status !== 'pass') continue;
      const v = c.versions[c.versions.length - 1];
      const d = v.data || {};
      if (!d.code || used.has(d.code) || skip.has(d.code) || seen.has(d.code)) continue;
      seen.add(d.code);
      out.push({ ...d, angle: d.angle || sess.angle || '', score: v.audit ? v.audit.total : null, sessionId: sess.id, candidateId: c.id });
    }
  }
  return out;
}
// ---- 仕事の切り替え（2026-11-15）：材料が無い・同じやり方で成果が出ないときに、ほかの価値ある仕事へ移るための材料 ----
// 候補の再審査：保留・修正しきれず不合格になった候補を、直した手順（修正で項目が消えない・監査の基準を明確化）でもう一度審査する。
//   新しく楽天を探すより安く合格候補を増やせる。1つの候補は1回だけ（同じ候補に何度も費用をかけない）
export const RESCUE_MAX = 3;
const RESCUABLE = (c) => c.status === 'hold' || (c.status === 'reject' && /修正\d+回でも|コードの確認で不合格：購入者|コードの確認で不合格：根拠の引用|根拠の捏造|未確認の断定/.test(String(c.why || '')) && !/却下を提案|情報源/.test(String(c.why || '')));
export async function rescuePool(kv, snap) {
  const done = new Set((await kv.getJson(K.rescued)) || []);
  const known = new Set([...((await kv.getJson(K.used)) || []), ...(snap.setCodes || []), ...(snap.skipCodes || []), ...(await backlog(kv, snap)).map((c) => c.code)]);
  const cutoff = (await kv.get('worker:stock:cutoff')) || '';
  let best = null;
  for (const sess of (await kv.listJson(K.buyer, STOCK_KEEP)) || []) {
    if (cutoff && String(sess.at || '') < cutoff) continue;
    if (sess.rescueOf) continue; // 再審査の結果をさらに再審査しない
    const list = (sess.candidates || []).filter((c) => RESCUABLE(c) && !done.has(`${sess.id}:${c.id}`)).filter((c) => { const d = (c.versions[c.versions.length - 1] || {}).data || {}; return d.code && !known.has(d.code); });
    if (list.length && (!best || list.length > best.list.length)) best = { sess, list: list.slice(0, RESCUE_MAX) };
  }
  return best;
}
// 今日のバイヤーAIの発掘（再審査を除く）が、最後から何回続けて合格0件か
export async function buyerDry(kv, date) {
  let n = 0;
  for (const sess of (await kv.listJson(K.buyer, 10)) || []) {
    if (sess.rescueOf) continue;
    if (sess.date !== date) break;
    if ((sess.candidates || []).some((c) => c.status === 'pass')) break;
    n += 1;
  }
  return n;
}
export const BUYER_DRY_STOP = 3;

async function startRescue(kv, jid, date, rp, snap) {
  const src = rp.sess;
  await kv.setJson(K.rescued, [...((await kv.getJson(K.rescued)) || []), ...rp.list.map((c) => `${src.id}:${c.id}`)].slice(-500)); // 始める前に印（失敗しても同じ候補をくり返さない）
  const candidates = rp.list.map((c) => ({ id: c.id, status: 'running', revisions: 0, rescuedFrom: { status: c.status, why: String(c.why || '').slice(0, 160) }, versions: [{ v: 1, data: (c.versions[c.versions.length - 1] || {}).data, at: now() }] }));
  return { id: jid, type: 'buyer', step: 'check', rescue: true, ids: candidates.map((c) => c.id), startedAt: now(), steps: 0, attempts: 0,
    session: { id: jid, origin: 'server', at: now(), date, theme: src.theme, angle: src.angle || '', rescueOf: src.id, auditModel: snap.auditModel || '', status: 'running', steps: [{ name: `候補の再審査：「${src.theme || ''}」の保留・不合格だった候補${candidates.length}件`, status: 'ok', startedAt: now(), endedAt: now() }], candidates, results: src.results || [], searched: [], runs: [], rakutenCalls: 0 } };
}

// 仕事ごとの費用の見込み：実測の記録（直近の完了した仕事5件）の最大の1.1倍（0.1円単位で切り上げ）。記録が無ければ初期値
const ceilTenth = (y) => Math.ceil(y * 10 - 1e-9) / 10;
export function estimateFrom(costs, fallback) {
  const xs = (costs || []).filter((y) => Number.isFinite(y) && y > 0).slice(0, 5);
  if (!xs.length) return fallback;
  return Math.max(1, ceilTenth(Math.max(...xs) * 1.1));
}
export async function estimates(kv) {
  const [prod, buyer, oruns] = await Promise.all([kv.listJson(K.prod, 10), kv.listJson(K.buyer, 15), kv.listJson(K.oruns, 10)]);
  const done = (r) => r && r.status !== 'running' && !r.error;
  const prodCosts = (prod || []).filter((r) => done(r) && !r.coverRetryOf).map((r) => yenOf(r.runs));
  const buyerCosts = (buyer || []).filter((s) => done(s) && !s.rescueOf && (s.candidates || []).length).map((s) => yenOf(s.runs));
  const rescueCosts = (buyer || []).filter((s) => done(s) && s.rescueOf).map((s) => yenOf(s.runs));
  const outCosts = (oruns || []).filter(done).map((r) => yenOf(r.runs));
  return {
    ...ESTIMATE,
    production: estimateFrom(prodCosts, ESTIMATE.production),
    buyer: estimateFrom(buyerCosts, ESTIMATE.buyer),
    rescue: estimateFrom(rescueCosts, ESTIMATE.rescue),
    outreach: estimateFrom(outCosts, ESTIMATE.outreach)
  };
}

// 仕事が始められないときの、短い理由と次の再開予定（画面のいちばん上に出す）
export function nextResume(items, { left, est, reserved, d = new Date() } = {}) {
  const work = items.find((x) => x.status === 'work');
  if (work) return null;
  const prod = items.find((x) => x.agent === 'production');
  const budget = items.find((x) => x.kind === 'budget');
  const reset = nextBudgetReset(d);
  const soon = new Date(d.getTime() + TICK_MINUTES * 60000).toISOString();
  const r = (x) => Math.floor(x * 100) / 100; // 残りは切り捨てで表示（「残り4円・見込み4円」のような誤解を防ぐ）
  if (prod && prod.kind === 'budget') return { kind: 'budget', reason: `今日の予算の残り${r(left)}円が、投稿セット1件の見込み${est.production}円に足りない`, resumeAt: reset, resume: '明日0:00に予算が戻ったら、最初に投稿セットを作る' };
  if (budget) return { kind: 'budget', reason: `今日の予算の残り${r(left)}円では、始められる仕事がない${reserved ? `（制作のために${est.production}円を取り置き中）` : ''}`, resumeAt: reset, resume: '明日0:00に予算が戻ったら再開' };
  if (items.some((x) => x.kind === 'quota') && !items.some((x) => x.kind === 'waiting')) return { kind: 'quota', reason: '今日の仕事の上限まで進めた', resumeAt: reset, resume: '明日0:00に再開' };
  if (prod && prod.kind === 'backlog') return { kind: 'backlog', reason: prod.reason, resumeAt: soon, resume: `社長の確認で棚が空いたら制作を再開（${TICK_MINUTES}分ごとに確認）` };
  return { kind: 'nodata', reason: '今できる仕事がない（材料がない・前の結果待ち）', resumeAt: soon, resume: `${TICK_MINUTES}分ごとに確認` };
}

async function findWork(kv, snap, date, budget, env = {}) {
  const used = async (t) => Number(await kv.get(`worker:quota:${date}:${t}`)) || 0;
  const left = Math.max(0, (budget.limits.dayAuto || 0) - (budget.spent.dayAuto || 0));
  const board = [];
  let pick = null;
  // kind：仕事なし・待ちの理由の種類（画面で区別して出す）
  //   work＝仕事あり／nodata＝データ不足（材料がない）／waiting＝処理待ち（前の仕事・ほかの社員の結果を待つ）／budget＝予算不足／quota＝今日の上限／backlog＝確認待ちが多い
  const KIND_OF = (reason) => (/API未設定/.test(reason) ? 'nokey' : /費用の残り/.test(reason) ? 'budget' : /確認待ち/.test(reason) ? 'backlog' : /今日の上限/.test(reason) ? 'quota' : /前の仕事|制作が進む/.test(reason) ? 'waiting' : /未実装/.test(reason) ? 'notyet' : 'nodata');
  const note = (agent, status, reason) => board.push({ agent, status, reason, kind: status === 'work' ? 'work' : KIND_OF(reason) });
  const est = await estimates(kv);
  let reserve = 0; // 制作のための取り置き（下で決める）
  const can = async (type) => {
    if (await used(type) >= QUOTA[type]) return `今日の上限（${QUOTA[type]}件）まで仕事をしました`;
    if (left < est[type]) return `今日の自律運営の費用の残り（${Math.floor(left * 100) / 100}円）が、この仕事の見込み（${est[type]}円）より少ない`;
    // 制作より後ろの仕事は、制作の見込みを残せるときだけ始める（AIを使わない仕事は取り置きに関係しない）
    if (type !== 'production' && type !== 'cover' && est[type] > 0 && reserve > 0 && left - est[type] < reserve) return `今日の費用の残り（${Math.floor(left * 100) / 100}円）は、投稿セットの制作のために${reserve}円を取り置いている（制作を優先）`;
    return '';
  };
  // 0. 棚の整理（サーバーの正本：期限切れ・繰り上げ。AIなし）
  await S.rebalance(kv).catch(() => []);
  const cap = await S.capacity(kv);
  const storeUsed = Object.values(cap).some((v) => typeof v === 'number' && v > 0 && v !== cap.room);
  const m = await S.meta(kv);
  const ownerIdle = cap.ready > 0 && (!m.lastOwnerDecisionAt || Date.now() - new Date(m.lastOwnerDecisionAt).getTime() > OWNER_IDLE_DAYS * 86400000);
  // 0.5 表紙画像の作り直し：文章・商品は合格済みで、表紙画像だけ足りない投稿セット（完成品を先に仕上げる）
  const waits = coverOn(env) ? await coverWaitList(kv) : [];
  if (waits.length) {
    const ib = await imageCheck(kv, env);
    const um = await usableMasters(kv);
    if (!um.ok) note('illustrator', 'wait', `表紙画像待ち${waits.length}件：${um.reason}`);
    else if (!ib.ok) note('illustrator', 'wait', `表紙画像待ち${waits.length}件：${ib.reason}`);
    else { const why = await can('cover'); if (why) note('illustrator', 'wait', `表紙画像待ち${waits.length}件：${why}`); else { note('illustrator', 'work', `表紙画像待ちの「${waits[0].title}」の表紙画像を作り直す（${waits[0].rounds + 1}回目）`); pick = { type: 'cover', wait: waits[0] }; } }
  }
  // 1. 制作ライン：合格候補 → 投稿セット。未公開（公開待ち＋控え）が満杯なら作らない（費用を抑え、点検・効果測定・公開の準備を優先）
  const bl = await backlog(kv, snap);
  const prodDone = ((await kv.listJson(K.prod, 30)) || []).filter((r) => r.result === 'pass' && r.endedAt > snap.at).length;
  const pendingSets = (snap.pendingSets || 0) + prodDone;
  const full = storeUsed ? cap.room === 0 : pendingSets >= MAX_PENDING_SETS; // 正本が無い間（移行前）は、今までの数え方
  const prodQuota = ownerIdle ? 1 : QUOTA.production;
  if (!bl.length) note('production', 'none', '投稿セットにまだ使っていない合格候補がない');
  else if (pick) note('production', 'wait', '表紙画像の作り直しのあとに進める');
  else if (waits.length >= 2) note('production', 'wait', `表紙画像待ちの投稿セットが${waits.length}件あるため、新しく作らない（先に完成させる）`);
  else if (full) note('production', 'wait', storeUsed ? `確認待ちが満杯（公開待ち${cap.ready}件・控え${cap.shelf}件）。新しく作らず、点検・効果測定・公開の準備を優先する` : `社長の確認待ちの投稿セットが${pendingSets}件あるため、新しく作らない`);
  else if (await used('production') >= prodQuota) note('production', 'wait', ownerIdle ? `社長の判断が${OWNER_IDLE_DAYS}日以上ないため、今日の上限を1件に落とした（確認待ちが多い）` : `今日の上限（${prodQuota}件）まで仕事をしました`);
  else {
    const why = await can('production');
    if (why) note('production', 'wait', why);
    else {
      // 購入動機：直近の投稿セットで少ない動機を優先し（3つを比べられるように）、その動機の合格候補を渡す（無ければほかの動機の候補）
      const recent = ((await kv.listJson(K.prod, 12)) || []).map((r) => r.motive).filter(Boolean);
      const mv = chooseMotive(recent, recent.length);
      const match = bl.filter((c) => c.motive === mv.id);
      const source = pickSource(match.length ? match : bl, P.MAX_SOURCE);
      const motive = match.length ? mv.id : (source[0] && source[0].motive) || mv.id;
      note('production', 'work', `合格候補${bl.length}件から、購入動機「${(motiveById(motive) || mv).label}」の投稿セットを作る`);
      pick = { type: 'production', source, motive };
    }
  }
  // 制作の取り置き：制作できる状態（合格候補あり・棚に空き・今日の上限内）なら必ず、合格候補がまだ無くても夜（RESERVE_UNTIL_HOUR時）までは1件分を残す
  const prodPossible = !full && waits.length < 2 && (await used('production')) < prodQuota;
  if (prodPossible && (bl.length || jstHour() < RESERVE_UNTIL_HOUR)) reserve = est.production;
  // 2. 営業・交流担当AI：文章のある交流候補
  const doneOut = new Set(((await kv.listJson(K.outreach, 100)) || []).map((r) => r.postId));
  const posts = snap.outreachPosts.filter((p) => !doneOut.has(p.id)).slice(0, 5);
  if (!posts.length) note('outreach', 'none', '文章を確認できた交流候補（社長が追加・公式API）がない');
  else if (pick) note('outreach', 'wait', `交流候補${posts.length}件。前の仕事のあとに進める`);
  else { const why = await can('outreach'); if (why) note('outreach', 'wait', why); else { note('outreach', 'work', `交流候補${posts.length}件のコメント案を作る`); pick = { type: 'outreach', posts }; } }
  // 3a. 候補の再審査（バイヤーAI＋監査AI）：保留・修正しきれなかった候補を直した手順でもう一度審査する（新しく探すより安い）
  const rp = bl.length < STOCK_TARGET ? await rescuePool(kv, snap) : null;
  if (!rp) note('rescue', 'none', bl.length >= STOCK_TARGET ? `合格候補の蓄えが${bl.length}件あり、再審査は不要` : '再審査できる保留・不合格の候補がない（どれも1回ずつ再審査済み、または使用済み）');
  else if (pick) note('rescue', 'wait', `再審査できる候補${rp.list.length}件。前の仕事のあとに進める`);
  else { const why = await can('rescue'); if (why) note('rescue', 'wait', why); else { note('rescue', 'work', `保留・不合格だった候補${rp.list.length}件を、直した手順でもう一度審査する（楽天の再検索なし）`); pick = { type: 'rescue', rescue: rp }; } }
  // 3. バイヤーAI：テーマから商品の候補
  const themes = snap.themes;
  const dry = await buyerDry(kv, date);
  if (!themes.length) note('buyer', 'none', '探すテーマがない（採用した商品・投稿セットがまだない）');
  else if (dry >= BUYER_DRY_STOP) note('buyer', 'wait', `今日の発掘が${dry}回続けて合格0件。同じやり方で費用を使い続けないため、今日の新しい発掘は止める（再審査・ほかの仕事を優先）`);
  // 蓄えが十分なら、制作の費用を残すため、残りが少ない日は探さない（数では打ち切らない）
  else if (bl.length >= STOCK_TARGET && left < est.buyer + est.production) note('buyer', 'wait', `合格候補の蓄えが${bl.length}件あり、今日の費用の残り（${Math.floor(left * 100) / 100}円）は制作に回す`);
  else if (pick) note('buyer', 'wait', '前の仕事のあとに進める');
  else {
    const why = await can('buyer');
    if (why) note('buyer', 'wait', why);
    else {
      const i = Number(await kv.get(K.themeIdx)) || 0;
      await kv.set(K.themeIdx, String(i + 1));
      const theme = themes[i % themes.length];
      // 発掘の切り口：蓄えに少ない切り口を優先して回す（同じような商品ばかりにならないように）
      const angle = chooseAngle(bl.map((c) => c.angle), i);
      note('buyer', 'work', `テーマ「${theme}」・切り口「${angle.label}」で商品を発掘する（蓄え${bl.length}件）`);
      pick = { type: 'buyer', theme, angle: angle.id };
    }
  }
  // 4. 棚の点検（改善・コード・0円）：公開待ち・控えの投稿セットの商品を楽天で引き直し、販売終了・価格の変化を記録する（古い情報のまま社長に見せない）
  const shelfSets = await S.list(kv, { states: ['ready', 'shelf'] });
  const stale = shelfSets.filter((r) => !(r.set && r.set.inspection && Date.now() - new Date(r.set.inspection.at).getTime() < 86400000));
  if (!shelfSets.length) note('inspect', 'none', '公開待ち・控えの投稿セットがない');
  else if (!stale.length) note('inspect', 'none', `公開待ち・控えの${shelfSets.length}件は24時間以内に点検済み`);
  else if (pick) note('inspect', 'wait', `点検が必要な投稿セット${stale.length}件。前の仕事のあとに進める`);
  else { const why = await can('inspect'); if (why) note('inspect', 'wait', why); else { note('inspect', 'work', `公開待ち・控えの${Math.min(stale.length, 2)}件の商品を楽天で引き直す（AIなし）`); pick = { type: 'inspect', ids: stale.slice(0, 2).map((r) => r.id) }; } }
  // 5. 効果測定（コード・0円）：Instagram公式APIで、最近の投稿の数字とアカウントの数字を取る
  const ig = igConfig(env);
  if (!ig.ready) note('measure', 'none', 'Instagram公式APIの鍵（IG_ACCESS_TOKEN）が未設定のため、数字を取れない（API未設定）');
  else if (pick) note('measure', 'wait', '前の仕事のあとに進める');
  else { const why = await can('measure'); if (why) note('measure', 'wait', why); else { note('measure', 'work', 'Instagramの最近の投稿とアカウントの数字を取る（AIなし）'); pick = { type: 'measure' }; } }
  // 6. 公開（段階2で実装）：社長が採用した投稿セットと、公開に必要な設定の有無だけを確かめる（ここでは何も投稿しない）
  const missing = PUBLISH_ENV.filter((k) => !String(env[k] || '').trim() || (k === 'IG_PUBLISH_ENABLED' && env[k] !== '1'));
  note('publish', 'none', `社長が採用した投稿セット${cap.approved}件。公開の自動化は段階2で実装（未実装）${missing.length ? `・未設定：${missing.join('・')}（API未設定）` : ''}`);
  return { pick, board: { at: now(), items: board, capacity: cap, ownerIdle, buyer: await buyerStats(kv, bl.length), estimates: est, left: Math.round(left * 1000) / 1000, reserve, next: nextResume(board, { left, est, reserved: reserve > 0 }) } };
}

// ---- 棚の点検（コード・0円）：商品を楽天で引き直し、販売終了・価格の変化を投稿セットに記録する ----
async function inspectAdvance(job, ctx) {
  const rec = job.rec;
  const st = { name: '棚の点検（コード）：公開待ち・控えの商品を楽天で引き直す（AIなし）', role: 'inspect', status: 'running', startedAt: now() };
  rec.steps.push(st);
  rec.results = [];
  for (const id of job.ids) {
    const r = await S.get(ctx.kv, id);
    if (!r || !['ready', 'shelf'].includes(r.state)) continue;
    const problems = []; let checked = 0;
    for (const it of (r.set && r.set.items) || []) {
      if (!it.code || Date.now() > ctx.startedAt + 45000) continue;
      await new Promise((ok) => setTimeout(ok, ctx.env.__noWait ? 0 : 1100)); // 楽天APIは1秒1回まで
      try {
        const live = await lookupItem({ code: it.code, env: ctx.env, referer: ctx.referer });
        checked += 1;
        if (!live) problems.push(`販売終了の可能性：${String(it.name).slice(0, 30)}`);
        else if (Number(live.price) !== Number(it.price)) problems.push(`価格が変わった：${String(it.name).slice(0, 30)}（${it.price}円 → ${live.price}円）`);
      } catch (e) { problems.push(`確認できなかった：${String(it.name).slice(0, 30)}（${String(e.message).slice(0, 60)}）`); }
    }
    const inspection = { at: now(), checked, problems };
    // 販売終了の商品があるものは点数を下げて、控えの後ろへ（消さない）
    const score = problems.some((x) => /販売終了/.test(x)) ? Math.min(r.score == null ? 0 : r.score, 0) : r.score;
    try { await S.update(ctx.kv, id, r.rev, { set: { ...r.set, inspection }, score, by: 'server:棚の点検', change: problems.length ? `点検：問題${problems.length}件` : '点検：問題なし' }); } catch (e) { if (!(e instanceof S.ConflictError)) throw e; }
    rec.results.push({ id, title: r.set && r.set.title, checked, problems });
  }
  st.status = 'ok'; st.endedAt = now(); st.note = `${rec.results.length}件を点検・問題 ${rec.results.reduce((a, x) => a + x.problems.length, 0)}件`;
  rec.result = 'pass'; rec.why = st.note;
  return { done: true };
}

// ---- 効果測定（コード・0円）：Instagram公式APIで最近の投稿の数字を取る（未取得は推測しない） ----
async function measureAdvance(job, ctx) {
  const rec = job.rec;
  const st = { name: '効果測定（コード）：Instagramの最近の投稿・アカウントの数字を取る（AIなし）', role: 'measure', status: 'running', startedAt: now() };
  rec.steps.push(st);
  const cfg = igConfig(ctx.env);
  try {
    const [media, account] = await Promise.all([recentMedia(cfg, { limit: 10, extra: true }), accountInsights(cfg, { days: 7 }).catch((e) => ({ error: String(e.message).slice(0, 120) }))]);
    rec.media = media; rec.account = account;
    await ctx.kv.setJson('worker:measure:last', { at: now(), media, account });
    st.status = 'ok'; st.note = `投稿${(media || []).length}件の数字を取得`;
  } catch (e) { st.status = 'failed'; st.endedAt = now(); return { fail: `効果測定：${String(e.message || e).slice(0, 160)}` }; }
  st.endedAt = now(); rec.result = 'pass'; rec.why = st.note;
  return { done: true };
}

// ---- バイヤーAI：1段階ずつ ----
async function buyerAdvance(job, ctx) {
  const sess = job.session;
  const step = (name) => { const st = { name, status: 'running', startedAt: now() }; sess.steps.push(st); return st; };
  const end = (st, ok, note) => { st.status = ok ? 'ok' : 'failed'; st.endedAt = now(); if (note) st.note = note; };
  const cur = (c) => c.versions[c.versions.length - 1];
  if (job.step === 'buyer') {
    const st = step('バイヤーAI：検索語を決めて楽天で検索し、候補を選ぶ（AI 2回・楽天の検索）');
    const knownCodes = [...((await ctx.kv.getJson(K.used)) || []), ...(ctx.snap.setCodes || []), ...(ctx.snap.skipCodes || []), ...(await backlog(ctx.kv, ctx.snap)).map((c) => c.code)];
    const d = await buyerStep({ theme: sess.theme, angle: angleById(sess.angle), avoid: ctx.snap.avoid, lessons: (await ctx.kv.getJson(K.lessons)) || [], exclude: knownCodes, env: ctx.env, referer: ctx.referer, startedAt: ctx.startedAt });
    sess.runs.push(...(d.runs || []));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    sess.searched = d.searched || []; sess.results = d.results || []; sess.rakutenCalls += (d.searched || []).length;
    // すでに投稿セットに使った商品・社長が見送った商品は、候補から外す（同じ商品を何度も出さない。コードで判断）
    const known = new Set([...((await ctx.kv.getJson(K.used)) || []), ...(ctx.snap.setCodes || []), ...(ctx.snap.skipCodes || [])]);
    const dup = (d.candidates || []).filter((c) => known.has(c.code));
    if (dup.length) sess.dropped = dup.map((c) => ({ code: c.code, name: c.name, why: '投稿セットに使用済み・または社長が見送った商品' }));
    sess.candidates = (d.candidates || []).filter((c) => !known.has(c.code)).map((c) => ({ id: c.id, status: 'running', versions: [{ v: 1, data: c, at: now() }], revisions: 0 }));
    end(st, true, `${sess.candidates.length}件${dup.length ? `（使用済みの商品${dup.length}件を除外）` : ''}`);
    if (!sess.candidates.length) { sess.note = `候補が0件でした（数合わせはしていません）${dup.length ? `。使用済みの商品${dup.length}件を除外` : ''}${d.notes ? `：${d.notes}` : ''}`; return { done: true }; }
    job.ids = sess.candidates.map((c) => c.id);
    job.step = 'check';
    return {};
  }
  if (job.step === 'check') {
    const st = step('コードの確認：楽天で商品番号を引き直し・引用の照合・禁止表現（AIなし）');
    const d = await checkStep({ candidates: sess.candidates.filter((c) => job.ids.includes(c.id)).map((c) => cur(c).data), results: sess.results, env: ctx.env, referer: ctx.referer, startedAt: ctx.startedAt });
    sess.rakutenCalls += d.rakutenCalls || 0;
    (d.checks || []).forEach((k) => { const c = sess.candidates.find((y) => y.id === k.id); if (c) cur(c).check = k; });
    end(st, true);
    job.step = 'audit';
    return {};
  }
  if (job.step === 'audit') {
    const st = step('採点：監査AI（別のAI呼び出し）');
    const list = sess.candidates.filter((c) => job.ids.includes(c.id));
    const checks = list.map((c) => ({ id: c.id, ...cur(c).check }));
    const d = await auditStep({ candidates: list.map((c) => cur(c).data), results: sess.results, checks, model: ctx.snap.auditModel, env: ctx.env, startedAt: ctx.startedAt });
    sess.runs.push(...(d.runs || []));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    list.forEach((c) => {
      const au = d.audits.find((a) => a.id === c.id) || null;
      const dc = { id: c.id, ...decide({ check: cur(c).check, audit: au, revisions: c.revisions }) };
      cur(c).audit = au && { model: (d.runs || []).filter((r) => r.ok).map((r) => r.model)[0] || '', ...au };
      cur(c).decision = dc; c.status = dc.status; c.why = dc.why;
    });
    end(st, true);
    const need = list.filter((c) => c.status === 'revise' && c.revisions < MAX_REVISIONS);
    if (!need.length) return { done: true };
    job.ids = need.map((c) => c.id);
    job.step = 'revise';
    return {};
  }
  if (job.step === 'revise') {
    const st = step('修正：バイヤーAI（監査AIの指示に従って直す）');
    const list = sess.candidates.filter((c) => job.ids.includes(c.id));
    const targets = list.map((c) => { const v = cur(c); return { candidate: v.data, why: c.why || '', fixes: v.audit ? v.audit.fixes : [], needResearch: v.audit ? v.audit.needResearch : '', codeNg: v.check ? v.check.checks.filter((k) => k.ok === false).map((k) => `${k.label}：${k.detail}`) : [] }; });
    const d = await reviseStep({ targets, results: sess.results, env: ctx.env, startedAt: ctx.startedAt });
    sess.runs.push(...(d.runs || []));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    const again = [];
    (d.revisions || []).forEach((rv) => {
      const c = sess.candidates.find((y) => y.id === rv.id);
      if (!c) return;
      c.revisions += 1;
      if (!rv.candidate) { c.status = 'hold'; c.why = `追加調査が必要（推測で補わない）：${rv.needResearch || ''}`; return; }
      c.versions.push({ v: c.versions.length + 1, data: rv.candidate, replaced: !!rv.replaced, at: now() });
      again.push(c.id);
    });
    end(st, true, `${again.length}件を修正`);
    if (!again.length) return { done: true };
    job.ids = again;
    job.step = 'check';
    return {};
  }
  return { fail: `不明な段階 ${job.step}` };
}

// ---- 営業・交流担当AI：1段階ずつ ----
async function outreachAdvance(job, ctx) {
  const run = job.run;
  const step = (name) => { const st = { name, status: 'running', at: now() }; run.steps.push(st); return st; };
  const posts = job.posts.filter((p) => job.ids.includes(p.id));
  if (job.step === 'draft') {
    const st = step(job.revise ? `営業・交流担当AI：修正 ${job.round}回目` : '営業・交流担当AI：コメント案を作る');
    const d = await draftStep({ posts, themes: ctx.snap.themes, past: ctx.snap.past, env: ctx.env, startedAt: ctx.startedAt, revise: job.revise || null });
    run.runs.push(...(d.runs || []));
    if (!d.ok) { st.status = 'failed'; return { fail: `${d.failedStep}：${d.error}` }; }
    st.status = 'ok';
    (d.skipped || []).forEach((x) => { job.out[x.id] = { ...(job.out[x.id] || { versions: [] }), status: 'hold', why: x.why }; });
    const next = [];
    (d.drafts || []).forEach((x) => {
      const o = job.out[x.id] || { versions: [] };
      if (x.giveUp) { job.out[x.id] = { ...o, status: 'hold', why: `追加の情報が必要（推測で補わない）：${x.giveUp}` }; return; }
      const ck = checkComment(x, job.posts.find((p) => p.id === x.id), ctx.snap.past);
      o.versions = (o.versions || []).concat([{ v: (o.versions || []).length + 1, comment: x.comment, anchor: x.anchor, at: now(), check: ck }]);
      job.out[x.id] = { ...o, draft: x };
      next.push(x.id);
    });
    job.ids.filter((i) => !next.includes(i) && !(job.out[i] && job.out[i].status)).forEach((i) => { job.out[i] = { ...(job.out[i] || { versions: [] }), status: 'hold', why: 'コメント案が返されなかった' }; });
    if (!next.length) return { done: true };
    job.ids = next; job.step = 'audit'; job.revise = null;
    return {};
  }
  if (job.step === 'audit') {
    const st = step('監査AI：コメント案の採点（別のAI呼び出し）');
    const drafts = job.ids.map((i) => job.out[i].draft);
    const checks = drafts.map((d) => checkComment(d, job.posts.find((p) => p.id === d.id), ctx.snap.past));
    const d = await outreachAudit({ posts, drafts, checks, model: ctx.snap.auditModel, env: ctx.env, startedAt: ctx.startedAt });
    run.runs.push(...(d.runs || []));
    if (!d.ok) { st.status = 'failed'; return { fail: `${d.failedStep}：${d.error}` }; }
    st.status = 'ok';
    const again = [];
    drafts.forEach((dr) => {
      const o = job.out[dr.id];
      const au = d.audits.find((a) => a.id === dr.id) || null;
      const ck = checks.find((k) => k.id === dr.id);
      const dc = { id: dr.id, ...outreachDecide({ check: ck, audit: au, revisions: o.revisions || 0 }) };
      o.versions[o.versions.length - 1] = { ...o.versions[o.versions.length - 1], audit: au, check: ck, decision: dc };
      Object.assign(o, { status: dc.status, why: dc.why, final: dc.status === 'pass' ? dr.comment : '', score: au ? au.total : null, follow: dr.follow, followWhy: dr.followWhy, relevance: dr.relevance, relevanceWhy: dr.relevanceWhy });
      if (dc.status === 'revise' && (o.revisions || 0) < MAX_REVISIONS) { o.revisions = (o.revisions || 0) + 1; again.push({ id: dr.id, comment: dr.comment, anchor: dr.anchor, why: dc.why, fixes: au ? au.fixes : [] }); }
    });
    if (!again.length) return { done: true };
    job.round = (job.round || 0) + 1;
    job.ids = again.map((x) => x.id); job.revise = again; job.step = 'draft';
    return {};
  }
  return { fail: `不明な段階 ${job.step}` };
}

// ---- 制作ライン：1段階ずつ（企画担当AI → 投稿セット制作AI → 監査AI → 制作担当AI） ----
export const PROD_ROLE = { plan: 'planner', gather: 'planner', pick: 'planner', copy: 'producer', roomtext: 'producer', audit: 'auditor', revise: 'editor', scene: 'illustrator', image: 'illustrator', imgcheck: 'auditor' };
// 表紙画像（サングラスくま）を作るか。KUMA_COVER=off で止められる（費用は lib/budget.js の画像の上限で守る）
const coverOn = (env) => String(env.KUMA_COVER || '').trim().toLowerCase() !== 'off';
// 表紙画像が基準に届かなかった（作れなかった）：投稿セットは社長の確認待ちに入れず「表紙画像待ち」にする。retry＝あとで作り直す価値があるか
export const MAX_COVER_ROUNDS = 3; // 設定できる上限
// 1つの投稿セットに表紙画像を作りにいく回数。初回の本番検証は、あとでの自動の作り直しなし＝1回（社長の指示 2026-11-14）。KUMA_COVER_ROUNDS で最大3回
export const coverRounds = (env = {}) => Math.min(MAX_COVER_ROUNDS, Math.max(1, Math.floor(Number(env.KUMA_COVER_ROUNDS)) || 1));
function noCover(job, rec, reason, { retry = true, attempts } = {}) {
  job.set.coverImage = { status: 'none', reason: String(reason || '').slice(0, 200), retry, ...(attempts ? { attempts } : {}) };
  rec.cover = job.set.coverImage;
  return { done: true };
}
async function productionAdvance(job, ctx) {
  const rec = job.rec;
  const step = (name) => { const st = { name, role: PROD_ROLE[job.step], status: 'running', startedAt: now() }; rec.steps.push(st); return st; };
  const end = (st, ok, note) => { st.status = ok ? 'ok' : 'failed'; st.endedAt = now(); if (note) st.note = String(note).slice(0, 200); };
  const base = { env: ctx.env, referer: ctx.referer, startedAt: ctx.startedAt };
  const take = (d) => { rec.runs.push(...(d.runs || [])); return d; };
  if (job.step === 'plan') {
    const st = step('企画担当AI：合格候補を中心に、投稿の企画を決める（AI 1回）');
    const d = take(await P.planStep({ source: job.source, motive: job.motive || '', history: ctx.snap.history, recentPatterns: ctx.snap.recentPatterns, ...base }));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    job.plan = d.plan; rec.plan = { title: d.plan.title, pattern: d.plan.pattern, target: d.plan.target, used: d.plan.adopted.length, slots: d.plan.slots.length };
    end(st, true, `「${d.plan.title}」：合格候補${d.plan.adopted.length}件＋探す枠${d.plan.slots.length}`);
    job.step = 'gather'; return {};
  }
  if (job.step === 'gather') {
    const st = step('企画担当（コード）：候補を楽天で引き直し、足りない枠を楽天で探す（AIなし）');
    const d = await P.gatherStep({ plan: job.plan, source: job.source, exclude: [...ctx.snap.setCodes, ...ctx.snap.skipCodes], ...base });
    rec.rakutenCalls += d.rakutenCalls || 0;
    job.gathered = { fresh: d.fresh, missing: d.missing, slotResults: d.slotResults.map((x) => ({ ...x, candidates: x.candidates.slice(0, 6) })) };
    end(st, true, `候補${d.fresh.length}件を確認${d.missing.length ? `（掲載なし${d.missing.length}件）` : ''}・枠${d.slotResults.length}つを検索`);
    job.step = 'pick'; return {};
  }
  if (job.step === 'pick') {
    const st = step('企画担当AI：枠ごとに商品を選び、投稿セットの形にする（AI 1回）→ コードの品質確認');
    const g = job.gathered;
    const d = take(await P.pickStep({ id: `set-${job.id}`, plan: job.plan, fresh: g.fresh, missing: g.missing, slotResults: g.slotResults, sourceCount: job.source.length, ...base }));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    job.set = d.set; delete job.gathered;
    // 購入動機と販売導線（ストーリーズのハイライト・リンクの案内・測る数字）を投稿セットに残す
    if (job.motive) { job.set.motive = job.motive; job.set.funnel = P.funnelOf(job.set, job.motive); rec.motive = job.motive; }
    rec.setId = d.set.id; rec.title = d.set.title; rec.items = d.set.items.map((it) => ({ name: it.name.slice(0, 40), price: it.price, source: it.source, code: it.code }));
    if (d.set.issues.length) { end(st, true, d.set.issues.join('／')); rec.result = 'hold'; rec.why = `商品がそろわなかった（無理に投稿セットにしない）：${d.set.issues.join('／')}`; return { done: true }; }
    end(st, true, `${d.set.items.length}点（合格候補${d.set.items.filter((x) => x.source === 'buyer').length}点）`);
    job.step = 'copy'; return {};
  }
  if (job.step === 'copy') {
    const st = step('投稿セット制作AI：Instagramの表紙・商品カードの文字・キャプション（AI 1回）');
    const d = take(await P.copyStep({ set: job.set, ...base }));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    job.set.copy = d.copy; job.set.copyAt = now();
    end(st, true, `キャプション ${d.copy.caption.length}字`);
    job.step = 'roomtext'; return {};
  }
  if (job.step === 'roomtext') {
    const st = step('投稿セット制作AI：楽天ROOMの紹介文（AI）とハッシュタグ（商品のデータから）');
    const d = take(await P.roomStep({ set: job.set, ...base }));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    job.set.roomTexts = d.roomTexts;
    rec.versions = [{ round: 0, at: now(), by: '投稿セット制作AI', texts: P.textsOf(job.set) }];
    end(st, true, `${d.roomTexts.length}件`);
    job.step = 'audit'; return {};
  }
  if (job.step === 'audit') {
    const st = step('コードの確認（PR表記・禁止表現・価格の一致・長さ）＋ 監査AIの採点（別のAI呼び出し）');
    const check = P.codeCheck(job.set);
    const d = take(await P.auditSetStep({ set: job.set, check, model: ctx.snap.auditModel, ...base }));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    const dc = P.decideSet({ check, audit: d.audit, revisions: rec.revisions });
    rec.audits.push({ at: now(), round: rec.revisions, check, audit: d.audit, decision: dc });
    job.lastAudit = { check, audit: d.audit };
    rec.score = d.audit.total; rec.why = dc.why; rec.textWhy = dc.why;
    end(st, true, `${d.audit.total}点・${({ pass: '合格', revise: '修正', hold: '保留', reject: '不合格' })[dc.status] || dc.status}`);
    if (dc.status === 'revise' && rec.revisions < P.MAX_REVISIONS) {
      // 同じ直せない理由では、修正のAIを呼ばずに止める（費用をかけても結果が変わらないため）
      const stop = P.unfixable(d.audit, rec.audits[rec.audits.length - 2]);
      if (stop) { rec.result = 'hold'; rec.why = `修正しても直せない指摘のため打ち切り（AIを呼ばない）：${stop}`; return { done: true }; }
      job.step = 'revise'; return {};
    }
    rec.result = dc.status === 'pass' ? 'pass' : dc.status === 'revise' ? 'hold' : dc.status;
    // 合格したら、表紙画像（サングラスくま）を作ってから社長の確認待ちにする（作れなくても投稿セットは渡す）
    if (rec.result === 'pass' && coverOn(ctx.env)) { job.step = 'scene'; return {}; }
    if (rec.result === 'pass') return noCover(job, rec, '表紙画像の生成は止めてある（KUMA_COVER=off）');
    return { done: true };
  }
  if (job.step === 'scene') {
    const st = step('表紙画像担当AI：主役の商品を、サングラスくまが使う日常の場面を決める（AI 1回）');
    const d = take(await C.sceneStep({ set: job.set, history: await C.sceneHistory(ctx.kv), ...base }));
    // 表紙画像の失敗で、合格した投稿セットを失わない（画像なしで渡す）
    if (!d.ok) { end(st, false, d.error); return noCover(job, rec, `場面を決められなかった：${d.error}`); }
    if (d.skip) { end(st, true, d.skip); return noCover(job, rec, d.skip, { retry: d.retry !== false }); }
    job.cover = { scene: d.scene, item: d.item, tries: 0, attempts: [] };
    end(st, true, `${d.scene.place}・${d.scene.action}（衣装：${d.scene.outfit}${d.scene.usageFallback ? '・使い方は商品データで確かめられず「手に持って眺める」' : ''}）`);
    job.step = 'image'; return {};
  }
  if (job.step === 'image') {
    const cv = job.cover;
    const st = step(`表紙画像担当AI：画像を作る（${cv.tries + 1}枚目・マスター画像と商品写真を参考に）`);
    const d = await C.imageStep({ kv: ctx.kv, env: ctx.env, origin: ctx.origin, scene: cv.scene, item: cv.item, startedAt: ctx.startedAt, quality: cv.timedOut ? 'low' : C.IMAGE_QUALITY });
    // 画像の費用は画像専用の上限で数える（自律運営の1日の上限には入れない）。記録には残す
    if (d.run) rec.runs.push({ ...d.run, yen: 0 });
    if (d.skip) { end(st, true, d.skip); return noCover(job, rec, d.skip, { attempts: cv.attempts }); }
    cv.tries += 1;
    if (!d.ok) {
      cv.attempts.push({ at: now(), ok: false, error: d.error });
      if (d.timedOut) cv.timedOut = true; // 作り直しは品質 low で（時間内に終わるように）
      end(st, false, d.error);
      if (cv.tries >= C.imageTries(ctx.env)) return noCover(job, rec, `画像を作れなかった：${d.error}`, { attempts: cv.attempts });
      return {};
    }
    cv.mediaId = await C.saveMedia(ctx.kv, d.b64);
    cv.model = d.model; cv.costYen = d.cost.yen; cv.measured = d.cost.measured;
    end(st, true, `作成（${d.cost.measured ? '実測' : '見込み'} ${d.cost.yen}円）`);
    job.step = 'imgcheck'; return {};
  }
  if (job.step === 'imgcheck') {
    const cv = job.cover;
    const st = step('品質確認：表紙画像（固定要素・商品の一致・文字やロゴなし。別のAI呼び出し）');
    const b64 = await C.getMedia(ctx.kv, cv.mediaId);
    if (!b64) { end(st, false, '保存した画像が見つからない'); return noCover(job, rec, '保存した画像が見つからない', { attempts: cv.attempts }); }
    const master = (await import('./kuma-master-manifest.js')).MASTERS.find((m) => m.kind === 'front') || (await import('./kuma-master-manifest.js')).MASTERS[0];
    const d = take(await C.checkStep({ b64, masterUrl: new URL(`/assets/kuma-master/${master.file}`, ctx.origin).toString(), productUrl: cv.item.image, scene: cv.scene, ...base }));
    // 品質を確かめられなかった画像は使わない（投稿セットは画像なしで渡す）
    if (!d.ok) { end(st, false, d.error); return noCover(job, rec, `品質確認ができなかった（画像は使わない）：${d.error}`, { attempts: cv.attempts }); }
    cv.attempts.push({ at: now(), ok: d.check.pass, mediaId: cv.mediaId, ng: d.check.ng, issues: d.check.issues, costYen: cv.costYen });
    if (d.check.pass) {
      end(st, true, `合格（${C.CHECK_KEYS.length}項目すべて）`);
      job.set.coverImage = { status: 'ok', mediaId: cv.mediaId, scene: cv.scene, item: cv.item.name, model: cv.model, costYen: cv.costYen, measured: cv.measured, check: d.check.raw, tries: cv.tries, by: '表紙画像担当AI', label: 'AI生成イメージ', at: now() };
      rec.cover = { status: 'ok', mediaId: cv.mediaId, scene: cv.scene, tries: cv.tries, attempts: cv.attempts };
      await C.pushScene(ctx.kv, cv.scene);
      return { done: true };
    }
    end(st, true, `不合格：${d.check.ng.join('・')}${d.check.issues.length ? `（${d.check.issues.join('／')}）` : ''}`);
    if (cv.tries < C.imageTries(ctx.env)) { job.step = 'image'; return {}; }
    return noCover(job, rec, `品質確認で2回とも不合格：${d.check.ng.join('・')}`, { attempts: cv.attempts });
  }
  if (job.step === 'revise') {
    const st = step(`制作担当AI：監査AIの指示で修正（${rec.revisions + 1}回目）`);
    const d = take(await P.editStep({ set: job.set, audit: job.lastAudit.audit, check: job.lastAudit.check, ...base }));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    rec.revisions += 1;
    if (d.edit.giveUp && !d.edit.caption && !d.edit.room.length) { end(st, true, `直せない：${d.edit.giveUp}`); rec.result = 'hold'; rec.why = `追加の情報が必要（推測で補わない）：${d.edit.giveUp}`; return { done: true }; }
    const a = P.applyEdit(job.set, d.edit);
    job.set = a.set;
    // 監査AIが「商品データに無い表現・確認できない断定」を指摘したROOM紹介文は、事実だけの紹介文（プログラム）に置き換える（AIの書き直しは再発するため）
    const fl = (job.lastAudit.audit && job.lastAudit.audit.flags) || {};
    if (fl.fabrication || fl.unverified) {
      const ns = [...new Set(((job.lastAudit.audit.fixes) || []).map((f) => String(f.target || '').replace(/\s/g, '')).filter((t) => /^room:\d+$/.test(t)).map((t) => Number(t.split(':')[1])))];
      ns.forEach((n) => { const it = job.set.items[n - 1]; if (!it || !job.set.roomTexts || !job.set.roomTexts[n - 1]) return; job.set.roomTexts[n - 1] = { ...job.set.roomTexts[n - 1], intro: P.factRoomIntro(it, job.set), introFrom: '楽天の商品データ（事実だけ・プログラム）' }; if (!a.changed.includes(`room:${n}`)) a.changed.push(`room:${n}`); });
    }
    // 修正指示が実際に直されたか（コードで確認）と、修正後の全文を残す
    const last = rec.audits[rec.audits.length - 1];
    if (last) last.fixCheck = P.fixCheck(last.audit && last.audit.fixes, a.changed);
    rec.versions = (rec.versions || []).concat([{ round: rec.revisions, at: now(), by: '制作担当AI', changed: a.changed, rejected: a.rejected || [], giveUp: d.edit.giveUp || '', texts: P.textsOf(job.set) }]).slice(-4);
    end(st, true, `${a.changed.join('・') || '変更なし'}を修正${(a.rejected || []).length ? `（商品データに無い言葉のため使わなかった：${a.rejected.length}件）` : ''}${d.edit.giveUp ? `（直せない点：${d.edit.giveUp}）` : ''}`);
    job.step = 'audit'; return {};
  }
  return { fail: `不明な段階 ${job.step}` };
}

// 表紙画像待ちの投稿セット（文章・商品は監査に合格済み。表紙画像だけを作り直す）
export async function coverWaitList(kv) { return (await kv.getJson(K.coverWait)) || []; }
async function coverWaitPush(kv, entry) { const l = (await coverWaitList(kv)).filter((x) => x.set.id !== entry.set.id); l.push(entry); await kv.setJson(K.coverWait, l.slice(-10)); }
async function coverWaitRemove(kv, setId) { const l = await coverWaitList(kv); await kv.setJson(K.coverWait, l.filter((x) => x.set.id !== setId)); }

// 仕事の終わり：成果物を保存（アプリが取りに来る）
async function finishJob(kv, job, status, error, env = {}) {
  if (job.type === 'inspect' || job.type === 'measure') {
    const rec = job.rec;
    rec.status = status; rec.endedAt = now();
    if (error) { rec.failedStep = (rec.steps[rec.steps.length - 1] || {}).name || job.step; rec.error = error; rec.result = 'failed'; }
    await kv.pushJson(job.type === 'inspect' ? 'worker:results:inspect' : 'worker:results:measure', rec, 20);
    return;
  }
  if (job.type === 'production') {
    const rec = job.rec;
    rec.status = status; rec.endedAt = now();
    if (error) { rec.failedStep = (rec.steps[rec.steps.length - 1] || {}).name || job.step; rec.error = error; rec.result = 'failed'; }
    if (!rec.result) { rec.result = 'hold'; rec.why = rec.why || `段階が${MAX_STEPS_PROD}回を超えたため打ち切り`; }
    // 合格した投稿セットだけ、社長の確認待ちとしてアプリへ渡す（保留・不合格は日報に理由を残すだけ）
    // 表紙画像の作り直し（cover）で始めた仕事：表紙画像待ちの一覧から外す（結果に応じて下で入れ直す）
    if (job.coverRetry) await coverWaitRemove(kv, job.set && job.set.id);
    const coverOk = job.set && job.set.coverImage && job.set.coverImage.status === 'ok';
    // 文章の監査に合格しても、表紙画像が基準に届かなければ社長の確認待ちに入れない（完成品だけを社長に見せる・2026-11-14 社長の方針）
    if (rec.result === 'pass' && !coverOk && job.set) {
      const ci = job.set.coverImage || { reason: '表紙画像がない', retry: true };
      const rounds = (job.coverRound || 0) + 1;
      const again = ci.retry !== false && rounds < coverRounds(env);
      rec.result = 'cover_wait';
      rec.textPass = true; // 文章・商品は監査に合格している
      rec.why = `${again ? '表紙画像待ち（文章と商品は保存済み。あとで表紙画像を作り直す）' : '表紙画像が基準に届かないため保留（文章と商品は保存済み）'}：${ci.reason || ''}`.slice(0, 300);
      if (again) await coverWaitPush(kv, { set: { ...job.set, coverImage: undefined }, recId: rec.id, title: job.set.title, score: rec.score, revisions: rec.revisions, textWhy: rec.textWhy || '', rounds, lastReason: ci.reason || '', at: now() });
    }
    if (rec.result === 'pass') {
      rec.set = { ...job.set, auto: { id: rec.id, score: rec.score, why: rec.textWhy || rec.why, revisions: rec.revisions, coverRounds: (job.coverRound || 0) + 1 } };
      // サーバーの正本に入れる（控えへ。棚の整理で上位3件が公開待ちへ繰り上がる）
      await S.create(kv, { id: rec.set.id, set: rec.set, state: 'shelf', origin: 'server', score: rec.score, by: 'server:制作ライン' });
      await S.rebalance(kv).catch(() => []);
    }
    // 合格しなかった投稿セットも、中身を確かめられるよう下書きとして残す（社長の確認待ちには入れない）
    if (rec.result !== 'pass' && job.set) rec.draft = { id: job.set.id, title: job.set.title, target: job.set.target, items: (job.set.items || []).map((it) => ({ name: it.name, price: it.price, url: it.url, source: it.source })), texts: P.textsOf(job.set) };
    // 使った合格候補は、二度と使わない（失敗したときは、次に使えるよう残す）
    // 合格候補の消費（2026-11-14 見直し）：
    //   使用済みにするのは、実際に投稿セットに入った候補だけ（企画担当AIが選ばなかった候補は在庫に戻す）
    //   完成（pass）・表紙画像待ち（cover_wait。文章と商品は保存済み）なら使用済み。文章が保留・不合格・失敗なら、入っていた候補は2回まで在庫に戻す
    const inSet = new Set(((job.set && job.set.items) || []).filter((it) => it.source === 'buyer').map((it) => it.code));
    const usedCodes = job.source.map((c) => c.code).filter((c) => inSet.has(c));
    if (usedCodes.length) {
      const used = (await kv.getJson(K.used)) || [];
      if (rec.result === 'pass' || rec.result === 'cover_wait') await kv.setJson(K.used, [...new Set([...usedCodes, ...used])].slice(0, 300));
      else {
        const tries = (await kv.getJson(K.tries)) || {};
        usedCodes.forEach((c) => { tries[c] = (tries[c] || 0) + 1; });
        const spent = usedCodes.filter((c) => tries[c] >= MAX_CANDIDATE_TRIES);
        await kv.setJson(K.tries, Object.fromEntries(Object.entries(tries).slice(-300)));
        if (spent.length) await kv.setJson(K.used, [...new Set([...spent, ...used])].slice(0, 300));
      }
    }
    rec.sourceUse = { offered: job.source.length, inSet: usedCodes.length, released: job.source.length - usedCodes.length };
    rec.source = job.source.map((c) => ({ code: c.code, name: String(c.name).slice(0, 40), price: c.price, score: c.score, sessionId: c.sessionId, candidateId: c.candidateId }));
    await kv.pushJson(K.prod, rec, 20);
    return;
  }
  if (job.type === 'buyer') {
    const sess = job.session;
    sess.candidates.forEach((c) => { if (c.status === 'revise' || c.status === 'running') { c.status = 'hold'; c.why = `${c.why ? `${c.why}。` : ''}修正${MAX_REVISIONS}回でも合格にならなかった（無理に合格にしない）`; } });
    sess.status = status; sess.endedAt = now();
    if (error) { sess.failedStep = (sess.steps[sess.steps.length - 1] || {}).name || job.step; sess.error = error; }
    sess.results = (sess.results || []).slice(0, 40);
    await kv.pushJson(K.buyer, sess, STOCK_KEEP);
    // 次の探索の改善：保留・不合格の理由と、合格が出なかった検索語を残す（基準は下げない。同じ失敗を避けるためだけに使う）
    const kwOf = (c) => (String((c.versions[c.versions.length - 1].data || {}).source || '').match(/検索語：([^）]+)/) || [])[1] || '';
    const fresh = sess.candidates.filter((c) => c.status === 'hold' || c.status === 'reject').map((c) => ({ at: now(), why: String(c.why || '').slice(0, 120), keyword: kwOf(c), status: c.status }));
    const passKw = new Set(sess.candidates.filter((c) => c.status === 'pass').map(kwOf));
    const dead = (sess.searched || []).filter((x) => x.keyword && !passKw.has(x.keyword)).map((x) => ({ at: now(), deadKeyword: x.keyword, found: x.found }));
    if (fresh.length || dead.length) await kv.setJson(K.lessons, [...fresh, ...dead, ...((await kv.getJson(K.lessons)) || [])].slice(0, 30));
  } else {
    const run = job.run;
    Object.keys(job.out).forEach((pid) => { const o = job.out[pid]; if (o.status === 'revise' || !o.status) { o.status = status === 'failed' ? 'failed' : 'hold'; o.why = status === 'failed' ? `失敗：${error}` : `${o.why || ''}（修正${MAX_REVISIONS}回でも合格にならなかった）`; } });
    run.status = status; run.endedAt = now();
    if (error) { run.failedStep = (run.steps[run.steps.length - 1] || {}).name || job.step; run.error = error; }
    run.result = {};
    for (const p of job.posts) {
      const o = job.out[p.id] || { status: status === 'failed' ? 'failed' : 'hold', why: error || '結果なし', versions: [] };
      delete o.draft;
      run.result[p.id] = o.status;
      await kv.pushJson(K.outreach, { postId: p.id, runId: run.id, at: now(), outreach: { runId: run.id, ...o } }, 100);
    }
    await kv.pushJson(K.oruns, run, 30);
  }
}

// 停止スイッチ（2026-11-16）：社長がアプリから止める・再開する。止めている間、定期実行は何もしない（途中の仕事はそのまま残り、再開すると続きから）
export async function setPaused(kv, on, reason = '') {
  if (on) await kv.setJson(K.paused, { on: true, at: now(), reason: String(reason || '社長が停止').slice(0, 100) });
  else await kv.del(K.paused);
  return (await kv.getJson(K.paused)) || { on: false };
}

// 1回の定期実行
export async function tick({ kv, env, referer = '', origin = '', startedAt = Date.now(), date = jstDate(), trigger = '' }) {
  const lockToken = `${startedAt}-${crypto.randomBytes(4).toString('hex')}`;
  const lock = await kv.set(K.lock, lockToken, { nx: true, ex: 58 });
  if (!lock) return { ok: true, skipped: '前の実行がまだ動いています（二重実行の防止）' };
  try {
    const health = (await kv.getJson(K.health)) || { failures: 0 };
    health.lastTickAt = now();
    if (trigger) { health.lastTrigger = trigger; health.triggers = { ...(health.triggers || {}), [trigger]: now() }; }
    const paused = await kv.getJson(K.paused);
    if (paused && paused.on) { await kv.setJson(K.health, health); return { ok: true, skipped: `自律運営は停止中です（${paused.at}・${paused.reason}）。アプリの「自律運営を再開する」で再開します` }; }
    if (health.pausedUntil && new Date(health.pausedUntil).getTime() > Date.now()) { await kv.setJson(K.health, health); return { ok: true, skipped: `休止中（${health.pausedUntil} まで）：${health.lastError || ''}` }; }
    if (!env.OPENAI_API_KEY || !env.RAKUTEN_APP_ID) { await kv.setJson(K.health, health); return { ok: false, skipped: 'サーバーの鍵（OpenAI・楽天）がありません' }; }
    // 予算の確認は、仕事ごと・段階ごとの見込みで行う（以前は一律3円で、AIを使わない仕事や安い段階まで止めていた）
    const budget = await budgetCheck(kv, env, { estimate: 0.01, auto: true }); // 上限に達していたら止める
    if (!budget.ok) { health.lastSkip = budget.reason; health.blocked = { at: now(), kind: 'budget', reason: budget.reason, resumeAt: nextBudgetReset(), resume: '明日0:00に予算が戻ったら再開' }; await kv.setJson(K.health, health); return { ok: true, skipped: budget.reason, budget }; }
    const snap = await kv.getJson(K.snap);
    let job = await kv.getJson(K.job);
    // 途中の仕事：次の段階の見込みだけを確かめる（AIを使わない段階は予算が残り少なくても進める）
    if (job && Date.now() - new Date(job.startedAt).getTime() <= JOB_TTL_MS) {
      const se = stepEstimate(job);
      const sb = se > 0 ? await budgetCheck(kv, env, { estimate: se, auto: true }) : budget;
      if (!sb.ok) { health.lastSkip = sb.reason; health.blocked = { at: now(), kind: 'budget', reason: `途中の仕事（${job.type}・段階「${job.step}」）の次の段階の見込み${se}円に、今日の予算の残りが足りない`, resumeAt: nextBudgetReset(), resume: '明日0:00に予算が戻ったら、続きから再開' }; await kv.setJson(K.health, health); return { ok: true, skipped: sb.reason, budget: sb }; }
    }
    delete health.blocked;
    const runsOf = (j) => (j.type === 'buyer' ? j.session.runs : j.type === 'outreach' ? j.run.runs : j.rec.runs);
    if (job && Date.now() - new Date(job.startedAt).getTime() > JOB_TTL_MS) { await finishJob(kv, job, 'failed', '24時間で終わらなかったため打ち切り', env); await log(kv, { agent: job.type, jobId: job.id, ok: false, step: job.step, error: '24時間で打ち切り' }); await kv.del(K.job); job = null; }
    if (!job) {
      if (!snap) { await kv.setJson(K.health, health); return { ok: true, skipped: 'アプリの情報がまだ届いていません（アプリを1回開くと届きます）' }; }
      const found = await findWork(kv, { ...readSnapshot(snap), at: snap.at || '' }, date, budget, env);
      await kv.setJson(K.board, found.board);
      const pick = found.pick;
      if (!pick) { health.lastIdle = now(); if (found.board.next) health.blocked = { at: now(), ...found.board.next }; await kv.setJson(K.health, health); return { ok: true, idle: '今できる仕事はありません（社員ごとの理由は仕事探しの記録に残しました）', board: found.board, triggers: health.triggers || {}, qstashReject: await kv.getJson('worker:qstash:reject') }; }
      await kv.incr(`worker:quota:${date}:${pick.type}`); await kv.expire(`worker:quota:${date}:${pick.type}`, 3 * 86400);
      const jid = id({ rescue: 'srvr', buyer: 'srvb', production: 'srvp', inspect: 'srvi', measure: 'srvm', cover: 'srvc' }[pick.type] || 'srvo');
      job = pick.type === 'cover'
        // 表紙画像の作り直し：制作ラインの続き（場面→画像→品質確認）から始める。文章・商品は保存してあるものを使う
        ? { id: jid, type: 'production', step: 'scene', coverRetry: true, coverRound: pick.wait.rounds, startedAt: now(), steps: 0, attempts: 0, source: [], set: pick.wait.set, rec: { id: jid, origin: 'server', at: now(), date, status: 'running', steps: [], runs: [], audits: [], revisions: pick.wait.revisions || 0, rakutenCalls: 0, sourceCount: 0, result: 'pass', score: pick.wait.score, title: pick.wait.title, setId: pick.wait.set.id, coverRetryOf: pick.wait.recId, textWhy: pick.wait.textWhy || '' } }
        : pick.type === 'inspect' || pick.type === 'measure' ? { id: jid, type: pick.type, step: pick.type, startedAt: now(), steps: 0, attempts: 0, ids: pick.ids || [], rec: { id: jid, origin: 'server', at: now(), date, status: 'running', steps: [], runs: [] } }
        : pick.type === 'production'
        ? { id: jid, type: 'production', step: 'plan', motive: pick.motive || '', startedAt: now(), steps: 0, attempts: 0, source: pick.source, rec: { id: jid, origin: 'server', at: now(), date, status: 'running', steps: [], runs: [], audits: [], revisions: 0, rakutenCalls: 0, sourceCount: pick.source.length } }
        : pick.type === 'rescue'
        // 候補の再審査：もとの仕事の検索結果（比較の相手）と候補の最新の版を写し、コードの確認から始める（楽天の再検索・AIの検索なし）
        ? await startRescue(kv, jid, date, pick.rescue, snap)
        : pick.type === 'buyer'
        ? { id: jid, type: 'buyer', step: 'buyer', startedAt: now(), steps: 0, attempts: 0, session: { id: jid, origin: 'server', at: now(), date, theme: pick.theme, angle: pick.angle || '', auditModel: snap.auditModel || '', status: 'running', steps: [], candidates: [], results: [], searched: [], runs: [], rakutenCalls: 0 } }
        : { id: jid, type: 'outreach', step: 'draft', startedAt: now(), steps: 0, attempts: 0, posts: pick.posts, ids: pick.posts.map((p) => p.id), out: {}, run: { id: jid, origin: 'server', at: now(), status: 'running', posts: pick.posts.map((p) => p.id), themes: snap.themes, steps: [], runs: [], result: {} } };
    }
    const ctx = { kv, env, referer, origin: origin || referer, startedAt, snap: { ...readSnapshot(snap || {}), at: (snap && snap.at) || '' } };
    const before = runsOf(job).length;
    const stepName = job.step;
    let r;
    try { r = job.type === 'buyer' ? await buyerAdvance(job, ctx) : job.type === 'production' ? await productionAdvance(job, ctx) : job.type === 'inspect' ? await inspectAdvance(job, ctx) : job.type === 'measure' ? await measureAdvance(job, ctx) : await outreachAdvance(job, ctx); } catch (e) { r = { fail: String(e && e.message || e).slice(0, 200) }; }
    const newRuns = runsOf(job).slice(before);
    const yen = yenOf(newRuns);
    await budgetRecord(kv, yen, { auto: true });
    job.steps += 1;
    const entry = { trigger, agent: job.type, role: job.type === 'production' ? PROD_ROLE[stepName] : '', jobId: job.id, step: stepName, ok: !r.fail, error: r.fail || '', calls: newRuns.length, yen: Math.round(yen * 1000) / 1000, tokens: newRuns.reduce((a, x) => a + (x.promptTokens || 0) + (x.completionTokens || 0), 0), openaiIds: newRuns.map((x) => x.openaiId).filter(Boolean) };
    if (r.fail) {
      job.attempts += 1;
      health.failures = (health.failures || 0) + 1;
      health.lastError = r.fail;
      if (health.failures >= MAX_ATTEMPTS) health.pausedUntil = new Date(Date.now() + PAUSE_MS).toISOString();
      if (job.attempts >= MAX_ATTEMPTS) { await finishJob(kv, job, 'failed', r.fail, env); await kv.del(K.job); entry.final = 'failed'; }
      else await kv.setJson(K.job, job);
    } else {
      health.failures = 0; health.lastOkAt = now(); job.attempts = 0;
      const max = job.type === 'production' ? MAX_STEPS_PROD : MAX_STEPS;
      if (r.done || job.steps >= max) {
        await finishJob(kv, job, 'done', r.done ? '' : `段階が${max}回を超えたため打ち切り`, env); await kv.del(K.job); entry.final = 'done';
        // 定期実行の記録（GitHub Actions のログ）でも結果が分かるように、制作ラインの要約を付ける
        if (job.type === 'production') { const rc = job.rec; entry.result = rc.result; entry.summary = { title: rc.title || '', why: String(rc.why || '').slice(0, 200), rounds: (rc.audits || []).map((a) => ({ total: a.audit ? a.audit.total : null, decision: a.decision && a.decision.status, flags: a.audit ? Object.keys(a.audit.flags).filter((k) => a.audit.flags[k] === true) : [], codeNg: (a.check ? a.check.checks : []).filter((k) => k.hard && k.ok === false).map((k) => k.key), fixes: a.audit ? a.audit.fixes.length : 0, fixed: (a.fixCheck || []).filter((f) => f.changed).length })) }; }
      }
      else await kv.setJson(K.job, job);
    }
    await log(kv, entry);
    await kv.setJson(K.health, health);
    return { ok: true, worked: entry, triggers: health.triggers || {}, qstashReject: await kv.getJson('worker:qstash:reject') };
  } finally {
    await kv.delIf(K.lock, lockToken).catch(() => {}); // 自分が取った鍵だけを外す（時間切れのあとにほかの実行が取った鍵は外さない）
  }
}

// アプリに渡す：状態・成果物・記録
export async function state(kv, env) {
  const paused = await kv.getJson(K.paused);
  const [health, job, snap, log2, buyer, outreach, oruns, production, board] = await Promise.all([kv.getJson(K.health), kv.getJson(K.job), kv.getJson(K.snap), kv.listJson(K.log, 40), kv.listJson(K.buyer, 15), kv.listJson(K.outreach, 60), kv.listJson(K.oruns, 20), kv.listJson(K.prod, 20), kv.getJson(K.board)]);
  const { spent, limits } = await import('./budget.js');
  return {
    configured: true, at: now(), health: health || {}, qstashReject: await kv.getJson('worker:qstash:reject'), snapshotAt: snap ? snap.at : '', paused: paused && paused.on ? paused : null,
    job: job ? { id: job.id, type: job.type, role: job.type === 'production' ? PROD_ROLE[job.step] : '', step: job.step, startedAt: job.startedAt, attempts: job.attempts } : null,
    budget: { spent: await spent(kv), limits: limits(env) }, quota: QUOTA,
    log: log2, buyer, outreach, outreachRuns: oruns, production: production || [], board: board || null,
    store: { capacity: await S.capacity(kv), meta: await S.meta(kv), limits: { ready: S.READY_MAX, shelf: S.SHELF_MAX } },
    inspect: (await kv.listJson('worker:results:inspect', 10)) || [], measure: (await kv.listJson('worker:results:measure', 10)) || [],
    backlog: snap ? (await backlog(kv, readSnapshot(snap))).length : 0
  };
}
export { K as WORKER_KEYS };
export function summarizeRuns(runs) { return summarize(runs || []); }
