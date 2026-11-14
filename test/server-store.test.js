// サーバーの正本（段階1）：更新番号による楽観的排他制御・冪等な移行・棚（公開待ち3件＋控え6件）・状態の移り変わり・API
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import * as S from '../lib/store.js';
import data from '../server/data.js';

const set = (id, extra = {}) => ({ id, title: `企画 ${id}`, items: [{ name: '商品', price: 1000, code: `c:${id}` }], createdAt: new Date().toISOString(), ...extra });

test('楽観的排他制御：読んだときの更新番号が今と違えば書かずに競合を返し、書けなかった内容は捨てずに残す', async () => {
  const kv = memoryKv();
  const { rec } = await S.create(kv, { id: 'a1', set: set('a1') });
  assert.equal(rec.rev, 1);
  const r2 = await S.update(kv, 'a1', 1, { set: set('a1', { title: '端末Aの修正' }), by: 'device:A' });
  assert.equal(r2.rev, 2);
  // 端末Bは古い番号（1）のまま書こうとする → 競合
  await assert.rejects(S.update(kv, 'a1', 1, { set: set('a1', { title: '端末Bの修正' }), by: 'device:B' }), (e) => e instanceof S.ConflictError && e.current.rev === 2);
  assert.equal((await S.get(kv, 'a1')).set.title, '端末Aの修正', '先に書いた方が残る');
  const c = await S.conflicts(kv, 'a1');
  assert.equal(c[0].set.title, '端末Bの修正', '書けなかった内容も残す（データを失わない）');
  assert.equal(c[0].expectedRev, 1); assert.equal(c[0].currentRev, 2);
});

test('同時の書き込み：同じ更新番号で同時に書いても、通るのは1つだけ（番号が飛ばない）', async () => {
  const kv = memoryKv();
  await S.create(kv, { id: 'b1', set: set('b1') });
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => S.update(kv, 'b1', 1, { set: set('b1', { title: `同時${n}` }), by: `device:${n}` })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason instanceof S.ConflictError).length, 4);
  assert.equal((await S.get(kv, 'b1')).rev, 2);
});

test('状態の移り変わり：許されない移り変わりは断る。社長の判断は更新番号つきで記録する', async () => {
  const kv = memoryKv();
  await S.create(kv, { id: 'c1', set: set('c1'), state: 'ready' });
  const r = await S.decide(kv, 'c1', 1, { action: 'reject', reason: '方向が違う' });
  assert.equal(r.state, 'rejected'); assert.equal(r.decision.reason, '方向が違う');
  await assert.rejects(S.update(kv, 'c1', r.rev, { state: 'published' }), S.StateError, '却下から公開はできない');
  await assert.rejects(S.decide(kv, 'c1', 1, { action: 'approve' }), S.ConflictError, '古い番号では判断できない');
  assert.ok((await S.meta(kv)).lastOwnerDecisionAt);
});

test('移行：端末の投稿セットを取り込む。何度送っても増えない。サーバーの判断を古い端末のデータで上書きしない。状態を読み替える', async () => {
  const kv = memoryKv();
  const local = [
    { ...set('s1'), status: 'new' },
    { ...set('s2'), status: 'adopted', decidedAt: '2026-11-10T00:00:00Z', reason: '' },
    { ...set('s3'), status: 'rejected', reason: '日用品' },
    { ...set('s4'), status: 'adopted', igPost: { url: 'https://www.instagram.com/p/X/' } },
    { ...set('s5'), status: 'new', supersededBy: 's1' },
    { id: '', status: 'new' }
  ];
  const r1 = await S.importSets(kv, local, { deviceId: 'iphone' });
  assert.equal(r1.created.length, 5); assert.equal(r1.invalid.length, 1);
  const byId = Object.fromEntries((await S.list(kv)).map((x) => [x.id, x]));
  assert.equal(byId.s1.state, 'shelf'); assert.equal(byId.s2.state, 'approved'); assert.equal(byId.s3.state, 'rejected'); assert.equal(byId.s4.state, 'published'); assert.equal(byId.s5.state, 'expired');
  assert.equal(byId.s1.set.status, undefined, '端末の status は中身に混ぜない（state が正本）');
  // サーバー側で社長が s1 を却下したあと、古い端末がもう一度送っても上書きしない
  await S.update(kv, 's1', byId.s1.rev, { state: 'ready', by: 'server' });
  const cur = await S.get(kv, 's1');
  await S.decide(kv, 's1', cur.rev, { action: 'reject' });
  const r2 = await S.importSets(kv, local, { deviceId: 'old-iphone' });
  assert.equal(r2.created.length, 0); assert.equal(r2.skipped.length, 5);
  assert.equal(r2.same.length, 4);
  assert.equal(r2.different.length, 1, 's1 はサーバーで却下済み：黙って成功にせず差異として返す');
  assert.match(r2.different[0].why, /判断・状態が違う/);
  assert.equal((await S.conflicts(kv, 's1'))[0].kind, '移行のときの差異', '端末の中身を控えに残す');
  assert.equal((await S.get(kv, 's1')).state, 'rejected', 'サーバーの判断は変えない');
  // 読み戻しの照合：IDだけでなく、中身・判断・件数を比べる
  const v = await S.verify(kv, [...local.slice(1, 5), { ...set('zz'), status: 'new' }]);
  assert.equal(v.ok, false); assert.equal(v.matched, 4); assert.deepEqual(v.missing, ['zz']);
  assert.equal((await S.verify(kv, local.slice(1, 5))).ok, true);
  const changed = await S.verify(kv, [{ ...local[1], title: '端末で変えたタイトル' }]);
  assert.equal(changed.ok, false); assert.match(changed.different[0].why, /中身が違う/);
});

