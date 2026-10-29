import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import api from '../server/room-hashtags.js';
import { generateRoomHashtags } from '../lib/room-hashtags.js';
import { allowTag, themeGenres } from '../lib/tag-rules.js';
import { buildHashtags } from '../lib/hashtags.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await api(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const BOUSAI = { campaignTheme: '防災なら、これだけ揃えとけ', campaignType: '買っとけ', targetAudience: '防災用品をまだ揃えていない家族' };
const ITEMS = [
  { productName: 'Anker モバイルバッテリー 10000mAh', roomDescription: '停電時のスマホ充電用として持っておきたい。', productUseCase: '本命', brand: 'Anker' },
  { productName: 'イワタニ カセットコンロ', productCategory: 'キッチン用品', roomDescription: '停電でも温かいものが作れる。', productUseCase: '実用品' },
  { productName: '非常用トイレ 50回分', roomDescription: '断水したときに困らないように。', productUseCase: '忘れがち' }
];

test('タグの判断：企画のテーマ・購入目的を優先し、カテゴリ名や広すぎるタグは文脈にあるときだけ', () => {
  const g = themeGenres('防災なら、これだけ揃えとけ');
  assert.deepEqual(g, ['disaster']);
  assert.equal(allowTag('#防災グッズ', { score: 0, genreIds: g }), true); // 企画のテーマのタグ
  assert.equal(allowTag('#キッチン用品', { score: 95, genreIds: g, context: '停電でも温かいものが作れる' }), false); // カテゴリ名だけ
  assert.equal(allowTag('#プチプラ', { score: 95, genreIds: g, context: '停電対策' }), false);
  assert.equal(allowTag('#プチプラ', { score: 92, genreIds: g, context: 'プチプラで揃えられる' }), true); // 本当にその意味があるとき
  assert.equal(allowTag('#旅行グッズ', { score: 90, genreIds: g, context: '停電時のスマホ充電用' }), false); // 紹介文にない目的
  assert.equal(allowTag('#非常用電源', { score: 75, genreIds: g }), true);
  assert.equal(allowTag('#スマホグッズ', { score: 65, genreIds: g }), false); // 70点未満は使わない
});

test('ROOM用ハッシュタグ：企画の共通タグ＋商品ごとの具体タグ（2〜4個）で5〜10個、関係の薄いタグは入れない', async () => {
  mock = installFetchMock({
    rakuten: () => json(500, {}),
    openai: () => aiReply({
      common: [{ tag: '#防災', score: 98 }, { tag: '#防災グッズ', score: 96 }, { tag: '#災害対策', score: 92 }, { tag: '#防災準備', score: 88 }, { tag: '#おすすめ', score: 60 }],
      items: [
        { id: 0, tags: [{ tag: '#停電対策', score: 94 }, { tag: '#モバイルバッテリー', score: 90 }, { tag: '#非常用電源', score: 84 }, { tag: '#ガジェット好き', score: 72 }, { tag: '#旅行グッズ', score: 71 }] },
        { id: 1, tags: [{ tag: '#カセットコンロ', score: 90 }, { tag: '#キッチン用品', score: 78 }, { tag: '#プチプラ', score: 55 }] },
        { id: 2, tags: [{ tag: '#非常用トイレ', score: 95 }, { tag: '#簡易トイレ', score: 90 }, { tag: '#断水対策', score: 82 }] }
      ]
    })
  });
  const { status, data } = await call({ ...BOUSAI, items: ITEMS });
  assert.equal(status, 200);
  assert.deepEqual(data.common, ['#防災', '#防災グッズ', '#災害対策', '#防災準備']);
  assert.deepEqual(data.products[0].tags, ['#防災', '#防災グッズ', '#災害対策', '#防災準備', '#停電対策', '#モバイルバッテリー', '#非常用電源']);
  assert.deepEqual(data.products[1].tags.slice(4), ['#カセットコンロ']); // #キッチン用品 #プチプラ は付けない
  assert.deepEqual(data.products[2].tags.slice(4), ['#非常用トイレ', '#簡易トイレ', '#断水対策']);
  for (const p of data.products) assert.ok(p.tags.length <= 10);
  const [system, user] = mock.calls.openai[0].messages.map((m) => m.content);
  assert.match(system, /今回なぜ紹介しているのか/);
  assert.match(user, /企画のテーマ: 防災なら/);
  assert.match(user, /ROOM紹介文: 停電時のスマホ充電用/);
  assert.equal((await call({ campaignTheme: '', items: ITEMS })).status, 400);
});

test('AIが使えなくても、企画のテーマと商品の用途から作る（出産祝いのベビー食器に #キッチン用品 は付かない）', async () => {
  const r = await generateRoomHashtags({ campaign: BOUSAI, items: ITEMS, env: {}, deadline: Date.now() });
  assert.ok(r.fallback);
  assert.ok(r.products[0].tags.includes('#停電対策') && r.products[0].tags.includes('#モバイルバッテリー') && r.products[0].tags.includes('#Anker'));
  assert.ok(r.products[2].tags.includes('#非常用トイレ'));
  assert.ok(r.products.every((p) => p.tags.includes('#防災') && !p.tags.includes('#キッチン用品')));
  const baby = await generateRoomHashtags({
    campaign: { campaignTheme: '出産祝いについて本気出して考えてみた' },
    items: [{ productName: 'ベビー食器セット', roomDescription: '離乳食が始まったら毎日使える' }], env: {}, deadline: Date.now()
  });
  assert.ok(baby.products[0].tags.includes('#出産祝い') && baby.products[0].tags.includes('#ベビー食器'));
  assert.ok(!baby.products[0].tags.some((t) => /キッチン|食器好き|おうちごはん/.test(t)));
});

test('Instagramのハッシュタグも、企画のテーマを優先（カテゴリが「キッチン」でも防災なら防災のタグ）', () => {
  const tags = buildHashtags({ topic: '防災なら、これだけ揃えとけ', category: 'キッチン', aiTags: ['#キッチン用品', '#プチプラ', '#停電対策', '#防災備蓄'] });
  assert.ok(tags.includes('#防災') && tags.includes('#防災備蓄'));
  assert.ok(!tags.includes('#キッチン用品') && !tags.includes('#プチプラ') && !tags.includes('#北欧食器'));
});
