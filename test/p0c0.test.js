import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ig from '../server/ig.js';
import { json } from './mock.js';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

// 画面のファイル（js/）を、ブラウザの代わりの入れ物で読み込む
function loadBrowser(files, extra = {}) {
  const store = {};
  const ctx = { window: {}, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, console, ...extra };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), ctx);
  return { ctx, store };
}

test('P0：投稿ごとの実績を公式APIから取る。取れない指標（追加の指標・内訳）は未取得のまま返し、アカウント全体はフォロワー以外に分ける', async () => {
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const p = u.pathname;
    if (/\/me$/.test(p)) return json(200, { user_id: '1', username: 'ganka_kuma_', followers_count: 12 });
    if (/\/me\/insights$/.test(p)) return json(200, { data: [{ name: u.searchParams.get('metric'), total_value: { value: 41, breakdowns: [{ results: [{ dimension_values: ['FOLLOWER'], value: 6 }, { dimension_values: ['NON_FOLLOWER'], value: 35 }] }] } }] });
    if (/\/me\/media$/.test(p)) return json(200, { data: [{ id: 'm1', permalink: 'https://www.instagram.com/p/AAA/', timestamp: '2026-11-10T00:00:00+0000', media_type: 'CAROUSEL_ALBUM', like_count: 2, comments_count: 0 }, { id: 'm2', permalink: 'https://www.instagram.com/reel/BBB/', timestamp: '2026-11-12T00:00:00+0000', media_product_type: 'REELS', like_count: 5 }] });
    const m = p.match(/\/(m\d)\/insights$/);
    if (m && /follows/.test(u.searchParams.get('metric'))) return m[1] === 'm2' ? json(400, { error: { message: 'metric not supported' } }) : json(200, { data: [{ name: 'follows', values: [{ value: 1 }] }, { name: 'profile_visits', values: [{ value: 3 }] }] });
    if (m) return json(200, { data: [{ name: 'views', values: [{ value: m[1] === 'm1' ? 6 : 48 }] }, { name: 'reach', values: [{ value: 5 }] }] });
    return json(404, {});
  };
  const req = { method: 'POST', headers: {}, body: { action: 'media' } };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await ig(req, res, { IG_ACCESS_TOKEN: 'tok' });
  const d = JSON.parse(res.body);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(d.followType.metrics.views.nonFollower, 35);
  assert.equal(d.followType.metrics.reach.follower, 6);
  assert.equal(d.media[0].insights.views, 6);
  assert.equal(d.media[0].insights.follows, 1);
  assert.equal(d.media[1].insights.follows, undefined, '取れない指標は作らない');
  assert.match(d.media[1].insights.extraError, /metric not supported/);
  assert.equal(d.media[1].insights.views, 48, '追加の指標が取れなくても、基本の数字は残す');
  // 鍵がなければ取りに行かない
  const res2 = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await ig({ method: 'POST', headers: {}, body: { action: 'media' } }, res2, {});
  assert.equal(JSON.parse(res2.body).ready, false);
});

test('P0：実績の記録。空欄は未取得（null）、同じURLは重複させない、時点は公開からの時間で決める、APIの取り込みは取れた指標だけ、CSVは未取得と書く', () => {
  const { ctx } = loadBrowser(['js/perf-store.js']);
  const P = ctx.PerfStore;
  const posted = new Date(Date.now() - 80 * 3600000).toISOString();
  const a = P.add({ url: 'https://www.instagram.com/p/AAA/?igsh=1', postedAt: posted, format: 'carousel', theme: 'フライパン' });
  assert.equal(a.dup, false);
  assert.equal(P.add({ url: 'https://instagram.com/p/AAA/' }).dup, true, 'URLの書き方が違っても同じ投稿');
  const s = P.addSnapshot(a.post.id, { views: '6', reach: '', nonFollowerPct: '72%', sales: '1,200円' }, 'manual');
  assert.equal(s.metrics.views, 6);
  assert.equal(s.metrics.reach, null, '空欄は未取得');
  assert.equal(s.metrics.nonFollowerPct, 72);
  assert.equal(s.metrics.sales, 1200);
  assert.equal(s.metrics.follows, null);
  assert.equal(s.timing, '72時間後');
  assert.equal(s.source, 'manual');
  const r = P.importApi({ fetchedAt: new Date().toISOString(), account: { followers_count: 12 }, followType: { days: 7, metrics: { views: { total: 41, follower: 6, nonFollower: 35 }, reach: { error: 'x' } } },
    media: [{ id: 'm1', permalink: 'https://www.instagram.com/p/AAA/', timestamp: posted, type: 'CAROUSEL_ALBUM', likes: 2, insights: { views: 7, reach: 5, saved: 1, extraError: 'not supported' } }, { id: 'm2', permalink: 'https://www.instagram.com/reel/BBB/', timestamp: posted, type: 'REELS', caption: '【PR】…\n加湿器', insights: { error: 'x' } }] });
  assert.equal(r.added, 1);
  assert.equal(r.errors, 1);
  const p1 = P.findByUrl('https://www.instagram.com/p/AAA/');
  const last = p1.snapshots[p1.snapshots.length - 1];
  assert.equal(last.source, 'api');
  assert.equal(last.metrics.saves, 1);
  assert.equal(last.metrics.follows, null, 'APIで取れなかった指標は未取得のまま');
  assert.equal(P.latest(p1).nonFollowerPct.value, 72, '手入力の数字も残る');
  assert.equal(P.findByUrl('https://www.instagram.com/reel/BBB/').theme, '加湿器');
  assert.equal(P.accountLog()[0].reach, null);
  assert.match(P.exportCsv(), /未取得/);
  assert.equal(P.exportJson().posts.length, 2);
});

