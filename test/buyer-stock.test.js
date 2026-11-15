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

test('合格候補の消費：実際に投稿セットに入った候補だけを使用済みにする。企画で選ばれなかった候補は在庫に戻す。失敗した投稿セットの候補は2回まで使い直す', async () => {
  const { tick, backlog, MAX_CANDIDATE_TRIES } = await import('../lib/worker.js');
  const kv = memoryKv();
  const ENV2 = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app', KUMA_COVER: 'off' };
  const cand = (code) => ({ id: 'c-' + code, status: 'pass', versions: [{ data: { id: 'c-' + code, code, name: code, price: 1000, url: 'https://item.rakuten.co.jp/s/x/', image: 'x' }, audit: { total: 90 } }] });
  await kv.pushJson(WORKER_KEYS.buyer, { id: 'sA', candidates: [cand('a'), cand('b')] }, 30);
  await kv.setJson(WORKER_KEYS.snap, { at: new Date().toISOString() });
  const source = [{ code: 'a', name: 'a' }, { code: 'b', name: 'b' }];
  const job = (id, step) => ({ id, type: 'production', step, startedAt: new Date().toISOString(), steps: 9, attempts: 0, source,
    set: { id: 'set-' + id, title: 't', items: [{ code: 'a', source: 'buyer', name: 'a', price: 1000 }, { code: 'z', source: 'search', name: 'z', price: 1000 }] },
    rec: { id, origin: 'server', at: new Date().toISOString(), status: 'running', steps: [], runs: [], audits: [], revisions: 0, rakutenCalls: 0, result: 'pass', score: 86 } });
  const drive = async () => { for (let i = 0; i < 6; i++) { const r = await withUsage(() => tick({ kv, env: ENV2, origin: 'https://app.test/', startedAt: Date.now() })); if (!r.worked || r.worked.final) break; } };
  // 1. 表紙画像待ち（文章と商品は保存）：投稿セットに入った a だけ使用済み。企画で使われなかった b は在庫に残る
  await kv.setJson('worker:job', job('j1', 'scene'));
  await drive();
  let stock = (await backlog(kv, {})).map((c) => c.code);
  assert.deepEqual(stock, ['b']);
  // 2. 失敗した投稿セットの候補は、2回まで在庫に戻す
  await kv.pushJson(WORKER_KEYS.buyer, { id: 'sB', candidates: [cand('c')] }, 30);
  const failing = () => ({ ...job('j' + Math.random().toString(36).slice(2, 6), 'nope'), source: [{ code: 'c', name: 'c' }], set: { id: 'set-f', title: 't', items: [{ code: 'c', source: 'buyer', name: 'c', price: 1000 }] } });
  assert.equal(MAX_CANDIDATE_TRIES, 2);
  for (let n = 1; n <= 2; n++) {
    await kv.setJson('worker:job', failing());
    for (let i = 0; i < 5; i++) { await kv.del('worker:health'); const r = await withUsage(() => tick({ kv, env: ENV2, origin: 'https://app.test/', startedAt: Date.now() })); if (!r.worked || r.worked.final) break; }
    stock = (await backlog(kv, {})).map((c) => c.code);
    if (n === 1) assert.ok(stock.includes('c'), '1回目の失敗では在庫に戻る');
    else assert.ok(!stock.includes('c'), '2回失敗したら使わない');
  }
  const prod = (await kv.listJson('worker:results:production', 5)).find((r) => r.id === 'j1');
  assert.deepEqual(prod.sourceUse, { offered: 2, inSet: 1, released: 1 });
});

