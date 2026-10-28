import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SERIES_PLANS, planToTheme } from '../lib/plans.js';
import { CURATION_TYPES } from '../lib/themes.js';
import curate from '../api/curate.js';
import plansApi from '../api/plans.js';
import { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

async function call(handler, { method = 'POST', body } = {}) {
  const req = { method, headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await handler(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('最初の10投稿：番号順・6枠ずつ・型と価格帯が正しい', () => {
  assert.equal(SERIES_PLANS.length, 10);
  assert.deepEqual(SERIES_PLANS.map((p) => p.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(SERIES_PLANS.map((p) => p.id)).size, 10);
  for (const p of SERIES_PLANS) {
    assert.ok(CURATION_TYPES[p.type], p.id);
    assert.equal(p.slots.length, 6, p.id);
    for (const s of p.slots) {
      assert.ok(s.label && s.keyword, p.id);
      if (s.minPrice && s.maxPrice) assert.ok(s.minPrice < s.maxPrice, `${p.id} ${s.label}`);
    }
  }
  assert.equal(SERIES_PLANS[0].topic, '出産祝い');
  assert.ok(SERIES_PLANS.find((p) => p.no === 6).slots.every((s) => s.maxPrice <= 1500)); // 1,500円以下
  assert.ok(SERIES_PLANS.find((p) => p.no === 10).slots.every((s) => s.maxPrice <= 10000)); // 1万円以下
});

test('投稿タイプが2回続けて同じにならない（ローテーション）', () => {
  for (let i = 1; i < SERIES_PLANS.length; i++) {
    assert.notEqual(SERIES_PLANS[i].postType, SERIES_PLANS[i - 1].postType, `${i}と${i + 1}`);
  }
});

test('企画の一覧API', async () => {
  const { status, data } = await call(plansApi, { method: 'GET' });
  assert.equal(status, 200);
  assert.equal(data.plans.length, 10);
  assert.deepEqual(data.plans[1].roles, ['ブランド込みの本命', '本命より少し手頃', 'コスパ代替', '普段使い向け', 'ギフト向け', '迷ったらこれ']);
  assert.equal(data.plans[1].subtitle, '― 高い本命と安い代替 ―');
});

test('企画で作ると、6枠で探し、役割・目的・「なぜ／誰なら」をAIに渡し、企画情報を返す', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword').replace(/\s/g, '').slice(0, 8);
      const min = Number(url.searchParams.get('minPrice')) || 500;
      return json(200, { items: makeItems(5, kw).map((it, i) => ({ ...it, itemPrice: min + i * 100, shopName: `${kw}店${i}` })), pageCount: 1 });
    },
    openai: () => aiReply({
      title: '出産祝い、迷ったらこの順', lead: '説明', verdict: '迷ったらタオル。',
      items: [0, 5, 10, 15, 20, 25].map((id, i) => ({ id, role: ['迷ったらこれ', '実用性重視', 'もらうと嬉しい', 'センス重視', '価格を抑えるなら', '少し奮発するなら'][i], pick: '外しにくい実用品', forWho: '初めて贈る人に', why: '理由', intro: GOOD_INTRO }))
    })
  });
  const { status, data } = await call(curate, { body: { planId: 'plan01_shussan' } });
  assert.equal(status, 200);
  assert.equal(mock.calls.rakuten.length, 6);
  assert.equal(data.plan.no, 1);
  assert.equal(data.plan.topic, '出産祝い');
  assert.equal(data.products.length, 6);
  assert.equal(data.products[0].pick, '外しにくい実用品');
  const [system, user] = mock.calls.openai[0].messages.map((m) => m.content);
  assert.ok(system.includes('"pick"'));
  assert.match(user, /企画1「出産祝いについて本気出して考えてみた」/);
  assert.match(user, /誰ならこれを選ぶべきか/);
});

test('企画のテーマ変換：サブタイトル・ルールを引き継ぐ', () => {
  const t = planToTheme(SERIES_PLANS.find((p) => p.no === 7));
  assert.equal(t.type, 'premium_budget');
  assert.equal(t.plan.subtitle, '― 高い本命と安い代替 ―');
  assert.match(t.request, /最大出力・ポート数・サイズ・ブランド信頼度・価格/);
});