test('棚：公開待ちは最大3件（点数の高い順に繰り上げ）。控えは最大6件（超えた分・14日たった分は期限切れへ。消さない）', async () => {
  const kv = memoryKv();
  const old = new Date(Date.now() - 20 * 86400000).toISOString();
  for (let i = 1; i <= 11; i++) await S.create(kv, { id: `n${i}`, set: set(`n${i}`, { createdAt: i === 11 ? old : new Date(Date.now() - i * 60000).toISOString() }), score: 70 + i, state: 'shelf' });
  const changes = await S.rebalance(kv);
  const c = await S.counts(kv);
  assert.equal(c.ready, 3); assert.equal(c.shelf, 6); assert.equal(c.expired, 2);
  const ready = (await S.list(kv, { states: ['ready'] })).map((x) => x.id).sort();
  assert.deepEqual(ready, ['n10', 'n8', 'n9'], '14日たった n11 は点数が高くても期限切れ。残りの上位3件が公開待ち');
  assert.equal((await S.get(kv, 'n11')).state, 'expired');
  assert.ok(changes.length >= 5);
  assert.equal((await S.list(kv)).length, 11, '何も消さない');
  assert.deepEqual(await S.capacity(kv), { ...c, unpublished: 9, room: 0 });
});

test('API：/api/data は合言葉が必要。競合は409と今の中身を返す。移行・照合・一覧・判断', async () => {
  const kv = memoryKv();
  const env = { APP_PASSCODE: 'pw', __kv: kv };
  const call = async (body, headers = { 'x-app-passcode': 'pw' }) => { const req = { method: 'POST', url: '/api/data', headers, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await data(req, res, env); return { status: res.statusCode, data: JSON.parse(res.body) }; };
  assert.equal((await call({ action: 'list' }, {})).status, 401);
  const d1 = { ...set('d1'), status: 'new' };
  const imp = await call({ action: 'import', deviceId: 'A', sets: [d1] });
  assert.equal(imp.data.created.length, 1);
  assert.equal((await call({ action: 'verify', sets: [d1] })).data.ok, true);
  const l = await call({ action: 'list' });
  assert.equal(l.data.sets[0].id, 'd1'); assert.equal(l.data.limits.ready, 3);
  assert.equal(l.data.sets[0].state, 'ready', '取り込んだあと棚の整理で公開待ちへ');
  const rev = l.data.sets[0].rev;
  const put = await call({ action: 'put', id: 'd1', expectedRev: rev, set: { ...set('d1'), title: 'A' }, deviceId: 'A' });
  assert.equal(put.data.rec.rev, rev + 1);
  const stale = await call({ action: 'put', id: 'd1', expectedRev: rev, set: { ...set('d1'), title: 'B' }, deviceId: 'B' });
  assert.equal(stale.status, 409); assert.equal(stale.data.current.rev, rev + 1); assert.equal(stale.data.current.set.title, 'A');
  const bad = await call({ action: 'decide', id: 'd1', expectedRev: rev + 1, decision: 'publish' });
  assert.equal(bad.status, 400);
  assert.equal((await call({ action: 'decide', id: 'd1', expectedRev: rev + 1, decision: 'approve' })).data.rec.state, 'approved');
  assert.equal((await call({ action: 'list' }, { 'x-app-passcode': 'pw' })).data.capacity.approved, 1);

});

test('公開の接続テストの準備：/api/ig の readiness は、必要な設定の有無（名前だけ）を返し、投稿はしない', async () => {
  const ig = (await import('../server/ig.js')).default;
  const call = async (env) => { const req = { method: 'POST', url: '/api/ig', headers: {}, body: { action: 'readiness' } }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await ig(req, res, env); return JSON.parse(res.body); };
  const r = await call({ KV_REST_API_URL: 'https://kv', IG_ACCESS_TOKEN: '' });
  assert.equal(r.readiness, true);
  assert.deepEqual(r.missing, ['IG_ACCESS_TOKEN', 'IG_PUBLISH_ENABLED']);
  assert.ok(!JSON.stringify(r).includes('https://kv'), '値は出さない');
  assert.match(r.imagePipeline, /未実装/);
});


// ---- 異常系（2026-11-14 レビュー対応）----
const callData = async (env, body, headers = {}) => { const req = { method: 'POST', url: '/api/data', headers, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await data(req, res, env); return { status: res.statusCode, text: res.body, data: JSON.parse(res.body) }; };

test('認証なし：合言葉（APP_PASSCODE）が未設定なら、投稿セットも社長の判断も読めず変えられない。違う合言葉も断る。合言葉の値は応答に出さない', async () => {
  const kv = memoryKv();
  await S.create(kv, { id: 'x1', set: set('x1'), state: 'ready' });
  for (const body of [{ action: 'list' }, { action: 'decide', id: 'x1', expectedRev: 1, decision: 'approve' }, { action: 'put', id: 'x1', expectedRev: 1, set: set('x1') }, { action: 'import', sets: [set('x2')] }]) {
    const r = await callData({ __kv: kv }, body, { 'x-app-passcode': 'anything' });
    assert.equal(r.status, 503, JSON.stringify(body));
    const w = await callData({ __kv: kv, APP_PASSCODE: 'secret-pw-123' }, body, { 'x-app-passcode': 'wrong' });
    assert.equal(w.status, 401);
    assert.ok(!w.text.includes('secret-pw-123') && !r.text.includes('secret-pw-123'), '合言葉の値を出さない');
  }
  assert.equal((await S.get(kv, 'x1')).state, 'ready', '何も変わっていない');
  assert.equal((await S.list(kv)).length, 1);
});

test('同時更新：読んでから書くまでの間に別の処理が書いたら、照合と保存が1つの命令なので競合になる（時間で外れる鍵に頼らない）', async () => {
  const kv = memoryKv();
  await S.create(kv, { id: 'y1', set: set('y1') });
  // 遅い処理（読んだあと書く前に待つ）
  const slow = { ...kv, eval: async (...a) => { await new Promise((r) => setTimeout(r, 30)); return kv.eval(...a); } };
  const p = S.update(slow, 'y1', 1, { set: set('y1', { title: '遅い処理' }), by: 'slow' });
  await S.update(kv, 'y1', 1, { set: set('y1', { title: '速い処理' }), by: 'fast' });
  await assert.rejects(p, S.ConflictError);
  const r = await S.get(kv, 'y1');
  assert.equal(r.set.title, '速い処理'); assert.equal(r.rev, 2);
  assert.equal((await S.conflicts(kv, 'y1'))[0].set.title, '遅い処理', '書けなかった中身は残る');
});

test('Upstash 互換：原子的な操作は EVAL（Lua）で送り、競合・作成済みの戻り値を正しく読む', async () => {
  const { restKv, SCRIPTS } = await import('../lib/kv.js');
  const sent = [];
  let reply = null;
  const fetchImpl = async (url, opts) => { const body = JSON.parse(opts.body); sent.push(body); return { ok: true, json: async () => ({ result: typeof reply === 'function' ? reply(body) : reply }) }; };
  const kv = restKv({ url: 'https://kv.example', token: 't' }, fetchImpl);
  reply = (b) => (b[0] === 'EVAL' ? 0 : JSON.stringify({ id: 'z1', rev: 3, state: 'ready', set: {} }));
  const c = await S.create(kv, { id: 'z1', set: set('z1') });
  assert.equal(c.created, false);
  const ev = sent.find((b) => b[0] === 'EVAL');
  assert.equal(ev[1], SCRIPTS.createIfAbsent); assert.equal(ev[2], '4'); assert.deepEqual(ev.slice(3, 7), ['data:set:z1', 'data:rev:z1', 'data:sets:index', 'data:state:shelf']);
  reply = (b) => (b[0] === 'EVAL' ? [0, '4'] : b[0] === 'GET' ? JSON.stringify({ id: 'z1', rev: 3, state: 'ready', set: {}, history: [] }) : 1);
  await assert.rejects(S.update(kv, 'z1', 3, { set: set('z1') }), S.ConflictError);
  assert.ok(sent.some((b) => b[0] === 'EVAL' && b[1] === SCRIPTS.casMove && b[2] === '5' && b[8] === '3'), '読んだ番号を添えて送る（鍵5つ：中身・番号・一覧・移る前と後の状態の集合）');
  assert.ok(!SCRIPTS.casMove.includes('cjson'), '追加の機能に頼らない（標準の命令だけ）');
});

test('鍵の解除：時間切れのあとにほかの実行が取った鍵は外さない', async () => {
  const kv = memoryKv();
  await kv.set('worker:lock', 'A', { nx: true, ex: 58 });
  await kv.del('worker:lock'); // 時間切れを再現
  await kv.set('worker:lock', 'B', { nx: true, ex: 58 });
  assert.equal(Number(await kv.delIf('worker:lock', 'A')), 0);
  assert.equal(await kv.get('worker:lock'), 'B');
  assert.equal(Number(await kv.delIf('worker:lock', 'B')), 1);
});
