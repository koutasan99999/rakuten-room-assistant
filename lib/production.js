// 制作ライン（自律運営・2026-11-16）：監査AIが合格にしたバイヤーAIの候補を、社長の確認なしで次の社員へ渡し、
// 投稿セット（Instagramの1投稿分の文章と、楽天ROOMの紹介文）まで作って、最後に社長の確認待ちにする。
// 社員ごとに別のAI呼び出し（役割・指示を分ける）。1段階＝1回の定期実行（60秒以内）。
//   plan    : 企画担当AI … 合格候補を中心に企画を決める（AI 1回）
//   gather  : 企画担当（コード）… 候補を楽天で引き直し、足りない枠を楽天で探す（AIなし）
//   pick    : 企画担当AI … 枠ごとに商品を選ぶ（AI 1回）→ コードの品質確認（3点以上・価格・URL・画像・重複）
//   copy    : 投稿セット制作AI … 表紙・商品カードの文字・キャプション（AI 1回）
//   roomtext: 投稿セット制作AI … 楽天ROOMの紹介文（AI 1〜2回）とハッシュタグ（商品のデータから・AIなし）
//   audit   : コードの確認（PR表記・禁止表現・価格の一致・長さ）＋ 監査AI（別のAI呼び出し）の採点
//   revise  : 制作担当AI … 監査AIの修正指示で直す（最大2回）→ もう一度 audit
// 判定はコードが決める（lib/agents.js の decide と同じ基準：コードの確認でNG・監査AIの疑いの指摘は不合格、80点以上かつ監査AIも合格で合格）。
// 対外的な操作（Instagram・楽天ROOMへの公開、商品の正式採用）はしない。合格した投稿セットは「社長の確認待ち」になるだけ。
// 画像（スライド）はサーバーでは描かない。アプリで投稿セットを開いたときに、今までどおり描く。
import { AiError, compact, runWithModels } from './ai.js';
import { nameKey } from './rakuten.js';
import { planSet, gatherSlots, pickProducts, refreshAdopted, adoptedItem, toItem, qualityCheck, PATTERNS, NG_RE, readAdopted } from './postset.js';
import { buildPostCopy, assembleCaption } from './instagram.js';
import { buildHashtags } from './hashtags.js';
import { generateIntros } from './explore.js';
import { productTags } from './room-hashtags.js';
import { ROLES, MEDICAL_RE, parseJson, tagRuns, failure, auditModels, decide, MAX_REVISIONS } from './agents.js';
import { summarize } from './ai-usage.js';

export const COVER_BY_PATTERN = { new_arrival: 'trend_pick', first_pick: 'must_buy', hero_alt: 'premium_vs_alternative', brand: 'brand_pick', gift: 'gift_select', discovery: 'unique_pick', budget_use: 'budget_compare' };
export const MAX_SOURCE = 3; // 1つの投稿セットに渡す合格候補の数
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// バイヤーAIの合格候補 → 企画に渡す形（社長の採用ではないことを記録に残す）
export function fromCandidates(list) {
  return readAdopted((list || []).map((c) => ({
    key: c.code, code: c.code, name: c.name, price: c.price, url: c.url, image: c.image, shop: c.shop,
    caption: (c.quotes || []).join('。'), pitch: c.reason, fit: c.target, reason: `バイヤーAIの候補・監査AIが合格（${c.score == null ? '点数不明' : c.score + '点'}）`, fetchedAt: c.checkedAt
  })));
}
const SOURCE_LABEL = 'バイヤーAIが楽天で選び、監査AIが合格にした商品';

