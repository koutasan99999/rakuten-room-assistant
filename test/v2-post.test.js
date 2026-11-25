// 2.0「ポスト」（2026-11-16）：社長のスクショを鑑定が読み、バイヤーが楽天で探して、根拠つきで返す。人物は画像から判断しない。投稿セットは作らない
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { withUsage } from '../lib/ai-usage.js';
import * as Post from '../lib/v2/post.js';
import * as V from '../lib/v2/company.js';
import v2api from '../server/v2.js';
import { spent } from '../lib/budget.js';
import { installFetchMock, json, aiReply, TINY_PNG } from './mock.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', APP_PASSCODE: 'pw', __noWait: true, POST_LOOKUP: 'on' }; // 停止中（2026-11-25）。仕組みの試験だけ戻した状態で行う
const ritem = (code, name, price) => ({ itemCode: code, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${code.replace(/\W/g, '')}/`, mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/x.jpg'], shopName: 'ショップ', itemCaption: name, reviewCount: 10, reviewAverage: 4 });
let lastUser = null;
function fetchMock() {
  return installFetchMock({
    rakuten: (url) => { const kw = url.searchParams.get('keyword') || ''; if (/迷彩/.test(kw)) return json(200, { Items: [ritem('s:hat1', '迷彩 バケットハット コットン', 2980)] }); if (/MOTTERU/.test(kw)) return json(200, { Items: [ritem('s:st1', 'MOTTERU スマホスタンド MOT-SPSTD02', 1980), ritem('s:st2', 'MOTTERU タブレットスタンド', 2480)] }); return json(200, { Items: [] }); },
    openai: (body) => { lastUser = body.messages[1].content; return aiReply({ candidates: [
      { who: '右の人', category: '帽子', color: '迷彩', visibleText: '', logo: 'オレンジの刺繍', features: ['バケットハット'], confidence: 'medium', searchQuery: '迷彩 バケットハット' },
      { who: '左の人', category: 'スマホスタンド', color: 'シルバー', visibleText: 'MOTTERU MOT-SPSTD02', features: [], confidence: 'high', searchQuery: 'MOTTERU スタンド' },
      { who: '左の人', category: 'ネックレス', color: 'ゴールド', visibleText: '', features: [], confidence: 'low', searchQuery: 'ゴールド 細い ネックレス 小さめ ペンダント' }
    ], note: '写りが小さい' }); }
  });
}
const call = async (body, env) => { const req = { method: 'POST', url: '/api/v2', headers: { 'x-app-passcode': 'pw' }, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await withUsage(() => v2api(req, res, env)); return { status: res.statusCode, data: JSON.parse(res.body) }; };
const IMG = `data:image/png;base64,${TINY_PNG}`;

test('ポストは停止中（2026-11-25・社長の指示）：既定では受け付けず、AIも楽天も呼ばない。保存済みの一覧は読める', async () => {
  let called = 0;
  mock = installFetchMock({ rakuten: () => { called++; return new Response('{}'); }, openai: () => { called++; throw new Error('AIは呼ばない'); } });
  const kv = memoryKv(); const env = { ...ENV, POST_LOOKUP: '', __kv: kv };
  const r = await call({ action: 'post', image: IMG, note: 'x' }, env);
  assert.equal(r.status, 400); assert.match(r.data.error, /停止/);
  assert.equal(called, 0);
  assert.equal((await call({ action: 'posts' }, env)).status, 200);
});

test('ポスト：鑑定が候補を抜き出し、バイヤーが楽天で探し、型番の一致＝同一／文字の一致＝可能性あり／見た目だけ＝類似／見つからない＝未特定 と根拠つきで返す', async () => {
  mock = fetchMock();
  const kv = memoryKv(); const env = { ...ENV, __kv: kv };
  const r = await call({ action: 'post', image: IMG, note: '紅しょうが' }, env);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = r.data.post;
  assert.equal(p.status, 'done');
  const [hat, stand, neck] = p.candidates;
  assert.equal(hat.level, 'similar'); assert.match(hat.matches[0].why, /文字やロゴが読めないため/);
  assert.equal(stand.level, 'same'); assert.match(stand.matches[0].why, /型番「MOT-SPSTD02」/); assert.equal(stand.matches[1].level, 'maybe');
  assert.equal(neck.level, 'none'); assert.equal(neck.label, '未特定');
  assert.match(JSON.stringify(lastUser), /人物名などは、このメモだけを使う/, '人物は社長のメモだけ');
  assert.equal(p.image.startsWith('/api/media?id='), true, 'スクショは推測できないIDで非公開に保存');
  assert.ok((await spent(kv)).month > 0, '費用を記録');
  const list = (await call({ action: 'posts' }, env)).data.posts; assert.equal(list[0].id, p.id);
  const st = await V.officeState(kv, env);
  assert.ok(st.events.some((e) => e.agent === 'appraiser' && e.type === 'done'), '過去の記録の担当名は残る');
  assert.ok(!st.staff.find((s) => s.id === 'appraiser'), '社員「鑑定」は廃止（2026-11-25）');
  await call({ action: 'postDelete', id: p.id }, env);
  assert.equal((await call({ action: 'posts' }, env)).data.posts.length, 0, '消せる');
});

test('ポスト：画像でない物・予算の上限・1日の上限では受け付けない', async () => {
  mock = fetchMock();
  const kv = memoryKv(); const env = { ...ENV, __kv: kv };
  assert.equal((await call({ action: 'post', image: 'hello' }, env)).status, 400);
  await kv.incrFloat(`budget:month:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7)}`, 999);
  const r = await call({ action: 'post', image: IMG }, env);
  assert.equal(r.status, 400); assert.match(r.data.error, /上限/);
  const judge = Post.judge({ visibleText: 'ABC' , category: '帽子', color: '黒' }, { name: 'xyz 帽子' });
  assert.equal(judge.level, 'similar');
});
