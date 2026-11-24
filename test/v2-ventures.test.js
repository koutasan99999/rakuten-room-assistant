// 2026-11-24 KOT-12：ROOMとは独立した3本の仕事の流れ（新規副業・集客の実験・デジタル商品）
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { isolated } from '../lib/ai-usage.js';
import * as V from '../lib/v2/company.js';
import * as X from '../lib/v2/ventures.js';
import v2api from '../server/v2.js';
import { installFetchMock, aiReply, json } from './mock.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', APP_PASSCODE: 'pw' };

const IDEA = { title: '家計簿テンプレートの販売', category: 'デジタルテンプレート', whyChosen: '在庫を持たず、既存のROOMとは別の客層', customer: '家計を見直したい個人', problem: '家計簿が続かない', product: '表計算のテンプレート', channel: '外部のテンプレート販売サイト', revenueModel: '単品販売', revenueAssumption: '月3件売れると仮定（確定値ではない）', marketKeyword: '家計簿', competitorsNote: '未確認', initialCostYen: 0, monthlyCostYen: 0, ownerHoursPerWeek: 2, aiDoes: ['原稿・表の設計'], ownerDoes: ['出品'], risks: { terms: '販売サイトの規約を確認', copyright: '素材は自作', medical: '関係なし' }, minExperiment: '1商品を出品して2週間の反応を見る', success: '2週間で3件', withdraw: '2週間で0件なら撤退', repeatability: 4 };
const GROWTH = { title: 'プロフィールからROOMへの導線を1本に絞る', funnelStage: 'プロフィール', hypothesis: '導線が複数あり迷う', basisFacts: ['閲覧は未計測'], experiment: { what: 'プロフィールのリンクを1つにする', days: 7, metric: 'ROOMへの流入', success: '流入が増える', ownerSteps: ['プロフィールを編集'] }, drafts: { posts: [{ caption: '暮らしの小さな工夫を紹介します。#PR' }], replies: [{ situation: '商品名を聞かれたとき', reply: 'コメントありがとうございます。商品はプロフィールのリンクからご覧いただけます。' }] }, risks: 'PR表記を入れる' };
const DIGITAL = { title: '在宅の作業を整えるチェックリスト集', format: 'PDF', target: '在宅で働き始めた人', problem: '作業環境が整わない', originality: 'オーナーの在宅の経験（要確認）', outline: ['はじめに', '机まわり', '時間の使い方'], freeToPaid: { freeArticle: '机まわりの整え方', bridge: '詳しいチェックリストはPDFで' }, priceIdea: '500円（仮定）', sourcesNeeded: ['人間工学の一般的な資料'], medical: false, copyrightNote: '自作の文章のみ' };
const PROTO = { headline: '家計簿が続くテンプレート', lead: '入力は3項目だけ', bullets: ['表計算で使える'], offer: '500円（仮定）', faq: [{ q: '使い方は？', a: '説明書つき' }], cta: '購入ページへ', notes: '公開前に販売サイトの規約を確認' };
const DRAFT = { freeArticle: 'あ'.repeat(300), salesPage: { headline: '作業を整えるチェックリスト', body: '要点をまとめました。', bullets: ['机まわり'] }, pdfOutline: [{ heading: '机まわり', points: ['高さ', '照明'] }], needsReview: ['出典の確認'] };

// 段階ごとに答えを変える偽のAI（システムの指示の冒頭で見分ける）
const ai = (body) => {
  const sys = String((body.messages || [])[0] && body.messages[0].content || '');
  if (sys.includes('新規事業開発')) return aiReply({ ideas: [IDEA] });
  if (sys.includes('集客の担当')) return aiReply(GROWTH);
  if (sys.includes('デジタル商品の企画')) return aiReply(DIGITAL);
  if (sys.includes('販売ページの試作')) return aiReply(PROTO);
  if (sys.includes('原稿担当')) return aiReply(DRAFT);
  return aiReply({});
};
const rakuten = () => json(200, { Items: [{ itemCode: 'a:1', itemName: '家計簿 ノート', itemPrice: 980, itemUrl: 'https://item.rakuten.co.jp/a/1', mediumImageUrls: [], shopName: 's' }, { itemCode: 'a:2', itemName: '家計簿 手帳', itemPrice: 1500, itemUrl: 'https://item.rakuten.co.jp/a/2', mediumImageUrls: [], shopName: 's' }], pageCount: 12 });

// 1回の定期実行と同じ：全社員が仕事を探し、見つけたら実行する
async function round(kv) {
  const done = [];
  for (const s of V.STAFF) {
    const w = await V.findWork(s.id, { kv, env: ENV, cases: [] });
    if (!w.task) { done.push({ agent: s.id, none: w.none }); continue; }
    const x = await isolated(() => w.run({ kv, env: ENV, referer: 'https://example.com/' }));
    done.push({ agent: s.id, kind: w.kind, r: x.result });
  }
  return done;
}

