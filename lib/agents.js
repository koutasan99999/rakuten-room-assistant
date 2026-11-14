// AI社員（段階1・2026-11-12）：バイヤーAIと監査AIを、それぞれ別のAI呼び出しで動かす。
// 1つのAIに複数の人格を演じさせない。社員ごとに指示（system）・渡す情報・使える道具・評価の基準を分ける。
//
// 流れ（画面が1段階ずつ呼ぶ。1段階＝1リクエスト＝60秒以内）
//   buyer  : バイヤーAIが検索語を決める（AI 1回）→ コードが楽天で検索 → バイヤーAIが検索結果から最大3件を選んで理由を書く（AI 1回）
//   check  : コードが客観的に確認する（AIなし）：楽天の商品番号で引き直して掲載・価格・URLを確認／理由に引用した文が商品名・説明に本当にあるか／禁止表現
//   audit  : 監査AI（別のAI呼び出し・モデルを個別に変えられる）が、項目ごとに採点し、減点理由・修正指示・保留/却下の提案を出す
//   revise : バイヤーAIが修正指示に従って直す（AI 1回）。必要な情報がなければ推測せず「追加調査が必要」と返す
// 判定はコードが決める：コードの確認に1つでも失敗 → 不合格（点数に関係なく）／監査AIが捏造・未確認の断定・規約違反の疑いを付けた → 不合格
//   ／項目の点数の合計（コードで足し直す）が80点以上 → 合格（社長の承認候補）／それ未満 → 修正（最大2回）→ それでも届かなければ保留
// AIの採点だけで品質を保証したとは扱わない。コードの確認（客観的な事実）とAIの採点は、別々に記録・表示する。
import crypto from 'node:crypto';
import { AiError, compact, runWithModels, DEFAULT_MODELS, NG_RE } from './ai.js';
import { searchPage, lookupItem, nameKey } from './rakuten.js';
import { takeCalls, summarize } from './ai-usage.js';

export const PASS_SCORE = 80;
export const MAX_REVISIONS = 2;
export const MAX_CANDIDATES = 3;
// 監査AIに使ってよいモデル（画面から選べる。環境変数 OPENAI_AUDIT_MODEL でも変えられる）
export const AUDIT_MODELS = ['gpt-5.4-nano', 'gpt-5-nano', 'gpt-4o-mini'];
// 医療・健康の効果をうたう表現（眼科医くまでは扱わない）
export const MEDICAL_RE = /治る|治療|改善(する|します|される)|予防(でき|する)|効く|効果(がある|抜群)|医師(が|も)(推奨|おすすめ)|眼科医(が|も)(推奨|おすすめ|勧め)/;

