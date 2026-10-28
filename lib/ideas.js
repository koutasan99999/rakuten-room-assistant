// 「今日の企画を考える」：商品より先に、Instagram投稿の企画を3案考える。
// ジャンルと投稿の型は、3案どうしと直近の履歴でかぶらないようにサーバー側で先に選び（lib/catalog.js）、
// AIにはその組み合わせで具体的な企画（タイトル・ターゲット・価格帯・役割・検索語）を作ってもらう。
import { CATALOG, POST_TYPES, sampleIdeaSeeds, seasonOf, findPostType } from './catalog.js';
import { AiError, cleanText, runWithModels } from './ai.js';
import { CURATION_TYPES } from './themes.js';

const SERIES = 'について本気出して考えてみた';

// 投稿の型ごとの役割のひな形（AIが使えないときの予備）
const ROLE_TEMPLATES = {
  premium_budget: [['本命ブランド', 8000, null], ['本命の中では買いやすい', 4000, 9000], ['コスパ代替', 1500, 4000], ['まず試す代替', null, 1500], ['用途違いの別解', null, null], ['一番バランスが良い', 2000, 8000]],
  gift: [['迷ったらこれ', 3000, 8000], ['王道', 4000, 12000], ['センス枠', 3000, 10000], ['実用性重視', 2000, 6000], ['価格を抑えるなら', null, 3000], ['少し奮発するなら', 10000, 25000]],
  beginner: [['まず1個目', null, 6000], ['次に足すなら', null, 8000], ['少し慣れたら', 3000, 15000], ['価格を抑えるなら', null, 3000], ['長く使うなら', 6000, null], ['迷ったらこれ', null, 8000]],
  first_pick: [['迷ったらこれ', null, 8000], ['2番手', null, 8000], ['用途を広げるなら', null, 8000], ['価格を抑えるなら', null, 3000], ['少し奮発するなら', 6000, null], ['意外な別解', null, 6000]],
  use_case: [['王道', 3000, null], ['少し遊ぶなら', null, null], ['仕事用', null, null], ['休日用', null, null], ['ギフト向け', 3000, 12000], ['迷ったらこれ', null, 8000]],
  must_buy: [['まずこれ', null, 8000], ['最低限の2個目', null, 6000], ['あると安心', null, 6000], ['価格を抑えるなら', null, 3000], ['セットで揃えるなら', 5000, null], ['意外と忘れがち', null, 4000]],
  value: [['コスパの本命', 2000, 8000], ['価格以上の作り', 2000, 8000], ['失敗しても許せる価格', null, 2000], ['実用品', null, 5000], ['少しだけ奮発', 5000, 12000], ['意外な別解', null, 5000]],
  trend: [['最近よく見る', null, null], ['話題のブランド', null, null], ['SNSで見かける', null, 6000], ['価格を抑えるなら', null, 3000], ['定番との比較', null, null], ['知っておきたい', null, null]],
  brand: [['王道ブランド', 5000, null], ['王道の入口', 2000, 8000], ['新興ブランド', null, null], ['知っておきたいブランド', null, null], ['実力派メーカー', null, 8000], ['少し奮発するなら', 10000, null]],
  unusual: [['変わり種', null, null], ['意外な別解', null, 6000], ['ちょっと面白い', null, 5000], ['失敗しても許せる価格', null, 2000], ['実は便利', null, 5000], ['知っておきたい', null, null]],
  omakase: [['本命', null, null], ['2番手', null, null], ['コスパ', null, 5000], ['変わり種', null, null], ['トレンド', null, null], ['少し奮発', 8000, null]],
  budget_tiers: [['低価格', null, 3000], ['低価格の別解', null, 3000], ['中価格', 3000, 10000], ['中価格の別解', 3000, 10000], ['高価格', 10000, null], ['迷ったらこれ', 3000, 10000]]
};

