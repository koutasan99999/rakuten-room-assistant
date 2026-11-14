import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { tick, state, readSnapshot, WORKER_KEYS, QUOTA } from '../lib/worker.js';
import { check, record } from '../lib/budget.js';
import { withUsage } from '../lib/ai-usage.js';
import worker from '../server/worker.js';
import router from '../api/[route].js';
import { installFetchMock, json, aiReply, GOOD_INTRO } from './mock.js';

let mock;
let setAuditUsers = [];
afterEach(() => { if (mock) mock.restore(); mock = null; setAuditUsers = []; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', CRON_SECRET: 'sec', __noWait: true };
const ritem = (code, name, price, caption) => ({ itemCode: code, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${code.replace(/\W/g, '')}/`, mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/x.jpg'], shopName: 'ショップ', itemCaption: caption, reviewCount: 3 });
const SHOP = [ritem('s:lid', 'ステンレス 鍋蓋スタンド', 1000, '水受けトレー付きで、水滴がたれにくい。'), ritem('s:tong', 'シリコン トング 耐熱', 1200, 'フライパンを傷つけにくいシリコン製。'), ritem('s:guard', '油はねガード 折りたたみ', 1500, '3面で油はねを防ぐ。')];
function fetchMock({ failAi = false } = {}) {
  let setAudits = 0;
  return installFetchMock({
    rakuten: (url) => json(200, { Items: url.searchParams.get('itemCode') ? SHOP.filter((x) => x.itemCode === url.searchParams.get('itemCode')) : SHOP }),
    openai: (body) => {
      if (failAi) return json(500, { error: { message: 'server error' } });
      const sys = body.messages[0].content;
      const user = body.messages[1].content;
      // 制作ライン：企画担当AI・投稿セット制作AI・監査AI（投稿セット）・制作担当AI
      if (sys.includes('Instagram企画担当とバイヤー')) return aiReply({ pattern: 'discovery', title: 'キッチンの置き場所の工夫', target: '料理する人', reason: '置き場所に困る道具を並べる', appeal: '台所が片づく', adopted: [{ id: 0, role: '本命', feature: '水受けトレー付き', why: 'ふたの置き場所' }], slots: [{ role: '中価格帯', keyword: 'キッチン 道具' }, { role: '低価格帯', keyword: 'キッチン 便利' }] });
      if (sys.includes('企画の枠ごとに')) return aiReply({ picks: [{ slot: 0, id: 0, feature: 'シリコン製', why: 'フライパンを傷つけにくい' }, { slot: 1, id: 1, feature: '3面で油はねを防ぐ', why: 'コンロまわり' }] });
      if (sys.includes('投稿文字を作る担当')) return aiReply({ topicSlug: 'kitchen', category: 'キッチン', caption: '台所の置き場所、気づくと散らかりがち。\n\n今回は置き場所に困る道具を3つ並べました。\n\n買う前に見返せるよう、保存しておいてください。', hashtags: ['#キッチン用品'], cover: { title: 'キッチンの置き場所の工夫' }, items: [0, 1, 2].map((id) => ({ id, shortName: ['鍋蓋スタンド', 'シリコントング', '油はねガード'][id], subline: '置き場所が決まる', memo: '台所が片づく' })) });
      if (sys.includes('紹介文を書く担当')) return aiReply({ items: [0, 1, 2].map((id) => ({ id, intro: GOOD_INTRO })) });
      if (sys.includes('監査AIです') && sys.includes('投稿セット（Instagram')) {
        setAudits++;
        setAuditUsers.push(user);
        const sc = (a) => ({ accuracy: { score: a[0] }, compliance: { score: a[1] }, concept: { score: a[2] }, appeal: { score: a[3] }, room: { score: a[4] } });
        return setAudits === 1 ? aiReply({ scores: sc([22, 18, 15, 12, 12]), flags: {}, fixes: [{ target: 'caption', text: '誰のどんな場面かを1文足す' }], proposal: 'revise', summary: '場面が抽象的' })
          : aiReply({ scores: sc([24, 20, 18, 17, 13]), flags: {}, fixes: [], proposal: 'pass', summary: '商品データと一致し、場面も具体的' });
      }
      if (sys.includes('制作担当AIです')) return aiReply({ caption: '料理のたびに、ふたやトングの置き場所に迷う人へ。\n\n今回は置き場所に困る道具を3つ並べました。\n\n買う前に見返せるよう、保存しておいてください。', room: [], giveUp: '' });
      void user;
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

test('自律運営：1回1段階ずつ進め、営業・交流 → バイヤー → 合格候補を社長の確認なしで制作ライン（企画→制作→監査→修正）へ渡し、合格した投稿セットを社長の確認待ちにする。成果物はサーバーに残り、アプリが受け取れる。費用（実測）をサーバー側で記録する', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  assert.match((await run(kv)).skipped, /アプリの情報がまだ/);
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  const steps = [];
  for (let i = 0; i < 30; i++) { const r = await run(kv); steps.push(r.worked ? `${r.worked.agent}:${r.worked.step}:${r.worked.ok}${r.worked.final ? ':' + r.worked.final : ''}` : r.idle ? 'idle' : r.skipped); if (r.idle) break; }
  assert.deepEqual(steps, ['outreach:draft:true', 'outreach:audit:true:done', 'buyer:buyer:true', 'buyer:check:true', 'buyer:audit:true:done',
    'production:plan:true', 'production:gather:true', 'production:pick:true', 'production:copy:true', 'production:roomtext:true', 'production:audit:true', 'production:revise:true', 'production:audit:true:done',
    'buyer:buyer:true:done', 'inspect:inspect:true:done', 'idle'], steps.join(' / '));
  const st = await state(kv, ENV);
  assert.equal(st.outreach[0].postId, 'AAA1');
  assert.equal(st.outreach[0].outreach.status, 'pass');
  assert.equal(st.outreach[0].outreach.final, '水受けトレー付きなら台が濡れにくそうですね');
  assert.equal(st.buyer.length, QUOTA.buyer, '1日の上限まで');
  assert.equal(st.buyer[1].candidates[0].status, 'pass');
  assert.equal(st.buyer[0].candidates.length, 0, '投稿セットに使用済みの商品は、2回目の候補から外す（コードで判断）');
  assert.equal(st.buyer[0].dropped[0].code, 's:lid');
  assert.ok(st.buyer[1].runs.every((r) => r.openaiId), '実際のAIの呼び出しの記録（応答ID）');
  assert.ok(st.budget.spent.month > 0 && st.budget.spent.dayAuto === st.budget.spent.month);
  assert.equal(st.log[0].ok, true);
  // 制作ライン：社長の確認なしで次の社員へ渡り、合格した投稿セットだけが社長の確認待ちになる（採用・公開はしない）
  const pr = st.production[0];
  assert.equal(pr.result, 'pass', pr.why);
  assert.equal(pr.revisions, 1, '監査AIの指示で制作担当AIが1回直した');
  assert.deepEqual([...new Set(pr.runs.map((r) => r.role))].sort(), ['auditor', 'editor', 'planner', 'producer']);
  assert.ok(pr.runs.every((r) => r.openaiId), '実際のAIの呼び出しの記録');
  assert.equal(pr.set.items.length, 3);
  assert.equal(pr.set.items[0].source, 'buyer', '社長が採用した商品とは書かない');
  assert.match(pr.set.copy.caption, /アフィリエイト/);
  assert.match(pr.set.copy.body, /料理のたびに/, '修正した文章');
  assert.equal(pr.set.roomTexts.length, 3);
  assert.equal(pr.audits.length, 2);
  // 監査AIには、コードが付けるPR表記を含むキャプション全文を見せる（本文だけを見せて「PR表記がない」と不合格にしない）
  assert.match(setAuditUsers[0], /キャプション全文[^\n]*アフィリエイト/);
  assert.match(setAuditUsers[0], /card:1/);
  // 修正指示が実際に直されたかをコードで確かめ、修正前後の全文を残す
  assert.equal(pr.audits[0].fixCheck[0].target, 'caption');
  assert.equal(pr.audits[0].fixCheck[0].changed, true);
  assert.equal(pr.versions.length, 2);
  assert.match(pr.versions[1].texts.caption, /料理のたびに/);
  assert.match(pr.versions[0].texts.caption, /台所の置き場所/);
  assert.ok(pr.audits[1].check.checks.every((k) => k.ok !== false), JSON.stringify(pr.audits[1].check.checks));
  // 仕事探しの記録：仕事がない社員は理由つきで「仕事なし」
  assert.equal(st.board.items.map((x) => x.agent).join(','), 'production,outreach,buyer,inspect,measure,publish');
  // サーバーの正本：合格した投稿セットが入り、公開待ちへ繰り上がっている。点検の記録もある
  const S = await import('../lib/store.js');
  const recs = await S.list(kv);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].state, 'ready');
  assert.equal(recs[0].origin, 'server');
  assert.ok(recs[0].set.inspection && recs[0].set.inspection.checked >= 1, '棚の点検：楽天で引き直した');
  assert.ok(recs[0].rev >= 3, '作成→繰り上げ→点検で更新番号が上がる');
  assert.match(st.board.items.find((x) => x.agent === 'measure').reason, /API未設定/);
  assert.match(st.board.items.find((x) => x.agent === 'publish').reason, /未実装.*IG_ACCESS_TOKEN/);
  assert.ok(st.board.items.every((x) => ['work', 'wait', 'none'].includes(x.status) && x.reason));
  assert.equal(st.backlog, 0, '使った合格候補は二度と使わない');
});

test('仕事探し：合格候補がたまっていればバイヤーAIは待ち、社長の確認待ちの投稿セットが多ければ制作は待つ。費用の残りが見込みより少なければ始めない', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot({ ...SNAP, outreachPosts: [], pendingSets: 6 }));
  const cand = (code) => ({ id: 'c1', status: 'pass', versions: [{ data: { id: 'c1', code, name: code, price: 1000, url: 'https://item.rakuten.co.jp/s/x/', image: 'x' }, audit: { total: 90 } }] });
  for (const c of ['a', 'b', 'c', 'd']) await kv.pushJson(WORKER_KEYS.buyer, { id: 's' + c, candidates: [cand(c)] }, 30);
  const r = await run(kv);
  assert.ok(r.idle, JSON.stringify(r));
  const by = Object.fromEntries(r.board.items.map((x) => [x.agent, x]));
  assert.equal(by.production.status, 'wait');
  assert.match(by.production.reason, /確認待ちの投稿セットが6件/);
  assert.equal(by.buyer.status, 'wait');
  assert.match(by.buyer.reason, /合格候補が4件/);
  assert.equal(by.outreach.status, 'none');
  await kv.setJson(WORKER_KEYS.snap, readSnapshot({ ...SNAP, outreachPosts: [], pendingSets: 0 }));
  await record(kv, 20, { auto: true });
  const r2 = await run(kv);
  assert.match(Object.fromEntries(r2.board.items.map((x) => [x.agent, x])).production.reason, /費用の残り/);
  assert.equal(mock.calls.openai.length, 0);
});

test('停止スイッチ：止めている間は定期実行がAIを呼ばない。再開すると動く', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  const call = async (body) => { const req = { method: 'POST', url: '/api/worker', headers: { host: 'x.app' }, body }; const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await worker(req, res, { ...ENV, __kv: kv }); return JSON.parse(res.body); };
  assert.equal((await call({ action: 'pause', reason: 'テスト' })).paused.on, true);
  assert.match((await run(kv)).skipped, /停止中/);
  assert.equal(mock.calls.openai.length, 0);
  assert.equal((await call({ action: 'state' })).paused.on, true);
  await call({ action: 'resume' });
  assert.ok((await run(kv)).worked, '再開すると仕事をする');
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

test('制作担当AI：商品カードの文字も直せる。直した場所を記録する', async () => {
  const { applyEdit, fixCheck, codeCheck } = await import('../lib/production.js');
  const set = { title: 't', items: [{ name: 'a', price: 1000 }], copy: { body: '本文', caption: '本文\n\n※楽天アフィリエイトを利用しています。', hashtags: [], items: [{ shortName: 'a', subline: '人気No.1', memo: 'メモ' }] }, roomTexts: [{ intro: 'x' }] };
  const r = applyEdit(set, { caption: '', card: [{ n: 1, subline: '水受けトレー付き', memo: '' }], room: [] });
  assert.equal(r.set.copy.items[0].subline, '水受けトレー付き');
  assert.equal(set.copy.items[0].subline, '人気No.1', '元の版は変えない');
  assert.deepEqual(r.changed, ['card:1']);
  assert.equal(fixCheck([{ target: 'card:1', text: 'x' }, { target: 'room:1', text: 'y' }], r.changed).map((f) => f.changed).join(','), 'true,false');
  assert.ok(codeCheck(set).checks.find((k) => k.key === 'pr').ok, 'PR表記はキャプション全文で確認する');
});

// 本番（Vercel）と同じように、本文を流れ（stream）で受け取る要求を作る。
// vercelHelpers：Vercel の実行環境と同じく、本文をいったん読んでから data／end で読み直せるように戻し、req.body は使われたときに解析する（解析に失敗すると例外）
import { PassThrough } from 'node:stream';
function streamReq({ url = '/api/worker?action=tick', headers = {}, raw = '', vercelHelpers = false } = {}) {
  const req = new PassThrough();
  Object.assign(req, { method: 'POST', url, headers: { host: 'x.app', ...headers } });
  if (vercelHelpers) {
    const copy = new PassThrough();
    const on = copy.on.bind(copy); const originalOn = req.on.bind(req);
    req.read = copy.read.bind(copy);
    req.on = req.addListener = (name, cb) => (name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb));
    copy.write(raw); copy.end();
    Object.defineProperty(req, 'body', { configurable: true, get() { throw new Error('req.body に触れた（生の本文が失われる）'); } });
  } else { req.end(raw); }
  return req;
}
async function callWorker(env, opts) {
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await worker(streamReq(opts), res, env);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

// QStash の署名（JWT・HS256）をテスト用に作る
import crypto from 'node:crypto';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function qsig(key, { sub = 'https://x.app/api/worker?action=tick', body = '', iss = 'Upstash', exp = Math.floor(Date.now() / 1000) + 300 } = {}) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss, sub, exp, nbf: Math.floor(Date.now() / 1000) - 1, iat: Math.floor(Date.now() / 1000), jti: 'j', body: crypto.createHash('sha256').update(body).digest('base64url') }));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', key).update(`${h}.${p}`).digest())}`;
}

test('QStash：署名を確かめる（今の鍵・次の鍵）。鍵違い・期限切れ・発行者違い・本文違い・呼び先違いは受け付けない', async () => {
  const { verifyQstash } = await import('../lib/qstash.js');
  const keys = ['cur', 'next'];
  assert.equal(verifyQstash({ signature: qsig('cur'), body: '', keys }).ok, true);
  assert.equal(verifyQstash({ signature: qsig('next'), body: '', keys }).ok, true, '鍵の入れ替え中も受け付ける');
  assert.match(verifyQstash({ signature: qsig('bad'), body: '', keys }).why, /一致しない/);
  assert.match(verifyQstash({ signature: qsig('cur', { exp: 1 }), body: '', keys }).why, /期限/);
  assert.match(verifyQstash({ signature: qsig('cur', { iss: 'x' }), body: '', keys }).why, /発行者/);
  assert.match(verifyQstash({ signature: qsig('cur', { body: '{"a":1}' }), body: '', keys }).why, /本文/);
  assert.match(verifyQstash({ signature: qsig('cur', { sub: 'https://x.app/api/pitch' }), body: '', keys }).why, /URL/);
  assert.match(verifyQstash({ signature: qsig('cur'), body: '', keys: [] }).why, /未設定/);
});

test('QStash：署名が正しい定期実行だけ動き、きっかけを qstash と記録する。同じ呼び出しの再送は何もしない', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  const env = { ...ENV, __kv: kv, QSTASH_CURRENT_SIGNING_KEY: 'cur', QSTASH_NEXT_SIGNING_KEY: 'next' };
  const call = (headers) => callWorker(env, { headers });
  assert.equal((await call({ 'upstash-signature': qsig('bad'), 'upstash-message-id': 'm0' })).status, 401);
  assert.equal(mock.calls.openai.length, 0, '署名が違えばAIを呼ばない');
  const r = await call({ 'upstash-signature': qsig('cur'), 'upstash-message-id': 'm1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.worked.trigger, 'qstash');
  assert.ok(r.data.triggers.qstash, 'きっかけ別の最後の実行時刻を返す（手動の実行の記録からも確かめられる）');
  const again = await call({ 'upstash-signature': qsig('cur'), 'upstash-message-id': 'm1' });
  assert.match(again.data.skipped, /再送/);
  const st = await state(kv, ENV);
  assert.equal(st.health.lastTrigger, 'qstash');
});

test('QStash：断った理由を残す（原因を調べられるように）。Vercel と同じ本文の受け取り方でも、req.body に触れずに生の本文で厳密に確かめる', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  const env = { ...ENV, __kv: kv, QSTASH_CURRENT_SIGNING_KEY: 'cur', QSTASH_NEXT_SIGNING_KEY: 'next' };
  const call = (headers, raw = '') => callWorker(env, { headers, raw, vercelHelpers: true });
  const bad = await call({ 'upstash-signature': qsig('wrong'), 'upstash-message-id': 'x1' });
  assert.equal(bad.status, 401);
  assert.match((await kv.getJson('worker:qstash:reject')).why, /一致しない/);
  // 本文が {} のとき：署名も {} に対して付いていれば受け付ける（生の本文で厳密に確かめる）
  const strict = await call({ 'upstash-signature': qsig('cur', { body: '' }), 'upstash-message-id': 'x3', 'content-type': 'application/json' }, '{}');
  assert.equal(strict.status, 401, '署名は空の本文・届いた本文は {}：本文を作り直して合わせない');
  assert.match((await kv.getJson('worker:qstash:reject')).why, /本文が署名と一致しない/);
  assert.equal((await kv.getJson('worker:qstash:reject')).bodyLength, 2);
  const ok = await call({ 'upstash-signature': qsig('cur', { body: '{}' }), 'upstash-message-id': 'x2', 'content-type': 'application/json' }, '{}');
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.worked.trigger, 'qstash');
  assert.match(ok.data.qstashReject.why, /一致しない/, '応答にも断った最後の記録を付ける');
});

test('QStash：URLに ?action=tick が無くても、署名つきなら定期実行として動く', async () => {
  mock = fetchMock();
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot(SNAP));
  const env = { ...ENV, APP_PASSCODE: 'pass', __kv: kv, QSTASH_CURRENT_SIGNING_KEY: 'cur' };
  const r = await callWorker(env, { url: '/api/worker', headers: { 'upstash-signature': qsig('cur', { sub: 'https://x.app/api/worker' }), 'upstash-message-id': 'y1' }, vercelHelpers: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.worked.trigger, 'qstash');
});

test('QStash：環境変数に貼り付けたときの前後の空白・改行・引用符があっても、同じ鍵なら受け付ける。違う鍵・HS256以外は受け付けない。断った記録に鍵の値は残さない', async () => {
  const { verifyQstash, keyInfo } = await import('../lib/qstash.js');
  assert.equal(verifyQstash({ signature: qsig('sig_cur'), body: '', keys: [' sig_cur\n', ''] }).ok, true);
  assert.equal(verifyQstash({ signature: qsig('sig_cur'), body: '', keys: ['"sig_cur"'] }).ok, true);
  assert.equal(verifyQstash({ signature: qsig('sig_cur'), body: '', keys: ['sig_cu'] }).ok, false, '鍵の一部だけでは受け付けない');
  const none = qsig('sig_cur').split('.'); none[0] = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  assert.match(verifyQstash({ signature: none.join('.'), body: '', keys: ['sig_cur'] }).why, /HS256/);
  const info = keyInfo([' sig_cur\n', undefined]);
  assert.equal(JSON.stringify(info), JSON.stringify([{ set: true, sigPrefix: true, hadExtra: true }, { set: false, sigPrefix: false, hadExtra: false }]));
  assert.ok(!JSON.stringify(info).includes('sig_cur'), '鍵の値は出さない');
});

test('QStash：生の本文の読み取り。本文の要約値は base64url（公式と同じ）で、末尾の = の有無は問わない。1文字でも違えば受け付けない', async () => {
  const { verifyQstash, readRawBody } = await import('../lib/qstash.js');
  assert.equal((await readRawBody(streamReq({ raw: '{"x":"日本語"}' }))).toString('utf8'), '{"x":"日本語"}');
  assert.equal((await readRawBody(streamReq({ raw: '{"x":1}', vercelHelpers: true }))).toString('utf8'), '{"x":1}', 'Vercel が戻した本文も読める');
  assert.equal(verifyQstash({ signature: qsig('k', { body: 'abc' }), body: Buffer.from('abc'), keys: ['k'] }).ok, true, 'バイト列のまま確かめる');
  assert.equal(await readRawBody({}), null, '流れの無い要求は読めない（検証は失敗にする）');
  assert.match(verifyQstash({ signature: qsig('k'), body: null, keys: ['k'] }).why, /生の本文/);
  assert.equal(verifyQstash({ signature: qsig('k', { body: 'abc' }), body: 'abc', keys: ['k'] }).ok, true);
  assert.equal(verifyQstash({ signature: qsig('k', { body: 'abc' }), body: 'abd', keys: ['k'] }).ok, false);
  assert.equal(verifyQstash({ signature: qsig('k', { body: 'abc' }), body: 'abc ', keys: ['k'] }).ok, false);
});

test('段階1：未公開（公開待ち3＋控え6）が満杯なら新しく作らず、点検・効果測定・公開の準備に優先を移す。社長の判断が7日ないときは制作を1日1件に落とす', async () => {
  mock = fetchMock();
  const S = await import('../lib/store.js');
  const kv = memoryKv();
  await kv.setJson(WORKER_KEYS.snap, readSnapshot({ ...SNAP, outreachPosts: [], themes: [] }));
  const cand = (code) => ({ id: 'c1', status: 'pass', versions: [{ data: { id: 'c1', code, name: code, price: 1000, url: 'https://item.rakuten.co.jp/s/x/', image: 'x' }, audit: { total: 90 } }] });
  await kv.pushJson(WORKER_KEYS.buyer, { id: 'sx', candidates: [cand('s:lid')] }, 30);
  for (let i = 1; i <= 9; i++) await S.create(kv, { id: `f${i}`, set: { id: `f${i}`, title: 't', items: [{ name: 'n', price: 1000, code: 's:lid' }] }, state: i <= 3 ? 'ready' : 'shelf', score: 80 + i }); // 公開待ち3＋控え6＝満杯
  const r = await run(kv);
  const by = Object.fromEntries((await state(kv, ENV)).board.items.map((x) => [x.agent, x]));
  assert.match(by.production.reason, /満杯（公開待ち3件・控え6件）/);
  assert.equal(by.production.kind, 'backlog');
  assert.equal(r.worked.agent, 'inspect', '満杯でも止まらず、棚の点検に移る');
  assert.equal(mock.calls.openai.length, 0, '満杯のときはAIの費用を使わない');
  // 社長の判断が無く7日：空きがあっても1日1件まで
  const kv2 = memoryKv();
  await kv2.setJson(WORKER_KEYS.snap, readSnapshot({ ...SNAP, outreachPosts: [], themes: [] }));
  await kv2.pushJson(WORKER_KEYS.buyer, { id: 'sx', candidates: [cand('s:lid')] }, 30);
  await S.create(kv2, { id: 'g1', set: { id: 'g1', title: 't', items: [] }, state: 'ready' });
  await kv2.incr(`worker:quota:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}:production`);
  await run(kv2);
  const by2 = Object.fromEntries((await state(kv2, ENV)).board.items.map((x) => [x.agent, x]));
  assert.match(by2.production.reason, /7日以上ない.*1件/);
});