test('発掘の切り口：楽天だけで確かめられる7つと、追加の情報源が要る4つを分ける。蓄えに少ない切り口から順に担当する', async () => {
  const { ANGLES, ACTIVE_ANGLES, chooseAngle, seasonWords, UNSOURCED_CLAIM } = await import('../lib/buyer-angles.js');
  assert.equal(ANGLES.length, 11);
  assert.deepEqual(ACTIVE_ANGLES.map((a) => a.id), ['classic', 'new_label', 'old_model', 'season', 'sale', 'unique', 'gift']);
  assert.ok(ANGLES.filter((a) => !a.rakutenOnly).every((a) => a.needs), '追加の情報源が要る切り口は、何が要るかを書いてある');
  assert.equal(chooseAngle([], 0).id, 'classic');
  assert.equal(chooseAngle(['classic', 'new_label', 'old_model', 'season', 'sale', 'unique'], 0).id, 'gift', '蓄えに無い切り口を優先');
  assert.deepEqual(seasonWords(new Date('2026-11-14T03:00:00Z')).slice(0, 2), ['冬の乾燥対策', '早めのクリスマスギフト']);
  assert.ok(UNSOURCED_CLAIM.test('SNSで話題の') && UNSOURCED_CLAIM.test('テレビで紹介') && !UNSOURCED_CLAIM.test('水受けトレー付き'));
});

test('切り口ごとの評価：定番はレビュー件数と平均、型落ちは表記、ギフトは価格帯で楽天を検索する。AIには切り口と評価基準を渡す（レビュー数だけで選ばない）', async () => {
  const { ANGLES } = await import('../lib/buyer-angles.js');
  const { angleLines } = await import('../lib/agents.js');
  const a = (id) => ANGLES.find((x) => x.id === id);
  assert.equal(a('classic').keep({ reviewCount: 150, reviewAverage: 4.5 }), true);
  assert.equal(a('classic').keep({ reviewCount: 20, reviewAverage: 4.9 }), false);
  assert.equal(a('old_model').keep({ name: '電気ケトル 旧モデル', caption: '' }), true);
  assert.equal(a('unique').keep({ reviewCount: 2 }), true, '独自性はレビューが少なくてよい');
  assert.equal(a('gift').minPrice, 2000);
  const l = angleLines(a('season'), new Date('2026-11-14T03:00:00Z'));
  assert.match(l, /発掘の切り口：季節・行事/); assert.match(l, /今の季節・行事：冬の乾燥対策/);
});

test('コードの確認：情報源のない話題性の主張（SNSで話題・テレビで紹介・芸能人が使用）は不合格。楽天ROOMの報酬対象（料率）を確かめる', async () => {
  const { checkOne } = await import('../lib/agents.js');
  mock = installFetchMock({ rakuten: () => json(200, { Items: [] }), openai: () => aiReply({}) });
  const base = { id: 'c1', ref: 'R1', code: 's:x', name: 'ステンレス 鍋蓋スタンド', price: 1980, url: 'https://item.rakuten.co.jp/s/x/', image: 'x', quotes: ['水受けトレー付き'], reason: '水受けトレー付き', target: 't', problem: 'p', roomValue: 'v', cautions: 'c', whyNow: '冬の鍋料理の季節', whoBuys: '料理する人', postIdea: 'くまが鍋のふたを置く', evidence: [] };
  const result = { ref: 'R1', code: 's:x', caption: '水受けトレー付きで、水滴がたれにくい。', keyword: 'k', checkedAt: 'x', affiliateRate: 4 };
  let k = await checkOne(base, result, { env: ENV, referer: 'https://x/' });
  assert.equal(k.checks.find((x) => x.key === 'claims').ok, true);
  assert.equal(k.checks.find((x) => x.key === 'room').ok, true);
  k = await checkOne({ ...base, whyNow: 'SNSで話題になっている' }, result, { env: ENV, referer: 'https://x/' });
  assert.equal(k.checks.find((x) => x.key === 'claims').ok, false); assert.equal(k.hardFail, true);
  k = await checkOne(base, { ...result, affiliateRate: 0 }, { env: ENV, referer: 'https://x/' });
  assert.equal(k.checks.find((x) => x.key === 'room').ok, false);
});

