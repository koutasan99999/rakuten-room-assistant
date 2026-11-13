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
import { check as budgetCheck, record as budgetRecord, jstDate } from './budget.js';
import { summarize } from './ai-usage.js';
import * as P from './production.js';

export const QUOTA = { production: 3, buyer: 2, outreach: 3 }; // 1日に始める仕事の数
export const ESTIMATE = { production: 6, outreach: 2, buyer: 4 }; // 1つの仕事の費用の見込み（円・実測の記録から）
export const MAX_BACKLOG = 4;       // 投稿セットにまだ使っていない合格候補がこれ以上あれば、バイヤーAIは新しく探さない（制作が追いつくのを待つ）
export const MAX_PENDING_SETS = 6;  // 社長の確認待ちの投稿セットがこれ以上あれば、新しく作らない（見られないものに費用をかけない）
export const MAX_PENDING_BUYER = MAX_BACKLOG; // 互換
const MAX_STEPS = 10;
const MAX_STEPS_PROD = 12;
const MAX_ATTEMPTS = 3;
const PAUSE_MS = 6 * 3600000;
const JOB_TTL_MS = 24 * 3600000;
const K = { lock: 'worker:lock', job: 'worker:job', health: 'worker:health', snap: 'worker:snapshot', log: 'worker:log', buyer: 'worker:results:buyer', outreach: 'worker:results:outreach', oruns: 'worker:runs:outreach', themeIdx: 'worker:themeIdx', prod: 'worker:results:production', used: 'worker:prod:used', board: 'worker:board' };
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

// ---- 仕事探し：各社員が、今ある未処理の仕事から自分ができるものを探す ----
// 投稿セットにまだ使っていない合格候補（新しい順）
export async function backlog(kv, snap) {
  const used = new Set((await kv.getJson(K.used)) || []);
  const skip = new Set([...(snap.setCodes || []), ...(snap.skipCodes || [])]);
  const out = [];
  const seen = new Set();
  for (const sess of (await kv.listJson(K.buyer, 30)) || []) {
    for (const c of sess.candidates || []) {
      if (c.status !== 'pass') continue;
      const v = c.versions[c.versions.length - 1];
      const d = v.data || {};
      if (!d.code || used.has(d.code) || skip.has(d.code) || seen.has(d.code)) continue;
      seen.add(d.code);
      out.push({ ...d, score: v.audit ? v.audit.total : null, sessionId: sess.id, candidateId: c.id });
    }
  }
  return out;
}
async function findWork(kv, snap, date, budget) {
  const used = async (t) => Number(await kv.get(`worker:quota:${date}:${t}`)) || 0;
  const left = Math.max(0, (budget.limits.dayAuto || 0) - (budget.spent.dayAuto || 0));
  const board = [];
  let pick = null;
  const note = (agent, status, reason) => board.push({ agent, status, reason });
  const can = async (type) => {
    if (await used(type) >= QUOTA[type]) return `今日の上限（${QUOTA[type]}件）まで仕事をしました`;
    if (left < ESTIMATE[type]) return `今日の自律運営の費用の残り（${Math.round(left * 10) / 10}円）が、この仕事の見込み（${ESTIMATE[type]}円）より少ない`;
    return '';
  };
  // 1. 制作ライン：合格候補 → 投稿セット
  const bl = await backlog(kv, snap);
  const prodDone = ((await kv.listJson(K.prod, 30)) || []).filter((r) => r.result === 'pass' && r.endedAt > snap.at).length;
  const pendingSets = (snap.pendingSets || 0) + prodDone;
  if (!bl.length) note('production', 'none', '投稿セットにまだ使っていない合格候補がない');
  else if (pendingSets >= MAX_PENDING_SETS) note('production', 'wait', `社長の確認待ちの投稿セットが${pendingSets}件あるため、新しく作らない`);
  else { const why = await can('production'); if (why) note('production', 'wait', why); else { note('production', 'work', `合格候補${bl.length}件から投稿セットを作る`); pick = { type: 'production', source: bl.slice(0, P.MAX_SOURCE) }; } }
  // 2. 営業・交流担当AI：文章のある交流候補
  const doneOut = new Set(((await kv.listJson(K.outreach, 100)) || []).map((r) => r.postId));
  const posts = snap.outreachPosts.filter((p) => !doneOut.has(p.id)).slice(0, 5);
  if (!posts.length) note('outreach', 'none', '文章を確認できた交流候補（社長が追加・公式API）がない');
  else if (pick) note('outreach', 'wait', `交流候補${posts.length}件。前の仕事のあとに進める`);
  else { const why = await can('outreach'); if (why) note('outreach', 'wait', why); else { note('outreach', 'work', `交流候補${posts.length}件のコメント案を作る`); pick = { type: 'outreach', posts }; } }
  // 3. バイヤーAI：テーマから商品の候補
  if (!snap.themes.length) note('buyer', 'none', '探すテーマがない（採用した商品・投稿セットがまだない）');
  else if (bl.length >= MAX_BACKLOG) note('buyer', 'wait', `投稿セットにまだ使っていない合格候補が${bl.length}件あるため、制作が進むのを待つ`);
  else if (pick) note('buyer', 'wait', '前の仕事のあとに進める');
  else {
    const why = await can('buyer');
    if (why) note('buyer', 'wait', why);
    else {
      const i = Number(await kv.get(K.themeIdx)) || 0;
      await kv.set(K.themeIdx, String(i + 1));
      const theme = snap.themes[i % snap.themes.length];
      note('buyer', 'work', `テーマ「${theme}」で商品の候補を探す`);
      pick = { type: 'buyer', theme };
    }
  }
  return { pick, board: { at: now(), items: board } };
}

