// サングラスくま株式会社 2.0：ROOMの案件とは独立した3本の仕事の流れ（2026-11-24・KOT-12）
//   ① venture ＝新規副業の発掘 → 需要・競合の調査 → 監査 → 試作（販売ページの下書き）
//   ② growth  ＝集客・販促の仮説 → 実データの確認 → 監査（投稿案・コメント返信案・実験計画。送らない・投稿しない）
//   ③ digital ＝note等のデジタル商品の企画 → 監査 → 独自原稿・販売ページの下書き
//   どれも ROOM の案件キュー・社長の確認待ち件数・投稿セットの数とは無関係に動く（読むのは自分の保存場所 v2:ventures だけ。
//   growth だけは「実績・成果の数字」を読む＝実データ）。それぞれに：順番待ちの仕事（段階）・1日の費用の上限・新しい案の間隔と上限・重複防止・成果物の保存・状態表示。
//   守ること：外部への公開・送信・有料契約・アカウント作成はしない（下書きまで）。予測収益は「仮定」と明記。実データが無いものは「未計測」。
//   出典：AIの知識による仮説は「出典未確認」と明記。調べた事実は、実際に取得した出典（楽天市場の検索・自分の実績の記録）だけを日付つきで残す。
import { runWithModels, NG_RE } from '../ai.js';
import { allCalls } from '../ai-usage.js';
import { MEDICAL_RE } from '../agents.js';
import { searchRaw } from '../rakuten.js';
import { computeKpi } from './kpi.js';
import { withRole, ventureDiscoveryOn } from './policy.js';

export const VENTURE_KEYS = { store: 'v2:ventures' };
const K = VENTURE_KEYS;
const now = () => new Date().toISOString();
const jst = (d = new Date()) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const list = (v, n, m) => (Array.isArray(v) ? v : []).map((x) => str(x, m)).filter(Boolean).slice(0, n);
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// ---- 上限（無限生成・費用の暴走を止める） ----
export const DISCOVER_EVERY_HOURS = 20;  // 新しい案を作る間隔（流れごと）
export const MAX_ACTIVE = 2;             // 作りかけ（まだ完成していない）案がこの数なら、新しい案は作らない
export const MAX_REVIEW = 4;             // 完成して社長の判断待ちの案がこの数なら、新しい案は作らない（ほかの案の仕事は続ける）
export const MAX_ITEMS = 60;             // 流れごとの保存数の上限（超えたら新しい案は作らない。消さない）
export const DAY_CAP_YEN = 3;            // 流れごとの1日のAI費用の上限（円・実測）
export const MAX_TRIES = 3;              // 1つの段階のやり直し（失敗が続けば止めて理由を残す）
const LOCK_MS = 120000;
const DUP = 0.6;                         // 重複とみなす類似度（bigram）

// 既存の分野に偏らないよう、新規副業の探索軸を順番に回す（医療・防災・ガジェットなど特定の分野を固定しない）
export const AXES = ['デジタルテンプレート・素材の販売', '小規模なWebツール・計算機', 'スタンプ・絵文字・壁紙などのクリエイター商品', '比較・まとめコンテンツ（アフィリエイト）', '教材・学習コンテンツ（PDF・動画・ワークシート）', '地域・ローカル向けの小さなサービス', '法人・個人事業主向けの定型作業の代行・自動化', '写真・イラスト・音素材のストック販売', '会員制・サブスクの小さな情報サービス', '受注生産・プリントオンデマンドの雑貨', 'データ・リサーチの整理販売', 'ゲーム・アプリ・拡張機能の小品'];

export const STREAMS = {
  venture: { label: '新規副業', stages: [{ name: 'idea', agent: 'planner', est: 1, task: '新しい副業の案を考える' }, { name: 'research', agent: 'buyer', est: 0, task: '需要・競合・価格帯を調べる（楽天市場の検索・AIは使わない）' }, { name: 'audit', agent: 'auditor', est: 0, task: '案の根拠・規約・費用・手間を確かめる' }, { name: 'proto', agent: 'designer', est: 1.5, task: '販売ページの下書き（試作）を作る' }] },
  growth: { label: '集客・販促の実験', stages: [{ name: 'hypothesis', agent: 'pr', est: 1, task: '集客の仮説と実験計画・投稿案・返信案を作る' }, { name: 'facts', agent: 'appraiser', est: 0, task: '実績の数字（閲覧→プロフィール→ROOM→購入）を確かめて添える' }, { name: 'audit', agent: 'auditor', est: 0, task: '規約・根拠・実験の測り方を確かめる' }] },
  digital: { label: 'デジタル商品（note等）', stages: [{ name: 'plan', agent: 'writer', est: 1, task: 'デジタル商品（note・PDF等）の企画を作る' }, { name: 'audit', agent: 'auditor', est: 0, task: '独自性・出典・規約・医療情報のリスクを確かめる' }, { name: 'draft', agent: 'editor', est: 1.5, task: '独自の原稿・販売ページの下書きを作る' }] }
};
const ORDER = ['venture', 'growth', 'digital']; // 仕事を探す順（売上に近い順に並べ替えるのは優先度の点数）

// ---- 保存（同時に動く3本のレーンが上書きし合わないよう、順番に書く） ----
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
async function load(kv) {
  const s = (await kv.getJson(K.store)) || {};
  return { items: Array.isArray(s.items) ? s.items : [], spent: s.spent || {}, last: s.last || {}, depts: s.depts || {}, runs: Array.isArray(s.runs) ? s.runs : [], seq: Number(s.seq) || 0 };
}
const update = (kv, fn) => serial(async () => { const s = await load(kv); const r = await fn(s); await kv.setJson(K.store, s); return r; });

