// サングラスくまの表紙画像（2026-11-14）：場面の企画 → 画像生成 → 品質確認 → 完成した投稿セット。
// OpenAI・楽天・自分のサイトの応答はすべて偽物（実際の画像生成・課金はしない）
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memoryKv } from '../lib/kv.js';
import { withUsage } from '../lib/ai-usage.js';
import * as C from '../lib/kuma-cover.js';
import { imageSpent, imageCheck, spent } from '../lib/budget.js';
import { MASTERS } from '../lib/kuma-master-manifest.js';
import { tick, WORKER_KEYS, coverWaitList, MAX_COVER_ROUNDS } from '../lib/worker.js';
import * as S from '../lib/store.js';
import mediaHandler from '../server/media.js';
import { aiReply, json, imageResponse, TINY_PNG } from './mock.js';

const ORIGIN = 'https://app.test/';
const ENV = { OPENAI_API_KEY: 'sk-test', RAKUTEN_APP_ID: 'app' };
const masterBuf = (f) => fs.readFileSync(new URL(`../assets/kuma-master/${f}`, import.meta.url));
const ITEM = { name: '折りたたみ傘 晴雨兼用 完全遮光 軽量', caption: '完全遮光の生地で、遮蔽遮熱。軽量で持ち運びしやすい折りたたみ傘。', role: '本命', image: 'https://thumbnail.image.rakuten.co.jp/x/1.jpg', code: 's:umb', price: 2980 };
const SET = { id: 'set-k1', title: '雨の日“装備”をスマートに', target: '通勤する人', createdAt: new Date().toISOString(), items: [ITEM, { ...ITEM, name: 'レインカバー', role: '名脇役', code: 's:rc' }, { ...ITEM, name: '長靴', role: '名脇役', code: 's:boot' }], copy: { caption: 'x', items: [] } };
const SCENE = { usage: '持ち運んで、雨の日に開いて使う', usageQuote: '持ち運びしやすい', place: '駅の改札前', time: '朝', action: '改札を出たところで折りたたみ傘を開いている', consistency: '傘の柄を手で持ち、骨は上に開く', camera: '斜め前・目線の高さ', productPlacement: '手前で大きく開いた傘', outfit: 'トレンチコート', mood: '爽やか' };
const PASS = { single: true, character: true, sameAsMaster: true, plush3d: true, productLarge: true, productMatches: true, usingProduct: true, consistent: true, noText: true, noLogo: true, handsOk: true, noMedical: true, warmScene: true, topSpace: true, issues: [] };

let original = null;
afterEach(() => { if (original) globalThis.fetch = original; original = null; });
// 偽物の外部：自分のサイトのマスター画像・楽天の商品写真・OpenAI（文章と画像）
function fake({ scenes = [SCENE], checks = [PASS], images, tamper = false } = {}) {
  original = globalThis.fetch;
  const calls = { images: [], chat: [], masters: 0 };
  let ci = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith(ORIGIN + 'assets/kuma-master/')) { calls.masters++; const f = u.split('/').pop(); return new Response(tamper ? Buffer.from('changed') : masterBuf(f), { status: 200, headers: { 'Content-Type': 'image/png' } }); }
    if (u.startsWith(ORIGIN + 'assets/')) { calls.direction = (calls.direction || 0) + 1; return new Response(fs.readFileSync(new URL('../' + u.slice(ORIGIN.length), import.meta.url)), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }); }
    if (u.includes('thumbnail.image.rakuten.co.jp')) return imageResponse();
    if (u.includes('api.openai.com/v1/images/edits')) { calls.images.push(opts.body); return images ? images(calls.images.length) : json(200, { data: [{ b64_json: TINY_PNG }], usage: { input_tokens: 3500, output_tokens: 1400, input_tokens_details: { image_tokens: 3200, text_tokens: 300 } } }); }
    if (u.includes('api.openai.com')) {
      const body = JSON.parse(opts.body); calls.chat.push(body);
      const sys = body.messages[0].content;
      if (sys.includes('表紙画像担当AIです')) return aiReply({ scenes });
      if (sys.includes('品質確認の担当')) return aiReply(checks[Math.min(ci++, checks.length - 1)]);
      return aiReply({});
    }
    throw new Error(`想定外の通信：${u}`);
  };
  return calls;
}

