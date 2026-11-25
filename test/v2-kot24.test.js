// KOT-24：旧指示の無効化・全現役職種の役割定義・競合調査（出典つき）・評価
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import * as P from '../lib/v2/policy.js';
import * as C from '../lib/v2/competitor.js';
import * as X from '../lib/v2/ventures.js';
import * as V from '../lib/v2/company.js';
import { installFetchMock, aiReply } from './mock.js';

let mock;
afterEach(() => { if (mock) mock.restore(); mock = null; });

test('新規副業の発掘は既定で止まる（実行の入口）。VENTURE_DISCOVERY=on で戻せる。保存データは消えない', async () => {
  const kv = memoryKv();
  const off = await X.venturesWork('planner', { kv, env: {} });
  assert.ok(!off.task && /止めている|凍結/.test(off.none), off.none);
  await kv.setJson('v2:ventures', { items: [{ id: 'v1', stream: 'venture', title: '既存の案', status: 'active', stage: 'research', createdAt: new Date().toISOString(), tries: {}, data: {}, sources: [], artifacts: [], log: [] }] });
  const buyer = await X.venturesWork('buyer', { kv, env: {} });
  assert.ok(!buyer.task, '作りかけの副業も進めない');
  assert.equal((await kv.getJson('v2:ventures')).items.length, 1, '履歴は消さない');
  const on = await X.venturesWork('planner', { kv: memoryKv(), env: { VENTURE_DISCOVERY: 'on', VENTURES_FROZEN: '0' } });
  assert.equal(on.kind, 'venture-idea');
  // 集客の実験・デジタル商品は変えていない
  assert.equal((await X.venturesWork('pr', { kv: memoryKv(), env: {} })).kind, 'growth-hypothesis');
  assert.ok(P.RETIRED_INSTRUCTIONS.find((r) => r.id === 'venture-discovery' && r.before && r.after && r.reason && r.impact));
});

test('全現役職種に10項目の役割定義がある。旧版（役職名だけ）は不合格・新版は合格', () => {
  for (const role of ['planner', 'buyer', 'auditor', 'writer', 'editor', 'designer', 'pr']) {
    const old = P.scorePrompt(P.legacyPrompt(role));
    const now = P.scorePrompt(P.withRole(role, '本文'));
    assert.equal(old.ok, false, role);
    assert.equal(now.ok, true, `${role}: ${now.missing}`);
    assert.ok(now.score > old.score);
  }
  const pr = P.roleBrief('pr');
  for (const w of ['ファネル', '出典URL', '取得日', '回避', '完了扱いにしない', '商品選定', '導線', '反応']) assert.ok(pr.includes(w), w);
});

test('実際にAIへ渡る指示に役割定義が入っている（企画・バイヤー・広報・ライター）', async () => {
  const seen = [];
  mock = installFetchMock({ openai: (body) => { seen.push(String((body.messages || [])[0].content || '')); return aiReply({}); } });
  const kv = memoryKv();
  await kv.setJson('v2:sets', [{ id: 's1', title: 'テスト完成品', status: 'adopted' }]);
  await kv.setJson('v2:set:s1', { id: 's1', title: 'テスト完成品', products: [], status: 'adopted' });
  const env = { OPENAI_API_KEY: 'sk-test', APP_PASSCODE: 'pw' };
  const { isolated } = await import('../lib/ai-usage.js');
  const { profileWork } = await import('../lib/v2/growth.js');
  const w = await profileWork(kv);
  if (w && w.run) await isolated(() => w.run({ kv, env })).catch(() => {});
  assert.ok(seen.length >= 1, 'AIが呼ばれた');
  assert.ok(seen.every((s) => P.scorePrompt(s).ok), '全ての指示に役割定義がある');
  assert.equal(V.STAFF.length, 7, '鑑定を廃止（2026-11-25）して7職種');
  assert.ok(!V.STAFF.some((s) => s.id === 'appraiser'));
});

