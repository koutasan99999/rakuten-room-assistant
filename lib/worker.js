// 自律運営のワーカー（2026-11-14）：アプリを閉じていても、AI社員が定期的に仕事を進める。
// 定期実行（GitHub Actions：15分ごと／Vercel Cron：1日1回の予備）が /api/worker を呼ぶたびに、仕事を「1段階だけ」進めて保存する（1回60秒以内）。
// 守ること：
//  - 二重実行の防止：保存場所の鍵（worker:lock、58秒で自然に外れる）を取れたときだけ動く
//  - 無限ループの防止：1回1段階・修正は最大2回・1つの仕事は最大10段階・24時間で打ち切り・1日の仕事の数に上限
//  - API障害：同じ段階は3回まで。連続3回失敗したら6時間休む（失敗の理由を記録して画面に出す）
//  - 費用：サーバー側で、月の上限（全体）と自律運営の1日の上限を確かめてから動き、実測の費用を記録する（lib/budget.js）
//  - 対外的な行動（投稿・コメント・フォロー・商品の採用）はしない。成果物を作って、社長の承認待ちにするだけ
// AI社員の仕事：バイヤーAI（楽天で探す→コードの確認→監査AI→修正）、営業・交流担当AI（文章を確認できた投稿へのコメント案→監査AI→修正）
import crypto from 'node:crypto';
import { buyerStep, checkStep, auditStep, reviseStep, decide, MAX_REVISIONS } from './agents.js';
import { draftStep, auditStep as outreachAudit, checkComment, decide as outreachDecide } from './outreach.js';
import { check as budgetCheck, record as budgetRecord, jstDate } from './budget.js';
import { summarize } from './ai-usage.js';

export const QUOTA = { buyer: 2, outreach: 3 }; // 1日に始める仕事の数
export const MAX_PENDING_BUYER = 6;              // 社長の判断待ちの候補がこれ以上あれば、バイヤーAIは新しく探さない
const MAX_STEPS = 10;
const MAX_ATTEMPTS = 3;
const PAUSE_MS = 6 * 3600000;
const JOB_TTL_MS = 24 * 3600000;
const K = { lock: 'worker:lock', job: 'worker:job', health: 'worker:health', snap: 'worker:snapshot', log: 'worker:log', buyer: 'worker:results:buyer', outreach: 'worker:results:outreach', oruns: 'worker:runs:outreach', themeIdx: 'worker:themeIdx' };
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
    auditModel: s(x.auditModel, 30)
  };
}

async function log(kv, entry) { await kv.pushJson(K.log, { at: now(), ...entry }, 200); }

