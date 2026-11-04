// 眼科医くま株式会社の自律経営：毎日の経営会議・社員から社長への提言・社長の返信から業務を作る・担当社員の作業（改善案の提出）。
// 事実（数字・記録）は画面側のコードが既存のデータ（採用商品・投稿セット・探索・業務）から集めて F1, F2… の番号つきで渡す。
// AIは事実の番号を根拠として示すだけで、事実を作らない。根拠のない提言・実行していない作業の報告はコードで落とす。
// 料金・無料範囲・API対応などツールの情報は lib/tool-catalog.js の確認済みの内容だけを使う（AIに作らせない）。
import { AiError, cleanText, runWithModels } from './ai.js';
import { TOOL_CATALOG, PLATFORM_FACTS } from './tool-catalog.js';

export const ROLES = {
  editor: '編集長', designer: 'デザイナー', copywriter: 'コピーライター', buyer: 'バイヤー',
  sns: 'SNS担当', sales: '営業担当', ceo: '経営責任者'
};
export const PRIORITY = { high: '高', mid: '中', low: '低' };
// 画像の評価の観点（社長の指示）
export const DESIGN_POINTS = ['表紙で興味を引けるか', 'キャッチコピーが毎回似ていないか', '商品が十分に大きく見えるか', '商品画像の品質', '文字量と読みやすさ', 'レイアウトの単調さ', 'アカウントの独自性', '保存したくなる情報があるか'];
export const ANGLES = ['価格比較', '意外性', '問題提起', '発見', '新商品', 'ブランド比較', '用途・場面', '失敗しない選び方'];
// 改善版に使える表紙の型（商品画像を小さく並べるだけの型は使わない）
export const COVER_STYLES = ['serious_think', 'must_buy', 'premium_vs_alternative', 'budget_compare', 'gift_select', 'brand_pick', 'value_pick', 'trend_pick', 'unique_pick'];

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const clean = (v, n) => cleanText(v).replace(/\s+/g, ' ').trim().slice(0, n);
const json = (c) => JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
// 実行したと読める言い方。実行の記録（area=activity の事実）を根拠にしていないなら使わせない
export const CLAIM_RE = /(コメント|投稿|フォロー|いいね|公開|登録|送信|DM)(しました|を行いました|済み|を実行)/;
const NG_RE = /最安|絶対|必ず売れ|神アイテム|爆売れ|使ってみた|愛用|治る|効く/;

export function readFacts(x) {
  return (Array.isArray(x) ? x : []).slice(0, 60).map((f) => ({ id: str(f && f.id, 8), area: str(f && f.area, 12), text: str(f && f.text, 160) })).filter((f) => /^F\d{1,3}$/.test(f.id) && f.text);
}
export function readTasks(x) {
  return (Array.isArray(x) ? x : []).slice(0, 40).map((t) => ({
    id: str(t && t.id, 24), title: str(t && t.title, 80), assignee: ROLES[t && t.assignee] ? t.assignee : 'ceo', priority: PRIORITY[t && t.priority] ? t.priority : 'mid',
    due: str(t && t.due, 10), doneWhen: str(t && t.doneWhen, 100), status: str(t && t.status, 10), lastProgress: str(t && t.lastProgress, 120), deliverable: str(t && t.deliverable, 120), ownerCheck: str(t && t.ownerCheck, 20)
  })).filter((t) => t.id && t.title);
}
function readNotes(x, n = 20) {
  return (Array.isArray(x) ? x : []).slice(0, n).map((m) => ({ at: str(m && m.at, 25), text: str(m && m.text, 200), about: str(m && m.about, 80), decision: str(m && m.decision, 10) })).filter((m) => m.text || m.decision);
}
function readImprovements(x) {
  return (Array.isArray(x) ? x : []).slice(0, 20).map((m) => ({ problem: str(m && m.problem, 80), idea: str(m && m.idea, 80), status: str(m && m.status, 10), result: str(m && m.result, 80) })).filter((m) => m.problem);
}
export function readMeetingInput(b) {
  const x = b && typeof b === 'object' ? b : {};
  return { date: str(x.date, 10), facts: readFacts(x.facts), tasks: readTasks(x.tasks), ownerNotes: readNotes(x.ownerNotes), improvements: readImprovements(x.improvements), lastPlan: (Array.isArray(x.lastPlan) ? x.lastPlan : []).slice(0, 5).map((p) => str(p, 100)).filter(Boolean) };
}

