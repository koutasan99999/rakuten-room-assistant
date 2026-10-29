import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../js/carousel-layout.js';
import instagram from '../api/instagram.js';
import { MAX_POST_ITEMS } from '../lib/instagram.js';
import { installFetchMock, json, aiReply } from './mock.js';

const L = globalThis.CarouselLayout;

test('商品数に応じて自動で配置し、4・6・10・15・20商品とも10枚以内（商品は減らさない）', () => {
  assert.equal(L.MAX_SLIDES, 10); // Instagram公式APIのカルーセル上限
  for (const n of [4, 6, 10, 15, 20]) {
    for (const summary of [true, false]) {
      const p = L.plan(n, { summary });
      const placed = p.slides.filter((s) => s.kind === 'items').flatMap((s) => s.items);
      assert.deepEqual(placed, Array.from({ length: n }, (_, i) => i), `${n}商品・${summary}`); // 全商品が順番どおり
      assert.ok(p.total <= 10, `${n}商品 → ${p.total}枚`);
      assert.equal(p.overLimit, false);
      assert.ok(p.sizes.every((s) => s >= 1 && s <= 4));
      assert.equal(p.slides[0].kind, 'cover');
      assert.equal(p.slides[p.slides.length - 1].kind, 'cta');
    }
  }
  // 少なければ今までどおり1商品1枚
  assert.deepEqual(L.plan(6, { summary: true }).sizes, [1, 1, 1, 1, 1, 1]);
  // 多いときは1枚目を特集（大きく）にして、残りを2〜4商品ずつ
  const p20 = L.plan(20, { summary: false });
  assert.equal(p20.total, 10);
  assert.equal(p20.sizes[0], 1);
  assert.deepEqual(L.slideNames([1, 2, 3, 4]), ['feature', 'duo', 'trio', 'grid4']);
});

test('配置を自分で変えたとき：入りきらない分はスライドを足し、10枚を超えたら理由と調整案を出す（商品は消さない）', () => {
  const p = L.plan(20, { summary: true, sizes: [1, 1, 1, 2] });
  const placed = p.slides.filter((s) => s.kind === 'items').flatMap((s) => s.items);
  assert.equal(placed.length, 20);
  assert.equal(p.overLimit, true);
  assert.match(p.reason, /10枚まで/);
  assert.ok(p.suggestions.some((t) => /まとめ/.test(t)));
  assert.ok(p.suggestions.some((t) => /自動の配置に戻す/.test(t)));
  // 多すぎる指定は商品数に合わせる
  assert.deepEqual(L.plan(5, { sizes: [4, 4, 4] }).sizes, [4, 1]);
});

test('画面のテンプレート：2〜4商品のスライドがあり、文字は小さくしすぎない（26px以上）', () => {
  const src = fs.readFileSync(new URL('../js/ig-multi.js', import.meta.url), 'utf8');
  for (const t of ['duo', 'trio', 'grid4']) assert.match(src, new RegExp(`T\\.${t} = function`));
  const sizes = [...src.matchAll(/(?:name|price|memo|role): (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 10 && sizes.every((x) => x >= 24), sizes.join(','));
});

test('Instagram API：1投稿に20商品まで文字を作る', async () => {
  assert.equal(MAX_POST_ITEMS, 20);
  const mock = installFetchMock({ rakuten: () => json(500, {}), openai: () => aiReply({ items: Array.from({ length: 20 }, (_, id) => ({ id, shortName: `商品${id}`, memo: '迷ったらまずこれでいい枠。' })) }) });
  const req = { method: 'POST', headers: { host: 'x.app' }, body: { theme: '防災グッズ', items: Array.from({ length: 25 }, (_, i) => ({ name: `商品${i}`, price: 1000 })) } };
  const res = { setHeader() {}, end(b) { this.body = b; } };
  await instagram(req, res, { RAKUTEN_APP_ID: 'a', OPENAI_API_KEY: 'k' });
  mock.restore();
  const data = JSON.parse(res.body);
  assert.equal(data.items.length, 20);
  assert.equal(data.items[19].shortName, '商品19');
});
