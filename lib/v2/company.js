// サングラスくま株式会社 2.0（2026-11-15・docs/v2/design.md）：7人のAI社員が、1件の投稿セットを工程ごとに引き継いで完成させる。
//   1回の定期実行で1工程だけ進め、工程ごとに「開始・完成・引き継ぎ・待ち・止まった理由」を出来事の記録（v2:events）に残す。
//   画面（/v2/）はこの記録と今の仕事（v2:job）だけから作る（架空の作業履歴は作らない）。
//   中身の処理は1.0で動作を確かめたもの（楽天の検索・企画・文章・監査・修正・表紙画像）をそのまま呼ぶ。
import crypto from 'node:crypto';
import { searchPage, lookupItem } from '../rakuten.js';
import { runWithModels, compact, maskSecrets, NG_RE } from '../ai.js';
import { takeCalls } from '../ai-usage.js';
import { check as budgetCheck, record as budgetRecord, spent as budgetSpent, limits as budgetLimits, imageCheck, imageSpent, imageLimits, jstDate } from '../budget.js';
import * as P from '../production.js';
import { toItem, qualityCheck, MIN_ITEMS } from '../postset.js';
import * as C from '../kuma-cover.js';
import { seasonWords } from '../buyer-angles.js';

// ---- 社員 ----
export const STAFF = [
  { id: 'buyer', name: 'バイヤー', job: '商品を探す' },
  { id: 'auditor', name: '監査', job: '確かめる' },
  { id: 'planner', name: '企画', job: '構成を考える' },
  { id: 'writer', name: 'ライター', job: '文章を書く' },
  { id: 'editor', name: '編集', job: '直す' },
  { id: 'designer', name: 'デザイナー', job: '画像を作る' },
  { id: 'pr', name: '広報', job: '仕上げて届ける' }
];
export const staffName = (id) => (STAFF.find((s) => s.id === id) || {}).name || id;

// ---- 工程（仕事の型「投稿セット」）：担当・社長向けの説明・次の工程。将来の事業（note など）は別の型を足す ----
export const STEPS = {
  find: { agent: 'buyer', doing: '楽天で主役の商品を探しています', est: 1 },
  checkHero: { agent: 'auditor', doing: '商品が今も買えるか、楽天で確かめています', est: 0 },
  plan: { agent: 'planner', doing: '投稿の構成を考えています', est: 1 },
  gather: { agent: 'buyer', doing: '一緒に紹介する商品を楽天で探しています', est: 0 },
  pick: { agent: 'buyer', doing: '一緒に紹介する商品を選んでいます', est: 1 },
  copy: { agent: 'writer', doing: 'Instagramの文章を書いています', est: 1 },
  room: { agent: 'writer', doing: '楽天ROOMの紹介文を書いています', est: 1 },
  auditText: { agent: 'auditor', doing: '文章に作り話や誇張がないか確かめています', est: 1 },
  edit: { agent: 'editor', doing: '指摘された文章を直しています', est: 1 },
  scene: { agent: 'designer', doing: 'くまが商品を使う場面を考えています', est: 1 },
  image: { agent: 'designer', doing: '表紙画像を描いています', est: 0 },
  checkImage: { agent: 'auditor', doing: '画像に間違いがないか確かめています', est: 1 },
  pack: { agent: 'pr', doing: '完成品に仕上げています', est: 0 }
};
export const MAX_WAITING = 3;   // 社長の確認待ちの完成品がこの数になったら、新しくは作らない（見られない物に費用をかけない）
export const MAX_TRIES = 2;     // 1つの工程のやり直し
export const MAX_EDITS = 2;     // 監査→編集のやり直し
export const MAX_IMAGE_ROUNDS = 3; // 画像待ちから作り直す回数（日をまたぐ）
const THEMES = ['デスクまわりの便利グッズ', 'キッチンの時短グッズ', '部屋の収納', '防災の備え', '在宅ワーク', '旅行・出張の便利グッズ', '掃除の道具', '睡眠・リラックス', 'スマホまわりの小物', '季節の家電'];

