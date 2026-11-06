import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHandles, siteTargets, discoverFromSites, businessDiscovery, freshPosts, fbConfig, hashtagRecent } from '../lib/ig-discovery.js';
import { ROUTES } from '../api/[route].js';

test('HTMLからInstagramのアカウントを読む（投稿・共有のリンクは除く、重複は1つ）', () => {
  const html = `<a href="https://www.instagram.com/kintojapan/">IG</a><a href="https://instagram.com/kintojapan">x</a>
    <a href="https://www.instagram.com/p/ABC123/">post</a><a href="//www.instagram.com/explore/tags/x/">t</a>
    <script>{"sns":"https:\\u002F\\u002Fwww.instagram.com\\u002Fthermos_k.k\\u002F"}</script>`;
  assert.deepEqual(extractHandles(html), ['kintojapan', 'thermos_k.k']);
  assert.deepEqual(extractHandles('<p>Instagramはこちら</p>'), []);
});

test('公式サイトが分からないブランドは調べない（URLを推測しない）。社長の登録を優先する', () => {
  const { targets, missing } = siteTargets(['KINTO', 'キントーではない謎ブランド', 'kinto'], { 'Harley of Scotland': 'https://example.com/' });
  assert.deepEqual(targets.map((t) => t.brand), ['KINTO', 'Harley of Scotland']);
  assert.deepEqual(missing, ['キントーではない謎ブランド']);
  assert.ok(targets[0].from.includes('2026-11-06'));
  assert.equal(siteTargets(['X'], { X: 'http://insecure.example/' }).targets.length, 0);
});

test('公式サイトにリンクが無い・開けないときは、候補を作らず理由を返す', async () => {
  const pages = { 'https://a.example/': '<a href="https://www.instagram.com/brand_a/">ig</a>', 'https://b.example/': '<p>none</p>' };
  const fetchHtml = async (u) => { if (!pages[u]) throw new Error('404'); return { html: pages[u], url: u }; };
  const r = await discoverFromSites([{ brand: 'A', url: 'https://a.example/' }, { brand: 'B', url: 'https://b.example/' }, { brand: 'C', url: 'https://c.example/' }], { fetchHtml });
  assert.deepEqual(r[0].handles, ['brand_a']);
  assert.ok(r[0].checkedAt && !r[0].error);
  assert.deepEqual(r[1].handles, []);
  assert.match(r[1].error, /見つかりません/);
  assert.match(r[2].error, /開けません/);
});

test('Facebookログイン方式：設定が無ければ使わない。最近の投稿は72時間以内・本文あり・コメントが多すぎない投稿だけ', async () => {
  assert.equal(fbConfig({}).ready, false);
  assert.equal(fbConfig({ IG_FB_ACCESS_TOKEN: 't', IG_FB_USER_ID: 'abc' }).ready, false);
  const cfg = fbConfig({ IG_FB_ACCESS_TOKEN: 'secret', IG_FB_USER_ID: '178' });
  const now = Date.parse('2026-11-06T00:00:00Z');
  let called = '';
  const fetchImpl = async (url) => {
    called = url;
    return { ok: true, status: 200, json: async () => ({ business_discovery: { username: 'KintoJapan', followers_count: 1000, media: { data: [
      { permalink: 'https://www.instagram.com/p/AAA/', caption: '新作のマグ', timestamp: '2026-11-05T10:00:00+0000', comments_count: 3 },
      { permalink: 'https://www.instagram.com/p/BBB/', caption: '古い投稿', timestamp: '2026-10-01T10:00:00+0000', comments_count: 1 },
      { permalink: 'https://www.instagram.com/p/CCC/', caption: '', timestamp: '2026-11-05T10:00:00+0000', comments_count: 1 },
      { permalink: 'https://www.instagram.com/p/DDD/', caption: 'キャンペーン', timestamp: '2026-11-05T10:00:00+0000', comments_count: 2000 }
    ] } } }) };
  };
  const b = await businessDiscovery(cfg, '@KintoJapan', { fetchImpl });
  assert.match(decodeURIComponent(called), /graph\.facebook\.com\/v23\.0\/178\?fields=business_discovery\.username\(kintojapan\)/);
  assert.equal(b.followers, 1000);
  assert.equal(b.handle, 'kintojapan');
  assert.deepEqual(freshPosts(b.media, { now }).map((m) => m.url), ['https://www.instagram.com/p/AAA/']);
});

test('ハッシュタグ検索は、審査が通って IG_HASHTAG_SEARCH=on のときだけ', async () => {
  const cfg = fbConfig({ IG_FB_ACCESS_TOKEN: 's', IG_FB_USER_ID: '1' });
  await assert.rejects(hashtagRecent(cfg, 'インテリア'), /オフ/);
});

test('APIの一覧に pr がある', () => {
  assert.equal(typeof ROUTES.pr, 'function');
});
