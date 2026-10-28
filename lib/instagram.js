// Instagramカルーセル画像に載せる文字（短い商品名・補足1行・くまの一言メモ）をAIで作る。
// 画像そのものはブラウザ側でテンプレートに流し込んで作る（js/ig-render.js）。
import { AiError, cleanText, compact, runWithModels } from './ai.js';

export const MAX_POST_ITEMS = 8;
const SERIES_SUFFIX = /\s*(について)?\s*(本気|ほんき)出して考えてみた\s*$/;

// 「出産祝いについて本気出して考えてみた」→「出産祝い」
export function normalizeTopic(theme) {
  return String(theme || '').replace(/[\s　]+/g, ' ').trim().replace(SERIES_SUFFIX, '').replace(/について$/, '').trim().slice(0, 30);
}

// 一言メモに入れない表現（広告っぽい・決まり文句・強すぎる断定）
const MEMO_NG = /おすすめ|オススメ|サポート|魅力|活躍|重宝|ぴったり|ピッタリ|ぜひ|チェック|神|買うべき|最高|必須|絶対|快適な暮らし|アイテム/;

export function memoIssues(memo) {
  const issues = [];
  if (!memo) return ['空'];
  if (MEMO_NG.test(memo)) issues.push('NG表現');
  if (memo.length > 45) issues.push('長すぎる');
  if ((memo.match(/そう/g) || []).length > 1) issues.push('推量が多い');
  if ((memo.match(/[。！？]/g) || []).length > 2) issues.push('3文以上');
  return issues;
}

// 楽天の長い商品名から、AIが使えないとき用の短い名前を作る
export function fallbackShortName(name) {
  const s = String(name || '')
    .replace(/[【\[（(《<＜].*?[】\]）)》>＞]/g, ' ')
    .replace(/送料無料|ポイント\d+倍|あす楽|公式|正規品|楽天\S*|\d+%OFF|クーポン\S*/g, ' ')
    .replace(/[\s　]+/g, ' ')
    .trim();
  const words = s.split(' ').filter(Boolean);
  let out = '';
  for (const w of words) {
    if ((out + ' ' + w).trim().length > 16) break;
    out = (out + ' ' + w).trim();
  }
  return out || s.slice(0, 16);
}

function fallbackMemo(item) {
  const first = String(item.reason || item.why || '').split(/(?<=[。！？])/)[0].trim();
  const memo = cleanText(first);
  return memo && !memoIssues(memo).length ? memo : '迷ったら、まずここから見ればいい枠。';
}

function asciiSlug(text, fallback) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return s || fallback;
}

const PROMPT = `あなたはInstagramアカウント「眼科医くま」の投稿文字を作る担当です。JSONだけを返してください。
アカウントのトーン: 売り込みではなく「買い物に詳しい友達が、ちゃんと整理してくれる」。シンプル・知的・ほどよく親しみやすい。

カルーセル画像に載せる文字を、商品ごとに作ります。文字は少なめにします。

各商品:
- shortName: 意味が分かる短い商品名（16字以内）。ブランド名があれば残し、型番・容量・送料無料・宣伝文句は削る
  例:「UGREEN Nexode 急速充電器 65W Type-C 2C1A 3ポート」→「UGREEN 3ポート急速充電器」、「充電式 ポータブルジューサー 電動ミキサー 380mL」→「ポータブルジューサー」
- subline: 補足説明の短い1行（22字以内。何が良いのかが一目で分かる事実。宣伝文句にしない）
- memo: くまの一言メモ（35字以内、1〜2文）。友達に「これ良くない？」と話す感じ。短く言い切る。広告っぽくしない。硬すぎず砕けすぎない
  - 「〜そう」はできるだけ避ける。使っていないので体験を作らない（使ってみた・愛用・買ってよかった等は禁止）。商品情報から言えることを中心にする
  - 良い例:「これ1個あると、充電周りがかなりすっきり。」「出産祝いって迷うけど、こういう実用品は外しにくい。」「高いけど、ブランドごと贈る意味があるやつ。」「安く済ませたいなら、このへんがちょうどいい。」「自分では後回しにしがちだから、もらうと嬉しい。」「迷ったらまずこれでいい枠。」「見た目も良くて、ちゃんと選んだ感じが出る。」
  - 使わない言葉: 快適な暮らしをサポート／魅力的なアイテム／おすすめです／活躍してくれそう／重宝しそう／ぴったり／ぜひチェック／神／買うべき
  - 役割（迷ったらこれ・本命・安い代替など）が指定されていれば、その立ち位置が伝わる一言にする
- slug: 商品を表す短い英小文字（ブランド名や商品の種類の英語。例: ugreen, juicer, towel）

全体:
- topicSlug: 投稿テーマのローマ字・英語の短いスラッグ（例: 出産祝い→shussan-iwai、香水初心者→kosui-shoshinsha）
- category: 商品カード左上に出す小ラベル（8字以内。指定があればそれを使う）

出力形式:
{"topicSlug":"...","category":"...","items":[{"id":0,"shortName":"...","subline":"...","memo":"...","slug":"..."}]}`;