// ---- 企画担当AI ----
export async function planStep({ source, history = [], recentPatterns = [], env, startedAt = Date.now() }) {
  try {
    const plan = await planSet({ history, recentPatterns, adopted: source, adoptedLabel: SOURCE_LABEL, env, deadline: startedAt + 45000 });
    return { ok: true, plan, runs: tagRuns('planner', '企画を決める', 'planSet') };
  } catch (e) { return failure('企画担当AI：企画を決める', e, tagRuns('planner', '企画を決める', 'planSet')); }
}
// ---- 企画担当（コード）：候補の引き直しと、足りない枠の検索 ----
export async function gatherStep({ plan, source, exclude = [], env, referer, startedAt = Date.now() }) {
  const chosen = plan.adopted.map((a) => ({ ...a, item: source[a.id] })).filter((a) => a.item);
  const { out: fresh, missing } = await refreshAdopted({ list: chosen, env, referer, until: startedAt + 20000 });
  const ex = new Set([...exclude, ...source.flatMap((a) => [a.code, nameKey(a.name)])]);
  const slotResults = plan.slots.length ? await gatherSlots({ slots: plan.slots, exclude: ex, env, referer, until: startedAt + 50000 }) : [];
  return { ok: true, fresh, missing, slotResults, rakutenCalls: chosen.length + slotResults.length };
}
// ---- 企画担当AI：枠ごとに商品を選び、投稿セットの形にする ----
export async function pickStep({ id, plan, fresh, missing = [], slotResults, sourceCount, env, startedAt = Date.now(), now = new Date() }) {
  let picks = [];
  if (slotResults.some((s) => s.candidates.length)) {
    try { picks = await pickProducts({ plan, slotResults, env, deadline: startedAt + 45000 }); } catch (e) { if (!fresh.length) return failure('企画担当AI：商品を選ぶ', e, tagRuns('planner', '商品を選ぶ', 'pickProducts')); }
  }
  const runs = tagRuns('planner', '商品を選ぶ', 'pickProducts');
  const items = fresh.map((a) => {
    const x = adoptedItem(a, a.role, now);
    delete x.adoptedKey; delete x.adoptedReason;
    return { ...x, source: 'buyer', buyerNote: a.item.reason || '' };
  }).concat(picks.map((p) => toItem(p, plan.slots[p.slot].role, now)));
  const set = {
    id, createdAt: now.toISOString(), origin: 'server',
    pattern: plan.pattern, patternLabel: PATTERNS[plan.pattern], title: plan.title, target: plan.target, reason: plan.reason, appeal: plan.appeal,
    slots: fresh.map((a) => ({ role: a.role, keyword: compact(a.item.name, 20) })).concat(plan.slots),
    items, adoptedOffered: 0, buyerOffered: sourceCount, adoptedMissing: missing
  };
  set.issues = qualityCheck(set);
  return { ok: true, set, runs };
}

