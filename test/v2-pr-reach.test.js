// 2026-11-17 社長の方針：広報は自分で交流先を探し、見つけたブランド・話題を企画とバイヤーへ引き継ぐ。
//   送ったコメントは根拠つきで履歴に残し、社長が事後確認できる。コメント案と送信済みは厳密に分ける。アプリからは送らない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryKv } from '../lib/kv.js';
import { addLeads, leadsFor, markLeadUsed, prState, prWork } from '../lib/v2/pr.js';
import { OFFICIAL_SITES } from '../lib/ig-discovery.js';
import { add } from '../lib/comment-log.js';
import v2api from '../server/v2.js';

const ENV = { APP_PASSCODE: 'pw' };
async function call(kv, body) {
  const req = { method: 'POST', url: '/api/v2', headers: { 'x-app-passcode': 'pw' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await v2api(req, res, { ...ENV, __kv: kv });
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('交流先の手がかり：重複せずに入り、企画が使ったら印が付く', async () => {
  const kv = memoryKv();
  assert.equal((await addLeads(kv, [{ key: 'brand:KINTO', brand: 'KINTO', topic: 'KINTOの商品', from: '公式サイト' }])).length, 1);
  assert.equal((await addLeads(kv, [{ key: 'brand:KINTO', brand: 'KINTO', topic: 'KINTOの商品', from: '公式サイト' }])).length, 0);
  assert.equal((await leadsFor(kv)).length, 1);
  await markLeadUsed(kv, 'brand:KINTO', 'コーヒー時間');
  assert.equal((await leadsFor(kv)).length, 0);
  const st = await prState(kv, {});
  assert.equal(st.leads[0].usedFor, 'コーヒー時間');
});

test('公式サイトの確認：調べていないサイトがあれば仕事になり、全部7日以内に調べてあれば仕事にしない', async () => {
  const kv = memoryKv();
  const all = Object.fromEntries(Object.keys(OFFICIAL_SITES).map((b) => [b, new Date().toISOString()]));
  const one = Object.keys(OFFICIAL_SITES)[0];
  await kv.setJson('v2:pr:state', { siteChecks: { ...all, [one]: undefined } });
  assert.equal((await prWork(kv, {})).kind, 'pr-sites');
  await kv.setJson('v2:pr:state', { siteChecks: all });
  const w = await prWork(kv, {});
  assert.ok(w.none, '調べ終わっていて、投稿も無いので仕事なし');
  assert.match(w.none, /公式API/);
});

test('履歴：実際に送ったものだけを根拠つきで出し、社長の事後確認（問題なし・不適切・削除した）を残す。コメント案は履歴に入らない', async () => {
  const kv = memoryKv();
  await add(kv, [{ postUrl: 'https://www.instagram.com/p/DfWt-aox7H-/', handle: 'shiba.fufu', text: 'コレ、普通にいいなぁ', sentAt: '2026-11-05T16:33:52.000Z', result: 'sent', source: 'instagram_activity', checkedAt: '2026-11-15T14:00:00Z' }]);
  await kv.setJson('v2:pr:drafts', [{ id: 'd1', postId: 'X1', url: 'https://www.instagram.com/p/X1abc/', handle: 'a', comment: '案です', status: 'approval', caption: 'x', history: [] }]);
  let st = await prState(kv, {});
  assert.equal(st.history.length, 1, 'コメント案は送信の履歴に入れない');
  assert.equal(st.history[0].review.status, 'unchecked');
  assert.match(st.history[0].evidence, /アクティビティ/);
  assert.equal(st.access.sends, false);
  const id = st.history[0].id;
  const r = await call(kv, { action: 'commentReview', id, status: 'flagged', note: '言い方が雑' });
  assert.equal(r.status, 200);
  assert.equal(r.data.entry.review.status, 'flagged');
  await call(kv, { action: 'commentReview', id, status: 'deleted' });
  st = await prState(kv, {});
  assert.equal(st.history[0].review.status, 'deleted');
  // 同じコメントの記録を足しても、社長の確認は消えない
  await add(kv, [{ postUrl: 'https://www.instagram.com/p/DfWt-aox7H-/', handle: 'shiba.fufu', text: 'コレ、普通にいいなぁ', sentAt: '2026-11-05T16:33:52.000Z', result: 'sent', source: 'instagram_activity' }]);
  assert.equal((await prState(kv, {})).history[0].review.status, 'deleted');
  assert.equal((await call(kv, { action: 'commentReview', id, status: 'bogus' })).status, 400);
});
