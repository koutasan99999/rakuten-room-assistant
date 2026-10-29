import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import releaseApi from '../api/release-ideas.js';
import { titleIssues, readReleaseProduct, fallbackReleaseTitles, toReleaseIdea, moodOf, MIN_TITLES, MAX_TITLES } from '../lib/release.js';
import { normalizeIdea } from '../lib/ideas.js';
import { coverStyleFor } from '../lib/covers.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await releaseApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const NOW = new Date('2026-10-28T10:00:00+09:00'); // 水曜日
const RAW = {
  name: '【予約】ノースフェイス ヌプシ ジャケット 2026秋冬', brand: 'THE NORTH FACE', price: 38500, code: 'tnf:nuptse',
  url: 'https://item.rakuten.co.jp/tnf/nuptse/', image: 'https://thumbnail.image.rakuten.co.jp/n.jpg',
  category: 'mens', categoryLabel: 'メンズファッション', status: ['NEW', 'PRE_ORDER'], releaseDate: '2026-10-30'
};

test('titleIssues: 煽りと、確認できていない情報を見つける', () => {
  const p = readReleaseProduct(RAW, NOW);
  assert.deepEqual(titleIssues('このジャケット、予約しておきたい', p), []);
  assert.deepEqual(titleIssues('今週発売のヌプシ、見ておきたい', p), []);
  assert.ok(titleIssues('完売確実のヌプシ', p).length);
  assert.ok(titleIssues('爆売れ中の新作', p).length);
  assert.ok(titleIssues('史上最高の冬アウター', p).length);
  assert.ok(titleIssues('限定カラーのヌプシ', p).length, '限定は確認できていない');
  assert.ok(titleIssues('ついに再販されたヌプシ', p).length, '再販は確認できていない');
  const noPre = readReleaseProduct({ ...RAW, status: ['NEW'], releaseDate: '2026-11-20' }, NOW);
  assert.ok(titleIssues('予約できる新作', noPre).length);
  assert.ok(titleIssues('今週発売のヌプシ', noPre).length);
});

test('readReleaseProduct: 危ない値を落とす', () => {
  const p = readReleaseProduct({ ...RAW, url: 'javascript:alert(1)', releaseDate: 'あした', name: '<b>x</b>' }, NOW);
  assert.equal(p.url, '');
  assert.equal(p.releaseDate, null);
  assert.ok(!/[<>]/.test(p.name));
  assert.equal(p.today, '2026-10-28');
  assert.equal(readReleaseProduct(null), null);
});

test('fallbackReleaseTitles: 3案以上、確認できた情報だけ', () => {
  const p = readReleaseProduct(RAW, NOW);
  const t = fallbackReleaseTitles(p);
  assert.ok(t.length >= MIN_TITLES && t.length <= MAX_TITLES);
  for (const x of t) {
    assert.deepEqual(titleIssues(x.title, p), [], x.title);
    assert.ok(!/本気出して考えてみた/.test(x.title));
    assert.ok(x.title.length <= 24, '表紙に載る短いキャッチコピー: ' + x.title);
  }
  const plain = readReleaseProduct({ ...RAW, brand: '', status: ['NEW'], releaseDate: null }, NOW);
  assert.ok(fallbackReleaseTitles(plain).length >= 2);
});

test('toReleaseIdea: 本気出してシリーズにしない', () => {
  const p = readReleaseProduct(RAW, NOW);
  const idea = toReleaseIdea({ title: 'このジャケット、予約しておきたい', angle: '予約', searchGenres: ['ダウン 新作'], why: '' }, p);
  assert.equal(idea.curationType, 'new_release');
  const n = normalizeIdea(idea);
  assert.ok(!/本気出して考えてみた$/.test(n.title), n.title);
  assert.equal(coverStyleFor({ type: 'new_release', title: n.title, series: true }), 'new_release');
});

test('moodOf: ジャンルで雰囲気を変える', () => {
  assert.equal(moodOf('mens'), 'fashion');
  assert.ok(['gadget', 'fashion', 'living'].includes(moodOf('unknown')));
});

test('api/release-ideas: NGのタイトルを外して3〜5案返す', async () => {
  mock = installFetchMock({
    openai: () => aiReply({ ideas: [
      { title: 'このヌプシ、予約しないと後悔するかも', angle: '予約', searchGenres: ['ダウン 新作'], why: '予約受付中' },
      { title: '完売確実の新作ダウン', angle: '煽り', searchGenres: [], why: '' },
      { title: '冬アウター、最初に見てほしい新作', angle: '季節', searchGenres: ['冬 アウター 新作'], why: '' },
      { title: '限定カラーのヌプシ', angle: '限定', searchGenres: [], why: '' },
      { title: '今年のヌプシ、どこが変わった？', angle: '比較', searchGenres: ['ヌプシ'], why: '' }
    ] })
  });
  const r = await call({ product: RAW });
  assert.equal(r.status, 200);
  const titles = r.data.ideas.map((x) => x.title);
  assert.ok(titles.length >= 3 && titles.length <= 5, titles.join('/'));
  assert.ok(!titles.some((t) => /完売確実|限定/.test(t)), titles.join('/'));
  assert.equal(r.data.ideas[0].idea.curationType, 'new_release');
  assert.equal(r.data.mood, 'fashion');
});