test('ROOMの仕事が全部止まっていても（承認待ち5件・案件0）3本の流れがそれぞれ成果物を作る。出典・費用・記録が残る', async () => {
  mock = installFetchMock({ rakuten, openai: ai });
  const kv = memoryKv();
  // ROOMは承認待ちが5件（上限）。案件は動いていない
  await kv.setJson('v2:sets', Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, title: `完成品${i}`, status: 'waiting' })));
  const kinds = new Set();
  for (let i = 0; i < 8; i++) for (const d of await round(kv)) if (d.kind) kinds.add(d.kind);
  const st = await X.venturesState(kv, ENV);
  for (const k of ['venture', 'growth', 'digital']) {
    const done = st.items.filter((x) => x.stream === k && x.status === 'review');
    assert.ok(done.length >= 1, `${k} の成果物が完成していない：${JSON.stringify(st.streams[k].counts)} ${JSON.stringify(st.items.filter((x) => x.stream === k).map((x) => [x.stage, x.tries, x.log.slice(-2)]))}`);
    assert.ok(done[0].artifacts.length >= 3, '段階ごとの成果物が残る');
    assert.ok(done[0].log.length >= 3, '実行ログが残る');
  }
  const v = st.items.find((x) => x.stream === 'venture' && x.status === 'review');
  assert.ok(v.proto && v.proto.draftOnly, '販売ページの下書き（未公開）');
  assert.ok(v.sources.some((s) => s.kind === 'rakuten-search' && s.status === '取得' && s.pages === 12), '実際に取得した出典（日付つき）');
  assert.ok(v.sources[0].at);
  assert.equal(v.data.revenueAssumption.includes('仮定'), true);
  assert.ok(v.priority > 0);
  const g = st.items.find((x) => x.stream === 'growth' && x.status === 'review');
  assert.equal(g.funnel.views, null, '実データが無い数字は未計測（null）');
  assert.ok(g.sources.some((s) => s.kind === 'kpi'));
  const d = st.items.find((x) => x.stream === 'digital' && x.status === 'review');
  assert.ok(d.manuscript.draftOnly && d.manuscript.needsReview.length >= 1);
  // 8部署すべてが、独立した仕事をした（「仕事なし」の部署が残らない）
  const workedBy = Object.keys(st.depts);
  for (const a of ['buyer', 'auditor', 'planner', 'editor', 'designer', 'writer', 'pr', 'appraiser']) assert.ok(workedBy.includes(a), `${a} が独立した仕事をしていない`);
  assert.ok(st.dash.artifacts >= 10);
  assert.equal(st.dash.inventory.waiting, 5);
  // 承認待ちの完成品は動かしていない（勝手に通さない）
  assert.equal((await kv.getJson('v2:sets')).every((x) => x.status === 'waiting'), true);
  assert.ok(X.STATUS_LABEL.review);
});

test('上限：新しい案は間隔・作りかけ・判断待ちの数で止まり、無限に作らない。重複は入れない', async () => {
  mock = installFetchMock({ rakuten, openai: ai });
  const kv = memoryKv();
  const first = await X.venturesWork('planner', { kv });
  assert.equal(first.kind, 'venture-idea');
  await isolated(() => first.run({ kv, env: ENV }));
  const again = await X.venturesWork('planner', { kv });
  assert.ok(!again.task, '同じ日に2回は作らない');
  const s = await kv.getJson('v2:ventures');
  // 同じ案をもう一度出させても重複で入らない
  s.last.venture = '2000-01-01T00:00:00.000Z'; await kv.setJson('v2:ventures', s);
  const w2 = await X.venturesWork('planner', { kv });
  assert.equal(w2.kind, 'venture-idea');
  const r2 = (await isolated(() => w2.run({ kv, env: ENV }))).result;
  assert.match(r2.done, /重複|入れる案は無かった/);
  assert.equal((await kv.getJson('v2:ventures')).items.filter((x) => x.stream === 'venture').length, 1);
  // 判断待ちが上限なら新しい案は作らず、理由を示す
  const t = await kv.getJson('v2:ventures'); t.items = Array.from({ length: X.MAX_REVIEW }, (_, i) => ({ ...t.items[0], id: `r${i}`, title: `案${i}あいうえお${i}`, status: 'review', stage: '' })); t.last.venture = '2000-01-01T00:00:00.000Z'; await kv.setJson('v2:ventures', t);
  const w3 = await X.venturesWork('planner', { kv });
  assert.ok(w3.none && /判断待ちの案が4件/.test(w3.none), w3.none);
  // 1日の費用の上限
  const u = await kv.getJson('v2:ventures'); u.items = []; u.spent = { venture: { [new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)]: X.DAY_CAP_YEN } }; await kv.setJson('v2:ventures', u);
  const w4 = await X.venturesWork('planner', { kv });
  assert.ok(w4.none && /上限/.test(w4.none), w4.none);
});

