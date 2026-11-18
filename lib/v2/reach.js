// サングラスくま株式会社 2.0：集客（2026-11-18 社長の方針：制作と集客の両輪。目標は閲覧・プロフィール閲覧・楽天ROOMへの流入・売上）
//   - 冒頭の一言（ライターの仕事探し）：完成品ごとに、リールの冒頭・キャプションの1行目を作る。商品データに無いこと・体験談・断定はコードで落とす
//   - 投稿の実績：社長がInstagramのインサイトの数字を登録する（スクショを入れると、画像を読むAIが数字を読み取り、社長が確かめて登録）。推測で埋めない
//   - 実績のまとめ：段階の目標（1投稿あたり閲覧100・300・1,000回。保証ではない）・形式とテーマごとの比較。企画（次の案件）に渡す
//   - リールを作った記録（リールは端末で作る：v2/reel.js）
//   Instagramへの投稿・コメント・いいね・フォローはしない（公式APIで他の人への操作はできず、自分の投稿の公開もこのアプリでは社長が手で行う）
import crypto from 'node:crypto';
import { runWithModels, NG_RE } from '../ai.js';
import { takeCalls } from '../ai-usage.js';
import { check as budgetCheck, record as budgetRecord } from '../budget.js';
import { MEDICAL_RE } from '../agents.js';
import { reelFileOk } from './kpi.js';

const K = { perf: 'v2:perf', reels: 'v2:reels', sets: 'v2:sets', set: (id) => `v2:set:${id}` };
export { K as REACH_KEYS };
export const MILESTONES = [100, 300, 1000];
export const FORMATS = { reel: 'リール', feed: 'フィード（カルーセル）', story: 'ストーリーズ' };
const now = () => new Date().toISOString();
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null; };

// ---- 冒頭の一言（ライター） ----
const HOOK_RISK = /私|僕|使ってみ|愛用|買ってよかった|最強|最高|絶対|必ず|No\.?\s*1|一番売れ|ランキング|人気|バズ|神|激安|最安|高級品(と|並み)|同等|匹敵|治る|効く|改善/;
export function hookOk(text, set) {
  const t = String(text || '').trim();
  if (!t || t.length > 28 || HOOK_RISK.test(t) || NG_RE.test(t) || MEDICAL_RE.test(t)) return false;
  const data = JSON.stringify((set.products || []).map((p) => [p.name, p.price])) + (set.title || '');
  return (t.match(/\d[\d,]*/g) || []).every((d) => data.includes(d.replace(/,/g, '')) || data.includes(d)); // 数字は商品データにあるものだけ（価格など）
}
const HOOK_PROMPT = `あなたは「サングラスくま株式会社」のライターです（集客の担当）。Instagramのリールの最初の2秒と、キャプションの1行目で、スクロールを止めてもらう短い一言を作ります。JSONだけを返してください。
- 誰の・どんな悩み・場面に刺さるかが一瞬で分かる、自然で短い日本語（各28字以内）。問いかけ・意外性・具体的な場面を使ってよい
- 書かない：体験談（使ってみた・愛用）、人気・ランキング・最強・最安・絶対、商品データに無い数字や性能、医療の効果、「高級品と同等」
- reveal：用途を途中で明かすリールの冒頭（商品名は出さず、何に使うか想像させる）
- compare：高い物と安い物を比べるリールの冒頭（同じ用途の2点がある企画だけ。無ければ空）
- top3：3選のリールの冒頭
- caption：フィード・リールのキャプションの1行目
出力形式: {"reveal":"...","compare":"","top3":"...","caption":"..."}`;
export async function hooksWork(kv) {
  const list = ((await kv.getJson(K.sets)) || []).filter((x) => ['waiting', 'adopted', 'posted'].includes(x.status)).slice(0, 15);
  for (const x of list) {
    const s = await kv.getJson(K.set(x.id));
    if (!s || s.hooks || (s.hooksTries || 0) >= 2) continue;
    return { kind: 'hooks', task: `完成品「${s.title}」のリールの冒頭とキャプションの1行目を作る（集客）`, doing: 'リールとキャプションの冒頭の一言を作っています', est: 1, run: (ctx) => hooksRun(kv, ctx, s.id) };
  }
  return null;
}
async function hooksRun(kv, ctx, id) {
  const s = await kv.getJson(K.set(id));
  if (!s) return { fail: '完成品が見つからない' };
  const lines = (s.products || []).map((p, i) => `${i + 1}. ${p.role || ''}：${String(p.name || '').slice(0, 50)}（${p.price}円）`).join('\n');
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: Date.now() + 30000, system: HOOK_PROMPT, userContent: `企画: ${s.title}／誰に: ${s.who || s.target || ''}／悩み: ${s.problem || ''}\n${lines}`, parse: (c) => JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]) });
    const hooks = {}; const ng = [];
    for (const k of ['reveal', 'compare', 'top3', 'caption']) { const t = str(result[k], 40); if (!t) continue; if (hookOk(t, s)) hooks[k] = t; else ng.push(`${k}「${t}」`); }
    if (!Object.keys(hooks).length) { await kv.setJson(K.set(id), { ...s, hooksTries: (s.hooksTries || 0) + 1 }); return { fail: `決まりに合う一言が無かった（${ng.join('・').slice(0, 80)}）` }; }
    await kv.setJson(K.set(id), { ...s, hooks: { ...hooks, at: now() } });
    return { done: `「${s.title}」の冒頭の一言を作った（${Object.values(hooks).slice(0, 2).join('／').slice(0, 60)}${ng.length ? `。決まりに合わない${ng.length}件は使わない` : ''}）`, title: s.title };
  } catch (e) { return { fail: String(e.message || e).slice(0, 120) }; }
}