const PROMPT = `あなたはInstagramアカウント「眼科医くま」の編集長です。JSONだけを返してください。
アカウントの役割は「商品を大量におすすめする」ことではなく「結局どれを選べばいいかを整理する」こと。トーンは「買い物に詳しい友達が、ちゃんと整理してくれる」。
投稿タイトルは「○○について本気出して考えてみた」のシリーズです（○○の部分を topic に入れる）。

これから、指定する3つの「ジャンル × 投稿の型」の組み合わせで、今日の投稿企画を1案ずつ（計3案）考えてください。
- 毎回同じにならないよう、ジャンル・価格帯・対象者・用途・選び方の型を変える。季節・トレンド・プレゼント需要・生活の小さな悩みも材料にする
- 直近の投稿と、同じジャンル・同じブランド・同じ価格帯・同じターゲット・同じ型が重なりすぎないようにする（フィードを見て「また同じ話をしている」と見えないように）
- 「おすすめ○選」のような企画にしない。「なぜこれを選ぶのか」「誰ならこれを選ぶべきか」が分かる企画にする
- 本命＋代替系の型では、単に高い商品と安い商品を並べず、比較軸を決める（axis に書く）。本命側は「なぜ高いのか」、代替側は「何が近いか・何を妥協するか・どんな人なら代替で十分か」が説明できる構成にする
- 防災グッズは不安を煽らない。「何を揃えればいいか分からない」「自分で一個ずつ選ぶのが面倒」「最低限だけ先に用意しておきたい」を整理する企画にする。単品紹介に偏らず、最低限・一人暮らし・家族・車・停電・断水・避難用・在宅避難・防災リュックの中身・高い本命と安い代替・セットで買うなら、のように切り口を変える
- ファッション・香水・食器・ギフト・バッグ・財布・小物などはブランド背景を重視する。無名の安い商品は安いだけなら主役にしない（トレンド・新興ブランド・独自性・試しやすい価格なら可）

各案の項目:
- topic: ○○の部分（20字以内。例:「30代男性への5,000円プレゼント」「香水初心者の最初の3本」「旅行前に買っておくと楽なもの」「タンブラー」）
- subtitle: 補足（任意、16字以内。本命＋代替系なら「― 高い本命と安い代替 ―」のように。「まずこれ買っとけ」型なら「― まずこれ買っとけ ―」「― 迷ったらまずこれ ―」「― 最初に買うならこれ ―」からテーマに合うものを選び、命令口調が強すぎないようにする）
- postType: 指定した投稿の型の名前をそのまま
- target: 想定ターゲット（30字以内）
- priceBand: 想定価格帯（例:「3,000〜8,000円」）
- genre: 指定したジャンル名をそのまま
- brands: 登場しそうなブランド（0〜4個。指定ジャンルのブランド例から選ぶとよい）
- whyInteresting: この企画が面白い理由（60字以内）
- axis: 比較軸（本命＋代替系・〜vs〜系のときだけ。例:「所有満足感 vs 実用性」）
- slots: 想定する商品構成を6枠。各枠は label（役割10字以内。6枠とも違う役割）、keyword（楽天で検索する語。商品名に含まれやすい名詞を2〜3語。ブランド名を入れてよい）、minPrice、maxPrice（円の数値か null）

出力形式:
{"ideas":[{"topic":"...","subtitle":"","postType":"...","target":"...","priceBand":"...","genre":"...","brands":[],"whyInteresting":"...","axis":"","slots":[{"label":"...","keyword":"...","minPrice":null,"maxPrice":null}]}]}`;

// 「まずこれ買っとけ」型の表紙サブタイトル（命令口調が強くなりすぎないよう使い分ける）
export const MUST_BUY_SUBTITLES = ['まずこれ買っとけ', '迷ったらまずこれ', '最初に買うならこれ'];

function validPrice(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 100 && n <= 2000000 ? n : undefined;
}