test('api/release-ideas: AIが使えなくても決まった言い回しで返す', async () => {
  mock = installFetchMock({ openai: () => json(500, { error: { message: 'down' } }) });
  const r = await call({ product: RAW });
  assert.equal(r.status, 200);
  assert.ok(r.data.ideas.length >= 3);
  assert.ok(r.data.notice);
});

test('api/release-ideas: 商品がなければ400', async () => {
  const r = await call({});
  assert.equal(r.status, 400);
});

// ---- ブランドのフォロー（ブラウザ用のファイルを、localStorage の代わりを入れて読み込む） ----
function loadBrandFollow(initial) {
  const store = new Map(initial ? [['room-brand-follow', JSON.stringify(initial)]] : []);
  const ctx = { window: {}, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
  vm.runInNewContext(readFileSync(new URL('../js/brand-follow.js', import.meta.url), 'utf8'), ctx);
  const BF = ctx.window.BrandFollow;
  const plain = (f) => (...a) => JSON.parse(JSON.stringify(f(...a))); // 別の実行環境の配列を、ふつうの配列にして比べる
  return { BF: { ...BF, followed: plain(BF.followed), pickForScan: plain(BF.pickForScan) }, store };
}
const GENRES = [
  { id: 'gadget', brands: ['Anker', 'UGREEN', 'CIO'] },
  { id: 'fashion', brands: ['ZARA', 'Anker'] }
];

test('BrandFollow: はじめはすべて選択。外したものだけ外れる', () => {
  const { BF, store } = loadBrandFollow();
  const s = BF.load(GENRES, {});
  assert.deepEqual(BF.followed(GENRES, s), ['Anker', 'UGREEN', 'CIO', 'ZARA']);
  BF.setSelected(s, ['UGREEN'], false);
  assert.deepEqual(BF.followed(GENRES, s), ['Anker', 'CIO', 'ZARA']);
  // 保存した設定が読み直せる
  const again = loadBrandFollow(JSON.parse(store.get('room-brand-follow')));
  assert.deepEqual(again.BF.followed(GENRES, again.BF.load(GENRES, {})), ['Anker', 'CIO', 'ZARA']);
});

test('BrandFollow: あとから追加されたブランドはフォロー。ただしジャンルごと外していれば対象外', () => {
  const { BF } = loadBrandFollow();
  const s = BF.load(GENRES, {});
  BF.setGenreExcluded(s, 'fashion', true);
  const more = [{ id: 'gadget', brands: ['Anker', 'UGREEN', 'CIO', 'Belkin'] }, { id: 'fashion', brands: ['ZARA', 'Anker', 'GU'] }];
  const f = BF.followed(more, s);
  assert.ok(f.includes('Belkin'));
  assert.ok(!f.includes('GU') && !f.includes('ZARA'));
  assert.ok(f.includes('Anker'), '別のジャンルにもあるブランドは残る');
});

test('BrandFollow: 以前の設定を上書きしない', () => {
  const { BF } = loadBrandFollow();
  const s = BF.load(GENRES, { brands: ['Anker', 'Nintendo'], hiddenBrands: ['CIO'] });
  const f = BF.followed(GENRES, s);
  assert.ok(f.includes('Anker') && f.includes('Nintendo'));
  assert.ok(!f.includes('UGREEN') && !f.includes('CIO') && !f.includes('ZARA'));
});

test('BrandFollow: 毎回すべては探さない（確認から12時間以内は飛ばし、古い順に5つまで）', () => {
  const { BF } = loadBrandFollow();
  const many = [{ id: 'g', brands: Array.from({ length: 12 }, (_, i) => 'B' + i) }];
  const s = BF.load(many, {});
  const now = Date.now();
  const first = BF.pickForScan(many, s, now);
  assert.equal(first.length, 5);
  BF.markChecked(s, first, now);
  const second = BF.pickForScan(many, s, now + 1000);
  assert.equal(second.length, 5);
  assert.ok(!second.some((b) => first.includes(b)));
  assert.equal(BF.lastChecked(s, first[0]), now);
  assert.ok(BF.pickForScan(many, s, now + BF.CACHE_MS, 12).some((b) => first.includes(b)), '12時間たてば探し直す');
});
