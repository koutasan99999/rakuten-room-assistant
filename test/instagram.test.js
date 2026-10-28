import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import handler from '../api/instagram.js';
import imageHandler from '../api/image.js';
import { normalizeTopic, memoIssues, fallbackShortName } from '../lib/instagram.js';
import { installFetchMock, json, aiReply } from './mock.js';
import '../js/zip.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test', APP_PASSCODE: 'pass' };
let mock;
afterEach(() => mock && mock.restore());

async function call(h, { method = 'POST', body, url = '/', pass = 'pass' } = {}) {
  const req = { method, url, headers: { host: 'x.app', 'x-app-passcode': pass }, body };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await h(req, res, ENV);
  return res;
}

const ITEMS = [
  { name: '【送料無料】UGREEN Nexode 急速充電器 65W Type-C 2C1A 3ポート PD対応', price: 4990, role: '迷ったらこれ', reason: '1台で3台まとめて充電できる。' },
  { name: '充電式 ポータブルジューサー 電動ミキサー 380mL', price: 2980, reason: '持ち歩けるサイズで洗いやすい。' }
];

test('投稿テーマはシリーズ名を外して扱う', () => {
  assert.equal(normalizeTopic('出産祝いについて本気出して考えてみた'), '出産祝い');
  assert.equal(normalizeTopic('香水初心者'), '香水初心者');
  assert.equal(normalizeTopic(' iPhoneアクセについて '), 'iPhoneアクセ');
});

test('一言メモのルール（NG表現・長さ・推量）', () => {
  assert.deepEqual(memoIssues('これ1個あると、充電周りがかなりすっきり。'), []);
  assert.ok(memoIssues('快適な暮らしをサポートしてくれるおすすめです。').length);
  assert.ok(memoIssues('便利そうで使いやすそう。').length);
  assert.ok(memoIssues('あ'.repeat(60)).length);
});

test('AIが使えないときの短い商品名', () => {
  assert.equal(fallbackShortName(ITEMS[0].name), 'UGREEN Nexode');
  assert.ok(fallbackShortName(ITEMS[1].name).length <= 16);
});

test('AIの文字を検証して返し、NGのメモは差し替える', async () => {
  mock = installFetchMock({
    rakuten: () => json(500, {}),
    openai: () => aiReply({
      topicSlug: 'Shussan Iwai!', category: '出産祝い',
      items: [
        { id: 0, shortName: 'UGREEN 3ポート急速充電器', subline: '3台同時に充電できる', memo: 'これ1個あると、充電周りがかなりすっきり。', slug: 'UGREEN' },
        { id: 1, shortName: 'ポータブルジューサー', subline: '持ち歩ける380mL', memo: '毎日の暮らしをサポートしてくれるおすすめアイテム。', slug: 'juicer' }
      ]
    })
  });
  const res = await call(handler, { body: { theme: '出産祝いについて本気出して考えてみた', items: ITEMS } });
  const data = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(data.topic, '出産祝い');
  assert.equal(data.topicSlug, 'shussan-iwai');
  assert.equal(data.items[0].shortName, 'UGREEN 3ポート急速充電器');
  assert.equal(data.items[0].slug, 'ugreen');
  assert.equal(data.items[1].memo, '持ち歩けるサイズで洗いやすい。'); // NGなので選んだ理由から作り直し
  assert.equal(data.notice, '');
  const user = mock.calls.openai[0].messages[1].content;
  assert.match(user, /役割: 迷ったらこれ/);
});

test('AIが失敗しても簡易的な文字で返す', async () => {
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const data = JSON.parse((await call(handler, { body: { theme: '香水初心者', category: '香水', items: ITEMS } })).body);
  assert.equal(data.items.length, 2);
  assert.equal(data.category, '香水');
  assert.ok(data.items.every((x) => x.shortName && x.memo));
  assert.ok(data.notice);
});

test('テーマや商品が無ければ分かりやすく断る、合言葉が違えば401', async () => {
  assert.equal((await call(handler, { body: { theme: '', items: ITEMS } })).statusCode, 400);
  assert.equal((await call(handler, { body: { theme: 'x', items: [] } })).statusCode, 400);
  assert.equal((await call(handler, { body: { theme: 'x', items: ITEMS }, pass: 'no' })).statusCode, 401);
});

test('画像の中継は楽天の画像だけ。大きめのサイズで取りに行く', async () => {
  mock = installFetchMock({
    rakuten: (url) => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png', 'x-url': url.toString() } }),
    openai: () => aiReply({})
  });
  const ok = await call(imageHandler, { method: 'GET', url: '/api/image?url=' + encodeURIComponent('https://thumbnail.image.rakuten.co.jp/@0_mall/a/b.jpg?_ex=300x300') });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['Content-Type'], 'image/png');
  assert.equal(mock.calls.rakuten[0].url.searchParams.get('_ex'), '800x800');
  for (const bad of ['https://evil.example/x.png', 'http://thumbnail.image.rakuten.co.jp/a.jpg', 'https://rakuten.co.jp.evil.com/a.jpg', 'not a url']) {
    const r = await call(imageHandler, { method: 'GET', url: '/api/image?url=' + encodeURIComponent(bad) });
    assert.equal(r.statusCode, 400, bad);
  }
});

test('ZIPはフォルダ付きで、中身とCRCが正しい', () => {
  const a = new TextEncoder().encode('hello png');
  const zip = globalThis.MiniZip.buildZip([{ path: 'generated_posts/2026-10-28_shussan-iwai/01_cover.png', data: a }]);
  const buf = Buffer.from(zip);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(buf.readUInt32LE(14), zlib.crc32 ? zlib.crc32(a) : globalThis.MiniZip.crc32(a));
  const nameLen = buf.readUInt16LE(26);
  assert.equal(buf.slice(30, 30 + nameLen).toString(), 'generated_posts/2026-10-28_shussan-iwai/01_cover.png');
  assert.equal(buf.slice(30 + nameLen, 30 + nameLen + a.length).toString(), 'hello png');
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
});