function cleanKeyword(k) {
  return cleanText(k).replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

// 企画1案を検証して整える（クライアントから戻ってきた企画にも使う）
export function normalizeIdea(x, seed) {
  if (!x || typeof x !== 'object') return null;
  if (x.edited === true) return normalizeEditedIdea(x);
  const type = findPostType(cleanText(x.postType)) || (seed && seed.type);
  const genre = CATALOG.find((c) => c.name === cleanText(x.genre)) || (seed && seed.genre);
  const topic = cleanText(x.topic).replace(/について本気出して考えてみた$/, '').replace(/について$/, '').slice(0, 30);
  const slots = (Array.isArray(x.slots) ? x.slots : [])
    .map((s) => {
      let minPrice = validPrice(s && s.minPrice);
      let maxPrice = validPrice(s && s.maxPrice);
      if (minPrice && maxPrice && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
      return { label: cleanText(s && s.label).slice(0, 14), keyword: cleanKeyword(s && s.keyword), minPrice, maxPrice };
    })
    .filter((s) => s.label && s.keyword)
    .slice(0, 6);
  if (!topic || !type || !genre || slots.length < 3) return null;
  return {
    topic,
    title: topic + SERIES,
    subtitle: cleanText(x.subtitle).slice(0, 20),
    postType: type.name,
    postTypeId: type.id,
    curationType: type.curation,
    target: cleanText(x.target).slice(0, 40),
    priceBand: cleanText(x.priceBand).slice(0, 24),
    genre: genre.name,
    brandImportant: !!genre.brandImportant,
    brands: (Array.isArray(x.brands) ? x.brands : []).map((b) => cleanText(b).slice(0, 24)).filter(Boolean).slice(0, 4),
    whyInteresting: cleanText(x.whyInteresting).slice(0, 90),
    axis: cleanText(x.axis).slice(0, 30),
    slots
  };
}

// ユーザーが編集した企画（AIの案はたたき台）。タイトルは自由に書き換えられ、ジャンルも一覧にない言葉でよい
function normalizeEditedIdea(x) {
  let title = cleanText(x.title).slice(0, 60);
  if (title && !/本気出して考えてみた$/.test(title)) title += SERIES;
  const topic = title.replace(/(について)?本気出して考えてみた$/, '').slice(0, 40);
  const curationType = CURATION_TYPES[x.curationType] ? x.curationType : 'omakase';
  if (!topic) return null;
  const genre = CATALOG.find((c) => c.name === cleanText(x.genre));
  return {
    edited: true,
    topic,
    title,
    subtitle: cleanText(x.subtitle).slice(0, 20),
    postType: cleanText(x.postType).slice(0, 20) || CURATION_TYPES[curationType].name,
    postTypeId: '',
    curationType,
    target: cleanText(x.target).slice(0, 40),
    priceBand: cleanText(x.priceBand).slice(0, 24),
    genre: cleanText(x.genre).slice(0, 20),
    brandImportant: genre ? !!genre.brandImportant : false,
    brands: [],
    whyInteresting: cleanText(x.whyInteresting).slice(0, 90),
    axis: cleanText(x.axis).slice(0, 30),
    free: cleanText(x.free).slice(0, 200),
    slots: []
  };
}

// AIが使えないときの予備の企画
export function fallbackIdea(seed) {
  const { genre, type, items } = seed;
  const item = items[0];
  const isTarget = genre.id === 'gift';
  const keywordBase = isTarget ? `${item} プレゼント` : item;
  const brand = genre.brands[0];
  const slots = ROLE_TEMPLATES[type.curation].map(([label, minPrice, maxPrice], i) => ({
    label,
    keyword: cleanKeyword(i === 0 && brand && type.curation === 'premium_budget' ? `${brand} ${item}` : keywordBase),
    minPrice: minPrice || undefined,
    maxPrice: maxPrice || undefined
  }));
  const compare = type.curation === 'premium_budget';
  const mustBuy = type.id === 'must_buy';
  return normalizeIdea({
    topic: isTarget ? `${item}へのプレゼント` : item,
    subtitle: compare || mustBuy ? `― ${mustBuy ? MUST_BUY_SUBTITLES[Math.floor(Math.random() * MUST_BUY_SUBTITLES.length)] : type.name} ―` : '',
    postType: type.name,
    target: isTarget ? item : `${item}を選びたい人`,
    priceBand: '',
    genre: genre.name,
    brands: genre.brands.slice(0, 3),
    whyInteresting: `${type.name}の切り口で、${item}の選び方を整理する`,
    axis: compare ? type.name : '',
    slots
  }, seed);
}

function historyLines(history) {
  if (!history.length) return 'まだ投稿はありません';
  return history.slice(0, 10).map((h, i) => `${i + 1}. ${h.topic || h.title}｜ジャンル:${h.genre || '-'}｜型:${h.postType || '-'}｜対象:${h.target || '-'}｜価格:${h.priceBand || '-'}｜ブランド:${(h.brands || []).join('・') || '-'}`).join('\n');
}

function buildUserContent(seeds, history, now) {
  const lines = [`今の季節: ${seasonOf(now)}`, '', '直近の投稿（新しい順。これと重なりすぎないように）:', historyLines(history), '', '今日の3案の組み合わせ:'];
  seeds.forEach((s, i) => {
    lines.push(`案${i + 1}: ジャンル「${s.genre.name}」× 投稿の型「${s.type.name}」`);
    lines.push(`  型の考え方: ${s.type.note}`);
    if (s.genre.note) lines.push(`  ジャンルの注意: ${s.genre.note}`);
    lines.push(`  品目の候補: ${s.genre.items.join('・')}（今回目を付けたい品目: ${s.items.join('・')}）`);
    if (s.genre.brands.length) lines.push(`  ブランド例: ${s.genre.brands.join('・')}`);
    if (s.genre.pairs) lines.push(`  比較例: ${s.genre.pairs.join('・')}`);
  });
  return lines.join('\n');
}

// history: 新しい順の [{ topic, genre, postType, target, priceBand, brands }]
export async function generateIdeas({ history = [], env, deadline, now = new Date(), random = Math.random }) {
  const seeds = sampleIdeaSeeds(history, 3, random);
  try {
    const { result } = await runWithModels({
      env, deadline, system: PROMPT, userContent: buildUserContent(seeds, history, now),
      parse: (content) => {
        let data;
        try { data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]); } catch { throw new AiError('企画を読み取れませんでした'); }
        const list = Array.isArray(data.ideas) ? data.ideas : [];
        const ideas = seeds.map((seed, i) => normalizeIdea(list[i], seed) || fallbackIdea(seed));
        if (!list.length) throw new AiError('企画が空でした');
        return ideas;
      }
    });
    return { ideas: result, fallback: false };
  } catch (e) {
    console.error('[ideas] fallback:', e.message);
    return { ideas: seeds.map(fallbackIdea), fallback: true, error: e.message };
  }
}

export { POST_TYPES };
