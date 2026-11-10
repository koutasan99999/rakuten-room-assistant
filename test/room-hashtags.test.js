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

test('ROOM用ハッシュタグ：企画の共通タグ＋商品ごとの具体タグ＋商品のデータからのタグで最大20個、関係の薄いタグは入れない', async () => {
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
  assert.deepEqual(data.products[0].tags.slice(0, 7), ['#防災', '#防災グッズ', '#災害対策', '#防災準備', '#停電対策', '#モバイルバッテリー', '#非常用電源']);
  assert.ok(data.products[0].tags.includes('#Anker'), '商品名にあるブランドは商品のデータから足す');
  assert.ok(data.products[1].tags.includes('#カセットコンロ'));
  assert.ok(!data.products[1].tags.some((t) => ['#キッチン用品', '#プチプラ', '#ガジェット好き'].includes(t)), data.products[1].tags.join()); // 関係の薄いタグは付けない
  assert.ok(['#非常用トイレ', '#簡易トイレ', '#断水対策'].every((t) => data.products[2].tags.includes(t)));
  assert.ok(!data.products[0].tags.includes('#旅行グッズ'));
  for (const p of data.products) assert.equal(new Set(p.tags).size, p.tags.length);
  for (const p of data.products) assert.ok(p.tags.length <= 20);
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

import pitchApi from '../server/pitch.js';
import { productTags, confirmedInName } from '../lib/room-hashtags.js';
async function pitch(body, env = ENV) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await pitchApi(req, res, env);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('商品のデータだけから作るタグ：商品固有・用途・ジャンルを組み合わせ、商品名にないブランド・特徴は付けない', () => {
  const mug = productTags({ name: 'マグカップ 陶器 日本製', feature: '父の日のプレゼントに', target: '30代の男性', theme: '' });
  assert.deepEqual(mug.slice(0, 5), ['#マグカップ', '#日本製', '#プレゼント選び', '#父の日ギフト', '#メンズギフト']);
  assert.ok(mug.includes('#キッチン雑貨'));
  const lantern = productTags({ name: 'オイルランタン ブラック', feature: 'キャンプの夜に', brand: 'コールマン' });
  assert.ok(lantern.includes('#ランタン') && lantern.includes('#キャンプ用品'));
  assert.ok(!lantern.includes('#コールマン'), '商品名にないブランドは付けない');
  assert.ok(!lantern.some((t) => /本革|真鍮|日本製/.test(t)), '商品名にない特徴は付けない');
  assert.ok(productTags({ name: 'Anker モバイルバッテリー', brand: 'Anker' }).includes('#Anker'));
  // 白いマグに #白スニーカー は付けない（前の予備の決まりの取り違え）
  assert.ok(!productTags({ name: 'マグカップ ホワイト' }).includes('#白スニーカー'));
  // 何の商品か分からなければ、無理に作らない
  assert.deepEqual(productTags({ name: '謎の商品 ABC-123' }), []);
  for (const t of [mug, lantern]) { assert.ok(t.length <= 20); assert.equal(new Set(t).size, t.length); }
  assert.equal(confirmedInName('#Anker', 'Anker 充電器'), true);
  assert.equal(confirmedInName('#Coleman', 'オイルランタン'), false);
});

test('AIのタグが少ないときは商品のデータから補い、商品名にない英字のブランドはAIが出しても付けない', async () => {
  mock = installFetchMock({
    rakuten: () => json(500, {}),
    openai: () => aiReply({ common: [{ tag: '#休日', score: 80 }], items: [{ id: 0, tags: [{ tag: '#Coleman', score: 95 }, { tag: '#モバイルバッテリー', score: 90 }, { tag: '#ランタンのある暮らし', score: 85 }] }] })
  });
  const r = await generateRoomHashtags({ campaign: { campaignTheme: '休日の小物' }, items: [{ productName: 'オイルランタン ブラック 真鍮', roomDescription: 'キャンプの夜に' }], env: ENV, deadline: Date.now() + 20000 });
  const tags = r.products[0].tags;
  assert.ok(!tags.includes('#Coleman') && !tags.includes('#モバイルバッテリー'), '商品名にないブランド・商品の種類は付けない');
  assert.ok(tags.includes('#ランタン') && tags.includes('#真鍮') && tags.includes('#キャンプ用品'), tags.join());
  assert.ok(tags.length >= 5 && tags.length <= 20, tags.join());
  // AIが企画のタグしか出さなくても、商品の種類のタグを入れる
  mock.restore();
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply({ common: ['#プレゼント', '#ギフト', '#プレゼント選び', '#誕生日プレゼント', '#プチギフト'].map((tag) => ({ tag, score: 90 })), items: [{ id: 0, tags: [] }] }) });
  const g = await generateRoomHashtags({ campaign: { campaignTheme: 'ギフト' }, items: [{ productName: 'ステンレス タンブラー 真空断熱' }], env: ENV, deadline: Date.now() + 20000 });
  assert.ok(g.products[0].tags.includes('#タンブラー') && g.products[0].tags.length <= 20, g.products[0].tags.join());
});

test('AIが使えなくても、テーマのジャンルに当たらない企画でもタグが空にならない（関係の高いものだけ）', async () => {
  const r = await generateRoomHashtags({ campaign: { campaignTheme: '休日の小物' }, items: [{ productName: 'ステンレス タンブラー 真空断熱', roomDescription: '通勤のお供に' }, { productName: '謎の商品 ABC' }], env: {}, deadline: Date.now() });
  assert.ok(r.fallback);
  assert.ok(r.products[0].tags.includes('#タンブラー') && r.products[0].tags.includes('#通勤スタイル'), r.products[0].tags.join());
  assert.deepEqual(r.products[1].tags, []);
});

test('API：tags（AIなし）はAIを呼ばずにタグを返し、intro は紹介文と一緒にタグも返す', async () => {
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply({ intros: [{ id: 0, intro: '紹介文です' }] }) });
  const t = await pitch({ action: 'tags', item: { name: '折りたたみ傘 軽量', feature: '梅雨の通勤に' }, set: { title: '雨の日を楽にする' } });
  assert.equal(t.status, 200);
  assert.ok(t.data.tags.includes('#折りたたみ傘') && t.data.tags.includes('#雨の日対策'), t.data.tags.join());
  assert.equal((mock.calls.openai || []).length, 0, 'AIを呼ばない');
  const i = await pitch({ action: 'intro', product: { name: 'コーヒードリッパー 陶器 日本製', fit: 'ギフトにも' } });
  assert.equal(i.status, 200);
  assert.ok(Array.isArray(i.data.tags) && i.data.tags.includes('#コーヒードリッパー') && i.data.tags.includes('#日本製'), JSON.stringify(i.data));
  mock.restore();
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => json(500, { error: { message: 'down' } }) });
  const a = await pitch({ action: 'tagsai', item: { name: '折りたたみ傘 軽量' }, set: { title: '雨の日' } });
  assert.equal(a.status, 200);
  assert.ok(a.data.tags.includes('#折りたたみ傘') && !a.data.tags.includes('#傘'), a.data.tags.join());
  assert.match(a.data.notice, /商品名・特徴から/);
});
