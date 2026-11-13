// 営業・交流担当AI（第2段階・2026-11-14）：他の人のInstagram投稿へのコメント案と、フォロー候補としての評価。
// 使うのは、実在する投稿のURLと、確認できた投稿の文章だけ（公式APIで取った文章か、社長が貼った文章）。文章がない投稿には、コメント案を作らない（内容を推測しない）。
// 交流担当AI（作る）と監査AI（評価する）は、別々のAI呼び出し。判定はコードが決める（コードの確認 → 監査AIのフラグ → 点数）。修正は最大2回。
// コメント・フォローの送信はしない（公式APIに他の人の投稿へのコメント・フォローの機能はない）。社長がInstagramで自分で行う。
import { AiError, compact, runWithModels } from './ai.js';
import { ROLES, PASS_SCORE, MAX_REVISIONS, auditModels, parseJson, tagRuns, failure } from './agents.js';
import { summarize } from './ai-usage.js';

export const MAX_POSTS = 5;
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const flat = (s) => String(s || '').normalize('NFKC').replace(/[\s　]+/g, '');

// 宣伝・誘導・体験談（コメントに入れない）
const PROMO_RE = /フォロー|フォロバ|リンク|プロフ|ROOM|楽天|眼科|アフィ|PR|宣伝|DM|https?:|www\.|@[A-Za-z0-9_.]+|#|使ってます|使っています|愛用|買いました|持ってます/;
const STOCK_RE = /めっちゃ素敵|すごく参考|欲しくなりました|よさそう|良さそう|最高です|最高ですね|素敵ですね|素敵です|勉強になります/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// 文字の2文字ずつの並びで、どれくらい似ているか（0〜1）
export function similarity(a, b) {
  const g = (s) => { const t = flat(s); const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
  const x = g(a); const y = g(b);
  if (!x.size || !y.size) return 0;
  let n = 0; x.forEach((v) => { if (y.has(v)) n++; });
  return n / Math.min(x.size, y.size);
}

// コードの確認（客観的な事実）：投稿の文章からの引用・長さ・宣伝・絵文字・決まり文句・過去のコメントとの似すぎ
export function checkComment(c, post, past = []) {
  const checks = [];
  const add = (key, label, ok, detail, hard = true) => checks.push({ key, label, ok, detail: String(detail || '').slice(0, 160), hard });
  const t = String(c.comment || '');
  add('caption', '投稿の文章を確認できている', !!post.caption && post.caption.length >= 5, post.caption ? `${post.caption.length}文字（${post.source || ''}）` : '文章がない（内容を推測しない）');
  add('anchor', '触れている点が投稿の文章に本当にある', !!c.anchor && flat(post.caption).includes(flat(c.anchor)), c.anchor ? `「${c.anchor}」` : '触れている点の引用がない');
  add('length', '長さ（8〜60字）', t.length >= 8 && t.length <= 60, `${t.length}字`);
  const promo = (t.match(PROMO_RE) || [])[0];
  add('promo', '宣伝・誘導・体験談がない', !promo, promo ? `「${promo}」` : 'なし');
  add('emoji', '絵文字・「！」の多用がない', !EMOJI_RE.test(t) && (t.match(/[!！]/g) || []).length <= 1, EMOJI_RE.test(t) ? '絵文字あり' : 'なし', false);
  const stock = (t.match(STOCK_RE) || [])[0];
  add('stock', '決まり文句の褒め言葉だけになっていない', !stock, stock ? `「${stock}」` : 'なし', false);
  const sim = past.map((p) => ({ p, s: similarity(t, p) })).sort((a, b) => b.s - a.s)[0];
  add('duplicate', '過去のコメントと似すぎていない（使い回し防止）', !sim || sim.s < 0.6, sim ? `いちばん近いもの ${Math.round(sim.s * 100)}%：「${String(sim.p).slice(0, 24)}」` : '比べるコメントなし');
  return { id: c.id, checks, hardFail: checks.some((x) => x.hard && x.ok === false), at: new Date().toISOString() };
}

const DRAFT_PROMPT = `あなたは「眼科医くま」の営業・交流担当AIです（監査の役はしない）。他の人のInstagram投稿に、一般の人として自然なコメントを書く案を作り、フォロー候補として評価します。JSONだけを返してください。
目的：宣伝ではなく、その投稿への自然な交流（相手が返事をしたくなる・プロフィールを見に来てくれるきっかけ）。
決まり（とても大事）:
- 渡された「投稿の文章」だけを根拠にする。書いていないこと（商品の性能・色・使い心地・場所など）を足さない。画像は見ていない前提で書く
- anchor：コメントで触れる点を、投稿の文章からそのまま写す（言い換えない。コードが照合する）
- comment：10〜50字。anchor の点への具体的な感想か、素朴な質問。落ち着いた自然な日本語。「！」は0〜1個、絵文字なし
- 書かないもの：宣伝、リンク、ハッシュタグ、@、「フォロー」、自分のアカウント・ROOM・楽天・商品の話、眼科の話、体験談（使ってます等）、決まり文句（素敵ですね／すごく参考になります 等）
- 過去に使ったコメント（渡す）と同じ言い回しにしない
- relevance：眼科医くまの今のテーマ（渡す）との関係の強さ 0〜100 と理由（40字以内）
- follow：フォロー候補としての評価 0〜100 と理由（40字以内。投稿の文章から言えることだけ）
出力形式: {"drafts":[{"id":"x1","anchor":"...","comment":"...","relevance":70,"relevanceWhy":"...","follow":60,"followWhy":"..."}]}`;

const AUDIT_PROMPT = `あなたは「眼科医くま」の監査AIです（コメントを書く役はしない）。営業・交流担当AIが作ったコメント案を、投稿の文章（P…）とコードの確認結果（K…）だけを根拠に採点します。JSONだけを返してください。
- 甘くしない。決まり文句・AIっぽい言い回し・なれなれしさ・宣伝っぽさは具体的に指摘する
- 採点項目: ${ROLES.outreach.criteria.map((c) => `${c.key}（${c.label}・${c.max}点：${c.hint}）`).join('／')}
- 各項目：score、deductions（どの言葉がなぜ問題か）、evidence（P… / K…）
- flags（点数に関係なく不合格）：promo（宣伝・誘導）／fabrication（投稿の文章にないことを書いている）／inappropriate（失礼・不自然・スパムっぽい）。理由を why に
- fixes：そのまま実行できる修正指示（例：「『素敵ですね』を削り、『〜の〜』について質問にする」）
- proposal：pass／revise／hold（判断できない）／reject（この投稿にはコメントしない方がよい）
出力形式: {"audits":[{"id":"x1","scores":{"specific":{"score":20,"deductions":"","evidence":["P1"]}},"flags":{"promo":false,"fabrication":false,"inappropriate":false,"why":""},"fixes":["..."],"proposal":"pass","summary":"..."}]}`;

const REVISE_PROMPT = `あなたは「眼科医くま」の営業・交流担当AIです（監査の役はしない）。監査AIの修正指示に従って、コメント案を直します。JSONだけを返してください。
- 決まりは最初と同じ。投稿の文章にないことは書かない。anchor は投稿の文章から写す
- 直せない（投稿の文章が短すぎる等）なら、giveUp に理由を書く（推測で補わない）
出力形式: {"drafts":[{"id":"x1","anchor":"...","comment":"...","relevance":70,"relevanceWhy":"...","follow":60,"followWhy":"...","giveUp":""}]}`;

export function readPosts(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_POSTS).map((p) => ({
    id: str(p && p.id, 40), url: str(p && p.url, 300), handle: str(p && p.handle, 40), caption: String(p && p.caption || '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 1000), source: str(p && p.source, 40)
  })).filter((p) => p.id && /^https:\/\/www\.instagram\.com\/(p|reel)\//.test(p.url));
}
function postLines(posts) {
  return posts.map((p, i) => `投稿 ${p.id}（P${i + 1}・@${p.handle || '不明'}・${p.url}）\n  投稿の文章: ${compact(p.caption, 700)}`).join('\n');
}
function readDrafts(d, posts) {
  const out = [];
  for (const p of posts) {
    const x = (Array.isArray(d.drafts) ? d.drafts : []).find((y) => y && str(y.id, 40) === p.id);
    if (!x) continue;
    out.push({
      id: p.id, anchor: str(x.anchor, 80), comment: str(x.comment, 80), giveUp: str(x.giveUp, 120),
      relevance: Math.max(0, Math.min(100, Math.round(Number(x.relevance) || 0))), relevanceWhy: str(x.relevanceWhy, 80),
      follow: Math.max(0, Math.min(100, Math.round(Number(x.follow) || 0))), followWhy: str(x.followWhy, 80)
    });
  }
  return out;
}

// 交流担当AI：コメント案（文章がない投稿は、AIに渡さない）
export async function draftStep({ posts, themes = [], past = [], env, startedAt = Date.now(), revise = null }) {
  const withText = posts.filter((p) => p.caption && p.caption.length >= 5);
  const skipped = posts.filter((p) => !withText.includes(p)).map((p) => ({ id: p.id, why: '投稿の文章がないため、コメント案を作らない（内容を推測しない）' }));
  if (!withText.length) return { ok: true, drafts: [], skipped, runs: [], aiUsage: null };
  const system = revise ? REVISE_PROMPT : DRAFT_PROMPT;
  const user = [
    `眼科医くまの今のテーマ（今紹介している商品・企画）: ${themes.slice(0, 12).join('／') || '未設定'}`,
    `過去に使ったコメント（同じ言い回しにしない）: ${past.slice(0, 15).map((x) => `「${compact(x, 40)}」`).join(' ') || 'なし'}`,
    postLines(withText),
    revise ? `直す内容:\n${revise.map((r) => `${r.id}: 今の案「${r.comment}」（触れた点「${r.anchor}」）／不合格の理由: ${r.why}／修正指示: ${(r.fixes || []).join('／') || 'なし'}`).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
  const step = revise ? '修正' : 'コメント案を作る';
  try {
    const { result } = await runWithModels({ env, deadline: startedAt + 45000, system, userContent: user, parse: (c) => { const r = readDrafts(parseJson(c), withText); if (!r.length) throw new AiError('コメント案がありませんでした'); return r; } });
    const runs = tagRuns('outreach', step, system);
    return { ok: true, drafts: result, skipped, runs, aiUsage: summarize(runs) };
  } catch (e) {
    return failure(`営業・交流担当AI：${step}`, e, tagRuns('outreach', step, system));
  }
}

// 監査AI：採点（合計はコードが計算し直す）
export async function auditStep({ posts, drafts, checks, model, env, startedAt = Date.now() }) {
  const lines = drafts.map((d, i) => {
    const p = posts.find((x) => x.id === d.id) || {};
    const k = (checks.find((x) => x.id === d.id) || { checks: [] }).checks;
    return [`案 ${d.id}`, `  P${i + 1}（投稿の文章）: ${compact(p.caption || '', 500)}`, `  コメント案: 「${d.comment}」（触れた点「${d.anchor}」）`, ...k.map((x, j) => `  K${i + 1}-${j + 1}（コードの確認）: ${x.label}：${x.ok === true ? 'OK' : x.ok === false ? 'NG' : '未確認'}（${x.detail}）`)].join('\n');
  }).join('\n');
  const models = auditModels(env, model);
  try {
    const { result } = await runWithModels({ env, models, deadline: startedAt + 45000, system: AUDIT_PROMPT, userContent: lines, parse: (c) => readAudits(parseJson(c), drafts) });
    const runs = tagRuns('auditor', 'コメント案の採点', AUDIT_PROMPT);
    return { ok: true, audits: result, runs, aiUsage: summarize(runs) };
  } catch (e) {
    return failure('監査AI：コメント案の採点', e, tagRuns('auditor', 'コメント案の採点', AUDIT_PROMPT));
  }
}
export function readAudits(d, drafts) {
  const out = [];
  for (const x of drafts) {
    const a = (Array.isArray(d.audits) ? d.audits : []).find((y) => y && str(y.id, 40) === x.id);
    if (!a) continue;
    const scores = {};
    let total = 0;
    for (const cr of ROLES.outreach.criteria) {
      const s = a.scores && a.scores[cr.key];
      const v = Math.max(0, Math.min(cr.max, Math.round(Number(s && (s.score != null ? s.score : s)) || 0)));
      scores[cr.key] = { score: v, max: cr.max, label: cr.label, deductions: str(s && s.deductions, 140), evidence: (Array.isArray(s && s.evidence) ? s.evidence : []).map((e) => str(e, 10)).slice(0, 6) };
      total += v;
    }
    const f = a.flags || {};
    out.push({ id: x.id, scores, total, flags: { promo: f.promo === true, fabrication: f.fabrication === true, inappropriate: f.inappropriate === true, why: str(f.why, 140) },
      fixes: (Array.isArray(a.fixes) ? a.fixes : []).map((y) => str(y, 140)).filter(Boolean).slice(0, 4), proposal: ['pass', 'revise', 'hold', 'reject'].includes(a.proposal) ? a.proposal : 'revise', summary: str(a.summary, 140) });
  }
  if (!out.length) throw new AiError('採点の結果がありませんでした');
  return out;
}

// 判定（コードが決める）
export function decide({ check, audit, revisions }) {
  const left = revisions < MAX_REVISIONS;
  if (!check) return { status: 'hold', why: 'コードの確認がまだ' };
  if (check.hardFail) return { status: left ? 'revise' : 'reject', why: 'コードの確認で不合格：' + check.checks.filter((x) => x.hard && x.ok === false).map((x) => x.label).join('、'), codeFail: true };
  if (!audit) return { status: 'hold', why: '監査AIの採点がない' };
  const f = audit.flags;
  if (f.promo || f.fabrication || f.inappropriate) return { status: left ? 'revise' : 'reject', why: '監査AIが不合格の疑いを指摘：' + [f.promo && '宣伝・誘導', f.fabrication && '投稿にないことを書いている', f.inappropriate && '不自然・失礼'].filter(Boolean).join('、') + (f.why ? `（${f.why}）` : '') };
  if (audit.proposal === 'reject') return { status: 'reject', why: '監査AIが「この投稿にはコメントしない方がよい」と提案：' + audit.summary };
  if (audit.total >= PASS_SCORE && audit.proposal === 'pass') return { status: 'pass', why: `${audit.total}点（合格ライン${PASS_SCORE}点）・監査AIも合格と判断・コードの確認もOK` };
  if (audit.proposal === 'hold') return { status: 'hold', why: '監査AIが保留を提案：' + audit.summary };
  if (left) return { status: 'revise', why: audit.total >= PASS_SCORE ? `${audit.total}点だが、監査AIの修正指示が残っている` : `${audit.total}点（合格ライン${PASS_SCORE}点に届かない）` };
  return { status: 'hold', why: `修正${MAX_REVISIONS}回でも合格にならなかった（${audit.total}点）。無理に合格にしない` };
}
