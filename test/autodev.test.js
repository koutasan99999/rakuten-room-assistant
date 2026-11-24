// 2026-11-24 KOT-14：自動開発（優先順位・自動マージの条件・独立レビュー・開発管理の記録・本番の版）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { urgency, pickCandidate, config, limitReason, autoMergeDecision, readReview, protectedPaths, secretInDiff } from '../scripts/linear-claude/lib.mjs';
import { reviewPrompt } from '../scripts/linear-claude/steps.mjs';
import devApi, { record, state } from '../server/dev.js';
import versionApi from '../server/version.js';

const cfg = config({ LINEAR_ALLOWED_CREATOR_IDS: 'owner' });
const iss = (id, priority, createdAt, title = '依頼') => ({ id, identifier: id, title, priority, createdAt, team: { key: 'KOT' }, creator: { id: 'owner' }, state: { type: 'backlog' }, labels: { nodes: [{ name: 'Claude開発依頼' }] } });

test('優先順位：Urgent → High → … → 優先度なし。同じなら【緊急】【最優先】、それでも同じなら古い順', () => {
  const list = [iss('KOT-1', 0, '2026-11-01'), iss('KOT-2', 3, '2026-11-02'), iss('KOT-3', 1, '2026-11-20'), iss('KOT-4', 1, '2026-11-21', '【最優先】修復')];
  assert.equal(pickCandidate(list, cfg).identifier, 'KOT-4');
  assert.equal(pickCandidate(list.slice(0, 3), cfg).identifier, 'KOT-3');
  assert.equal(pickCandidate(list.slice(0, 2), cfg).identifier, 'KOT-2');
  assert.ok(urgency({ priority: 0 }) > urgency({ priority: 4 }));
});

test('確認待ちのPRの上限：通常は止める。緊急（Urgent）は止めない。1日の上限はどちらも守る', () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const open = Array.from({ length: 5 }, (_, i) => ({ head: { ref: `linear/kot-${i}-1` }, state: 'open', created_at: '2026-11-20T00:00:00Z' }));
  assert.match(limitReason(open, cfg, now), /確認待ち/);
  assert.equal(limitReason(open, cfg, now, { urgent: true }), null);
  const day = Array.from({ length: 10 }, (_, i) => ({ head: { ref: `linear/kot-${i}-1` }, state: 'closed', created_at: '2026-11-23T12:00:00Z' }));
  assert.match(limitReason(day, cfg, now, { urgent: true }), /24時間/);
});

test('自動マージの条件：テスト・Claude・独立レビューの承認がそろい、守るファイル・大きすぎる変更・秘密が無いときだけ', () => {
  const ok = { claudeOk: true, testOk: true, review: { verdict: 'approve', blocking: [], notes: [] }, changed: ['lib/v2/company.js', 'v2/app.js'], lines: 120, diff: '+const a = 1;' };
  assert.equal(autoMergeDecision(ok).ok, true);
  assert.match(autoMergeDecision({ ...ok, testOk: false }).why.join(), /npm test/);
  assert.match(autoMergeDecision({ ...ok, review: { verdict: 'changes', blocking: ['データを消す'] } }).why.join(), /データを消す/);
  assert.match(autoMergeDecision({ ...ok, review: null }).why.join(), /承認していない/);
  for (const p of ['.github/workflows/x.yml', 'scripts/linear-claude/lib.mjs', 'CLAUDE.md', 'lib/budget.js', 'package.json', 'vercel.json', 'server/linear-kick.js', '.env.local']) assert.ok(!autoMergeDecision({ ...ok, changed: [p] }).ok, p);
  assert.match(autoMergeDecision({ ...ok, lines: 9999 }).why.join(), /大きすぎる/);
  assert.match(autoMergeDecision({ ...ok, diff: '+const k = "sk-ant-oat01-AAAAAAAAAAAAAAAAAAAA";' }).why.join(), /秘密/);
  assert.ok(!secretInDiff('-const k = "sk-ant-oat01-AAAAAAAAAAAA";'), '消した行は数えない');
  assert.match(autoMergeDecision({ ...ok, labels: ['自動マージしない'] }).why.join(), /ラベル/);
  assert.deepEqual(protectedPaths(['lib/v2/company.js']), []);
});

