// テスト・画面確認用に、楽天APIとOpenAI APIの応答を偽物に差し替える
export function makeItems(n, prefix = '商品') {
  return Array.from({ length: n }, (_, i) => ({
    itemCode: `shop:${prefix}${i}`,
    itemName: `${prefix}${i} おしゃれな収納ボックス タイプ${i}`,
    itemPrice: 1000 + i * 100,
    itemUrl: `https://item.rakuten.co.jp/shop/${prefix}${i}/`,
    mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/x/${i}.jpg?_ex=128x128`],
    shopName: 'テストショップ',
    itemCaption: '説明文'.repeat(50),
    reviewAverage: 4.5,
    reviewCount: i * 3
  }));
}

export const GOOD_INTRO = 'シンプルな見た目で部屋のどこに置いてもなじみやすそうな収納ボックスです。' +
  'サイズ展開があるので置き場所に合わせて選べるのがうれしいポイント。フタ付きなので中身が見えず、' +
  '生活感を抑えたい場所にも使いやすそうです。色味も落ち着いていて、ほかの家具と合わせやすい印象でした。' +
  '収納を見直したい方は商品ページで詳しいサイズを確認してみてください。';

// images: 画像生成API（/v1/images/…）の偽物、thumbnail: 楽天の商品写真の偽物（どちらも省略可）
export function installFetchMock({ rakuten, openai, images, thumbnail }) {
  const calls = { rakuten: [], openai: [], images: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('thumbnail.image.rakuten.co.jp') && thumbnail) return thumbnail(new URL(u));
    if (u.includes('api.openai.com/v1/images/')) {
      calls.images.push({ url: u, body: opts.body });
      return images ? images(opts.body, calls.images.length) : json(200, { data: [{ b64_json: TINY_PNG }] });
    }
    if (u.includes('rakuten')) {
      calls.rakuten.push({ url: new URL(u), headers: opts.headers });
      return rakuten(new URL(u), calls.rakuten.length);
    }
    if (u.includes('openai')) {
      const body = JSON.parse(opts.body);
      calls.openai.push(body);
      return openai(body, calls.openai.length);
    }
    return original(url, opts);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export function json(status, data) {
  return new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export function aiReply(content) {
  return json(200, { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] });
}

// 1×1の白いPNG（画像生成の偽物の応答に使う）
export const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
export function imageResponse(bytes = Buffer.from(TINY_PNG, 'base64'), type = 'image/png') {
  return new Response(bytes, { status: 200, headers: { 'Content-Type': type } });
}