test('制作に渡す合格候補：点数の高い順に、切り口が重ならないように2件選ぶ', async () => {
  const { pickSource } = await import('../lib/worker.js');
  const s = pickSource([{ code: 'a', angle: 'classic', score: 95 }, { code: 'b', angle: 'classic', score: 92 }, { code: 'c', angle: 'gift', score: 85 }], 2);
  assert.deepEqual(s.map((x) => x.code), ['a', 'c']);
  assert.deepEqual(pickSource([{ code: 'a', angle: 'classic', score: 95 }, { code: 'b', angle: 'classic', score: 92 }], 2).map((x) => x.code), ['a', 'b'], '切り口が1種類しかなければ同じ切り口でも選ぶ');
});

test('購入動機：3つ（日常の不便・プレゼント・比べて買う）。直近の投稿セットで少ない動機から企画し、その動機の合格候補を渡す', async () => {
  const { MOTIVES, chooseMotive, motiveOfAngle } = await import('../lib/buyer-angles.js');
  assert.deepEqual(MOTIVES.map((m) => m.id), ['fix', 'gift', 'compare']);
  assert.equal(chooseMotive(['fix', 'fix', 'gift'], 0).id, 'compare');
  assert.equal(motiveOfAngle('gift').id, 'gift'); assert.equal(motiveOfAngle('old_model').id, 'compare'); assert.equal(motiveOfAngle('unique').id, 'fix');
});

test('コードの確認：誰が買うか・困りごと・なぜ今・競合との比較（ほかの検索結果のR番号つき）・価格に納得できる理由・投稿の案がそろっていなければ不合格', async () => {
  const { checkOne } = await import('../lib/agents.js');
  mock = installFetchMock({ rakuten: () => json(200, { Items: [] }), openai: () => aiReply({}) });
  const full = { id: 'c1', ref: 'R1', code: 's:x', name: 'ステンレス 鍋蓋スタンド', price: 1980, url: 'https://item.rakuten.co.jp/s/x/', image: 'x', quotes: ['水受けトレー付き'], reason: '水受けトレー付き', target: 't', problem: '鍋のふたの置き場所', roomValue: 'v', cautions: 'c',
    angle: 'unique', motive: 'fix', whoBuys: '自炊する社会人', whyNow: '鍋料理の季節', vsOthers: 'R3と違い水受けトレー付き', priceReason: '2,000円以下', postIdea: 'くまがふたを立てる', evidence: [] };
  const result = { ref: 'R1', code: 's:x', caption: '水受けトレー付きで、水滴がたれにくい。', keyword: 'k', checkedAt: 'x', affiliateRate: 4 };
  let k = await checkOne(full, result, { env: ENV, referer: 'https://x/' });
  assert.equal(k.checks.find((x) => x.key === 'brief').ok, true);
  k = await checkOne({ ...full, vsOthers: 'ほかより丈夫' }, result, { env: ENV, referer: 'https://x/' });
  assert.equal(k.checks.find((x) => x.key === 'brief').ok, false, '比べたほかの商品の番号が無い');
  k = await checkOne({ ...full, vsOthers: 'R1より良い' }, result, { env: ENV, referer: 'https://x/' });
  assert.equal(k.checks.find((x) => x.key === 'brief').ok, false, '自分自身との比較は不可');
  k = await checkOne({ ...full, priceReason: '', motive: '' }, result, { env: ENV, referer: 'https://x/' });
  assert.match(k.checks.find((x) => x.key === 'brief').detail, /購入動機・価格に納得できる理由/);
});

