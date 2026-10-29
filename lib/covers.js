// Instagram 1枚目（表紙）のシリーズ。選び方の型ごとに表紙のテンプレートを固定し、
// 「何のシリーズか」が一目で分かるようにする。表紙の配置・色・書体は js/ig-render.js の固定テンプレートで描き、
// AIには表紙の文字（大見出し・強調する言葉・小見出し）だけを作らせる。
//
// 「○○について本気出して考えてみた」シリーズ（企画・最初の10投稿・商品から作った企画）は、
// 今までのグレージュの表紙（serious_think）のまま変えない。
import { cleanText } from './ai.js';

export const COVER_STYLES = {
  serious_think: { name: '本気出して考えてみた（グレージュ）', examples: [] },
  must_buy: { name: 'まずコレ（アイボリー × マスタード）', examples: ['防災グッズ、\nまずコレを買え', '香水なら、\nまずコレ', 'iPhoneアクセ、\nまずコレ', '迷ったら、\nまずコレ'], accent: 'コレ' },
  premium_vs_alternative: { name: '本命と代替（左右で比較）', examples: ['白スニーカーの\n本命と代替品', '充電器の\n本命と代替品', '食器の\n本命と代替品'], accent: '本命' },
  budget_compare: { name: '予算で比較（クリーム × グリーン）', examples: ['5,000円で探す\nちょうどいいギフト', '1万円で選ぶなら\nコレ', '予算別で選ぶ\nワイヤレスイヤホン'] },
  gift_select: { name: 'プレゼント（ベージュ × ブラウン）', examples: ['30代の贈り物、\n失敗しない選び方', '出産祝いなら\nコレ', '外さない\nギフト'] },
  starter_set: { name: '初心者セット（ネイビー × ステップ）', examples: ['香水初心者は\nこの3つから', 'まず揃えるなら\nこの順番'], accent: 'この3つ' },
  use_case: { name: '用途で選ぶ（タグで分類）', examples: ['使う場面で選ぶ\nモバイルバッテリー', '家用・外用・仕事用\nで選ぶタンブラー'] },
  brand_pick: { name: 'ブランドから選ぶ（雑誌風）', examples: ['今知っておきたい\nメンズ財布ブランド', '外さない\nブランド小物'] },
  value_pick: { name: 'コスパ重視（ダーク × ゴールド）', examples: ['安いけど、\nこれはアリ', '1,500円だけど、\nこれはアリ', 'コスパで選ぶなら\nコレ'], accent: 'アリ' },
  trend_pick: { name: 'トレンド（文字主体）', examples: ['最近よく見る\nポータブルファン', '今ちょっと気になる\nサウナグッズ'] },
  unique_pick: { name: '変わり種（ちょいズラし）', examples: ['ちょいズラしで選ぶ\n白T', '人と少し違うなら\nコレ'] },
  buy_this_first: { name: '買っとけ（カーキ × チェックリスト）', examples: ['防災なら、\nこれだけ揃えとけ', '便利グッズなら、\nまずこれ', '最低限\nこれだけでいい'], accent: 'これだけ' }
};

// 発掘ページの「選び方の型」→ 表紙のシリーズ（おまかせは、AIが内容に合うものを選ぶ）
export const COVER_FOR_TYPE = {
  omakase: 'auto',
  first_pick: 'must_buy',
  premium_budget: 'premium_vs_alternative',
  budget_tiers: 'budget_compare',
  gift: 'gift_select',
  beginner: 'starter_set',
  use_case: 'use_case',
  brand: 'brand_pick',
  value: 'value_pick',
  trend: 'trend_pick',
  unusual: 'unique_pick',
  must_buy: 'buy_this_first'
};

const SERIES_RE = /本気出して考えてみた$/;

// 商品を探したときの内容から、表紙のシリーズを決める。
// 「○○について本気出して考えてみた」シリーズの企画は、型にかかわらず今までの表紙のまま
export function coverStyleFor({ type, title = '', series = false }) {
  if (series || SERIES_RE.test(String(title))) return 'serious_think';
  return COVER_FOR_TYPE[type] || 'auto';
}

export function isCoverStyle(id) {
  return Object.prototype.hasOwnProperty.call(COVER_STYLES, id);
}

// AIへの指示（表紙の文字だけ）。style が 'auto' のときは、シリーズもAIに選ばせる
export function coverPrompt(style) {
  const choices = Object.entries(COVER_STYLES).filter(([id]) => id !== 'serious_think');
  const list = style === 'auto'
    ? `表紙のシリーズ（style）を、内容に一番合うものから1つ選ぶ: ${choices.map(([id, s]) => `${id}（${s.name}。例: ${s.examples[0].replace('\n', '')}）`).join('／')}`
    : `表紙のシリーズは「${COVER_STYLES[style].name}」。大見出しの例: ${COVER_STYLES[style].examples.map((e) => `「${e.replace('\n', '／')}」`).join('')}`;
  return `
追加で、Instagram投稿の1枚目（表紙）に載せる文字も作る（cover）:
- ${list}
- title: 大見出し（2行。行の区切りは改行 \\n。1行9字前後まで、全体で18字以内。シリーズの例の言い回しに寄せて、今回のテーマに合わせる）
- accent: 大見出しの中で一番目立たせる言葉（大見出しにそのまま含まれる2〜5字。例: コレ、アリ、本命、5,000）
- sub: 小見出し（16字以内。例:「最初の1セットはここから」「予算から逆算して選ぶ」「値段だけでは切れない名品候補」）
- badge: 小さなラベル（6字以内。例: プレゼント、BUDGET、TREND。不要なら空文字）
- price: 予算で比較のときだけ、目立たせる金額（例: "5,000"。円は付けない）。それ以外は空文字
- 通販広告のような言葉（激安・最安・お得・ポイント・％OFF・送料無料・ランキング）は使わない
出力に "cover":{${style === 'auto' ? '"style":"...",' : ''}"title":"...","accent":"...","sub":"...","badge":"","price":""} を加える`;
}