const K = {
  job: 'v2:job', events: 'v2:events', sets: 'v2:sets', set: (id) => `v2:set:${id}`, imagewait: 'v2:imagewait', fixq: 'v2:fixq',
  used: 'v2:used', themeIdx: 'v2:themeIdx', sales: 'v2:sales', active: 'v2:active', lock: 'worker:lock', health: 'v2:health'
};
export { K as V2_KEYS };
const now = () => new Date().toISOString();
const newId = (p) => `${p}${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const short = (name) => P.programShortName(name);
const yenOf = (runs) => Math.round((runs || []).reduce((a, r) => a + (Number(r.yen) || 0), 0) * 1000) / 1000;

// ---- 出来事の記録（画面の唯一の材料） ----
//   type：start（開始）／done（完成）／handoff（引き継ぎ）／wait（待ち）／stop（止まった）／deliver（社長に届けた）／owner（社長の判断）
export async function record(kv, e) {
  const ev = { at: now(), ...e };
  if (ev.dev) ev.dev = maskSecrets(String(ev.dev)).slice(0, 300); // 開発者向けの記録（社長の画面には出さない）
  await kv.pushJson(K.events, ev, 400);
  return ev;
}
async function handoff(kv, job, to, what) {
  const from = STEPS[job.step].agent;
  if (from !== to) await record(kv, { job: job.id, agent: from, to, type: 'handoff', text: `${staffName(to)}へ引き継ぎ${what ? `（${what}）` : ''}` });
}

// ---- バイヤー：主役の商品を探す（楽天の検索 → AIが1点選ぶ：誰に・どんな悩みを解決するか・なぜ今） ----
const HERO_PROMPT = `あなたは「サングラスくま株式会社」のバイヤーです。忙しい社会人の「買い物の失敗を減らす」ために、楽天の検索結果から、投稿の主役にする商品を1つ選びます。JSONだけを返してください。
- 選ぶ基準：誰に・どんな悩みを解決するか・なぜ今買う価値があるか、を商品データ（商品名・説明・価格・レビュー）だけで言えるもの
- 商品データに無い機能・効果・人気は書かない。体験したような表現・誇張・医療の効果は書かない
- 出力形式: {"ref":"R1","who":"誰に（30字以内）","problem":"どんな悩みを解決するか（40字以内）","whyNow":"なぜ今（40字以内）"}`;
export function heroFilter(items, used = new Set()) {
  return items.filter((it) => it.image && it.price >= 800 && it.price <= 20000 && it.reviewCount >= 5 && !used.has(it.code) && !NG_RE.test(it.name));
}
async function findHero(job, ctx) {
  const i = Number(await ctx.kv.get(K.themeIdx)) || 0;
  await ctx.kv.set(K.themeIdx, String(i + 1));
  const custom = String(ctx.env.V2_THEMES || '').split(/[,、]/).map((t) => t.trim()).filter(Boolean); // 探すテーマを変えたいとき（環境変数）
  const themes = custom.length ? custom : [...seasonWords(), ...THEMES];
  const theme = themes[i % themes.length];
  const used = new Set((await ctx.kv.getJson(K.used)) || []);
  const r = await searchPage({ keyword: theme, env: ctx.env, referer: ctx.referer, sort: '-reviewCount', hits: 30 });
  const list = heroFilter(r.items, used).slice(0, 10).map((it, n) => ({ ...it, ref: `R${n + 1}` }));
  if (!list.length) return { fail: `「${theme}」で条件に合う商品が見つからなかった`, retry: true };
  const lines = list.map((it) => `${it.ref}: ${compact(it.name, 80)} / ${it.price}円 / レビュー${it.reviewCount}件（平均${it.reviewAverage}） / 説明: ${compact(it.caption, 150)}`).join('\n');
  let pick = null;
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: ctx.startedAt + 40000, system: HERO_PROMPT, userContent: `テーマ: ${theme}\n${lines}`, parse: (c) => { const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]); const it = list.find((x) => x.ref === String(d.ref || '').trim()); if (!it) throw new Error('選んだ商品が検索結果にありません'); return { it, who: String(d.who || '').slice(0, 40), problem: String(d.problem || '').slice(0, 60), whyNow: String(d.whyNow || '').slice(0, 60) }; } });
    pick = result;
  } catch (e) { return { fail: `商品を選べなかった：${String(e.message || e).slice(0, 80)}` }; }
  const it = pick.it;
  job.data.theme = theme;
  job.data.hero = { code: it.code, name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop, caption: it.caption, reviewCount: it.reviewCount, reviewAverage: it.reviewAverage, checkedAt: now(), who: pick.who, problem: pick.problem, whyNow: pick.whyNow };
  return { done: `「${short(it.name)}」を見つけた（${it.price.toLocaleString('ja-JP')}円・${pick.who}向け）`, next: 'checkHero', what: '商品の確認' };
}

// ---- 監査：主役の商品が今も買えるか（楽天で引き直す・コード） ----
async function checkHero(job, ctx) {
  const h = job.data.hero;
  const it = await lookupItem({ code: h.code, env: ctx.env, referer: ctx.referer });
  if (!it) { job.data.heroMiss = (job.data.heroMiss || 0) + 1; return job.data.heroMiss > 1 ? { fail: '主役の商品が楽天で見つからなかった（販売終了の可能性）' } : { done: '楽天で見つからなかったので、探し直してもらう', next: 'find', what: '別の商品を探す' }; }
  h.price = it.price; h.url = it.url || h.url; h.checkedAt = now();
  return { done: `楽天で確認した（${it.price.toLocaleString('ja-JP')}円・購入できる）`, next: 'plan', what: '投稿の構成' };
}

// ---- 企画：構成を決める（1.0の planStep） ----
async function plan(job, ctx) {
  const h = job.data.hero;
  const source = P.fromCandidates([{ code: h.code, name: h.name, price: h.price, url: h.url, image: h.image, shop: h.shop, quotes: [String(h.caption || '').slice(0, 300)], reason: `${h.who}の「${h.problem}」に。${h.whyNow}`, target: h.who, score: null, checkedAt: h.checkedAt }]);
  if (!source.length) return { fail: '主役の商品のデータが足りない（楽天の商品URLが無い）' };
  job.data.source = source;
  const d = take(job, await P.planStep({ source, history: [], recentPatterns: job.data.recentPatterns || [], env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  job.data.plan = d.plan;
  return { done: `構成「${d.plan.title}」を作った（${d.plan.slots.length}枠）`, next: 'gather', what: '一緒に紹介する商品' };
}
async function gather(job, ctx) {
  const used = (await ctx.kv.getJson(K.used)) || [];
  const d = await P.gatherStep({ plan: job.data.plan, source: job.data.source, exclude: used, env: ctx.env, referer: ctx.referer, startedAt: ctx.startedAt });
  job.data.gathered = { fresh: d.fresh, missing: d.missing, slotResults: d.slotResults.map((x) => ({ ...x, candidates: x.candidates.slice(0, 6) })) };
  const n = d.slotResults.reduce((a, s) => a + s.candidates.length, 0);
  if (!n && !d.fresh.length) return { fail: '一緒に紹介する商品が楽天で見つからなかった' };
  return { done: `楽天で候補を${n}点集めた`, next: 'pick' };
}
async function pick(job, ctx) {
  const g = job.data.gathered;
  const d = take(job, await P.pickStep({ id: `set-${job.id}`, plan: job.data.plan, fresh: g.fresh, missing: g.missing, slotResults: g.slotResults, sourceCount: job.data.source.length, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  // AIの選んだ商品が3点に届かないとき（重複を外した等）は、集めた候補から重複しない商品をレビューの多い順に補う（説明はその商品データの言葉だけ）
  if (d.set.items.length < MIN_ITEMS) {
    const have = new Set(d.set.items.map((it) => it.code));
    const pool = [];
    g.slotResults.forEach((sl, si) => sl.candidates.forEach((c) => { if (c.code && !have.has(c.code) && c.image && c.url) pool.push({ slot: si, item: c }); }));
    pool.sort((a, b) => (Number(b.item.reviewCount) || 0) - (Number(a.item.reviewCount) || 0));
    for (const p of pool) {
      if (d.set.items.length >= MIN_ITEMS) break;
      if (have.has(p.item.code)) continue;
      have.add(p.item.code);
      const feature = P.factPhrases(p.item, { max: 30 })[0] || short(p.item.name);
      d.set.items.push({ ...toItem({ slot: p.slot, item: p.item, feature, why: '' }, (job.data.plan.slots[p.slot] || {}).role || '候補', new Date()), filledBy: 'program' });
    }
    d.set.issues = qualityCheck(d.set);
  }
  if (d.set.issues.length) return { fail: `商品が3点そろわなかった（${d.set.issues.join('／').slice(0, 80)}）` };
  job.data.set = d.set; delete job.data.gathered;
  return { done: `${d.set.items.length}点の商品をそろえた`, next: 'copy', what: '文章' };
}

// ---- ライター ----
async function copy(job, ctx) {
  const d = take(job, await P.copyStep({ set: job.data.set, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  job.data.set.copy = d.copy;
  return { done: `Instagramの文章を書いた（${d.copy.body.length}字）`, next: 'room' };
}
async function room(job, ctx) {
  const d = take(job, await P.roomStep({ set: job.data.set, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  job.data.set.roomTexts = d.roomTexts;
  return { done: `楽天ROOMの紹介文を${d.roomTexts.length}件書いた`, next: 'auditText', what: '文章の確認' };
}

// ---- 監査：文章（コードの確認＋監査AI。点数は社長の画面に出さない） ----
async function auditText(job, ctx) {
  const check = P.codeCheck(job.data.set);
  const d = take(job, await P.auditSetStep({ set: job.data.set, check, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  const edits = job.data.edits || 0;
  const dc = P.decideSet({ check, audit: d.audit, revisions: edits });
  job.data.audits = [...(job.data.audits || []), { at: now(), total: d.audit.total, status: dc.status, why: dc.why }].slice(-4); // 品質の記録（開発者向け）
  job.data.lastAudit = { check, audit: d.audit };
  if (dc.status === 'pass') return job.kind === 'fix' ? { done: '直した文章を確認した（問題なし）', next: 'pack', what: '仕上げ' } : { done: '文章を確認した（問題なし）', next: 'scene', what: '表紙画像' };
  if (dc.status === 'revise' && edits < MAX_EDITS) return { done: '直してほしい点を見つけた', next: 'edit', what: '文章の修正' };
  return { fail: `文章が基準に届かなかった（${edits}回直しても）`, dev: `${dc.why}／監査の要約：${String(d.audit.summary || '').slice(0, 120)}／指摘：${(d.audit.fixes || []).map((f) => `${f.target}:${f.text}`).join('｜').slice(0, 120)}`, final: true };
}
// ---- 編集：監査の指摘・社長の修正依頼で直す ----
async function edit(job, ctx) {
  const set = job.data.set;
  const owner = job.kind === 'fix' && !job.data.ownerApplied ? job.data.ownerNote : '';
  const audit = owner ? { fixes: [{ target: 'caption', text: `社長の修正依頼：${owner}` }, ...set.items.map((_, i) => ({ target: `room:${i + 1}`, text: `社長の修正依頼：${owner}` }))], summary: `社長の修正依頼：${owner}`, flags: {} } : job.data.lastAudit.audit;
  const check = owner ? { checks: [] } : job.data.lastAudit.check;
  const d = take(job, await P.editStep({ set, audit, check, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  const a = P.applyEdit(set, d.edit);
  job.data.set = a.set;
  // 監査が「商品データに無い表現」を指摘したROOM紹介文は、事実だけの紹介文（プログラム）に置き換える（AIの書き直しは再発するため）
  const fl = (audit && audit.flags) || {};
  if (fl.fabrication || fl.unverified) {
    const ns = [...new Set((audit.fixes || []).map((f) => String(f.target || '').replace(/\s/g, '')).filter((t) => /^room:\d+$/.test(t)).map((t) => Number(t.split(':')[1])))];
    ns.forEach((n) => { const it = job.data.set.items[n - 1]; if (it && job.data.set.roomTexts && job.data.set.roomTexts[n - 1]) { job.data.set.roomTexts[n - 1] = { ...job.data.set.roomTexts[n - 1], intro: P.factRoomIntro(it, job.data.set), introFrom: '商品データ（事実だけ）' }; if (!a.changed.includes(`room:${n}`)) a.changed.push(`room:${n}`); } });
  }
  if (owner) job.data.ownerApplied = true; else job.data.edits = (job.data.edits || 0) + 1;
  const where = a.changed.map((c) => (c === 'caption' ? 'Instagramの文章' : /^room/.test(c) ? `ROOM紹介文${c.split(':')[1]}` : `商品カード${c.split(':')[1]}`));
  return { done: where.length ? `${[...new Set(where)].join('・')}を直した` : '直す所が見つからなかった', next: 'auditText', what: '直した文章の確認' };
}

// ---- デザイナー：表紙画像（画像の予算を使い切っていたら、画像待ちにして翌日続きから） ----
async function scene(job, ctx) {
  const d = take(job, await C.sceneStep({ set: job.data.set, history: await C.sceneHistory(ctx.kv), env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  if (d.skip) return { fail: `場面を決められなかった（${d.skip}）`, final: d.retry === false };
  job.data.cover = { scene: d.scene, item: d.item, tries: 0 };
  return { done: `場面を決めた（${String(d.scene.place).slice(0, 20)}・${String(d.scene.usage || d.scene.action).slice(0, 30)}）`, next: 'image' };
}
async function image(job, ctx) {
  const ib = await imageCheck(ctx.kv, ctx.env);
  if (!ib.ok) return { wait: `画像の予算（${ib.reason}）。明日、続きから描きます` };
  const cv = job.data.cover;
  const d = await C.imageStep({ kv: ctx.kv, env: ctx.env, origin: ctx.origin, scene: cv.scene, item: cv.item, startedAt: ctx.startedAt });
  if (d.run) job.runs.push({ ...d.run, yen: 0 }); // 画像の費用は画像の予算で数える（記録には残す）
  if (d.skip) return { wait: `画像を描けなかった（${d.skip}）。明日、続きから描きます` };
  cv.tries += 1;
  if (!d.ok) return { fail: d.error };
  cv.mediaId = await C.saveMedia(ctx.kv, d.b64); cv.costYen = d.cost.yen; cv.model = d.model;
  return { done: '表紙画像を描いた', next: 'checkImage', what: '画像の確認' };
}
async function checkImage(job, ctx) {
  const cv = job.data.cover;
  const b64 = await C.getMedia(ctx.kv, cv.mediaId);
  if (!b64) return { fail: '描いた画像が見つからない' };
  const { MASTERS } = await import('../kuma-master-manifest.js');
  const master = MASTERS.find((m) => m.kind === 'front') || MASTERS[0];
  const d = take(job, await C.checkStep({ b64, masterUrl: new URL(`/assets/kuma-master/${master.file}`, ctx.origin).toString(), productUrl: cv.item.image, scene: cv.scene, env: ctx.env, startedAt: ctx.startedAt }));
  if (!d.ok) return { fail: d.error };
  if (d.check.pass) {
    job.data.set.coverImage = { status: 'ok', mediaId: cv.mediaId, scene: cv.scene, item: cv.item.name, label: 'AI生成イメージ', model: cv.model, costYen: cv.costYen, at: now() };
    await C.pushScene(ctx.kv, cv.scene);
    return { done: '画像を確認した（問題なし）', next: 'pack', what: '仕上げ' };
  }
  job.data.imageNg = d.check.ng;
  return { wait: `画像に直したい点があった（${d.check.ng.slice(0, 3).map((k) => C.CHECK_LABEL[k] || k).join('・')}）。明日、描き直します`, back: 'image' };
}

// ---- 広報：完成品に仕上げて社長に届ける（コード） ----
async function pack(job, ctx) {
  const s = job.data.set;
  const cap = (s.copy && s.copy.caption) || '';
  if (!/アフィリエイト|PR/.test(cap)) return { fail: 'PR（アフィリエイト）の表記が無い', final: true };
  if (!s.coverImage || s.coverImage.status !== 'ok') return { fail: '表紙画像が無い', final: true };
  const product = s.items.map((it, i) => ({ name: it.name, short: short(it.name), price: it.price, url: it.url, image: it.image, shop: it.shop, room: ((s.roomTexts || [])[i] || {}).intro || '', tags: ((s.roomTexts || [])[i] || {}).tags || [] }));
  const out = {
    id: job.data.setId || s.id, title: s.title, theme: job.data.theme || '', who: (job.data.hero || {}).who || s.target || '', problem: (job.data.hero || {}).problem || '', whyNow: (job.data.hero || {}).whyNow || '',
    caption: cap, products: product, image: { mediaId: s.coverImage.mediaId, url: `/api/media?id=${s.coverImage.mediaId}`, label: 'AI生成イメージ' },
    status: 'waiting', deliveredAt: now(), jobId: job.id, revisions: (job.data.revisionCount || 0) + (job.kind === 'fix' ? 1 : 0), ownerNote: job.data.ownerNote || '',
    dev: { audits: job.data.audits || [], yen: yenOf(job.runs), scene: s.coverImage.scene }
  };
  await ctx.kv.setJson(K.set(out.id), { ...out, raw: s });
  const list = ((await ctx.kv.getJson(K.sets)) || []).filter((x) => x.id !== out.id);
  await ctx.kv.setJson(K.sets, [{ id: out.id, title: out.title, status: 'waiting', deliveredAt: out.deliveredAt, image: out.image.url }, ...list].slice(0, 60));
  await ctx.kv.setJson(K.used, [...new Set([...s.items.map((it) => it.code), ...((await ctx.kv.getJson(K.used)) || [])])].slice(0, 600));
  return { done: '完成品に仕上げた', deliver: `社長に完成品「${s.title}」を届けた${job.kind === 'fix' ? '（修正版）' : ''}` };
}

const RUN = { find: findHero, checkHero, plan, gather, pick, copy, room, auditText, edit, scene, image, checkImage, pack };
function take(job, d) { job.runs.push(...(d.runs || [])); return d; }

// ---- 次の仕事を選ぶ（社長の修正依頼 → 画像待ち → 新しい投稿セット） ----
async function waitingCount(kv) { return ((await kv.getJson(K.sets)) || []).filter((x) => x.status === 'waiting').length; }
export async function nextJob(kv, env) {
  const fixq = (await kv.getJson(K.fixq)) || [];
  if (fixq.length) {
    const f = fixq[0];
    await kv.setJson(K.fixq, fixq.slice(1));
    const saved = await kv.getJson(K.set(f.id));
    if (saved && saved.raw) return { job: { id: newId('fix'), kind: 'fix', step: 'edit', startedAt: now(), attempts: 0, runs: [], data: { set: saved.raw, setId: f.id, ownerNote: f.note, theme: saved.theme, hero: { who: saved.who, problem: saved.problem, whyNow: saved.whyNow }, revisionCount: saved.revisions || 0 } }, why: '社長の修正依頼' };
  }
  const waits = (await kv.getJson(K.imagewait)) || [];
  if (waits.length) {
    const ib = await imageCheck(kv, env);
    if (ib.ok) { await kv.setJson(K.imagewait, waits.slice(1)); const j = waits[0]; return { job: { ...j, attempts: 0, resumedAt: now() }, why: '画像待ちの続き' }; }
  }
  const w = await waitingCount(kv);
  if (w >= MAX_WAITING) return { idle: `社長の確認待ちの完成品が${w}件あるため、新しくは作りません（見られない物に費用をかけない）` };
  return { job: { id: newId('job'), kind: 'make', step: 'find', startedAt: now(), attempts: 0, runs: [], data: {} }, why: '新しい投稿セット' };
}

// ---- 1回の定期実行：1工程だけ進める ----
export async function tick({ kv, env, referer = '', origin = '', startedAt = Date.now(), trigger = '' }) {
  const token = `${startedAt}-${crypto.randomBytes(4).toString('hex')}`;
  if (!(await kv.set(K.lock, token, { nx: true, ex: 58 }))) return { ok: true, skipped: '前の実行がまだ動いています（二重実行の防止）' };
  const health = (await kv.getJson(K.health)) || {};
  health.lastTickAt = now(); health.trigger = trigger;
  try {
    let job = await kv.getJson(K.job);
    if (!job) {
      const n = await nextJob(kv, env);
      if (n.idle) { health.idle = n.idle; await kv.setJson(K.health, health); return { ok: true, idle: n.idle }; }
      job = n.job;
      if (n.why === '新しい投稿セット' || n.why === '社長の修正依頼') await record(kv, { job: job.id, agent: STEPS[job.step].agent, type: 'start', text: n.why === '社長の修正依頼' ? `社長の修正依頼で「${job.data.set.title}」を直し始めた` : '新しい投稿セットの仕事を始めた' });
      if (n.why === '画像待ちの続き') await record(kv, { job: job.id, agent: 'designer', type: 'start', text: `画像待ちだった「${job.data.set.title}」の続きを始めた` });
    }
    delete health.idle;
    const st = STEPS[job.step];
    if (!st) { await kv.del(K.job); return { ok: false, error: `不明な工程 ${job.step}` }; }
    const b = await budgetCheck(kv, env, { estimate: Math.max(0.01, st.est), auto: true });
    if (!b.ok) { health.blocked = b.reason; await kv.setJson(K.job, job); await kv.setJson(K.health, health); return { ok: true, skipped: b.reason }; }
    delete health.blocked;
    job.current = { step: job.step, agent: st.agent, doing: st.doing, at: now() };
    await kv.setJson(K.job, job); // 画面に「今この社員がこの仕事をしている」と出すため、始める前に保存
    const before = job.runs.length;
    const agent0 = st.agent;
    const ctx = { kv, env, referer, origin, startedAt };
    let r;
    try { r = await RUN[job.step](job, ctx); } catch (e) { r = { fail: String(e && e.message || e).slice(0, 200) }; }
    job.runs.push(...takeCalls().map((c) => ({ ...c, role: agent0 }))); // 工程の中で記録しきれなかったAIの呼び出しも費用に数える
    const runs = job.runs.slice(before);
    const yen = yenOf(runs);
    await budgetRecord(kv, yen, { auto: true });
    const agent = st.agent;
    let out = { ok: true, worked: { job: job.id, step: job.step, agent, yen } };
    if (r.fail) {
      job.attempts = (job.attempts || 0) + 1;
      if (job.attempts >= MAX_TRIES || r.final) {
        await record(kv, { job: job.id, agent, type: 'stop', text: `止まった：${r.fail}`, dev: r.dev || r.fail });
        await kv.del(K.job); out.worked.final = 'stop';
      } else {
        await record(kv, { job: job.id, agent, type: 'retry', text: `うまくいかなかったので、次の回にやり直す（${r.fail}）`, dev: r.fail });
        delete job.current; await kv.setJson(K.job, job);
      }
    } else if (r.wait) {
      const waits = (await kv.getJson(K.imagewait)) || [];
      job.step = r.back || job.step; job.data.imageRounds = (job.data.imageRounds || 0) + 1; delete job.current; job.attempts = 0;
      if (job.data.imageRounds > MAX_IMAGE_ROUNDS) { await record(kv, { job: job.id, agent, type: 'stop', text: `止まった：画像が${MAX_IMAGE_ROUNDS}日続けて完成しなかった` }); }
      else { await record(kv, { job: job.id, agent, type: 'wait', text: r.wait }); await kv.setJson(K.imagewait, [...waits.filter((x) => x.id !== job.id), job].slice(-5)); }
      await kv.del(K.job); out.worked.final = 'wait';
    } else {
      await record(kv, { job: job.id, agent, type: 'done', text: r.done, yen: yen || undefined });
      if (r.deliver) {
        await record(kv, { job: job.id, agent: 'pr', type: 'deliver', text: r.deliver, set: job.data.setId || job.data.set.id });
        await kv.del(K.job); out.worked.final = 'deliver';
      } else {
        await handoff(kv, job, STEPS[r.next].agent, r.what);
        job.step = r.next; job.attempts = 0; delete job.current;
        await kv.setJson(K.job, job);
      }
    }
    await kv.setJson(K.health, health);
    return out;
  } finally {
    await kv.delIf(K.lock, token).catch(() => {});
  }
}

// ---- 社長の画面に渡す状態（点数・技術ログは渡さない） ----
export async function officeState(kv, env) {
  const [job, events, sets, waits, fixq, health, active, sales] = await Promise.all([kv.getJson(K.job), kv.listJson(K.events, 150), kv.getJson(K.sets), kv.getJson(K.imagewait), kv.getJson(K.fixq), kv.getJson(K.health), kv.get(K.active), kv.getJson(K.sales)]);
  const evs = (events || []).map(({ dev, ...e }) => e);
  const lastDone = (agent) => evs.find((e) => e.agent === agent && (e.type === 'done' || e.type === 'deliver'));
  const staff = STAFF.map((s) => {
    const working = job && job.current && job.current.agent === s.id;
    const waiting = s.id === 'designer' && (waits || []).length && !working;
    const last = lastDone(s.id);
    return { ...s, status: working ? 'work' : waiting ? 'wait' : 'idle', doing: working ? job.current.doing : waiting ? `画像待ちが${waits.length}件（画像の予算が戻ったら描く）` : '', title: working && job.data && (job.data.set || job.data.plan) ? (job.data.set || job.data.plan).title : '', last: last ? { at: last.at, text: last.text } : null };
  });
  const [sp, lim, isp, ilim] = await Promise.all([budgetSpent(kv), Promise.resolve(budgetLimits(env)), imageSpent(kv), Promise.resolve(imageLimits(env))]);
  const month = jstDate().slice(0, 7);
  return {
    at: now(), active: active === '1', staff,
    job: job ? { id: job.id, kind: job.kind, step: job.step, agent: STEPS[job.step] ? STEPS[job.step].agent : '', title: job.data && (job.data.set || job.data.plan) ? (job.data.set || job.data.plan).title : '' } : null,
    events: evs, sets: sets || [], waiting: (sets || []).filter((x) => x.status === 'waiting').length, imageWait: (waits || []).map((w) => ({ id: w.id, title: w.data && w.data.set ? w.data.set.title : '' })), fixq: (fixq || []).length,
    idle: health && health.idle ? health.idle : '', blocked: health && health.blocked ? health.blocked : '', lastTickAt: health ? health.lastTickAt : '',
    money: { spent: sp, limits: lim, image: isp, imageLimits: ilim, salesMonth: Number((sales || {})[month]) || 0, month }
  };
}
export async function getSet(kv, id) { const s = await kv.getJson(K.set(String(id).replace(/[^\w.:-]/g, ''))); if (!s) return null; const { raw, dev, ...pub } = s; return pub; }

// ---- 社長の判断：採用・却下・修正依頼（修正依頼は編集→監査→広報で直して届け直す） ----
export async function decide(kv, { id, action, note = '' }) {
  const s = await kv.getJson(K.set(id));
  if (!s) throw new Error('その完成品はありません');
  if (!['adopt', 'reject', 'revise'].includes(action)) throw new Error('判断の種類が分かりません');
  const status = action === 'adopt' ? 'adopted' : action === 'reject' ? 'rejected' : 'fixing';
  const n = String(note || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 200);
  if (action === 'revise' && !n) throw new Error('どこを直すか書いてください');
  await kv.setJson(K.set(id), { ...s, status, decidedAt: now(), ownerNote: n || s.ownerNote || '' });
  const list = ((await kv.getJson(K.sets)) || []).map((x) => (x.id === id ? { ...x, status } : x));
  await kv.setJson(K.sets, list);
  if (action === 'revise') await kv.setJson(K.fixq, [...((await kv.getJson(K.fixq)) || []).filter((x) => x.id !== id), { id, note: n, at: now() }]);
  await record(kv, { job: s.jobId, agent: 'owner', type: 'owner', text: `社長が「${s.title}」を${({ adopt: '採用', reject: '却下', revise: `修正依頼（${n}）` })[action]}` });
  return { id, status };
}
export async function setSales(kv, { month, yen }) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('月の形が違います');
  const v = Math.max(0, Math.min(10000000, Math.round(Number(yen) || 0)));
  const s = (await kv.getJson(K.sales)) || {}; s[month] = v; await kv.setJson(K.sales, s);
  return s;
}
export async function setActive(kv, on) { await kv.set(K.active, on ? '1' : '0'); await record(kv, { agent: 'owner', type: 'owner', text: on ? '社長が会社を2.0に切り替えた（定期実行で2.0が働く）' : '社長が1.0に戻した' }); return on; }
export async function isActive(kv) { return (await kv.get(K.active)) === '1'; }