// 社員ごとの役割・専門・道具・評価の基準
export const ROLES = {
  buyer: {
    name: 'バイヤーAI', duty: '楽天の実際の検索結果から、ROOMで紹介する商品の候補を最大3件、根拠つきで出す',
    tools: ['楽天市場の商品検索（コードが実行）'],
    criteria: [
      { key: 'accuracy', label: '正確性', max: 25, hint: '商品名・価格・URLが楽天のデータと一致し、書いた特徴が商品名・説明にある' },
      { key: 'evidence', label: '根拠', max: 25, hint: '推薦理由が、商品名・説明の言葉（引用）にもとづいている' },
      { key: 'usefulness', label: '実用性', max: 20, hint: '誰の・どんな場面の・どんな不便を解決するかが具体的' },
      { key: 'revenue', label: '収益性', max: 15, hint: '楽天ROOMで紹介でき、買う理由がはっきりしている（価格に見合う理由がある）' },
      { key: 'compliance', label: '表現・規約', max: 15, hint: '体験したような表現・誇張・断定・医療の効果がない' }
    ]
  },
  outreach: {
    name: '営業・交流担当AI', duty: '実在する他の人の投稿（文章を確認できたもの）に、自然で具体的なコメント案を作り、フォロー候補として評価する',
    tools: ['Instagram公式API（ビジネス・クリエイターの最近の投稿）／社長が貼った投稿のURLと文章'],
    criteria: [
      { key: 'specific', label: '具体性', max: 25, hint: '投稿の文章にある具体的な1点に触れている' },
      { key: 'natural', label: '自然さ', max: 25, hint: '一般の人が書く落ち着いた日本語。決まり文句・AIっぽさ・過剰な褒め言葉がない' },
      { key: 'relevance', label: '関係性', max: 20, hint: '投稿の内容と合っていて、会話が続きやすい（感想・素朴な質問）' },
      { key: 'distance', label: '距離感・礼儀', max: 15, hint: '初対面として失礼がなく、なれなれしくない' },
      { key: 'compliance', label: '宣伝・規約', max: 15, hint: '宣伝・リンク・フォローのお願い・ROOMへの誘導・体験談がない' }
    ]
  },
  planner: {
    name: '企画担当AI', duty: '監査AIが合格にした商品候補から、Instagramの1投稿分の企画（タイトル・誰向け・商品の枠）を作り、足りない商品を楽天で探して選ぶ',
    tools: ['楽天市場の商品検索（コードが実行）'], criteria: []
  },
  producer: {
    name: '投稿セット制作AI', duty: '企画と商品から、Instagramの表紙・商品カードの文字・キャプションと、楽天ROOMの紹介文・ハッシュタグを作る',
    tools: ['商品データ（楽天）'],
    criteria: [
      { key: 'accuracy', label: '正確性', max: 25, hint: '商品名・価格・特徴が商品データと一致し、書いていないことを足していない' },
      { key: 'compliance', label: '表現・規約', max: 20, hint: 'PR（アフィリエイト）表記があり、体験したような表現・誇張・断定・医療の効果がない' },
      { key: 'concept', label: '企画の一貫性', max: 20, hint: 'タイトル・誰向け・商品の並び・キャプションが同じ企画としてまとまっている' },
      { key: 'appeal', label: '具体性・魅力', max: 20, hint: '誰の・どんな場面に合うかが具体的で、保存や購入を考える理由がある' },
      { key: 'room', label: 'ROOM紹介文', max: 15, hint: '各商品の紹介文がその商品に合い、具体的で読みやすい' }
    ]
  },
  editor: {
    name: '制作担当AI（修正）', duty: '監査AIの修正指示に従って、投稿セットのキャプションとROOM紹介文を直す。直せないときは推測せずに止める',
    tools: ['商品データ（楽天）'], criteria: []
  },
  illustrator: {
    name: '表紙画像担当AI', duty: '投稿セットの主役の商品を、サングラスくま（社長が選定したマスター画像）が日常の場面で使っている表紙画像を作り、自分で品質を確かめる。文字・ロゴは描かない（タイトルはプログラムが重ねる）',
    tools: ['マスター画像（指紋で確認）', '楽天の商品写真', 'OpenAIの画像生成（予算の上限内だけ）'], criteria: []
  },
  auditor: {
    name: '監査AI', duty: 'バイヤーAIの候補・営業・交流担当AIのコメント案・投稿セットを、商品データとコードの確認結果だけを根拠に採点し、修正指示・保留/却下の提案を出す',
    tools: ['コードの確認結果（楽天で引き直した掲載・価格、引用の照合）'],
    criteria: [
      { key: 'specific', label: '指摘の具体性', max: 50, hint: '減点理由と修正指示が、どの言葉をどう直すかまで具体的' },
      { key: 'grounded', label: '指摘の根拠', max: 50, hint: '指摘が、商品データ・確認結果の番号にもとづいている' }
    ]
  }
};

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function parseJson(c) {
  try { return JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]); } catch { throw new AiError('AIの応答をJSONとして読めませんでした'); }
}
// このリクエストで呼んだAIの記録に、社員と段階の名前を付ける（独立した呼び出しの証拠：OpenAIの応答ID・指示の要約値）
export function tagRuns(role, step, system) {
  return takeCalls().map((c) => ({ ...c, role, roleName: ROLES[role] ? ROLES[role].name : role, step, promptHash: hash(system) }));
}
export function failure(step, e, runs) {
  return { ok: false, failedStep: step, error: String(e && e.message || e).slice(0, 300), runs, aiUsage: runs.length ? summarize(runs) : null };
}