test('販売導線：本文はストーリーズのハイライト（購入動機ごと）のリンクへ案内する。商品ごとのリンクスタンプ・測る数字・要確認の点を投稿セットに残す。企画担当AIに購入動機と商品ごとの購入理由を渡す', async () => {
  const { funnelOf, motiveNote } = await import('../lib/production.js');
  const { assembleCaption } = await import('../lib/instagram.js');
  const f = funnelOf({ items: [{ name: '鍋蓋スタンド', url: 'https://item.rakuten.co.jp/s/x/' }] }, 'gift');
  assert.equal(f.highlight, 'プレゼント');
  assert.match(f.captionCta, /ハイライト「プレゼント」のリンクから1回で開けます/);
  assert.equal(f.stories[0].link, 'https://item.rakuten.co.jp/s/x/');
  assert.ok(f.measure.some((x) => /ストーリーズのリンクのタップ/.test(x)) && f.measure.some((x) => /報酬/.test(x)));
  assert.ok(f.unverified.length >= 2, '規約が未確認の点を残す');
  const cap = assembleCaption({ body: '本文', collection: 'c', hashtags: ['#a'], cta: f.captionCta });
  assert.match(cap, /ハイライト「プレゼント」/); assert.match(cap, /楽天アフィリエイト/);
  assert.match(assembleCaption({ body: '本文', hashtags: [] }), /プロフィールのリンクから見られます/, 'ほかの投稿は今までどおり');
  const n = motiveNote('fix', [{ name: '鍋蓋スタンド', whoBuys: '自炊する社会人', problem: 'ふたの置き場所', vsOthers: 'R3と違い水受け付き', priceReason: '2,000円以下' }]);
  assert.match(n, /購入動機：日常の不便を解消したい/); assert.match(n, /競合との比較「R3と違い水受け付き」/);
});

test('修正：購入理由の項目（購入動機・競合との比較など）を修正の指示に含め、書かれなかった項目は同じ商品なら前の版を引き継ぐ（本番で修正のたびに項目が消えて不合格になっていた）', async () => {
  const { reviseStep } = await import('../lib/agents.js');
  let user = '';
  mock = installFetchMock({ rakuten: () => json(200, { Items: [] }), openai: (body) => { user = body.messages[1].content; return aiReply({ revisions: [{ id: 'c1', quotes: ['水受けトレー付き'], reason: '水受けトレー付き', target: 't', problem: '', roomValue: 'v', cautions: 'c' }] }); } });
  const cand = { id: 'c1', ref: 'R1', code: 's:x', name: '鍋蓋スタンド', price: 1980, quotes: ['水受け'], reason: 'r', target: 't', problem: 'ふたの置き場所', roomValue: 'v', cautions: 'c', angle: 'unique', motive: 'fix', whoBuys: '自炊する社会人', whyNow: '鍋の季節', vsOthers: 'R2と違い水受け付き', priceReason: '2,000円以下', postIdea: 'くまがふたを立てる' };
  const results = [{ ref: 'R1', code: 's:x', name: '鍋蓋スタンド', price: 1980, url: 'https://item.rakuten.co.jp/s/x/', image: 'x', caption: '水受けトレー付き', keyword: 'k', checkedAt: 'x' }, { ref: 'R2', code: 's:y', name: 'トング', price: 900, url: 'https://item.rakuten.co.jp/s/y/', image: 'x', caption: 'シリコン', keyword: 'k', checkedAt: 'x' }];
  const r = await withUsage(() => reviseStep({ targets: [{ candidate: cand, why: '比較が弱い', fixes: ['理由を具体的に'] }], results, env: ENV }));
  assert.equal(r.ok, true, r.error);
  assert.match(user, /今の購入理由: 購入動機 fix／誰が買うか: 自炊する社会人/);
  const c = r.revisions[0].candidate;
  assert.equal(c.motive, 'fix'); assert.equal(c.vsOthers, 'R2と違い水受け付き'); assert.equal(c.priceReason, '2,000円以下'); assert.equal(c.problem, 'ふたの置き場所');
});