test('場面の選び方：くまが商品を実際の使い方どおりに使う案だけ。使い方を商品データで確かめられない案・医療の場面・最近と同じ場面は使わない（「眺めるだけ」で代用しない）', () => {
  const hist = [{ place: '駅の改札前', action: '改札を出たところで折りたたみ傘を開いている', outfit: 'トレンチコート' }];
  const r = C.pickScene([{ ...SCENE, place: '眼科の待合室' }, SCENE, { ...SCENE, place: 'カフェのテラス', usage: '日差しを防ぐ', usageQuote: '日傘級の遮光タイプ' }, { ...SCENE, place: '公園', action: '傘を差して歩く' }], ITEM, hist);
  assert.equal(r.scene.place, '公園');
  assert.equal(r.notes.length, 3);
  assert.ok(r.notes.some((n) => /確かめられない/.test(n)));
  assert.equal(C.pickScene([{ ...SCENE, usageQuote: '日傘級' }], ITEM).scene, null, '使い方を裏付けられなければ場面を作らない');
  assert.equal(C.pickScene([{ ...SCENE, usage: '' }], ITEM).scene, null);
});

test('画像への指示：商品を実際に使う一瞬・物理的な矛盾なし・カメラは場面ごと・固定要素・商品の写真どおり・方向性の参考画像。文字・ロゴ・2体以上を描かせない', () => {
  const p = C.imagePrompt(SCENE, ITEM, 2, true);
  for (const w of ['candid everyday moment, not a posed advertisement', 'camel / caramel fluffy fur', 'large glossy black wayfarer sunglasses', 'Reference image 1 and 2', 'Reference image 3: the real product', 'Reference image 4: a past render the owner liked', 'actually using the product', '傘の柄を手で持ち', 'must make physical sense', '斜め前・目線の高さ', 'トレンチコート', 'top 30%', 'Do NOT draw any text', 'No second character']) assert.ok(p.includes(w), w);
  assert.ok(!C.imagePrompt(SCENE, ITEM, 2, false).includes('Reference image 4'), '参考画像が無いときは書かない');
});

test('画像の生成：マスター画像（指紋を確認）と商品写真を参考に1枚。予算を確かめてから呼び、実測の費用を画像の上限に記録する', async () => {
  const kv = memoryKv();
  const calls = fake();
  const r = await C.imageStep({ kv, env: ENV, origin: ORIGIN, scene: SCENE, item: ITEM });
  assert.equal(r.ok, true, r.error || r.skip);
  const form = calls.images[0];
  assert.equal(form.getAll('image[]').length, 4, 'マスター2枚＋商品写真1枚＋方向性の参考1枚');
  assert.equal(calls.direction, 1, '方向性の参考画像を自分のサイトから取る');
  assert.equal(form.get('model'), 'gpt-image-2'); assert.equal(form.get('quality'), 'medium'); assert.equal(form.get('size'), '1024x1536');
  assert.equal(r.cost.measured, true);
  assert.ok(r.cost.yen > 5 && r.cost.yen < 20, `${r.cost.yen}円`);
  const sp = await imageSpent(kv);
  assert.equal(sp.dayCount, 1); assert.equal(sp.month, r.cost.yen);
  assert.equal((await spent(kv)).month, r.cost.yen, '全体の月の上限にも数える');
  assert.equal((await spent(kv)).dayAuto, 0, '自律運営の1日25円（文章のAI）には入れない');
});

test('画像の生成：1日2枚・月200円・全体の月1,000円を超えるなら呼ばない。マスター画像が差し替えられていたら呼ばない（別のくまで代用しない）', async () => {
  const kv = memoryKv();
  let calls = fake();
  await C.imageStep({ kv, env: ENV, origin: ORIGIN, scene: SCENE, item: ITEM });
  await C.imageStep({ kv, env: ENV, origin: ORIGIN, scene: SCENE, item: ITEM });
  const third = await C.imageStep({ kv, env: ENV, origin: ORIGIN, scene: SCENE, item: ITEM });
  assert.match(third.skip, /今日の画像の上限（2枚）/);
  assert.equal(calls.images.length, 2);
  const kv2 = memoryKv();
  await kv2.incrFloat(`budget:image:month:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7)}`, 190);
  assert.match((await imageCheck(kv2, ENV)).reason, /今月の画像の費用が上限（200円）/);
  const kv3 = memoryKv();
  await kv3.incrFloat(`budget:month:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7)}`, 990);
  assert.match((await imageCheck(kv3, ENV)).reason, /全体の上限（1000円）/);
  globalThis.fetch = original; calls = fake({ tamper: true });
  const t = await C.imageStep({ kv: memoryKv(), env: ENV, origin: ORIGIN, scene: SCENE, item: ITEM });
  assert.match(t.skip, /マスター画像.*問題/);
  assert.equal(calls.images.length, 0, '画像生成APIを呼ばない');
});

test('画像の生成：時間切れ・通信の切断でも、費用がかかった可能性があるので見込みの額で記録する', async () => {
  const kv = memoryKv();
  fake({ images: () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } });
  const r = await C.imageStep({ kv, env: ENV, origin: ORIGIN, scene: SCENE, item: ITEM });
  assert.equal(r.ok, false); assert.match(r.error, /時間内に終わらなかった/);
  assert.equal((await imageSpent(kv)).month, 20);
});

