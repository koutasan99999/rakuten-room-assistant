// サングラスくま株式会社 2.0：広報のInstagram交流（2026-11-16・常設の仕事）
//   広報が「交流候補の投稿」にコメント案を作り → 監査が採点（別のAI呼び出し）→ 合格した案だけを社長の承認待ちにする。
//   コメントの送信はしない（Instagramの公式APIに、他の人の投稿へのコメント・いいね・フォローの機能は無い。非公式な自動操作もしない）。
//   社長が承認した案を、社長がInstagramで自分で送り、「送った」「送れなかった」を記録する（社長の申告として残す。Instagramとは未照合）。
//   交流候補（コメント案を作ってよい投稿）は、投稿の文章を確認できたものだけ：
//     (1) 社長が追加（投稿のURLと文章を貼る）
//     (2) Facebookログイン方式の公式API（IG_FB_ACCESS_TOKEN・IG_FB_USER_ID）で、関連アカウントの直近の投稿を集める（未設定なら動かない）
//   関連アカウント：ブランドの公式サイトのHTMLがリンクしているInstagram（費用0円・推測しない。lib/ig-discovery.js）
//   スパムを防ぐ決まり：1日に作る案は DAY_DRAFTS 件まで／同じアカウントには7日に1件まで／1つの投稿に1件／過去の案と似すぎた案はコードが不合格にする／定型の褒め言葉・宣伝・絵文字はコードと監査で落とす
import crypto from 'node:crypto';
import { draftStep, auditStep, checkComment, decide as outreachDecide } from '../outreach.js';
import { MAX_REVISIONS } from '../agents.js';
import { siteTargets, discoverFromSites, fbConfig, businessDiscovery, freshPosts, OFFICIAL_SITES } from '../ig-discovery.js';
import { add as commentLogAdd, list as commentLogList, withReview } from '../comment-log.js';
import { jstDate } from '../budget.js';

const K = { targets: 'v2:pr:targets', drafts: 'v2:pr:drafts', accounts: 'v2:pr:accounts', state: 'v2:pr:state', sets: 'v2:sets', leads: 'v2:pr:leads' };
export { K as PR_KEYS };
export const DAY_DRAFTS = 3;          // 1日に作るコメント案の上限（連投・量産をしない）
export const HANDLE_DAYS = 7;         // 同じアカウントへの案は7日に1件まで
export const SITES_EVERY_DAYS = 7;    // 公式サイトから関連アカウントを探し直す間隔
export const FB_EVERY_HOURS = 24;     // 公式APIで直近の投稿を集める間隔
export const PR_ESTIMATE_YEN = 1;     // コメント案1件の見込み（実測は記録に残る）
const now = () => new Date().toISOString();
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const POST_RE = /^https:\/\/(?:www\.)?instagram\.com\/(p|reel)\/([A-Za-z0-9_-]{5,40})\/?/;
export const STATUS_LABEL = { audit: '監査の採点待ち', revise: '広報が直す', approval: '社長の承認待ち', approved: '承認済み（社長がInstagramで送る）', sent: '送った（社長の申告）', failed: '送れなかった（社長の申告）', rejected: '社長が見送り', dropped: '監査で不合格（送らない）' };

async function getList(kv, k) { const v = await kv.getJson(k); return Array.isArray(v) ? v : []; }

// 社長が交流候補の投稿を追加する（URLと、Instagramで見えている投稿の文章）
export async function addTarget(kv, { url, caption, handle = '', note = '' }) {
  const m = String(url || '').trim().match(POST_RE);
  if (!m) throw new Error('Instagramの投稿のURL（https://www.instagram.com/p/… か /reel/…）を入れてください');
  const cap = String(caption || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 1000);
  if (cap.length < 5) throw new Error('投稿の文章を貼ってください（文章が無い投稿には、内容を推測してコメント案を作りません）');
  const id = m[2];
  const list = await getList(kv, K.targets);
  if (list.some((t) => t.id === id)) throw new Error('その投稿はもう入っています');
  const h = str(handle, 30).replace(/^@/, '').toLowerCase();
  const t = { id, url: `https://www.instagram.com/${m[1]}/${id}/`, handle: /^[a-z0-9._]{1,30}$/.test(h) ? h : '', caption: cap, source: 'owner', sourceLabel: '社長が追加', note: str(note, 80), addedAt: now(), status: 'new' };
  await kv.setJson(K.targets, [t, ...list].slice(0, 100));
  return t;
}