test('競合の観測：出典URL・取得日・事実が必要。架空・一般論・売上の断定は入らない', async () => {
  const kv = memoryKv();
  const good = { sourceUrl: 'https://www.instagram.com/p/AbCdE12345/', fetchedAt: '2026-11-24', account: 'public_account', facts: [{ axis: '冒頭', text: '1枚目に「便利グッズ3選」の文字があり、悩みを先に出している' }], inference: '悩み先出しの型が反応を得ている可能性（推測）' };
  assert.equal(C.checkObservation(good).ok, true);
  const bad = (o) => C.checkObservation({ ...good, ...o });
  assert.equal(bad({ sourceUrl: '' }).ok, false);
  assert.equal(bad({ sourceUrl: 'https://example.com/x' }).ok, false);
  assert.equal(bad({ fetchedAt: '' }).ok, false);
  assert.equal(bad({ facts: [] }).ok, false);
  assert.equal(bad({ facts: [{ axis: '冒頭', text: '一般的に多くのアカウントが工夫している' }] }).ok, false);
  assert.equal(bad({ facts: [{ axis: '冒頭', text: '〇〇アカウントの投稿' }] }).ok, false);
  assert.equal(bad({ facts: [{ axis: '売上', text: '月30万円稼いでいる' }] }).ok, false);
  assert.equal(bad({ facts: [{ axis: '反応', text: '月30万円稼いでいる' }] }).ok, false, '実売上は非公開が前提');
  assert.equal(bad({ inference: '月50万円売れている' }).ok, false);
  const o = await C.addObservation(kv, good);
  assert.equal(o.inferenceNote, '推測（観測した事実ではない）');
  await assert.rejects(() => C.addObservation(kv, good), /もう入って/);
  await assert.rejects(() => C.addObservation(kv, { ...good, sourceUrl: '' }), /入れられません/);
});

test('広報の競合調査：観測が無ければ完了扱いにせず原因と最小の操作を記録。観測があれば既存商品の販促タスクにする', async () => {
  const kv = memoryKv();
  const w = await C.competitorWork(kv);
  assert.equal(w.kind, 'competitor-unobtainable');
  const r = await w.run();
  assert.match(r.done, /未実施/);
  assert.match(r.done, /完了とはしない/);
  const st = await C.competitorState(kv);
  assert.equal(st.report.unobtainable, true);
  assert.ok(st.report.cause.retryWhen && st.report.cause.alternative && st.report.cause.humanAction && /回避/.test(st.report.cause.bypass));
  assert.equal(await C.competitorWork(kv), null, '同じ状態で繰り返さない');
  // 観測つき
  await kv.setJson('v2:sets', [{ id: 's1', title: '在宅の便利グッズ', status: 'adopted' }]);
  await C.addObservation(kv, { sourceUrl: 'https://www.instagram.com/p/AbCdE12345/', fetchedAt: '2026-11-24', facts: [{ axis: '冒頭', text: '1枚目に悩みの文字（3選）がある' }, { axis: '導線', text: 'プロフィールのリンクが楽天ROOMの1つだけ' }] });
  await C.addObservation(kv, { sourceUrl: 'https://room.rakuten.co.jp/room_abc/items', fetchedAt: '2026-11-24', facts: [{ axis: '導線', text: '紹介文の末尾に商品ページへの案内がある' }] });
  const w2 = await C.competitorWork(kv);
  assert.equal(w2.kind, 'competitor-gap');
  const r2 = await w2.run();
  assert.ok(r2.handoff);
  const rep = (await C.competitorState(kv)).report;
  assert.equal(rep.gaps[0].axis, '導線', '出典の多い軸が先');
  assert.ok(rep.tasks.every((t) => t.setTitle === '在宅の便利グッズ' && t.evidence.length && t.verify));
  assert.match(rep.caution, /売上が改善したとは言えない/);
  assert.ok(rep.needs.free.length && rep.needs.ai.length && rep.needs.humanOnly.length);
  assert.equal(await C.competitorWork(kv), null);
});

test('取得失敗の分類：回避しない・完了扱いにしない', () => {
  for (const [f, cat] of [[{ status: 403 }, 'login-or-permission'], [{ status: 429 }, 'rate-limited'], [{ status: 404 }, 'not-found'], [{ message: 'fetch failed' }, 'network-or-server'], [{ message: '??' }, 'unknown']]) {
    const c = C.classifyFailure(f);
    assert.equal(c.category, cat);
    assert.ok(c.retryWhen && c.alternative && c.humanAction && /禁止/.test(c.bypass));
  }
});

test('成果の文章の評価：一般論・架空データ・出典なしの数字なしは不合格', () => {
  assert.equal(P.evaluateOutput('一般的に多くのアカウントがさまざまな工夫をしています。').ok, false);
  assert.equal(P.evaluateOutput('競合Aは○○アカウントで、投稿頻度は週3回です。https://www.instagram.com/x/').ok, false);
  assert.equal(P.evaluateOutput('競合の冒頭は悩み先出し型で、直近5件中4件が該当（2026-11-24 取得）。').ok, true);
});