// ---- 重複防止 ----
const norm = (t) => String(t || '').replace(/[\s　・、。「」『』（）()【】\-_/]/g, '').toLowerCase();
const bigrams = (t) => { const s = norm(t); const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
export function similar(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return norm(a) === norm(b);
  let n = 0; A.forEach((x) => { if (B.has(x)) n += 1; });
  return n / Math.min(A.size, B.size) >= DUP;
}

// ---- 共通の確認（コードだけ・AIは使わない） ----
const BAN_RE = /自動(いいね|フォロー|コメント|投稿)|ボット|bot\b|フォロワー(を)?(購入|買)|相互フォロー|フォロバ|いいね(回り|周り)|一斉(送信|DM)|スパム|大量(フォロー|コメント|DM)|ステマ|サクラ|やらせ|転載|丸写し|要約(して)?(販売|転載)/i;
const SELL_RE = /月\d+万円(稼|確実|保証)|必ず稼|誰でも(簡単に)?稼|不労所得|寝てても|100%|確実に(儲|稼|売)/;
const textOf = (o) => JSON.stringify(o || {});
export function riskIssues(obj) {
  const t = textOf(obj); const out = [];
  if (BAN_RE.test(t)) out.push('規約に反する手段（自動いいね・大量フォロー・スパム・要約転載など）を含む');
  if (SELL_RE.test(t)) out.push('収益を断定・保証する表現がある（予測は仮定と書く）');
  if (NG_RE.test(t)) out.push('体験談・誇張・断定の表現がある');
  if (MEDICAL_RE.test(t)) out.push('医療の効果を言い切る表現がある');
  return out;
}

// ---- AI（1回・JSONだけ。残高・予算の確認は呼び出し側 tick が先に行う） ----
async function ask(ctx, system, user) {
  const { result } = await runWithModels({ env: ctx.env, deadline: Date.now() + 40000, system: withRole(roleOf(system), system), userContent: user, parse: (c) => JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]) });
  return result || {};
}
const yenSoFar = () => Math.round(allCalls().reduce((a, c) => a + (Number(c.yen) || 0), 0) * 1000) / 1000;

const COMMON = `共通の決まり：医療・防災・ガジェット・ROOMなど特定の分野に偏らない。業界や商品の形は固定せず、需要の実証のしやすさ・継続して利益が出るか・AIで自動化できる余地・オーナーの手間・初期と維持の費用・競争優位・規約と法のリスクを同じ基準で考える。専門性を活かせる案は強みとして書いてよいが、それだけで選ばない。体験談（使ってみた・愛用）・誇張・断定・収益の保証は書かない。分からないことは「未確認」と書く。外部への公開・送信・有料契約・アカウント作成はオーナーの承認が必要なので、下書きまでにする。JSONだけを返す。`;

// ---- 段階の中身 ----
const P_IDEA = `あなたは新規事業開発の担当です。オーナーが少ない手間で続けて利益を出せる「副業」の案を最大2件考えます。\n${COMMON}\n探す軸（今回）と、すでにある案・社長の判断（採用・保留・却下の理由）が渡されます。すでにある案と似た案は出さない。却下の理由は次に活かす。\n返す形：{"ideas":[{"title":"案の名前","category":"分野","whyChosen":"なぜこの案か（既存の領域の外から選んだ理由）","customer":"対象の顧客","problem":"顧客の課題","product":"商品・サービス","channel":"販売経路","revenueModel":"収益モデル","revenueAssumption":"予測収益と、その仮定（確定値ではない）","marketKeyword":"需要の目安を楽天市場で調べる短い言葉（無ければ空）","competitorsNote":"競合・需要について分かること（分からなければ未確認）","initialCostYen":数値,"monthlyCostYen":数値,"ownerHoursPerWeek":数値,"aiDoes":["AIが代行できる工程"],"ownerDoes":["オーナーの作業"],"risks":{"terms":"規約","copyright":"著作権","medical":"医療情報（関係なければ関係なし）"},"minExperiment":"最小の実験","success":"成功の判断基準","withdraw":"撤退の判断基準","repeatability":1〜5の整数（売上の再現性）}]}`;
const P_GROWTH = `あなたはInstagram・楽天ROOMの集客の担当です。閲覧→プロフィール→ROOM→購入の流れで、いちばん詰まっている所を実データから見つけ、検証できる施策を1件考えます。\n${COMMON}\n渡される「実績の数字」にある数字だけを根拠にする。数字が「未計測」の所は、推測せず「未計測」と書き、計測する方法を実験に入れる。Instagramでの自動いいね・大量フォロー・スパムコメントは書かない。\n返す形：{"title":"施策の名前","funnelStage":"閲覧・プロフィール・ROOM・購入のどこか","hypothesis":"仮説","basisFacts":["渡された数字にもとづく事実（数字は渡されたものだけ）"],"experiment":{"what":"やること","days":数値,"metric":"測る数字","success":"成功の基準","ownerSteps":["オーナーの操作（最小）"]},"drafts":{"posts":[{"caption":"投稿案の文章（PR表記を含む・体験談なし）"}],"replies":[{"situation":"どんなコメントが来たとき","reply":"返信案"}]},"risks":"規約・表記のリスク"}`;
const P_DIGITAL = `あなたはnote等のデジタル商品の企画担当です。公開情報と一般的な知識にもとづく、オリジナルの有料コンテンツ（note記事・簡易PDF・テンプレート等）の企画を1件考えます。\n${COMMON}\n既存の書籍・記事の要約や転載を売る企画は不可。分野は固定しない。医学系の内容なら medical を true にする（出典確認と人間のレビューが必須になる）。\n返す形：{"title":"商品名","format":"note有料記事／PDF／テンプレートなど","target":"対象の読者","problem":"読者の課題","originality":"独自性（どの自前の知見・体験・データを使うか。オーナーの確認が必要なものはそう書く）","outline":["章立て"],"freeToPaid":{"freeArticle":"無料記事の内容","bridge":"有料への導線"},"priceIdea":"価格の案（仮定）","sourcesNeeded":["確認が必要な出典・情報"],"medical":true/false,"copyrightNote":"著作権への配慮"}`;
const P_PROTO = `あなたは販売ページの試作担当です。渡された副業の案について、公開前の販売ページの下書きを作ります（公開はしない）。\n${COMMON}\n返す形：{"headline":"見出し","lead":"導入","bullets":["特長（事実だけ）"],"offer":"商品・価格の案（仮定）","faq":[{"q":"","a":""}],"cta":"申し込みの案内","notes":"未確認の点・公開前に確認すること"}`;
const P_DRAFT = `あなたはデジタル商品の原稿担当です。渡された企画をもとに、独自の原稿の下書きを作ります（公開はしない）。\n${COMMON}\n既存の書籍・記事を要約・転載しない。出典が要る主張は「要出典」と印を付ける。\n返す形：{"freeArticle":"無料記事の下書き（400〜800字）","salesPage":{"headline":"","body":"","bullets":[""]},"pdfOutline":[{"heading":"","points":[""]}],"needsReview":["人間が確認すること（出典・臨床的正確性・著作権など）"]}`;

