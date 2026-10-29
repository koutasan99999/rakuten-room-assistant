// 1つの企画・1回の商品選定から、カルーセル以外の投稿素材（Reel・Story）を作る。
// 役割を分ける：カルーセル＝詳しく説明、Reel＝興味を引いて投稿・プロフィールへ、Story＝投稿へ誘導。
// AIには文字（フック・テロップ・ナレーション・シーンの並び）だけを作らせ、画像・動画は画面側の固定テンプレートで作る。
import { AiError, compact, cleanText, runWithModels } from './ai.js';

export const REEL_MIN_SEC = 10;
export const REEL_MAX_SEC = 20;
const MIN_REEL_ITEMS = 3;
const MAX_REEL_ITEMS = 5;

// 投稿の最後に添える呼びかけ（毎回同じにしない）
export const CTA_CHOICES = [
  'あとで必要になるので保存',
  '迷ってる人に送ってあげてください',
  '気になるものがあればROOMへ',
  '全部プロフィールにまとめています',
  '続きはカルーセルで',
  '比較したい時に見返してください'
];

const PROMPT = `あなたはInstagramアカウント「眼科医くま」の投稿担当です。JSONだけを返してください。
すでに作ったカルーセル投稿（同じ企画・同じ商品）を、Reel と Story に展開します。同じ文章を使い回さず、役割を変えてください。
- カルーセル: 詳しく説明する（もう作ってある）
- Reel: 非フォロワーに興味を持ってもらい、カルーセル投稿やプロフィールへ誘導する。詳しく説明しない
- Story: フォロワーを最新の投稿へ誘導する

トーン: 売り込みではなく「買い物に詳しい友達が整理してくれる」。派手な言葉・煽り・絵文字は使わない。体験を作らない（使ってみた・愛用など）。「絶対」「必ず」「最安」「お得」「神」は使わない。防災グッズは不安を煽らない。

Reel（10〜20秒）:
- title: 動画タイトル（16字以内）
- hook: 冒頭0〜2秒の強いフック（16字以内。例:「防災グッズ、何から買えばいい？」「5,000円でプレゼントするならこれ」「高い本命、本当に必要？」「安いけどこれはアリ。」「香水初心者、まずこれ。」）
- scenes: シーンの並び。最初は hook のシーン（2秒）、次に商品のシーンを3〜5個（1商品1〜3秒。テンポよく）、最後に cta のシーン（2〜3秒）
  各シーン: type（"hook" / "item" / "cta"）、seconds（秒数）、item（商品のシーンだけ、商品の番号）、text（画面テロップ。14字以内。商品なら「①まず電源」「②停電対策」「③ここ忘れがち」のように番号＋ひとこと）、narration（ナレーション。そのシーンで読む短い文。30字以内）
- 商品は、見た人が「おっ」と思う順に3〜5個を選ぶ（全部でなくてよい）
- cta: 最後の呼びかけ（「詳しくは投稿にまとめました」「全部ROOMにまとめています」「保存してあとで見返してください」などから自然なもの）

Story（3枚）:
- 1枚目 hook: 興味を引く問いかけ（16字以内。例:「出産祝い、何あげる？」「防災用品、ちゃんと揃ってる？」「5,000円で何買う？」）、sub: 補足（20字以内、任意）
- 2枚目 title: 選び方を少し見せる見出し（12字以内。例:「今回はこの3つで選びました」）、points: 選び方の基準を3つ（各8字以内。例: 実用性／センス／価格）
- 3枚目 text: 投稿への誘導（16字以内。例:「6商品まとめました」）、sub: 補足（20字以内。例:「詳しくは最新投稿へ」「ROOMにも全部入れてます」）

出力形式:
{"reel":{"title":"...","hook":"...","scenes":[{"type":"hook","seconds":2,"text":"...","narration":"..."},{"type":"item","seconds":2,"item":0,"text":"...","narration":"..."},{"type":"cta","seconds":3,"text":"...","narration":"..."}],"cta":"..."},
 "story":{"hook":"...","hookSub":"","title":"...","points":["...","...","..."],"text":"...","sub":"..."}}`;

const t = (s, n) => cleanText(s).slice(0, n);

function round1(n) { return Math.round(n * 10) / 10; }

