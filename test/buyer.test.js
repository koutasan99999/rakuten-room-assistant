import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import buyerApi from '../server/buyer.js';
import { readFeedback, discoveryScore, awarenessHint } from '../lib/buyer.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());
async function call(body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await buyerApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}
const item = (name, i, extra = {}) => ({ itemCode: `s:${name}`, itemName: name, itemPrice: 1980 + i * 100, itemUrl: `https://item.rakuten.co.jp/s/${i}/`, mediumImageUrls: [], shopName: extra.shop || 'ショップ', itemCaption: extra.caption || '説明', reviewCount: extra.reviews || 12, reviewAverage: 4.2 });

test('発掘スコアと知名度の目安：レビュー件数とランキングで決め、断定しない', () => {
  const low = awarenessHint({ reviewCount: 20 }, true);
  assert.equal(low.level, 'low');
  assert.ok(low.text.includes('断定ではありません'));
  assert.equal(awarenessHint({ reviewCount: 5000 }, false).level, 'high');
  const s = discoveryScore({ surprise: 5, solve: 5, everyday: 5 }, low);
  assert.equal(s.total, 100);
  assert.ok(discoveryScore({ surprise: 5, solve: 5, everyday: 5 }, awarenessHint({ reviewCount: 5000 }, true)).total < s.total);
  assert.deepEqual(readFeedback({ known: ['a', '', 3], wanted: 'x' }).known, ['a', '3']);
});

test('バイヤー発掘便：ランキング上位・知ってる・紹介済みは外し、企画案を付ける。誇張・体験の言葉は落とす', async () => {
  mock = installFetchMock({
    rakuten: (url) => {
      if (url.pathname.includes('/Ranking/')) return json(200, { Items: [{ rank: 1, itemName: '人気の加湿器 大容量', itemPrice: 5000, itemUrl: 'https://item.rakuten.co.jp/r/1/', itemCode: 'r:1', mediumImageUrls: [] }] });
      const kw = url.searchParams.get('keyword');
      return json(200, { pageCount: 1, items: [
        item('人気の加湿器 大容量', 0, { reviews: 9000 }),
        item(`傘 水滴 吸収マット ${kw}`, 1, { caption: '珪藻土で水を吸う', shop: '○○公式ショップ' }),
        item('知ってるケーブルホルダー', 2),
        item(`靴下 裏返し防止 ネット ${kw}`, 3, { reviews: 800 })
      ] });
    },
    openai: (body) => body.messages[0].content.includes('商品バイヤーです')
      ? aiReply({ angles: [{ problem: '濡れた傘で玄関が濡れる', kind: '傘 吸水', keyword: '傘 水滴 吸水' }, { problem: '靴下が裏返し', kind: '洗濯ネット', keyword: '靴下 洗濯 裏返し' }, { problem: 'ケーブルが落ちる', kind: 'ケーブルホルダー', keyword: 'ケーブル ホルダー' }] })
      : aiReply({ picks: [
        { id: 0, surprise: 5, solve: 5, everyday: 4, reason: '珪藻土で傘の水を吸う', buyerComment: '玄関が濡れないのいい', titles: ['濡れた傘の置き場所、これでいい', '絶対買うべき傘アイテム', '玄関の水たまり対策'], target: '雨の日に玄関が濡れる人', pain: '傘の水滴で床が濡れる', slides: ['1 表紙', '2 こんな不便', '3 商品'], intro: '傘の水滴を受け止めるマット。珪藻土で水を吸うと説明にあります。気になる人は商品ページで詳細を確認してみてください。' },
        { id: 1, surprise: 3, solve: 4, everyday: 4, reason: '靴下の裏返しを防ぐ', buyerComment: '愛用してます', titles: ['靴下の裏返し問題'], target: '洗濯担当', pain: '裏返しを直す手間', slides: ['1 表紙'], intro: '使ってみたら最高でした' }
      ] })
  });
  const r = await call({ theme: 'stress', feedback: { known: ['知ってるケーブルホルダー'] } });
  assert.equal(r.status, 200);
  const names = r.data.picks.map((p) => p.name);
  assert.ok(!names.some((n) => /加湿器|知ってる/.test(n)), names.join(' / '));
  const umbrella = r.data.picks.find((p) => p.name.includes('傘'));
  assert.ok(umbrella.plan.titles.length === 2 && !umbrella.plan.titles.some((t) => t.includes('絶対')));
  assert.equal(umbrella.official.label, '楽天の公式ショップ（○○公式ショップ）');
  assert.equal(umbrella.purchase.where, '楽天市場');
  assert.ok(umbrella.score.total > 0 && umbrella.score.ai > 0);
  const socks = r.data.picks.find((p) => p.name.includes('靴下'));
  assert.equal(socks.buyerComment, '');
  assert.equal(socks.plan.intro, '');
  assert.ok(socks.officialNote.includes('未取得'));
  assert.ok(r.data.rankingChecked);
});

test('バイヤー発掘便：AIが使えなくても、用意した切り口で探してデータだけのスコアで返す', async () => {
  mock = installFetchMock({
    rakuten: (url) => url.pathname.includes('/Ranking/') ? json(500, {}) : json(200, { pageCount: 1, items: [item(`${url.searchParams.get('keyword')} 便利`, 1)] }),
    openai: () => json(500, { error: { message: 'down' } })
  });
  const r = await call({});
  assert.equal(r.status, 200);
  assert.ok(r.data.picks.length >= 1);
  assert.equal(r.data.picks[0].plan, null);
  assert.ok(r.data.notice.includes('企画案なし'));
  assert.equal(r.data.rankingChecked, false);
});