const roleOf = (p) => (p === P_GROWTH ? 'pr' : p === P_IDEA || p === P_DIGITAL ? 'planner' : p === P_PROTO ? 'designer' : 'editor');
const stageOf = (stream, name) => STREAMS[stream].stages.find((s) => s.name === name);
const agentOf = (stream, name) => (stageOf(stream, name) || {}).agent;

// 新しい案の保存（重複は捨てる）
function addItem(s, stream, data, by, yen) {
  const dup = s.items.find((x) => x.stream === stream && similar(x.title, data.title));
  if (dup) return { dup: dup.title };
  s.seq += 1;
  const it = { id: `${stream[0]}${Date.now().toString(36)}${s.seq}`, stream, title: data.title, status: 'active', stage: STREAMS[stream].stages[1].name, createdAt: now(), tries: {}, data, sources: [], artifacts: [{ stage: STREAMS[stream].stages[0].name, by, at: now(), yen, kind: 'draft', title: `${STREAMS[stream].stages[0].task}：${data.title}` }], log: [{ at: now(), by, text: `${STREAMS[stream].stages[0].task}（費用 ${yen}円）` }] };
  s.items.push(it);
  return { item: it };
}
const basisAI = '出典未確認（AIの知識にもとづく仮説。外部サイトの調査はしていない）';

async function runIdea(ctx, kv) {
  const s0 = await load(kv);
  const mine = s0.items.filter((x) => x.stream === 'venture');
  const axis = AXES[mine.length % AXES.length];
  const decided = mine.filter((x) => x.decision).slice(-8).map((x) => `- ${x.title}：${x.decision.label}${x.decision.why ? `（${x.decision.why}）` : ''}`).join('\n') || '（まだ判断なし）';
  const exist = mine.slice(-20).map((x) => `- ${x.title}（${x.data.category || ''}）`).join('\n') || '（まだ案なし）';
  const r = await ask(ctx, P_IDEA, `今回の探す軸：${axis}\nすでにある案：\n${exist}\n社長の判断：\n${decided}`);
  const yen = yenSoFar();
  const out = []; const ng = [];
  await update(kv, (s) => {
    for (const x of (Array.isArray(r.ideas) ? r.ideas : []).slice(0, 3)) {
      if (out.length >= 2) break;
      const d = normIdea(x);
      if (!d) { ng.push('必須項目が足りない'); continue; }
      const issues = riskIssues(d);
      if (issues.length) { ng.push(`${d.title}（${issues[0]}）`); continue; }
      // 偏りの防止：直近5件のうち同じ分野が3件以上なら入れない
      const recent = s.items.filter((y) => y.stream === 'venture').slice(-5).filter((y) => norm(y.data.category) === norm(d.category)).length;
      if (recent >= 3) { ng.push(`${d.title}（同じ分野が続く）`); continue; }
      const a = addItem(s, 'venture', d, 'planner', yen);
      if (a.dup) { ng.push(`${d.title}（「${a.dup}」と重複）`); continue; }
      out.push(a.item.title);
    }
    s.last.venture = now();
  });
  if (!out.length) return { done: `新しい副業の案を考えたが、入れる案は無かった（${ng.join('・').slice(0, 100) || '案なし'}）`, yen };
  return { done: `新しい副業の案を${out.length}件出した（軸：${axis}／${out.join('・').slice(0, 80)}）`, yen, title: out[0] };
}
function normIdea(x) {
  if (!x || typeof x !== 'object') return null;
  const d = { title: str(x.title, 40), category: str(x.category, 30), whyChosen: str(x.whyChosen, 200), customer: str(x.customer, 120), problem: str(x.problem, 160), product: str(x.product, 160), channel: str(x.channel, 100), revenueModel: str(x.revenueModel, 120), revenueAssumption: str(x.revenueAssumption, 200), marketKeyword: str(x.marketKeyword, 20), competitorsNote: str(x.competitorsNote, 200) || '未確認', initialCostYen: num(x.initialCostYen), monthlyCostYen: num(x.monthlyCostYen), ownerHoursPerWeek: num(x.ownerHoursPerWeek), aiDoes: list(x.aiDoes, 5, 60), ownerDoes: list(x.ownerDoes, 5, 60), risks: { terms: str(x.risks && x.risks.terms, 120), copyright: str(x.risks && x.risks.copyright, 120), medical: str(x.risks && x.risks.medical, 120) }, minExperiment: str(x.minExperiment, 200), success: str(x.success, 120), withdraw: str(x.withdraw, 120), repeatability: Math.min(5, Math.max(1, Math.round(num(x.repeatability) || 0))) || null };
  if (!d.title || !d.customer || !d.product || !d.channel || !d.minExperiment) return null;
  return d;
}

