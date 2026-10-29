import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import assetsApi from '../server/assets.js';
import { normalizeReel, normalizeStory, REEL_MIN_SEC, REEL_MAX_SEC } from '../lib/assets.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await assetsApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const ITEMS = ['モバイルバッテリー', '手回しラジオ', 'LEDランタン', '非常用トイレ', '保存水', '防災リュック'].map((shortName, i) => ({ name: `${shortName} 商品名`, shortName, price: 1000 + i * 500, role: '実用品' }));

const REEL = {
  title: '防災グッズ、まずコレ', hook: '防災グッズ、何から買えばいい？', cta: '詳しくは投稿にまとめました',
  scenes: [
    { type: 'hook', seconds: 2, text: '防災グッズ、何から買えばいい？', narration: '何から買うか迷いますよね。' },
    { type: 'item', item: 0, seconds: 3, text: '①まず電源', narration: 'まずは電源。' },
    { type: 'item', item: 2, seconds: 3, text: '②停電対策', narration: '明かりも先に。' },
    { type: 'item', item: 2, seconds: 3, text: '重複', narration: '' },
    { type: 'item', item: 9, seconds: 3, text: '存在しない', narration: '' },
    { type: 'item', item: 3, seconds: 9, text: '③ここ忘れがち', narration: '意外と忘れがち。' },
    { type: 'cta', seconds: 3, text: '詳しくは投稿にまとめました', narration: 'プロフィールから見られます。' }
  ]
};
const STORY = { hook: '防災用品、ちゃんと揃ってる？', title: '今回はこの3つで選びました', points: ['電源', '明かり', 'トイレ'], text: '6商品まとめました', sub: '詳しくは最新投稿へ' };

test('Reel：フック2秒 → 商品3〜5個（1つ1〜3秒）→ 呼びかけ、全体10〜20秒に整え、時刻を付ける', () => {
  const reel = normalizeReel(REEL, ITEMS, '防災グッズ');
  assert.deepEqual(reel.scenes.map((s) => s.type), ['hook', 'item', 'item', 'item', 'cta']);
  assert.deepEqual(reel.scenes.filter((s) => s.type === 'item').map((s) => s.item), [0, 2, 3]); // 重複・存在しない商品は外す
  assert.ok(reel.scenes.every((s) => s.type !== 'item' || (s.seconds >= 1 && s.seconds <= 3)));
  assert.ok(reel.seconds >= REEL_MIN_SEC && reel.seconds <= REEL_MAX_SEC, String(reel.seconds));
  assert.equal(reel.scenes[0].start, 0);
  reel.scenes.slice(1).forEach((s, i) => assert.equal(s.start, reel.scenes[i].end));
  assert.equal(reel.scenes[reel.scenes.length - 1].end, reel.seconds);
  assert.match(reel.narration, /何から買うか迷いますよね。\nまずは電源。/);
  // AIが使えなくても、商品3個以上・10秒以上の台本
  const fb = normalizeReel(null, ITEMS, '防災グッズ');
  assert.equal(fb.scenes.filter((s) => s.type === 'item').length, 3);
  assert.ok(fb.seconds >= REEL_MIN_SEC && fb.seconds <= REEL_MAX_SEC);
  assert.match(fb.hook, /防災グッズ/);
  // 商品が多くても5個まで、20秒以内
  const many = normalizeReel({ scenes: ITEMS.map((_, item) => ({ type: 'item', item, seconds: 3, text: 'x' })) }, ITEMS, 't');
  assert.equal(many.scenes.filter((s) => s.type === 'item').length, 5);
  assert.ok(many.seconds <= REEL_MAX_SEC, String(many.seconds));
});

test('Story：3枚分（興味を引く／選び方の基準3つ／投稿へ誘導）', () => {
  const s = normalizeStory(STORY, ITEMS, '防災');
  assert.deepEqual(s.points, ['電源', '明かり', 'トイレ']);
  const fb = normalizeStory(null, ITEMS, '防災');
  assert.equal(fb.text, '6商品まとめました');
  assert.equal(fb.points.length, 3);
});

test('Reel・Story API：カルーセルと同じ商品・基準から、役割を変えて作る（AIが失敗しても作る）', async () => {
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply({ reel: REEL, story: STORY }) });
  const { status, data } = await call({ theme: '防災グッズについて本気出して考えてみた', criteria: ['電源', '明かり', 'トイレ'], items: ITEMS });
  assert.equal(status, 200);
  assert.equal(data.reel.hook, '防災グッズ、何から買えばいい？');
  assert.equal(data.story.sub, '詳しくは最新投稿へ');
  const [system, user] = mock.calls.openai[0].messages.map((m) => m.content);
  assert.match(system, /Reel: 非フォロワーに興味を持ってもらい/);
  assert.match(system, /Story: フォロワーを最新の投稿へ誘導/);
  assert.match(user, /投稿テーマ: 防災グッズ/);
  assert.match(user, /選び方の基準: 電源／明かり／トイレ/);
  assert.match(user, /0: モバイルバッテリー/);
  mock.restore();

  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const fb = (await call({ theme: '防災グッズ', criteria: ['電源', '明かり'], items: ITEMS })).data;
  assert.ok(fb.notice);
  assert.deepEqual(fb.story.points, ['電源', '明かり']);
  assert.ok(fb.reel.scenes.length >= 5);
  assert.equal((await call({ theme: '防災', items: [] })).status, 400);
});