test('監査：規約違反（自動いいね・要約転載）・収益の断定・必須項目の不足は不合格。理由が残り、次の案に渡る', async () => {
  const kv = memoryKv();
  const bad = { ...IDEA, title: '自動いいねで集客', product: '自動いいねツールで月30万円稼げる' };
  assert.ok(X.riskIssues(bad).length >= 1);
  assert.deepEqual(X.riskIssues(IDEA), []);
  assert.ok(X.riskIssues({ a: '既存の書籍を要約して販売' }).length >= 1);
  await kv.setJson('v2:ventures', { items: [{ id: 'v1', stream: 'venture', title: '案', status: 'active', stage: 'audit', createdAt: new Date().toISOString(), tries: {}, data: { ...IDEA, ownerHoursPerWeek: null, risks: {} }, sources: [], artifacts: [], log: [] }] });
  const w = await V.findWork('auditor', { kv, env: ENV, cases: [] });
  assert.equal(w.kind, 'venture-audit');
  await isolated(() => w.run({ kv, env: ENV }));
  const it = (await kv.getJson('v2:ventures')).items[0];
  assert.equal(it.status, 'rejected');
  assert.match(it.decision.why, /作業時間|リスク/);
  // 次の案づくりに「却下の理由」が渡る
  mock = installFetchMock({ rakuten, openai: (body) => { assert.match(JSON.stringify(body), /監査が不合格/); return aiReply({ ideas: [] }); } });
  const p = await X.venturesWork('planner', { kv });
  await isolated(() => p.run({ kv, env: ENV }));
});

test('失敗：3回失敗した案は止まり、無限にやり直さない。社長の「もう一度」で再開できる', async () => {
  mock = installFetchMock({ rakuten, openai: () => aiReply({ headline: '' }) });
  const kv = memoryKv();
  await kv.setJson('v2:ventures', { items: [{ id: 'v1', stream: 'venture', title: '案', status: 'active', stage: 'proto', createdAt: new Date().toISOString(), tries: {}, data: IDEA, sources: [], artifacts: [], log: [] }] });
  for (let i = 0; i < 4; i++) { const w = await X.venturesWork('designer', { kv }); if (w.task) await isolated(() => w.run({ kv, env: ENV })); }
  const it = (await kv.getJson('v2:ventures')).items[0];
  assert.equal(it.status, 'stopped');
  assert.equal(it.tries.proto, X.MAX_TRIES);
  const r = await X.decideVenture(kv, { id: 'v1', decision: 'retry' });
  assert.equal(r.status, 'active');
});

test('社長の判断（API）：完成した案だけ採用・保留・却下でき、外部へは何もしない。作りかけは判断できない', async () => {
  mock = installFetchMock({ rakuten, openai: ai });
  const kv = memoryKv();
  for (let i = 0; i < 6; i++) await round(kv);
  const call = async (body) => { const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await v2api({ method: 'POST', url: '/api/v2', headers: { 'x-app-passcode': 'pw' }, body }, res, { ...ENV, __kv: kv }); return { status: res.statusCode, body: JSON.parse(res.body) }; };
  const st = await call({ action: 'state' });
  assert.equal(st.status, 200);
  assert.ok(st.body.ventures.items.length >= 3);
  assert.ok(st.body.staff.every((s) => s.indep), '部署ごとに、独立した仕事の記録');
  const done = st.body.ventures.items.find((x) => x.status === 'review');
  const ok = await call({ action: 'ventureDecide', id: done.id, decision: 'adopt', why: '試す' });
  assert.equal(ok.body.item.status, 'adopted');
  assert.equal(ok.body.item.decision.why, '試す');
  const bad = await call({ action: 'ventureDecide', id: done.id, decision: 'xxx' });
  assert.equal(bad.status, 400);
});

test('KOT-21：採用・保留・却下は保存され、読み直しても残り、連打しても壊れない。判断待ちは減る', async () => {
  const kv = memoryKv();
  const mk = (id, status) => ({ id, stream: 'venture', title: '案' + id, status, stage: 'done', createdAt: new Date().toISOString(), tries: {}, data: IDEA, sources: [], artifacts: [], log: [] });
  await kv.setJson('v2:ventures', { items: [mk('a', 'review'), mk('b', 'review'), mk('c', 'review'), mk('d', 'active')] });
  const n = async () => (await X.venturesState(kv, ENV)).items.filter((x) => x.status === 'review').length;
  assert.equal(await n(), 3);
  assert.equal((await X.decideVenture(kv, { id: 'a', decision: 'adopt' })).status, 'adopted');
  assert.equal((await X.decideVenture(kv, { id: 'a', decision: 'adopt' })).status, 'adopted'); // 連打
  assert.equal((await X.decideVenture(kv, { id: 'b', decision: 'hold', why: 'あとで' })).status, 'hold');
  assert.equal((await X.decideVenture(kv, { id: 'c', decision: 'reject', why: '合わない' })).status, 'rejected');
  assert.equal(await n(), 0);
  const saved = (await kv.getJson('v2:ventures')).items;
  assert.deepEqual(saved.map((x) => x.status), ['adopted', 'hold', 'rejected', 'active']);
  assert.equal(saved[0].log.filter((l) => l.by === 'owner').length, 1, '二重に記録しない');
  await assert.rejects(() => X.decideVenture(kv, { id: 'd', decision: 'adopt' }), /まだ完成していない/);
  await assert.rejects(() => X.decideVenture(kv, { id: 'zz', decision: 'adopt' }), /ありません/);
});
