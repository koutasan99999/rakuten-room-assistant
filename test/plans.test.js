import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SERIES_PLANS } from '../lib/plans.js';
import { CURATION_TYPES } from '../lib/themes.js';
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
  // 選び方の型（12種類・説明つき）と企画データベースのジャンル名も返す
  assert.equal(data.types.length, 12);
  assert.ok(data.types.every((t) => t.name && t.desc));
  assert.equal(data.types.find((t) => t.id === 'premium_budget').desc, 'ちゃんと高い理由がある本命と、価格を抑えた別解');
  assert.ok(data.genres.includes('防災グッズ'));
});