// 需要の目安：楽天市場の検索（実データ・0円）。取れなければ「未取得」（推測しない）
async function runResearch(item, ctx) {
  const kw = item.data.marketKeyword;
  const at = now();
  if (!kw) return { src: { kind: 'none', label: '楽天市場で調べる言葉が無い案（デジタル商品などは、楽天市場の件数では需要を測れない）', at, status: '未取得' }, text: '需要の実データは未取得（楽天市場で調べる言葉が無い）' };
  if (!String(ctx.env.RAKUTEN_APP_ID || '').trim()) return { src: { kind: 'rakuten-search', label: `楽天市場商品検索API「${kw}」`, at, status: '未取得', why: '楽天のAPIキーが未設定' }, text: '需要の実データは未取得（楽天のAPIキーが未設定）' };
  try {
    const r = await searchRaw({ keyword: kw, env: ctx.env, referer: ctx.referer || '', hits: 10 });
    const prices = (r.items || []).map((i) => Number(i.price)).filter((p) => p > 0).sort((a, b) => a - b);
    const pages = Number(r.pageCount) || 0; // 検索結果のページ数（1ページ10件。広さの目安）
    const src = { kind: 'rakuten-search', label: `楽天市場商品検索API「${kw}」（関連商品の広がりと価格帯。需要そのものではなく目安）`, at, status: '取得', pages, found: (r.items || []).length, priceMin: prices[0] || null, priceMax: prices[prices.length - 1] || null, top: (r.items || []).slice(0, 3).map((i) => str(i.name, 40)) };
    return { src, text: `楽天市場「${kw}」の検索結果 ${pages}ページ分・上位${src.found}件の価格帯 ${src.priceMin ?? '未取得'}〜${src.priceMax ?? '未取得'}円（目安）` };
  } catch (e) {
    return { src: { kind: 'rakuten-search', label: `楽天市場商品検索API「${kw}」`, at, status: '未取得', why: str(e.message || e, 60) }, text: `需要の実データは未取得（${str(e.message || e, 50)}）` };
  }
}

// 優先度（コードの計算）：低コスト・手間が少ない・再現性が高い順。収益の予測は点数に使わない（仮定のため）
export function priority(d) {
  const cost = d.initialCostYen == null ? 20000 : d.initialCostYen + (d.monthlyCostYen || 0) * 3;
  const hours = d.ownerHoursPerWeek == null ? 10 : d.ownerHoursPerWeek;
  const rep = d.repeatability || 1;
  return Math.max(0, Math.round(Math.max(0, 40 - cost / 500) + Math.max(0, 30 - hours * 3) + rep * 6));
}

function auditVenture(it) {
  const d = it.data; const miss = [];
  for (const [k, l] of [['customer', '対象顧客'], ['problem', '課題'], ['product', '商品'], ['channel', '販売経路'], ['revenueModel', '収益モデル'], ['revenueAssumption', '収益の仮定'], ['minExperiment', '最小実験'], ['success', '成功基準'], ['withdraw', '撤退基準']]) if (!d[k]) miss.push(l);
  if (d.initialCostYen == null || d.monthlyCostYen == null) miss.push('初期費用・維持費');
  if (d.ownerHoursPerWeek == null) miss.push('オーナーの作業時間');
  if (!d.risks || !d.risks.terms || !d.risks.copyright) miss.push('規約・著作権のリスク');
  if (d.revenueAssumption && !/仮定|想定|見込|前提/.test(d.revenueAssumption)) miss.push('収益が仮定だと書かれていない');
  return { miss, score: priority(d) };
}
function auditGrowth(it) {
  const d = it.data; const miss = [];
  if (!d.hypothesis) miss.push('仮説'); if (!d.experiment || !d.experiment.metric || !d.experiment.success) miss.push('測る数字・成功の基準');
  if (!(d.drafts && (d.drafts.posts || []).length)) miss.push('投稿案');
  if ((d.drafts.posts || []).some((p) => !/PR|広告|アフィリエイト/.test(p.caption))) miss.push('投稿案のPR表記');
  return { miss };
}
function auditDigital(it) {
  const d = it.data; const miss = [];
  if (!d.target || !d.problem || !d.originality || !(d.outline || []).length) miss.push('対象・課題・独自性・章立て');
  if (!d.freeToPaid || !d.freeToPaid.freeArticle || !d.freeToPaid.bridge) miss.push('無料記事から有料への導線');
  const review = !!d.medical || MEDICAL_RE.test(textOf(d)) || /医|薬|症|治療|診/.test(`${d.title}${d.problem}`);
  return { miss, review };
}

