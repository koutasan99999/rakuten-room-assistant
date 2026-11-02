// 参考アカウントの自動調査：社長がURLを登録したら、AIがWeb検索で公開情報を調べて整理する。
// Instagramのページは開かない（ログインが必要なため）。調べた根拠のURL（検索で実際に参照したもの）だけを出典にし、
// 出典が無い内容は「情報不足」として扱う（推測を事実のように見せない）。
// OpenAIの Responses API の web_search を使うため、検索1回ごとに追加の料金がかかる。2026-11-02 に停止（社長の再承認なしに再開しない）。
// 月500円を超えないように、毎回「上限管理用の料金（高めに見積もった額）」で数え、超えそうなら実行しない。
// 止めたいときは環境変数 REFERENCE_RESEARCH=off。
import { AiError, cleanText } from './ai.js';

const clean = (v, n) => cleanText(v).replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, n, m) => (Array.isArray(v) ? v : []).map((x) => clean(x, m)).filter(Boolean).slice(0, n);

// 2026-11-02 社長の指示で停止（費用に見合う価値がなかったため）。社長の再承認があり、REFERENCE_RESEARCH=on のときだけ動く
export function researchEnabled(env) { return String(env.REFERENCE_RESEARCH || '').toLowerCase() === 'on'; }

// 料金（2026-11-02 時点。OpenAIの公式の料金ページはこの環境から開けず、第三者の料金表で確認した値）
//   web_search：1,000回あたり10ドル（検索で取り込んだ文章は、モデルの入力の料金で別に数える）
//   gpt-5-mini：入力 100万トークンあたり0.25ドル、出力 100万トークンあたり2.00ドル
// 上限の管理には、検索1回25ドル/1,000回（古い料金表の高いほうの値）と、1ドル160円の高めの見積もりを使う。
export const PRICE = { searchUsd: 0.01, searchUsdCap: 0.025, inputPerM: 0.25, outputPerM: 2.0, yenPerUsd: 160, source: '第三者の料金表（2026年9〜10月）。公式ページは未確認' };
export const MAX_SEARCHES = 3; // 1回の調査で検索してよい回数の上限
export function monthlyCapYen(env) { return Math.max(0, Number(env.RESEARCH_MONTHLY_CAP_YEN) || 500); }
// 1回の調査でかかりうる最大の額（上限の判定に使う）：検索3回・入力3万トークン・出力1万トークン
export const MAX_RUN_YEN = Math.ceil((MAX_SEARCHES * PRICE.searchUsdCap + 30000 / 1e6 * PRICE.inputPerM + 10000 / 1e6 * PRICE.outputPerM) * PRICE.yenPerUsd);

// 応答の使用量から料金を計算する（実際の請求はOpenAIの管理画面で確認する。ここでの額は計算値）
export function costOf(data) {
  const searches = ((data && data.output) || []).filter((x) => x.type === 'web_search_call').length;
  const u = (data && data.usage) || {};
  const input = Number(u.input_tokens) || 0;
  const output = Number(u.output_tokens) || 0;
  const tokenUsd = input / 1e6 * PRICE.inputPerM + output / 1e6 * PRICE.outputPerM;
  return {
    searches, inputTokens: input, outputTokens: output,
    yen: Math.round((searches * PRICE.searchUsd + tokenUsd) * PRICE.yenPerUsd * 100) / 100,
    yenCap: Math.round((searches * PRICE.searchUsdCap + tokenUsd) * PRICE.yenPerUsd * 100) / 100
  };
}

// サーバーでも今月の分を数える（同じサーバーが動いている間だけ。端末の記録と合わせて、多いほうで判定する）
const serverLedger = { month: '', yenCap: 0, runs: 0 };
export function monthKey(now = new Date()) { return now.toISOString().slice(0, 7); }
export function budgetCheck({ env, spentYenCap = 0, now = new Date() }) {
  const month = monthKey(now);
  if (serverLedger.month !== month) Object.assign(serverLedger, { month, yenCap: 0, runs: 0 });
  const cap = monthlyCapYen(env);
  const spent = Math.max(Number(spentYenCap) || 0, serverLedger.yenCap);
  return { month, cap, spent, ok: spent + MAX_RUN_YEN <= cap, remaining: Math.max(0, cap - spent) };
}
export function recordServer(cost, now = new Date()) {
  const month = monthKey(now);
  if (serverLedger.month !== month) Object.assign(serverLedger, { month, yenCap: 0, runs: 0 });
  serverLedger.yenCap += cost.yenCap;
  serverLedger.runs += 1;
}
export function _resetServerLedger() { Object.assign(serverLedger, { month: '', yenCap: 0, runs: 0 }); }