const AD_RE = /激安|最安|お得|ポイント|%OFF|％OFF|送料無料|ランキング|1位/;

function cleanCoverText(s, n) {
  // 改行は cleanText で空白にまとめられてしまうので、いったん記号に置き換えてから戻す
  const t = cleanText(String(s || '').replace(/\\n/g, '\n').replace(/\n/g, '〓')).replace(/\s*〓\s*/g, '\n').trim();
  return AD_RE.test(t) ? '' : t.slice(0, n);
}

// 予算の書き方（5,000円、1万円、3000円など）から、表紙で目立たせる金額を取り出す
export function priceFrom(text) {
  const m = String(text || '').match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(万)?\s*円/);
  if (!m) return '';
  const n = m[2] ? Number(m[1].replace(/,/g, '')) * 10000 : Number(m[1].replace(/,/g, ''));
  return n >= 100 ? n.toLocaleString('ja-JP') : '';
}

// AIが使えないとき・AIの文字が使えないときの表紙の文字（テーマを入れた決まった言い回し）
export function fallbackCover(style, topic, priceBand = '') {
  const full = String(topic || '').replace(/(について)?本気出して考えてみた$/, '');
  const t = full.slice(0, 14) || 'これ';
  const price = priceFrom(`${t} ${priceBand}`);
  const copy = {
    must_buy: { title: `${t}、\nまずコレ`, accent: 'コレ', sub: '最初の1個はここから' },
    premium_vs_alternative: { title: `${t}の\n本命と代替品`, accent: '本命', sub: '高い本命と、安いけどアリ' },
    budget_compare: price
      ? { title: `${price}円で探す\n${full.replace(/\d[\d,]*\s*万?円(前後|以下|以内|くらい|まで)?の?/, '').trim().slice(0, 14) || 'ちょうどいいもの'}`, accent: price, sub: '予算から逆算して選ぶ', price }
      : { title: `予算で選ぶ\n${t}`, accent: '予算', sub: '予算から逆算して選ぶ' },
    gift_select: { title: `${t}、\n外さない選び方`, accent: '外さない', sub: '贈る相手から考える', badge: 'プレゼント' },
    starter_set: { title: `${t}は\nこの順番で`, accent: 'この順番', sub: '1個目・2個目・遊び枠' },
    use_case: { title: `使う場面で選ぶ\n${t}`, accent: '使う場面', sub: '用途ごとに整理してみた' },
    brand_pick: { title: `ブランドで選ぶ\n${t}`, accent: 'ブランド', sub: '王道から新しいところまで', badge: 'BRAND' },
    value_pick: { title: '安いけど、\nこれはアリ', accent: 'アリ', sub: `${t}、値段だけでは切れない` },
    trend_pick: { title: `最近よく見る\n${t}`, accent: '最近', sub: '話題のものを整理してみた', badge: 'TREND' },
    unique_pick: { title: `ちょいズラしで選ぶ\n${t}`, accent: 'ちょいズラし', sub: '王道じゃないけど、好きなやつ' },
    buy_this_first: { title: `${t}、\nこれだけ揃えとけ`, accent: 'これだけ', sub: '最低限のチェックリスト' }
  }[style];
  return copy ? { style, badge: '', price: '', ...copy } : null;
}

// AIの表紙の文字を検証する。足りないところは予備の文字で埋める
export function finalizeCover(style, raw, topic, priceBand) {
  let chosen = style;
  if (chosen === 'auto') chosen = raw && isCoverStyle(raw.style) && raw.style !== 'serious_think' ? raw.style : 'must_buy';
  if (chosen === 'serious_think') return { style: chosen };
  const fb = fallbackCover(chosen, topic, priceBand);
  const title = cleanCoverText(raw && raw.title, 30);
  if (!title) return fb;
  const lines = title.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
  const joined = lines.join('\n');
  const flat = joined.replace(/\n/g, '');
  // 強調する言葉が大見出しに無いときは、そのシリーズのいつもの言葉（コレ・アリなど）が入っていればそれを使う
  const accent = [cleanCoverText(raw.accent, 8), COVER_STYLES[chosen].accent].find((a) => a && flat.includes(a)) || '';
  return {
    style: chosen,
    title: joined,
    accent,
    sub: cleanCoverText(raw.sub, 20) || fb.sub,
    badge: cleanCoverText(raw.badge, 10),
    price: chosen === 'budget_compare' ? (String(raw.price || '').replace(/[^0-9,]/g, '').slice(0, 9) || fb.price) : ''
  };
}