const RUN = {
  async 'venture.research'(it, ctx, kv) {
    const r = await runResearch(it, ctx);
    await update(kv, (s) => { const x = s.items.find((y) => y.id === it.id); x.sources.push(r.src); advance(x, 'research', 'buyer', r.text, 0, { kind: 'research', title: `需要の調査：${it.title}` }); });
    return { done: `「${it.title}」の需要を調べた：${r.text}`, yen: 0, title: it.title };
  },
  async 'venture.audit'(it, ctx, kv) {
    const a = auditVenture(it); const issues = riskIssues(it.data);
    return finishAudit(kv, it, 'venture', { miss: a.miss, issues, extra: { score: a.score }, text: `優先度の点 ${a.score}（低コスト・手間の少なさ・再現性の計算。収益の予測は点に使わない）` });
  },
  async 'venture.proto'(it, ctx, kv) {
    const r = await ask(ctx, P_PROTO, `案：${textOf(it.data)}\n調査：${it.sources.map((x) => x.label + '／' + (x.status || '')).join('、')}`);
    const issues = riskIssues(r); const yen = yenSoFar();
    if (!str(r.headline, 80) || !str(r.lead, 300)) return { fail: '販売ページの下書きの形が足りない' };
    await update(kv, (s) => { const x = s.items.find((y) => y.id === it.id); x.proto = { headline: str(r.headline, 80), lead: str(r.lead, 400), bullets: list(r.bullets, 6, 100), offer: str(r.offer, 160), faq: (Array.isArray(r.faq) ? r.faq : []).slice(0, 4).map((f) => ({ q: str(f && f.q, 80), a: str(f && f.a, 160) })), cta: str(r.cta, 100), notes: str(r.notes, 200), draftOnly: true, flagged: issues }; advance(x, 'proto', 'designer', `販売ページの下書き（未公開）${issues.length ? `・注意:${issues[0]}` : ''}`, yen, { kind: 'sales-page-draft', title: `販売ページの下書き：${x.title}` }); });
    return { done: `「${it.title}」の販売ページの下書きを作った（未公開・オーナーの承認で次へ）`, yen, title: it.title };
  },
  async 'growth.facts'(it, ctx, kv) {
    const k = await computeKpi(kv); const at = now();
    const f = { at, source: 'アプリに記録された成果の数字（Instagramの実績はオーナーの登録。公式APIの自動取得ではない）', views: k.views ?? null, profileVisits: k.profileVisits ?? null, roomClicks: k.roomClicks ?? null, sales: k.sales ?? null, posted: k.posted ?? 0, reelFiles: k.reelFiles ?? 0 };
    const show = (v) => (v == null ? '未計測' : v);
    const text = `閲覧 ${show(f.views)}・プロフィール ${show(f.profileVisits)}・ROOM流入 ${show(f.roomClicks)}・売上 ${show(f.sales)}（${at.slice(0, 10)}時点）`;
    await update(kv, (s) => { const x = s.items.find((y) => y.id === it.id); x.funnel = f; x.sources.push({ kind: 'kpi', label: f.source, at, status: '取得' }); advance(x, 'facts', 'appraiser', text, 0, { kind: 'funnel-facts', title: `実績の数字：${x.title}` }); });
    return { done: `「${it.title}」の実績の数字を確かめた：${text}`, yen: 0, title: it.title };
  },
  async 'growth.audit'(it, ctx, kv) { const a = auditGrowth(it); return finishAudit(kv, it, 'growth', { miss: a.miss, issues: riskIssues(it.data), text: '規約・PR表記・測り方を確かめた' }); },
  async 'digital.audit'(it, ctx, kv) { const a = auditDigital(it); return finishAudit(kv, it, 'digital', { miss: a.miss, issues: riskIssues(it.data), extra: { needsHumanReview: a.review }, text: a.review ? '医学系の可能性あり：出典確認と人間のレビューが必須' : '独自性・導線を確かめた' }); },
  async 'digital.draft'(it, ctx, kv) {
    const r = await ask(ctx, P_DRAFT, `企画：${textOf(it.data)}`);
    const issues = riskIssues(r); const yen = yenSoFar();
    const free = str(r.freeArticle, 2500);
    if (free.length < 100 || !r.salesPage || !str(r.salesPage.headline, 80)) return { fail: '原稿の下書きの形が足りない' };
    await update(kv, (s) => {
      const x = s.items.find((y) => y.id === it.id); const review = !!(x.audit && x.audit.needsHumanReview);
      x.manuscript = { freeArticle: free, salesPage: { headline: str(r.salesPage.headline, 80), body: str(r.salesPage.body, 1200), bullets: list(r.salesPage.bullets, 6, 100) }, pdfOutline: (Array.isArray(r.pdfOutline) ? r.pdfOutline : []).slice(0, 8).map((p) => ({ heading: str(p && p.heading, 60), points: list(p && p.points, 5, 100) })), needsReview: [...list(r.needsReview, 6, 100), ...(review ? ['医学系：出典確認と臨床的正確性の人間（医師）によるレビューが必須'] : []), '既存の書籍・記事の要約・転載になっていないかオーナーが確認'], draftOnly: true, flagged: issues, chars: free.length };
      advance(x, 'draft', 'editor', `原稿の下書き（無料記事${free.length}字・販売ページ・PDF構成。未公開）`, yen, { kind: 'manuscript-draft', title: `原稿の下書き：${x.title}` });
    });
    return { done: `「${it.title}」の原稿の下書きを作った（未公開・公開は人間のレビューと承認のあと）`, yen, title: it.title };
  }
};

// 段階を1つ進める。最後の段階なら社長の判断待ち（review）にする
function advance(x, stageName, by, text, yen, art) {
  const st = STREAMS[x.stream].stages; const i = st.findIndex((s) => s.name === stageName);
  x.tries[stageName] = 0;
  x.artifacts.push({ stage: stageName, by, at: now(), yen: yen || 0, ...art });
  x.log.push({ at: now(), by, text: `${text}${yen ? `（費用 ${yen}円）` : ''}` });
  if (i >= st.length - 1) { x.status = 'review'; x.stage = ''; x.log.push({ at: now(), by: 'system', text: '完成。社長の判断待ち（公開・送信・契約はしていない）' }); } else x.stage = st[i + 1].name;
}
async function finishAudit(kv, it, stream, { miss, issues, extra = {}, text }) {
  const problems = [...miss.map((m) => `${m}が足りない`), ...issues];
  await update(kv, (s) => {
    const x = s.items.find((y) => y.id === it.id);
    x.audit = { at: now(), ok: !problems.length, problems, ...extra };
    if (problems.length) {
      x.status = 'rejected'; x.stage = '';
      x.decision = { label: '監査が不合格', why: problems.join('／').slice(0, 160), by: 'auditor', at: now() };
      x.artifacts.push({ stage: 'audit', by: 'auditor', at: now(), yen: 0, kind: 'audit', title: `監査（不合格）：${x.title}` });
      x.log.push({ at: now(), by: 'auditor', text: `不合格：${problems.join('／').slice(0, 120)}` });
    } else advance(x, 'audit', 'auditor', text, 0, { kind: 'audit', title: `監査（合格）：${x.title}` });
  });
  return problems.length ? { done: `「${it.title}」を監査した：不合格（${problems.join('／').slice(0, 80)}）。次の案づくりに活かす`, yen: 0, title: it.title } : { done: `「${it.title}」を監査した：合格（${text}）`, yen: 0, title: it.title };
}