// シーンの秒数をそろえ、開始・終了の時刻を付ける（全体10〜20秒、商品は1〜3秒、3〜5個）
export function normalizeReel(raw, items, topic = '') {
  const r = raw && typeof raw === 'object' ? raw : {};
  const scenes = Array.isArray(r.scenes) ? r.scenes : [];
  const hookScene = scenes.find((s) => s && s.type === 'hook') || {};
  const ctaScene = [...scenes].reverse().find((s) => s && s.type === 'cta') || {};
  const used = new Set();
  const itemScenes = [];
  for (const s of scenes) {
    if (!s || s.type !== 'item') continue;
    const i = parseInt(String(s.item).replace(/[^0-9]/g, ''), 10);
    if (!Number.isInteger(i) || !items[i] || used.has(i)) continue;
    used.add(i);
    itemScenes.push({ type: 'item', item: i, seconds: Math.min(3, Math.max(1, Number(s.seconds) || 2)), text: t(s.text, 16) || `${itemScenes.length + 1}. ${items[i].shortName || ''}`.slice(0, 16), narration: t(s.narration, 40) });
    if (itemScenes.length >= MAX_REEL_ITEMS) break;
  }
  // 商品が少なければ、まだ使っていない商品で3個までは足す
  for (let i = 0; itemScenes.length < Math.min(MIN_REEL_ITEMS, items.length) && i < items.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    itemScenes.push({ type: 'item', item: i, seconds: 2, text: `${'①②③④⑤'[itemScenes.length]}${items[i].shortName || ''}`.slice(0, 16), narration: '' });
  }
  const hook = t(r.hook || hookScene.text, 20) || `${topic}、どれを選ぶ？`.slice(0, 20);
  const cta = t(r.cta || ctaScene.text, 20) || '詳しくは投稿にまとめました';
  const out = [
    { type: 'hook', seconds: 2, text: t(hookScene.text, 20) || hook, narration: t(hookScene.narration, 40) || hook },
    ...itemScenes,
    { type: 'cta', seconds: Math.min(3, Math.max(2, Number(ctaScene.seconds) || 3)), text: t(ctaScene.text, 20) || cta, narration: t(ctaScene.narration, 40) || cta }
  ];
  // 全体を10〜20秒に収める（長ければ商品のシーンを縮め、短ければ伸ばす）
  const total = () => out.reduce((a, s) => a + s.seconds, 0);
  while (total() > REEL_MAX_SEC && out.some((s) => s.type === 'item' && s.seconds > 1)) {
    out.filter((s) => s.type === 'item' && s.seconds > 1).forEach((s) => { s.seconds = Math.max(1, round1(s.seconds - 0.5)); });
  }
  while (total() < REEL_MIN_SEC && out.some((s) => s.type === 'item' && s.seconds < 3)) {
    out.filter((s) => s.type === 'item' && s.seconds < 3).forEach((s) => { s.seconds = Math.min(3, round1(s.seconds + 0.5)); });
  }
  if (total() < REEL_MIN_SEC) out[out.length - 1].seconds = round1(out[out.length - 1].seconds + (REEL_MIN_SEC - total()));
  let at = 0;
  out.forEach((s) => { s.start = round1(at); at += s.seconds; s.end = round1(at); });
  return {
    title: t(r.title, 20) || topic.slice(0, 16),
    hook,
    cta,
    seconds: round1(at),
    scenes: out,
    narration: out.map((s) => s.narration).filter(Boolean).join('\n')
  };
}

export function normalizeStory(raw, items, topic = '') {
  const s = raw && typeof raw === 'object' ? raw : {};
  const points = (Array.isArray(s.points) ? s.points : []).map((p) => t(p, 10)).filter(Boolean).slice(0, 3);
  return {
    hook: t(s.hook, 20) || `${topic}、何を選ぶ？`.slice(0, 20),
    hookSub: t(s.hookSub, 24),
    title: t(s.title, 16) || '今回はこの3つで選びました',
    points: points.length >= 2 ? points : ['使いやすさ', '見た目', '価格'],
    text: t(s.text, 20) || `${items.length}商品まとめました`,
    sub: t(s.sub, 24) || '詳しくは最新投稿へ'
  };
}

function itemLines(items) {
  return items.map((it, i) => `${i}: ${compact(it.shortName || it.name, 30)} / ${it.price}円${it.role ? ` / 役割: ${compact(it.role, 14)}` : ''}${it.reason ? ` / ${compact(it.reason, 60)}` : ''}`).join('\n');
}

export async function buildReelStory({ topic, title = '', criteria = [], items, env, deadline }) {
  const userContent = [
    `投稿テーマ: ${title || topic}`,
    criteria.length ? `カルーセルで書いた選び方の基準: ${criteria.join('／')}` : '',
    `商品（カルーセルの順）:\n${itemLines(items)}`
  ].filter(Boolean).join('\n');
  try {
    const { result } = await runWithModels({
      env, deadline, system: PROMPT, userContent,
      parse: (content) => {
        let data;
        try { data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]); } catch { throw new AiError('AIの応答を読み取れませんでした'); }
        if (!data.reel || !data.story) throw new AiError('ReelかStoryが足りませんでした');
        return data;
      }
    });
    return { reel: normalizeReel(result.reel, items, topic), story: normalizeStory(result.story, items, topic), fallback: false };
  } catch (e) {
    console.error('[openai] assets fallback:', e.message);
    return { reel: normalizeReel(null, items, topic), story: normalizeStory({ points: criteria }, items, topic), fallback: true, error: e.message };
  }
}
