import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pitchApi from '../server/pitch.js';
import { classify, chooseTargets, orderForDiversity, normalizeRecent, MAJORS } from '../lib/pitch-genres.js';
import { installFetchMock, json, aiReply } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());
async function call(body) {
  const req = { method: 'POST', headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await pitchApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('分類：検索語ではなく「何の商品か」で決める（香水のギフトセットは香水、置き時計は腕時計ではない）', () => {
  assert.deepEqual(classify('香水 ギフトセット オードパルファム 50ml'), { major: 'grooming', sub: 'perfume' });
  assert.deepEqual(classify('置き時計 木製 北欧'), { major: 'interior', sub: 'decor' });
  assert.deepEqual(classify('ソーラー 腕時計 メンズ'), { major: 'watch', sub: 'watch' });
  assert.deepEqual(classify('ルームフレグランス リードディフューザー'), { major: 'interior', sub: 'room_fragrance' });
  assert.equal(classify('なにか分からない商品'), null);
  assert.ok(MAJORS.length >= 12);
});

test('次に探す分類：直近4件の大分類は選ばず、出したことのない・長く出していない分類を優先する（採用率では選ばない）', () => {
  const recent = normalizeRecent(['香水 オードトワレ', '腕時計 メンズ', '香水 ウッディ', 'スニーカー 白'].map((name) => ({ name, status: 'adopt' })));
  assert.deepEqual(recent.map((h) => h.major), ['grooming', 'watch', 'grooming', 'shoes']);
  for (let i = 0; i < 20; i++) {
    const t = chooseTargets(recent, { count: 6 });
    assert.equal(t.length, 6);
    assert.ok(t.every((x) => !['grooming', 'watch', 'shoes'].includes(x.major)), t.map((x) => x.major).join());
    assert.equal(new Set(t.map((x) => x.major)).size, 6);
  }
});

test('並べ方：直近5件で大分類を重ねず、同じ細分類を続けない。合わない商品は外して理由を残す', () => {
  const recent = [{ major: 'grooming', sub: 'perfume' }, { major: 'watch', sub: 'watch' }];
  const picks = [{ name: '香水B', major: 'grooming', sub: 'perfume' }, { name: 'ドリッパー', major: 'kitchen', sub: 'coffee' }, { name: 'マグ', major: 'kitchen', sub: 'tableware' }, { name: 'ランタン', major: 'outdoor', sub: 'lantern' }];
  const r = orderForDiversity(recent, picks);
  assert.deepEqual(r.items.map((p) => p.name), ['ドリッパー', 'ランタン']);
  assert.equal(r.dropped.length, 2);
  assert.ok(r.dropped.every((d) => d.reason.includes('続くため')));
});

test('次の商品を探す：直近と違う6分類で探し、ジャンルの違う商品を、直近の大分類と重ならないように返す', async () => {
  const asked = [];
  mock = installFetchMock({
    rakuten: (url) => {
      const kw = url.searchParams.get('keyword');
      asked.push(kw);
      return json(200, { items: [0, 1, 2].map((i) => ({ itemCode: `${kw}:${i}`, itemName: `${kw} モデル${i}`, itemPrice: 3000 + i * 1000, itemUrl: `https://item.rakuten.co.jp/s/${encodeURIComponent(kw)}${i}/`, mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/x.jpg'], shopName: 'ショップ', itemCaption: '説明', reviewCount: 3 })) });
    },
    openai: (body) => {
      const sys = body.messages[0].content;
      if (sys.includes('いろいろなジャンルから')) return aiReply({ queries: [{ major: 'grooming', sub: 'perfume', keyword: '香水 メンズ', angle: '直近と同じ分類（使われない）' }, { major: 'new:自転車・移動', sub: 'new:自転車の小物', keyword: '自転車 ベル 真鍮', angle: '新しい分類' }], taste: 'まだ判断できない' });
      // AIが同じジャンルばかり選んでも、コードで並べ方を確かめて外す
      const ids = [...body.messages[1].content.matchAll(/^(\d+): /gm)].map((m) => Number(m[1]));
      return aiReply({ picks: ids.slice(0, 4).map((id) => ({ id, pitch: '社長、これどうすか？素材の表情があって、毎日使う場面で少しだけ気分が上がる道具です。説明を見るかぎり作りも丁寧です。', point: '素材にこだわり', fit: '無難ではない', caution: '色は写真と違う場合がある' })) });
    }
  });
  const recent = ['香水 オードトワレ', '腕時計 メンズ', 'スニーカー 白', 'トートバッグ キャンバス'].map((name, i) => ({ name, code: 'r' + i, status: 'adopt' }));
  const r = await call({ action: 'scout', recent, exclude: { codes: [], names: [] }, taste: { history: [{ status: 'adopt', name: '香水 オードトワレ', category: '香り', reason: '香りがいい' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!asked.includes('香水 メンズ'), '直近4件の大分類（香水）では探さない');
  assert.ok(asked.includes('自転車 ベル 真鍮'), '一覧にない新しい分類も探せる');
  assert.ok(asked.length >= 6);
  const majors = r.data.items.map((x) => x.major);
  assert.ok(majors.length >= 1);
  assert.equal(new Set(majors).size, majors.length, majors.join());
  assert.ok(majors.every((m) => !['grooming', 'watch', 'shoes', 'bag'].includes(m)), majors.join());
  assert.ok(r.data.items.every((x) => x.genre && x.feature && x.price > 0 && x.url && x.image));
  assert.ok(r.data.dropped.length >= 1, '同じジャンルの重なりは外して理由を残す');
});

test('分類：色の「ブラック」を「ラック（棚）」と取り違えない', () => {
  assert.deepEqual(classify('オイルランタン ブラック'), { major: 'outdoor', sub: 'lantern' });
  assert.deepEqual(classify('スパイスラック 木製'), { major: 'interior', sub: 'furniture' });
});