test('C0：画像の客観確認。はみ出し・小さい文字・途中で切れた文字・別の商品の写真・PR表記・権利をコードで見つける。コントラストを計算する', () => {
  const { ctx } = loadBrowser(['js/creative-check.js']);
  const C = ctx.CreativeCheck;
  assert.equal(Math.round(C.contrast([0, 0, 0], [255, 255, 255])), 21);
  assert.equal(JSON.stringify(C.parseColor('#fff')), '[255,255,255]');
  assert.equal(C.parseColor('rgba(0,0,0,0.1)'), null, '薄い色は判断しない');
  const canvas = (ops) => ({ width: 1080, height: 1350, __ops: ops, getContext: () => ({ getImageData: () => { throw new Error('no pixels'); } }) });
  const t = (text, x, size, extra) => ({ t: 'text', text, x, y: 300, size, weight: 700, align: 'left', baseline: 'alphabetic', fill: '#000', width: 400, ...extra });
  const r = C.checkCanvas(canvas([t('はみ出す見出し', 900, 60), t('小さい', 100, 18), t('切れた見出し…', 100, 40), t('端', 10, 40), { t: 'img', tag: 'item:1:b', x: 100, y: 400, w: 500, h: 500 }]), { expectItems: [0] });
  const keys = r.issues.map((x) => x.level + ':' + x.key);
  assert.ok(keys.includes('ng:overflow'), keys.join());
  assert.ok(keys.includes('ng:size'));
  assert.ok(keys.includes('warn:cut'));
  assert.ok(keys.includes('warn:margin'));
  assert.ok(keys.includes('ng:photo'), 'この画像の商品（1番目）の写真がない');
  assert.ok(keys.includes('ng:photo_mismatch'), 'ほかの商品（2番目）の写真が描かれている');
  const ok = C.checkCanvas(canvas([t('見出し', 100, 60), { t: 'img', tag: 'item:0:a', x: 100, y: 400, w: 500, h: 500 }]), { expectItems: [0] });
  assert.equal(ok.issues.filter((x) => x.level === 'ng').length, 0, JSON.stringify(ok.issues));
  // 投稿全体：PR表記と権利
  const post = C.postChecks({ copy: { caption: 'こんにちは' }, noPhoto: false });
  assert.ok(post.some((x) => x.key === 'pr' && x.level === 'ng'));
  assert.ok(post.some((x) => x.key === 'rights' && x.level === 'ng'));
  assert.equal(C.postChecks({ copy: { caption: '【PR】楽天アフィリエイトを利用しています\n本文' }, noPhoto: true }).length, 0);
});

test('バックアップ：room- で始まるデータだけを、そのまま書き出す（データは変えない）', () => {
  const { ctx, store } = loadBrowser([], {});
  store['room-pitch'] = '{"items":{"a":1}}'; store['room-delivery'] = '{"sets":{}}'; store['other'] = 'x';
  const keys = Object.keys(store);
  ctx.localStorage.length = 0;
  Object.defineProperty(ctx.localStorage, 'length', { get: () => Object.keys(store).length });
  ctx.localStorage.key = (i) => Object.keys(store)[i];
  ctx.document = { querySelector: () => ({ src: 'js/backup.js?v=2026-11-14.1' }) };
  vm.runInContext(fs.readFileSync(new URL('../js/backup.js', import.meta.url), 'utf8'), ctx);
  const b = ctx.Backup.collect();
  assert.equal(b.keys, 2);
  assert.equal(b.data['room-pitch'], '{"items":{"a":1}}');
  assert.equal(b.data.other, undefined);
  assert.equal(b.version, '2026-11-14.1');
  assert.deepEqual(Object.keys(store), keys, 'データは変えない');
});