test('品質確認：14項目すべて「はい」で合格（商品を自然に使っている・矛盾がない・商品が大きいを含む）。1つでも「いいえ」なら不合格', () => {
  assert.equal(C.judgeCheck(PASS).pass, true);
  assert.deepEqual(C.judgeCheck({ ...PASS, usingProduct: false }).ng, ['商品を自然に使っている']);
  assert.deepEqual(C.judgeCheck({ ...PASS, consistent: false }).ng, ['形・使い方に矛盾がない']);
  const ng = C.judgeCheck({ ...PASS, noLogo: false, issues: ['帽子にロゴ'] });
  assert.equal(ng.pass, false); assert.deepEqual(ng.ng, ['ロゴなし']); assert.deepEqual(ng.issues, ['帽子にロゴ']);
  assert.equal(C.judgeCheck({ ...PASS, topSpace: undefined }).pass, false, '答えが無い項目は合格にしない');
});

// 制作ラインの続き：監査AIが合格にした投稿セットから始める（保存場所に「途中の仕事」を置いて定期実行を回す）
async function runCover(kv, opts) {
  const calls = fake(opts);
  await kv.setJson(WORKER_KEYS.snap, { at: new Date().toISOString() });
  await kv.setJson('worker:job', { id: 'srvpk1', type: 'production', step: 'scene', startedAt: new Date().toISOString(), steps: 9, attempts: 0, source: [], set: JSON.parse(JSON.stringify(SET)),
    rec: { id: 'srvpk1', origin: 'server', at: new Date().toISOString(), status: 'running', steps: [], runs: [], audits: [], revisions: 0, rakutenCalls: 0, result: 'pass', score: 86, title: SET.title } });
  const steps = [];
  for (let i = 0; i < 8; i++) {
    const r = await withUsage(() => tick({ kv, env: ENV, origin: ORIGIN, startedAt: Date.now() }));
    if (!r.worked) break;
    steps.push(`${r.worked.step}:${r.worked.ok}${r.worked.final ? ':' + r.worked.final : ''}`);
    if (r.worked.final) break;
  }
  return { steps, calls, prod: (await kv.listJson('worker:results:production', 5))[0] };
}

test('制作ライン：合格した投稿セットに表紙画像を付けてから、社長の確認待ち（サーバーの正本）に入れる。画像は /api/media で配る', async () => {
  const kv = memoryKv();
  const { steps, calls, prod } = await runCover(kv);
  assert.deepEqual(steps, ['scene:true', 'image:true', 'imgcheck:true:done']);
  assert.equal(calls.images.length, 1);
  const ci = prod.set.coverImage;
  assert.equal(ci.status, 'ok'); assert.equal(ci.label, 'AI生成イメージ'); assert.equal(ci.scene.place, '駅の改札前');
  assert.ok(Object.values(ci.check).every(Boolean));
  const rec = await S.get(kv, SET.id);
  assert.ok(rec, 'サーバーの正本に保存'); assert.equal(rec.set.coverImage.mediaId, ci.mediaId);
  assert.equal((await C.sceneHistory(kv))[0].place, '駅の改札前', '次から同じ場面を避けるための記録');
  // /api/media：画像を返す。知らないIDは404
  const res = await new Promise((resolve) => { const r = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, type: this.headers['Content-Type'], len: b.length }); } }; mediaHandler({ url: `/api/media?id=${ci.mediaId}` }, r, { __kv: kv }); });
  assert.equal(res.status, 200); assert.equal(res.type, 'image/jpeg'); assert.ok(res.len > 0);
  const nf = await new Promise((resolve) => { const r = { statusCode: 0, setHeader() {}, end() { resolve(this.statusCode); } }; mediaHandler({ url: '/api/media?id=../../etc' }, r, { __kv: kv }); });
  assert.equal(nf, 404);
});

