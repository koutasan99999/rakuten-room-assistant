// 本番に近い通しの試験（2026-11-15）：本番と同じプログラム（lib/worker.js の tick）を、手元の一時的な保存場所で動かす。
//   本物：OpenAI の文章のAI（バイヤーAI・監査AI・修正・企画担当AI・投稿セット制作AI・制作担当AI・表紙画像担当AIの場面）
//   偽物：楽天のAPI（実在の商品ページから集めた商品データを返す）／画像生成／画像の品質確認（費用がかかるため）
//   本番の保存場所・本番の予算の記録には触れない（memoryKv）。費用は応答の使用量から計算して表示する
// 使い方：OPENAI_API_KEY=<鍵> node scripts/e2e/real-text-pipeline.mjs <実在の商品データ.json> [最大の段階数]
import fs from 'node:fs';
import { memoryKv } from '../../lib/kv.js';
import { withUsage } from '../../lib/ai-usage.js';
import { tick, WORKER_KEYS } from '../../lib/worker.js';
import { spent } from '../../lib/budget.js';

const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const maxSteps = Number(process.argv[3]) || 40;
const TINY = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const ORIGIN = 'https://app.local/';
const real = globalThis.fetch;
const mocked = { rakuten: 0, images: 0, vision: 0, assets: 0 };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('openapi.rakuten.co.jp') || u.includes('app.rakuten.co.jp')) {
    mocked.rakuten++;
    const q = new URL(u);
    const code = q.searchParams.get('itemCode');
    const list = code ? items.filter((x) => x.itemCode === code) : items;
    return new Response(JSON.stringify({ Items: list.map((x) => ({ Item: x })), count: list.length, pageCount: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith(ORIGIN)) { mocked.assets++; return new Response(fs.readFileSync(new URL('../../' + u.slice(ORIGIN.length), import.meta.url)), { status: 200, headers: { 'Content-Type': 'image/png' } }); }
  if (u.includes('thumbnail.image.rakuten.co.jp') || u.includes('image.rakuten.co.jp') || u.includes('tshop.r10s.jp')) return new Response(Buffer.from(TINY, 'base64'), { status: 200, headers: { 'Content-Type': 'image/png' } });
  if (u.includes('api.openai.com/v1/images/')) { mocked.images++; return new Response(JSON.stringify({ data: [{ b64_json: TINY }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  if (u.includes('api.openai.com/v1/chat/completions') && opts.body && String(opts.body).includes('品質確認の担当')) {
    mocked.vision++;
    const pass = { single: true, character: true, sameAsMaster: true, plush3d: true, productLarge: true, productMatches: true, usingProduct: true, consistent: true, noText: true, noLogo: true, handsOk: true, noMedical: true, warmScene: true, topSpace: true, issues: [] };
    return new Response(JSON.stringify({ id: 'mock-vision', usage: { prompt_tokens: 0, completion_tokens: 0 }, choices: [{ message: { content: JSON.stringify(pass) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return real(url, opts);
};

const kv = memoryKv();
const env = { OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'proxy-injected', RAKUTEN_APP_ID: 'test', __noWait: true, KUMA_COVER_TRIES: '1' };
await kv.setJson(WORKER_KEYS.snap, { at: new Date().toISOString(), themes: ['デスクまわり・暮らしの便利グッズ'], avoid: [], past: [], outreachPosts: [], history: [], recentPatterns: [] });
const log = [];
for (let i = 0; i < maxSteps; i++) {
  const r = await withUsage(() => tick({ kv, env, origin: ORIGIN, startedAt: Date.now(), trigger: 'e2e' }));
  const w = r.worked;
  if (!w) { log.push({ i, idle: r.idle || r.skipped }); if (r.idle) break; continue; }
  log.push({ i, agent: w.agent, step: w.step, ok: w.ok, final: w.final || '', yen: w.yen, error: w.error || '' });
  console.log(`${i} ${w.agent}:${w.step} ${w.ok ? 'OK' : 'NG'} ${w.final || ''} ${w.yen}円 ${w.error || ''}`);
  if (w.agent === 'production' && w.final) break;
}
// 1. バイヤーAIの候補：修正の前後で、購入理由の項目が残っているか（版ごと）
const running = await kv.getJson('worker:job');
const sessions = [...((await kv.listJson(WORKER_KEYS.buyer, 10)) || []), ...(running && running.type === 'buyer' ? [running.session] : [])];
const KEYS = ['motive', 'whoBuys', 'problem', 'whyNow', 'vsOthers', 'priceReason', 'postIdea'];
const versions = [];
for (const s of sessions) for (const c of s.candidates || []) c.versions.forEach((v, n) => versions.push({ session: s.id, cand: c.id, v: n + 1, status: c.status, why: c.why || '', name: String(v.data.name || '').slice(0, 30), missing: KEYS.filter((k) => !String(v.data[k] || '').trim()), brief: v.check ? (v.check.checks.find((k) => k.key === 'brief') || {}).ok : null, score: v.audit ? v.audit.total : null, codeNg: v.check ? v.check.checks.filter((k) => k.ok === false || (k.hard && k.ok === null)).map((k) => `${k.key}:${k.ok}:${String(k.detail).slice(0, 60)}`) : [], proposal: v.audit ? v.audit.proposal : '', flags: v.audit ? Object.keys(v.audit.flags || {}).filter((f) => v.audit.flags[f] === true) : [], decision: v.decision ? `${v.decision.status}:${String(v.decision.why || '').slice(0, 80)}` : '' }));
const prod = (await kv.listJson('worker:results:production', 5)) || [];
const p = prod[0] || null;
const out = {
  steps: log, buyer: { sessions: sessions.length, candidates: versions.filter((x) => x.v === 1).length, pass: sessions.flatMap((s) => s.candidates || []).filter((c) => c.status === 'pass').length, versions },
  production: p ? { result: p.result, why: p.why, score: p.score, motive: p.motive || '', title: p.title || '', cover: p.set ? p.set.coverImage : p.cover || null, caption: p.set && p.set.copy ? p.set.copy.caption : '', room: p.set ? (p.set.roomTexts || []).map((x) => ({ intro: x.intro, from: x.introFrom || 'AI' })) : [], versions: p.versions || [], items: p.set ? p.set.items.map((it) => ({ name: it.name, price: it.price, url: it.url, source: it.source })) : [], funnel: p.set ? p.set.funnel : null, audits: (p.audits || []).map((a) => ({ total: a.audit && a.audit.total, decision: a.decision && a.decision.status, proposal: a.audit && a.audit.proposal, flags: a.audit ? a.audit.flags : null, fixes: a.audit ? a.audit.fixes : [], summary: a.audit ? a.audit.summary : '', fixCheck: a.fixCheck || null, ng: (a.check ? a.check.checks : []).filter((k) => k.hard && k.ok === false).map((k) => `${k.key}:${k.detail}`) })) } : null,
  yen: await spent(kv), mocked
};
fs.writeFileSync(process.env.OUT || 'e2e-result.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({ buyer: { sessions: out.buyer.sessions, candidates: out.buyer.candidates, pass: out.buyer.pass }, production: p ? { result: p.result, why: String(p.why || '').slice(0, 200) } : null, yen: out.yen, mocked }, null, 1));
