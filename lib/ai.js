// OpenAI APIで最大5商品を選び、選定理由とROOM紹介文を作る
const DEFAULT_MODELS = ['gpt-5.4-nano', 'gpt-5-nano', 'gpt-4o-mini'];
const MAX_PICKS = 5;
const MIN_WANT = 6; // AIの「欲しい度」（1〜10）がこれ未満の商品は外す

export class AiError extends Error {}

// 紹介文に入れてはいけない表現（虚偽の体験談・根拠のない断定）
const NG_RE = /偽物|偽造|コピー品|模倣品|パチモン|バッタ|正規品|劣化版|使ってみ|変えてから|便利だった|かなり丈夫|とても丈夫|(?:座り|着|寝|履き)心地が(?:良|いい)|使っていま|使ってる|愛用|リピ|買ってよかった|購入しました|届きました|我が家|うちの|絶対|必ず|最安|お得|激安|最強|最高|間違いな|神(?:アイテム|商品|すぎ|レベル)|必須|買うべき|今すぐ|大人気|爆売れ|No\.?1|ナンバーワン/;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

export function compact(text, max) {
  const s = String(text || '').replace(/<[^>]*>/g, '').replace(/[\s　]+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

// AIに送る情報は最低限にして料金を抑える
// レビュー数は渡さない（売れ筋ではなく「欲しくなるか」で選んでもらうため）
// withShop: ブランドや販売元が判断材料になるときはショップ名も渡す
export function buildCandidateLines(items, { withShop = false, captionLength = 100 } = {}) {
  return items.map((it, i) => {
    const shop = withShop && it.shop ? ` / 販売: ${compact(it.shop, 20)}` : '';
    return `${i}: ${compact(it.name, 70)} / ${it.price}円${shop} / ${compact(it.caption, captionLength)}`;
  }).join('\n');
}

// 紹介文・選定理由の書き方（選定時と書き直し時の両方で使う）

// ブランドイメージが購買判断に影響する商品（プレゼント・ファッション・香水・食器・雑貨など）の評価ルール
export const BRAND_RULES = `ブランド・プレゼント適性の評価（内部で確認し、選定と文章に反映する）:
- 価格やレビューだけでなく「そのブランドを選ぶ意味」を見る。単純に「有名ブランド＝良い」としない
- 確認すること: ブランドとして一定の知名度や実績があるか／高い場合に価格の理由（素材・製造・歴史・デザイン・機能・ブランド価値）が見えるか／無名なのに不自然に高くないか／有名ブランドのデザインをそのまま真似した印象が強くないか／販売元（ショップ名）やブランド表記が分かりにくくないか／贈り物として受け取ったときに安っぽく見えないか／ロゴやブランド名だけが前面に出すぎていないか
- 商品情報だけで偽物・コピー品・正規品を断定しない。判断材料が弱いときは「ブランド背景が見えにくい」「価格の根拠が分かりにくい」「有名ブランドにかなり似たデザイン」「プレゼント用途なら、もう少し由来が明確なブランドを選びたい」のように書き、そうした商品は選ばない方を優先する
- 年齢・印象との相性も見る（例: 10代には自然だが30代へのプレゼントでは若く見えすぎる／20代前半で人気だが年齢が上がると学生っぽく見えやすい／年齢を選ばない／大人っぽいが若い人には少し堅い／ロゴが強く好みが分かれる／知名度は高いがプレゼントとしては定番すぎる）
- 最終判断は「有名だから」「高いから」「レビューが多いから」ではなく「この人にこのブランドを贈る理由があるか」
- プレゼント候補では必ず確認する: 自分がもらったら嬉しいか／渡したとき少し気まずくならないか／ブランドを知っている人が見ても変ではないか／年齢に対して幼すぎたり背伸びしすぎたりしていないか

高価格品と低価格品を並べるとき:
- 高価格品を「本物」、低価格品を「劣化版」と単純に扱わない
- 高価格品: 何にお金を払っているのか（ブランド価値・素材・仕上げ・歴史・デザイン・所有満足感）
- 低価格品: どこまで雰囲気や用途を再現できるか／何を妥協しているか／ブランドを気にしないなら十分か／価格差ほど使用価値に差があるか
- 例:「王道ブランドならこちら。ブランド背景や仕上げまで含めて選ぶなら本命。一方、見た目や用途が目的なら、こちらの低価格品でもかなり近い雰囲気を楽しめる。」`;

// プレゼント候補の分類（まとめの giftClass に使う）
export const GIFT_CLASSES = ['外しにくい王道', '知っていると少しセンスが良く見える', '価格を抑えたい場合の候補', '自分では買わないが、もらうと嬉しい', '若い人向け', '大人向け', '好みが分かれるので相手を選ぶ', 'ブランドより実用品として優秀'];

export const WRITING_RULES = `選定理由（reason）の書き方（40〜80字）:
- 「何が面白い商品なのか」「どんな小さな不便を解決するのか」「なぜ欲しくなるのか」を簡潔に書く
- 「SNS映え」「投稿で紹介しやすい」「人気が期待できる」「レビューが多い」など、運営者目線・売れ筋目線の理由は書かない
  悪い例:「実用性が高く、SNSでも紹介しやすい商品です。」
  良い例:「ケーブルを一本ずつ抜かなくても、デスク下をまとめて隠せる。配線のごちゃつきが気になる人にはかなり分かりやすい商品。」

紹介文（intro）の基本思想:
- 商品説明ではなく、この商品を見つけた人が友人に「これちょっと良くない？」と話すくらいの文章
- 一番気になったポイントを1つ、必要なら2つまで。魅力が1個なら1個だけでよい
- 文字数を埋めるために弱いメリットを後付けしない（「5色なのも良い」「写真でも映える」「プレゼントにも」「さまざまな場面で活躍」など）
- 流れの目安は「日常の小さな不満や気づき → この商品の面白いポイント → 生活でどう使うか」。ただし毎回同じ構成にしない
- 商品ページの説明をAIが言い換えただけの文章にしない

言い切れることは言い切る:
- 「〜そう」「〜かも」「〜と思います」「〜な気がします」を連発しない（1つの紹介文で合わせて2回まで）
- 商品情報から客観的に分かること（見た目、色、形、サイズ、収納袋などの付属品、商品ページに明記された機能、客観的に分かる使い方、デザインの印象）は自然に言い切る
  例:「絵になりそう」→「絵になる」、「すっきり見えそう」→「すっきり見える」、「分類しやすそう」→「色ごとに分類できる」、「持ち運びしやすそう」→「収納袋付きで持ち運びやすい」

体験は作らない:
- 使っていないので、使用経験が必要なことは書かない（「使ってみた」「買ってよかった」「愛用している」「これに変えてから」「座り心地が良い」「かなり丈夫」「本当に便利だった」など）
- 耐久性、味、肌への効果、ダイエット効果、治療効果、使用後の満足度など、使わないと分からない性能や効果は断定しない

使わない表現:
〜が特徴です／〜におすすめです／〜な方にぴったり／〜をサポート／〜を叶えてくれます／暮らしを豊かに／毎日の○○を快適に／活躍してくれそう／重宝しそう／SNS映え／投稿にもおすすめ／ぜひチェック／この機会に／魅力的なアイテム／便利なアイテム／きっかけ作り／相性が良い／最高／神／絶対／必須／必ず／最安／お得

人間らしい言い方の感覚（このフレーズをそのまま毎回使わず、商品に合わせて変える）:
「これ地味に欲しい。」「こういうの、ありそうでなかった。」「毎回ここ面倒だったんだよな、を解決してくれるやつ。」「出しっぱなしでも気にならないのが良い。」「この値段ならとりあえず試したくなる。」「わざわざ○○しなくていいのが楽。」「こういう小さい工夫、結構好き。」

文体:
- 120〜200字。無理に長くしない。一文を長くしすぎない
- 丁寧すぎず砕けすぎない。毎回同じ語尾にしない
- 絵文字、ハッシュタグ、過剰な感嘆符は使わない
- 商品名の羅列や【】の宣伝文句を書き写さない

出力前の確認:
- 商品ページの説明をAIが言い換えただけになっていないか
- 余計なメリットを無理に追加していないか
- 「〜そう」「〜かも」で逃げすぎていないか
- 友人に話すときにも同じ言い方をするか`;

const SYSTEM_PROMPT = `あなたは楽天ROOMを運営する個人の「商品発掘係」です。
最重要コンセプトは「まず、このアプリの運営者本人が欲しくなる商品を見つける」こと。
売れ筋・レビュー数・アフィリエイトで売れそうかではなく、「え、これいいじゃん」「こんなのあったんだ」「普通に自分でも欲しい」「この値段ならちょっと買ってみたい」と思える商品を候補から最大${MAX_PICKS}個選び、JSONだけを返してください。

評価の順番:
1. 新しい発見がある（「こんなのあるんだ」「その発想はなかった」「これ地味に便利じゃん」）。よく見る定番をそのまま選ばない
2. 欲しくなる理由が一言で言える（例: コンセント周りが一気にすっきりする／出しっぱなしでも生活感が出にくい／旅行の荷物が1つ減る／手でやっていた面倒な作業がなくなる／普通の商品より見た目が明らかに良い／この値段なら試したくなる／ありそうでなかった機能がある）。「人気だから」「レビューが多いから」だけの商品は選ばない
3. 自分で買う姿が想像できる（どこで使うか、家のどこに置くか、いつ使うか）。用途がぼんやりした商品は下げる
4. 小さな不満を解決している（「毎回ちょっと面倒」「ここだけ微妙」「困ってはいないけど改善できるならしたい」）。このタイプを特に重視する
5. 値段に対して欲しくなる。高機能より「この価格なら買ってもいい」。数百円〜数千円の面白い商品も積極的に選ぶ

運営者の好み（やや優先。ただし「これは知らなかった」という発見の方を優先）:
生活が少し楽になるもの、面倒を減らすもの、見た目がすっきりしていて生活感が出すぎないもの、ガジェット、便利グッズ、収納用品、旅行用品、健康管理用品、デスク周り、キッチン用品、家電、インテリア、「そんなものまで売ってるの？」と思えるもの、人に話したくなる小さなアイデア商品、安いのに妙に欲しくなるもの

避ける商品:
どこでも見る定番、特徴のない日用品、単に安いだけ、レビュー数だけで選んだもの、似た商品を何個も、商品名だけ違う実質同一商品、用途が分かりにくいもの、紹介すると広告感が強くなるもの、魅力の説明に長い説明が必要なもの、「最近出した商品」と似すぎているもの

内部評価（出力の want に反映）:
自分でも欲しいか／新しい発見があるか／便利さが一瞬で伝わるか／価格に納得感があるか／見た目に魅力があるか／人に教えたくなるか／過去の商品と被っていないか
最終判断は「楽天ROOMに載せられるか」より先に「運営者本人が楽天を眺めていてこれを見つけたら、本当に商品ページを開きたくなるか」「見つけた自分が少しテンションが上がるか」。答えが弱い商品は選ばない（5個に満たなくてよい）。

${WRITING_RULES}

出力形式（want は内部評価の総合で1〜10、hook は欲しくなる理由の一言）:
{"picks":[{"id":候補番号,"want":8,"hook":"...","reason":"...","intro":"..."}]}`;

export function cleanText(text) {
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
  let picks = [];
  for (const p of list) {
    const id = parseInt(String(p && (p.id ?? p.index ?? p.no ?? '')).replace(/[^0-9]/g, ''), 10);
    if (!Number.isInteger(id) || !items[id] || used.has(id)) continue;
    const intro = cleanText(p.intro);
    if (intro.length < 60) continue;
    used.add(id);
    const want = Number(p.want);
    picks.push({
      index: id,
      want: Number.isFinite(want) ? want : 6,
      reason: cleanText(p.reason) || cleanText(p.hook) || '何が良いのか一言で伝わる商品。',
      intro
    });
  }
  if (picks.length === 0) throw new AiError('AIが商品を選べませんでした');
  // 「欲しい度」の高い順に並べ、低いものは外す（ただし最低3件は残す）
  picks.sort((a, b) => b.want - a.want);
  const strong = picks.filter((p) => p.want >= MIN_WANT);
  picks = (strong.length >= 3 ? strong : picks.slice(0, 3)).slice(0, MAX_PICKS);
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

export async function callOpenAI({ model, apiKey, userContent, timeoutMs, system = SYSTEM_PROMPT }) {
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
  /こちらは/, /こちらの/, /(したい|な)(方|人)(に|へ|には)/, /いかがでしょう/, /チェック/,
  /方向性/, /採用/, /実現/, /叶え/, /サポート/, /豊かに/, /を快適に/, /活躍/, /重宝/,
  /映え/, /ぜひ/, /この機会/, /アイテム/, /さまざまな/, /様々な/, /プレゼントにも/
];
// 選定理由に書かない、運営者目線・売れ筋目線の言葉
const REASON_NG = [/SNS/, /映え/, /紹介しやすい/, /投稿/, /人気/, /レビュー/, /売れ/, /注目/];
const INTRO_MIN = 115;
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
  const hedges = (intro.match(/そう(?=[。、だでなにじし！]|$)|かも|と思(?:います|う|いました)|気がし/g) || []).length;
  if (hedges >= 3) issues.push(`「〜そう」「〜かも」「〜と思います」が多すぎる（${hedges}回）。見た目・形・サイズ・明記された機能などは言い切る`);
  return issues;
}

export function reasonIssues(reason) {
  const hits = REASON_NG.map((re) => (reason.match(re) || [])[0]).filter(Boolean);
  return hits.length ? [`選定理由が運営者目線（「${hits.join('」「')}」）。何が面白いか・どんな不便を解決するかを書く`] : [];
}

const REWRITE_PROMPT = `あなたは楽天ROOMに投稿する紹介文と選定理由を直す担当です。
下書きを、指摘された問題がなくなるように書き直し、JSONだけを返してください。

${WRITING_RULES}

出力形式:
{"fixes":[{"id":番号,"reason":"...","intro":"..."}]}`;

// 定型表現・長さ・運営者目線の理由など問題がある商品だけ、もう一度AIに直してもらう（1回だけ）
export async function refineIntros({ picks, items, model, apiKey, deadline }) {
  const targets = picks
    .map((p, i) => ({ i, p, issues: [...introIssues(p.intro), ...reasonIssues(p.reason)] }))
    .filter((t) => t.issues.length);
  if (!targets.length) return picks;
  const remaining = deadline - Date.now();
  if (remaining < 10000) return picks;
  const userContent = targets.map((t) => {
    const it = items[t.p.index];
    return `id: ${t.i}\n商品: ${compact(it.name, 60)} / ${it.price}円\n商品情報: ${compact(it.caption, 100)}\n選定理由の下書き: ${t.p.reason}\n紹介文の下書き: ${t.p.intro}\n問題: ${t.issues.join('、')}`;
  }).join('\n\n');
  try {
    const content = await callOpenAI({ model, apiKey, userContent, system: REWRITE_PROMPT, timeoutMs: Math.min(25000, remaining - 2000) });
    const data = JSON.parse((String(content).match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const out = [...picks];
    for (const r of data.fixes || data.intros || []) {
      const i = parseInt(String(r && r.id).replace(/[^0-9]/g, ''), 10);
      const target = targets.find((t) => t.i === i);
      if (!target) continue;
      const next = { ...out[i] };
      // 書き直した方が問題が少ないときだけ差し替える
      const intro = cleanText(r.intro);
      if (intro.length >= 100 && introIssues(intro).length < introIssues(target.p.intro).length) next.intro = intro;
      const reason = cleanText(r.reason);
      if (reason && reasonIssues(reason).length < reasonIssues(target.p.reason).length) next.reason = reason;
      out[i] = next;
    }
    return out;
  } catch (e) {
    console.error('[openai] rewrite skipped:', e.message);
    return picks;
  }
}

// 低コストモデルを順に試し、最初に成功したモデルの結果を返す
export async function runWithModels({ env, deadline, system, userContent, parse }) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim(); // 貼り付け時の空白・改行を除く
  const preferred = String(env.OPENAI_MODEL || '').trim();
  const models = [...new Set(preferred ? [preferred, ...DEFAULT_MODELS] : DEFAULT_MODELS)];
  const errors = [];
  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining < 5000) break;
    try {
      const content = await callOpenAI({ model, apiKey, userContent, system, timeoutMs: Math.min(30000, remaining) });
      return { result: parse(content), model, apiKey };
    } catch (e) {
      errors.push(e.message.startsWith(model) ? e.message : `${model}: ${e.message}`);
      console.error('[openai]', errors[errors.length - 1]);
      if (e.retryable === false) break;
    }
  }
  throw new AiError(errors.join(' / ') || 'AIを呼び出す時間が足りませんでした');
}

export async function selectWithAI({ items, genre, brand = false, env, recent = [], deadline = Date.now() + 45000 }) {
  const recentLine = recent.length ? `\n最近出した商品（似すぎるものは優先度を下げる）: ${recent.join(' / ')}` : '';
  const brandBlock = brand ? `\n\n${BRAND_RULES}\n` : '';
  const userContent = `ジャンル: ${genre}${recentLine}${brandBlock}\n候補:\n${buildCandidateLines(items, { withShop: brand })}`;
  const { result: picks, model, apiKey } = await runWithModels({
    env, deadline, system: SYSTEM_PROMPT, userContent, parse: (content) => parsePicks(content, items)
  });
  return refineIntros({ picks, items, model, apiKey, deadline });
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
        reason: 'AI選定が使えなかったため、簡易的に選んだ商品です。',
        intro: `${short}を見つけたので紹介します。商品ページの写真を見ると、暮らしの中に取り入れやすい雰囲気が良い感じ。` +
          `${it.reviewCount ? `レビューも${it.reviewCount}件ほど集まっているので、選ぶときの参考になりそうです。` : ''}` +
          'サイズや仕様は商品ページで確認しつつ、気になる方はチェックしてみてください。'
      };
    });
}
