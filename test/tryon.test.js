import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import coordImageApi from '../api/coord-image.js';
import { readTryOnRequest, tryOnPrompt, generateTryOn, MAX_REFS, IMAGE_MODELS } from '../lib/tryon.js';
import { installFetchMock, json, imageResponse, TINY_PNG } from './mock.js';

const ENV = { RAKUTEN_APP_ID: 'app', OPENAI_API_KEY: 'sk-test' };
let mock;
afterEach(() => mock && mock.restore());

const img = (i) => `https://thumbnail.image.rakuten.co.jp/x/${i}.jpg?_ex=128x128`;
const BODY = {
  gender: 'mens', background: 'street', pose: 'walk', quality: 'low', variant: 1, style: '大人カジュアル',
  items: [
    { name: 'New Balance 1906R グレー スニーカー', kind: 'スニーカー', brand: 'New Balance', image: img(0), hero: true },
    { name: 'メンズ ニット グレー', kind: 'ニット', image: img(1) },
    { name: 'メンズ スラックス 黒', kind: 'スラックス', image: img(2) },
    { name: '公式サイトのバッグ', kind: 'バッグ', image: 'https://example.com/bag.jpg' } // 楽天以外の写真は参考に使わない
  ]
};

async function call(body, method = 'POST') {
  const req = { method, headers: { host: 'x.app' }, body };
  const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
  await coordImageApi(req, res, ENV);
  return { status: res.statusCode, data: JSON.parse(res.body) };
}

test('着用イメージの指示：選んだ商品をそのまま使い、全身・背景・ポーズ・性別を入れる', () => {
  const r = readTryOnRequest(BODY);
  const p = tryOnPrompt(r);
  assert.ok(p.includes('男性') && p.includes('全身') && p.includes('街並み') && p.includes('歩いている'));
  assert.ok(p.includes('New Balance 1906R') && p.includes('主役のアイテム'));
  assert.ok(p.includes('ロゴ') && p.includes('足さない'));
  assert.equal(readTryOnRequest({ items: [] }), null);
  assert.equal(readTryOnRequest({ ...BODY, background: '宇宙', quality: 'high' }).background, 'studio');
  assert.equal(readTryOnRequest({ ...BODY, quality: 'high' }).quality, 'low'); // 高い画質は使わない
});

test('画像生成：楽天の商品写真だけを参考にし、使えないモデルは次の（より高い）モデルへ。ほかのエラーでは重ねて呼ばない', async () => {
  const models = [];
  mock = installFetchMock({
    thumbnail: () => imageResponse(),
    images: (form) => {
      models.push(form.get('model'));
      assert.equal(form.getAll('image[]').length, 3); // 楽天以外の写真は入れない
      assert.equal(form.get('size'), '1024x1536');
      return models.length === 1 ? json(404, { error: { message: 'The model does not exist' } }) : json(200, { data: [{ b64_json: TINY_PNG }] });
    }
  });
  const out = await generateTryOn(readTryOnRequest(BODY), ENV);
  assert.deepEqual(models, IMAGE_MODELS.slice(0, 2));
  assert.equal(out.model, IMAGE_MODELS[1]);
  assert.ok(out.image.startsWith('data:image/jpeg;base64,'));
  assert.ok(out.costYen > 0);
  mock.restore();

  let n = 0;
  mock = installFetchMock({ thumbnail: () => imageResponse(), images: () => { n++; return json(500, { error: { message: 'server error' } }); } });
  await assert.rejects(() => generateTryOn(readTryOnRequest(BODY), ENV), /生成できませんでした/);
  assert.equal(n, 1);
});

test('参考画像は最大の枚数まで（主役を先に）', async () => {
  let refs = 0;
  mock = installFetchMock({ thumbnail: () => imageResponse(), images: (form) => { refs = form.getAll('image[]').length; return json(200, { data: [{ b64_json: TINY_PNG }] }); } });
  const many = { ...BODY, items: Array.from({ length: 9 }, (_, i) => ({ name: 'アイテム' + i, kind: 'シャツ', image: img(i), hero: i === 8 })) };
  const r = readTryOnRequest(many);
  await generateTryOn(r, ENV);
  assert.equal(refs, MAX_REFS);
});

test('API：料金の目安を返す・アイテムがなければ400・写真が読めなければ502（画像生成は呼ばない）', async () => {
  const meta = await call(undefined, 'GET');
  assert.equal(meta.status, 200);
  assert.ok(meta.data.cost.low > 0 && meta.data.backgrounds.studio);
  assert.equal((await call({ items: [] })).status, 400);
  mock = installFetchMock({ thumbnail: () => json(404, {}) });
  const r = await call(BODY);
  assert.equal(r.status, 502);
  assert.equal(mock.calls.images.length, 0);
});