function themesFrom(sets) { return sets.slice(0, 8).map((s) => s.title).filter(Boolean); }
async function pastComments(kv) { return (await getList(kv, K.drafts)).map((d) => d.comment).filter(Boolean).slice(0, 30); }
const today = () => jstDate();

// 広報の仕事探し：本当に必要な仕事だけ（無ければ、理由つきで「仕事なし」）
export async function prWork(kv, env, { elapsed = () => 0 } = {}) {
  const drafts = await getList(kv, K.drafts);
  const st = (await kv.getJson(K.state)) || {};
  // (1) 監査で「直す」になった案
  const rev = drafts.find((d) => d.status === 'revise');
  if (rev) return { kind: 'pr-revise', task: `監査の指摘に合わせて、@${rev.handle || '不明'} へのコメント案を直す`, doing: 'コメント案を直しています', est: PR_ESTIMATE_YEN, run: (ctx) => draftRun(kv, ctx, rev.postId, true) };
  // (2) 新しい交流候補にコメント案（1日の上限・同じアカウントの間隔）
  const madeToday = drafts.filter((d) => d.createdAt && jstDate(new Date(d.createdAt)) === today()).length;
  const targets = await getList(kv, K.targets);
  const recentHandles = new Set(drafts.filter((d) => d.handle && Date.now() - Date.parse(d.createdAt || 0) < HANDLE_DAYS * 86400000 && !['dropped', 'rejected'].includes(d.status)).map((d) => d.handle));
  const fresh = targets.filter((t) => t.status === 'new' && t.caption && t.caption.length >= 5 && !drafts.some((d) => d.postId === t.id)).reverse(); // 先に入った候補から
  const t = fresh.find((x) => !x.handle || !recentHandles.has(x.handle));
  if (t && madeToday < DAY_DRAFTS) return { kind: 'pr-draft', task: `交流候補（@${t.handle || '不明'}・${t.sourceLabel}）の投稿の文章を読んで、コメント案を作る`, doing: '交流候補の投稿にコメント案を作っています', est: PR_ESTIMATE_YEN, run: (ctx) => draftRun(kv, ctx, t.id, false) };
  // (3) 関連アカウントを探す（公式サイト・0円・7日ごと）
  // 調べていない公式サイトがある、またはいちばん古い確認から7日たったら（1回に10サイトまで・古い順）
  const checks = st.siteChecks || {};
  const due = Object.keys(OFFICIAL_SITES).filter((b) => !checks[b] || Date.now() - Date.parse(checks[b]) > SITES_EVERY_DAYS * 86400000);
  if (due.length) return { kind: 'pr-sites', task: 'ブランドの公式サイトがリンクしているInstagram（関連アカウント）を探す（AIは使わない）', doing: '公式サイトから関連アカウントを探しています', est: 0, run: () => sitesRun(kv, elapsed) };
  // (4) 公式APIで関連アカウントの直近の投稿を集める（設定があるときだけ・1日1回）
  const fb = fbConfig(env);
  const accounts = await getList(kv, K.accounts);
  if (fb.ready && accounts.length && (!st.fbAt || Date.now() - Date.parse(st.fbAt) > FB_EVERY_HOURS * 3600000)) return { kind: 'pr-fb', task: `公式APIで関連アカウント${Math.min(5, accounts.length)}件の直近の投稿を集める（AIは使わない）`, doing: '公式APIで関連アカウントの投稿を集めています', est: 0, run: () => fbRun(kv, fb, accounts) };
  const why = [];
  if (t && madeToday >= DAY_DRAFTS) why.push(`今日のコメント案は上限の${DAY_DRAFTS}件まで作った（連投・量産をしない）`);
  else if (fresh.length && !t) why.push(`残りの交流候補は、${HANDLE_DAYS}日以内にコメント案を作ったアカウントだけ`);
  else why.push('文章を確認できた交流候補が無い');
  if (!fb.ready) why.push('公式API（Facebookログイン方式）が未設定のため、投稿を自動では集められない。社長が投稿のURLと文章を追加すると作れる');
  const waiting = drafts.filter((d) => d.status === 'approval').length;
  return { none: why.join('。'), approval: waiting };
}

