// 2026-11-18 集客の施策（入口を増やす）：施策のボード・AIの準備（検索の文言・プロフィール・新しい施策）・効果の判定
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { withUsage } from '../lib/ai-usage.js';
import * as G from '../lib/v2/growth.js';
import * as V from '../lib/v2/company.js';
import v2api from '../server/v2.js';
import { installFetchMock, aiReply } from './mock.js';
import { OFFICIAL_SITES } from '../lib/ig-discovery.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', APP_PASSCODE: 'pw' };
const call = async (kv, body) => { const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await v2api({ method: 'POST', url: '/api/v2', headers: { 'x-app-passcode': 'pw' }, body }, res, { ...ENV, __kv: kv }); return { status: res.statusCode, data: JSON.parse(res.body) }; };
const SET = { id: 's1', title: '冬の机まわり', status: 'waiting', who: '在宅の人', products: [{ name: '卓上加湿器', price: 2380, role: '本命' }, { name: 'ケーブルトレー', price: 3380, role: '関連商品' }] };
const seed = async (kv) => { await kv.setJson('v2:sets', [{ id: 's1', title: SET.title, status: 'waiting' }]); await kv.setJson('v2:set:s1', SET); };

test('施策のボード：根拠つきの最初の施策が並び、自動のいいね・フォローは「しない」。準備が要る施策は準備中', async () => {
  const kv = memoryKv(); await seed(kv);
  const s = await G.growthState(kv);
  const by = Object.fromEntries(s.tactics.map((t) => [t.id, t]));
  assert.equal(by['no-auto'].status, 'dropped');
  assert.equal(by.reels.status, 'preparing', '動画の実ファイルを作ったリールが無いうちは「実行できる」にしない');
  assert.equal(by.seo.status, 'preparing', '検索の文言がまだ無い');
  assert.equal(by.profile.status, 'preparing');
  assert.ok(by.collab.texts[0].text.includes('@gla_san_kuma_'));
  for (const t of s.tactics) assert.ok(t.basis.startsWith('根拠：'), t.id);
});

test('ライター：検索の文言を作り、体験談・データに無い数字・#PRの重複は落とす。作った完成品は繰り返さない', async () => {
  mock = installFetchMock({ rakuten: () => new Response('{}'), openai: () => aiReply({ keywords: ['加湿器 卓上', 'デスク 乾燥', '在宅 便利', '愛用の加湿器'], line: '卓上の加湿器とケーブルトレーで、在宅の机を整える', alt: '机の上に置いた小さな加湿器とケーブルトレー', hashtags: ['#卓上加湿器', '#デスク周り', '#在宅ワーク', '#PR'], story: '机の上、乾燥してない？' }) });
  const kv = memoryKv(); await seed(kv);
  const w = await G.seoWork(kv);
  assert.equal(w.kind, 'seo');
  const r = await withUsage(() => w.run({ env: ENV }));
  assert.ok(r.done, r.fail);
  const s = await kv.getJson('v2:set:s1');
  assert.deepEqual(s.seo.keywords, ['加湿器 卓上', 'デスク 乾燥', '在宅 便利'], '「愛用」は落とす');
  assert.deepEqual(s.seo.hashtags, ['#卓上加湿器', '#デスク周り', '#在宅ワーク']);
  assert.match(s.seo.story, /PR/);
  assert.equal(await G.seoWork(kv), null);
  assert.equal(G.seoOk({ keywords: ['a', 'b', 'c'], line: '99%の人が知らない', alt: 'x', hashtags: ['#a', '#b', '#c'], story: 'y' }, SET).ok, false, 'データに無い数字');
  const b = await G.growthState(kv);
  assert.equal(b.tactics.find((t) => t.id === 'seo').status, 'ready');
});

test('広報：交流の仕事が無いときにプロフィールの案を作る（眼科医・数字は落とす・PR表記を足す）', async () => {
  mock = installFetchMock({ rakuten: () => new Response('{}'), openai: () => aiReply({ name: 'サングラスくま｜楽天の便利グッズ', bios: ['楽天市場の「こんなのあったんだ」をくまが紹介\n毎日の小さな困りごとに', '眼科医のくまが選ぶ便利グッズ', 'フォロワー1000人突破！', '暮らしの便利グッズを紹介\n楽天ROOMはこちら（PR）'], highlights: ['キッチン', '収納', 'デスク'] }) });
  const kv = memoryKv();
  await kv.setJson('v2:pr:state', { siteChecks: Object.fromEntries(Object.keys(OFFICIAL_SITES).map((b) => [b, new Date().toISOString()])) });
  const w = await V.findWork('pr', { kv, env: ENV });
  assert.equal(w.kind, 'profile');
  const r = await withUsage(() => w.run({ env: ENV }));
  assert.ok(r.done, r.fail);
  const s = await G.growthState(kv);
  const p = s.tactics.find((t) => t.id === 'profile');
  assert.equal(p.status, 'ready');
  const bios = p.texts.filter((x) => x.label.startsWith('自己紹介')).map((x) => x.text);
  assert.equal(bios.length, 2);
  assert.ok(bios.every((b) => /PR/.test(b) && !/眼科医|1000/.test(b)));
  assert.equal(await G.profileWork(kv), null, '作ったら繰り返さない');
});