function buildUserContent(topic, category, items) {
  const lines = [`投稿テーマ: ${topic}について本気出して考えてみた`, `カテゴリ: ${category || '（テーマから決める）'}`, '商品:'];
  items.forEach((it, i) => {
    lines.push(`${i}: ${compact(it.name, 80)} / ${it.price}円${it.role ? ` / 役割: ${compact(it.role, 14)}` : ''} / 選んだ理由: ${compact(it.reason || it.why || it.intro, 80)}`);
  });
  return lines.join('\n');
}

function parseCopy(content, items) {
  let data;
  try {
    data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]);
  } catch {
    throw new AiError('AIの応答を読み取れませんでした');
  }
  const list = Array.isArray(data.items) ? data.items : [];
  const byId = {};
  for (const x of list) {
    const id = parseInt(String(x && x.id).replace(/[^0-9]/g, ''), 10);
    if (Number.isInteger(id) && items[id] && !byId[id]) byId[id] = x;
  }
  if (Object.keys(byId).length < Math.ceil(items.length / 2)) throw new AiError('AIの応答に商品が足りませんでした');
  return { data, byId };
}

// AIの結果を検証し、足りない・ルール違反のところは予備の文字で埋める
export function finalizeCopy({ topic, category, items, data = {}, byId = {} }) {
  const outItems = items.map((it, i) => {
    const x = byId[i] || {};
    const shortName = cleanText(x.shortName).slice(0, 20) || fallbackShortName(it.name);
    const subline = cleanText(x.subline).slice(0, 26);
    let memo = cleanText(x.memo);
    if (memoIssues(memo).length) memo = fallbackMemo(it);
    return { shortName, subline, memo, slug: asciiSlug(x.slug, `item${i + 1}`) };
  });
  return {
    topic,
    category: cleanText(category || data.category || topic).slice(0, 10),
    topicSlug: asciiSlug(data.topicSlug, 'post'),
    items: outItems
  };
}

export async function buildPostCopy({ theme, category, items, env, deadline }) {
  const topic = normalizeTopic(theme);
  if (!topic) throw new AiError('投稿テーマがありません');
  const list = items.slice(0, MAX_POST_ITEMS);
  try {
    const { result } = await runWithModels({
      env, deadline, system: PROMPT, userContent: buildUserContent(topic, category, list),
      parse: (content) => parseCopy(content, list)
    });
    return { ...finalizeCopy({ topic, category, items: list, ...result }), fallback: false };
  } catch (e) {
    console.error('[instagram] fallback:', e.message);
    return { ...finalizeCopy({ topic, category, items: list }), fallback: true, error: e.message };
  }
}
