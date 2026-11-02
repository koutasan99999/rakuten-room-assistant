// 商品ドロボー：Instagramで見つけた商品紹介アカウントの「紹介商品」を、楽天で探して発掘候補にする。
// Instagramの投稿の中身は、このアプリからは取りに行かない（ログインが必要で、自動で集めることは規約で禁止されている。
// 公式API（Business Discovery・oEmbed）は、Metaの開発者登録とアプリ審査が要るため、今は使っていない）。
// 代わりに、社長が入力した商品名か、社長が撮ったスクリーンショットに「文字で書かれている商品」を読み取る。
// スクリーンショットは読み取りに使うだけで、保存も表示もしない（投稿の画像・動画を転載しない）。
import { AiError, cleanText, runWithModels } from './ai.js';
import { writePitches, toPitch } from './pitch.js';

const clean = (v, n) => cleanText(v).replace(/\s+/g, ' ').trim().slice(0, n);

export function readHandle(v) {
  const s = String(v || '').trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/) || s.match(/^@?([A-Za-z0-9._]{1,30})$/);
  if (!m || /^(p|reel|reels|tv|stories|explore)$/i.test(m[1])) return '';
  return m[1].toLowerCase();
}
export function readPostUrl(v) {
  const m = String(v || '').trim().match(/^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reel|tv)\/([A-Za-z0-9_-]{5,40})/);
  return m ? `https://www.instagram.com/${m[1]}/${m[2]}/` : '';
}

const EXTRACT_PROMPT = `あなたは、Instagramの投稿のスクリーンショットから「紹介されている商品」を書き出す係です。JSONだけを返してください。
守ること（とても大事）：
- 画像の中に文字で書かれている商品だけを書き出す（キャプション・画像の上の文字・タグなど）。写っているだけで名前が書かれていない商品は書かない
- 書かれていない商品名・ブランド・型番を推測で足さない。読めない文字は書かない
- name：書かれている商品名（60字以内）
- brand：書かれているブランド名（なければ空）
- model：書かれている型番（なければ空）
- aliases：同じ商品の別の書き方（英字とカタカナなど、書かれている言葉から作れるものだけ。最大3）
- evidence：どこにどう書かれていたか（40字以内。例:「画像の上に『〇〇』と書かれている」）
- handle：画像に写っているアカウントのID（@のあと。なければ空）
出力形式: {"handle":"","products":[{"name":"","brand":"","model":"","aliases":[],"evidence":""}]}`;

// image: data:image/jpeg;base64,... （画面で縮小済み）
export async function extractFromScreenshot({ image, env, deadline }) {
  const { result } = await runWithModels({
    env, deadline, system: EXTRACT_PROMPT,
    userContent: [{ type: 'text', text: 'このスクリーンショットに書かれている商品を書き出してください。' }, { type: 'image_url', image_url: { url: image, detail: 'high' } }],
    parse: (c) => {
      const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
      const products = (Array.isArray(d.products) ? d.products : []).map((p) => ({
        name: clean(p && p.name, 60), brand: clean(p && p.brand, 40), model: clean(p && p.model, 30),
        aliases: (Array.isArray(p && p.aliases) ? p.aliases : []).map((a) => clean(a, 40)).filter(Boolean).slice(0, 3),
        evidence: clean(p && p.evidence, 60)
      })).filter((p) => p.name).slice(0, 10);
      return { handle: readHandle(d.handle), products };
    }
  });
  return result;
}

// 楽天の候補を1つ選んだら、「社長、これどうすか？」用のプレゼンを書く
export async function pitchCandidate({ candidate, source, env, deadline, now = new Date() }) {
  const note = `Instagramの@${source.handle || '不明'}が紹介していた商品の候補。投稿の内容は確認していないので、投稿の中身や投稿者の感想には触れない`;
  const items = [{ ...candidate, note }];
  let ai;
  try {
    ai = (await writePitches({ items, taste: { history: [] }, choose: 0, env, deadline }))[0];
  } catch (e) {
    if (!(e instanceof AiError)) throw e;
  }
  return toPitch(candidate, ai || { pitch: '', fit: '', caution: '楽天の商品ページで、投稿の商品と同じかを確認してください' }, { category: '', angle: `商品ドロボー：@${source.handle || '不明'}`, origin: 'thief' }, now);
}