test('制作ライン：品質確認で2回とも不合格なら、社長の確認待ちに入れない。文章・商品は「表紙画像待ち」で保存し、失わない', async () => {
  const kv = memoryKv();
  const { steps, calls, prod } = await runCover(kv, { checks: [{ ...PASS, usingProduct: false, issues: ['傘の横に立っているだけ'] }, { ...PASS, consistent: false, issues: ['傘の骨が下を向いている'] }] });
  assert.deepEqual(steps, ['scene:true', 'image:true', 'imgcheck:true', 'image:true', 'imgcheck:true:done']);
  assert.equal(calls.images.length, 2, '1回の仕事で作り直しは1回まで');
  assert.equal(prod.result, 'cover_wait'); assert.equal(prod.textPass, true);
  assert.match(prod.why, /表紙画像待ち.*2回とも不合格：形・使い方に矛盾がない/);
  assert.equal(prod.set, undefined, 'アプリの確認待ちには渡さない');
  assert.equal(await S.get(kv, SET.id), null, 'サーバーの正本（社長の確認待ち）にも入れない');
  const w = await coverWaitList(kv);
  assert.equal(w.length, 1); assert.equal(w[0].set.id, SET.id); assert.equal(w[0].set.copy.caption, 'x', '文章は保存');
  assert.equal(prod.draft.title, SET.title, '下書きも記録に残る');
});

test('表紙画像待ちの投稿セットは、次の定期実行で表紙画像だけを作り直す（文章のAIは呼ばない）。合格したら社長の確認待ちに入る', async () => {
  const kv = memoryKv();
  const first = await runCover(kv, { checks: [{ ...PASS, usingProduct: false }, { ...PASS, usingProduct: false }] });
  assert.equal(first.prod.result, 'cover_wait');
  globalThis.fetch = original; original = null;
  // 翌日（画像の1日の上限が戻ったあと）を想定：画像の枚数を数え直す
  await kv.del(`budget:image:count:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}`);
  const calls = fake();
  const steps = [];
  for (let i = 0; i < 6; i++) {
    const r = await withUsage(() => tick({ kv, env: ENV, origin: ORIGIN, startedAt: Date.now() }));
    if (!r.worked) break;
    steps.push(`${r.worked.step}:${r.worked.ok}${r.worked.final ? ':' + r.worked.final : ''}`);
    if (r.worked.final) break;
  }
  assert.deepEqual(steps, ['scene:true', 'image:true', 'imgcheck:true:done']);
  assert.ok(calls.chat.every((b) => /表紙画像担当AI|品質確認の担当/.test(b.messages[0].content)), '文章・監査のAIは呼ばない');
  const prod = (await kv.listJson('worker:results:production', 5))[0];
  assert.equal(prod.result, 'pass'); assert.equal(prod.coverRetryOf, first.prod.id);
  assert.equal(prod.set.coverImage.status, 'ok');
  assert.ok(await S.get(kv, SET.id), '完成したので社長の確認待ちに入る');
  assert.equal((await coverWaitList(kv)).length, 0);
});

test('表紙画像待ち：使い方を商品データで確かめられない商品は作り直さない（費用をかけても変わらない）。作り直しは最大3回まで', async () => {
  const kv = memoryKv();
  const r = await runCover(kv, { scenes: [{ ...SCENE, usageQuote: '日傘級の遮光' }] });
  assert.deepEqual(r.steps, ['scene:true:done']);
  assert.equal(r.prod.result, 'cover_wait'); assert.match(r.prod.why, /保留/);
  assert.equal((await coverWaitList(kv)).length, 0, '作り直しの一覧に入れない');
  assert.equal(MAX_COVER_ROUNDS, 3);
});

test('制作ライン：画像の上限に達していたら、画像を作らずに「表紙画像待ち」で保存する（理由を残す）', async () => {
  const kv = memoryKv();
  await kv.incr(`budget:image:count:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}`); await kv.incr(`budget:image:count:${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}`);
  const { steps, calls, prod } = await runCover(kv);
  assert.deepEqual(steps, ['scene:true', 'image:true:done']);
  assert.equal(calls.images.length, 0);
  assert.equal(prod.result, 'cover_wait'); assert.match(prod.why, /今日の画像の上限/);
  assert.equal((await coverWaitList(kv)).length, 1);
});

test('制作ライン：画像生成が時間切れなら、作り直しは品質 low で。場面のAIが失敗しても、文章・商品は失わない', async () => {
  const kv = memoryKv();
  let n = 0;
  const r = await runCover(kv, { images: () => { if (++n === 1) { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } return json(200, { data: [{ b64_json: TINY_PNG }] }); } });
  assert.deepEqual(r.steps, ['scene:true', 'image:true', 'image:true', 'imgcheck:true:done']);
  assert.equal(r.calls.images[1].get('quality'), 'low');
  assert.equal(r.prod.set.coverImage.status, 'ok');
  globalThis.fetch = original; original = null;
  const kv2 = memoryKv();
  const r2 = await runCover(kv2, { scenes: 'x' });
  assert.deepEqual(r2.steps, ['scene:true:done']);
  assert.equal(r2.prod.result, 'cover_wait');
  assert.match(r2.prod.why, /場面を決められなかった/);
  assert.equal((await coverWaitList(kv2))[0].set.id, SET.id, '文章・商品は表紙画像待ちとして保存');
});