// 新しい案を作る段階（growth・digital の最初）
async function runCreate(stream, ctx, kv) {
  const s0 = await load(kv);
  const mine = s0.items.filter((x) => x.stream === stream);
  const exist = mine.slice(-20).map((x) => `- ${x.title}`).join('\n') || '（まだ案なし）';
  const decided = mine.filter((x) => x.decision).slice(-8).map((x) => `- ${x.title}：${x.decision.label}${x.decision.why ? `（${x.decision.why}）` : ''}`).join('\n') || '（まだ判断なし）';
  let r; let user;
  if (stream === 'growth') {
    const k = await computeKpi(kv);
    const perf = ((await kv.getJson('v2:perf')) || []).slice(0, 5).map((p) => `- ${str(p.title || p.theme || '題名なし', 30)}：閲覧${p.views ?? '未入力'}・形式${p.format || '不明'}`).join('\n') || '（実績の登録なし）';
    const show = (v) => (v == null ? '未計測' : v);
    const facts = `閲覧 ${show(k.views)}／プロフィールへのアクセス ${show(k.profileVisits)}／楽天ROOMへの流入 ${show(k.roomClicks)}／売上 ${show(k.sales)}／投稿済み ${k.posted ?? 0}件／リールの動画 ${k.reelFiles ?? 0}本`;
    user = `実績の数字（${jst()}時点）：${facts}\n最近の投稿の実績：\n${perf}\nすでにある案：\n${exist}\n社長の判断：\n${decided}`;
    r = await ask(ctx, P_GROWTH, user);
    const d = { title: str(r.title, 50), funnelStage: str(r.funnelStage, 20), hypothesis: str(r.hypothesis, 240), basisFacts: list(r.basisFacts, 5, 160), experiment: { what: str(r.experiment && r.experiment.what, 240), days: num(r.experiment && r.experiment.days), metric: str(r.experiment && r.experiment.metric, 80), success: str(r.experiment && r.experiment.success, 120), ownerSteps: list(r.experiment && r.experiment.ownerSteps, 5, 100) }, drafts: { posts: (Array.isArray(r.drafts && r.drafts.posts) ? r.drafts.posts : []).slice(0, 3).map((p) => ({ caption: str(p && p.caption, 600) })).filter((p) => p.caption), replies: (Array.isArray(r.drafts && r.drafts.replies) ? r.drafts.replies : []).slice(0, 4).map((p) => ({ situation: str(p && p.situation, 80), reply: str(p && p.reply, 200) })).filter((p) => p.reply) }, risks: str(r.risks, 200) };
    // 根拠の数字は、渡した実データにある数字だけ（捏造を落とす）
    const given = `${facts}${perf}`;
    const bad = d.basisFacts.some((f) => (f.match(/\d[\d,.]*/g) || []).some((n) => !given.includes(n.replace(/,/g, '')) && !given.includes(n)));
    return saveCreated(kv, stream, d, 'pr', yenSoFar(), bad ? '根拠の数字が渡した実績に無い' : '', 'growth', '実績の数字にもとづく仮説と実験計画', `実績の数字（${jst()}時点・アプリの記録）`);
  }
  user = `すでにある案：\n${exist}\n社長の判断：\n${decided}`;
  r = await ask(ctx, P_DIGITAL, user);
  const d = { title: str(r.title, 50), format: str(r.format, 30), target: str(r.target, 120), problem: str(r.problem, 160), originality: str(r.originality, 200), outline: list(r.outline, 10, 80), freeToPaid: { freeArticle: str(r.freeToPaid && r.freeToPaid.freeArticle, 200), bridge: str(r.freeToPaid && r.freeToPaid.bridge, 200) }, priceIdea: str(r.priceIdea, 80), sourcesNeeded: list(r.sourcesNeeded, 6, 100), medical: r.medical === true, copyrightNote: str(r.copyrightNote, 160) };
  return saveCreated(kv, stream, d, 'writer', yenSoFar(), !d.title ? '題名が無い' : '', 'digital', 'デジタル商品の企画', basisAI);
}
async function saveCreated(kv, stream, d, by, yen, bad, stage, label, basis) {
  const issues = bad ? [bad] : riskIssues(d);
  if (!d.title || issues.length) { await update(kv, (s) => { s.last[stream] = now(); }); return { done: `${STREAMS[stream].label}の案を考えたが、入れる案は無かった（${issues[0] || '題名が無い'}）`, yen }; }
  let res;
  await update(kv, (s) => {
    res = addItem(s, stream, d, by, yen);
    if (res.item) res.item.basis = basis;
    s.last[stream] = now();
  });
  if (res.dup) return { done: `${STREAMS[stream].label}の案を考えたが、「${res.dup}」と重複したので入れなかった`, yen };
  return { done: `${label}を作った：「${d.title}」`, yen, title: d.title };
}