// ---------- バイヤーAI ----------
const BUYER_PLAN_PROMPT = `あなたは「眼科医くま」のバイヤーAIです（ほかの社員の役はしない）。楽天市場で商品を探す検索語を決めます。JSONだけを返してください。
お客様像：落ち着いているが無難ではない30代。生活を少し良くする道具・便利グッズ・贈り物。医薬品・医療機器・健康食品・メガネ・コンタクトは扱わない。
- keywords：2〜3語（名詞2〜4語。実際に売っている商品が見つかる言葉。型番は入れない）。why：その言葉で何を探すか（30字以内）
- 渡された「最近出した商品」と同じ商品ばかりにならない言葉にする
出力形式: {"keywords":[{"keyword":"...","why":"..."}]}`;

const BUYER_PICK_PROMPT = `あなたは「眼科医くま」のバイヤーAIです（ほかの社員の役はしない）。楽天の検索結果（R1, R2…）だけから、楽天ROOMで紹介する候補を最大3件選びます。JSONだけを返してください。
決まり（とても大事）:
- 候補は必ず検索結果の番号（ref）で選ぶ。商品名・価格・URLは書かない（コードが楽天のデータから入れる）
- quotes：推薦の根拠にした言葉を、その商品の「商品名」か「説明」から、そのまま1〜3個写す（言い換えない。コードが照合し、見つからなければ不合格）
- reason：推薦理由（80字以内）。quotes に書いたことだけを根拠にする。書いていない機能・数値・素材・受賞歴・ランキングを足さない
- target：誰の・どんな場面か（40字以内）／problem：どんな不便を解決するか（40字以内）／roomValue：楽天ROOMで紹介する価値（40字以内。価格に見合う理由）
- cautions：買う前の注意点（商品データから言えること。なければ「商品ページで仕様を確認」）
- 使ってみた・愛用・買ってよかった など体験したような表現、「最安」「絶対」「必ず」「人気」「売れている」などの断定、医療・健康の効果は書かない
- 良い候補がなければ、少なくてよい（0件でもよい。数合わせしない）
出力形式: {"candidates":[{"ref":"R1","quotes":["..."],"reason":"...","target":"...","problem":"...","roomValue":"...","cautions":"..."}],"notes":"選ばなかった理由など（60字以内）"}`;

const BUYER_REVISE_PROMPT = `あなたは「眼科医くま」のバイヤーAIです（ほかの社員の役はしない）。監査AIの修正指示に従って、候補を直します。JSONだけを返してください。
- 直すのは、修正が必要な候補だけ。各候補について、次のどれかを返す
  (1) 文章を直す：quotes・reason・target・problem・roomValue・cautions を直した版（quotes は商品名・説明からそのまま写す）
  (2) 別の商品に替える：replaceRef に検索結果の番号（R…）を入れ、その商品の quotes などを書く
  (3) 直せない：needResearch に、直すのに足りない情報を書く（推測で補わない）
- 決まりは最初と同じ（体験・断定・医療の効果は書かない。書いていないことを足さない）
出力形式: {"revisions":[{"id":"c1","replaceRef":"","quotes":["..."],"reason":"...","target":"...","problem":"...","roomValue":"...","cautions":"...","needResearch":""}]}`;

