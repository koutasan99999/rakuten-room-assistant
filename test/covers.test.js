import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import instagram from '../api/instagram.js';
import plansApi from '../api/plans.js';
import { COVER_STYLES, COVER_FOR_TYPE, coverStyleFor, finalizeCover, fallbackCover, priceFrom } from '../lib/covers.js';
import { CURATION_TYPES } from '../lib/themes.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(handler, body, method = 'POST') {
  const req = { method, headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('選び方の型ごとに表紙のシリーズが1つに決まっている（ランダムにしない）', () => {
  assert.deepEqual(Object.keys(COVER_FOR_TYPE).sort(), Object.keys(CURATION_TYPES).sort());
  assert.equal(coverStyleFor({ type: 'first_pick', title: '防災グッズ' }), 'must_buy');
  assert.equal(coverStyleFor({ type: 'premium_budget', title: '白スニーカー' }), 'premium_vs_alternative');
  assert.equal(coverStyleFor({ type: 'value', title: '安いもの' }), 'value_pick');
  assert.equal(coverStyleFor({ type: 'must_buy', title: '防災' }), 'buy_this_first');
  assert.equal(coverStyleFor({ type: 'omakase', title: '何か' }), 'auto');
  // 「本気出して考えてみた」シリーズは、型にかかわらず今までの表紙のまま
  assert.equal(coverStyleFor({ type: 'premium_budget', title: '小皿について本気出して考えてみた' }), 'serious_think');
  assert.equal(coverStyleFor({ type: 'value', title: 'x', series: true }), 'serious_think');
});

test('画面のテンプレート（js/ig-covers.js）とサーバーのシリーズ名・2枚目以降の色がそろっている', () => {
  const src = fs.readFileSync(new URL('../js/ig-covers.js', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/\['([a-z_]+)', '[^']+'\]/g)].map((m) => m[1]);
  assert.deepEqual(ids, Object.keys(COVER_STYLES));
  for (const id of ids.filter((x) => x !== 'serious_think')) {
    assert.match(src, new RegExp(`\\n    ${id}: function \\(ctx, d\\)`), `テンプレート ${id}`);
    assert.match(src, new RegExp(`\\n    ${id}: \\{ cardBg:`), `色 ${id}`);
  }
});

test('表紙の文字：AIの文字を検証し、使えないときはシリーズの決まった言い回しで埋める', () => {
  const ok = finalizeCover('value_pick', { title: '安いけど、\\nこれはアリ', accent: 'アリ', sub: '値段だけでは切れない名品候補' }, 'x');
  assert.deepEqual([ok.style, ok.title, ok.accent], ['value_pick', '安いけど、\nこれはアリ', 'アリ']);
  // 通販広告のような言葉は使わない
  assert.equal(finalizeCover('must_buy', { title: '送料無料で\nまずコレ' }, '防災グッズ').title, '防災グッズ、\nまずコレ');
  // 強調する言葉が見出しに無ければ、シリーズのいつもの言葉
  assert.equal(finalizeCover('must_buy', { title: '香水なら、\nまずコレ', accent: '香水だよ' }, '香水').accent, 'コレ');
  // おまかせは、AIが選んだシリーズ（変なものなら まずコレ）
  assert.equal(finalizeCover('auto', { style: 'gift_select', title: '出産祝いなら\nコレ' }, '出産祝い').style, 'gift_select');
  assert.equal(finalizeCover('auto', { style: 'serious_think', title: 'a' }, 'b').style, 'must_buy');
  assert.deepEqual(finalizeCover('serious_think', null, 'x'), { style: 'serious_think' });
  // 予算で比較は、テーマや価格帯から金額を取り出して目立たせる
  assert.equal(priceFrom('1万円以下'), '10,000');
  const b = fallbackCover('budget_compare', '30代男性への5,000円プレゼント');
  assert.deepEqual([b.price, b.title], ['5,000', '5,000円で探す\n30代男性へのプレゼント']);
  for (const id of Object.keys(COVER_STYLES).filter((x) => x !== 'serious_think')) {
    const fb = fallbackCover(id, '充電グッズ');
    assert.ok(fb.title && fb.sub, id);
    assert.ok(fb.title.split('\n').length <= 2, id);
  }
});

test('Instagram API：表紙のシリーズを渡すと表紙の文字も作る（本気出して〜のときは作らない）', async () => {
  mock = installFetchMock({
    rakuten: () => json(500, {}),
    openai: () => aiReply({ items: [{ id: 0, shortName: 'a', memo: '迷ったらまずこれでいい枠。' }], cover: { title: '防災グッズ、\nまずコレを買え', accent: 'コレ', sub: '最初の1セットはここから' } })
  });
  const items = [{ name: '防災リュック', price: 9800 }];
  const { data } = await call(instagram, { theme: '防災グッズ', coverStyle: 'must_buy', items });
  assert.deepEqual([data.cover.style, data.cover.title, data.cover.accent], ['must_buy', '防災グッズ、\nまずコレを買え', 'コレ']);
  assert.match(mock.calls.openai[0].messages[0].content, /まずコレ（アイボリー × マスタード）/);
  mock.restore();

  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply({ items: [{ id: 0, shortName: 'a' }] }) });
  const s = (await call(instagram, { theme: '小皿', items })).data;
  assert.deepEqual(s.cover, { style: 'serious_think' });
  assert.doesNotMatch(mock.calls.openai[0].messages[0].content, /表紙）に載せる文字/);
  mock.restore();

  // AIが失敗しても、シリーズの決まった言い回しで表紙を作れる
  mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply('だめ') });
  const fb = (await call(instagram, { theme: '白スニーカー', coverStyle: 'premium_vs_alternative', items })).data;
  assert.equal(fb.cover.title, '白スニーカーの\n本命と代替品');
});

test('選び方の型の一覧に、表紙の見本（シリーズと大見出し）が付く', async () => {
  const { data } = await call(plansApi, undefined, 'GET');
  const t = Object.fromEntries(data.types.map((x) => [x.id, x.cover]));
  assert.equal(t.first_pick.style, 'must_buy');
  assert.equal(t.omakase.style, 'serious_think');
  assert.ok(data.types.every((x) => x.cover.style !== 'serious_think' ? x.cover.title : true));
});
