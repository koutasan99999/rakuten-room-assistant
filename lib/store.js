// サーバーの正本（2026-11-14・段階1）：投稿セットと社長の判断は、ここ（Upstash Redis）が正本。端末（iPhoneの localStorage）は写し。
// 決まり：
//  - 楽観的排他制御：1件ごとに更新番号（rev）を持つ。書き込みは「読んだときの rev」を添え、今の rev と違えば書かずに「競合」を返す（更新日時では判断しない）。
//    同時に書き込まれても番号がずれないよう、1件ごとの短い鍵（SET NX）で「読む→確かめる→書く」をまとめて行う。
//  - 競合で書けなかった内容は捨てずに data:conflict に残す（データを失わない）。
//  - 移行（端末→サーバー）は冪等：同じIDが既にあれば何もしない（サーバーの判断を古い端末のデータで上書きしない）。端末のデータは消さない。
//  - 状態（state）：ready（公開待ち・最大3件）／shelf（控え・最大 SHELF_MAX 件）／approved（社長が採用）／published（公開済み）／rejected（社長が却下）／expired（期限切れ・上限超え。消さない）
//  - 未公開のものを無制限に増やさない：公開待ち＋控えが満杯なら、新しい投稿セットは作らない（worker 側で費用を抑え、改善・点検の仕事を優先する）。
import crypto from 'node:crypto';

export const READY_MAX = 3;      // 社長に見せる公開待ち
export const SHELF_MAX = 6;      // 控え（これを超える分は期限切れへ）
export const SHELF_DAYS = 14;    // 控えに置ける日数
export const STATES = ['ready', 'shelf', 'approved', 'published', 'rejected', 'expired'];
const UNPUBLISHED = ['ready', 'shelf'];
// 許される状態の移り変わり（社長の判断・公開・期限切れ・繰り上げ）
const NEXT = {
  ready: ['approved', 'rejected', 'shelf', 'expired'],
  shelf: ['ready', 'approved', 'rejected', 'expired'],
  approved: ['published', 'rejected', 'ready'],
  published: [],
  rejected: ['ready'],          // 社長が却下を取り消すとき
  expired: ['ready', 'shelf']   // 社長が戻すとき
};
const K = {
  set: (id) => `data:set:${id}`,
  lock: (id) => `data:lock:${id}`,
  index: 'data:sets:index',
  indexLock: 'data:lock:index',
  conflict: (id) => `data:conflict:${id}`,
  migrate: 'data:migrate:log',
  meta: 'data:meta'
};
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const validId = (id) => /^[A-Za-z0-9_.:-]{1,80}$/.test(String(id || ''));

export class ConflictError extends Error { constructor(current) { super('ほかの端末や社員が先に更新しました（更新番号が違います）'); this.current = current; } }
export class StateError extends Error {}

// 1件ごとの短い鍵（最大5秒・取れなければ少し待って再試行）
async function withLock(kv, key, fn) {
  const token = crypto.randomBytes(6).toString('hex');
  for (let i = 0; i < 20; i++) {
    if (await kv.set(key, token, { nx: true, ex: 5 })) {
      try { return await fn(); } finally { if ((await kv.get(key)) === token) await kv.del(key); }
    }
    await sleep(100 + i * 50);
  }
  throw new Error('保存場所が混み合っています（しばらくしてから、もう一度）');
}

// 一覧（id → 状態・更新番号・作成日時・点数）。一覧だけは全体の鍵で守る
async function readIndex(kv) { return (await kv.getJson(K.index)) || {}; }
async function updateIndex(kv, rec, { remove = false } = {}) {
  return withLock(kv, K.indexLock, async () => {
    const idx = await readIndex(kv);
    if (remove) delete idx[rec.id]; else idx[rec.id] = { state: rec.state, rev: rec.rev, createdAt: rec.createdAt, updatedAt: rec.updatedAt, score: rec.score == null ? null : rec.score, origin: rec.origin || '' };
    await kv.setJson(K.index, idx);
    return idx;
  });
}

