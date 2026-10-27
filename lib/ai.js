// OpenAI APIで最大5商品を選び、選定理由とROOM紹介文を作る
const DEFAULT_MODELS = ['gpt-5.4-nano', 'gpt-5-nano', 'gpt-4o-mini'];
const MAX_PICKS = 5;

export class AiError extends Error {}

// 紹介文に入れてはいけない表現（虚偽の体験談・根拠のない断定）
const NG_RE = /使ってみ|使っていま|使ってる|愛用|リピ|買ってよかった|購入しました|届きました|我が家|うちの|絶対|必ず|最安|お得|激安|最強|最高|間違いな|神(?:アイテム|商品|すぎ|レベル)|必須|買うべき|今すぐ|大人気|爆売れ|No\.?1|ナンバーワン/;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

function compact(text, max) {
  const s = String(text || '').replace(/<[^>]*>/g, '').replace(/[\s　]+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

// AIに送る情報は最低限にして料金を抑える
function buildCandidateLines(items) {
  return items.map((it, i) => {
    const review = it.reviewCount ? ` / レビュー${it.reviewAverage}(${it.reviewCount}件)` : '';
    return `${i}: ${compact(it.name, 70)} / ${it.price}円${review} / ${compact(it.caption, 100)}`;
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

紹介文（intro）の目的:
広告文や商品説明ではなく「SNSで見つけた良さそうな商品を、個人が自然に紹介している文章」にする。
商品を説明するのではなく「自分がこの商品を見て、どこがちょっと良いと思ったか」を書く。

紹介文の書き方:
- 丁寧すぎず砕けすぎない、個人が普通に話しているような自然な口調
- スペックを全部説明しない。「これならちょっと欲しい」と感じるポイントを1〜2個だけ拾う
- 機能だけでなく、見た目、置いたときの雰囲気、生活へのなじみ方、面倒が減りそうか、使う場面が想像できるか、にも目を向ける
- 商品ページの説明文を言い換えただけの文章にしない
- 実際に使っていないので、体験談は書かない（「使ってみた」「買ってよかった」「愛用」などは禁止）。「〜なのが良い」「〜そう」「〜なら使いやすそう」「ここが気になる」など、商品情報から自然に言える範囲で書く
- 大げさに褒めない。「最高」「神」「絶対買うべき」「必須」「必ず」「最安」「お得」などの強い断定や煽りは使わない
- 「〜が特徴です」「〜におすすめです」「〜と相性が良さそうです」「〜のきっかけ作りに」など、AIや広告文でよくある定型表現は使わない
- 語尾を毎回「です」「ます」にせず、「〜かも」「〜そう」「〜な感じ」「〜は結構大事」なども混ぜて自然に変化させる
- 商品情報から確認できない性能や効果は断定しない
- 絵文字・顔文字・記号の装飾・ハッシュタグは使わない
- 商品名の羅列や【】の宣伝文句をそのまま書き写さない

悪い例（体重計）:
「高精度な体組成測定が可能で、健康管理を習慣化したい方におすすめの商品です。」
良い例（体重計）:
「体重計って意外と生活感が出やすいけど、これはかなりすっきり。白なら洗面所に出しっぱなしでもそこまで気にならなそう。毎日使うものだから、見た目が邪魔しないのは結構大事かも。」

出力形式:
{"picks":[{"id":候補番号,"reason":"...","intro":"..."}]}`;

function cleanText(text) {
  let s = String(text || '').replace(EMOJI_RE, '').replace(/[#＃][^\s#＃。、]+/g, '').replace(/[\s　]+/g, ' ').trim();
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
    const id = parseInt(String(p && (p.id ?? p.index ?? p.no ?? '')).replace(/[^0-9]/g, ''), 10);
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

// エラー文にAPIキーの一部が含まれることがあるので伏せ字にする
export function maskSecrets(text) {
  return String(text || '').replace(/sk-[A-Za-z0-9_*\-]{4,}/g, 'sk-***');
}

function buildBody(model, userContent, opts) {
  const isReasoning = /^(gpt-5|o\d)/.test(model);
  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ]
  };
  if (!opts.noJsonMode) body.response_format = { type: 'json_object' };
  if (opts.legacyMaxTokens) body.max_tokens = 3000;
  else body.max_completion_tokens = isReasoning ? 8000 : 3000;
  if (isReasoning && !opts.noReasoningEffort) body.reasoning_effort = 'low';
  if (!isReasoning && !opts.noTemperature) body.temperature = 0.8;
  return body;
}

// 応答本文の取り出し（文字列・配列のどちらの形でも読めるようにする）
function extractContent(data) {
  const choice = data && data.choices && data.choices[0];
  const msg = choice && choice.message;
  if (!msg) return { content: '', finish: choice && choice.finish_reason };
  let content = msg.content;
  if (Array.isArray(content)) content = content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('');
  return { content: content || '', finish: choice.finish_reason, refusal: msg.refusal };
}

async function callOpenAI({ model, apiKey, userContent, timeoutMs }) {
  const opts = {};
  // 「このモデルではその設定は使えない」と言われたら、その設定を外して同じモデルでやり直す
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildBody(model, userContent, opts)),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      const err = new AiError(e.name === 'TimeoutError' || e.name === 'AbortError'
        ? `${model}: 時間切れ（${Math.round(timeoutMs / 1000)}秒）`
        : `${model}: 接続エラー（${e.name}: ${maskSecrets(e.message).slice(0, 80)}）`);
      err.retryable = true;
      throw err;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = maskSecrets(data && data.error && data.error.message);
      const param = (data && data.error && data.error.param) || '';
      if (res.status === 400) {
        const hint = `${param} ${message}`;
        let changed = false;
        if (/reasoning_effort/.test(hint) && !opts.noReasoningEffort) changed = opts.noReasoningEffort = true;
        else if (/temperature/.test(hint) && !opts.noTemperature) changed = opts.noTemperature = true;
        else if (/max_completion_tokens/.test(hint) && !opts.legacyMaxTokens) changed = opts.legacyMaxTokens = true;
        else if (/response_format|json_object/.test(hint) && !opts.noJsonMode) changed = opts.noJsonMode = true;
        if (changed) continue;
      }
      const err = new AiError(`${model}: OpenAI APIエラー ${res.status}${message ? ` ${message.slice(0, 160)}` : ''}`);
      err.status = res.status;
      err.code = data && data.error && data.error.code;
      // 認証エラー・残高不足・利用上限は、別のモデルでも同じなので打ち切る
      err.retryable = !(res.status === 401 || res.status === 403 || err.code === 'insufficient_quota');
      throw err;
    }
    const { content, finish, refusal } = extractContent(data);
    if (!content) {
      const err = new AiError(`${model}: 応答が空（finish_reason=${finish || '不明'}${refusal ? ', 拒否' : ''}）`);
      err.retryable = true;
      throw err;
    }
    return content;
  }
  throw Object.assign(new AiError(`${model}: 設定の組み合わせが受け付けられませんでした`), { retryable: true });
}

export async function selectWithAI({ items, genre, env, deadline = Date.now() + 45000 }) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim(); // 貼り付け時の空白・改行を除く
  const preferred = String(env.OPENAI_MODEL || '').trim();
  const models = [...new Set(preferred ? [preferred, ...DEFAULT_MODELS] : DEFAULT_MODELS)];
  const userContent = `ジャンル: ${genre}\n候補:\n${buildCandidateLines(items)}`;
  const errors = [];
  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining < 5000) break;
    try {
      const content = await callOpenAI({ model, apiKey, userContent, timeoutMs: Math.min(30000, remaining) });
      return parsePicks(content, items);
    } catch (e) {
      errors.push(e.message.startsWith(model) ? e.message : `${model}: ${e.message}`);
      console.error('[openai]', errors[errors.length - 1]);
      if (e.retryable === false) break;
    }
  }
  throw new AiError(errors.join(' / ') || 'AIを呼び出す時間が足りませんでした');
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
