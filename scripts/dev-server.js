// 手元で画面を確認するための簡易サーバー（本番はVercelが動かすので不要）
// MOCK=1 で起動すると、APIキーなしで偽の商品データを表示できる
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/discover.js';
import curateHandler from '../api/curate.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
let env = process.env;

if (process.env.MOCK) {
  const { installFetchMock, makeItems, json, aiReply, GOOD_INTRO } = await import('../test/mock.js');
  installFetchMock({
    // 価格帯の指定があれば、その範囲の価格で偽の商品を返す
    rakuten: (url) => {
      const min = Number(url.searchParams.get('minPrice')) || 1000;
      const items = makeItems(20, url.searchParams.get('keyword').split(' ')[0]).map((it, i) => ({ ...it, itemPrice: min + i * 100 }));
      return json(200, { items, pageCount: 3 });
    },
    openai: (body) => body.messages[0].content.includes('選び方まとめ')
      ? aiReply({
        title: '迷ったらこの順で選べばいい', lead: 'まずは無難な1つ目で十分。物足りなくなったら2つ目、こだわりたくなったら3つ目、という順番にしています。',
        verdict: '迷ったら、最初の1つだけ買っておけば困らない。',
        items: [0, 8, 16].map((id, i) => ({ id, role: ['迷ったらまずこれ', '2番手', '本気なら'][i], forWho: '初めて買う人に', why: '価格と見た目のバランスが良く、最初の1つとして外しにくい位置づけ。', tradeoff: i ? '高い分、素材と仕上げにお金を払っている。' : '', intro: GOOD_INTRO }))
      })
      : aiReply({ picks: [0, 4, 8, 12, 16].map((id) => ({ id, want: 8, reason: '中身が見えないフタ付きで、棚に並べてもごちゃっと見えない。', intro: GOOD_INTRO })) })
  });
  env = { RAKUTEN_APP_ID: 'mock', OPENAI_API_KEY: 'mock', ...(process.env.APP_PASSCODE ? { APP_PASSCODE: process.env.APP_PASSCODE } : {}) };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/discover') return handler(req, res, env);
  if (url.pathname === '/api/curate') return curateHandler(req, res, env);
  const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await fs.readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
