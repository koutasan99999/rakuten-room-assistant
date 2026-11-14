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
  rev: (id) => `data:rev:${id}`,          // 更新番号の正本（中身と同じ命令で書き換える）
  index: 'data:sets:index',               // 一覧（Redis の hash：id → 状態・更新番号など）
  state: (st) => `data:state:${st}`,      // 状態ごとの集合（件数の上限を原子的に守るため。中身・番号と同じ命令で動かす）
  conflict: (id) => `data:conflict:${id}`,
  migrate: 'data:migrate:log',
  meta: 'data:meta'
};
const now = () => new Date().toISOString();
export const validId = (id) => /^[A-Za-z0-9_.:-]{1,80}$/.test(String(id || ''));

export class ConflictError extends Error { constructor(current) { super('ほかの端末や社員が先に更新しました（更新番号が違います）'); this.current = current; } }
export class StateError extends Error {}
export class CapacityError extends Error { constructor(state, n) { super(`「${state}」が満杯です（${n}件）`); this.state = state; this.count = n; } }
// サーバーが足す情報（端末の編集ではない）：移行の照合では比べない
export const SERVER_ONLY = ['inspection'];

const indexValue = (rec) => JSON.stringify({ state: rec.state, rev: rec.rev, createdAt: rec.createdAt, updatedAt: rec.updatedAt, score: rec.score == null ? null : rec.score, origin: rec.origin || '' });
async function readIndex(kv) { return kv.hgetallJson(K.index); }

// 中身の比べ方：キーの順番に左右されない並べ方で文字列にする（端末の status・_server は比べない）
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined && k !== 'status' && k !== '_server' && !SERVER_ONLY.includes(k)).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
export const digest = (set) => crypto.createHash('sha256').update(stable(set || {})).digest('hex').slice(0, 16);