// 楽天の検索結果を、AIに渡す形にする（R1…）。商品名・価格・URL・画像は、このデータからだけ入れる
function resultLines(results) {
  return results.map((r) => `${r.ref}: ${compact(r.name, 80)} / ${r.price}円 / ${r.shop} / レビュー${r.reviewCount}件 / 説明: ${compact(r.caption, 140)}`).join('\n');
}
export function readResults(list) {
  return (Array.isArray(list) ? list : []).slice(0, 40).map((r) => ({
    ref: str(r && r.ref, 6), code: str(r && r.code, 120), name: str(r && r.name, 200), price: Number(r && r.price) || 0, url: str(r && r.url, 400),
    image: str(r && r.image, 400), shop: str(r && r.shop, 60), caption: str(r && r.caption, 400), reviewCount: Number(r && r.reviewCount) || 0,
    keyword: str(r && r.keyword, 40), checkedAt: str(r && r.checkedAt, 30)
  })).filter((r) => /^R\d+$/.test(r.ref) && r.name && r.price > 0);
}
function toCandidate(id, r, d) {
  const quotes = (Array.isArray(d.quotes) ? d.quotes : []).map((q) => str(q, 80)).filter(Boolean).slice(0, 3);
  return {
    id, ref: r.ref, code: r.code, name: r.name, price: r.price, url: r.url, image: r.image, shop: r.shop,
    checkedAt: r.checkedAt, source: `楽天市場 商品検索API（検索語：${r.keyword}）`,
    quotes, reason: str(d.reason, 120), target: str(d.target, 60), problem: str(d.problem, 60), roomValue: str(d.roomValue, 60), cautions: str(d.cautions, 80)
  };
}