// ---- 仕事探し（findWork から呼ぶ）：自分の担当の段階を先に、無ければ新しい案を作る ----
const fresh = (at) => at && Date.now() - Date.parse(at) < LOCK_MS;
const spentToday = (s, stream) => Number((s.spent[stream] || {})[jst()]) || 0;
// 新規副業の発掘・デジタル商品の制作は凍結（2026-11-24・KOT-25・社長の指示）。既存の成果物・保存データは消さない。VENTURES_FROZEN=0 で戻せる
export const FROZEN_STREAMS = ['venture', 'digital'];
export const frozen = (stream, env = {}) => FROZEN_STREAMS.includes(stream) && String((env || {}).VENTURES_FROZEN ?? '1') !== '0';
export async function venturesWork(agent, { kv, env = {}, existingOnly = false }) {
  const s = await load(kv);
  const reasons = [];
  for (const stream of ORDER) {
    const cfg = STREAMS[stream];
    if (frozen(stream, env)) { if (agent === cfg.stages[0].agent) reasons.push(`${cfg.label}：凍結中（社長の指示 KOT-25。既存の成果物は残している）`); continue; }
    // KOT-24：新規副業の発掘は止めている（保存済みの案・履歴は消さない）。戻すのは社長の判断（VENTURE_DISCOVERY=on）
    if (stream === 'venture' && !ventureDiscoveryOn(env)) { if (agent === 'planner') reasons.push('新規副業の発掘は止めている（初収益は既存商品の販売を優先・KOT-24）'); continue; }
    const its = s.items.filter((x) => x.stream === stream);
    const capLeft = DAY_CAP_YEN - spentToday(s, stream);
    // 1. すでにある案の、自分の担当の段階
    const next = its.filter((x) => x.status === 'active' && !fresh(x.lock) && agentOf(stream, x.stage) === agent && (x.tries[x.stage] || 0) < MAX_TRIES)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
    if (next) {
      const st = stageOf(stream, next.stage);
      if (st.est > 0 && capLeft < st.est) { reasons.push(`${cfg.label}：今日のAI費用の上限（${DAY_CAP_YEN}円）に近いので「${st.task}」は明日以降`); continue; }
      return { kind: `${stream}-${st.name}`, task: `${cfg.label}「${next.title}」：${st.task}`, doing: `${cfg.label}：${st.task}`, est: st.est, run: (ctx) => runStage(stream, next.id, st.name, ctx, kv) };
    }
    // 2. 新しい案（最初の段階の担当だけ）
    if (existingOnly) continue;
    const first = cfg.stages[0];
    if (first.agent !== agent) continue;
    const active = its.filter((x) => x.status === 'active').length; const review = its.filter((x) => x.status === 'review').length;
    if (active >= MAX_ACTIVE) { reasons.push(`${cfg.label}：作りかけの案が${active}件ある（先に完成させる）`); continue; }
    if (review >= MAX_REVIEW) { reasons.push(`${cfg.label}：社長の判断待ちの案が${review}件ある（新しい案は増やさない。ほかの流れは進める）`); continue; }
    if (its.length >= MAX_ITEMS) { reasons.push(`${cfg.label}：保存の上限（${MAX_ITEMS}件）`); continue; }
    if (s.last[stream] && Date.now() - Date.parse(s.last[stream]) < DISCOVER_EVERY_HOURS * 3600000) { reasons.push(`${cfg.label}：新しい案は${DISCOVER_EVERY_HOURS}時間に1回（直近 ${s.last[stream].slice(5, 16).replace('T', ' ')}）`); continue; }
    if (capLeft < first.est) { reasons.push(`${cfg.label}：今日のAI費用の上限（${DAY_CAP_YEN}円）に近い`); continue; }
    return { kind: `${stream}-${first.name}`, task: `${cfg.label}：${first.task}`, doing: `${cfg.label}：${first.task}`, est: first.est, run: (ctx) => runStage(stream, null, first.name, ctx, kv) };
  }
  return { none: reasons.length ? reasons.join('／').slice(0, 220) : '' };
}

async function runStage(stream, id, stageName, ctx, kv) {
  let it = null;
  if (id) {
    const claimed = await update(kv, (s) => { const x = s.items.find((y) => y.id === id); if (!x || x.status !== 'active' || x.stage !== stageName || fresh(x.lock)) return false; x.lock = now(); return true; });
    if (!claimed) return { done: '別の実行がすでに進めていたので、何もしなかった（二重実行の防止）', yen: 0 };
    it = (await load(kv)).items.find((y) => y.id === id);
  }
  const agent = agentOf(stream, stageName);
  let r;
  try {
    if (!it) r = stageName === 'idea' ? await runIdea(ctx, kv) : await runCreate(stream, ctx, kv);
    else r = await RUN[`${stream}.${stageName}`](it, ctx, kv);
  } catch (e) {
    const msg = str(e && e.message || e, 120);
    if (it) await update(kv, (s) => { const x = s.items.find((y) => y.id === id); if (!x) return; delete x.lock; x.tries[stageName] = (x.tries[stageName] || 0) + 1; x.log.push({ at: now(), by: agent, text: `失敗：${msg}` }); if (x.tries[stageName] >= MAX_TRIES) { x.status = 'stopped'; x.log.push({ at: now(), by: 'system', text: `${MAX_TRIES}回失敗したので止めた（社長が「もう一度」を選ぶと再開）` }); } });
    else await update(kv, (s) => { s.last[stream] = now(); }); // 新しい案づくりの失敗は、間隔を空けてやり直す（連打しない）
    return { fail: msg };
  }
  const yen = Number(r.yen) || 0;
  await update(kv, (s) => {
    const x = id && s.items.find((y) => y.id === id); if (x) delete x.lock;
    if (r.fail && x) { x.tries[stageName] = (x.tries[stageName] || 0) + 1; if (x.tries[stageName] >= MAX_TRIES) x.status = 'stopped'; }
    s.spent[stream] = { [jst()]: Math.round((spentToday(s, stream) + yen) * 1000) / 1000 };
    const d = s.depts[agent] || {}; if (!r.fail) { d.lastAt = now(); d.lastTask = `${STREAMS[stream].label}：${r.done}`.slice(0, 160); d.lastArtifact = r.title || ''; d.count = (d.count || 0) + 1; d.yen = Math.round(((d.yen || 0) + yen) * 1000) / 1000; s.depts[agent] = d; }
    s.runs = [{ at: now(), stream, stage: stageName, agent, ok: !r.fail, yen, text: String(r.done || r.fail || '').slice(0, 160), title: r.title || '' }, ...s.runs].slice(0, 80);
  });
  return r.fail ? r : { done: r.done, yen, title: r.title };
}