export async function get(kv, id) { return validId(id) ? kv.getJson(K.set(id)) : null; }
export async function list(kv, { states = null } = {}) {
  const idx = await readIndex(kv);
  const ids = Object.keys(idx).filter((id) => !states || states.includes(idx[id].state));
  const recs = [];
  for (const id of ids) { const r = await kv.getJson(K.set(id)); if (r) recs.push(r); }
  return recs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export async function counts(kv) {
  const idx = await readIndex(kv);
  const c = Object.fromEntries(STATES.map((s) => [s, 0]));
  Object.values(idx).forEach((x) => { if (c[x.state] != null) c[x.state] += 1; });
  return c;
}
export async function meta(kv) { return (await kv.getJson(K.meta)) || {}; }

// 新しく作る（同じIDが既にあれば何もしない＝冪等）
export async function create(kv, { id, set, state = 'shelf', origin = 'server', score = null, by = 'server', history = [] }) {
  if (!validId(id)) throw new StateError('IDが正しくありません');
  if (!STATES.includes(state)) throw new StateError(`状態が正しくありません：${state}`);
  return withLock(kv, K.lock(id), async () => {
    const cur = await kv.getJson(K.set(id));
    if (cur) return { created: false, rec: cur };
    const t = now();
    const rec = { id, rev: 1, state, origin, score, set, createdAt: (set && set.createdAt) || t, updatedAt: t, updatedBy: by, history: [{ at: t, by, rev: 1, change: `作成（${state}）` }, ...history].slice(0, 30) };
    await kv.setJson(K.set(id), rec);
    await updateIndex(kv, rec);
    return { created: true, rec };
  });
}

// 書き換える（更新番号が一致したときだけ）。patch は state 以外の中身（set・score など）
export async function update(kv, id, expectedRev, { set, score, state, by = 'server', change = '更新', decision } = {}) {
  if (!validId(id)) throw new StateError('IDが正しくありません');
  return withLock(kv, K.lock(id), async () => {
    const cur = await kv.getJson(K.set(id));
    if (!cur) throw new StateError('その投稿セットはサーバーにありません');
    if (Number(expectedRev) !== cur.rev) {
      // 書けなかった内容は捨てずに残す
      if (set) await kv.pushJson(K.conflict(id), { at: now(), by, expectedRev: Number(expectedRev), currentRev: cur.rev, set }, 10);
      throw new ConflictError(cur);
    }
    if (state && state !== cur.state && !NEXT[cur.state].includes(state)) throw new StateError(`「${cur.state}」から「${state}」には変えられません`);
    const t = now();
    const next = { ...cur, rev: cur.rev + 1, updatedAt: t, updatedBy: by };
    if (set) next.set = set;
    if (score !== undefined) next.score = score;
    if (state) next.state = state;
    if (decision) next.decision = { ...decision, at: t, by };
    next.history = [{ at: t, by, rev: next.rev, change }, ...(cur.history || [])].slice(0, 30);
    await kv.setJson(K.set(id), next);
    await updateIndex(kv, next);
    return next;
  });
}

// 社長の判断（採用・却下）。更新番号が必要
export async function decide(kv, id, expectedRev, { action, reason = '', by = 'owner' }) {
  const state = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'restore' ? 'ready' : '';
  if (!state) throw new StateError('判断の種類が分かりません');
  const rec = await update(kv, id, expectedRev, { state, by, change: { approved: '社長が採用', rejected: '社長が却下', ready: '社長が戻した' }[state], decision: { action, reason: String(reason || '').slice(0, 200) } });
  await kv.setJson(K.meta, { ...(await meta(kv)), lastOwnerDecisionAt: now() });
  return rec;
}

// 棚の整理：期限切れ（控えに14日・控えの上限超え）→ 公開待ちが3件より少なければ、控えから点数の高い順・新しい順に繰り上げる
export async function rebalance(kv, { t = Date.now() } = {}) {
  const idx = await readIndex(kv);
  const changes = [];
  const by = 'server:棚の整理';
  // ほかの書き込みと重なったら（競合）、その1件は今回は動かさない（次の整理で）
  const update = async (...a) => { try { return await updateRec(...a); } catch (e) { if (e instanceof ConflictError) return null; throw e; } };
  const rank = (a, b) => ((b.score || 0) - (a.score || 0)) || (a.createdAt < b.createdAt ? 1 : -1);
  let shelf = Object.entries(idx).filter(([, x]) => x.state === 'shelf').map(([id, x]) => ({ id, ...x }));
  for (const x of shelf) {
    if (t - new Date(x.createdAt).getTime() > SHELF_DAYS * 86400000) {
      await update(kv, x.id, x.rev, { state: 'expired', by, change: `控えに${SHELF_DAYS}日（期限切れ・消さない）` }); changes.push(`${x.id}：期限切れ（${SHELF_DAYS}日）`);
    }
  }
  const idx2 = await readIndex(kv);
  let ready = Object.values(idx2).filter((x) => x.state === 'ready').length;
  shelf = Object.entries(idx2).filter(([, x]) => x.state === 'shelf').map(([id, x]) => ({ id, ...x })).sort(rank);
  while (ready < READY_MAX && shelf.length) {
    const x = shelf.shift();
    await update(kv, x.id, x.rev, { state: 'ready', by, change: '控えから公開待ちへ繰り上げ' }); changes.push(`${x.id}：公開待ちへ`); ready += 1;
  }
  // 控えの上限：点数の低い・古いものから期限切れへ（消さない）
  while (shelf.length > SHELF_MAX) {
    const x = shelf.pop();
    await update(kv, x.id, x.rev, { state: 'expired', by, change: `控えの上限（${SHELF_MAX}件）を超えたため期限切れ（消さない）` }); changes.push(`${x.id}：期限切れ（上限）`);
  }
  return changes;
}

const updateRec = (...a) => update(...a);

// 未公開の空き（公開待ち＋控えに、あと何件入れられるか）
export async function capacity(kv) {
  const c = await counts(kv);
  return { ...c, unpublished: c.ready + c.shelf, room: Math.max(0, READY_MAX + SHELF_MAX - c.ready - c.shelf) };
}

// 端末からの移行（冪等）：端末の投稿セットを1件ずつ取り込む。既にあれば何もしない。端末の状態は次のように読み替える
//   new（確認待ち）→ shelf（その後、棚の整理で上位3件が公開待ちへ）／adopted → approved（Instagramに公開済みの記録があれば published）／rejected → rejected
export function stateFromLocal(x) {
  if (x.status === 'adopted') return x.igPost && x.igPost.url ? 'published' : 'approved';
  if (x.status === 'rejected') return 'rejected';
  if (x.supersededBy) return 'expired';
  return 'shelf';
}
export async function importSets(kv, sets, { deviceId = '' } = {}) {
  const out = { created: [], skipped: [], invalid: [] };
  for (const x of (Array.isArray(sets) ? sets : []).slice(0, 50)) {
    if (!x || !validId(x.id)) { out.invalid.push(String(x && x.id || '').slice(0, 40)); continue; }
    const { status, _server, ...set } = x;
    const r = await create(kv, { id: x.id, set, state: stateFromLocal(x), origin: x.origin === 'server' ? 'server' : 'device', score: x.auto ? x.auto.score : null, by: `device:${String(deviceId).slice(0, 20)}`, history: x.decidedAt ? [{ at: x.decidedAt, by: 'owner（端末の記録）', rev: 0, change: `端末での判断：${status}${x.reason ? `（${String(x.reason).slice(0, 60)}）` : ''}` }] : [] });
    (r.created ? out.created : out.skipped).push(x.id);
  }
  await kv.pushJson(K.migrate, { at: now(), deviceId: String(deviceId).slice(0, 20), created: out.created.length, skipped: out.skipped.length, invalid: out.invalid.length }, 50);
  return out;
}
// 読み戻しの照合：端末が送ったIDが、すべてサーバーにあるか
export async function verify(kv, ids) {
  const idx = await readIndex(kv);
  const missing = (Array.isArray(ids) ? ids : []).filter((id) => !idx[id]);
  return { ok: missing.length === 0, total: (ids || []).length, missing };
}
export async function conflicts(kv, id) { return kv.listJson(K.conflict(id), 10); }
export { K as STORE_KEYS, UNPUBLISHED };
