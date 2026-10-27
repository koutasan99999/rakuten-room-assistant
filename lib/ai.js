// OpenAI APIで最大5商品を選び、選定理由とROOM紹介文を作る
const DEFAULT_MODELS = ['gpt-5.4-nano', 'gpt-5-nano', 'gpt-4o-mini'];
const MAX_PICKS = 5;

export class AiError extends Error {}

// 紹介文に入れてはいけない表現（虚偽の体験談・根拠のない断定）
const NG_RE = /使ってみ|使っていま|使ってる|愛用|リピ|買ってよかった|購入しました|届きました|我が家|うちの|絶対|必ず|最安|お得|激安|最強|最高|間違いな|神アイテム|今すぐ|大人気|爆売れ|No\.?1|ナンバーワン/;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

function compact(text, max) {
  const s = String(text || '').replace(/<[^>]*>/g, '').replace(/[\s　]+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

// AIに送る情報は最低限にして料金を抑える
function buildCandidateLines(items) {
  return items.map((it, i) => {
    const review = it.reviewCount ? ` / レビュー${it.reviewAverage}(${it.reviewCount}件)` : '';
    return `${i}: ${compact(it.name, 70)} / ${it.price}円${review} / ${compact(it.caption, 70)}`;
  }).join('\n');
}

const SYSTEM_PROMPT = `あなたは楽天ROOMで商品を紹介する個人ユーザーのアシスタントです。
候補から楽天ROOMに投稿する商品を最大${MAX_PICKS}個選び、JSONだけを返してください。

選ぶ基準（価格の高さでは選ばない）:
- 見た目が良く、写真映えしそう
- SNSで紹介しやすい
- 日常生活で役立つ
- 思わず商品ページを見たくなる
- 楽天ROOMと相性が良い
- 同じ種類の商品ばかりにしない（用途や種類をばらけさせる）

各商品について:
- reason: 選定理由（40〜70字）
- intro: 楽天ROOM用紹介文（150〜200字）

紹介文のルール:
- 絵文字・顔文字・記号の装飾は使わない
- 広告っぽすぎず、丁寧すぎず砕けすぎない、個人が自然に良さそうな商品を紹介している文体
- 実際に使った・買った・愛用しているなどの体験談は書かない（「良さそう」「〜なのがうれしいポイント」など、商品情報からわかる範囲で書く）
- 商品情報から確認できない性能や効果は断定しない
- 「絶対」「必ず」「最安」「お得」「最高」など根拠のない表現は使わない
- 商品名の羅列や【】の宣伝文句をそのまま書き写さない

出力形式:
{"picks":[{"id":候補番号,"reason":"...","intro":"..."}]}`;

function cleanText(text) {
  let s = String(text || '').replace(EMOJI_RE, '').replace(/[\s　]+/g, ' ').trim();
  if (NG_RE.test(s)) {
    // 問題のある表現を含む文だけを取り除く
    const sentences = s.match(/[^。！？!?]+[。！？!?]?/g) || [s];
    s = sentences.filter((x) => !NG_RE.test(x)).join('').trim();
  }
  return s;
}

function parsePicks(content, items) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    const m = String(content || '').match(/\{[\s\S]*\}/);
    if (!m) throw new AiError('AIの応答を読み取れませんでした');
    try { data = JSON.parse(m[0]); } catch { throw new AiError('AIの応答を読み取れませんでした'); }
  }
  const list = Array.isArray(data) ? data : data.picks || data.items || [];
  const used = new Set();
  const picks = [];
  for (const p of list) {
    const id = Number(p && p.id);
    if (!Number.isInteger(id) || !items[id] || used.has(id)) continue;
    const intro = cleanText(p.intro);
    if (intro.length < 60) continue;
    used.add(id);
    picks.push({ index: id, reason: cleanText(p.reason) || 'SNSで紹介しやすく、日常で役立ちそうな商品です。', intro });
    if (picks.length >= MAX_PICKS) break;
  }
  if (picks.length === 0) throw new AiError('AIが商品を選べませんでした');
  return picks;
}

async function callOpenAI({ model, apiKey, userContent }) {
  const isReasoning = /^(gpt-5|o\d)/.test(model);
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: isReasoning ? 6000 : 2000
  };
  if (isReasoning) body.reasoning_effort = 'low';
  else body.temperature = 0.8;

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000)
    });
  } catch (e) {
    throw new AiError(`OpenAI APIに接続できませんでした（${e.name}）`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new AiError(`OpenAI APIエラー（${res.status}${data && data.error ? `: ${String(data.error.message).slice(0, 120)}` : ''}）`);
    err.status = res.status;
    err.code = data && data.error && data.error.code;
    throw err;
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new AiError('AIの応答が空でした');
  return content;
}

export async function selectWithAI({ items, genre, env }) {
  const models = env.OPENAI_MODEL ? [env.OPENAI_MODEL, ...DEFAULT_MODELS] : DEFAULT_MODELS;
  const userContent = `ジャンル: ${genre}\n候補:\n${buildCandidateLines(items)}`;
  let lastError;
  for (const model of [...new Set(models)]) {
    try {
      const content = await callOpenAI({ model, apiKey: env.OPENAI_API_KEY, userContent });
      return parsePicks(content, items);
    } catch (e) {
      lastError = e;
      // モデルが使えない場合だけ次のモデルを試す（認証エラーや残高不足は打ち切り）
      const modelProblem = e.code === 'model_not_found' || e.status === 404 ||
        (e.status === 400 && /model|reasoning|parameter/i.test(e.message));
      if (!modelProblem) break;
    }
  }
  throw lastError;
}

// AIが使えなかったときの予備：レビューの多い商品を並べ、控えめな定型文を付ける
export function fallbackPicks(items) {
  return [...items]
    .sort((a, b) => b.reviewCount - a.reviewCount)
    .slice(0, MAX_PICKS)
    .map((it) => {
      const short = compact(it.name.replace(/[【\[].*?[】\]]/g, ''), 40);
      return {
        index: items.indexOf(it),
        reason: 'AI選定が使えなかったため、レビュー件数の多い商品を表示しています。',
        intro: `${short}を見つけたので紹介します。商品ページの写真を見ると、暮らしの中に取り入れやすそうな雰囲気が良いなと思いました。` +
          `${it.reviewCount ? `レビューも${it.reviewCount}件ほど集まっているので、選ぶときの参考になりそうです。` : ''}` +
          'サイズや仕様は商品ページで確認しつつ、気になる方はチェックしてみてください。'
      };
    });
}
