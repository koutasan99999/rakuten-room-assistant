// 楽天の商品検索・照合の比較（同じ20商品）：node scripts/search-benchmark.js [libのフォルダ]
// 楽天APIは呼ばない（test/fixtures/search-benchmark.js の商品名で、楽天のキーワード検索をまねる）。
// 修正前の数字を出すときは、古い lib を別のフォルダに取り出して、そのフォルダを渡す。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BENCH, fakeRakutenSearch } from '../test/fixtures/search-benchmark.js';
import { installFetchMock, json } from '../test/mock.js';

export async function runBenchmark(libDir) {
  const lib = (f) => import(pathToFileURL(path.join(libDir, f)).href);
  const match = await lib('product-match.js');
  const analysis = await lib('product-analysis.js');
  const catalog = BENCH.flatMap((b) => [b.listing, ...b.others]);
  let calls = 0;
  const mock = installFetchMock({
    rakuten: (url) => {
      calls++;
      const names = fakeRakutenSearch(url.searchParams.get('keyword') || '', catalog);
      return json(200, { items: names.map((n) => ({ itemCode: `s:${catalog.indexOf(n)}`, itemName: n, itemPrice: 3000, itemUrl: `https://item.rakuten.co.jp/s/${catalog.indexOf(n)}/`, mediumImageUrls: [], shopName: 'ショップ', itemCaption: '' })), pageCount: 1 });
    }
  });
  // 楽天APIの「1秒1回」の待ち時間は、比較では飛ばす
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
  const rows = [];
  try {
    for (const b of BENCH) {
      const key = (s) => String(s || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const bn = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s・]/g, '');
      const t = match.readTarget(b.target);
      const before = calls;
      const r = await match.findOnRakuten({ target: b.target, env: { RAKUTEN_APP_ID: 'x' }, referer: 'https://x/', until: Date.now() + 600000 });
      const truth = r.items.find((x) => x.name === b.listing);
      const sameOk = b.sameOk || [];
      rows.push({
        name: b.target.name,
        brand: bn(t.brand) === bn(b.expect.brand),
        brandGot: t.brand,
        model: key(t.model) === key(b.expect.model),
        modelGot: t.model,
        kind: analysis.findKind(b.target.name) === b.expect.kind,
        kindGot: analysis.findKind(b.target.name),
        calls: calls - before,
        candidates: r.items.length,
        found: !!truth,
        same: !!(truth && truth.match === 'same'),
        falseSame: r.items.filter((x) => x.match === 'same' && x.name !== b.listing && !sameOk.includes(x.name)).map((x) => x.name),
        queries: r.tried.map((q) => `${q.keyword}(${q.count})`)
      });
    }
  } finally {
    globalThis.setTimeout = realSetTimeout;
    mock.restore();
  }
  const sum = (f) => rows.filter(f).length;
  return {
    rows,
    total: {
      brand: sum((x) => x.brand), model: sum((x) => x.model), kind: sum((x) => x.kind),
      found: sum((x) => x.found), same: sum((x) => x.same), falseSame: rows.reduce((n, x) => n + x.falseSame.length, 0),
      calls: rows.reduce((n, x) => n + x.calls, 0), candidates: rows.reduce((n, x) => n + x.candidates, 0), count: rows.length
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '../lib'));
  const { rows, total } = await runBenchmark(dir);
  for (const x of rows) {
    console.log(`${x.name}\n  ブランド:${x.brand ? '○' : '×'}(${x.brandGot || 'なし'}) 型番:${x.model ? '○' : '×'}(${x.modelGot || 'なし'}) 種類:${x.kind ? '○' : '×'}(${x.kindGot || 'なし'}) 検索${x.calls}回 候補${x.candidates}件 本物:${x.found ? (x.same ? '同一で発見' : '発見(同一と判定せず)') : '見つからず'}${x.falseSame.length ? ' 誤って同一:' + x.falseSame.join('／') : ''}\n  検索語: ${x.queries.join(' → ')}`);
  }
  console.log(`\n合計（${total.count}商品）: ブランド${total.brand} 型番${total.model} 種類${total.kind} 本物を発見${total.found} 本物を同一と判定${total.same} 誤って同一${total.falseSame} 検索回数${total.calls} 候補${total.candidates}`);
}