const factLines = (facts) => facts.map((f) => `${f.id}（${f.area}）: ${f.text}`).join('\n');
const taskLines = (tasks) => tasks.map((t) => `${t.id}: ${t.title}／担当 ${ROLES[t.assignee]}／優先 ${PRIORITY[t.priority]}／期限 ${t.due || 'なし'}／状態 ${t.status}／完了条件 ${t.doneWhen}${t.lastProgress ? `／直近 ${t.lastProgress}` : ''}${t.deliverable ? `／成果物 ${t.deliverable}` : ''}${t.ownerCheck ? `／社長の確認 ${t.ownerCheck}` : ''}`).join('\n');
const catalogLines = () => TOOL_CATALOG.map((t) => `${t.id}: ${t.name}（${t.category}）／無料: ${t.free}／費用: ${t.cost}／API: ${t.api}`).join('\n');

const BASE_RULES = `あなたたちは「眼科医くま株式会社」のAI社員です（楽天ROOMとInstagramで商品を紹介し、アフィリエイト収益を目指す会社。売上はまだほぼない）。
社員：${Object.entries(ROLES).map(([k, v]) => `${k}=${v}`).join('／')}
守ること：
- 事実は「事実の一覧」にあるものだけ。数字・実績・外部アカウントの状況を作らない。分からないことは「未確認」と書く
- 実際に行った作業は、事実の一覧に記録（area=activity）があるものだけ。案を作っただけなら「案を作成」と書く。「コメントしました」「投稿しました」などは記録がなければ書かない
- 社長へも遠慮なく意見する。ただし根拠（事実の番号）・業務への影響・求める対応を必ず添える。根拠のない批判はしない
- 有料サービスの契約・課金は勧めてよいが、決めるのは社長。ツールの料金・機能は「ツールの一覧」にある内容だけを使う
- Instagramの大量コメント・自動フォロー・非公式な自動操作は提案しない
- 会議を開いたこと自体を成果にしない。成果は制作物・公開・登録・売上につながる事実だけ`;

const MEETING_PROMPT = `${BASE_RULES}
今日の経営会議をします。前日の実績・未完了の業務・問題点・改善案・実行担当を確認し、JSONだけを返してください。
- statements：各社員の発言（7人それぞれ1つ、60字以内。根拠の事実番号 facts）
- issues：問題（最大4。title、cause＝原因、facts、owner＝担当の社員）
- proposals：社長への提言・確認事項（最大4。role、title、facts（必須）、impact＝業務への影響、request＝社長に求める対応、kind＝decision（判断）/confirm（確認）/approve（承認））
- taskUpdates：既存の業務の進捗（id、note＝今日の状況60字以内、status＝todo/doing/blocked のどれか。完了にはしない。完了は社長の確認で決まる）
- newTasks：新しい業務（最大3。title、assignee、priority＝high/mid/low、dueDays＝期限まで何日（1〜14）、doneWhen＝完了条件）
- plan：明日の改善計画（最大4。何を変え、何を作るか、具体的に）
- improvements：改善の記録に残す（最大3。problem、idea）。過去に失敗した改善は繰り返さない
出力形式: {"summary":"今日の要点（80字以内）","statements":[{"role":"sns","text":"...","facts":["F1"]}],"issues":[...],"proposals":[...],"taskUpdates":[...],"newTasks":[...],"plan":["..."],"improvements":[...]}`;

