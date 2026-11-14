// 経営企画AI（2026-11-14）：新しい収益源の調査と比較。社長の確認待ちの投稿セットが多くて制作が止まっているときも進められる、独立した仕事。
// 守ること：
//  - 根拠は、コードが実際に読み込んだ公式ページの本文だけ。AIが書いた「引用」は、コードが本文と照らし合わせ、見つからなければ「未確認」にする
//  - 収益の見込みは「推定」と明記させる（実績として扱わない）。分からないことは「未確認」
//  - 提案するだけ。新規事業の開始・登録・有料契約・外部アカウントの作成・公開は、すべて社長の承認制（このAIは何も実行しない）
//  - 案の数を競わない（1回の調査で比較は最大3案。今の事業を続けるのが最善なら、それでよい）
// 段階：fetch（コードが公式ページを読む・AIなし）→ write（経営企画AI・AI 1回）→ check（コードが引用を照合・AIなし）
import { fetchPublicHtml } from './official.js';
import { runWithModels, compact, AiError } from './ai.js';
import { parseJson, tagRuns, failure } from './agents.js';

// 調べる公式ページ（日本で個人が低コストで始められるもの）。URLが変わって読めなければ「取得できなかった」と記録する（推測で補わない）
export const SOURCES = [
  { id: 'amazon', name: 'Amazonアソシエイト', url: 'https://affiliate.amazon.co.jp/', kind: 'アフィリエイト' },
  { id: 'moshimo', name: 'もしもアフィリエイト', url: 'https://af.moshimo.com/', kind: 'アフィリエイト' },
  { id: 'a8', name: 'A8.net', url: 'https://www.a8.net/', kind: 'アフィリエイト' },
  { id: 'valuecommerce', name: 'バリューコマース', url: 'https://www.valuecommerce.ne.jp/', kind: 'アフィリエイト' },
  { id: 'booth', name: 'BOOTH（デジタル商品の販売）', url: 'https://booth.pm/ja', kind: 'デジタル商品' },
  { id: 'note', name: 'note（有料記事）', url: 'https://note.com/', kind: 'デジタル商品' },
  { id: 'rakuten', name: '楽天アフィリエイト（今の事業）', url: 'https://affiliate.rakuten.co.jp/', kind: '今の事業' }
];
export const RESEARCH_INTERVAL_MS = 3 * 86400000; // 3日に1回まで（根拠のない案を量産しない）
const MAX_TEXT = 2500;

// HTMLから読める文章だけを取り出す（script・style・タグを除く）
export function pageText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// 公式ページを読む（1ページずつ。相手に負担をかけない）。pick：今回調べるページ（毎回ぜんぶは読まない）
export async function fetchStep({ pick, fetchHtml = fetchPublicHtml, until = Date.now() + 45000 }) {
  const pages = [];
  for (const s of pick) {
    if (Date.now() + 11000 > until) { pages.push({ ...s, ok: false, error: '時間切れで読んでいない' }); continue; }
    try {
      const { html, url } = await fetchHtml(s.url);
      const text = pageText(html).slice(0, MAX_TEXT);
      pages.push({ ...s, ok: text.length >= 80, pageUrl: url, text, fetchedAt: new Date().toISOString(), error: text.length >= 80 ? '' : '読める文章がほとんどない（画面の表示後に文章を作るページの可能性）' });
    } catch (e) {
      pages.push({ ...s, ok: false, error: `読めなかった（${String(e.message || e).slice(0, 80)}）`, fetchedAt: new Date().toISOString() });
    }
  }
  return { pages };
}

const PROMPT = `あなたは「眼科医くま株式会社」の経営企画AIです（ほかの社員の役はしない）。会社の目的は、AIを使って継続的・安定的に利益を出すこと（当面は月30,000円の利益）。今の事業は、楽天アフィリエイト（楽天ROOM・Instagramで商品を紹介）です。
渡された公式ページの本文（S…）と会社の今の事実（F…）だけを根拠に、低コストで始められる収益源を比べ、社長への提案書を1つ作ります。JSONだけを返してください。
決まり（とても大事）:
- 比べる案は最大3つ。「今の事業を続ける（改善する）」も案に入れてよい。それが最善ならそう結論してよい
- 事実として書くことには、根拠の引用 quotes を付ける：{"source":"S1","text":"本文からそのまま写した言葉（言い換えない・20〜80字）"}。コードが本文と照合し、見つからなければ未確認にする
- 本文に書いていないこと（料率・審査・費用・規約など）は「未確認」と書く。推測で数字を作らない
- 収益の見込みは、必ず「推定」と書き、根拠と不確実性を書く。実績のように書かない
- 次の10項目を、案ごとに書く：what（何をする事業か）／how（どう収益が発生するか）／demand（想定顧客と需要の根拠）／cost（初期費用・維持費）／ownerWork（社長が実際にする作業）／aiWork（AI社員が自律的にできる作業）／outlook（収益化までの見込み・根拠・不確実性。推定と明記）／risks（競合・規約・法的リスク）／test（小さく試す具体的な検証方法）／priority（今の事業と比べた優先順位と理由）
- 新規事業の開始・登録・契約・外部アカウントの作成は社長の承認が必要、と前提にする（自分で実行しない）
出力形式: {"title":"...","conclusion":"結論（80字以内）","options":[{"name":"...","sources":["S1"],"what":"...","how":"...","demand":"...","cost":"...","ownerWork":"...","aiWork":"...","outlook":"推定：...","risks":"...","test":"...","priority":"...","quotes":[{"source":"S1","text":"..."}]}],"unknowns":["未確認のこと"]}`;