// ---- 仕事を選ぶ（売上につながる順：新しい人への交流 → 商品の候補） ----
async function pickJob(kv, snap, date) {
  const doneOut = new Set(((await kv.listJson(K.outreach, 100)) || []).map((r) => r.postId));
  const posts = snap.outreachPosts.filter((p) => !doneOut.has(p.id)).slice(0, 5);
  const used = async (t) => Number(await kv.get(`worker:quota:${date}:${t}`)) || 0;
  if (posts.length && await used('outreach') < QUOTA.outreach) return { type: 'outreach', posts };
  if (snap.themes.length && snap.pendingBuyer < MAX_PENDING_BUYER && await used('buyer') < QUOTA.buyer) {
    const i = Number(await kv.get(K.themeIdx)) || 0;
    await kv.set(K.themeIdx, String(i + 1));
    return { type: 'buyer', theme: snap.themes[i % snap.themes.length] };
  }
  return null;
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
    sess.candidates = (d.candidates || []).map((c) => ({ id: c.id, status: 'running', versions: [{ v: 1, data: c, at: now() }], revisions: 0 }));
    end(st, true, `${sess.candidates.length}件`);
    if (!sess.candidates.length) { sess.note = `候補が0件でした（数合わせはしていません）${d.notes ? `：${d.notes}` : ''}`; return { done: true }; }
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

// 仕事の終わり：成果物を保存（アプリが取りに来る）
async function finishJob(kv, job, status, error) {
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
    if (job && Date.now() - new Date(job.startedAt).getTime() > JOB_TTL_MS) { await finishJob(kv, job, 'failed', '24時間で終わらなかったため打ち切り'); await log(kv, { agent: job.type, jobId: job.id, ok: false, step: job.step, error: '24時間で打ち切り' }); await kv.del(K.job); job = null; }
    if (!job) {
      if (!snap) { await kv.setJson(K.health, health); return { ok: true, skipped: 'アプリの情報がまだ届いていません（アプリを1回開くと届きます）' }; }
      const pick = await pickJob(kv, snap, date);
      if (!pick) { health.lastIdle = now(); await kv.setJson(K.health, health); return { ok: true, idle: '今日の仕事は終わりました（または、する仕事がありません）' }; }
      await kv.incr(`worker:quota:${date}:${pick.type}`); await kv.expire(`worker:quota:${date}:${pick.type}`, 3 * 86400);
      const jid = id(pick.type === 'buyer' ? 'srvb' : 'srvo');
      job = pick.type === 'buyer'
        ? { id: jid, type: 'buyer', step: 'buyer', startedAt: now(), steps: 0, attempts: 0, session: { id: jid, origin: 'server', at: now(), date, theme: pick.theme, auditModel: snap.auditModel || '', status: 'running', steps: [], candidates: [], results: [], searched: [], runs: [], rakutenCalls: 0 } }
        : { id: jid, type: 'outreach', step: 'draft', startedAt: now(), steps: 0, attempts: 0, posts: pick.posts, ids: pick.posts.map((p) => p.id), out: {}, run: { id: jid, origin: 'server', at: now(), status: 'running', posts: pick.posts.map((p) => p.id), themes: snap.themes, steps: [], runs: [], result: {} } };
    }
    const ctx = { kv, env, referer, startedAt, snap: snap || readSnapshot({}) };
    const before = (job.type === 'buyer' ? job.session.runs : job.run.runs).length;
    const stepName = job.step;
    let r;
    try { r = job.type === 'buyer' ? await buyerAdvance(job, ctx) : await outreachAdvance(job, ctx); } catch (e) { r = { fail: String(e && e.message || e).slice(0, 200) }; }
    const newRuns = (job.type === 'buyer' ? job.session.runs : job.run.runs).slice(before);
    const yen = yenOf(newRuns);
    await budgetRecord(kv, yen, { auto: true });
    job.steps += 1;
    const entry = { agent: job.type, jobId: job.id, step: stepName, ok: !r.fail, error: r.fail || '', calls: newRuns.length, yen: Math.round(yen * 1000) / 1000, tokens: newRuns.reduce((a, x) => a + (x.promptTokens || 0) + (x.completionTokens || 0), 0), openaiIds: newRuns.map((x) => x.openaiId).filter(Boolean) };
    if (r.fail) {
      job.attempts += 1;
      health.failures = (health.failures || 0) + 1;
      health.lastError = r.fail;
      if (health.failures >= MAX_ATTEMPTS) health.pausedUntil = new Date(Date.now() + PAUSE_MS).toISOString();
      if (job.attempts >= MAX_ATTEMPTS) { await finishJob(kv, job, 'failed', r.fail); await kv.del(K.job); entry.final = 'failed'; }
      else await kv.setJson(K.job, job);
    } else {
      health.failures = 0; health.lastOkAt = now(); job.attempts = 0;
      if (r.done || job.steps >= MAX_STEPS) { await finishJob(kv, job, 'done', r.done ? '' : `段階が${MAX_STEPS}回を超えたため打ち切り`); await kv.del(K.job); entry.final = 'done'; }
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
  const [health, job, snap, log2, buyer, outreach, oruns] = await Promise.all([kv.getJson(K.health), kv.getJson(K.job), kv.getJson(K.snap), kv.listJson(K.log, 40), kv.listJson(K.buyer, 15), kv.listJson(K.outreach, 60), kv.listJson(K.oruns, 20)]);
  const { spent, limits } = await import('./budget.js');
  return {
    configured: true, at: now(), health: health || {}, snapshotAt: snap ? snap.at : '',
    job: job ? { id: job.id, type: job.type, step: job.step, startedAt: job.startedAt, attempts: job.attempts } : null,
    budget: { spent: await spent(kv), limits: limits(env) }, quota: QUOTA,
    log: log2, buyer, outreach, outreachRuns: oruns
  };
}
export { K as WORKER_KEYS };
export function summarizeRuns(runs) { return summarize(runs || []); }