export async function get(kv, id) { return validId(id) ? kv.getJson(K.set(id)) : null; }
export async function list(kv, { states = null } = {}) {
  const idx = await readIndex(kv);
  const ids = Object.keys(idx).filter((id) => !states || states.includes(idx[id].state));
  const recs = [];
  for (const id of ids) { const r = await kv.getJson(K.set(id)); if (r) recs.push(r); }
  return recs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export async function counts(kv) {
  const c = {};
  for (const st of STATES) c[st] = Number(await kv.cmd('SCARD', K.state(st))) || 0;
  return c;
}
export async function meta(kv) { return (await kv.getJson(K.meta)) || {}; }

// 新しく作る（同じIDが既にあれば何もしない＝冪等）。確かめると書くを1つの原子的な命令で行う
export async function create(kv, { id, set, state = 'shelf', origin = 'server', score = null, by = 'server', history = [] }) {
  if (!validId(id)) throw new StateError('IDが正しくありません');
  if (!STATES.includes(state)) throw new StateError(`状態が正しくありません：${state}`);
  const t = now();
  const rec = { id, rev: 1, state, origin, score, set, createdAt: (set && set.createdAt) || t, updatedAt: t, updatedBy: by, history: [{ at: t, by, rev: 1, change: `作成（${state}）` }, ...history].slice(0, 30) };
  // 置き場所の候補：公開待ち（3件まで）→ 控え（6件まで）→ 期限切れ（上限なし＝必ず保存する。消さない）
  const chain = state === 'ready' ? ['ready', 'shelf', 'expired'] : state === 'shelf' ? ['shelf', 'expired'] : [state];
  const limitOf = (st) => (st === 'ready' ? READY_MAX : st === 'shelf' ? SHELF_MAX : 0);
  const variant = (st, i) => {
    if (i === 0) return rec;
    const note = `${{ ready: '公開待ち', shelf: '控え' }[chain[i - 1]]}が満杯（${limitOf(chain[i - 1])}件）のため${{ shelf: '控え', expired: '期限切れ' }[st]}として保存（消さない）`;
    return { ...rec, state: st, history: [{ at: t, by, rev: 1, change: note }, ...rec.history].slice(0, 30) };
  };
  const variants = chain.map(variant);
  const args = [id, String(chain.length)];
  chain.forEach((st, i) => { args.push(String(i === chain.length - 1 ? 0 : limitOf(st)), JSON.stringify(variants[i]), indexValue(variants[i])); });
  const r = Number(await kv.eval('createIfAbsent', [K.set(id), K.rev(id), K.index, ...chain.map((st) => K.state(st))], args));
  if (r > 0) return { created: true, rec: variants[r - 1], placedIn: chain[r - 1] };
  return { created: false, rec: await kv.getJson(K.set(id)) };
}

// 書き換える（更新番号が一致したときだけ）。照合と保存は Redis の1つの命令（Lua）で行うので、処理が長引いても割り込まれない
export async function update(kv, id, expectedRev, { set, score, state, by = 'server', change = '更新', decision } = {}) {
  if (!validId(id)) throw new StateError('IDが正しくありません');
  const cur = await kv.getJson(K.set(id));
  if (!cur) throw new StateError('その投稿セットはサーバーにありません');
  const conflict = async () => {
    const fresh = await kv.getJson(K.set(id));
    if (set) await kv.pushJson(K.conflict(id), { at: now(), by, expectedRev: Number(expectedRev), currentRev: fresh ? fresh.rev : null, change, set }, 0); // 書けなかった中身は捨てずに残す（件数で切り詰めない）
    return new ConflictError(fresh);
  };
  if (Number(expectedRev) !== cur.rev) throw await conflict();
  if (state && state !== cur.state && !NEXT[cur.state].includes(state)) throw new StateError(`「${cur.state}」から「${state}」には変えられません`);
  const t = now();
  const next = { ...cur, rev: cur.rev + 1, updatedAt: t, updatedBy: by };
  if (set) next.set = set;
  if (score !== undefined) next.score = score;
  if (state) next.state = state;
  if (decision) next.decision = { ...decision, at: t, by };
  next.history = [{ at: t, by, rev: next.rev, change }, ...(cur.history || [])].slice(0, 30);
  // 公開待ちへ移すときは、件数の上限（3件）を同じ命令の中で確かめる（同時に何件移そうとしても超えない）
  const limit = next.state === 'ready' && cur.state !== 'ready' ? READY_MAX : 0;
  const r = await kv.eval('casMove', [K.set(id), K.rev(id), K.index, K.state(cur.state), K.state(next.state)], [String(cur.rev), JSON.stringify(next), String(next.rev), id, indexValue(next), String(limit)]);
  const code = Number(Array.isArray(r) ? r[0] : r);
  if (code === 1) return next;
  if (code === -1) throw new StateError('その投稿セットはサーバーにありません');
  if (code === 2) throw new CapacityError(next.state, Number(r[1]));
  throw await conflict(); // 読んだあとに、ほかの処理が先に書いた
}

// 社長の判断（採用・却下）。更新番号が必要
export async function decide(kv, id, expectedRev, { action, reason = '', by = 'owner' }) {
  const state = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'restore' ? 'ready' : '';
  if (!state) throw new StateError('判断の種類が分かりません');
  const opts = { state, by, change: { approved: '社長が採用', rejected: '社長が却下', ready: '社長が戻した' }[state], decision: { action, reason: String(reason || '').slice(0, 200) } };
  let rec;
  try { rec = await update(kv, id, expectedRev, opts); } catch (e) {
    if (!(e instanceof CapacityError)) throw e;
    rec = await update(kv, id, expectedRev, { ...opts, state: 'shelf', change: '社長が戻した（公開待ちが満杯のため控えへ）' }); // 公開待ちが満杯なら控えへ（消さない・あとで繰り上がる）
  }
  await kv.setJson(K.meta, { ...(await meta(kv)), lastOwnerDecisionAt: now() });
  return rec;
}

// 棚の整理：期限切れ（控えに14日・控えの上限超え）→ 公開待ちが3件より少なければ、控えから点数の高い順・新しい順に繰り上げる
export async function rebalance(kv, { t = Date.now() } = {}) {
  const changes = [];
  const by = 'server:棚の整理';
  // 書けたときだけ成功として数える（競合・満杯は数えない。次の整理でもう一度）
  const tryMove = async (x, state, change) => {
    try { await update(kv, x.id, x.rev, { state, by, change }); return 'ok'; } catch (e) {
      if (e instanceof ConflictError) return 'conflict';
      if (e instanceof CapacityError) return 'full';
      throw e;
    }
  };
  const rank = (a, b) => ((b.score || 0) - (a.score || 0)) || (a.createdAt < b.createdAt ? 1 : -1);
  const shelfOf = async () => Object.entries(await readIndex(kv)).filter(([, x]) => x.state === 'shelf').map(([id, x]) => ({ id, ...x }));
  for (const x of await shelfOf()) {
    if (t - new Date(x.createdAt).getTime() > SHELF_DAYS * 86400000 && (await tryMove(x, 'expired', `控えに${SHELF_DAYS}日（期限切れ・消さない）`)) === 'ok') changes.push(`${x.id}：期限切れ（${SHELF_DAYS}日）`);
  }
  // 繰り上げ：公開待ちの件数は、繰り上げのたびに原子的に確かめる（満杯なら止める）
  let shelf = (await shelfOf()).sort(rank);
  for (const x of shelf) {
    if ((await counts(kv)).ready >= READY_MAX) break;
    const r = await tryMove(x, 'ready', '控えから公開待ちへ繰り上げ');
    if (r === 'ok') changes.push(`${x.id}：公開待ちへ`);
    if (r === 'full') break;
  }
  // 控えの上限：点数の低い・古いものから期限切れへ（消さない）。今の件数を読み直してから
  shelf = (await shelfOf()).sort(rank);
  let over = shelf.length - SHELF_MAX;
  for (const x of shelf.slice().reverse()) {
    if (over <= 0) break;
    if ((await tryMove(x, 'expired', `控えの上限（${SHELF_MAX}件）を超えたため期限切れ（消さない）`)) === 'ok') { changes.push(`${x.id}：期限切れ（上限）`); over -= 1; }
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
// 移行の照合で「同じ状態」とみなす組み合わせ（端末の確認待ちは、サーバーでは公開待ち・控えのどちらにもなる）
function sameState(local, server) {
  const want = stateFromLocal(local);
  return want === server || (want === 'shelf' && ['ready', 'shelf', 'expired'].includes(server)); // 確認待ちは、上限・日数で期限切れに回ることがある（社長の判断ではない）
}
const splitLocal = (x) => { const { status, _server, ...set } = x; return { status, set }; };

// 端末からの移行（冪等）。既に同じIDがあれば書き換えない。中身や判断が違うときは黙って成功にせず「差異」として返し、端末の中身を data:conflict に残す
export async function importSets(kv, sets, { deviceId = '' } = {}) {
  const out = { created: [], same: [], different: [], invalid: [] };
  for (const x of (Array.isArray(sets) ? sets : []).slice(0, 50)) {
    if (!x || !validId(x.id)) { out.invalid.push(String(x && x.id || '').slice(0, 40)); continue; }
    const { status, set } = splitLocal(x);
    const r = await create(kv, { id: x.id, set, state: stateFromLocal(x), origin: x.origin === 'server' ? 'server' : 'device', score: x.auto ? x.auto.score : null, by: `device:${String(deviceId).slice(0, 20)}`, history: x.decidedAt ? [{ at: x.decidedAt, by: 'owner（端末の記録）', rev: 0, change: `端末での判断：${status}${x.reason ? `（${String(x.reason).slice(0, 60)}）` : ''}` }] : [] });
    if (r.created) { out.created.push(x.id); continue; }
    const why = [digest(set) !== digest(r.rec.set) ? '中身が違う' : '', !sameState(x, r.rec.state) ? `判断・状態が違う（端末：${status}／サーバー：${r.rec.state}）` : ''].filter(Boolean);
    if (!why.length) { out.same.push(x.id); continue; }
    out.different.push({ id: x.id, why: why.join('・'), serverRev: r.rec.rev });
    await kv.pushJson(K.conflict(x.id), { at: now(), by: `device:${String(deviceId).slice(0, 20)}`, kind: '移行のときの差異', why: why.join('・'), status, set }, 0); // 件数で切り詰めない
  }
  await kv.pushJson(K.migrate, { at: now(), deviceId: String(deviceId).slice(0, 20), created: out.created.length, same: out.same.length, different: out.different.length, invalid: out.invalid.length }, 50);
  return { ...out, skipped: [...out.same, ...out.different.map((d) => d.id)] };
}
// 読み戻しの照合：端末が送った投稿セットと、サーバーの中身・判断・件数が一致するか（IDだけでは判断しない）
export async function verify(kv, sets) {
  const list = (Array.isArray(sets) ? sets : []).slice(0, 500);
  const missing = []; const different = []; let matched = 0;
  for (const x of list) {
    if (!x || !validId(x.id)) { missing.push(String(x && x.id || '')); continue; }
    const rec = await kv.getJson(K.set(x.id));
    if (!rec) { missing.push(x.id); continue; }
    const { set } = splitLocal(x);
    const why = [digest(set) !== digest(rec.set) ? '中身が違う' : '', !sameState(x, rec.state) ? `判断・状態が違う（端末：${x.status}／サーバー：${rec.state}）` : ''].filter(Boolean);
    if (why.length) different.push({ id: x.id, why: why.join('・') }); else matched += 1;
  }
  return { ok: !missing.length && !different.length && matched === list.length, total: list.length, matched, missing, different };
}
export async function conflicts(kv, id) { return kv.listJson(K.conflict(id), 0); } // すべて（未解決の記録は自動では消さない）
export { K as STORE_KEYS, UNPUBLISHED };