// ---- 投稿セット制作AI：表紙・商品カードの文字・キャプション（アプリの「文章を作る」と同じ作り方） ----
export async function copyStep({ set, env, startedAt = Date.now() }) {
  try {
    const items = set.items.map((it) => ({ name: it.name, price: it.price, role: it.role, reason: [it.feature, it.why].filter(Boolean).join('。'), intro: '', memo: '' }));
    const copy = await buildPostCopy({ theme: set.title, category: set.patternLabel || '', coverStyle: COVER_BY_PATTERN[set.pattern] || 'unique_pick', items, needCaption: true, collection: set.title, env, deadline: startedAt + 45000 });
    const runs = tagRuns('producer', 'Instagramの文字・キャプションを作る', 'buildPostCopy');
    if (copy.fallback) return failure('投稿セット制作AI：キャプション', new Error(copy.error || 'AIで文章を作れませんでした'), runs);
    const hashtags = buildHashtags({ topic: copy.topic, category: set.patternLabel || '', genre: '', postType: set.patternLabel || '', aiTags: copy.hashtags });
    const body = String(copy.caption || '').trim();
    return { ok: true, copy: { topic: copy.topic, category: copy.category, topicSlug: copy.topicSlug, summary: copy.summary, items: copy.items, cover: copy.cover, body, hashtags, caption: assembleCaption({ body, collection: set.title, hashtags }) }, runs };
  } catch (e) { return failure('投稿セット制作AI：キャプション', e, tagRuns('producer', 'Instagramの文字・キャプションを作る', 'buildPostCopy')); }
}
// ---- 投稿セット制作AI：楽天ROOMの紹介文（AI）とハッシュタグ（商品のデータから） ----
export async function roomStep({ set, env, startedAt = Date.now() }) {
  const rules = `\n追加の決まり（楽天ROOMの1商品の投稿）:\n- 紹介文は150〜200字。絵文字は使わない\n- 企画「${set.title}」（${set.patternLabel || ''}${set.target ? `・${set.target}` : ''}）の中での、その商品の役割に合った切り口にする\n- 商品データで確認できない性能・仕様は書かない。必要なら買う前の注意点を1つ書く`;
  const items = set.items.map((it) => ({ name: it.name, price: it.price, role: it.role, brand: it.brand, reason: [it.feature, it.why].filter(Boolean).join('。'), caption: it.caption }));
  const r = await generateIntros({ title: set.title, items, env, deadline: startedAt + 50000, extraRules: rules });
  const runs = tagRuns('producer', '楽天ROOMの紹介文を作る', 'generateIntros');
  if (r.fallback) return failure('投稿セット制作AI：ROOM紹介文', new Error(r.error || 'AIで紹介文を作れませんでした'), runs);
  const roomTexts = set.items.map((it, i) => ({
    code: it.code, intro: String(r.intros[i] || '').replace(EMOJI_RE, '').trim(),
    tags: productTags({ name: it.name, feature: [it.feature, it.why].filter(Boolean).join('。'), useCase: it.role, target: set.target, theme: set.title, brand: it.brand }), tagsFrom: '商品のデータ'
  }));
  return { ok: true, roomTexts, runs };
}

// ---- コードの確認（客観的な事実。AIなし） ----
export function codeCheck(set) {
  const checks = [];
  const add = (key, label, ok, detail, hard = true) => checks.push({ key, label, ok, detail: String(detail || '').slice(0, 200), hard });
  const issues = qualityCheck(set);
  add('quality', '商品が3点以上・価格・楽天のURL・画像・重複なし', !issues.length, issues.join('／') || 'OK');
  const cap = (set.copy && set.copy.caption) || '';
  add('caption', 'キャプションがある', !!(set.copy && set.copy.body), set.copy ? `${cap.length}字` : 'なし');
  add('pr', 'PR（アフィリエイト）の表記がある', /アフィリエイト|PR/.test(cap), /アフィリエイト|PR/.test(cap) ? 'あり' : 'なし');
  add('length', 'キャプションの長さ（2,200字以内）・ハッシュタグ30個以内', cap.length <= 2200 && ((set.copy && set.copy.hashtags) || []).length <= 30, `${cap.length}字・タグ${((set.copy && set.copy.hashtags) || []).length}個`);
  const texts = [['キャプション', (set.copy && set.copy.body) || '']]
    .concat(((set.copy && set.copy.items) || []).map((x, i) => [`商品カード${i + 1}`, [x.shortName, x.subline, x.memo].filter(Boolean).join(' ')]))
    .concat((set.roomTexts || []).map((x, i) => [`ROOM紹介文${i + 1}`, x.intro]));
  const bad = texts.map(([k, t]) => { const m = (String(t).match(NG_RE) || String(t).match(MEDICAL_RE) || [])[0]; return m ? `${k}「${m}」` : ''; }).filter(Boolean);
  add('expression', '体験談・断定・医療の効果の表現がない', !bad.length, bad.join('／') || 'なし');
  // 文章に書いた価格が、どれかの商品の楽天の価格と一致するか（作られた価格を出さない）
  const prices = new Set(set.items.map((it) => it.price));
  const written = texts.flatMap(([k, t]) => [...String(t).normalize('NFKC').matchAll(/([0-9][0-9,]{2,})円/g)].map((m) => ({ k, v: Number(m[1].replace(/,/g, '')) })));
  const wrong = written.filter((x) => !prices.has(x.v) && !/[05]000$|00$/.test(String(x.v)));
  add('price', '文章に書いた価格が楽天の価格と一致', !wrong.length, wrong.length ? wrong.map((x) => `${x.k}：${x.v}円`).join('／') : written.length ? `${written.length}か所とも一致（または予算の区切り）` : '価格の記載なし');
  const rt = set.roomTexts || [];
  const short = set.items.map((it, i) => (rt[i] && rt[i].intro ? rt[i].intro.length : 0)).map((n, i) => (n < 80 || n > 280 ? `${i + 1}点目 ${n}字` : '')).filter(Boolean);
  add('room', '全商品のROOM紹介文（80〜280字）', rt.length === set.items.length && !short.length, short.join('／') || `${rt.length}件`);
  return { checks, hardFail: checks.some((x) => x.hard && x.ok === false), unknown: false, at: new Date().toISOString() };
}

