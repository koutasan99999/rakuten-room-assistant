// Linear → Claude Code の定期実行の起動役（2026-11-20）：/api/linear-kick
// GitHub の schedule（5分ごと）は遅れたり飛ばされたりする（11/20 は 09:01 に取り込んでから、定期実行が 15:57 の1回だけだった）。
// そこで、QStash（Upstash の無料枠）が5分ごとにここを呼び、GitHub Actions の「Linear → Claude Code」を workflow_dispatch で起動する。
// - 認証：QStash の署名（既存の /api/worker と同じ鍵・同じ確かめ方）だけを受け付ける
// - 起動に使う鍵：GH_DISPATCH_TOKEN（このリポジトリだけ・Actions の読み書きだけの fine-grained token）。Vercel の環境変数だけに置く。未設定なら何もしない
// - 二重起動を防ぐ：(1) 同じ呼び出しの再送は1回だけ（Upstash-Message-Id）(2) 4分以内に起動していたら何もしない（KV の印）
//   (3) 実行中・待ちの実行があれば何もしない (4) 直近4分以内に始まった実行（GitHub の schedule を含む）があれば何もしない
//   ワークフロー側にも同じ確認（schedule の実行は、直前に別の実行があれば何もしない）と concurrency がある
// - 鍵・署名の値は応答・記録に出さない
import { send } from '../lib/http.js';
import { kvFrom } from '../lib/kv.js';
import { verifyQstash, readRawBody } from '../lib/qstash.js';

export const REPO = 'koutasan99999/rakuten-room-assistant';
export const WORKFLOW = 'linear-claude.yml';
export const MIN_GAP_MS = 4 * 60 * 1000;
const API = 'https://api.github.com';

export async function decide({ token, fetchImpl = fetch, now = Date.now(), repo = REPO, workflow = WORKFLOW }) {
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'linear-kick' };
  const r = await fetchImpl(`${API}/repos/${repo}/actions/workflows/${workflow}/runs?per_page=10`, { headers: h, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return { start: false, why: `実行の一覧を読めない（HTTP ${r.status}）` };
  const runs = ((await r.json()).workflow_runs || []);
  const busy = runs.find((x) => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(x.status));
  if (busy) return { start: false, why: `実行中・待ちの実行がある（#${busy.run_number}・${busy.event}）` };
  const recent = runs.find((x) => now - Date.parse(x.created_at) < MIN_GAP_MS);
  if (recent) return { start: false, why: `直近4分以内に実行があった（#${recent.run_number}・${recent.event}）` };
  const d = await fetchImpl(`${API}/repos/${repo}/actions/workflows/${workflow}/dispatches`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main', inputs: {} }), signal: AbortSignal.timeout(10000) });
  if (d.status !== 204) return { start: false, why: `起動できなかった（HTTP ${d.status}）` };
  return { start: true, why: '起動した' };
}

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'POST' || !req.headers['upstash-signature']) return send(res, 401, { error: 'QStash からの呼び出しだけを受け付けます' });
  const raw = await readRawBody(req);
  const v = verifyQstash({ signature: req.headers['upstash-signature'], body: raw, keys: [env.QSTASH_CURRENT_SIGNING_KEY, env.QSTASH_NEXT_SIGNING_KEY], path: '/api/linear-kick' });
  if (!v.ok) return send(res, 401, { error: `QStash の署名を確かめられません：${v.why}` });
  const token = String(env.GH_DISPATCH_TOKEN || '').trim();
  if (!token) return send(res, 200, { ok: true, skipped: 'GH_DISPATCH_TOKEN が未設定のため、何もしません' });
  const kv = kvFrom(env);
  const mid = String(req.headers['upstash-message-id'] || '').replace(/[^\w-]/g, '').slice(0, 80);
  if (kv && mid && !(await kv.set(`linear-kick:msg:${mid}`, '1', { nx: true, ex: 3600 }))) return send(res, 200, { ok: true, skipped: '同じ呼び出しの再送' });
  if (kv && !(await kv.set('linear-kick:lock', new Date().toISOString(), { nx: true, ex: Math.round(MIN_GAP_MS / 1000) }))) return send(res, 200, { ok: true, skipped: '4分以内に起動の確認をした' });
  let out;
  try { out = await decide({ token }); } catch (e) { out = { start: false, why: `GitHub に接続できない（${String(e && e.name || 'error')}）` }; }
  if (kv) await kv.setJson('linear-kick:last', { at: new Date().toISOString(), ...out }).catch(() => {});
  return send(res, 200, { ok: true, ...out });
}