test('自律運営の1日25円：手動の定期実行（workflow_dispatch）と自動の定期実行（qstash）のどちらも、同じ記録で数え、上限に近づいたらAIを1回も呼ばずに止まる', async () => {
  const { tick, WORKER_KEYS: WK } = await import('../lib/worker.js');
  const { spent } = await import('../lib/budget.js');
  const kv = memoryKv();
  let aiCalls = 0;
  // 1回のAI呼び出しが高くつく（約1.6円）偽物：上限に早く届くようにする
  mock = installFetchMock({
    rakuten: () => json(200, { Items: makeItems(15, 'b') }),
    openai: () => { aiCalls++; return aiReply({ keywords: [{ keyword: 'キッチン 便利', why: 'x' }], candidates: [] }, { prompt_tokens: 20000, completion_tokens: 5000 }); }
  });
  await kv.setJson(WK.snap, { at: new Date().toISOString(), themes: ['キッチン'], avoid: [], past: [], outreachPosts: [] });
  const trig = ['workflow_dispatch', 'qstash'];
  let stoppedAt = null;
  for (let i = 0; i < 60; i++) {
    const before = aiCalls;
    const r = await withUsage(() => tick({ kv, env: { ...ENV, __noWait: true }, origin: 'https://app.test/', startedAt: Date.now(), trigger: trig[i % 2] }));
    const s = await spent(kv);
    assert.ok(s.dayAuto <= 25 + 3, `1日の記録 ${s.dayAuto}円（上限25円＋最後の1段階分まで）`);
    if (r.skipped && /上限/.test(r.skipped)) { stoppedAt = s.dayAuto; assert.equal(aiCalls, before, '上限で止まったときはAIを呼ばない'); break; }
    if (r.idle) {
      assert.equal(aiCalls, before, '仕事が無い・待ちのときはAIを呼ばない');
      const why = (r.board.items.find((x) => x.agent === 'buyer') || {}).reason || '';
      if (/費用の残り/.test(why)) { stoppedAt = s.dayAuto; break; } // 残りが仕事の見込みより少ないので始めない
      await kv.del(`worker:quota:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}:buyer`); // 回数の上限ではなく費用の上限で止まることを確かめる
      if (/3回続けて合格0件/.test(why)) { for (const ss of (await kv.listJson(WK.buyer, 10)) || []) ss.date = 'x'; await kv.del(WK.buyer); } // 空振りの停止ではなく費用の上限で止まることを確かめる
    }
  }
  assert.ok(stoppedAt != null && stoppedAt > 18 && stoppedAt <= 25, `費用の上限で止まった（${stoppedAt}円）`);
  const s = await spent(kv);
  assert.equal(s.month, s.dayAuto, '同じ費用が月の上限にも数えられている');
});

test('購入動機をAIが文章で返しても読み取る。監査AIには楽天のレビュー件数・平均点（確認日つき）を渡す', async () => {
  const { readMotive } = await import('../lib/buyer-angles.js');
  assert.equal(readMotive('fix'), 'fix'); assert.equal(readMotive('日常の不便を解消したい'), 'fix'); assert.equal(readMotive('プレゼント'), 'gift'); assert.equal(readMotive('新作と型落ちを比べる'), 'compare'); assert.equal(readMotive('なし'), '');
  const { auditStep } = await import('../lib/agents.js');
  let user = '';
  mock = installFetchMock({ rakuten: () => json(200, { Items: [] }), openai: (body) => { user = body.messages[1].content; return aiReply({ audits: [] }); } });
  await withUsage(() => auditStep({ candidates: [{ id: 'c1', ref: 'R1', name: 'スタンド', price: 1980, shop: 's', quotes: ['q'], reason: 'r', target: 't', problem: 'p', roomValue: 'v', cautions: 'c' }], results: [{ ref: 'R1', caption: '説明', reviewCount: 165, reviewAverage: 4.65, checkedAt: '2026-11-15T00:00:00Z' }], checks: [], env: ENV }));
  assert.match(user, /レビュー165件（平均4.65）/); assert.match(user, /2026-11-15T00:00:00Z 確認/);
});