// ---- 監査AI：投稿セットの採点 ----
const CRITERIA = ROLES.producer.criteria;
const SET_AUDIT_PROMPT = `あなたは「眼科医くま」の監査AIです（制作の役はしない）。投稿セット（Instagramの1投稿分と楽天ROOMの紹介文）を、渡された商品データ（P…）とコードの確認結果（K…）だけを根拠に採点します。JSONだけを返してください。
- 甘くしない。逆に、根拠なく全否定もしない
- 採点項目: ${CRITERIA.map((c) => `${c.key}（${c.label}・${c.max}点：${c.hint}）`).join('／')}
- 各項目：score（0〜満点）、deductions（減点理由。どの文章の・どの言葉が・なぜ問題か）、evidence（根拠にした番号 P… / K…）
- flags（点数に関係なく不合格）: fabrication（商品データにない特徴・数値・受賞歴などを書いている）／unverified（人気・売れている・最安・効果などの確認できない断定）／policy（体験したような表現・医療の効果・誇張）
- PR（アフィリエイト）表記・ROOMへの案内・ハッシュタグは、コードがキャプションの最後に付ける（下の「キャプション全文」と K の確認結果を見る）。本文に無いことを理由に減点・flag にしない
- fixes：そのまま実行できる修正指示。target に直す場所（caption＝キャプション本文／card:1＝1点目の商品カードの文字／room:1＝1点目のROOM紹介文）、text に指示。直せる場所はこの3つだけ（表紙・商品の入れ替えは指示しない）
- flag を付けたときは、どの文章のどの言葉かを why に書き、その言葉を直す fixes を必ず書く
- proposal：pass／revise／hold（情報が足りない）／reject（紹介に向かない）。hold・reject は理由を summary に書く
- 合計点はコードが計算する
出力形式: {"scores":{"accuracy":{"score":20,"deductions":"...","evidence":["P1"]}},"flags":{"fabrication":false,"unverified":false,"policy":false,"why":""},"fixes":[{"target":"caption","text":"..."}],"needResearch":"","proposal":"revise","summary":"..."}`;

