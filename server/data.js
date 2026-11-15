// サーバーの正本のAPI（2026-11-14・段階1）：/api/data
// action: import（端末からの移行・冪等）／verify（読み戻しの照合）／list（一覧と中身）／put（中身の更新・更新番号が必要）／decide（社長の採用・却下・更新番号が必要）／conflicts（競合で書けなかった内容）
//         export（全件の書き出し・バックアップ用）／cleanup（未投稿・未判断の投稿セットを整理済みへ。dryRun で件数だけ）／unarchive（整理の取り消し）
// 合言葉（APP_PASSCODE）が必須（未設定なら断る）。保存場所が未接続なら「未接続」と返す（端末の記録だけで今までどおり動く）。
import crypto from 'node:crypto';
import { send, readBody } from '../lib/http.js';
import { kvFrom } from '../lib/kv.js';
import * as S from '../lib/store.js';
import { maskSecrets } from '../lib/ai.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  // 合言葉は必須：未設定なら読み書きを断る（誰でも投稿セットや社長の判断を見たり変えたりできないように）。合言葉の値は応答・記録に出さない
  if (!String(env.APP_PASSCODE || '').trim()) return send(res, 503, { error: 'サーバーの合言葉（APP_PASSCODE）が未設定のため、サーバーの正本は使えません（端末の記録だけで動きます）' });
  if (!same(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  const kv = kvFrom(env);
  if (!kv) return send(res, 200, { configured: false, notice: '保存場所が未接続のため、サーバーの正本は使えません（端末の記録だけで動きます）' });
  const body = await readBody(req);
  const action = String(body.action || '');
  const by = `device:${String(body.deviceId || '').replace(/[^\w-]/g, '').slice(0, 20)}`;
  try {
    if (action === 'import') { const r = await S.importSets(kv, body.sets, { deviceId: body.deviceId }); if (r.created.length) await S.rebalance(kv); return send(res, 200, { configured: true, ...r }); }
    if (action === 'verify') return send(res, 200, { configured: true, ...(await S.verify(kv, Array.isArray(body.sets) ? body.sets : [])) });
    if (action === 'list') return send(res, 200, { configured: true, sets: await S.list(kv), capacity: await S.capacity(kv), meta: await S.meta(kv), limits: { ready: S.READY_MAX, shelf: S.SHELF_MAX, shelfDays: S.SHELF_DAYS } });
    if (action === 'put') {
      if (!body.set || typeof body.set !== 'object') return send(res, 400, { error: '中身がありません' });
      const { status, _server, ...set } = body.set;
      const rec = await S.update(kv, String(body.id), body.expectedRev, { set, by, change: String(body.change || '端末で更新').slice(0, 60), baseDigest: String(body.baseDigest || '') });
      return send(res, 200, { configured: true, rec: { ...rec, digest: S.digest(rec.set) } });
    }
    if (action === 'decide') { const rec = await S.decide(kv, String(body.id), body.expectedRev, { action: String(body.decision || ''), reason: body.reason, by: `owner（${by}）` }); await S.rebalance(kv); return send(res, 200, { configured: true, rec: { ...rec, digest: S.digest(rec.set) } }); }
    if (action === 'export') return send(res, 200, { configured: true, ...(await S.exportAll(kv)) });
    // 整理：dryRun（既定）なら対象の件数・一覧だけ。実行は confirm: true のときだけ（社長が件数を見てから）
    if (action === 'cleanup') {
      const dryRun = body.confirm !== true;
      const r = await S.cleanup(kv, { dryRun, by: `owner（${by}）` });
      // 自律運営の「まだ使っていない合格候補」「表紙画像待ち」も整理する（記録は消さず、使う対象から外す）
      if (!dryRun) { await kv.set('worker:stock:cutoff', new Date().toISOString()); const w = (await kv.getJson('worker:cover:wait')) || []; if (w.length) { await kv.pushJson('worker:cover:archived', { at: new Date().toISOString(), items: w }, 0); await kv.setJson('worker:cover:wait', []); } r.workerArchived = { coverWait: w.length }; }
      return send(res, 200, { configured: true, dryRun, ...r });
    }
    if (action === 'unarchive') { const cur = await S.get(kv, String(body.id)); if (!cur) return send(res, 404, { error: 'その投稿セットはサーバーにありません' }); const rec = await S.update(kv, cur.id, cur.rev, { state: 'shelf', by: `owner（${by}）`, change: '整理を取り消し' }); return send(res, 200, { configured: true, rec }); }
    if (action === 'conflicts') return send(res, 200, { configured: true, conflicts: await S.conflicts(kv, String(body.id)) });
    return send(res, 400, { error: '操作が分かりません' });
  } catch (e) {
    if (e instanceof S.ConflictError) return send(res, 409, { configured: true, conflict: true, error: e.message, current: e.current });
    if (e instanceof S.StateError) return send(res, 400, { configured: true, error: e.message });
    return send(res, 500, { configured: true, error: maskSecrets(String(e && e.message || e)).slice(0, 300) });
  }
}