test('企画：空き時間に新しい施策を考える（規約違反・重複は入れない・1日1回・未着手3件で止める）', async () => {
  mock = installFetchMock({ rakuten: () => new Response('{}'), openai: () => aiReply({ ideas: [{ name: '自動いいねツールで露出', why: 'x', steps: ['a'] }, { name: 'リールを3つの型で続けて出す', why: 'y', steps: ['b'] }, { name: '季節の行事に合わせた3選を月初に出す', channel: 'リール', scope: 'post', why: '季節の言葉は検索されやすい（未確認）', steps: ['月初に季節の3選を作る'] }] }) });
  const kv = memoryKv();
  const w = await V.findWork('planner', { kv, env: ENV });
  assert.equal(w.kind, 'growth-idea');
  const r = await withUsage(() => w.run({ env: ENV }));
  assert.ok(r.done, r.fail);
  const s = await G.growthState(kv);
  const ai = s.tactics.filter((t) => t.source === 'ai');
  assert.equal(ai.length, 1, r.done);
  assert.equal(ai[0].status, 'proposed');
  assert.match(ai[0].basis, /AIの知識（未確認）/);
  const again = await V.findWork('planner', { kv, env: ENV });
  assert.ok(again.none && /1日1回/.test(again.none));
  const g = await kv.getJson('v2:growth');
  g.ideas.push({ id: 'i2', name: 'あ', why: 'x', steps: ['a'] }, { id: 'i3', name: 'い', why: 'x', steps: ['a'] }); delete g.ideasAt;
  await kv.setJson('v2:growth', g);
  assert.match((await G.ideaWork(kv)).none, /まだ見ていない施策の案が3件/);
});

test('効果の判定：施策を付けた投稿の平均が1.3倍以上で効果あり・3投稿で平均以下なら見直し（記録に残り、企画は待たずに代わりを考える）', async () => {
  const kv = memoryKv(); await seed(kv);
  for (const v of [100, 120]) await call(kv, { action: 'perfAdd', perf: { format: 'reel', views: v } });
  await call(kv, { action: 'perfAdd', perf: { format: 'reel', views: 200, tactics: ['reels'] } });
  let s = await G.growthState(kv);
  assert.equal(s.tactics.find((t) => t.id === 'reels').eval.result, 'measuring', '1投稿では判定しない');
  await call(kv, { action: 'perfAdd', perf: { format: 'reel', views: 180, tactics: ['reels'] } });
  s = await G.growthState(kv);
  const reels = s.tactics.find((t) => t.id === 'reels');
  assert.equal(reels.status, 'measured'); assert.equal(reels.eval.avg, 190); assert.equal(reels.eval.base, 110);
  await kv.setJson('v2:growth', { ...(await kv.getJson('v2:growth')), ideasAt: new Date().toISOString() });
  for (const v of [50, 60, 70]) await call(kv, { action: 'perfAdd', perf: { format: 'feed', views: v, tactics: ['hashtags'] } });
  s = await G.growthState(kv);
  assert.equal(s.tactics.find((t) => t.id === 'hashtags').status, 'review');
  const ev = (await kv.listJson('v2:events', 50)).map((e) => e.text).join('\n');
  assert.match(ev, /「リールを3つの型.*」は効果あり/); assert.match(ev, /ハッシュタグ.*見直し/);
  assert.equal((await kv.getJson('v2:growth')).ideasAt, undefined, '見直しが出たら企画は1日を待たない');
});

test('社長の操作：やった・やめる・戻す（記録だけ。Instagramへは何も送らない）。「しない」施策は選べない', async () => {
  mock = installFetchMock({ rakuten: () => new Response('{}'), openai: () => { throw new Error('AIは呼ばない'); } });
  const kv = memoryKv();
  assert.equal((await call(kv, { action: 'growthDecide', id: 'pin', decision: 'doing' })).status, 200);
  let t = (await G.growthState(kv)).tactics.find((x) => x.id === 'pin');
  assert.equal(t.status, 'doing'); assert.ok(t.doneAt);
  await call(kv, { action: 'growthDecide', id: 'pin', decision: 'drop', why: '固定する投稿がまだない' });
  t = (await G.growthState(kv)).tactics.find((x) => x.id === 'pin');
  assert.equal(t.status, 'dropped'); assert.equal(t.droppedWhy, '固定する投稿がまだない');
  await call(kv, { action: 'growthDecide', id: 'pin', decision: 'reopen' });
  assert.notEqual((await G.growthState(kv)).tactics.find((x) => x.id === 'pin').status, 'dropped');
  assert.equal((await call(kv, { action: 'growthDecide', id: 'no-auto', decision: 'doing' })).status, 400);
  const st = await call(kv, { action: 'state' });
  assert.ok(st.data.growth.tactics.length >= 13);
});
