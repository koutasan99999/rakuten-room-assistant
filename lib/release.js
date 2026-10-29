// 新商品専用の企画（new_release）：新作・予約・再販レーダーで見つけた商品から、Instagram企画のタイトルを3〜5案つくる。
// 「○○について本気出して考えてみた」は使わず、見た人が「何それ？」「欲しい！」と思う具体的なタイトルにする。
// 発売日・予約・限定・コラボなどの情報は、レーダーで確認できたもの（商品名・説明に書いてあったもの）だけを使う。
import { AiError, compact, cleanText, runWithModels } from './ai.js';
import { findRadarGenre } from './radar-genres.js';

export const MIN_TITLES = 3;
export const MAX_TITLES = 5;

// 根拠のない煽りは使わない
const HYPE_RE = /完売確実|爆売れ|史上最高|史上最強|絶対|必ず|最安|神|間違いな|売り切れ必至|今すぐ買/;

// タイトルの言葉と、それを使ってよい根拠（商品の状態・日付）
const CLAIMS = [
  { re: /予約/, ok: (p) => p.status.includes('PRE_ORDER') },
  { re: /今週発売|今週の新作/, ok: (p) => isThisWeek(p.releaseDate, p.today) },
  { re: /今日発売/, ok: (p) => p.releaseDate === p.today },
  { re: /来月発売/, ok: (p) => (p.releaseMonth || '') === monthOf(p.today, 1) },
  { re: /再販|再入荷/, ok: (p) => p.status.includes('RESTOCK') },
  { re: /限定/, ok: (p) => p.status.includes('LIMITED') || p.status.includes('SPECIAL') },
  { re: /コラボ|別注/, ok: (p) => p.status.includes('COLLAB') },
  { re: /新色/, ok: (p) => p.status.includes('NEW_COLOR') },
  { re: /発売予定|もうすぐ発売|近日発売/, ok: (p) => p.status.includes('COMING_SOON') }
];