function setLines(set, check) {
  const rt = set.roomTexts || [];
  return [
    `企画: ${set.title}（${set.patternLabel || ''}）／誰向け: ${set.target || ''}／魅力: ${set.appeal || ''}`,
    ...set.items.map((it, i) => `P${i + 1}（商品データ）: ${compact(it.name, 90)} / ${it.price}円 / ${it.shop || ''} / 役割: ${it.role} / 説明: ${compact(it.caption || '', 160)} / 特徴（制作）: ${it.feature || ''} / 理由: ${it.why || ''}`),
    `キャプション本文（caption）: ${compact((set.copy && set.copy.body) || '', 900)}`,
    `キャプション全文（本文のあとにコードが付ける案内・PR表記・ハッシュタグを含む）: ${compact(((set.copy && set.copy.caption) || '').slice(((set.copy && set.copy.body) || '').length), 500)}`,
    ...((set.copy && set.copy.items) || []).map((x, i) => `商品カード${i + 1}（card:${i + 1}）: 短い名前「${x.shortName || ''}」／補足「${x.subline || ''}」／メモ「${x.memo || ''}」`),
    ...rt.map((x, i) => `ROOM紹介文${i + 1}（room:${i + 1}）: ${x.intro}`),
    ...check.checks.map((k, j) => `K${j + 1}（コードの確認）: ${k.label}：${k.ok === true ? 'OK' : k.ok === false ? 'NG' : '未確認'}（${k.detail}）`)
  ].join('\n');
}
export function readSetAudit(d) {
  const scores = {};
  let total = 0;
  for (const cr of CRITERIA) {
    const s = d.scores && d.scores[cr.key];
    const v = Math.max(0, Math.min(cr.max, Math.round(Number(s && (s.score != null ? s.score : s)) || 0)));
    scores[cr.key] = { score: v, max: cr.max, label: cr.label, deductions: str(s && s.deductions, 160), evidence: (Array.isArray(s && s.evidence) ? s.evidence : []).map((x) => str(x, 10)).filter(Boolean).slice(0, 6) };
    total += v;
  }
  if (!d.scores) throw new AiError('採点の結果がありませんでした');
  const f = d.flags || {};
  return {
    scores, total,
    flags: { fabrication: f.fabrication === true, unverified: f.unverified === true, policy: f.policy === true, why: str(f.why, 160) },
    fixes: (Array.isArray(d.fixes) ? d.fixes : []).map((x) => (x && typeof x === 'object' ? { target: str(x.target, 12), text: str(x.text, 160) } : { target: 'caption', text: str(x, 160) })).filter((x) => x.text).slice(0, 6),
    needResearch: str(d.needResearch, 160),
    proposal: ['pass', 'revise', 'hold', 'reject'].includes(d.proposal) ? d.proposal : 'revise',
    summary: str(d.summary, 160)
  };
}
export async function auditSetStep({ set, check, model, env, startedAt = Date.now() }) {
  const models = auditModels(env, model);
  try {
    const { result } = await runWithModels({ env, models, deadline: startedAt + 50000, system: SET_AUDIT_PROMPT, userContent: setLines(set, check), parse: (c) => readSetAudit(parseJson(c)) });
    const runs = tagRuns('auditor', '投稿セットの採点', SET_AUDIT_PROMPT);
    return { ok: true, audit: result, runs, aiUsage: summarize(runs) };
  } catch (e) { return failure('監査AI：投稿セットの採点', e, tagRuns('auditor', '投稿セットの採点', SET_AUDIT_PROMPT)); }
}
export function decideSet({ check, audit, revisions }) { return decide({ check, audit, revisions }); }

// ---- 制作担当AI：修正 ----
const EDIT_PROMPT = `あなたは「眼科医くま」の制作担当AIです（監査の役はしない）。監査AIの修正指示とコードの確認でNGになった点に従って、投稿セットの文章を直します。JSONだけを返してください。
- 直すのは、指示された場所だけ（caption＝キャプション本文、card:N＝N点目の商品カードの補足とメモ、room:N＝N点目のROOM紹介文）。直さない場所は返さない
- キャプション本文には、ROOMへの誘導・PR表記・ハッシュタグを書かない（コードが付ける）
- ROOM紹介文は150〜200字。絵文字なし
- 商品データ（P…）に書いてあることだけを使う。書いていない機能・数値・素材・受賞歴を足さない。価格は商品データの価格だけ
- 体験したような表現（使ってみた・愛用など）、断定（最安・絶対・人気など）、医療・健康の効果は書かない
- 直すのに必要な情報が商品データにないなら、giveUp に足りない情報を書く（推測で補わない）
- 商品カードの補足（subline）は20字以内、メモ（memo）は40字以内
出力形式: {"caption":"直したキャプション本文（直さないなら空）","card":[{"n":1,"subline":"...","memo":"..."}],"room":[{"n":1,"intro":"..."}],"giveUp":""}`;

