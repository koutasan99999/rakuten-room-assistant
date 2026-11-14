// バイヤーAIの見直し（2026-11-14）：1回で広く探して比べる・合格候補の在庫10件・不合格の理由を次の探索に生かす・成績の集計
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFetchMock, json, aiReply, makeItems } from './mock.js';
import { withUsage } from '../lib/ai-usage.js';
import { buyerStep, lessonLines, prefilter, MAX_CANDIDATES, MAX_KEYWORDS, PER_KEYWORD } from '../lib/agents.js';
import { MAX_SOURCE } from '../lib/production.js';
import { STOCK_TARGET, QUOTA, buyerStats, WORKER_KEYS } from '../lib/worker.js';
import { memoryKv } from '../lib/kv.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', __noWait: true };

test('1回の仕事で、楽天を4つの検索語で探し（AIなし）、最大40件を比べて最大6件を選ぶ。過去の不合格の理由と、合格が出なかった検索語をAIに渡す', async () => {
  const users = [];
  let k = 0;
  mock = installFetchMock({
    rakuten: (url) => json(200, { Items: makeItems(15, `kw${k++}-`) }),
    openai: (body) => {
      const sys = body.messages[0].content; users.push({ sys, user: body.messages[1].content });
      if (sys.includes('検索語を決めます')) return aiReply({ keywords: [1, 2, 3, 4, 5].map((i) => ({ keyword: `キッチン 便利${i}`, why: 'x' })) });
      if (sys.includes('候補を最大6件選びます')) return aiReply({ candidates: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ ref: `R${i}`, quotes: ['おしゃれな収納ボックス'], reason: 'おしゃれな収納ボックス', target: 't', problem: 'p', roomValue: 'v', cautions: 'c' })) });
      return aiReply({});
    }
  });
  const lessons = [{ why: '商品データにない数値を書いた', keyword: '鍋 便利' }, { deadKeyword: '台所 グッズ' }];
  const r = await withUsage(() => buyerStep({ theme: 'キッチン', lessons, env: ENV, referer: 'https://x/' }));
  assert.equal(r.ok, true, r.error);
  assert.equal(MAX_KEYWORDS, 4); assert.equal(PER_KEYWORD, 10); assert.equal(MAX_CANDIDATES, 6);
  assert.equal(r.searched.length, 4, '検索語は4つまで（楽天の検索はAIを使わない）');
  assert.equal(r.results.length, 40, '1回で最大40件を比べる');
  assert.equal(r.candidates.length, 6, '最大6件');
  assert.equal(users.filter((u) => /検索語を決めます|候補を最大6件/.test(u.sys)).length, 2, 'AIは検索語と選定の2回だけ');
  assert.match(users[0].user, /最近の不合格・保留の理由.*商品データにない数値/);
  assert.match(users[0].user, /合格が出なかった検索語.*台所 グッズ/);
  assert.match(users[1].user, /最近の不合格・保留の理由/);
  assert.equal(lessonLines([]), '');
});

test('合格候補の在庫：目標10件・バイヤーAIは1日8回まで（安全上限。主に在庫と費用の上限で止まる）・投稿セット1つに使う合格候補は2件（在庫を長持ちさせる）', () => {
  assert.equal(STOCK_TARGET, 10); assert.equal(QUOTA.buyer, 8); assert.equal(MAX_SOURCE, 2);
});

test('バイヤーAIの成績：直近10回の合格・保留・不合格の数、合格率、在庫、費用、おもな不合格の理由を集計する（AIなし）', async () => {
  const kv = memoryKv();
  const c = (status, why = '') => ({ status, why, versions: [{ data: {} }] });
  await kv.pushJson(WORKER_KEYS.buyer, { id: 's1', results: new Array(30).fill({}), runs: [{ yen: 1.2 }, { yen: 0.8 }], candidates: [c('pass'), c('hold', '商品データにない数値（80点）'), c('reject', '商品データにない数値（72点）')] }, 30);
  await kv.pushJson(WORKER_KEYS.buyer, { id: 's2', results: [], runs: [{ yen: 0.5 }], candidates: [] }, 30);
  const st = await buyerStats(kv, 1);
  assert.equal(st.sessions, 2); assert.equal(st.candidates, 3); assert.equal(st.pass, 1); assert.equal(st.passRate, 33);
  assert.equal(st.zeroSessions, 1); assert.equal(st.looked, 30); assert.equal(st.yen, 2.5); assert.equal(st.yenPerPass, 2.5);
  assert.equal(st.stock, 1); assert.equal(st.target, 10);
  assert.equal(st.topReasons[0].n, 2, '点数の違いはまとめて数える');
});

test('AIに見せる前のふるい分け（プログラム・0円）：扱わない分類・価格の範囲外・説明が無い商品を外す', () => {
  const ok = { name: 'ステンレス 鍋蓋スタンド', price: 1980, caption: '水受けトレー付きで、水滴がたれにくい鍋蓋スタンドです。' };
  assert.equal(prefilter(ok), '');
  assert.equal(prefilter({ ...ok, name: '【第2類医薬品】目薬' }), '扱わない分類');
  assert.equal(prefilter({ ...ok, name: 'ブルーライトカット メガネ' }), '扱わない分類');
  assert.equal(prefilter({ ...ok, price: 300 }), '価格の範囲外');
  assert.equal(prefilter({ ...ok, price: 45000 }), '価格の範囲外');
  assert.equal(prefilter({ ...ok, caption: '' }), '説明がほとんど無い');
});