// 手でコメントするときの一言（2案）。投稿の文章から、宣伝にならない自然な短い一言を作る。投稿はしない
// 2026-11-02 改善：「！」だらけ・褒め言葉だけ・同じ型のくり返し・AIっぽい不自然さ、をなくす
const COMMENT_PROMPT = `あなたは、Instagramの投稿に一般の人として自然なコメントを書く手伝いをします。JSONだけを返してください。
口調：落ち着いた自然な日本語。テンションを上げない。
守ること：
- 投稿の文章にある具体的な1点（物・色・場面・工夫・数字など）に触れる。投稿に書かれていないことは書かない
- 褒め言葉だけにしない。気づいた点・自分の感じ方・素朴な質問のどれかを入れる
- 「！」は使わないか、使っても1つまで。絵文字は使わない
- 次の決まり文句は使わない：めっちゃ素敵ですね／すごく参考になります／欲しくなりました／よさそう／最高ですね／素敵です
- 2案は長さと形を変える（1つは短い感想、1つは質問で終わる など）。どちらも10〜45字
- 宣伝・リンク・「フォローして」・自分のアカウントや商品の話・眼科医の話は書かない
- 体験していないことを体験したように書かない（「私も使ってます」等）
出力形式: {"comments":["...","..."]}`;
const COMMENT_NG = /フォロー|リンク|プロフ|ROOM|楽天|眼科|PR|宣伝|使ってます|使っています|愛用|https?:/;
const STOCK_PRAISE = /めっちゃ素敵|すごく参考|欲しくなりました|よさそう|良さそう|最高です|最高ですね|素敵ですね|素敵です/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// コメント案の確認（品質管理）：問題があれば理由を返す
export function commentIssues(text, caption = '') {
  const t = String(text || '');
  const issues = [];
  if (t.length < 8 || t.length > 50) issues.push('長さ');
  if ((t.match(/[!！]/g) || []).length > 1) issues.push('「！」が多い');
  if (EMOJI.test(t)) issues.push('絵文字');
  if (STOCK_PRAISE.test(t)) issues.push('決まり文句の褒め言葉');
  if (COMMENT_NG.test(t)) issues.push('宣伝・体験の言葉');
  // 投稿の文章と共通の言葉が1つも無いものは、内容に触れていない可能性が高い
  if (caption) {
    const words = String(caption).normalize('NFKC').match(/[一-龯ァ-ヶーA-Za-z0-9]{2,}/g) || [];
    if (words.length && !words.some((w) => t.normalize('NFKC').includes(w))) issues.push('投稿の内容に触れていない');
  }
  return issues;
}

export async function draftComments({ caption, env, deadline }) {
  const { result } = await runWithModels({
    env, deadline, system: COMMENT_PROMPT, userContent: `投稿の文章:\n${String(caption).slice(0, 800)}`,
    parse: (c) => {
      const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
      const out = [];
      for (const x of Array.isArray(d.comments) ? d.comments : []) {
        const v = clean(x, 60);
        if (!v || commentIssues(v, caption).length) continue;
        // 2案が同じ形（同じ書き出し・同じ終わり方）にならないように
        if (out.some((o) => o.slice(0, 4) === v.slice(0, 4) || o.slice(-3) === v.slice(-3))) continue;
        out.push(v);
        if (out.length >= 2) break;
      }
      if (!out.length) throw new AiError('自然なコメント案を作れませんでした');
      return out;
    }
  });
  return result;
}