// ---- 投稿の実績 ----
export function readPerf(x = {}) {
  const format = FORMATS[x.format] ? x.format : 'reel';
  const r = {
    id: str(x.id, 40) || `perf${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
    setId: str(x.setId, 60), title: str(x.title, 60), format, theme: str(x.theme, 40),
    postedAt: /^\d{4}-\d{2}-\d{2}/.test(String(x.postedAt || '')) ? String(x.postedAt).slice(0, 10) : '',
    url: /^https:\/\/(www\.)?instagram\.com\//.test(String(x.url || '')) ? String(x.url).slice(0, 200) : '',
    views: num(x.views), reach: num(x.reach), nonFollowerPct: num(x.nonFollowerPct), saves: num(x.saves), shares: num(x.shares), likes: num(x.likes), comments: num(x.comments),
    profileVisits: num(x.profileVisits), linkClicks: num(x.linkClicks), roomClicks: num(x.roomClicks), sales: num(x.sales),
    tactics: (Array.isArray(x.tactics) ? x.tactics : []).map((t) => str(t, 40).replace(/[^\w-]/g, '')).filter(Boolean).slice(0, 6), // 使った集客の施策（growth.js で効果を比べる）
    source: ['owner', 'screenshot'].includes(x.source) ? x.source : 'owner', note: str(x.note, 120), at: now()
  };
  if (r.nonFollowerPct != null && r.nonFollowerPct > 100) r.nonFollowerPct = null;
  return r;
}
export async function addPerf(kv, x) {
  const r = readPerf(x);
  if (r.views == null && r.reach == null) throw new Error('閲覧数かリーチのどちらかを入れてください');
  if (r.setId && !r.title) { const s = await kv.getJson(K.set(r.setId)); if (s) { r.title = s.title; r.theme = r.theme || s.theme || ''; } }
  const list = (await kv.getJson(K.perf)) || [];
  await kv.setJson(K.perf, [r, ...list.filter((y) => y.id !== r.id)].slice(0, 300));
  return r;
}
export async function removePerf(kv, id) { const list = (await kv.getJson(K.perf)) || []; await kv.setJson(K.perf, list.filter((y) => y.id !== id)); return { ok: true }; }

// インサイトのスクショから数字を読む（画像を読むAI 1回・約1円）。読めない数字は空のまま（推測しない）。登録は社長が確かめてから
const READ_PROMPT = `Instagramのインサイト（投稿・リールの分析）の画面のスクリーンショットから、画面に書かれている数字だけを読み取ります。JSONだけを返してください。
- 画面に見えない数字は null（推測・計算で埋めない）。「1.2万」は12000、「1,234」は1234
- views：閲覧数（再生数・ビュー）／reach：リーチしたアカウント数／nonFollowerPct：フォロワー以外の割合（%の数字）／likes・comments・saves（保存）・shares（シェア）／profileVisits：プロフィールのアクティビティ・プロフィールへのアクセス／linkClicks：リンクのタップ・外部リンク
- format：画面から分かれば reel／feed／story、分からなければ null。postedAt：投稿日が見えれば YYYY-MM-DD
出力形式: {"views":null,"reach":null,"nonFollowerPct":null,"likes":null,"comments":null,"saves":null,"shares":null,"profileVisits":null,"linkClicks":null,"format":null,"postedAt":null,"note":"読めなかった項目など"}`;
export async function readInsight(kv, env, { image }) {
  const m = String(image || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('スクショの画像を選んでください');
  if (m[2].length > 1600 * 1024) throw new Error('画像が大きすぎます');
  const b = await budgetCheck(kv, env, { estimate: 2 });
  if (!b.ok) throw new Error(b.reason);
  try {
    const { result } = await runWithModels({ env, deadline: Date.now() + 35000, system: READ_PROMPT, userContent: [{ type: 'text', text: 'このスクリーンショットの数字を読んでください' }, { type: 'image_url', image_url: { url: `data:image/${m[1]};base64,${m[2]}`, detail: 'high' } }], parse: (c) => JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]) });
    const f = readPerf({ ...result, source: 'screenshot', format: result.format || 'reel' });
    return { read: { views: f.views, reach: f.reach, nonFollowerPct: f.nonFollowerPct, likes: f.likes, comments: f.comments, saves: f.saves, shares: f.shares, profileVisits: f.profileVisits, linkClicks: f.linkClicks, format: result.format || '', postedAt: f.postedAt }, note: str(result.note, 160) };
  } finally {
    const yen = Math.round(takeCalls().reduce((a, c) => a + (Number(c.yen) || 0), 0) * 1000) / 1000;
    await budgetRecord(kv, yen, { auto: false });
  }
}

// ---- まとめ（画面と企画に渡す） ----
export function summarize(list) {
  const v = (r) => (r.views != null ? r.views : r.reach);
  const withV = list.filter((r) => v(r) != null);
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const byFormat = {};
  for (const r of withV) (byFormat[r.format] = byFormat[r.format] || []).push(r);
  const formats = Object.entries(byFormat).map(([f, a]) => ({ format: f, label: FORMATS[f], posts: a.length, avgViews: avg(a.map(v)), avgSaves: avg(a.filter((r) => r.saves != null).map((r) => r.saves)), avgProfile: avg(a.filter((r) => r.profileVisits != null).map((r) => r.profileVisits)), avgNonFollower: avg(a.filter((r) => r.nonFollowerPct != null).map((r) => r.nonFollowerPct)) }));
  const best = [...withV].sort((a, b) => v(b) - v(a)).slice(0, 5).map((r) => ({ title: r.title || r.theme || '（題名なし）', format: FORMATS[r.format], views: v(r), saves: r.saves, profileVisits: r.profileVisits, roomClicks: r.roomClicks }));
  const top = withV.length ? Math.max(...withV.map(v)) : 0;
  return {
    posts: list.length, best, formats,
    milestones: MILESTONES.map((m) => ({ target: m, reached: withV.filter((r) => v(r) >= m).length })),
    topViews: top, nextTarget: MILESTONES.find((m) => top < m) || null,
    totals: { profileVisits: list.reduce((a, r) => a + (r.profileVisits || 0), 0), roomClicks: list.reduce((a, r) => a + (r.roomClicks || 0), 0), sales: list.reduce((a, r) => a + (r.sales || 0), 0) }
  };
}
// 企画（次の案件）に渡す実績の1文（登録が無ければ空：推測で作らない）
export async function plannerHint(kv) {
  const list = (await kv.getJson(K.perf)) || [];
  if (!list.length) return '';
  const s = summarize(list);
  const best = s.best.slice(0, 3).map((b) => `${b.title}（${b.format}・閲覧${b.views}${b.saves != null ? `・保存${b.saves}` : ''}）`).join('／');
  const fm = s.formats.map((f) => `${f.label}は平均閲覧${f.avgViews}（${f.posts}件）`).join('・');
  return `Instagramの実績（社長が登録した数字）：よく見られた投稿：${best || 'なし'}。形式ごと：${fm || 'なし'}。見られたテーマ・切り口は参考にし、見られなかったものは同じ切り口を避ける`;
}
// 2026-11-18：端末で動画の実ファイルを作れたときだけ記録する（大きさ・長さ・形式。ファイルそのものは端末にある）。作れなかったものは記録しない
export async function noteReel(kv, { setId, format, bytes, seconds, mime }) {
  const r = { setId: str(setId, 60), format: ['reveal', 'compare', 'top3'].includes(format) ? format : 'reveal', bytes: Math.round(Number(bytes) || 0), seconds: Math.round((Number(seconds) || 0) * 10) / 10, mime: str(mime, 40), at: now() };
  if (!reelFileOk(r)) throw new Error('動画のファイルを作れていないため、記録しません（作り直してください）');
  const list = (await kv.getJson(K.reels)) || [];
  await kv.setJson(K.reels, [r, ...list].slice(0, 200));
  return r;
}
// オフィスの「集客」の数字（実際の記録だけ。リールは実ファイルを作れた記録だけ数える）
export async function reachState(kv) {
  const [perf, reels, sets] = await Promise.all([kv.getJson(K.perf), kv.getJson(K.reels), kv.getJson(K.sets)]);
  const list = perf || [];
  let hooks = 0; let noHooks = 0;
  for (const x of (sets || []).filter((y) => ['waiting', 'adopted', 'posted'].includes(y.status)).slice(0, 15)) { const s = await kv.getJson(K.set(x.id)); if (s && s.hooks) hooks += 1; else noHooks += 1; }
  // 人気投稿を探す場所：完成品のハッシュタグ（Instagramのハッシュタグのページを社長が開く。自動では集めない）
  const tags = [];
  for (const x of (sets || []).slice(0, 6)) { const s = await kv.getJson(K.set(x.id)); for (const t of (s && s.hashtags) || []) { const k = String(t).replace(/^#/, ''); if (k && !tags.includes(k) && !/サングラスくま|PR|楽天ROOM/.test(k)) tags.push(k); } }
  return { perf: list.slice(0, 50), summary: summarize(list), reels: (reels || []).filter(reelFileOk).length, reelsRecent: (reels || []).slice(0, 10), hooks, noHooks, exploreTags: tags.slice(0, 12), formats: FORMATS };
}