function isoToday(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function monthOf(today, offset) {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isThisWeek(date, today) {
  if (!date) return false;
  const t = new Date(today);
  const mon = new Date(t.getTime() - ((t.getDay() + 6) % 7) * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return date >= iso(mon) && date <= iso(sun);
}

// タイトルに書いてよいか：煽りがなく、発売・予約・限定などは確認できた情報だけ
export function titleIssues(title, product) {
  const issues = [];
  if (HYPE_RE.test(title)) issues.push('根拠のない煽り');
  for (const c of CLAIMS) if (c.re.test(title) && !c.ok(product)) issues.push(`確認できていない情報（${title.match(c.re)[0]}）`);
  return issues;
}

// 雰囲気（表紙の色合いも変える）：ファッション・雑貨／家電・ガジェット／生活雑貨
export function moodOf(category) {
  const g = findRadarGenre(category);
  const group = g ? g.group : '';
  if (group === 'fashion' || ['cosme', 'perfume', 'baby', 'gift', 'accessory'].includes(category)) return 'fashion';
  if (group === 'gadget' || group === 'appliance') return 'gadget';
  return 'living';
}

const PROMPT = `あなたはInstagramアカウント「眼科医くま」の新作特集の編集者です。JSONだけを返してください。
新作・予約・再販の商品を1つ見つけました。この商品を起点にした「新商品の企画」のタイトルを${MIN_TITLES}〜${MAX_TITLES}案つくります。
「○○について本気出して考えてみた」は使いません。見た人が「何それ？」「欲しい！」「見てみたい！」と感じるタイトルにします。

タイトルの例（そのまま使わず、商品に合わせる）:
- ファッション・雑貨: 「新作バッグ、これは反則級にかわいい。」「この新色、ちょっとずるい。」「今月の新作、可愛いものだけ集めた。」
- 家電・ガジェット: 「Ankerの新作、これ待ってた。」「今月の新作ガジェット、当たり多すぎ。」「この新機能、かなり気になる。」
- 発売・予約・限定: 「今週発売、見逃したくない新作。」「今予約できる、気になる新商品12選。」「このコラボ、チェックしておきたい。」

ルール:
- 商品名・ブランド名・発売情報など、具体性を優先する
- 「ヤバ可愛い」「可愛すぎる」などは、見た目が売りの商品に合うときだけ
- 案ごとに語尾や言い回しを変える（全部「〜。」で終わる、全部「ずるい」など同じ煽りにしない）
- 「完売確実」「爆売れ」「史上最高」など根拠のない言葉は使わない
- 発売日・予約・限定・コラボ・再販・新色は、下の「確認できた情報」にあるものだけを書く。無いことは書かない
- 切り口を変える: この商品1つを主役にする／同じブランドの新作まとめ／今月・今週の新作まとめ／予約できる新作まとめ／同じジャンルの新作の比較 など
- title は32字以内

各案:
- title: タイトル
- angle: 切り口（12字以内。例: 主役の1品、ブランドの新作、今月の新作、予約できる新作）
- searchGenres: この企画で一緒に探す商品の言葉（2〜5個。楽天で検索できる名詞。新作を探すので「新作」「予約」を付けてもよい）
- why: なぜ見たくなるか（40字以内）

出力形式:
{"ideas":[{"title":"...","angle":"...","searchGenres":["..."],"why":"..."}]}`;

function cleanKeyword(k) {
  return cleanText(k).replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

// 起点の商品（レーダーの商品をクライアントから受け取る）
export function readReleaseProduct(x, now = new Date()) {
  if (!x || typeof x !== 'object' || !x.name) return null;
  const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const url = s(x.url, 300);
  const image = s(x.image, 300);
  return {
    name: s(x.name, 200), brand: s(x.brand, 30), price: Number(x.price) || 0, code: s(x.code, 80), shop: s(x.shop, 60),
    url: /^https:\/\//.test(url) ? url : '', image: /^https:\/\//.test(image) ? image : '',
    category: s(x.category, 30), categoryLabel: s(x.categoryLabel, 20),
    status: (Array.isArray(x.status) ? x.status : []).map((v) => s(v, 20)).filter(Boolean).slice(0, 8),
    releaseDate: date(x.releaseDate), releaseMonth: /^\d{4}-\d{2}$/.test(String(x.releaseMonth || '')) ? x.releaseMonth : null,
    releaseText: s(x.releaseText, 30), preorderStart: date(x.preorderStart), preorderEnd: date(x.preorderEnd),
    caption: s(x.caption, 300),
    today: isoToday(now)
  };
}

const STATUS_JA = { NEW: '新発売', COMING_SOON: '発売予定', PRE_ORDER: '予約受付中', RESTOCK: '再販・再入荷', LIMITED: '限定', COLLAB: 'コラボ', NEW_COLOR: '新色', SPECIAL: '特別販売・期間限定' };

function facts(p) {
  return [
    `商品: ${compact(p.name, 100)}`,
    p.brand && `ブランド: ${p.brand}`,
    `価格: ${p.price}円`,
    p.categoryLabel && `ジャンル: ${p.categoryLabel}`,
    `確認できた情報: ${p.status.map((s) => STATUS_JA[s] || s).join('・') || 'なし'}`,
    p.releaseDate ? `発売日: ${p.releaseDate}` : p.releaseText ? `発売: ${p.releaseText}（日付の記載なし）` : '発売日: 記載なし',
    p.preorderStart && `予約開始: ${p.preorderStart}`,
    p.preorderEnd && `予約締切: ${p.preorderEnd}`,
    `今日: ${p.today}`
  ].filter(Boolean).join('\n');
}

function normalizeIdea(x, p) {
  const title = cleanText(x && x.title).replace(/(について)?本気出して考えてみた$/, '').slice(0, 40);
  if (!title || titleIssues(title, p).length) return null;
  const searchGenres = [...new Set((Array.isArray(x.searchGenres) ? x.searchGenres : []).map(cleanKeyword).filter(Boolean))].slice(0, 5);
  return { title, angle: cleanText(x.angle).slice(0, 16), searchGenres, why: cleanText(x.why).slice(0, 60) };
}

// AIが使えないとき：確認できた状態に合わせた決まった言い回し
export function fallbackReleaseTitles(p) {
  const kind = p.categoryLabel || '新作';
  const brand = p.brand;
  const base = (p.categoryLabel || p.name.split(/\s/)[0] || '新作').slice(0, 12);
  const raw = [
    brand && { title: `${brand}の新作、これ待ってた。`, angle: 'ブランドの新作', searchGenres: [`${brand} 新作`, `${base} 新作`] },
    p.status.includes('PRE_ORDER') && { title: `今予約できる、気になる${kind}の新作。`, angle: '予約できる新作', searchGenres: [`${base} 予約`, `${base} 新作`] },
    p.status.includes('COLLAB') && { title: 'このコラボ、チェックしておきたい。', angle: 'コラボ', searchGenres: [`${base} コラボ`, `${base} 別注`] },
    p.status.includes('NEW_COLOR') && { title: 'この新色、ちょっとずるい。', angle: '新色', searchGenres: [`${base} 新色`] },
    p.status.includes('RESTOCK') && { title: '再販された、あの人気のかたち。', angle: '再販', searchGenres: [`${base} 再販`, `${base} 再入荷`] },
    isThisWeek(p.releaseDate, p.today) && { title: '今週発売、見逃したくない新作。', angle: '今週の新作', searchGenres: [`${base} 新作`] },
    { title: `今月の新作${kind}、気になるものだけ集めた。`, angle: '今月の新作', searchGenres: [`${base} 新作`, `${base} 新商品`] },
    { title: 'この新作、ちょっと見てほしい。', angle: '主役の1品', searchGenres: [`${base} 新作`] }
  ].filter(Boolean);
  return raw.filter((x) => !titleIssues(x.title, p).length).slice(0, MAX_TITLES).map((x) => ({ ...x, why: '' }));
}

export async function generateReleaseTitles({ product, env, deadline }) {
  try {
    const { result } = await runWithModels({
      env, deadline, system: PROMPT, userContent: facts(product),
      parse: (content) => {
        let data;
        try { data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]); } catch { throw new AiError('AIの応答を読み取れませんでした'); }
        const seen = new Set();
        const ideas = [];
        for (const x of Array.isArray(data.ideas) ? data.ideas : []) {
          const idea = normalizeIdea(x, product);
          if (!idea || seen.has(idea.title)) continue;
          seen.add(idea.title);
          ideas.push(idea);
          if (ideas.length >= MAX_TITLES) break;
        }
        if (ideas.length < 2) throw new AiError(`使えるタイトルが${ideas.length}案しかありませんでした`);
        return ideas;
      }
    });
    // 足りなければ予備のタイトルで3案にそろえる
    const extra = fallbackReleaseTitles(product).filter((x) => !result.some((r) => r.title === x.title));
    return { ideas: result.concat(extra).slice(0, Math.max(MIN_TITLES, result.length)), fallback: false };
  } catch (e) {
    console.error('[openai] release fallback:', e.message);
    return { ideas: fallbackReleaseTitles(product), fallback: true, error: e.message };
  }
}

// 企画の形（既存の商品探索 /api/explore にそのまま渡せる、編集済みの企画）
export function toReleaseIdea(idea, product) {
  return {
    edited: true,
    seeded: true,
    title: idea.title,
    curationType: 'new_release',
    postType: '新商品',
    seedRole: 'main',
    howUsed: '新作の主役として、この企画の先頭にのせる',
    searchGenres: idea.searchGenres,
    whyInteresting: idea.why || '',
    genre: product.categoryLabel || '',
    target: '',
    priceBand: '',
    axis: '',
    free: '新作・予約・再販など、今動いている商品を中心に選ぶ'
  };
}
