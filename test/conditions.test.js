import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import discover from '../server/discover.js';
import { parseBudget, fallbackPlan } from '../lib/planner.js';
import { resolveFilterGenre, FILTER_GENRES } from '../lib/genres.js';
import { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', RAKUTEN_ACCESS_KEY: 'key', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(handler, body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

const isPlan = (body) => body.messages[0].content.includes('検索プラン');

function rakutenByPrice(url) {
  const min = Number(url.searchParams.get('minPrice')) || 1000;
  const items = makeItems(20, url.searchParams.get('keyword').split(' ')[0]).map((it, i) => ({ ...it, itemPrice: min + i * 100 }));
  return json(200, { items, pageCount: 3 });
}

const PICKS = { picks: [0, 1, 2].map((id) => ({ id, want: 8, reason: '仕事中も香りが強すぎない。', intro: GOOD_INTRO })) };

test('画面のジャンル選択肢はすべて検索語を持つ', () => {
  assert.equal(FILTER_GENRES.length, 19);
  for (const f of FILTER_GENRES) assert.ok(resolveFilterGenre(f.id).keywords.length >= 4, f.id);
  assert.equal(resolveFilterGenre(''), null);
  assert.equal(resolveFilterGenre('unknown'), null);
});

test('予算の書き方を読み取る', () => {
  assert.deepEqual(parseBudget('30代男性へのプレゼント、1万円以下'), { maxPrice: 10000 });
  assert.deepEqual(parseBudget('5,000円前後'), { minPrice: 3500, maxPrice: 6500 });
  assert.deepEqual(parseBudget('2000〜8000円'), { minPrice: 2000, maxPrice: 8000 });
  assert.deepEqual(parseBudget('北欧っぽい白い食器'), {});
});

test('予備プランでも型に合った枠を作る', () => {
  const plan = fallbackPlan({ genre: resolveFilterGenre('tableware'), type: 'budget_tiers', free: '北欧 来客用' });
  assert.deepEqual(plan.slots.map((s) => s.label), ['低価格', '中価格', '高価格']);
  assert.ok(plan.keywords[0].includes('北欧'));
});

test('ジャンル＋自由入力：AIが条件を読み取り、その検索語・価格帯で探して条件つきで選ぶ', async () => {
  mock = installFetchMock({
    rakuten: rakutenByPrice,
    openai: (body) => isPlan(body)
      ? aiReply({ summary: '30代男性が最初に買う香水。仕事でも使いやすいもの', audience: '30代男性', minPrice: null, maxPrice: 8000, brand: true, keywords: ['メンズ 香水 石鹸', 'オードトワレ メンズ'], slots: [] })
      : aiReply(PICKS)
  });
  const { status, data } = await call(discover, { genre: 'perfume', free: '30代男性、仕事でも使える' });
  assert.equal(status, 200);
  assert.equal(data.condition, '30代男性が最初に買う香水。仕事でも使いやすいもの');
  assert.equal(data.genreId, null); // 条件指定の発掘はジャンル記録に数えない
  // 楽天にはAIが作った検索語と上限価格、1ページ目で問い合わせる
  const q = mock.calls.rakuten[0].url.searchParams;
  assert.equal(q.get('keyword'), 'メンズ 香水 石鹸');
  assert.equal(q.get('maxPrice'), '8000');
  assert.equal(q.get('page'), '1');
  // 選定AIに条件を最優先で渡す
  const select = mock.calls.openai.find((b) => !isPlan(b));
  assert.match(select.messages[1].content, /今回の発掘条件（最優先/);
  assert.match(select.messages[1].content, /ユーザーの言葉: 30代男性、仕事でも使える/);
  assert.ok(data.products.every((p) => p.price <= 8000));
});

test('ジャンルだけ指定：AIの検索プランは使わず、そのジャンルの検索語で探す', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply(PICKS) });
  const { data } = await call(discover, { genre: 'tableware' });
  assert.equal(mock.calls.openai.filter(isPlan).length, 0);
  assert.equal(data.genre, '食器');
  assert.ok(resolveFilterGenre('tableware').keywords.includes(mock.calls.rakuten[0].url.searchParams.get('keyword')));
});

test('ジャンルおまかせ＋自由入力なし：今まで通りの完全ランダム発掘', async () => {
  mock = installFetchMock({ rakuten: rakutenByPrice, openai: () => aiReply(PICKS) });
  const { data } = await call(discover, { genre: '', free: '  ' });
  assert.ok(data.genreId); // ランダムで選ばれたジャンル
  assert.equal(data.condition, '');
  assert.equal(mock.calls.openai.filter(isPlan).length, 0);
});

test('検索プランのAIが失敗しても、予備プランで発掘を続ける', async () => {
  mock = installFetchMock({
    rakuten: rakutenByPrice,
    openai: (body) => isPlan(body) ? aiReply('だめ') : aiReply(PICKS)
  });
  const { status, data } = await call(discover, { free: '旅行が楽になるもの、5000円以下' });
  assert.equal(status, 200);
  assert.equal(mock.calls.rakuten[0].url.searchParams.get('maxPrice'), '5000');
  assert.ok(data.products.length > 0);
});