export async function buyerStep({ theme, avoid = [], env, referer, startedAt = Date.now() }) {
  const runs = [];
  // 1. 検索語を決める（バイヤーAI・1回目）
  let plan;
  try {
    const user = `テーマ: ${theme}\n最近出した商品（同じものを避ける）: ${avoid.slice(0, 20).join(' / ') || 'なし'}`;
    const { result } = await runWithModels({ env, deadline: startedAt + 15000, system: BUYER_PLAN_PROMPT, userContent: user, parse: (c) => {
      const d = parseJson(c);
      const k = (Array.isArray(d.keywords) ? d.keywords : []).map((x) => ({ keyword: str(x && x.keyword, 40).replace(/[「」『』"'、。]/g, ' ').trim(), why: str(x && x.why, 40) })).filter((x) => x.keyword).slice(0, 3);
      if (!k.length) throw new AiError('検索語がありませんでした');
      return k;
    } });
    plan = result;
    runs.push(...tagRuns('buyer', '検索語を決める', BUYER_PLAN_PROMPT));
  } catch (e) {
    runs.push(...tagRuns('buyer', '検索語を決める', BUYER_PLAN_PROMPT));
    return failure('バイヤーAI：検索語を決める', e, runs);
  }
  // 2. 楽天で検索（コード・無料）
  const results = [];
  const searched = [];
  const seen = new Set(avoid.map((n) => nameKey(String(n))));
  for (const [i, k] of plan.entries()) {
    if (i > 0) await sleep(1100); // 楽天APIは1秒1回まで
    const at = new Date().toISOString();
    try {
      const r = await searchPage({ keyword: k.keyword, env, referer, hits: 20 });
      let n = 0;
      for (const it of r.items) {
        const key = nameKey(it.name);
        if (!it.image || seen.has(key) || results.some((x) => x.code === it.code)) continue;
        seen.add(key);
        results.push({ ref: `R${results.length + 1}`, code: it.code, name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop, caption: compact(it.caption, 300), reviewCount: it.reviewCount || 0, keyword: k.keyword, checkedAt: at });
        if (++n >= 8) break;
      }
      searched.push({ keyword: k.keyword, why: k.why, found: n, at });
    } catch (e) {
      searched.push({ keyword: k.keyword, why: k.why, found: 0, at, error: String(e.message).slice(0, 160) });
    }
  }
  if (!results.length) {
    const errs = searched.filter((s) => s.error);
    return { ...failure('楽天で検索', new Error(errs.length ? `楽天の検索でエラー：${errs[0].error}` : `楽天で商品が見つかりませんでした（${searched.map((s) => s.keyword).join('、')}）`), runs), searched };
  }
  // 3. 候補を選ぶ（バイヤーAI・2回目）
  try {
    const user = `テーマ: ${theme}\n検索結果:\n${resultLines(results)}`;
    const { result } = await runWithModels({ env, deadline: startedAt + 45000, system: BUYER_PICK_PROMPT, userContent: user, parse: (c) => {
      const d = parseJson(c);
      const out = [];
      for (const x of Array.isArray(d.candidates) ? d.candidates : []) {
        const r = results.find((y) => y.ref === str(x && x.ref, 6));
        if (!r || out.some((o) => o.ref === r.ref)) continue; // 検索結果にない商品は使わない（作らせない）
        out.push(toCandidate(`c${out.length + 1}`, r, x));
        if (out.length >= MAX_CANDIDATES) break;
      }
      return { candidates: out, notes: str(d.notes, 100) };
    } });
    runs.push(...tagRuns('buyer', '候補を選ぶ', BUYER_PICK_PROMPT));
    return { ok: true, theme, plan, searched, results, candidates: result.candidates, notes: result.notes, runs, aiUsage: summarize(runs) };
  } catch (e) {
    runs.push(...tagRuns('buyer', '候補を選ぶ', BUYER_PICK_PROMPT));
    return { ...failure('バイヤーAI：候補を選ぶ', e, runs), searched, results };
  }
}

// ---------- コードの確認（客観的な事実。AIなし） ----------
export function readCandidates(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_CANDIDATES).map((c) => ({
    id: str(c && c.id, 6), ref: str(c && c.ref, 6), code: str(c && c.code, 120), name: str(c && c.name, 200), price: Number(c && c.price) || 0, url: str(c && c.url, 400),
    image: str(c && c.image, 400), shop: str(c && c.shop, 60), checkedAt: str(c && c.checkedAt, 30), source: str(c && c.source, 80),
    quotes: (Array.isArray(c && c.quotes) ? c.quotes : []).map((q) => str(q, 80)).filter(Boolean).slice(0, 3),
    reason: str(c && c.reason, 120), target: str(c && c.target, 60), problem: str(c && c.problem, 60), roomValue: str(c && c.roomValue, 60), cautions: str(c && c.cautions, 80)
  })).filter((c) => /^c\d+$/.test(c.id) && c.name);
}
const flat = (s) => String(s || '').normalize('NFKC').replace(/[\s　]+/g, '');

// 1件の客観確認：楽天で商品番号を引き直す（掲載・価格・URL）／引用が商品名・説明にあるか／禁止表現
export async function checkOne(c, result, { env, referer }) {
  const checks = [];
  const add = (key, label, ok, detail, hard = true) => checks.push({ key, label, ok: ok === true ? true : ok === false ? false : null, detail: String(detail || '').slice(0, 200), hard });
  add('in_search', '楽天の検索結果にある商品', !!result, result ? `${result.ref}（検索語：${result.keyword}・${result.checkedAt}）` : '検索結果に見つからない（作られた商品の疑い）');
  add('url', '楽天の商品ページのURL', /^https:\/\/item\.rakuten\.co\.jp\//.test(c.url), c.url || 'URLなし');
  let live = null;
  try {
    live = c.code ? await lookupItem({ code: c.code, env, referer }) : null;
    add('listed', '楽天で今も掲載されている（商品番号で引き直し）', !!live, live ? `確認：${new Date().toISOString()}` : '商品番号で見つからない（販売終了・在庫切れの可能性）');
    if (live) add('price', '価格が楽天のデータと一致', live.price === c.price, live.price === c.price ? `${c.price}円` : `記録 ${c.price}円 → 今 ${live.price}円`);
  } catch (e) {
    add('listed', '楽天で今も掲載されている（商品番号で引き直し）', null, `確認できなかった：${String(e.message).slice(0, 120)}`);
  }
  const hay = flat(`${c.name} ${(result && result.caption) || ''} ${(live && live.caption) || ''}`);
  const missing = c.quotes.filter((q) => !hay.includes(flat(q)));
  add('quotes', '根拠の引用が商品名・説明に本当にある', c.quotes.length ? missing.length === 0 : false, !c.quotes.length ? '引用がない（根拠が示されていない）' : missing.length ? `見つからない引用：「${missing.join('」「')}」（根拠の捏造の疑い）` : `${c.quotes.length}件とも一致`);
  const text = [c.reason, c.target, c.problem, c.roomValue, c.cautions].join(' ');
  const ng = (text.match(NG_RE) || [])[0];
  const med = (text.match(MEDICAL_RE) || [])[0];
  add('expression', '体験談・断定・医療の効果の表現がない', !ng && !med, ng ? `「${ng}」` : med ? `「${med}」（医療の効果）` : 'なし');
  add('price_positive', '価格と画像がある', c.price > 0 && !!c.image, c.price > 0 ? (c.image ? 'あり' : '画像なし') : '価格なし', false);
  const hardFail = checks.some((x) => x.hard && x.ok === false);
  const unknown = checks.some((x) => x.hard && x.ok === null);
  return { id: c.id, checks, hardFail, unknown, livePrice: live ? live.price : null, at: new Date().toISOString() };
}

export async function checkStep({ candidates, results, env, referer, startedAt = Date.now() }) {
  const out = [];
  for (const [i, c] of candidates.entries()) {
    if (i > 0) await sleep(1100);
    if (Date.now() > startedAt + 50000) { out.push({ id: c.id, checks: [{ key: 'listed', label: '楽天で今も掲載されている', ok: null, detail: '時間切れで確認できなかった', hard: true }], hardFail: false, unknown: true, at: new Date().toISOString() }); continue; }
    out.push(await checkOne(c, results.find((r) => r.ref === c.ref && r.code === c.code) || null, { env, referer }));
  }
  return { ok: true, checks: out, rakutenCalls: candidates.length };
}

// ---------- 監査AI（評価） ----------
const AUDIT_PROMPT = `あなたは「眼科医くま」の監査AIです（バイヤーの役はしない）。バイヤーAIが出した候補を、渡された商品データ（P…）とコードの確認結果（K…）だけを根拠に採点します。JSONだけを返してください。
- 甘くしない。逆に、根拠なく全否定もしない。賛成するときも理由を書く
- 採点項目（候補ごと）: ${ROLES.buyer.criteria.map((c) => `${c.key}（${c.label}・${c.max}点：${c.hint}）`).join('／')}
- 各項目：score（0〜満点）、deductions（減点理由。どの言葉が・なぜ問題か。満点なら空）、evidence（根拠にした番号 P… / K…）
- flags（点数に関係なく不合格になるもの。疑いがあれば true にし、理由を書く）: fabrication（商品データにないことを根拠・特徴として書いている）／unverified（確認できないことを断定している：人気・売れている・最安・効果など）／policy（体験したような表現・医療の効果・誇張・規約違反の疑い）
- fixes：具体的で、そのまま実行できる修正指示（例：「reason の『〜』を削る。説明にある『〜』を根拠にする」）。必要な情報が商品データにないなら、needResearch に何を調べる必要があるかを書く（推測で補わせない）
- proposal：pass（そのままでよい）／revise（直せば良くなる）／hold（情報が足りない・判断できない）／reject（紹介に向かない）。hold・reject は理由を必ず書く
- 合計点はコードが項目の点数から計算する（あなたは書かなくてよい）
出力形式: {"audits":[{"id":"c1","scores":{"accuracy":{"score":20,"deductions":"...","evidence":["P1","K2"]}},"flags":{"fabrication":false,"unverified":false,"policy":false,"why":""},"fixes":["..."],"needResearch":"","proposal":"revise","summary":"..."}]}`;

export function auditModels(env, requested) {
  const want = String(requested || env.OPENAI_AUDIT_MODEL || '').trim();
  return AUDIT_MODELS.includes(want) ? [want] : DEFAULT_MODELS;
}

export async function auditStep({ candidates, results, checks, model, env, startedAt = Date.now() }) {
  const lines = [];
  candidates.forEach((c, i) => {
    const r = results.find((x) => x.ref === c.ref) || {};
    const k = (checks.find((x) => x.id === c.id) || { checks: [] }).checks;
    lines.push(`候補 ${c.id}`,
      `  P${i + 1}（商品データ）: ${compact(c.name, 90)} / ${c.price}円 / ${c.shop} / 説明: ${compact(r.caption || '', 220)}`,
      `  バイヤーの文章: 引用「${c.quotes.join('」「')}」／理由: ${c.reason}／誰に: ${c.target}／不便: ${c.problem}／ROOMの価値: ${c.roomValue}／注意: ${c.cautions}`,
      ...k.map((x, j) => `  K${i + 1}-${j + 1}（コードの確認）: ${x.label}：${x.ok === true ? 'OK' : x.ok === false ? 'NG' : '未確認'}（${x.detail}）`));
  });
  const models = auditModels(env, model);
  try {
    const { result } = await runWithModels({ env, models, deadline: startedAt + 50000, system: AUDIT_PROMPT, userContent: lines.join('\n'), parse: (c) => readAudits(parseJson(c), candidates) });
    const runs = tagRuns('auditor', '採点・修正指示', AUDIT_PROMPT);
    return { ok: true, audits: result, models, runs, aiUsage: summarize(runs) };
  } catch (e) {
    return failure('監査AI：採点', e, tagRuns('auditor', '採点・修正指示', AUDIT_PROMPT));
  }
}

// 監査AIの返事を読み、合計点はコードで計算し直す（AIの合計を信じない）
export function readAudits(d, candidates) {
  const out = [];
  for (const c of candidates) {
    const a = (Array.isArray(d.audits) ? d.audits : []).find((x) => x && str(x.id, 6) === c.id);
    if (!a) continue;
    const scores = {};
    let total = 0;
    for (const cr of ROLES.buyer.criteria) {
      const s = a.scores && a.scores[cr.key];
      const v = Math.max(0, Math.min(cr.max, Math.round(Number(s && (s.score != null ? s.score : s)) || 0)));
      scores[cr.key] = { score: v, max: cr.max, label: cr.label, deductions: str(s && s.deductions, 160), evidence: (Array.isArray(s && s.evidence) ? s.evidence : []).map((x) => str(x, 10)).filter(Boolean).slice(0, 6) };
      total += v;
    }
    const f = a.flags || {};
    out.push({
      id: c.id, scores, total,
      flags: { fabrication: f.fabrication === true, unverified: f.unverified === true, policy: f.policy === true, why: str(f.why, 160) },
      fixes: (Array.isArray(a.fixes) ? a.fixes : []).map((x) => str(x, 160)).filter(Boolean).slice(0, 5),
      needResearch: str(a.needResearch, 160),
      proposal: ['pass', 'revise', 'hold', 'reject'].includes(a.proposal) ? a.proposal : 'revise',
      summary: str(a.summary, 160)
    });
  }
  if (!out.length) throw new AiError('採点の結果がありませんでした');
  return out;
}

// 判定（コードが決める）：コードの確認 → 監査AIのフラグ → 合計点 → 修正の回数
export function decide({ check, audit, revisions }) {
  if (!check) return { status: 'hold', why: 'コードの確認がまだ' };
  if (check.hardFail) return { status: revisions < MAX_REVISIONS ? 'revise' : 'reject', why: 'コードの確認で不合格：' + check.checks.filter((x) => x.hard && x.ok === false).map((x) => x.label).join('、'), codeFail: true };
  if (!audit) return { status: 'hold', why: '監査AIの採点がない' };
  const fl = audit.flags;
  if (fl.fabrication || fl.unverified || fl.policy) return { status: revisions < MAX_REVISIONS ? 'revise' : 'reject', why: '監査AIが不合格の疑いを指摘：' + [fl.fabrication && '根拠の捏造', fl.unverified && '未確認の断定', fl.policy && '規約・表現'].filter(Boolean).join('、') + (fl.why ? `（${fl.why}）` : ''), flagFail: true };
  if (audit.proposal === 'reject') return { status: 'reject', why: '監査AIが却下を提案：' + (audit.summary || '') };
  if (audit.needResearch && audit.total < PASS_SCORE) return { status: 'hold', why: '追加調査が必要：' + audit.needResearch };
  if (check.unknown) return { status: 'hold', why: 'コードで確認できない項目がある（未確認のまま合格にしない）' };
  // 合格：80点以上・監査AI自身も「そのままでよい」と提案・コードの確認もすべてOK（修正指示が残っているものは合格にしない）
  if (audit.total >= PASS_SCORE && audit.proposal === 'pass') return { status: 'pass', why: `${audit.total}点（合格ライン${PASS_SCORE}点）・監査AIも合格と判断・コードの確認もすべてOK` };
  if (audit.proposal === 'hold') return { status: 'hold', why: '監査AIが保留を提案：' + (audit.summary || '') };
  if (revisions < MAX_REVISIONS) return { status: 'revise', why: audit.total >= PASS_SCORE ? `${audit.total}点だが、監査AIの修正指示が残っている` : `${audit.total}点（合格ライン${PASS_SCORE}点に届かない）` };
  return { status: 'hold', why: `修正${MAX_REVISIONS}回でも合格にならなかった（${audit.total}点・合格ライン${PASS_SCORE}点）。無理に合格にしない` };
}

// ---------- バイヤーAI：修正 ----------
export async function reviseStep({ targets, results, env, startedAt = Date.now() }) {
  const lines = [];
  for (const t of targets) {
    const r = results.find((x) => x.ref === t.candidate.ref) || {};
    lines.push(`候補 ${t.candidate.id}（今の商品 ${t.candidate.ref}: ${compact(t.candidate.name, 70)} / ${t.candidate.price}円 / 説明: ${compact(r.caption || '', 160)}）`,
      `  今の文章: 引用「${t.candidate.quotes.join('」「')}」／理由: ${t.candidate.reason}／誰に: ${t.candidate.target}／不便: ${t.candidate.problem}／ROOMの価値: ${t.candidate.roomValue}／注意: ${t.candidate.cautions}`,
      `  不合格の理由: ${t.why}`,
      `  監査AIの修正指示: ${(t.fixes || []).join('／') || 'なし'}${t.needResearch ? `／追加調査が必要: ${t.needResearch}` : ''}`,
      ...(t.codeNg || []).map((x) => `  コードの確認でNG: ${x}`));
  }
  const user = `${lines.join('\n')}\n\n替えに使える検索結果:\n${resultLines(results)}`;
  try {
    const { result } = await runWithModels({ env, deadline: startedAt + 45000, system: BUYER_REVISE_PROMPT, userContent: user, parse: (c) => {
      const d = parseJson(c);
      const out = [];
      for (const t of targets) {
        const x = (Array.isArray(d.revisions) ? d.revisions : []).find((y) => y && str(y.id, 6) === t.candidate.id);
        if (!x) { out.push({ id: t.candidate.id, needResearch: '修正案が返されなかった' }); continue; }
        if (str(x.needResearch, 160) && !(Array.isArray(x.quotes) && x.quotes.length)) { out.push({ id: t.candidate.id, needResearch: str(x.needResearch, 160) }); continue; }
        const ref = str(x.replaceRef, 6);
        const r = ref ? results.find((y) => y.ref === ref) : results.find((y) => y.ref === t.candidate.ref);
        if (!r) { out.push({ id: t.candidate.id, needResearch: `替えの商品 ${ref} が検索結果にない` }); continue; }
        out.push({ id: t.candidate.id, candidate: toCandidate(t.candidate.id, r, x), replaced: !!(ref && ref !== t.candidate.ref) });
      }
      return out;
    } });
    const runs = tagRuns('buyer', '修正', BUYER_REVISE_PROMPT);
    return { ok: true, revisions: result, runs, aiUsage: summarize(runs) };
  } catch (e) {
    return failure('バイヤーAI：修正', e, tagRuns('buyer', '修正', BUYER_REVISE_PROMPT));
  }
}
