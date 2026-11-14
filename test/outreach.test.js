import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import router from '../api/[route].js';
import { checkComment, similarity, decide, readAudits } from '../lib/outreach.js';
import { installFetchMock, json, aiReply } from './mock.js';

let mock;
const saved = {};
afterEach(() => { if (mock) mock.restore(); mock = null; Object.keys(saved).forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });
function setEnv(o) { Object.entries(o).forEach(([k, v]) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v; }); }
async function call(body) {
  const req = { method: 'POST', url: '/api/pr', query: { route: 'pr' }, headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await router(req, res);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}
const POSTS = [
  { id: 'AAA1', url: 'https://www.instagram.com/p/AAA1/', handle: 'kitchen_a', caption: '鍋のふたの置き場所に困っていたので、水受けトレー付きのスタンドを置きました。', source: '社長が追加' },
  { id: 'CCC3', url: 'https://www.instagram.com/p/CCC3/', handle: 'x', caption: '', source: '社長が追加' }
];

test('営業・交流担当AI：文章のある投稿だけにコメント案を作り（文章のない投稿はAIに渡さない）、コードで確認する。送信はしない', async () => {
  setEnv({ OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app' });
  const sent = [];
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: (body) => { sent.push(body.messages[1].content); return aiReply({ drafts: [{ id: 'AAA1', anchor: '水受けトレー付き', comment: '水受けトレー付きなら台が濡れにくそうですね', relevance: 80, relevanceWhy: '台所の道具', follow: 70, followWhy: '台所の投稿' }] }); } });
  const r = await call({ action: 'outreach_draft', posts: POSTS, themes: ['鍋蓋スタンド'], past: [] });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(r.data.drafts.length, 1);
  assert.match(r.data.skipped[0].why, /推測しない/);
  assert.ok(!sent[0].includes('CCC3'), '文章のない投稿はAIに渡さない');
  assert.equal(r.data.checks[0].hardFail, false, JSON.stringify(r.data.checks[0]));
  assert.equal(r.data.runs[0].role, 'outreach');
  assert.ok(r.data.runs[0].openaiId);
  // URLが Instagram の投稿でなければ受け付けない（架空のURLを使わない）
  const bad = await call({ action: 'outreach_draft', posts: [{ id: 'z', url: 'https://example.com/p/1', caption: 'あいうえおかきくけこ' }] });
  assert.equal(bad.status, 400);
});

test('コードの確認：宣伝・誘導、投稿にない点、使い回し（似すぎ）を見つける', () => {
  const post = POSTS[0];
  const ok = checkComment({ id: 'AAA1', anchor: '水受けトレー付き', comment: '水受けトレー付きなら台が濡れにくそうですね' }, post, []);
  assert.equal(ok.hardFail, false);
  const promo = checkComment({ id: 'AAA1', anchor: '水受けトレー付き', comment: '水受けトレー付き最高、フォローお願いします' }, post, []);
  assert.ok(promo.checks.find((x) => x.key === 'promo').ok === false && promo.hardFail);
  const fake = checkComment({ id: 'AAA1', anchor: '食洗機対応', comment: '食洗機対応なのは助かりますね' }, post, []);
  assert.equal(fake.checks.find((x) => x.key === 'anchor').ok, false, '投稿の文章にない点に触れている');
  const dup = checkComment({ id: 'AAA1', anchor: '水受けトレー付き', comment: '水受けトレー付きなら台が濡れにくそうですね' }, post, ['水受けトレー付きなら台が濡れにくそうですね！']);
  assert.equal(dup.checks.find((x) => x.key === 'duplicate').ok, false, '過去のコメントの使い回し');
  assert.ok(similarity('あいうえお', 'あいうえお') > 0.9 && similarity('あいうえお', 'かきくけこ') === 0);
  const nocap = checkComment({ id: 'x', anchor: 'a', comment: 'あいうえおかきくけ' }, { caption: '' }, []);
  assert.equal(nocap.hardFail, true, '文章がない投稿は不合格');
});

test('監査AIの採点は別の呼び出し。合計はコードが計算し、宣伝の疑いがあれば点数に関係なく不合格。判定の決まり', async () => {
  setEnv({ OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app' });
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: (body) => { assert.match(body.messages[0].content, /監査AIです/); return aiReply({ audits: [{ id: 'AAA1', total: 100, scores: { specific: { score: 23 }, natural: { score: 21 }, relevance: { score: 17 }, distance: { score: 14 }, compliance: { score: 15 } }, flags: {}, fixes: [], proposal: 'pass' }] }); } });
  const r = await call({ action: 'outreach_audit', posts: POSTS.slice(0, 1), drafts: [{ id: 'AAA1', anchor: '水受けトレー付き', comment: '水受けトレー付きなら台が濡れにくそうですね' }], past: [], revisions: {} });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(r.data.audits[0].total, 90);
  assert.equal(r.data.decisions[0].status, 'pass');
  assert.equal(r.data.runs[0].role, 'auditor');
  const ck = { hardFail: false, checks: [] };
  const a = readAudits({ audits: [{ id: 'x', scores: { specific: 25, natural: 25, relevance: 20, distance: 15, compliance: 15 }, flags: { promo: true }, proposal: 'pass' }] }, [{ id: 'x' }])[0];
  assert.equal(a.total, 100);
  assert.equal(decide({ check: ck, audit: a, revisions: 0 }).status, 'revise');
  assert.equal(decide({ check: ck, audit: a, revisions: 2 }).status, 'reject');
  assert.equal(decide({ check: ck, audit: { ...a, flags: {}, total: 85, proposal: 'revise' }, revisions: 2 }).status, 'hold', '修正2回でも合格しなければ保留');
  assert.equal(decide({ check: { hardFail: true, checks: [{ hard: true, ok: false, label: '宣伝' }] }, audit: { ...a, flags: {}, proposal: 'pass' }, revisions: 0 }).status, 'revise');
});

test('第1段階：出勤状況。記録がなければ「今は仕事していません」、失敗は「エラー」、確かめられない仕事は「状態未確認」（成功にしない）、社長の判断待ちは出勤に含めない、実際に動いているときだけ「仕事中」。出勤・退勤は実際の時刻から', () => {
  const ctx = { window: {}, console, localStorage: { getItem: () => null, setItem() {} }, location: {}, setTimeout };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/work.js', import.meta.url), 'utf8'), ctx);
  const W = ctx.WorkView;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  assert.equal(W.stateOf({ items: [] }).key, 'off');
  assert.equal(W.stateOf({ items: [{ start: iso(now), state: 'running' }] }).key, 'working');
  assert.equal(W.stateOf({ items: [{ start: iso(now), end: iso(now), state: 'failed' }] }).key, 'error');
  assert.equal(W.stateOf({ items: [{ start: iso(now), state: 'unknown' }] }).key, 'unknown');
  // 社長の判断待ちがあるだけでは出勤にしない（2026-11-16）。今日AIを呼び出して仕事をしたときだけ「今日は出勤済み」
  assert.equal(W.stateOf({ items: [{ start: iso(now - 3 * 86400000), end: iso(now - 3 * 86400000), state: 'ok', pending: 2 }] }).key, 'off');
  assert.equal(W.stateOf({ items: [{ start: iso(now), end: iso(now), state: 'ok', calls: [{ ok: true }] }] }).key, 'today');
  assert.equal(W.workedToday({ items: [{ start: iso(now), end: iso(now), state: 'ok', calls: [] }] }), false, 'AIを呼んでいない仕事は出勤に数えない');
  assert.equal(W.stateOf({ items: [{ start: iso(now), end: iso(now), state: 'ok' }] }).key, 'off', '仕事が終わったら「仕事中」は終わる');
  assert.equal(W.stateOf({ items: [{ start: iso(now - 3 * 86400000), end: iso(now - 3 * 86400000), state: 'failed' }] }).key, 'off', '古い失敗はエラーにしない');
  // 出勤・退勤：その日の最初の開始と最後の終了。仕事中なら退勤なし
  const s = { items: [{ start: iso(now - 3600000), end: iso(now - 3000000), state: 'ok' }, { start: iso(now - 600000), end: iso(now - 300000), state: 'ok' }] };
  const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  const sameDay = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10) === today;
  if (sameDay(now - 3600000)) {
    const a = W.attendance(s, { key: 'off' });
    assert.equal(a.in, iso(now - 3600000));
    assert.equal(a.out, iso(now - 300000));
    assert.equal(W.attendance(s, { key: 'working' }).out, '');
  }
  assert.equal(W.attendance({ items: [] }, { key: 'off' }).in, '', '仕事がなければ出勤もない');
  // 記録が何もなければ、全員「今は仕事していません」（判断待ちの数がなければ）。架空の仕事を作らない
  const staff = W.staff();
  assert.ok(staff.length >= 6);
  assert.ok(staff.every((x) => x.items.length === 0));
  assert.ok(staff.every((x) => W.stateOf(x).key === 'off'));
  assert.ok(staff.every((x) => x.auto && typeof x.auto.can === 'boolean' && (x.auto.can ? x.auto.how : x.auto.why)), '社員ごとに、自律運営できるか・できない理由');
  assert.equal(staff.filter((x) => x.auto.can).map((x) => x.key).sort().join(','), 'auditor,buyer,editor,outreach,planner,planning,set');
});
