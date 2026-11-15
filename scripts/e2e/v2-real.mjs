// サングラスくま株式会社 2.0 の通し試験（2026-11-15）：本番と同じプログラム（lib/v2/company.js の tick）を、手元の一時的な保存場所で動かす。
//   本物：OpenAI の文章のAI（バイヤー・監査・企画・ライター・編集・デザイナーの場面）
//   偽物：楽天のAPI（実在の商品ページから集めた商品データを返す）／画像生成（テスト用の仮画像）／画像の品質確認（仮画像なので合格扱い）
//   本番の保存場所・本番の予算の記録には触れない（memoryKv）。SERVE=<port> を付けると、試験の結果のまま画面（/v2/）を開ける
// 使い方：OPENAI_API_KEY=<鍵> node scripts/e2e/v2-real.mjs <実在の商品データ.json> <仮画像.jpg> [最大の段階数]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { memoryKv } from '../../lib/kv.js';
import { withUsage } from '../../lib/ai-usage.js';
import * as V from '../../lib/v2/company.js';
import { spent } from '../../lib/budget.js';
import v2api from '../../server/v2.js';
import media from '../../server/media.js';

const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const placeholder = fs.readFileSync(process.argv[3]).toString('base64');
const maxSteps = Number(process.argv[4]) || 30;
const ORIGIN = 'https://app.local/';
const real = globalThis.fetch;
const mocked = { rakuten: 0, images: 0, vision: 0 };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('openapi.rakuten.co.jp') || u.includes('app.rakuten.co.jp')) {
    mocked.rakuten++;
    const code = new URL(u).searchParams.get('itemCode');
    // 検索語に合う商品だけ返す（本物の楽天に近づける。合う商品が無ければ空）
    const kw = String(new URL(u).searchParams.get('keyword') || '').split(/[\s　]+/).filter((w) => w.length >= 2);
    const hit = items.filter((x) => kw.some((w) => x.itemName.includes(w) || String(x.itemCaption || '').includes(w)));
    const list = code ? items.filter((x) => x.itemCode === code) : hit;
    return new Response(JSON.stringify({ Items: list.map((x) => ({ Item: x })), count: list.length, pageCount: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith(ORIGIN)) return new Response(fs.readFileSync(new URL('../../' + u.slice(ORIGIN.length), import.meta.url)), { status: 200, headers: { 'Content-Type': 'image/png' } });
  if (u.includes('thumbnail.image.rakuten.co.jp') || u.includes('image.rakuten.co.jp') || u.includes('tshop.r10s.jp')) return new Response(Buffer.from(placeholder, 'base64'), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  if (u.includes('api.openai.com/v1/images/')) { mocked.images++; return new Response(JSON.stringify({ data: [{ b64_json: placeholder }], usage: { input_tokens: 3000, output_tokens: 1372, input_tokens_details: { image_tokens: 3000, text_tokens: 0 } } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (u.includes('api.openai.com/v1/chat/completions') && opts.body && String(opts.body).includes('品質確認の担当')) {
    mocked.vision++;
    const ok = { single: true, character: true, sameAsMaster: true, plush3d: true, productLarge: true, productMatches: true, usingProduct: true, consistent: true, noText: true, noLogo: true, handsOk: true, noMedical: true, warmScene: true, topSpace: true, issues: [] };
    return new Response(JSON.stringify({ id: 'mock', model: 'mock', choices: [{ message: { content: JSON.stringify(ok) } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return real(url, opts);
};

const kv = memoryKv();
const env = { ...process.env, RAKUTEN_APP_ID: 'mock', APP_PASSCODE: 'local', __kv: kv };
const log = [];
for (let i = 0; i < maxSteps; i++) {
  const r = await withUsage(() => V.tick({ kv, env, origin: ORIGIN, startedAt: Date.now(), trigger: 'e2e' }));
  const w = r.worked;
  if (!w) { console.log(i, r.idle || r.skipped); if (r.idle) break; continue; }
  log.push(w);
  console.log(`${i} ${w.agent}:${w.step} ${w.final || ''} ${w.yen}円`);
  if (w.final === 'deliver' || w.final === 'stop') break;
}
const st = await V.officeState(kv, env);
const flow = [...st.events].reverse().map((e) => `${e.at.slice(11, 19)} ${e.agent}${e.to ? '→' + e.to : ''} [${e.type}] ${e.text}`);
console.log(flow.join('\n'));
const set = st.sets[0] ? await V.getSet(kv, st.sets[0].id) : null;
const devLog = ((await kv.listJson(V.V2_KEYS.events, 50)) || []).filter((e) => e.dev).map((e) => `${e.type}: ${e.dev}`);
console.log('DEV', devLog.join('\n'));
const out = { steps: log, flow, set, devLog, yen: await spent(kv), mocked };
fs.writeFileSync(process.env.OUT || 'v2-e2e.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({ delivered: !!set, title: set && set.title, products: set && set.products.length, yen: out.yen, mocked }, null, 1));

// 試験の結果のまま画面を開く（手元だけ）
if (process.env.SERVE) {
  const root = path.resolve(new URL('../../', import.meta.url).pathname);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
  http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/v2') { let b = ''; req.on('data', (c) => { b += c; }); await new Promise((r) => req.on('end', r)); req.body = JSON.parse(b || '{}'); return v2api(req, res, env); }
    if (u.pathname === '/api/media') return media(req, res, env);
    let p = path.join(root, decodeURIComponent(u.pathname));
    if (!p.startsWith(root)) { res.statusCode = 403; return res.end(); }
    if (p.endsWith('/')) p += 'index.html';
    fs.readFile(p, (e, buf) => { if (e) { res.statusCode = 404; return res.end('not found'); } res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream'); res.end(buf); });
  }).listen(Number(process.env.SERVE), () => console.log(`SERVE http://localhost:${process.env.SERVE}/v2/`));
}
