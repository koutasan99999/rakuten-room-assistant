import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { readEntry, add, list } from '../lib/comment-log.js';
import pr from '../server/pr.js';

async function call(kv, body) {
  const req = { method: 'POST', url: '/api/pr', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await pr(req, res, { __kv: kv });
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('送信記録：出どころと結果が無い・投稿URLでない記録は入れない（推測で埋めない）', () => {
  assert.equal(readEntry({ postUrl: 'https://www.instagram.com/p/DfWt-aox7H-/', text: 'いいですね', result: 'sent' }), null, '出どころが無い');
  assert.equal(readEntry({ postUrl: 'https://www.instagram.com/p/DfWt-aox7H-/', text: 'いいですね', source: 'instagram_activity' }), null, '結果が無い');
  assert.equal(readEntry({ postUrl: 'https://example.com/p/x', text: 'x', source: 'owner_report', result: 'sent' }), null);
  const e = readEntry({ postUrl: 'https://www.instagram.com/p/DfWt-aox7H-/?img_index=1', handle: '@Shiba.Fufu', text: 'コレ、普通にいいなぁ', sentAt: '2026-11-05T16:33:52.000Z', result: 'sent', source: 'instagram_activity' });
  assert.equal(e.postUrl, 'https://www.instagram.com/p/DfWt-aox7H-/');
  assert.equal(e.handle, 'shiba.fufu');
  assert.equal(e.by, '', '実行者の記録が無ければ空欄（推測しない）');
});

test('送信記録API：Instagramで確認した記録を、社長の記録（未照合）で上書きしない。コメント案は未送信として返す', async () => {
  const kv = memoryKv();
  const base = { postUrl: 'https://www.instagram.com/p/DfWt-aox7H-/', handle: 'shiba.fufu', text: 'コレ、普通にいいなぁ', sentAt: '2026-11-05T16:33:52.000Z', result: 'sent' };
  assert.deepEqual((await add(kv, [{ ...base, source: 'instagram_activity', by: 'Claude in Chrome（社長の承認）' }])).added, 1);
  assert.equal((await add(kv, [{ ...base, source: 'owner_report', sentAt: '2026-11-06T00:00:00Z' }])).added, 0);
  const l = await list(kv);
  assert.equal(l.length, 1);
  assert.equal(l[0].source, 'instagram_activity');
  assert.equal(l[0].sentAt, '2026-11-05T16:33:52.000Z');
  await kv.pushJson('worker:results:outreach', { postId: 'AAA1', at: '2026-11-14T00:00:00Z', outreach: { status: 'pass', final: '水受けトレー付きなら台が濡れにくそうですね' } });
  const r = await call(kv, { action: 'comment_log' });
  assert.equal(r.status, 200);
  assert.equal(r.data.sendsFromApp, false, 'アプリ・サーバーはコメントを送らない');
  assert.equal(r.data.entries.length, 1);
  assert.equal(r.data.drafts[0].sent, false, 'コメント案は未送信');
  const a = await call(kv, { action: 'comment_log_add', entries: [{ postUrl: 'bad' }] });
  assert.equal(a.data.rejected.length, 1);
  // 保存場所が無ければ「読めない」と返す（空の履歴を成功として見せない）
  const req = { method: 'POST', url: '/api/pr', headers: {}, body: { action: 'comment_log' } };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await pr(req, res, {});
  assert.equal(JSON.parse(res.body).configured, false);
});
