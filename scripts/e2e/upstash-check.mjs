// サーバーの正本（lib/store.js）を、実際の Upstash Redis で確かめる手順（2026-11-14）。
// 本番のデータには書き込まない：
//  - 本番の環境変数（KV_REST_API_URL・UPSTASH_REDIS_REST_URL）は読まない。検証用に作った別のデータベースの値を
//    UPSTASH_TEST_URL・UPSTASH_TEST_TOKEN として渡す（Upstash の無料枠で、検証専用のデータベースを別に作る）
//  - 念のため、本番と同じURLが渡されたら止める。すべての鍵に「e2e:乱数:」を付け、終わったら自分が使った鍵だけを消す
// 使い方：
//   UPSTASH_TEST_URL=https://…upstash.io UPSTASH_TEST_TOKEN=… node scripts/e2e/upstash-check.mjs
//   （手元で手順だけ確かめるとき：node scripts/e2e/upstash-check.mjs --memory）
import crypto from 'node:crypto';
import { restKv, memoryKv, prefixKv } from '../../lib/kv.js';
import * as S from '../../lib/store.js';

const memory = process.argv.includes('--memory');
const url = String(process.env.UPSTASH_TEST_URL || '').trim();
const token = String(process.env.UPSTASH_TEST_TOKEN || '').trim();
const prod = [process.env.KV_REST_API_URL, process.env.UPSTASH_REDIS_REST_URL].map((x) => String(x || '').trim()).filter(Boolean);
if (!memory) {
  if (!url || !token) { console.error('UPSTASH_TEST_URL と UPSTASH_TEST_TOKEN（検証専用のデータベース）を渡してください。本番の値は使いません'); process.exit(2); }
  if (prod.includes(url)) { console.error('本番と同じURLが渡されたため止めました（本番のデータに書き込まない）'); process.exit(2); }
}
const base = memory ? memoryKv() : restKv({ url, token });
const kv = prefixKv(base, `e2e:${crypto.randomBytes(4).toString('hex')}:`);
const set = (id, extra = {}) => ({ id, title: `検証${id}`, items: [{ name: 'n', price: 1000, code: `c:${id}` }], createdAt: new Date().toISOString(), ...extra });
const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['OK', name]); } catch (e) { results.push(['NG', `${name}：${e.message}`]); } };
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

try {
  await check('作成は冪等（2回目は作らない）', async () => {
    expect((await S.create(kv, { id: 'a1', set: set('a1') })).created === true, '1回目が作られない');
    expect((await S.create(kv, { id: 'a1', set: set('a1') })).created === false, '2回目も作られた');
  });
  await check('更新番号が違えば競合（EVAL の戻り値を正しく読む）', async () => {
    await S.update(kv, 'a1', 1, { set: set('a1', { title: 'A' }) });
    let conflict = false;
    try { await S.update(kv, 'a1', 1, { set: set('a1', { title: 'B' }) }); } catch (e) { conflict = e instanceof S.ConflictError; }
    expect(conflict, '競合にならない');
    expect((await S.get(kv, 'a1')).set.title === 'A', '先に書いた方が残らない');
  });
  await check('同じ番号で5つ同時に書いても、通るのは1つ', async () => {
    await S.create(kv, { id: 'b1', set: set('b1') });
    const r = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => S.update(kv, 'b1', 1, { set: set('b1', { title: `同時${n}` }) })));
    expect(r.filter((x) => x.status === 'fulfilled').length === 1, `通った数 ${r.filter((x) => x.status === 'fulfilled').length}`);
    expect((await S.get(kv, 'b1')).rev === 2, '番号が2にならない');
  });
  await check('公開待ちは同時に移しても3件まで', async () => {
    for (let i = 1; i <= 6; i++) await S.create(kv, { id: `c${i}`, set: set(`c${i}`), state: 'shelf', score: 80 + i });
    await Promise.allSettled([1, 2, 3, 4, 5, 6].map((i) => S.update(kv, `c${i}`, 1, { state: 'ready' })));
    const c = await S.counts(kv);
    expect(c.ready === 3, `公開待ち ${c.ready}件`);
  });
  await check('棚の整理を同時に3回：公開待ち3・控え6を超えない', async () => {
    for (let i = 1; i <= 8; i++) await S.create(kv, { id: `d${i}`, set: set(`d${i}`), state: 'shelf', score: 60 + i });
    await Promise.all([S.rebalance(kv), S.rebalance(kv), S.rebalance(kv)]);
    const c = await S.counts(kv);
    expect(c.ready <= 3 && c.shelf <= 6, `公開待ち ${c.ready}・控え ${c.shelf}`);
  });
  await check('移行と照合：中身・判断・件数（点検情報の違いは差異にしない）', async () => {
    const local = { ...set('e1'), status: 'new' };
    await S.importSets(kv, [local]);
    const rec = await S.get(kv, 'e1');
    await S.update(kv, 'e1', rec.rev, { set: { ...rec.set, inspection: { at: 'x', checked: 1, problems: [] } } });
    expect((await S.verify(kv, [local])).ok, '点検情報だけで差異になった');
    expect(!(await S.verify(kv, [{ ...local, titleEdit: '端末で直した' }])).ok, '端末の編集を見逃した');
  });
} finally {
  const n = await kv.cleanup().catch((e) => `片付けに失敗：${e.message}`);
  results.forEach(([r, m]) => console.log(`${r} ${m}`));
  console.log(`片付け：検証で使った鍵 ${n} 個を消しました（e2e: で始まる、この実行の鍵だけ）`);
  process.exitCode = results.some(([r]) => r === 'NG') ? 1 : 0;
}
