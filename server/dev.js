// 開発管理（2026-11-24・KOT-14）：/api/dev
//   POST：GitHub Actions（linear-claude.yml）が、チケットごとの開発の進み具合を送る（認証は既存の CRON_SECRET。新しい鍵は使わない）
//   GET ：アプリの開発管理画面が読む（合言葉 APP_PASSCODE が必要）。5分ごとの起動役（/api/linear-kick）の最後の記録も添える
//   秘密の値は受け取らない・保存しない・返さない（送られてきた文字列も伏せ字にしてから保存する）
import crypto from 'node:crypto';
import { send, readBody } from '../lib/http.js';
import { kvFrom } from '../lib/kv.js';

const K = { list: 'dev:list', ticket: (id) => `dev:ticket:${id}`, queue: 'dev:queue', kick: 'linear-kick:last', kickStats: 'linear-kick:stats' };
export { K as DEV_KEYS };
const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const SECRET_RE = /sk-ant-[A-Za-z0-9_-]+|lin_(api|oauth)_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:bearer|authorization|token)["'\s:=]+[A-Za-z0-9._-]{16,}/gi;
const clean = (v, n = 600) => String(v == null ? '' : v).replace(SECRET_RE, '[伏せ字]').replace(/[\u0000-\u0008\u000b-\u001f<>]/g, ' ').trim().slice(0, n);
const url = (v) => (/^https:\/\/(github\.com|linear\.app|rakuten-room-assistant[\w-]*\.vercel\.app)\//.test(String(v || '')) ? String(v).slice(0, 300) : '');
const idOf = (v) => (/^[A-Z]+-\d+$/.test(String(v || '')) ? String(v) : '');

// 段階の名前（画面の表示順）
export const STAGES = { accepted: '受付', implement: '開発（Claude Code）', test: 'テスト', pr: 'PR作成', review: '独立レビュー', conflict: '最新mainとの整合', preview: 'Preview（Vercel）', merge: 'マージ', deploy: '本番反映', prodcheck: '本番の動作確認', finish: '結果の報告' };

export async function record(kv, body) {
  const at = new Date().toISOString();
  if (Array.isArray(body.queue)) {
    await kv.setJson(K.queue, { at, items: body.queue.slice(0, 30).map((q) => ({ id: idOf(q.id), title: clean(q.title, 120), url: url(q.url), priority: q.priority == null ? null : Number(q.priority), createdAt: clean(q.createdAt, 40), ok: !!q.ok, why: clean(q.why, 200) })) });
  }
  const id = idOf(body.ticket && body.ticket.id);
  if (!id) return { ok: true, stored: 'queue' };
  const cur = (await kv.getJson(K.ticket(id))) || { id, stages: [], createdAt: at };
  const t = body.ticket || {};
  if (t.title) cur.title = clean(t.title, 200);
  if (t.url) cur.url = url(t.url);
  if (t.requestedAt) cur.requestedAt = clean(t.requestedAt, 40);
  if (t.priority != null) cur.priority = Number(t.priority);
  for (const k of ['pr_url', 'test_text', 'review_verdict', 'merge_sha', 'prod_commit']) if (body[k]) cur[k] = k === 'pr_url' ? url(body[k]) : clean(body[k], 300);
  if (body.run) cur.run = url(body.run);
  const st = body.stage;
  if (st && STAGES[st.name]) {
    const s = { name: st.name, label: STAGES[st.name], status: ['done', 'running', 'failed', 'skipped', 'waiting'].includes(st.status) ? st.status : 'done', detail: clean(st.detail, 600), link: url(st.link), at };
    cur.stages = [...cur.stages.filter((x) => !(x.name === s.name && x.status === 'running')), s].slice(-40);
    if (st.name === 'accepted' && !cur.startedAt) cur.startedAt = at;
    cur.stage = s.label; cur.stageStatus = s.status;
    if (s.status === 'failed') cur.error = s.detail;
    if (st.name === 'finish') { cur.finishedAt = at; cur.result = clean(st.detail, 300); }
  }
  if (body.next) cur.next = clean(body.next, 300);
  cur.updatedAt = at;
  await kv.setJson(K.ticket(id), cur);
  const list = (await kv.getJson(K.list)) || [];
  await kv.setJson(K.list, [id, ...list.filter((x) => x !== id)].slice(0, 50));
  return { ok: true, stored: id };
}

export async function state(kv) {
  const ids = (await kv.getJson(K.list)) || [];
  const tickets = (await Promise.all(ids.slice(0, 30).map((id) => kv.getJson(K.ticket(id))))).filter(Boolean);
  return { tickets, queue: await kv.getJson(K.queue), kick: await kv.getJson(K.kick), kickStats: await kv.getJson(K.kickStats), stages: STAGES };
}

export default async function handler(req, res, env = process.env) {
  const kv = kvFrom(env);
  if (!kv) return send(res, 200, { configured: false, error: '保存場所が未接続です' });
  if (req.method === 'POST') {
    if (!env.CRON_SECRET || !same(String(req.headers.authorization || ''), `Bearer ${env.CRON_SECRET}`)) return send(res, 401, { error: '認証できません' });
    const body = await readBody(req);
    return send(res, 200, await record(kv, body || {}));
  }
  if (!String(env.APP_PASSCODE || '').trim() || !same(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  return send(res, 200, await state(kv));
}