// ---- 社長の判断（採用・保留・却下・もう一度）。外部へは何もしない。理由を次の案づくりに渡す ----
export const DECISIONS = { adopt: '採用', hold: '保留', reject: '却下', retry: 'もう一度' };
const WANT = { adopt: 'adopted', hold: 'hold', reject: 'rejected', retry: 'active' };
export async function decideVenture(kv, { id, decision, why = '' }) {
  if (!DECISIONS[decision]) throw new Error('その判断はできません');
  // 別の実行（定期実行など）が同時に保存すると上書きで消えることがあるため、保存後に読み直して確かめ、消えていたらやり直す
  let last = null;
  for (let i = 0; i < 3; i++) {
    last = await decideOnce(kv, { id, decision, why });
    const cur = (await load(kv)).items.find((y) => y.id === id);
    if (cur && cur.status === WANT[decision]) return last;
    if (cur && i === 0 && cur.status === last.status) return last;
  }
  throw new Error('判断を保存できたか確認できませんでした。画面を読み直して、もう一度押してください');
}
async function decideOnce(kv, { id, decision, why }) {
  return update(kv, (s) => {
    const x0 = s.items.find((y) => y.id === id);
    // すでに同じ判断が保存済みなら、二重に記録しない（連打・再送で失敗にしない）
    if (x0 && decision !== 'retry' && x0.status === WANT[decision] && x0.decision) return view(x0);
    const x = s.items.find((y) => y.id === id);
    if (!x) throw new Error('その案はありません');
    if (decision === 'retry') { if (x.status !== 'stopped') throw new Error('止まった案だけ、もう一度できます'); x.status = 'active'; x.tries = {}; delete x.lock; x.log.push({ at: now(), by: 'owner', text: '社長が「もう一度」を選んだ' }); return view(x); }
    if (x.status === 'active' || x.status === 'stopped') throw new Error('まだ完成していない案には、判断できません');
    x.decision = { label: DECISIONS[decision], why: str(why, 160), by: 'owner', at: now() };
    x.status = decision === 'adopt' ? 'adopted' : decision === 'hold' ? 'hold' : 'rejected';
    x.log.push({ at: now(), by: 'owner', text: `社長が「${DECISIONS[decision]}」にした${why ? `（${str(why, 80)}）` : ''}。外部への公開・契約・送信は、アプリは行わない` });
    return view(x);
  });
}

// ---- 画面用の状態 ----
const view = (x) => ({ id: x.id, stream: x.stream, title: x.title, status: x.status, stage: x.stage, createdAt: x.createdAt, basis: x.basis || basisAI, data: x.data, sources: x.sources, artifacts: x.artifacts, log: x.log.slice(-8), audit: x.audit || null, decision: x.decision || null, proto: x.proto || null, manuscript: x.manuscript || null, funnel: x.funnel || null, priority: x.stream === 'venture' ? priority(x.data) : null, yen: Math.round(x.artifacts.reduce((a, r) => a + (Number(r.yen) || 0), 0) * 1000) / 1000 });
export const STATUS_LABEL = { active: '作成中', review: '社長の判断待ち', adopted: '採用', hold: '保留', rejected: '却下・不合格', stopped: '止まった（失敗）' };
export async function venturesState(kv, env = {}) {
  const s = await load(kv);
  const streams = {};
  for (const key of ORDER) {
    const its = s.items.filter((x) => x.stream === key);
    const nextAt = s.last[key] ? new Date(Date.parse(s.last[key]) + DISCOVER_EVERY_HOURS * 3600000).toISOString() : '';
    streams[key] = { label: STREAMS[key].label, stages: STREAMS[key].stages.map((x) => ({ name: x.name, agent: x.agent, task: x.task })), counts: Object.fromEntries(Object.keys(STATUS_LABEL).map((k) => [k, its.filter((x) => x.status === k).length])), total: its.length, lastDiscoverAt: s.last[key] || '', nextDiscoverAfter: nextAt, spentToday: spentToday(s, key), dayCapYen: DAY_CAP_YEN, caps: { active: MAX_ACTIVE, review: MAX_REVIEW, items: MAX_ITEMS } };
  }
  const items = s.items.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 40).map(view);
  const rank = items.filter((x) => x.stream === 'venture' && ['review', 'adopted', 'hold'].includes(x.status)).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  // 経営ダッシュボード用：実際にあるものだけ。無いものは「未計測」
  const k = await computeKpi(kv).catch(() => null);
  const sets = ((await kv.getJson('v2:sets')) || []);
  const inv = { waiting: sets.filter((x) => x.status === 'waiting').length, adopted: sets.filter((x) => x.status === 'adopted').length, posted: sets.filter((x) => x.status === 'posted').length };
  const art = s.items.reduce((a, x) => a + x.artifacts.length, 0);
  const dash = { artifacts: art, ownerWaiting: s.items.filter((x) => x.status === 'review').length, noteDrafts: s.items.filter((x) => x.stream === 'digital' && x.manuscript).length, salesPageDrafts: s.items.filter((x) => x.proto).length, experiments: s.items.filter((x) => x.stream === 'growth' && ['review', 'adopted'].includes(x.status)).length, inventory: inv, funnel: k ? { views: k.views ?? null, profileVisits: k.profileVisits ?? null, roomClicks: k.roomClicks ?? null, sales: k.sales ?? null } : null, spentTotalYen: Math.round(s.items.reduce((a, x) => a + x.artifacts.reduce((b, r) => b + (Number(r.yen) || 0), 0), 0) * 1000) / 1000 };
  return { streams, items, rank: rank.slice(0, 5).map((x) => ({ id: x.id, title: x.title, priority: x.priority })), dash, depts: s.depts, runs: s.runs.slice(0, 20), at: now() };
}