function checkFacts(ids, facts) {
  const known = new Set(facts.map((f) => f.id));
  return (Array.isArray(ids) ? ids : []).map((x) => str(x, 6)).filter((x) => known.has(x));
}
function claimsWithoutRecord(text, factIds, facts) {
  if (!CLAIM_RE.test(text)) return false;
  return !factIds.some((id) => (facts.find((f) => f.id === id) || {}).area === 'activity');
}
export function readNewTasks(list, today) {
  return (Array.isArray(list) ? list : []).slice(0, 3).map((t) => {
    const days = Math.max(1, Math.min(14, Number(t && t.dueDays) || 3));
    const due = new Date(`${today || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + days);
    return { title: clean(t && t.title, 60), assignee: ROLES[t && t.assignee] ? t.assignee : '', priority: PRIORITY[t && t.priority] ? t.priority : 'mid', due: due.toISOString().slice(0, 10), doneWhen: clean(t && t.doneWhen, 80) };
  }).filter((t) => t.title && t.assignee && t.doneWhen);
}

export function parseMeeting(content, input) {
  const d = json(content);
  const { facts, tasks } = input;
  const statements = [];
  for (const s of Array.isArray(d.statements) ? d.statements : []) {
    const role = s && s.role;
    const text = clean(s && s.text, 100);
    const f = checkFacts(s && s.facts, facts);
    if (!ROLES[role] || !text || statements.some((x) => x.role === role) || claimsWithoutRecord(text, f, facts) || NG_RE.test(text)) continue;
    statements.push({ role, text, facts: f });
  }
  const issues = (Array.isArray(d.issues) ? d.issues : []).slice(0, 4).map((i) => ({ title: clean(i && i.title, 60), cause: clean(i && i.cause, 100), facts: checkFacts(i && i.facts, facts), owner: ROLES[i && i.owner] ? i.owner : 'ceo' }))
    .filter((i) => i.title && i.facts.length && !claimsWithoutRecord(i.title + i.cause, i.facts, facts));
  const proposals = (Array.isArray(d.proposals) ? d.proposals : []).slice(0, 4).map((p) => ({
    role: ROLES[p && p.role] ? p.role : 'ceo', title: clean(p && p.title, 80), facts: checkFacts(p && p.facts, facts),
    impact: clean(p && p.impact, 100), request: clean(p && p.request, 100), kind: ['decision', 'confirm', 'approve'].includes(p && p.kind) ? p.kind : 'decision'
  })).filter((p) => p.title && p.facts.length && p.impact && p.request && !claimsWithoutRecord(p.title + p.impact, p.facts, facts)); // 根拠・影響・求める対応のない提言は出さない
  const known = new Set(tasks.map((t) => t.id));
  const taskUpdates = (Array.isArray(d.taskUpdates) ? d.taskUpdates : []).map((u) => ({ id: str(u && u.id, 24), note: clean(u && u.note, 80), status: ['todo', 'doing', 'blocked'].includes(u && u.status) ? u.status : '' }))
    .filter((u) => known.has(u.id) && u.note && !CLAIM_RE.test(u.note));
  if (!statements.length) throw new AiError('会議の発言を作れませんでした'); // 中身のない会議を「開いた」ことにしない
  return {
    summary: clean(d.summary, 100), statements, issues, proposals, taskUpdates,
    newTasks: readNewTasks(d.newTasks, input.date),
    plan: (Array.isArray(d.plan) ? d.plan : []).slice(0, 4).map((p) => clean(p, 100)).filter(Boolean),
    improvements: (Array.isArray(d.improvements) ? d.improvements : []).slice(0, 3).map((m) => ({ problem: clean(m && m.problem, 80), idea: clean(m && m.idea, 80) })).filter((m) => m.problem && m.idea)
  };
}

export async function meeting({ input, env, deadline }) {
  if (!input.facts.length) throw new AiError('会議に使う事実がありません');
  const userContent = [
    `今日: ${input.date}`,
    `事実の一覧:\n${factLines(input.facts)}`,
    `業務の一覧:\n${taskLines(input.tasks) || 'なし'}`,
    input.ownerNotes.length ? `前回の会議のあとの社長の返信・判断:\n${input.ownerNotes.map((n) => `${n.at} ${n.about ? `（${n.about}）` : ''}${n.decision ? `[${n.decision}] ` : ''}${n.text}`).join('\n')}` : '前回の会議のあとの社長の返信: なし',
    input.lastPlan.length ? `前回の「明日の改善計画」: ${input.lastPlan.join('／')}` : '',
    input.improvements.length ? `これまでの改善の記録:\n${input.improvements.map((m) => `${m.problem} → ${m.idea}（${m.status || '未検証'}${m.result ? `：${m.result}` : ''}）`).join('\n')}` : '',
    `確認済みの外部の事実: ${PLATFORM_FACTS.map((p) => p.text).join('／')}`
  ].filter(Boolean).join('\n\n');
  const { result } = await runWithModels({ env, deadline, system: MEETING_PROMPT, userContent, parse: (c) => parseMeeting(c, input) });
  return result;
}

// ---- 社長の返信 → 社員の応答と業務 ----
const REPLY_PROMPT = `${BASE_RULES}
社長が会議室で返信しました。関係する社員が短く応答し、社長の返信を具体的な業務にします。JSONだけを返してください。
- messages：社員の応答（1〜3人。role、text＝80字以内。引き受ける内容・次にすること）。最後は経営責任者が担当と期限を割り当てる
- newTasks：社長の返信から作る業務（0〜2。title、assignee、priority、dueDays、doneWhen＝完了条件。社長が判断できる形の成果物にする）
- taskUpdates：既存の業務に関係するなら（id、note、status＝todo/doing/blocked）
- 承認・却下だけの返信なら、業務を増やさなくてよい
出力形式: {"messages":[{"role":"designer","text":"..."}],"newTasks":[...],"taskUpdates":[...]}`;

export async function reply({ message, about, tasks, facts, date, env, deadline }) {
  const userContent = [
    `社長の返信: ${message}`,
    about && about.title ? `返信先: ${about.role ? `${ROLES[about.role] || ''}の` : ''}「${about.title}」${about.text ? `（${about.text}）` : ''}` : '返信先: 会議室全体',
    `業務の一覧:\n${taskLines(tasks) || 'なし'}`,
    facts.length ? `事実の一覧:\n${factLines(facts)}` : ''
  ].filter(Boolean).join('\n\n');
  const { result } = await runWithModels({
    env, deadline, system: REPLY_PROMPT, userContent,
    parse: (c) => {
      const d = json(c);
      const messages = (Array.isArray(d.messages) ? d.messages : []).slice(0, 4).map((m) => ({ role: ROLES[m && m.role] ? m.role : '', text: clean(m && m.text, 120) }))
        .filter((m) => m.role && m.text && !CLAIM_RE.test(m.text));
      if (!messages.length) throw new AiError('社員の応答を作れませんでした');
      const known = new Set(tasks.map((t) => t.id));
      const taskUpdates = (Array.isArray(d.taskUpdates) ? d.taskUpdates : []).map((u) => ({ id: str(u && u.id, 24), note: clean(u && u.note, 80), status: ['todo', 'doing', 'blocked'].includes(u && u.status) ? u.status : '' })).filter((u) => known.has(u.id) && u.note);
      return { messages, newTasks: readNewTasks(d.newTasks, date).slice(0, 2), taskUpdates };
    }
  });
  return result;
}

// ---- 担当社員の作業：改善案（デザイナー・コピーライター）／作業計画（ほかの社員） ----
const DESIGN_PROMPT = `${BASE_RULES}
あなたはデザイナーとコピーライターです。社長から発注された業務について、今のInstagram投稿画像（投稿セット）を評価し、改善案を提出します。JSONだけを返してください。
- diagnosis：次の観点それぞれ（point、score＝1〜5、finding＝60字以内。渡された情報から分かることだけ。見ていない画像の細部を断定しない）：${DESIGN_POINTS.join('／')}
- changes：具体的な改善（3〜5。何をどう変えるか。実装の担当が分かるように）
- copyVariants：一覧の1番目（最新）の投稿セットの、表紙の見出しの案（3〜4。その投稿セットの商品・価格に合う内容で。angle は ${ANGLES.join('・')} から重複なく選ぶ。title は24字以内。今までの見出しと似せない。誇張・断定・医療の効果は書かない）
- coverStyle：改善版に使う表紙の型（${COVER_STYLES.join('/')} から1つ）
- tool：今の作り方に限界があり、ツールの導入を提案するなら（id は「ツールの一覧」から。problem＝今の問題、expected＝期待できる改善、alternative＝導入しない場合の代替案）。不要なら null
- nextStep：社長に確認してほしいこと（60字以内）
出力形式: {"summary":"...","diagnosis":[{"point":"...","score":3,"finding":"..."}],"changes":["..."],"copyVariants":[{"angle":"意外性","title":"..."}],"coverStyle":"trend_pick","tool":{"id":"...","problem":"...","expected":"...","alternative":"..."},"nextStep":"..."}`;

const PLAN_PROMPT = `${BASE_RULES}
あなたは担当の社員です。発注された業務の作業計画を提出します（まだ実行していない作業は「予定」として書く）。JSONだけを返してください。
出力形式: {"summary":"...","steps":["..."],"needOwner":"社長に必要な操作（なければ空）","nextStep":"..."}`;

export function readWorkInput(b) {
  const x = b && typeof b === 'object' ? b : {};
  const t = readTasks([x.task])[0];
  const sets = (Array.isArray(x.sets) ? x.sets : []).slice(0, 6).map((s) => ({
    title: str(s && s.title, 40), pattern: str(s && s.pattern, 30), coverStyle: str(s && s.coverStyle, 30), items: Number(s && s.items) || 0,
    prices: str(s && s.prices, 40), imageSource: str(s && s.imageSource, 40), issues: str(s && s.issues, 160), status: str(s && s.status, 10)
  })).filter((s) => s.title);
  return { task: t, sets, ownerNote: str(x.ownerNote, 200), facts: readFacts(x.facts) };
}

export async function work({ input, env, deadline }) {
  const { task } = input;
  if (!task) throw new AiError('業務がありません');
  const design = task.assignee === 'designer' || task.assignee === 'copywriter';
  const userContent = [
    `業務: ${task.title}／完了条件: ${task.doneWhen}`,
    input.ownerNote ? `社長の指示: ${input.ownerNote}` : '',
    design ? `今の投稿セット（新しい順）:\n${input.sets.map((s, i) => `${i + 1}. 「${s.title}」／企画 ${s.pattern}／表紙の型 ${s.coverStyle}／${s.items}商品／価格 ${s.prices}／画像 ${s.imageSource}／状態 ${s.status}${s.issues ? `／品質確認 ${s.issues}` : ''}`).join('\n') || 'なし'}` : '',
    design ? `今の作り方: アプリの中で、楽天の商品画像と文字を組み合わせて画像を描いている（Canvas）。表紙は商品1点を大きく見せる型を使用` : '',
    design ? `ツールの一覧:\n${catalogLines()}` : '',
    input.facts.length ? `事実の一覧:\n${factLines(input.facts)}` : ''
  ].filter(Boolean).join('\n\n');
  const { result } = await runWithModels({
    env, deadline, system: design ? DESIGN_PROMPT : PLAN_PROMPT, userContent,
    parse: (c) => {
      const d = json(c);
      if (!design) {
        const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, 6).map((s) => clean(s, 100)).filter((s) => s && !CLAIM_RE.test(s));
        if (!steps.length) throw new AiError('作業計画を作れませんでした');
        return { type: 'plan', summary: clean(d.summary, 120), steps, needOwner: clean(d.needOwner, 100), nextStep: clean(d.nextStep, 80) };
      }
      const diagnosis = (Array.isArray(d.diagnosis) ? d.diagnosis : []).map((x) => ({ point: DESIGN_POINTS.includes(x && x.point) ? x.point : '', score: Math.max(1, Math.min(5, Math.round(Number(x && x.score) || 0))), finding: clean(x && x.finding, 80) }))
        .filter((x) => x.point && x.finding);
      const used = new Set();
      const copyVariants = (Array.isArray(d.copyVariants) ? d.copyVariants : []).map((v) => ({ angle: ANGLES.includes(v && v.angle) ? v.angle : '', title: clean(v && v.title, 26) }))
        .filter((v) => v.angle && v.title && !NG_RE.test(v.title) && !used.has(v.angle) && used.add(v.angle)).slice(0, 4);
      const changes = (Array.isArray(d.changes) ? d.changes : []).slice(0, 5).map((x) => clean(x, 100)).filter(Boolean);
      if (diagnosis.length < 4 || !copyVariants.length || !changes.length) throw new AiError('改善案を作れませんでした');
      const t = d.tool && TOOL_CATALOG.find((x) => x.id === d.tool.id);
      // ツールの料金・無料範囲・API・社長の操作は、確認済みの一覧の内容をそのまま付ける（AIに書かせない）
      const tool = t ? { ...t, problem: clean(d.tool.problem, 100), expected: clean(d.tool.expected, 100), alternative: clean(d.tool.alternative, 100) } : null;
      return {
        type: 'design', summary: clean(d.summary, 120), diagnosis, changes, copyVariants,
        coverStyle: COVER_STYLES.includes(d.coverStyle) ? d.coverStyle : 'trend_pick', tool: tool && tool.problem ? tool : null, nextStep: clean(d.nextStep, 80)
      };
    }
  });
  return result;
}
