import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import router from '../api/[route].js';
import { costOf, withUsage } from '../lib/ai-usage.js';
import { decide, readAudits, PASS_SCORE } from '../lib/agents.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV_KEYS = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
const saved = {};
afterEach(() => { if (mock) mock.restore(); mock = null; Object.keys(saved).forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });
function setEnv(o) { Object.entries(o).forEach(([k, v]) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v; }); }

// 本番と同じ入口（api/[route].js）から呼ぶ（AIの使用量の記録も本番と同じ形で付く）
async function call(route, body) {
  const req = { method: 'POST', url: `/api/${route}`, query: { route }, headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await router(req, res);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}
const ritem = (code, name, price, caption = '') => ({ itemCode: code, itemName: name, itemPrice: price, itemUrl: `https://item.rakuten.co.jp/s/${code.replace(/\W/g, '')}/`, mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/x.jpg'], shopName: 'ショップ', itemCaption: caption, reviewCount: 12, reviewAverage: 4.2 });
const SHOP = [
  ritem('s:lid', 'ステンレス 鍋蓋スタンド 収納トレー付き', 1000, '鍋のふたを立てて置ける。水受けトレー付きで、水滴がたれにくい。直径10〜30cmのふたに対応。'),
  ritem('s:tong', 'シリコン トング 耐熱230℃', 1200, 'フライパンを傷つけにくいシリコン製。耐熱230℃。'),
  ritem('s:guard', '油はねガード 3面', 1500, '3面で油はねを防ぐ。折りたたみ式。')
];
function rakuten(url) {
  const code = url.searchParams.get('itemCode');
  if (code) return json(200, { Items: SHOP.filter((x) => x.itemCode === code).map((x) => ({ ...x, itemPrice: code === 's:guard' ? 1800 : x.itemPrice })) });
  return json(200, { Items: SHOP });
}

test('段階0：AIの実際の使用量から費用を計算し、応答に記録を付ける。失敗も「失敗」として記録する', async () => {
  assert.deepEqual(costOf('gpt-5.4-nano', { prompt_tokens: 1000000, completion_tokens: 0 }), { yen: 32, priceKnown: true }); // 0.20ドル×160円
  assert.equal(costOf('gpt-5.4-nano', { prompt_tokens: 0, completion_tokens: 1000000 }).yen, 200);
  assert.equal(costOf('unknown-model', { prompt_tokens: 1000, completion_tokens: 1000 }).priceKnown, false);
  setEnv(ENV_KEYS);
  let n = 0;
  mock = installFetchMock({ rakuten, openai: () => (++n === 1 ? json(500, { error: { message: 'server error' } }) : aiReply({ intro: 'x'.repeat(80) })) });
  const r = await call('pitch', { action: 'intro', product: { name: 'ステンレス 鍋蓋スタンド', price: 1000 } });
  assert.equal(r.status, 200);
  const u = r.data.aiUsage;
  assert.ok(u && u.measured, JSON.stringify(r.data));
  assert.ok(u.calls >= 2, String(u.calls)); // 紹介文の書き直しで、もう1回呼ぶことがある
  assert.equal(u.runs.length, u.calls);
  assert.equal(u.failedCalls, 1, '失敗した呼び出しも記録する');
  assert.equal(u.runs[0].ok, false);
  assert.match(u.runs[0].error, /500/);
  assert.ok(u.runs[1].openaiId.startsWith('chatcmpl-mock-'));
  assert.equal(u.promptTokens, 1200 * u.okCalls);
  assert.ok(u.yen > 0 && u.yen < 1, String(u.yen));
  // 入口（router）を通さない呼び出しには付かない（今までの応答の形を変えない）
  assert.equal(await withUsage(async () => 1), 1);
});

test('段階1：バイヤーAIは2回の別々の呼び出しで、楽天の実際の検索結果からだけ候補を出す（検索結果にない商品は作らない）', async () => {
  setEnv(ENV_KEYS);
  const systems = [];
  mock = installFetchMock({
    rakuten,
    openai: (body) => {
      systems.push(body.messages[0].content);
      if (body.messages[0].content.includes('検索語を決めます')) return aiReply({ keywords: [{ keyword: 'フライパン 便利グッズ', why: '周辺の道具' }] });
      return aiReply({ candidates: [
        { ref: 'R1', quotes: ['水受けトレー付き'], reason: '水受けトレー付きで、ふたを立てても水滴がたれにくい', target: '料理する一人暮らし', problem: 'ふたの置き場所', roomValue: '1,000円で置き場所の悩みを解決', cautions: '対応サイズを確認' },
        { ref: 'R99', quotes: ['x'], reason: '存在しない商品' }
      ] });
    }
  });
  const r = await call('agents', { action: 'buyer', theme: 'フライパンまわりの便利グッズ' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(r.data.candidates.length, 1, '検索結果にない R99 は使わない');
  const c = r.data.candidates[0];
  assert.equal(c.name, 'ステンレス 鍋蓋スタンド 収納トレー付き');
  assert.equal(c.price, 1000);
  assert.match(c.url, /^https:\/\/item\.rakuten\.co\.jp\//);
  assert.ok(c.checkedAt && /楽天市場 商品検索API/.test(c.source));
  // 独立した呼び出しの証拠：2回とも別の応答ID・別の指示
  assert.equal(r.data.runs.length, 2);
  assert.notEqual(r.data.runs[0].openaiId, r.data.runs[1].openaiId);
  assert.notEqual(r.data.runs[0].promptHash, r.data.runs[1].promptHash);
  assert.deepEqual(r.data.runs.map((x) => x.role), ['buyer', 'buyer']);
  assert.ok(systems.every((s) => !s.includes('監査AIです')), 'バイヤーの指示に監査の役は入れない');
});

test('段階1：コードの客観確認（掲載・価格・URL・引用の照合・禁止表現）。引用が説明にない＝根拠の捏造の疑いで不合格', async () => {
  setEnv(ENV_KEYS);
  mock = installFetchMock({ rakuten, openai: () => aiReply({}) });
  const results = SHOP.map((x, i) => ({ ref: `R${i + 1}`, code: x.itemCode, name: x.itemName, price: x.itemPrice, url: x.itemUrl, image: 'https://thumbnail.image.rakuten.co.jp/x.jpg', shop: 'ショップ', caption: x.itemCaption, keyword: 'k', checkedAt: '2026-11-12T00:00:00Z' }));
  const cand = (id, i, extra) => ({ id, ref: `R${i + 1}`, code: SHOP[i].itemCode, name: SHOP[i].itemName, price: SHOP[i].itemPrice, url: SHOP[i].itemUrl, image: 'https://thumbnail.image.rakuten.co.jp/x.jpg', quotes: ['水受けトレー付き'], reason: 'r', ...extra });
  const r = await call('agents', { action: 'check', results, candidates: [cand('c1', 0), cand('c2', 1, { quotes: ['食洗機対応'] }), cand('c3', 2, { quotes: ['3面'], reason: '絶対に油はねしない' })] });
  assert.equal(r.data.ok, true);
  const [a, b, c] = r.data.checks;
  assert.equal(a.hardFail, false, JSON.stringify(a.checks));
  assert.equal(b.hardFail, true);
  assert.match(b.checks.find((x) => x.key === 'quotes').detail, /食洗機対応/);
  assert.equal(c.hardFail, true);
  assert.equal(c.checks.find((x) => x.key === 'price').ok, false, '価格が変わっていれば不一致');
  assert.equal(c.checks.find((x) => x.key === 'expression').ok, false, '「絶対」は禁止表現');
  assert.equal(r.data.aiUsage, undefined, 'コードの確認ではAIを呼ばない');
});

test('段階1：監査AIは別の呼び出し・指定したモデルで採点。合計はコードが計算し直し、フラグがあれば点数に関係なく不合格', async () => {
  setEnv(ENV_KEYS);
  const models = [];
  mock = installFetchMock({
    rakuten,
    openai: (body) => {
      models.push(body.model);
      assert.ok(body.messages[0].content.includes('監査AIです'));
      return aiReply({ audits: [
        { id: 'c1', total: 100, scores: { accuracy: { score: 25 }, evidence: { score: 22, deductions: '引用が1つだけ' }, usefulness: { score: 18 }, revenue: { score: 12 }, compliance: { score: 15 } }, flags: {}, fixes: [], proposal: 'pass' },
        { id: 'c2', scores: { accuracy: { score: 25 }, evidence: { score: 25 }, usefulness: { score: 20 }, revenue: { score: 15 }, compliance: { score: 15 } }, flags: { unverified: true, why: '「人気」と断定' }, fixes: ['「人気」を削る'], proposal: 'pass' }
      ] });
    }
  });
  const cands = [{ id: 'c1', ref: 'R1', code: 'a', name: 'A', price: 1000, url: 'https://item.rakuten.co.jp/a/', quotes: ['q'] }, { id: 'c2', ref: 'R2', code: 'b', name: 'B', price: 1000, url: 'https://item.rakuten.co.jp/b/', quotes: ['q'] }];
  const r = await call('agents', { action: 'audit', model: 'gpt-4o-mini', candidates: cands, results: [], checks: [] });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual(models, ['gpt-4o-mini'], '監査AIのモデルを個別に指定できる');
  assert.equal(r.data.runs[0].role, 'auditor');
  const [a1, a2] = r.data.audits;
  assert.equal(a1.total, 92, 'AIの total（100）ではなく、項目の点数の合計');
  const ok = { hardFail: false, unknown: false, checks: [] };
  assert.equal(decide({ check: ok, audit: a1, revisions: 0 }).status, 'pass');
  assert.equal(decide({ check: ok, audit: a2, revisions: 0 }).status, 'revise', 'フラグがあれば100点でも合格にしない');
  assert.equal(decide({ check: ok, audit: a2, revisions: 2 }).status, 'reject');
});

test('判定の決まり：コードの確認でNG・未確認は合格にしない。80点未満は修正（2回まで）→ 保留', () => {
  const audit = (total, extra) => ({ total, flags: {}, proposal: 'revise', needResearch: '', summary: '', ...extra });
  const ok = { hardFail: false, unknown: false, checks: [] };
  const ng = { hardFail: true, unknown: false, checks: [{ hard: true, ok: false, label: '価格が楽天のデータと一致' }] };
  assert.equal(PASS_SCORE, 80);
  assert.equal(decide({ check: ng, audit: audit(95, { proposal: 'pass' }), revisions: 0 }).status, 'revise');
  assert.equal(decide({ check: { ...ok, unknown: true }, audit: audit(95, { proposal: 'pass' }), revisions: 0 }).status, 'hold');
  assert.equal(decide({ check: ok, audit: audit(70), revisions: 0 }).status, 'revise');
  assert.equal(decide({ check: ok, audit: audit(70), revisions: 2 }).status, 'hold');
  assert.equal(decide({ check: ok, audit: audit(85), revisions: 0 }).status, 'revise', '80点以上でも、監査AIの修正指示が残っていれば合格にしない');
  assert.equal(decide({ check: ok, audit: audit(85, { proposal: 'pass' }), revisions: 0 }).status, 'pass');
  assert.equal(decide({ check: ok, audit: audit(60, { needResearch: '対応サイズ' }), revisions: 0 }).status, 'hold');
  assert.equal(decide({ check: ok, audit: audit(90, { proposal: 'reject', summary: '向かない' }), revisions: 0 }).status, 'reject', '監査AIは却下を提案できる');
  assert.throws(() => readAudits({ audits: [] }, [{ id: 'c1' }]));
});

test('段階1：バイヤーAIの修正。必要な情報がなければ推測せず「追加調査が必要」、替えの商品は検索結果からだけ。AIの失敗は失敗として返す', async () => {
  setEnv(ENV_KEYS);
  let fail = false;
  mock = installFetchMock({
    rakuten,
    openai: () => (fail ? json(401, { error: { message: 'Incorrect API key' } }) : aiReply({ revisions: [
      { id: 'c1', needResearch: '対応する鍋の直径が説明にない' },
      { id: 'c2', replaceRef: 'R2', quotes: ['耐熱230℃'], reason: '耐熱230℃のシリコン製', target: '料理する人', problem: 'フライパンの傷', roomValue: '1,200円', cautions: 'サイズを確認' }
    ] }))
  });
  const results = SHOP.map((x, i) => ({ ref: `R${i + 1}`, code: x.itemCode, name: x.itemName, price: x.itemPrice, url: x.itemUrl, image: 'i', shop: 's', caption: x.itemCaption, keyword: 'k', checkedAt: 't' }));
  const t = (id, ref) => ({ candidate: { id, ref, code: 'x', name: 'n', price: 1, url: 'https://item.rakuten.co.jp/x/', quotes: ['q'] }, why: '80点未満', fixes: ['引用を増やす'] });
  const r = await call('agents', { action: 'revise', results, targets: [t('c1', 'R1'), t('c2', 'R3')] });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.match(r.data.revisions[0].needResearch, /直径/);
  assert.equal(r.data.revisions[1].candidate.name, 'シリコン トング 耐熱230℃');
  assert.equal(r.data.revisions[1].replaced, true);
  fail = true;
  const f = await call('agents', { action: 'revise', results, targets: [t('c1', 'R1')] });
  assert.equal(f.data.ok, false, 'AIの失敗を正常終了にしない');
  assert.equal(f.data.failedStep, 'バイヤーAI：修正');
  assert.match(f.data.error, /401/);
  assert.equal(f.data.runs[0].ok, false);
});
