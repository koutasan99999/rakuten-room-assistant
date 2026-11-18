// 2026-11-18 集客（制作と集客の両輪）：冒頭の一言・投稿の実績・まとめ・企画への反映
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { withUsage } from '../lib/ai-usage.js';
import * as R from '../lib/v2/reach.js';
import * as V from '../lib/v2/company.js';
import v2api from '../server/v2.js';
import { installFetchMock, aiReply } from './mock.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', APP_PASSCODE: 'pw' };
const call = async (kv, body) => { const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await v2api({ method: 'POST', url: '/api/v2', headers: { 'x-app-passcode': 'pw' }, body }, res, { ...ENV, __kv: kv }); return { status: res.statusCode, data: JSON.parse(res.body) }; };
const SET = { id: 's1', title: '冬の机まわり', status: 'waiting', who: '在宅の人', products: [{ name: '卓上加湿器', price: 2380, role: '本命' }, { name: 'ケーブルトレー', price: 3380, role: '関連商品' }], hashtags: ['#デスク周り', '#サングラスくま'], deliveredAt: new Date().toISOString() };

test('冒頭の一言の決まり：体験談・人気・最強・データに無い数字は不合格。価格の数字は可', () => {
  assert.equal(R.hookOk('冬の机、乾燥してない？', SET), true);
  assert.equal(R.hookOk('2380円でここまで？', SET), true);
  for (const t of ['使ってみたら最高だった', '一番売れてる加湿器', '99%除菌できる', '絶対に必要']) assert.equal(R.hookOk(t, SET), false, t);
});

test('ライターの仕事探し：冒頭の一言の無い完成品に作り、決まりに合う物だけ残す（作った完成品は繰り返さない）', async () => {
  mock = installFetchMock({ rakuten: () => new Response('{}'), openai: () => aiReply({ reveal: '机の上、これで変わる？', compare: '', top3: '一番売れてる3つ', caption: '冬の机まわり、乾燥してない？' }) });
  const kv = memoryKv();
  await kv.setJson('v2:sets', [{ id: 's1', title: SET.title, status: 'waiting' }]); await kv.setJson('v2:set:s1', SET);
  const w = await R.hooksWork(kv);
  assert.equal(w.kind, 'hooks');
  const r = await withUsage(() => w.run({ env: ENV }));
  assert.ok(r.done, r.fail);
  const s = await kv.getJson('v2:set:s1');
  assert.equal(s.hooks.reveal, '机の上、これで変わる？'); assert.equal(s.hooks.top3, undefined, '「一番売れてる」は使わない');
  assert.equal(await R.hooksWork(kv), null, '作った完成品は繰り返さない');
});

test('投稿の実績：閲覧かリーチが必要。登録・まとめ（段階の目標・形式ごと）・企画への一文。スクショの読み取りは数字だけ（読めない物は空）', async () => {
  const kv = memoryKv();
  await kv.setJson('v2:set:s1', SET);
  assert.equal((await call(kv, { action: 'perfAdd', perf: { format: 'reel' } })).status, 400);
  await call(kv, { action: 'perfAdd', perf: { setId: 's1', format: 'reel', views: '1,234', saves: 12, profileVisits: 5, roomClicks: 2 } });
  await call(kv, { action: 'perfAdd', perf: { format: 'feed', title: '台所', views: 80, nonFollowerPct: 150 } });
  const list = await kv.getJson('v2:perf');
  assert.equal(list[1].views, 1234); assert.equal(list[1].title, '冬の机まわり');
  assert.equal(list[0].nonFollowerPct, null, '100%を超える割合は捨てる');
  const s = R.summarize(list);
  assert.deepEqual(s.milestones.map((m) => m.reached), [1, 1, 1]);
  assert.equal(s.topViews, 1234); assert.equal(s.nextTarget, null);
  assert.equal(s.totals.roomClicks, 2);
  assert.match(await R.plannerHint(kv), /冬の机まわり（リール・閲覧1234/);
  assert.equal(await R.plannerHint(memoryKv()), '', '登録が無ければ企画に何も渡さない（推測しない）');
  mock = installFetchMock({ rakuten: () => new Response('{}'), openai: () => aiReply({ views: 12000, reach: null, saves: 30, format: 'reel', postedAt: '2026-11-17', note: 'リーチは見えない' }) });
  const r = await withUsage(() => call(kv, { action: 'perfRead', image: 'data:image/jpeg;base64,' + Buffer.from('x').toString('base64') }));
  assert.equal(r.status, 200); assert.equal(r.data.read.views, 12000); assert.equal(r.data.read.reach, null);
  assert.equal((await kv.getJson('v2:perf')).length, 2, '読み取りだけでは登録しない（社長が確かめて登録）');
});

test('オフィスの集客の数字と、探す場所（完成品のハッシュタグ。自社のタグは除く）', async () => {
  const kv = memoryKv();
  await kv.setJson('v2:sets', [{ id: 's1', title: SET.title, status: 'waiting' }]); await kv.setJson('v2:set:s1', SET);
  assert.equal((await call(kv, { action: 'reelMade', id: 's1', format: 'top3' })).status, 400, '動画の実ファイルの記録（大きさ・長さ）が無いものは記録しない');
  assert.equal((await call(kv, { action: 'reelMade', id: 's1', format: 'top3', bytes: 1000, seconds: 16, mime: 'video/mp4' })).status, 400, '小さすぎる（作れていない）');
  assert.equal((await call(kv, { action: 'reelMade', id: 's1', format: 'top3', bytes: 2400000, seconds: 16.4, mime: 'video/mp4' })).status, 200);
  const st = await V.officeState(kv, ENV);
  assert.equal(st.reach.reels, 1); assert.equal(st.reach.noHooks, 1);
  assert.deepEqual(st.reach.exploreTags, ['デスク周り']);
});
