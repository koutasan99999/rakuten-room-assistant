// 参考アカウントの自動調査：社長がURLを登録したら、AIがWeb検索で公開情報を調べて整理する。
// Instagramのページは開かない（ログインが必要なため）。調べた根拠のURL（検索で実際に参照したもの）だけを出典にし、
// 出典が無い内容は「情報不足」として扱う（推測を事実のように見せない）。
// OpenAIの Responses API の web_search を使うため、検索1回ごとに追加の料金がかかる。
// 社長が料金を確認するまでは動かさない（環境変数 REFERENCE_RESEARCH=on のときだけ動く）。
import { AiError, cleanText } from './ai.js';

const clean = (v, n) => cleanText(v).replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, n, m) => (Array.isArray(v) ? v : []).map((x) => clean(x, m)).filter(Boolean).slice(0, n);

export function researchEnabled(env) { return String(env.REFERENCE_RESEARCH || '') === 'on'; }

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
      body: JSON.stringify({ model, tools: [{ type: 'web_search' }], input: PROMPT(handle) }),
      signal: AbortSignal.timeout(remaining)
    });
  } catch (e) {
    throw new AiError(`調査に接続できませんでした（${e.name}）`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new AiError(`調査のAPIエラー（${res.status}${data && data.error ? `: ${String(data.error.message || '').slice(0, 120)}` : ''}）`);
  const { text, urls } = readResponse(data);
  let d;
  try { d = JSON.parse(text.match(/\{[\s\S]*\}/)[0]); } catch { throw new AiError('調査の結果を読み取れませんでした'); }
  const checkedAt = new Date().toISOString().slice(0, 10);
  // 出典（実際に参照したURL）が無いものは、内容を事実として出さない
  if (d.found === false || !urls.length) {
    return { status: 'insufficient', checkedAt, summary: '', themes: [], keywords: [], audience: '', learn: [], angles: [], unknown: list(d.unknown, 5, 80).concat(urls.length ? [] : ['根拠になるWebページが見つからなかった']), sources: urls.slice(0, 8) };
  }
  return {
    status: 'done', checkedAt,
    summary: clean(d.summary, 120), themes: list(d.themes, 6, 40), keywords: list(d.keywords, 8, 30), audience: clean(d.audience, 120),
    learn: list(d.learn, 5, 100), angles: list(d.angles, 4, 100), unknown: list(d.unknown, 6, 80), sources: urls.slice(0, 8)
  };
}