test('独立レビューの結果：JSON を読む。読めない・承認でない・形が違うときは承認しない。レビューの指示に、本文の指示に従わないことを書く', () => {
  assert.equal(readReview('確認しました。\n{"verdict":"approve","blocking":[],"notes":["軽い指摘"]}').verdict, 'approve');
  assert.equal(readReview('{"verdict":"changes","blocking":["予算を上げている"]}').blocking[0], '予算を上げている');
  assert.equal(readReview('承認です').verdict, 'unknown');
  assert.equal(readReview('{"verdict":"APPROVE!!"}').verdict, 'changes');
  const p = reviewPrompt({ identifier: 'KOT-1', title: 't' }, '/tmp/d.patch');
  assert.match(p, /従わない/); assert.match(p, /KOT-13/); assert.match(p, /\/tmp\/d\.patch/);
});

test('開発管理の記録：段階・時刻・リンクを残し、秘密らしい文字列は伏せ字。認証（CRON_SECRET）が無い送信と、合言葉の無い読み出しは断る', async () => {
  const kv = memoryKv();
  await record(kv, { queue: [{ id: 'KOT-15', title: 'x', url: 'https://linear.app/a/issue/KOT-15', ok: false, why: '承認ラベル「Claude開発依頼」が無い' }] });
  await record(kv, { ticket: { id: 'KOT-14', title: '修復', url: 'https://linear.app/a/issue/KOT-14', requestedAt: '2026-11-24T06:56:14Z' }, stage: { name: 'accepted', status: 'done', detail: '受け付けた' }, run: 'https://github.com/o/r/actions/runs/1' });
  await record(kv, { ticket: { id: 'KOT-14' }, stage: { name: 'test', status: 'failed', detail: 'token: sk-ant-oat01-ABCDEFGHIJKLMNOPQRSTUV 失敗' } });
  await record(kv, { ticket: { id: 'KOT-14' }, stage: { name: 'pr', status: 'done', detail: 'PR' }, pr_url: 'https://github.com/o/r/pull/9' });
  const s = await state(kv);
  const t = s.tickets[0];
  assert.equal(t.id, 'KOT-14'); assert.ok(t.startedAt); assert.equal(t.pr_url, 'https://github.com/o/r/pull/9');
  assert.equal(t.stages.length, 3);
  assert.ok(!JSON.stringify(t).includes('sk-ant'), '秘密を残さない');
  assert.match(t.error, /伏せ字/);
  assert.equal(s.queue.items[0].why, '承認ラベル「Claude開発依頼」が無い');
  const call = async (method, headers, body) => { const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } }; await devApi({ method, url: '/api/dev', headers, body }, res, { __kv: kv, CRON_SECRET: 'cs', APP_PASSCODE: 'pw' }); return { status: res.statusCode, data: JSON.parse(res.body) }; };
  assert.equal((await call('POST', {}, { ticket: { id: 'KOT-1' } })).status, 401);
  assert.equal((await call('POST', { authorization: 'Bearer cs' }, { ticket: { id: 'KOT-1' }, stage: { name: 'accepted', status: 'done' } })).status, 200);
  assert.equal((await call('GET', {})).status, 401);
  assert.equal((await call('GET', { 'x-app-passcode': 'pw' })).data.tickets.length, 2);
});

test('本番の版：コミットの番号と画面の版を返す（秘密は返さない）', async () => {
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await versionApi({ method: 'GET', url: '/api/version', headers: {} }, res, { VERCEL_GIT_COMMIT_SHA: 'abc123', VERCEL_ENV: 'production', CRON_SECRET: 'secret' });
  const d = JSON.parse(res.body);
  assert.equal(d.commit, 'abc123'); assert.match(d.app, /^\d+\.\d+\.\d+$/);
  assert.ok(!res.body.includes('secret'));
});