const PROMPT = (handle) => `Instagramのアカウント @${handle}（https://www.instagram.com/${handle}/）について、Web検索で公開情報を調べてください。
instagram.com の中身は見られない前提で、検索結果の抜粋、本人のほかのSNS（Threads・X・TikTok・YouTube）、ブログ、紹介記事、楽天ROOMなどを使います。
目的：眼科医くま（黒パーカーとサングラスのくまのキャラクター。30代男性向けの便利グッズ・ガジェット・ギフト・服を紹介し、楽天ROOMへ送客）が、このアカウントから学ぶことと、このアカウントの視聴者に届く投稿を考えること。
守ること：調べて分からないことは書かない（推測は「推測」と書く）。架空の数字・投稿を作らない。他人の文章を長く引用しない。
最後に、次のJSONだけを書いてください：
{"found":true,"summary":"どんなアカウントか（80字以内）","themes":["よく扱うテーマ"],"keywords":["使っている言葉・タグ"],"audience":"見ていそうな人（推測なら推測と書く）","learn":["眼科医くまが学べる点（商品の選び方・見せ方・文章・集客など）"],"angles":["この視聴者に届く、まねではない投稿の切り口"],"unknown":["確認できなかったこと"]}
アカウントの情報が見つからなければ {"found":false,"unknown":["見つからなかった理由"]} だけを書いてください。`;

// Responses API の応答から、本文と、実際に参照したURL（url_citation）を取り出す
export function readResponse(data) {
  let text = '';
  const urls = new Set();
  for (const item of (data && data.output) || []) {
    for (const c of item.content || []) {
      if (c.type === 'output_text') {
        text += c.text || '';
        for (const a of c.annotations || []) if (a.type === 'url_citation' && /^https:\/\//.test(a.url || '')) urls.add(a.url.replace(/[?&]utm_source=openai$/, ''));
      }
    }
  }
  return { text: text || (data && data.output_text) || '', urls: [...urls] };
}

export async function researchAccount({ handle, env, deadline, fetchImpl = fetch }) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  const model = String(env.OPENAI_RESEARCH_MODEL || 'gpt-5-mini').trim();
  const remaining = Math.max(5000, Math.min(55000, deadline - Date.now()));
  let res;
  try {
    res = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, tools: [{ type: 'web_search' }], max_tool_calls: MAX_SEARCHES, input: PROMPT(handle) }),
      signal: AbortSignal.timeout(remaining)
    });
  } catch (e) {
    throw new AiError(`調査に接続できませんでした（${e.name}）`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new AiError(`調査のAPIエラー（${res.status}${data && data.error ? `: ${String(data.error.message || '').slice(0, 120)}` : ''}）`);
  const { text, urls } = readResponse(data);
  // 料金は、結果が読めなかったときも記録する（料金はかかっているため）
  const cost = costOf(data);
  recordServer(cost);
  let d;
  try { d = JSON.parse(text.match(/\{[\s\S]*\}/)[0]); } catch { const e = new AiError('調査の結果を読み取れませんでした'); e.cost = cost; throw e; }
  const checkedAt = new Date().toISOString().slice(0, 10);
  // 出典（実際に参照したURL）が無いものは、内容を事実として出さない
  if (d.found === false || !urls.length) {
    return { status: 'insufficient', checkedAt, cost, summary: '', themes: [], keywords: [], audience: '', learn: [], angles: [], unknown: list(d.unknown, 5, 80).concat(urls.length ? [] : ['根拠になるWebページが見つからなかった']), sources: urls.slice(0, 8) };
  }
  return {
    status: 'done', checkedAt, cost,
    summary: clean(d.summary, 120), themes: list(d.themes, 6, 40), keywords: list(d.keywords, 8, 30), audience: clean(d.audience, 120),
    learn: list(d.learn, 5, 100), angles: list(d.angles, 4, 100), unknown: list(d.unknown, 6, 80), sources: urls.slice(0, 8)
  };
}