// ---- バイヤーAI：1段階ずつ ----
async function buyerAdvance(job, ctx) {
  const sess = job.session;
  const step = (name) => { const st = { name, status: 'running', startedAt: now() }; sess.steps.push(st); return st; };
  const end = (st, ok, note) => { st.status = ok ? 'ok' : 'failed'; st.endedAt = now(); if (note) st.note = note; };
  const cur = (c) => c.versions[c.versions.length - 1];
  if (job.step === 'buyer') {
    const st = step('バイヤーAI：検索語を決めて楽天で検索し、候補を選ぶ（AI 2回・楽天の検索）');
    const d = await buyerStep({ theme: sess.theme, avoid: ctx.snap.avoid, env: ctx.env, referer: ctx.referer, startedAt: ctx.startedAt });
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
export const PROD_ROLE = { plan: 'planner', gather: 'planner', pick: 'planner', copy: 'producer', roomtext: 'producer', audit: 'auditor', revise: 'editor' };
async function productionAdvance(job, ctx) {
  const rec = job.rec;
  const step = (name) => { const st = { name, role: PROD_ROLE[job.step], status: 'running', startedAt: now() }; rec.steps.push(st); return st; };
  const end = (st, ok, note) => { st.status = ok ? 'ok' : 'failed'; st.endedAt = now(); if (note) st.note = String(note).slice(0, 200); };
  const base = { env: ctx.env, referer: ctx.referer, startedAt: ctx.startedAt };
  const take = (d) => { rec.runs.push(...(d.runs || [])); return d; };
  if (job.step === 'plan') {
    const st = step('企画担当AI：合格候補を中心に、投稿の企画を決める（AI 1回）');
    const d = take(await P.planStep({ source: job.source, history: ctx.snap.history, recentPatterns: ctx.snap.recentPatterns, ...base }));
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
    rec.score = d.audit.total; rec.why = dc.why;
    end(st, true, `${d.audit.total}点・${({ pass: '合格', revise: '修正', hold: '保留', reject: '不合格' })[dc.status] || dc.status}`);
    if (dc.status === 'revise' && rec.revisions < P.MAX_REVISIONS) { job.step = 'revise'; return {}; }
    rec.result = dc.status === 'pass' ? 'pass' : dc.status === 'revise' ? 'hold' : dc.status;
    return { done: true };
  }
  if (job.step === 'revise') {
    const st = step(`制作担当AI：監査AIの指示で修正（${rec.revisions + 1}回目）`);
    const d = take(await P.editStep({ set: job.set, audit: job.lastAudit.audit, check: job.lastAudit.check, ...base }));
    if (!d.ok) { end(st, false, d.error); return { fail: `${d.failedStep}：${d.error}` }; }
    rec.revisions += 1;
    if (d.edit.giveUp && !d.edit.caption && !d.edit.room.length) { end(st, true, `直せない：${d.edit.giveUp}`); rec.result = 'hold'; rec.why = `追加の情報が必要（推測で補わない）：${d.edit.giveUp}`; return { done: true }; }
    const a = P.applyEdit(job.set, d.edit);
    job.set = a.set;
    end(st, true, `${a.changed.join('・') || '変更なし'}を修正`);
    job.step = 'audit'; return {};
  }
  return { fail: `不明な段階 ${job.step}` };
}

// 仕事の終わり：成果物を保存（アプリが取りに来る）
async function finishJob(kv, job, status, error) {
  if (job.type === 'production') {
    const rec = job.rec;
    rec.status = status; rec.endedAt = now();
    if (error) { rec.failedStep = (rec.steps[rec.steps.length - 1] || {}).name || job.step; rec.error = error; rec.result = 'failed'; }
    if (!rec.result) { rec.result = 'hold'; rec.why = rec.why || `段階が${MAX_STEPS_PROD}回を超えたため打ち切り`; }
    // 合格した投稿セットだけ、社長の確認待ちとしてアプリへ渡す（保留・不合格は日報に理由を残すだけ）
    if (rec.result === 'pass') rec.set = { ...job.set, auto: { id: rec.id, score: rec.score, why: rec.why, revisions: rec.revisions } };
    // 使った合格候補は、二度と使わない（失敗したときは、次に使えるよう残す）
    if (status !== 'failed') { const used = (await kv.getJson(K.used)) || []; await kv.setJson(K.used, [...new Set([...job.source.map((c) => c.code), ...used])].slice(0, 300)); }
    rec.source = job.source.map((c) => ({ code: c.code, name: String(c.name).slice(0, 40), price: c.price, score: c.score, sessionId: c.sessionId, candidateId: c.candidateId }));
    await kv.pushJson(K.prod, rec, 20);
    return;
  }
  if (job.type === 'buyer') {
    const sess = job.session;
    sess.candidates.forEach((c) => { if (c.status === 'revise' || c.status === 'running') { c.status = 'hold'; c.why = `${c.why ? `${c.why}。` : ''}修正${MAX_REVISIONS}回でも合格にならなかった（無理に合格にしない）`; } });
    sess.status = status; sess.endedAt = now();
    if (error) { sess.failedStep = (sess.steps[sess.steps.length - 1] || {}).name || job.step; sess.error = error; }
    sess.results = (sess.results || []).slice(0, 24);
    await kv.pushJson(K.buyer, sess, 30);
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

// 1回の定期実行
export async function tick({ kv, env, referer = '', startedAt = Date.now(), date = jstDate() }) {
  const lock = await kv.set(K.lock, String(startedAt), { nx: true, ex: 58 });
  if (!lock) return { ok: true, skipped: '前の実行がまだ動いています（二重実行の防止）' };
  try {
    const health = (await kv.getJson(K.health)) || { failures: 0 };
    health.lastTickAt = now();
    if (health.pausedUntil && new Date(health.pausedUntil).getTime() > Date.now()) { await kv.setJson(K.health, health); return { ok: true, skipped: `休止中（${health.pausedUntil} まで）：${health.lastError || ''}` }; }
    if (!env.OPENAI_API_KEY || !env.RAKUTEN_APP_ID) { await kv.setJson(K.health, health); return { ok: false, skipped: 'サーバーの鍵（OpenAI・楽天）がありません' }; }
    const budget = await budgetCheck(kv, env, { estimate: 3, auto: true });
    if (!budget.ok) { health.lastSkip = budget.reason; await kv.setJson(K.health, health); return { ok: true, skipped: budget.reason, budget }; }
    const snap = await kv.getJson(K.snap);
    let job = await kv.getJson(K.job);
    const runsOf = (j) => (j.type === 'buyer' ? j.session.runs : j.type === 'production' ? j.rec.runs : j.run.runs);
    if (job && Date.now() - new Date(job.startedAt).getTime() > JOB_TTL_MS) { await finishJob(kv, job, 'failed', '24時間で終わらなかったため打ち切り'); await log(kv, { agent: job.type, jobId: job.id, ok: false, step: job.step, error: '24時間で打ち切り' }); await kv.del(K.job); job = null; }
    if (!job) {
      if (!snap) { await kv.setJson(K.health, health); return { ok: true, skipped: 'アプリの情報がまだ届いていません（アプリを1回開くと届きます）' }; }
      const found = await findWork(kv, { ...readSnapshot(snap), at: snap.at || '' }, date, budget);
      await kv.setJson(K.board, found.board);
      const pick = found.pick;
      if (!pick) { health.lastIdle = now(); await kv.setJson(K.health, health); return { ok: true, idle: '今できる仕事はありません（社員ごとの理由は仕事探しの記録に残しました）', board: found.board }; }
      await kv.incr(`worker:quota:${date}:${pick.type}`); await kv.expire(`worker:quota:${date}:${pick.type}`, 3 * 86400);
      const jid = id(pick.type === 'buyer' ? 'srvb' : pick.type === 'production' ? 'srvp' : 'srvo');
      job = pick.type === 'production'
        ? { id: jid, type: 'production', step: 'plan', startedAt: now(), steps: 0, attempts: 0, source: pick.source, rec: { id: jid, origin: 'server', at: now(), date, status: 'running', steps: [], runs: [], audits: [], revisions: 0, rakutenCalls: 0, sourceCount: pick.source.length } }
        : pick.type === 'buyer'
        ? { id: jid, type: 'buyer', step: 'buyer', startedAt: now(), steps: 0, attempts: 0, session: { id: jid, origin: 'server', at: now(), date, theme: pick.theme, auditModel: snap.auditModel || '', status: 'running', steps: [], candidates: [], results: [], searched: [], runs: [], rakutenCalls: 0 } }
        : { id: jid, type: 'outreach', step: 'draft', startedAt: now(), steps: 0, attempts: 0, posts: pick.posts, ids: pick.posts.map((p) => p.id), out: {}, run: { id: jid, origin: 'server', at: now(), status: 'running', posts: pick.posts.map((p) => p.id), themes: snap.themes, steps: [], runs: [], result: {} } };
    }
    const ctx = { kv, env, referer, startedAt, snap: { ...readSnapshot(snap || {}), at: (snap && snap.at) || '' } };
    const before = runsOf(job).length;
    const stepName = job.step;
    let r;
    try { r = job.type === 'buyer' ? await buyerAdvance(job, ctx) : job.type === 'production' ? await productionAdvance(job, ctx) : await outreachAdvance(job, ctx); } catch (e) { r = { fail: String(e && e.message || e).slice(0, 200) }; }
    const newRuns = runsOf(job).slice(before);
    const yen = yenOf(newRuns);
    await budgetRecord(kv, yen, { auto: true });
    job.steps += 1;
    const entry = { agent: job.type, role: job.type === 'production' ? PROD_ROLE[stepName] : '', jobId: job.id, step: stepName, ok: !r.fail, error: r.fail || '', calls: newRuns.length, yen: Math.round(yen * 1000) / 1000, tokens: newRuns.reduce((a, x) => a + (x.promptTokens || 0) + (x.completionTokens || 0), 0), openaiIds: newRuns.map((x) => x.openaiId).filter(Boolean) };
    if (r.fail) {
      job.attempts += 1;
      health.failures = (health.failures || 0) + 1;
      health.lastError = r.fail;
      if (health.failures >= MAX_ATTEMPTS) health.pausedUntil = new Date(Date.now() + PAUSE_MS).toISOString();
      if (job.attempts >= MAX_ATTEMPTS) { await finishJob(kv, job, 'failed', r.fail); await kv.del(K.job); entry.final = 'failed'; }
      else await kv.setJson(K.job, job);
    } else {
      health.failures = 0; health.lastOkAt = now(); job.attempts = 0;
      const max = job.type === 'production' ? MAX_STEPS_PROD : MAX_STEPS;
      if (r.done || job.steps >= max) { await finishJob(kv, job, 'done', r.done ? '' : `段階が${max}回を超えたため打ち切り`); await kv.del(K.job); entry.final = 'done'; if (job.type === 'production') entry.result = job.rec.result; }
      else await kv.setJson(K.job, job);
    }
    await log(kv, entry);
    await kv.setJson(K.health, health);
    return { ok: true, worked: entry };
  } finally {
    await kv.del(K.lock).catch(() => {});
  }
}

// アプリに渡す：状態・成果物・記録
export async function state(kv, env) {
  const [health, job, snap, log2, buyer, outreach, oruns, production, board] = await Promise.all([kv.getJson(K.health), kv.getJson(K.job), kv.getJson(K.snap), kv.listJson(K.log, 40), kv.listJson(K.buyer, 15), kv.listJson(K.outreach, 60), kv.listJson(K.oruns, 20), kv.listJson(K.prod, 20), kv.getJson(K.board)]);
  const { spent, limits } = await import('./budget.js');
  return {
    configured: true, at: now(), health: health || {}, snapshotAt: snap ? snap.at : '',
    job: job ? { id: job.id, type: job.type, role: job.type === 'production' ? PROD_ROLE[job.step] : '', step: job.step, startedAt: job.startedAt, attempts: job.attempts } : null,
    budget: { spent: await spent(kv), limits: limits(env) }, quota: QUOTA,
    log: log2, buyer, outreach, outreachRuns: oruns, production: production || [], board: board || null,
    backlog: snap ? (await backlog(kv, readSnapshot(snap))).length : 0
  };
}
export { K as WORKER_KEYS };
export function summarizeRuns(runs) { return summarize(runs || []); }
