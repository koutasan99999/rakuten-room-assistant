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
- 実際に使っていないので、体験談は書かない（「使ってみた」「買ってよかった」「愛用」などは禁止）。「〜なのが良い」「ここが気になる」など、商品を見て思ったこととして書く
- 大げさに褒めない。「最高」「神」「絶対買うべき」「必須」「必ず」「最安」「お得」などの強い断定や煽りは使わない
- 「〜が特徴です」「〜におすすめです」「〜と相性が良さそうです」「〜のきっかけ作りに」など、AIや広告文でよくある定型表現は使わない
- 語尾を毎回「です」「ます」にせず、言い切り・体言止め・「〜な感じ」「〜は結構大事」なども混ぜて自然に変化させる
- 絵文字・顔文字・記号の装飾・ハッシュタグは使わない
- 商品名の羅列や【】の宣伝文句をそのまま書き写さない

断定と推量の使い分け（文章が弱くならないように）:
- 商品情報から客観的に分かることは自然に言い切る。「〜そう」「〜かも」「〜と思います」を連発しない（1つの紹介文で合わせて2回まで）
  例: 「絵になりそう」→「絵になる」、「すっきり見えそう」→「すっきり見える」、「持ち運びしやすそう」→「持ち運びしやすい」、「収納しやすそう」→「収納しやすい」、「準備がまとまりやすそう」→「準備もまとまりやすい」
- 言い切ってよいもの: 見た目、色、形、サイズ、収納袋などの付属品の有無、商品ページに明記された機能、客観的に分かる使い方、デザイン上の印象
- 断定しないもの: 実際の座り心地・着心地、耐久性、味、肌への効果、ダイエット効果、治療効果、使用後の満足度など、使わないと分からない性能や効果
- 慎重すぎる文章ではなく「事実は言い切り、体験は捏造しない」文章にする

避ける書き方（悪い例・体重計）:
「高精度な体組成測定が可能で、健康管理を習慣化したい方におすすめの商品です。」
目指す雰囲気（良い例。言い回しはそのまま真似せず、商品ごとに自分の言葉で書く）:
「体重計って意外と生活感が出やすいけど、これはかなりすっきりした見た目。白で薄型なので、洗面所に出しっぱなしにしてもうるさく見えない。毎日目に入るものだから、見た目が邪魔しないのは結構大事。表示も大きめで、朝のバタバタした時間でもぱっと数字を確認できるのが良いところ。」
「収納ボックスってどれも同じに見えがちだけど、これはフタの取っ手がさりげなくて好きな感じ。くすみカラーで重ねても圧迫感がなく、棚に並べてもごちゃっと見えない。中身が見えないので、細かいものをまとめて放り込めるのも楽。サイズ違いで揃えられるのも地味にうれしい。」
「ガラスと木の組み合わせがきれいで、キッチンに出しておくだけで絵になる。一杯分ずつ淹れられるサイズ感なので、朝にちょっとだけ飲みたいときにちょうどいい。パーツが少なくてシンプルな形だから、洗うのも面倒じゃないのが良いところ。味の好みは豆次第だけど、道具の見た目で選ぶならかなり好みのタイプ。」

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