export async function editStep({ set, audit, check, env, startedAt = Date.now() }) {
  const ng = check.checks.filter((k) => k.hard && k.ok === false).map((k) => `コードの確認でNG：${k.label}（${k.detail}）`);
  const fixes = (audit ? audit.fixes : []).map((f) => `${f.target || 'caption'}：${f.text}`);
  try {
    const { result } = await runWithModels({
      env, deadline: startedAt + 50000, system: EDIT_PROMPT,
      userContent: `${setLines(set, { checks: [] })}\n\n修正指示:\n${[...ng, ...fixes].join('\n') || '（指示なし）'}\n不合格の理由: ${audit ? audit.summary : ''}`,
      parse: (c) => {
        const d = parseJson(c);
        const room = (Array.isArray(d.room) ? d.room : []).map((x) => ({ n: Number(x && x.n), intro: String((x && x.intro) || '').replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim().slice(0, 300) })).filter((x) => Number.isInteger(x.n) && x.n >= 1 && x.n <= set.items.length && x.intro);
        const caption = String(d.caption || '').replace(/#\S+/g, '').trim().slice(0, 1800);
        const card = (Array.isArray(d.card) ? d.card : []).map((x) => ({ n: Number(x && x.n), subline: str(x && x.subline, 30), memo: str(x && x.memo, 60) })).filter((x) => Number.isInteger(x.n) && x.n >= 1 && x.n <= set.items.length && (x.subline || x.memo));
        const giveUp = str(d.giveUp, 160);
        if (!caption && !room.length && !card.length && !giveUp) throw new AiError('修正の結果がありませんでした');
        return { caption, card, room, giveUp };
      }
    });
    return { ok: true, edit: result, runs: tagRuns('editor', '投稿セットの修正', EDIT_PROMPT) };
  } catch (e) { return failure('制作担当AI：修正', e, tagRuns('editor', '投稿セットの修正', EDIT_PROMPT)); }
}
// 修正を投稿セットに反映する（キャプションは、本文を直してから誘導・PR表記・ハッシュタグを付け直す）
export function applyEdit(set, edit) {
  const next = { ...set, copy: set.copy ? { ...set.copy } : null, roomTexts: (set.roomTexts || []).map((x) => ({ ...x })) };
  const changed = [];
  if (edit.caption && next.copy) { next.copy.body = edit.caption; next.copy.caption = assembleCaption({ body: edit.caption, collection: set.title, hashtags: next.copy.hashtags || [] }); changed.push('caption'); }
  edit.room.forEach((x) => { if (next.roomTexts[x.n - 1]) { next.roomTexts[x.n - 1].intro = x.intro; changed.push(`room:${x.n}`); } });
  if (next.copy && Array.isArray(next.copy.items)) {
    next.copy.items = next.copy.items.map((c) => ({ ...c }));
    (edit.card || []).forEach((x) => { const c = next.copy.items[x.n - 1]; if (c) { if (x.subline) c.subline = x.subline; if (x.memo) c.memo = x.memo; changed.push(`card:${x.n}`); } });
  }
  return { set: next, changed };
}
// 投稿セットの文章の版（修正前後を全文で比べられるように残す）
export function textsOf(set) {
  return { caption: (set.copy && set.copy.body) || '', cards: ((set.copy && set.copy.items) || []).map((c) => ({ subline: c.subline || '', memo: c.memo || '' })), room: (set.roomTexts || []).map((x) => x.intro || '') };
}
// 監査AIの修正指示が、修正で実際に直されたか（指示した場所の文章が変わったか）をコードで確かめる
export function fixCheck(fixes, changed) {
  return (fixes || []).map((f) => { const t = String(f.target || 'caption').replace(/\s/g, ''); return { target: t, text: f.text, changed: changed.includes(t) }; });
}
export { MAX_REVISIONS };