const FIELDS = ['what', 'how', 'demand', 'cost', 'ownerWork', 'aiWork', 'outlook', 'risks', 'test', 'priority'];
const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export async function writeStep({ pages, facts = [], env, startedAt = Date.now() }) {
  const ok = pages.filter((p) => p.ok);
  if (!ok.length) return { ok: false, failedStep: '経営企画AI：提案書', error: '読めた公式ページが1つもない（根拠なしでは提案しない）', runs: [] };
  const lines = ok.map((p, i) => `S${i + 1}（${p.name}・${p.pageUrl}）: ${p.text}`);
  const factLines = facts.map((f, i) => `F${i + 1}: ${f}`);
  try {
    const { result } = await runWithModels({ env, deadline: startedAt + 50000, system: PROMPT, userContent: `${factLines.join('\n')}\n\n${lines.join('\n')}`, parse: (c) => {
      const d = parseJson(c);
      const options = (Array.isArray(d.options) ? d.options : []).slice(0, 3).map((o) => {
        const x = { name: s(o && o.name, 60), sources: (Array.isArray(o && o.sources) ? o.sources : []).map((v) => s(v, 4)).filter((v) => /^S\d+$/.test(v)).slice(0, 4) };
        FIELDS.forEach((k) => { x[k] = s(o && o[k], 260); });
        x.quotes = (Array.isArray(o && o.quotes) ? o.quotes : []).slice(0, 8).map((q) => ({ source: s(q && q.source, 4), text: s(q && q.text, 120) })).filter((q) => /^S\d+$/.test(q.source) && q.text);
        return x;
      }).filter((o) => o.name && o.what);
      if (!options.length) throw new AiError('提案の案がありませんでした');
      return { title: s(d.title, 60) || '新しい収益源の比較', conclusion: s(d.conclusion, 120), options, unknowns: (Array.isArray(d.unknowns) ? d.unknowns : []).map((v) => s(v, 120)).filter(Boolean).slice(0, 8) };
    } });
    // S番号を、実際のページ（名前・URL）に置き換えて記録する
    const map = Object.fromEntries(ok.map((p, i) => [`S${i + 1}`, { id: p.id, name: p.name, url: p.pageUrl }]));
    return { ok: true, proposal: { ...result, sourceMap: map }, runs: tagRuns('planning', '提案書を書く', PROMPT) };
  } catch (e) { return failure('経営企画AI：提案書', e, tagRuns('planning', '提案書を書く', PROMPT)); }
}

// コードの確認：引用が本文に本当にあるか／収益の見込みに「推定」とあるか／根拠のない案はないか
const flat = (t) => String(t || '').normalize('NFKC').replace(/[\s　「」『』"'、。,.・]/g, '');
export function checkProposal(proposal, pages) {
  const ok = pages.filter((p) => p.ok);
  const textOf = Object.fromEntries(ok.map((p, i) => [`S${i + 1}`, flat(p.text)]));
  const options = proposal.options.map((o) => {
    const quotes = o.quotes.map((q) => ({ ...q, verified: !!(textOf[q.source] && flat(q.text).length >= 6 && textOf[q.source].includes(flat(q.text))) }));
    const issues = [];
    if (!quotes.some((q) => q.verified)) issues.push('本文と一致する引用がない（この案の事実は未確認）');
    if (quotes.some((q) => !q.verified)) issues.push(`本文に見つからない引用が${quotes.filter((q) => !q.verified).length}件（未確認として扱う）`);
    if (o.outlook && !/推定|未確認/.test(o.outlook)) issues.push('収益の見込みに「推定」の明記がない');
    return { ...o, quotes, issues };
  });
  const verified = options.reduce((a, o) => a + o.quotes.filter((q) => q.verified).length, 0);
  return { ...proposal, options, verifiedQuotes: verified, checkedAt: new Date().toISOString(), status: verified ? 'checked' : 'unverified' };
}

// 今回調べるページ：前回の調査から順番に3〜4ページ（今の事業のページは毎回入れる）
export function pickSources(round = 0, n = 3) {
  const others = SOURCES.filter((x) => x.id !== 'rakuten');
  const start = (round * n) % others.length;
  const pick = [];
  for (let i = 0; i < Math.min(n, others.length); i++) pick.push(others[(start + i) % others.length]);
  return [...pick, SOURCES.find((x) => x.id === 'rakuten')];
}
export { compact };
