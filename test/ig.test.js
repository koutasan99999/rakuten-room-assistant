import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import ig from '../server/ig.js';
import { igConfig, publish } from '../lib/ig-graph.js';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
function stub(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, method: opts.method || 'GET', params: opts.body ? new URLSearchParams(opts.body) : u.searchParams });
    const hit = routes.find(([re]) => re.test(`${opts.method || 'GET'} ${u.pathname}`));
    const body = hit ? hit[1](u, opts) : { error: { message: 'not found' } };
    return new Response(JSON.stringify(body), { status: body.error ? 400 : 200 });
  };
  return calls;
}
async function call(body, env) {
  const req = { method: 'POST', headers: {}, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await ig(req, res, env);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('トークンが無ければ、何もせず「未設定」と返す（外に通信しない）', async () => {
  const calls = stub([]);
  const r = await call({ action: 'insights' }, {});
  assert.equal(r.data.ready, false);
  assert.equal(calls.length, 0);
});

test('数字の自動取得：アカウントの数字と、最近の投稿ごとの数字を返す。トークンは応答に出さない', async () => {
  const calls = stub([
    [/GET \/v23\.0\/me$/, () => ({ user_id: '1', username: 'ganka_kuma_', followers_count: 1, media_count: 9 })],
    [/GET \/v23\.0\/me\/insights$/, (u) => ({ data: [{ name: u.searchParams.get('metric'), total_value: { value: u.searchParams.get('metric') === 'reach' ? 3 : 0 } }] })],
    [/GET \/v23\.0\/me\/media$/, () => ({ data: [{ id: 'm1', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/x/', timestamp: '2026-10-01T00:00:00+0000', like_count: 0, comments_count: 0 }] })],
    [/GET \/v23\.0\/m1\/insights$/, () => ({ data: [{ name: 'views', values: [{ value: 5 }] }, { name: 'reach', values: [{ value: 4 }] }] })]
  ]);
  const r = await call({ action: 'insights', days: 7 }, { IG_ACCESS_TOKEN: 'SECRET-TOKEN' });
  assert.equal(r.status, 200);
  assert.equal(r.data.account.username, 'ganka_kuma_');
  assert.equal(r.data.insights.metrics.reach, 3);
  assert.equal(r.data.media[0].insights.views, 5);
  assert.ok(!JSON.stringify(r.data).includes('SECRET-TOKEN'));
  assert.ok(calls.every((c) => c.params.get('access_token') === 'SECRET-TOKEN'));
});

test('投稿：オフのときは投稿しない。オンでも1日の上限を守り、カルーセルは子→親→公開の順に作る', async () => {
  await assert.rejects(publish(igConfig({ IG_ACCESS_TOKEN: 't' }), { kind: 'carousel', imageUrls: ['https://a/1.jpg', 'https://a/2.jpg'] }), /オフ/);
  stub([[/content_publishing_limit/, () => ({ data: [{ quota_usage: 1 }] })]]);
  await assert.rejects(publish(igConfig({ IG_ACCESS_TOKEN: 't', IG_PUBLISH_ENABLED: '1' }), { kind: 'carousel', imageUrls: ['https://a/1.jpg', 'https://a/2.jpg'] }), /上限/);
  let n = 0;
  const calls = stub([
    [/content_publishing_limit/, () => ({ data: [{ quota_usage: 0 }] })],
    [/POST \/v23\.0\/me\/media$/, () => ({ id: `c${++n}` })],
    [/GET \/v23\.0\/c\d+$/, () => ({ status_code: 'FINISHED' })],
    [/POST \/v23\.0\/me\/media_publish$/, () => ({ id: 'post1' })]
  ]);
  const r = await publish(igConfig({ IG_ACCESS_TOKEN: 't', IG_PUBLISH_ENABLED: '1' }), { kind: 'carousel', imageUrls: ['https://a/1.jpg', 'https://a/2.jpg'], caption: '【PR】テスト', waitMs: 0 });
  assert.equal(r.id, 'post1');
  const posts = calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => c.params.get('is_carousel_item') || c.params.get('media_type') || 'publish'), ['true', 'true', 'CAROUSEL', 'publish']);
  assert.equal(posts[2].params.get('children'), 'c1,c2');
  await assert.rejects(publish(igConfig({ IG_ACCESS_TOKEN: 't', IG_PUBLISH_ENABLED: '1' }), { kind: 'carousel', imageUrls: ['http://a/1.jpg', 'https://a/2.jpg'] }), /https/);
});
