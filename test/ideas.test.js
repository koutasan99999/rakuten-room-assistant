import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, POST_TYPES, sampleIdeaSeeds } from '../lib/catalog.js';
import { normalizeIdea, fallbackIdea, MUST_BUY_SUBTITLES } from '../lib/ideas.js';
import { briefFromIdea } from '../lib/explore.js';
import { buildHashtags } from '../lib/hashtags.js';
import ideasApi from '../server/ideas.js';
import instagram from '../server/instagram.js';
import { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(handler, body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

// 再現できる乱数（mulberry32）
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('企画データベース：12ジャンル・21の投稿の型（防災グッズ・便利グッズ・まずこれ買っとけ）', () => {
  assert.equal(CATALOG.length, 12);
  assert.equal(POST_TYPES.length, 21);
  assert.ok(CATALOG.find((c) => c.id === 'disaster').note.includes('煽'));
  assert.ok(POST_TYPES.find((t) => t.name === 'まずこれ買っとけ'));
  assert.ok(CATALOG.find((c) => c.name === '香り・美容').brands.includes('Aesop'));
});

test('3案はジャンルも型もかぶらず、直近の履歴にあるものは選ばれにくい', () => {
  for (let i = 1; i <= 50; i++) {
    const seeds = sampleIdeaSeeds([], 3, seededRandom(i));
    assert.equal(new Set(seeds.map((s) => s.genre.id)).size, 3);
    assert.equal(new Set(seeds.map((s) => s.type.id)).size, 3);
  }
  // 直近10投稿で「食器・キッチン」「本命＋安い代替」ばかりだった場合
  const history = Array.from({ length: 10 }, () => ({ genre: '食器・キッチン', postType: '本命＋安い代替' }));
  let kitchen = 0, premium = 0;
  for (let i = 1; i <= 300; i++) {
    const seeds = sampleIdeaSeeds(history, 3, seededRandom(i));
    if (seeds.some((s) => s.genre.id === 'kitchen')) kitchen++;
    if (seeds.some((s) => s.type.id === 'premium_alt')) premium++;
  }
  assert.ok(kitchen < 300 * 0.1, `kitchen ${kitchen}`);
  assert.ok(premium < 300 * 0.05, `premium ${premium}`);
});

test('企画の検証：シリーズ名を付け、型からまとめの型を決め、壊れた枠は落とす', () => {
  const idea = normalizeIdea({
    topic: 'タンブラーについて本気出して考えてみた', postType: '本命＋安い代替', genre: '旅行・アウトドア',
    slots: [{ label: '本命', keyword: 'STANLEY タンブラー', minPrice: 9000, maxPrice: 3000 }, { label: '代替', keyword: 'タンブラー' }, { label: '別解', keyword: '水筒' }, { label: '', keyword: 'x' }]
  });
  assert.equal(idea.topic, 'タンブラー');
  assert.equal(idea.title, 'タンブラーについて本気出して考えてみた');
  assert.equal(idea.curationType, 'premium_budget');
  assert.equal(idea.slots.length, 3);
  assert.deepEqual([idea.slots[0].minPrice, idea.slots[0].maxPrice], [3000, 9000]); // 逆なら入れ替える
  assert.equal(normalizeIdea({ topic: 'x', postType: '存在しない型', genre: '食器・キッチン', slots: [] }), null);
});

test('ユーザーが編集した企画：タイトル・型・ジャンルを自由に変えられ、元の検索語は使わない', () => {
  const idea = normalizeIdea({
    edited: true, title: '30代男性に5,000円で贈るなら何がいいか', curationType: 'gift', postType: 'プレゼント',
    target: '30代男性の友人', priceBand: '4,000〜6,000円', genre: 'メンズ小物', axis: '', free: '名入れはしない', slots: [{ label: 'a', keyword: '古い検索語' }]
  });
  assert.equal(idea.title, '30代男性に5,000円で贈るなら何がいいかについて本気出して考えてみた');
  assert.equal(idea.topic, '30代男性に5,000円で贈るなら何がいいか');
  assert.equal(idea.curationType, 'gift');
  assert.equal(idea.genre, 'メンズ小物');
  const brief = briefFromIdea(idea);
  assert.deepEqual(brief.hints, []);
  assert.equal(brief.free, '名入れはしない');
  assert.deepEqual([brief.minPrice, brief.maxPrice], [4000, 6000]);
  // 「本気出して考えてみた」で終わるタイトルはそのまま
  assert.equal(normalizeIdea({ edited: true, title: '何がいいか本気出して考えてみた' }).title, '何がいいか本気出して考えてみた');
  assert.equal(normalizeIdea({ edited: true, title: '' }), null);
});

test('予備の企画も6枠そろう', () => {
  for (let i = 1; i <= 20; i++) {
    for (const seed of sampleIdeaSeeds([], 3, seededRandom(i))) {
      const idea = fallbackIdea(seed);
      assert.ok(idea, `${seed.genre.id} ${seed.type.id}`);
      assert.equal(idea.slots.length, 6);
    }
  }
});

test('今日の企画API：3案を返し、直近の履歴と季節をAIに渡す。AIが失敗しても3案', async () => {
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const { status, data } = await call(ideasApi, { history: [{ topic: '出産祝い', genre: 'ベビー・出産祝い', postType: 'プレゼントならコレ', brands: ['MARLMARL'] }] });
  assert.equal(status, 200);
  assert.equal(data.ideas.length, 3);
  assert.ok(data.notice);
  const user = mock.calls.openai[0].messages[1].content;
  assert.match(user, /直近の投稿/);
  assert.match(user, /出産祝い｜ジャンル:ベビー・出産祝い/);
  assert.match(user, /今の季節: \d+月/);
});

const ROOM_BLOCK = '紹介したものは楽天ROOMにまとめています。\nプロフィールのリンクから見られます。\n\nhttps://room.rakuten.co.jp/room_d45e2c7b29/items\n\n※楽天アフィリエイトを利用しています。';

function tagsOf(caption) {
  const last = caption.trim().split('\n').pop();
  return last.split(' ');
}

test('キャプション：本文→ROOM誘導→URL→アフィリエイト表記→ハッシュタグの順で必ず付ける', async () => {
  mock = installFetchMock({
    rakuten: () => json(500, {}),
    openai: () => aiReply({
      items: [{ id: 0, shortName: 'a', memo: '迷ったらまずこれでいい枠。' }],
      caption: '本文です。\n\n保存しておいてください。\n\n紹介したものはプロフィールの楽天ROOMにまとめています。\nhttps://example.com\n#眼科医くま #出産祝い\n\n#PR 広告',
      hashtags: ['#出産祝いギフト', 'ベビーギフト', '#出産 祝い', '#a/b', '#名入れギフト']
    })
  });
  const { data } = await call(instagram, { theme: '出産祝い', category: '出産祝い', needCaption: true, items: [{ name: '商品A', price: 1000, memo: 'ブランド込みで贈るならこっち。' }] });
  const c = data.caption;
  assert.match(c, /^本文です。\n\n保存しておいてください。\n\n紹介したものは楽天ROOMにまとめています。/);
  assert.ok(c.includes(ROOM_BLOCK + '\n\n#'), c);
  assert.equal((c.match(/room\.rakuten\.co\.jp/g) || []).length, 1);
  assert.ok(!c.includes('example.com') && !c.includes('#PR'));
  const tags = tagsOf(c);
  assert.ok(tags.length >= 15 && tags.length <= 25, String(tags.length));
  assert.equal(new Set(tags).size, tags.length);
  assert.ok(tags.every((t) => /^#[^#\s]+$/.test(t)), tags.join(' '));
  assert.ok(!tags.includes('#a/b'));
  for (const t of ['#楽天ROOM', '#名入れギフト', '#出産祝い', '#ベビーギフト', '#出産祝いギフト', '#プレゼント迷子', '#ganka_kuma', '#眼科医くま']) assert.ok(tags.includes(t), t);
  assert.ok(!tags.includes('#防災'));
  assert.equal(data.items[0].memo, 'ブランド込みで贈るならこっち。'); // まとめで作った一言メモを優先
  // AIが失敗しても、予備の本文＋ROOM誘導・URL・表記・ハッシュタグ
  mock.restore();
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const fb = (await call(instagram, { theme: '出産祝い', needCaption: true, collection: '出産祝い｜本気出して考えてみた', items: [{ name: '商品A', price: 1000 }] })).data;
  assert.ok(fb.caption.includes('紹介したものは楽天ROOMの「出産祝い｜本気出して考えてみた」にまとめています。\nプロフィールのリンクから見られます。\n\nhttps://room.rakuten.co.jp/room_d45e2c7b29/items\n\n※楽天アフィリエイトを利用しています。'));
  assert.ok(tagsOf(fb.caption).length >= 15);
});

test('ハッシュタグ：テーマごとに中身が変わり、15〜25個・アカウントのタグ入り', () => {
  const bousai = buildHashtags({ topic: '防災グッズ、まずこれ買っとけ', genre: '防災グッズ', postType: 'まずこれ買っとけ', aiTags: ['#停電対策', '#防災備蓄'] });
  const kosui = buildHashtags({ topic: '香水初心者の最初の3本', genre: '香り・美容' });
  for (const tags of [bousai, kosui, buildHashtags({ topic: 'なにか' })]) {
    assert.ok(tags.length >= 15 && tags.length <= 25, tags.join(' '));
    assert.equal(new Set(tags).size, tags.length);
    assert.ok(tags.includes('#ganka_kuma') && tags.includes('#眼科医くま'));
  }
  for (const t of ['#防災', '#防災グッズ', '#防災リュック', '#備蓄', '#まずこれ', '#何を買えばいい', '#防災備蓄', '#災害対策', '#防災準備']) assert.ok(bousai.includes(t), t);
  // 防災は「便利グッズ」ではなく防災で探す人に向けたタグ（#便利グッズ #生活便利グッズ は付けない）
  assert.ok(!bousai.includes('#便利グッズ') && !bousai.includes('#生活便利グッズ'));
  for (const t of ['#香水', '#香水初心者', '#フレグランス', '#香水選び']) assert.ok(kosui.includes(t), t);
  assert.ok(!kosui.includes('#防災') && !kosui.includes('#便利グッズ'));
  // AIのタグが多すぎても25個まで、アカウントのタグは残る
  const many = buildHashtags({ topic: '防災', aiTags: Array.from({ length: 30 }, (_, i) => `#タグ${i}`) });
  assert.ok(many.length <= 25 && many.includes('#眼科医くま'));
});

test('「まずこれ買っとけ」型の予備企画は、表紙サブタイトルを3種類から選ぶ', () => {
  const seed = { genre: CATALOG.find((c) => c.id === 'disaster'), type: POST_TYPES.find((t) => t.id === 'must_buy'), items: ['最低限これだけの防災グッズ'] };
  const idea = fallbackIdea(seed);
  assert.ok(MUST_BUY_SUBTITLES.some((x) => idea.subtitle === `― ${x} ―`), idea.subtitle);
  assert.match(briefFromIdea(idea).note, /煽/);
});

test('キャプションのROOM誘導に、コレクション名を入れるよう伝える（予備の文にも入る）', async () => {
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const { data } = await call(instagram, { theme: '出産祝い', needCaption: true, collection: '出産祝い｜本気出して考えてみた', items: [{ name: '商品A', price: 1000 }] });
  assert.match(mock.calls.openai[0].messages[1].content, /ROOMのコレクション名: 出産祝い｜本気出して考えてみた/);
  assert.match(data.caption, /楽天ROOMの「出産祝い｜本気出して考えてみた」にまとめています/);
});