// 監査の仕事探し（広報のコメント案の採点）
export async function prAuditWork(kv) {
  const d = (await getList(kv, K.drafts)).find((x) => x.status === 'audit');
  if (!d) return null;
  return { kind: 'pr-audit', task: `広報のコメント案（@${d.handle || '不明'}）を採点する`, doing: '広報のコメント案を採点しています', est: PR_ESTIMATE_YEN, run: (ctx) => auditRun(kv, ctx, d.postId) };
}

async function saveDraft(kv, d) {
  const list = await getList(kv, K.drafts);
  await kv.setJson(K.drafts, [d, ...list.filter((x) => x.postId !== d.postId)].slice(0, 100));
}
async function setTarget(kv, id, patch) {
  const list = await getList(kv, K.targets);
  await kv.setJson(K.targets, list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

async function draftRun(kv, ctx, postId, revise) {
  const t = (await getList(kv, K.targets)).find((x) => x.id === postId);
  if (!t) return { fail: '交流候補が見つからない' };
  const old = (await getList(kv, K.drafts)).find((x) => x.postId === postId) || null;
  const post = { id: t.id, url: t.url, handle: t.handle, caption: t.caption, source: t.sourceLabel };
  const sets = await getList(kv, K.sets);
  const past = (await pastComments(kv)).filter((c) => !old || c !== old.comment);
  const r = await draftStep({ posts: [post], themes: themesFrom(sets), past, env: ctx.env, startedAt: Date.now(), revise: revise && old ? [{ id: t.id, comment: old.comment, anchor: old.anchor, why: old.why, fixes: old.fixes || [] }] : null });
  if (!r.ok) {
    // 同じ投稿で2回うまくいかなければ、その投稿は見送る（毎回AIを呼び続けない）
    const tries = (t.tries || 0) + 1;
    await setTarget(kv, postId, tries >= 2 ? { status: 'skipped', tries, why: `コメント案を作れなかった（${String(r.error || '').slice(0, 60)}）` } : { tries });
    if (old && tries >= 2) await saveDraft(kv, { ...old, status: 'dropped', why: '直した案を作れなかった', history: [...(old.history || []), { at: now(), by: 'pr', text: '直した案を作れなかったので見送り' }] });
    return { fail: `${r.failedStep || 'コメント案'}：${r.error}${tries >= 2 ? '（この投稿は見送る）' : ''}` };
  }
  const x = (r.drafts || [])[0];
  if (!x || x.giveUp) {
    await setTarget(kv, postId, { status: 'skipped', why: x && x.giveUp ? x.giveUp : (r.skipped[0] || {}).why || 'コメント案を作れなかった' });
    if (old) await saveDraft(kv, { ...old, status: 'dropped', why: `直せなかった（${x && x.giveUp ? x.giveUp : '案が返されなかった'}）`, history: [...(old.history || []), { at: now(), by: 'pr', text: '直せなかったので見送り' }] });
    return { done: `@${t.handle || '不明'} の投稿には、コメント案を作らなかった（${x && x.giveUp ? x.giveUp : '投稿の文章から言えることが無い'}）` };
  }
  const d = { id: old ? old.id : `pr${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`, postId, url: t.url, handle: t.handle, source: t.sourceLabel, caption: t.caption.slice(0, 300), comment: x.comment, anchor: x.anchor, relevance: x.relevance, relevanceWhy: x.relevanceWhy, follow: x.follow, followWhy: x.followWhy, status: 'audit', revisions: old ? (old.revisions || 0) + (revise ? 1 : 0) : 0, createdAt: old ? old.createdAt : now(), updatedAt: now(), history: [...((old && old.history) || []), { at: now(), by: 'pr', text: revise ? `直した案「${x.comment}」` : `コメント案「${x.comment}」` }] };
  await saveDraft(kv, d);
  await setTarget(kv, postId, { status: 'drafted' });
  return { done: `@${t.handle || '不明'} の投稿に${revise ? '直した' : ''}コメント案を作った（監査へ）`, handoff: 'auditor' };
}

async function auditRun(kv, ctx, postId) {
  const d = (await getList(kv, K.drafts)).find((x) => x.postId === postId);
  if (!d) return { fail: 'コメント案が見つからない' };
  const t = (await getList(kv, K.targets)).find((x) => x.id === postId) || {};
  const post = { id: postId, url: d.url, handle: d.handle, caption: t.caption || d.caption, source: d.source };
  const past = (await pastComments(kv)).filter((c) => c !== d.comment);
  const draft = { id: postId, comment: d.comment, anchor: d.anchor };
  const check = checkComment(draft, post, past);
  const r = await auditStep({ posts: [post], drafts: [draft], checks: [check], model: '', env: ctx.env, startedAt: Date.now() });
  if (!r.ok) {
    const tries = (d.auditTries || 0) + 1;
    await saveDraft(kv, { ...d, auditTries: tries, ...(tries >= 2 ? { status: 'dropped', why: '採点できなかった（送らない）', history: [...(d.history || []), { at: now(), by: 'auditor', text: '2回続けて採点できなかったので送らない' }] } : {}) });
    return { fail: `${r.failedStep || '採点'}：${r.error}` };
  }
  const au = r.audits[0];
  const dc = outreachDecide({ check, audit: au, revisions: d.revisions || 0 });
  const status = dc.status === 'pass' ? 'approval' : dc.status === 'revise' && (d.revisions || 0) < MAX_REVISIONS ? 'revise' : 'dropped';
  const ng = check.checks.filter((k) => k.hard && k.ok === false).map((k) => k.label);
  await saveDraft(kv, { ...d, status, why: dc.why, score: au.total, fixes: au.fixes || [], checkNg: ng, auditSummary: au.summary, updatedAt: now(), history: [...(d.history || []), { at: now(), by: 'auditor', text: `${STATUS_LABEL[status]}：${dc.why}` }] });
  return { done: status === 'approval' ? `@${d.handle || '不明'} へのコメント案を合格にした（社長の承認待ち）` : status === 'revise' ? `@${d.handle || '不明'} へのコメント案に直す点を見つけた（広報へ）` : `@${d.handle || '不明'} へのコメント案は送らない（${dc.why.slice(0, 50)}）`, handoff: status === 'revise' ? 'pr' : '' };
}

// 交流先で見つけたブランド・話題を、企画とバイヤーに引き継ぐ（企画が新しい案件のテーマを考えるときの手がかり。社長の指定より後ろ）
export async function addLeads(kv, leads) {
  const old = await getList(kv, K.leads);
  const have = new Set(old.map((l) => l.key));
  const fresh = leads.filter((l) => l.key && !have.has(l.key)).map((l) => ({ ...l, at: now(), used: false }));
  if (fresh.length) await kv.setJson(K.leads, [...fresh, ...old].slice(0, 40));
  return fresh;
}
export async function leadsFor(kv, n = 4) { return (await getList(kv, K.leads)).filter((l) => !l.used).slice(0, n); }
export async function markLeadUsed(kv, key, theme) {
  const list = await getList(kv, K.leads);
  await kv.setJson(K.leads, list.map((l) => (l.key === key ? { ...l, used: true, usedAt: now(), usedFor: String(theme || '').slice(0, 30) } : l)));
}

async function sitesRun(kv, elapsed) {
  const st0 = (await kv.getJson(K.state)) || {};
  const checks = { ...(st0.siteChecks || {}) };
  const order = Object.keys(OFFICIAL_SITES).sort((a, b) => String(checks[a] || '').localeCompare(String(checks[b] || ''))).slice(0, 10); // 調べていない・古い順
  const { targets } = siteTargets(order, {});
  const left = Math.max(8000, 40000 - elapsed());
  const results = await discoverFromSites(targets, { until: Date.now() + left });
  const old = await getList(kv, K.accounts);
  const map = new Map(old.map((a) => [a.handle, a]));
  let added = 0;
  for (const r of results) for (const h of r.handles || []) { if (!map.has(h)) added += 1; map.set(h, { handle: h, brand: r.brand, from: `${r.from}がリンク`, pageUrl: r.pageUrl || r.url, checkedAt: r.checkedAt || now() }); }
  await kv.setJson(K.accounts, [...map.values()].slice(0, 60));
  const st = (await kv.getJson(K.state)) || {};
  for (const r of results) checks[r.brand] = now();
  const prevSites = new Map((st.sites || []).map((x) => [x.brand, x]));
  for (const r of results) prevSites.set(r.brand, { brand: r.brand, handles: r.handles || [], error: r.error || '' });
  await kv.setJson(K.state, { ...st, sitesAt: now(), siteChecks: checks, sites: [...prevSites.values()] });
  const ok = results.filter((r) => (r.handles || []).length).length;
  // 公式サイトでInstagramを確認できたブランドを、企画・バイヤーへの手がかりにする（そのブランドの商品を楽天で探す）
  const leads = await addLeads(kv, results.filter((r) => (r.handles || []).length).map((r) => ({ key: `brand:${r.brand}`, brand: r.brand, topic: `${r.brand}の商品`, from: `公式サイト（${r.pageUrl || r.url}）がInstagram @${r.handles[0]} をリンク` })));
  return { done: `公式サイト${results.length}件を調べ、${ok}件でInstagramへのリンクを確認した（関連アカウント${map.size}件・新しく${added}件）${leads.length ? `。見つけたブランド${leads.length}件を企画へ引き継ぐ` : ''}`, handoff: leads.length ? 'planner' : '', what: leads.length ? `交流先で見つけたブランド${leads.length}件（${leads.slice(0, 3).map((l) => l.brand).join('・')}）` : '' };
}

async function fbRun(kv, fb, accounts) {
  const st = (await kv.getJson(K.state)) || {};
  const list = await getList(kv, K.targets);
  const have = new Set(list.map((t) => t.id));
  const add = []; const errors = [];
  for (const a of accounts.slice(0, 5)) {
    try {
      const b = await businessDiscovery(fb, a.handle);
      for (const p of freshPosts(b.media, { hours: 72 }).slice(0, 2)) {
        const m = String(p.url || p.permalink || '').match(POST_RE);
        if (!m || have.has(m[2]) || !p.caption) continue;
        have.add(m[2]);
        add.push({ id: m[2], url: `https://www.instagram.com/${m[1]}/${m[2]}/`, handle: a.handle, caption: String(p.caption).slice(0, 1000), source: 'api', sourceLabel: '公式APIで取得', addedAt: now(), status: 'new' });
      }
    } catch (e) { errors.push(`@${a.handle}：${String(e.message || e).slice(0, 60)}`); }
  }
  await kv.setJson(K.targets, [...add, ...list].slice(0, 100));
  await kv.setJson(K.state, { ...st, fbAt: now(), fbErrors: errors.slice(0, 5) });
  // 集めた投稿の話題（投稿の文章の先頭）を、企画への手がかりにする（文章に書かれていることだけ）
  const acc = new Map(accounts.map((a) => [a.handle, a]));
  await addLeads(kv, add.slice(0, 5).map((t) => ({ key: `post:${t.id}`, brand: (acc.get(t.handle) || {}).brand || '', topic: String(t.caption).split(/[\n。！!？?#]/)[0].slice(0, 40), from: `@${t.handle} の投稿 ${t.url}` })));
  return { done: `公式APIで直近の投稿を集めた（交流候補に${add.length}件追加${errors.length ? `・取れなかったアカウント${errors.length}件` : ''}）` };
}

// 社長の判断：承認（社長がInstagramで送る）／見送り／送った／送れなかった
export async function decideDraft(kv, { id, action, note = '' }) {
  const list = await getList(kv, K.drafts);
  const d = list.find((x) => x.id === id);
  if (!d) throw new Error('そのコメント案はありません');
  const allowed = { approve: ['approval'], reject: ['approval', 'approved'], sent: ['approved'], failed: ['approved'] };
  if (!allowed[action]) throw new Error('操作が分かりません');
  if (!allowed[action].includes(d.status)) throw new Error(`今の状態（${STATUS_LABEL[d.status] || d.status}）では、その操作はできません`);
  const status = ({ approve: 'approved', reject: 'rejected', sent: 'sent', failed: 'failed' })[action];
  const n = str(note, 120);
  const nd = { ...d, status, decidedAt: now(), ownerNote: n || d.ownerNote || '', history: [...(d.history || []), { at: now(), by: 'owner', text: `${STATUS_LABEL[status]}${n ? `（${n}）` : ''}` }] };
  if (action === 'sent' || action === 'failed') {
    nd.resultAt = now();
    await commentLogAdd(kv, [{ postUrl: d.url, handle: d.handle, text: d.comment, sentAt: now(), result: action === 'sent' ? 'sent' : 'failed', source: 'owner_report', by: '社長（2.0の広報の承認から）', note: n }]).catch(() => null);
  }
  await kv.setJson(K.drafts, list.map((x) => (x.id === id ? nd : x)));
  return nd;
}

export async function prState(kv, env) {
  const [targets, drafts, accounts, st, log, leads] = await Promise.all([getList(kv, K.targets), getList(kv, K.drafts), getList(kv, K.accounts), kv.getJson(K.state), commentLogList(kv).catch(() => []), getList(kv, K.leads)]);
  const fb = fbConfig(env);
  return {
    drafts: drafts.map((d) => ({ ...d, label: STATUS_LABEL[d.status] || d.status })),
    targets: targets.slice(0, 30).map((t) => ({ id: t.id, url: t.url, handle: t.handle, source: t.sourceLabel, status: t.status, why: t.why || '', addedAt: t.addedAt, caption: t.caption.slice(0, 120) })),
    accounts, sitesAt: (st || {}).sitesAt || '', fbAt: (st || {}).fbAt || '', sites: ((st || {}).sites || []).map((x) => ({ brand: x.brand, ok: (x.handles || []).length > 0, error: x.error || '' })),
    // 実際にInstagramへ送った記録（根拠つき・社長の事後確認つき）。コメント案（drafts）とは別
    history: log.slice(0, 100).map(withReview),
    leads: leads.slice(0, 20),
    access: { fb: fb.ready, hashtag: fb.ready && fb.hashtagEnabled, sends: false, ig: !!String(env.IG_ACCESS_TOKEN || '').trim(), limits: { dayDrafts: DAY_DRAFTS, handleDays: HANDLE_DAYS } },
    counts: { approval: drafts.filter((d) => d.status === 'approval').length, approved: drafts.filter((d) => d.status === 'approved').length, sent: drafts.filter((d) => d.status === 'sent').length, dropped: drafts.filter((d) => d.status === 'dropped').length }
  };
}