function buildBody(model, system, userContent, opts) {
  const isReasoning = /^(gpt-5|o\d)/.test(model);
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
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

async function callOpenAI({ model, apiKey, userContent, timeoutMs, system = SYSTEM_PROMPT }) {
  const opts = {};
  // 「このモデルではその設定は使えない」と言われたら、その設定を外して同じモデルでやり直す
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildBody(model, system, userContent, opts)),
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

// AI・広告文によくある定型表現（見つかったら書き直してもらう）
const STOCK_PHRASES = [
  /特徴/, /おすすめ/, /相性が(良|いい)/, /きっかけ/, /習慣化/, /ぴったり/, /魅力/,
  /こちらは/, /こちらの/, /(したい|な)(方|人)(に|へ|には)/, /いかがでしょう/, /チェックしてみて/,
  /方向性/, /採用/, /実現/, /叶え/
];
const INTRO_MIN = 140;
const INTRO_MAX = 220;

export function introIssues(intro) {
  const issues = [];
  const hits = STOCK_PHRASES.map((re) => (intro.match(re) || [])[0]).filter(Boolean);
  if (hits.length) issues.push(`定型表現「${hits.join('」「')}」を使っている`);
  if (intro.length < INTRO_MIN) issues.push(`短すぎる（${intro.length}字）`);
  if (intro.length > INTRO_MAX) issues.push(`長すぎる（${intro.length}字）`);
  const endings = (intro.match(/(です|ます)。/g) || []).length;
  const sentences = (intro.match(/。/g) || []).length;
  if (sentences >= 3 && endings >= sentences) issues.push('語尾がすべて「です・ます」');
  const hedges = (intro.match(/そう(?=[。、だでなにじし！]|$)|かも|と思(?:います|う|いました)/g) || []).length;
  if (hedges >= 3) issues.push(`「〜そう」「〜かも」「〜と思います」が多すぎる（${hedges}回）。見た目・形・サイズ・明記された機能などは言い切る`);
  return issues;
}

const REWRITE_PROMPT = `あなたは楽天ROOMに投稿する紹介文を直す担当です。
下書きの紹介文を、指摘された問題がなくなるように書き直し、JSONだけを返してください。

書き直しのルール:
- 150〜200字
- 商品の説明ではなく「この商品を見て、どこがちょっと良いと思ったか」を1〜2個だけ書く
- 見た目、置いたときの雰囲気、生活へのなじみ方、面倒が減りそうか、使う場面などに目を向ける
- 個人が普通に話しているような自然な口調。語尾は言い切り・体言止め・「〜な感じ」「〜のが良い」なども混ぜて変化させる
- 次の言葉は使わない: 特徴、おすすめ、相性が良い、きっかけ、習慣化、ぴったり、魅力、こちら、〜したい方に、〜な人に
- 体験談（使ってみた・買ってよかった・愛用）、強い断定（最高・神・必須・絶対・必ず・最安・お得）、絵文字、ハッシュタグは使わない
断定と推量の使い分け（文章が弱くならないように）:
- 商品情報から客観的に分かることは自然に言い切る。「〜そう」「〜かも」「〜と思います」を連発しない（1つの紹介文で合わせて2回まで）
  例: 「絵になりそう」→「絵になる」、「すっきり見えそう」→「すっきり見える」、「持ち運びしやすそう」→「持ち運びしやすい」、「収納しやすそう」→「収納しやすい」、「準備がまとまりやすそう」→「準備もまとまりやすい」
- 言い切ってよいもの: 見た目、色、形、サイズ、収納袋などの付属品の有無、商品ページに明記された機能、客観的に分かる使い方、デザイン上の印象
- 断定しないもの: 実際の座り心地・着心地、耐久性、味、肌への効果、ダイエット効果、治療効果、使用後の満足度など、使わないと分からない性能や効果
- 慎重すぎる文章ではなく「事実は言い切り、体験は捏造しない」文章にする

目指す雰囲気の例（言い回しは真似しない）:
「体重計って意外と生活感が出やすいけど、これはかなりすっきりした見た目。白で薄型なので、洗面所に出しっぱなしにしてもうるさく見えない。毎日目に入るものだから、見た目が邪魔しないのは結構大事。」

出力形式:
{"intros":[{"id":番号,"intro":"..."}]}`;

// 定型表現・長さなどに問題がある紹介文だけを、もう一度AIに直してもらう（1回だけ）
async function refineIntros({ picks, items, model, apiKey, deadline }) {
  const targets = picks.map((p, i) => ({ i, p, issues: introIssues(p.intro) })).filter((t) => t.issues.length);
  if (!targets.length) return picks;
  const remaining = deadline - Date.now();
  if (remaining < 10000) return picks;
  const userContent = targets.map((t) => {
    const it = items[t.p.index];
    return `id: ${t.i}\n商品: ${compact(it.name, 60)} / ${it.price}円\n商品情報: ${compact(it.caption, 100)}\n下書き: ${t.p.intro}\n問題: ${t.issues.join('、')}`;
  }).join('\n\n');
  try {
    const content = await callOpenAI({ model, apiKey, userContent, system: REWRITE_PROMPT, timeoutMs: Math.min(25000, remaining - 2000) });
    const data = JSON.parse((String(content).match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const out = [...picks];
    for (const r of data.intros || []) {
      const i = parseInt(String(r && r.id).replace(/[^0-9]/g, ''), 10);
      const target = targets.find((t) => t.i === i);
      if (!target) continue;
      const intro = cleanText(r.intro);
      // 書き直した方が問題が少ないときだけ差し替える
      if (intro.length >= 100 && introIssues(intro).length < target.issues.length) out[i] = { ...out[i], intro };
    }
    return out;
  } catch (e) {
    console.error('[openai] rewrite skipped:', e.message);
    return picks;
  }
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
    let picks;
    try {
      const content = await callOpenAI({ model, apiKey, userContent, timeoutMs: Math.min(30000, remaining) });
      picks = parsePicks(content, items);
    } catch (e) {
      errors.push(e.message.startsWith(model) ? e.message : `${model}: ${e.message}`);
      console.error('[openai]', errors[errors.length - 1]);
      if (e.retryable === false) break;
      continue;
    }
    return refineIntros({ picks, items, model, apiKey, deadline });
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
        intro: `${short}を見つけたので紹介します。商品ページの写真を見ると、暮らしの中に取り入れやすい雰囲気が良い感じ。` +
          `${it.reviewCount ? `レビューも${it.reviewCount}件ほど集まっているので、選ぶときの参考になりそうです。` : ''}` +
          'サイズや仕様は商品ページで確認しつつ、気になる方はチェックしてみてください。'
      };
    });
}
