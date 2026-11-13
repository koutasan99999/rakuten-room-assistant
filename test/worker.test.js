import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { tick, state, readSnapshot, WORKER_KEYS, QUOTA } from '../lib/worker.js';
import { check, record } from '../lib/budget.js';
import { withUsage } from '../lib/ai-usage.js';
import worker from '../server/worker.js';
import router from '../api/[route].js';
import { installFetchMock, json, aiReply } from './mock.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', CRON_SECRET: 'sec' };
const ritem = (code, name, price, caption) => ({ itemCode: code, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${code.replace(/\W/g, '')}/`, mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/x.jpg'], shopName: 'ショップ', itemCaption: caption, reviewCount: 3 });
const SHOP = [ritem('s:lid', 'ステンレス 鍋蓋スタンド', 1000, '水受けトレー付きで、水滴がたれにくい。')];
function fetchMock({ failAi = false } = {}) {
  return installFetchMock({
    rakuten: (url) => json(200, { Items: url.searchParams.get('itemCode') ? SHOP.filter((x) => x.itemCode === url.searchParams.get('itemCode')) : SHOP }),
    openai: (body) => {
      if (failAi) return json(500, { error: { message: 'server error' } });
      const sys = body.messages[0].content;
      if (sys.includes('検索語を決めます')) return aiReply({ keywords: [{ keyword: 'キッチン 便利', why: 'x' }] });
      if (sys.includes('候補を最大3件選びます')) return aiReply({ candidates: [{ ref: 'R1', quotes: ['水受けトレー付き'], reason: '水受けトレー付きで水滴がたれにくい', target: '料理する人', problem: 'ふたの置き場所', roomValue: '1,000円', cautions: '大きさを確認' }] });
      if (sys.includes('監査AIです') && sys.includes('コメント案を')) return aiReply({ audits: [{ id: 'AAA1', scores: { specific: 23, natural: 21, relevance: 17, distance: 14, compliance: 15 }, flags: {}, fixes: [], proposal: 'pass' }] });
      if (sys.includes('監査AIです')) return aiReply({ audits: [{ id: 'c1', scores: { accuracy: 25, evidence: 22, usefulness: 17, revenue: 13, compliance: 15 }, flags: {}, fixes: [], proposal: 'pass' }] });
      if (sys.includes('営業・交流担当AIです')) return aiReply({ drafts: [{ id: 'AAA1', anchor: '水受けトレー付き', comment: '水受けトレー付きなら台が濡れにくそうですね', relevance: 80, relevanceWhy: 'x', follow: 70, followWhy: 'y' }] });
      return aiReply({});
    }
  });
}
const SNAP = { themes: ['キッチンの便利グッズ'], avoid: [], past: [], outreachPosts: [{ id: 'AAA1', url: 'https://www.instagram.com/p/AAA1/', handle: 'k', caption: '鍋のふたの置き場所に困って、水受けトレー付きのスタンドを置きました。', source: '社長が追加' }], pendingBuyer: 0 };
const run = (kv, env = ENV) => withUsage(() => tick({ kv, env, startedAt: Date.now() }));

test('自律運営：1回1段階ずつ進め、営業・交流 → バイヤーの順に仕事を終える。成果物はサーバーに残り、アプリが受け取れる。費用（実測）をサーバー側で記録する', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  assert.match((await run(kv)).skipped, /アプリの情報がまだ/);
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  const steps = [];
  for (let i = 0; i < 12; i++) { const r = await run(kv); steps.push(r.worked ? `${r.worked.agent}:${r.worked.step}:${r.worked.ok}${r.worked.final ? ':' + r.worked.final : ''}` : r.idle ? 'idle' : r.skipped); if (r.idle) break; }
  assert.deepEqual(steps, ['outreach:draft:true', 'outreach:audit:true:done', 'buyer:buyer:true', 'buyer:check:true', 'buyer:audit:true:done', 'buyer:buyer:true', 'buyer:check:true', 'buyer:audit:true:done', 'idle'], steps.join(' / '));
  const st = await state(kv, ENV);
  assert.equal(st.outreach[0].postId, 'AAA1');
  assert.equal(st.outreach[0].outreach.status, 'pass');
  assert.equal(st.outreach[0].outreach.final, '水受けトレー付きなら台が濡れにくそうですね');
  assert.equal(st.buyer.length, QUOTA.buyer, '1日の上限まで');
  assert.equal(st.buyer[0].candidates[0].status, 'pass');
  assert.ok(st.buyer[0].runs.every((r) => r.openaiId), '実際のAIの呼び出しの記録（応答ID）');
  assert.ok(st.budget.spent.month > 0 && st.budget.spent.dayAuto === st.budget.spent.month);
  assert.equal(st.log[0].ok, true);
});

test('二重実行の防止：鍵を持っている間は、次の実行は何もしない', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  await kv.set(WORKER_KEYS.lock, 'x', { nx: true, ex: 58 });
  assert.match((await run(kv)).skipped, /二重実行/);
  assert.equal(mock.calls.openai.length, 0);
});

test('費用の上限：月の上限（全体）と、自律運営の1日の上限を超えるなら動かない。画面から呼んだAIもサーバー側で止める', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  await record(kv, 24, { auto: true });
  assert.match((await run(kv)).skipped, /自律運営の費用が上限/);
  await record(kv, 980, { auto: false });
  assert.equal((await check(kv, ENV, { estimate: 0 })).ok, false);
  assert.match((await run(kv)).skipped, /今月のAIの費用が上限/);
  assert.equal(mock.calls.openai.length, 0);
  // 画面から呼んだAI（api/[route].js）も、上限なら止める
  process.env.OPENAI_API_KEY = 'sk-test'; process.env.RAKUTEN_APP_ID = 'app';
  process.env.KV_REST_API_URL = 'https://kv.example'; process.env.KV_REST_API_TOKEN = 't';
  const kvFetch = mock;
  mock.restore();
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply({ intro: 'x'.repeat(80) }) });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (String(url).startsWith('https://kv.example') ? json(200, { result: (await kv.cmd(...JSON.parse(opts.body))) }) : original(url, opts));
  try {
    const req = { method: 'POST', url: '/api/pitch', query: { route: 'pitch' }, headers: { host: 'x.app' }, body: { action: 'intro', product: { name: 'テスト', price: 1000 } } };
    const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
    await router(req, res);
    assert.equal(mock.calls.openai.length, 0, '上限ならAIを呼ばない');
    assert.match(JSON.parse(res.body).notice || JSON.parse(res.body).error || '', /簡易的|上限|うまく/);
  } finally {
    globalThis.fetch = original;
    delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; delete process.env.OPENAI_API_KEY; delete process.env.RAKUTEN_APP_ID;
  }
  void kvFetch;
});

test('API障害：同じ段階は3回まで、連続3回の失敗で6時間休む。失敗を正常終了にしない', async () => {
  mock = fetchMock({ failAi: true });
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot({ ...SNAP, outreachPosts: [] }));
  const r1 = await run(kv); const r2 = await run(kv); const r3 = await run(kv);
  assert.equal(r1.worked.ok, false);
  assert.equal(r3.worked.final, 'failed');
  const r4 = await run(kv);
  assert.match(r4.skipped, /休止中/);
  const st = await state(kv, ENV);
  assert.equal(st.buyer[0].status, 'failed');
  assert.match(st.buyer[0].error, /500/);
  assert.ok(st.health.pausedUntil);
  void r2;
});

test('API：定期実行は合言葉が必要。保存場所が未接続なら何もしない', async () => {
  const call = async (env, headers, body) => { const req = { method: 'POST', url: '/api/worker', headers: { host: 'x.app', ...headers }, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await worker(req, res, env); return { status: res.statusCode, data: JSON.parse(res.body) }; };
  assert.equal((await call({ ...ENV }, {}, { action: 'tick' })).status, 401);
  assert.equal((await call({ ...ENV }, { authorization: 'Bearer sec' }, { action: 'tick' })).data.configured, false);
  assert.equal((await call({ ...ENV }, {}, { action: 'state' })).data.configured, false);
  const kv = memoryKv();
  const s = await call({ ...ENV, __kv: kv }, {}, { action: 'sync', snapshot: { ...SNAP, outreachPosts: [...SNAP.outreachPosts, { id: 'z', url: 'https://example.com/p/1', caption: 'あいうえおかきく' }] } });
  assert.equal(s.data.outreachPosts, 1, 'Instagramの投稿のURLでなければ受け取らない');
});
