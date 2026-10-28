import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, POST_TYPES, sampleIdeaSeeds } from '../lib/catalog.js';
import { normalizeIdea, fallbackIdea, ideaToTheme } from '../lib/ideas.js';
import ideasApi from '../api/ideas.js';
import curate from '../api/curate.js';
import instagram from '../api/instagram.js';
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

test('企画データベース：10ジャンル・20の投稿の型', () => {
  assert.equal(CATALOG.length, 10);
  assert.equal(POST_TYPES.length, 20);
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

test('選んだ企画で商品を探す：企画の枠で検索し、ブランドと一言メモを返す', async () => {
  const idea = fallbackIdea(sampleIdeaSeeds([], 1, seededRandom(3))[0]);
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword').replace(/\s/g, '').slice(0, 6) + (url.searchParams.get('minPrice') || '') + (url.searchParams.get('maxPrice') || '');
      return json(200, { items: makeItems(5, kw).map((it, i) => ({ ...it, itemPrice: (Number(url.searchParams.get('minPrice')) || 500) + i * 10, shopName: `${kw}店${i}` })), pageCount: 1 });
    },
    openai: () => aiReply({
      title: 't', lead: 'l', verdict: 'v',
      items: [0, 5, 10].map((id, i) => ({ id, role: idea.slots[i].label, brand: ['STANLEY', '', 'THERMOS'][i], memo: i === 1 ? 'おすすめです。快適な暮らしをサポート。' : '迷ったらまずこれでいい枠。', pick: '選ぶ理由', why: 'w', intro: GOOD_INTRO }))
    })
  });
  const { data } = await call(curate, { idea });
  assert.equal(data.idea.topic, idea.topic);
  assert.equal(mock.calls.rakuten.length, idea.slots.length);
  assert.equal(data.products[0].brand, 'STANLEY');
  assert.equal(data.products[0].memo, '迷ったらまずこれでいい枠。');
  assert.equal(data.products[1].memo, ''); // NG表現の一言メモは使わない
  assert.ok(mock.calls.openai[0].messages[0].content.includes('くまの一言メモ'));
});

test('キャプション：AIの文に広告・アフィリエイト表記を必ず付け、AIが付けた#PRは重ねない', async () => {
  mock = installFetchMock({
    rakuten: () => json(500, {}),
    openai: () => aiReply({ items: [{ id: 0, shortName: 'a', memo: '迷ったらまずこれでいい枠。' }], caption: '本文です。\n\n#眼科医くま\n\n#PR 広告' })
  });
  const { data } = await call(instagram, { theme: '出産祝い', needCaption: true, items: [{ name: '商品A', price: 1000, memo: 'ブランド込みで贈るならこっち。' }] });
  assert.match(data.caption, /^本文です。/);
  assert.equal((data.caption.match(/#PR/g) || []).length, 1);
  assert.match(data.caption, /アフィリエイトリンクが含まれます。$/);
  assert.equal(data.items[0].memo, 'ブランド込みで贈るならこっち。'); // まとめで作った一言メモを優先
  // AIが失敗しても、予備のキャプション＋表記
  mock.restore();
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const fb = (await call(instagram, { theme: '出産祝い', needCaption: true, items: [{ name: '商品A', price: 1000 }] })).data;
  assert.match(fb.caption, /楽天ROOM/);
  assert.match(fb.caption, /#PR/);
});

test('企画→まとめのテーマ変換', () => {
  const idea = fallbackIdea(sampleIdeaSeeds([], 1, seededRandom(7))[0]);
  const theme = ideaToTheme(idea);
  assert.equal(theme.id, 'idea');
  assert.equal(theme.slots.length, 6);
  assert.match(theme.request, /誰ならこれを選ぶべきか/);
});

test('キャプションのROOM誘導に、コレクション名を入れるよう伝える（予備の文にも入る）', async () => {
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const { data } = await call(instagram, { theme: '出産祝い', needCaption: true, collection: '出産祝い｜本気出して考えてみた', items: [{ name: '商品A', price: 1000 }] });
  assert.match(mock.calls.openai[0].messages[1].content, /ROOMのコレクション名: 出産祝い｜本気出して考えてみた/);
  assert.match(data.caption, /楽天ROOMの「出産祝い｜本気出して考えてみた」にまとめています/);
});
