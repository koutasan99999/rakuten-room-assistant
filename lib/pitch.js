// 「社長、これどうすか？」：セレクトショップのバイヤーとして商品を探し、社長に1商品ずつプレゼンする。
//   1. バイヤー（AI）：社長の採用・不採用の履歴（理由つき）から、次に探すカテゴリーと楽天の検索語を考える
//   2. 楽天市場で探す。前に提案した商品は外す
//   3. バイヤー（AI）：候補から少数を選び、話し言葉のプレゼン・眼科医くまに合う理由・弱点を書く
// 商品名・価格・送料・写真・URLは楽天のデータそのもの（AIに作らせない）。
// ROOM紹介文（generateIntros）とInstagramの特集原稿（featurePlan）は、社長がボタンを押した商品だけ作る（料金を抑える）。
import { searchPage, nameKey, lookupItem } from './rakuten.js';
import { dedupeProducts, findBrand } from './product-analysis.js';
import { AiError, compact, cleanText, runWithModels } from './ai.js';
import { PITCH_SEED } from './pitch-seed.js';
import { bestMatch } from './product-match.js';
import { normalizeRecent, chooseTargets, classify, orderForDiversity, majorName, subName } from './pitch-genres.js';
import { sameish } from './expand.js';

export const CATEGORIES = ['服', '靴', '香り', 'インテリア', '雑貨', 'ガジェット', 'ギフト'];
export const MAX_PITCHES = 3;
const MAX_QUERIES = 4;

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const clean = (v, n) => cleanText(v).replace(/\s+/g, ' ').trim().slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seenKey = (name) => nameKey(String(name || '')).slice(0, 14);

// 体験の記述・根拠のない断定・医療の効果は使わない（ブランドのルール）
export const NG_RE = /最安|絶対|必ず|神アイテム|バズ|話題沸騰|爆売れ|使ってみた|使ってます|愛用|買ってよかった|リピ買い|治る|効く|治療|眼科医が(勧|すすめ|おすすめ)/;

const BUYER_POLICY = `お客様像（社長の基準）：
- 落ち着いているが、無難ではない30代男性。柄物、素材感、個性的なデザインも歓迎
- 扱う分野：服、靴、香り、インテリア、雑貨、ガジェット、ギフト（女性へのプレゼント、男性が欲しいプレゼントも対象）
- 珍しいだけ、安いだけの商品は優先しない。社長自身が欲しくなるか、を一番に考える
- 医薬品・医療機器・健康食品・メガネ・コンタクトなど、眼科医が勧めているように受け取られる商品は扱わない`;

// 社長の採用・保留・不採用の履歴（理由つき）を、AIに渡す形にまとめる
export function readTaste(x) {
  const t = x && typeof x === 'object' ? x : {};
  const hist = (Array.isArray(t.history) ? t.history : []).slice(0, 40).map((h) => ({
    status: ['adopt', 'hold', 'reject'].includes(h && h.status) ? h.status : '',
    name: str(h && h.name, 60), brand: str(h && h.brand, 30), category: str(h && h.category, 10),
    price: Number(h && h.price) || 0, reason: str(h && h.reason, 80)
  })).filter((h) => h.status && h.name);
  return { history: hist, note: str(t.note, 200) };
}

function tasteLines(taste) {
  const label = { adopt: '採用', hold: '保留', reject: '不採用' };
  return taste.history.map((h) => `${label[h.status]}: ${h.name}${h.brand ? `（${h.brand}）` : ''} / ${h.category} / ${h.price}円${h.reason ? ` / 理由: ${h.reason}` : ''}`);
}

// 社長が登録した参考アカウントの調査のまとめ（テーマ・視聴者に届く切り口・学べる点）
export function readRefs(x) {
  return (Array.isArray(x) ? x : []).slice(0, 8).map((r) => ({
    handle: str(r && r.handle, 30),
    themes: (Array.isArray(r && r.themes) ? r.themes : []).map((t) => str(t, 40)).filter(Boolean).slice(0, 4),
    angles: (Array.isArray(r && r.angles) ? r.angles : []).map((t) => str(t, 100)).filter(Boolean).slice(0, 3)
  })).filter((r) => r.handle && (r.themes.length || r.angles.length));
}
function refLines(refs) {
  return (refs || []).map((r) => `@${r.handle}：テーマ ${r.themes.join('・') || '不明'}${r.angles.length ? ` ／ この視聴者に届く切り口 ${r.angles.join('／')}` : ''}`);
}

// 前に提案した商品（商品番号と商品名）
export function readExclude(x) {
  const e = x && typeof x === 'object' ? x : {};
  const codes = (Array.isArray(e.codes) ? e.codes : []).map((c) => str(c, 120)).filter(Boolean).slice(0, 600);
  const names = (Array.isArray(e.names) ? e.names : []).map((c) => str(c, 120)).filter(Boolean).slice(0, 600);
  return { codes: new Set(codes), names: new Set(names.map(seenKey)) };
}

const FALLBACK_QUERIES = [
  { category: '服', keyword: 'オープンカラーシャツ 柄 メンズ', angle: '落ち着いた色の柄シャツ' },
  { category: '靴', keyword: 'スエード ローファー メンズ', angle: '素材感のある革靴' },
  { category: '香り', keyword: 'ルームフレグランス ウッド', angle: '部屋の香り' },
  { category: 'インテリア', keyword: 'デスクライト 真鍮', angle: '素材が良い照明' },
  { category: '雑貨', keyword: 'レザー キーケース 経年変化', angle: '育つ革小物' },
  { category: 'ガジェット', keyword: 'アルミ スマホスタンド デザイン', angle: '机に置いて絵になるガジェット' },
  { category: 'ギフト', keyword: 'ハンドクリーム ギフト 女性', angle: '女性へのちょっとした贈り物' }
];

const PLAN_PROMPT = `あなたはセレクトショップのバイヤーです。社長（オーナー）に1商品ずつプレゼンする商品を、楽天市場で探します。JSONだけを返してください。
${BUYER_POLICY}
社長の採用・保留・不採用の履歴と理由から、好みを読み取って次に探す方向を決めます。
- 1件の採用・不採用だけで「黒が好き」「高級品が好き」などと決めつけない。理由に書かれたこと（素材、柄、使う場面、価格への納得感など）を手がかりにする
- 好みに寄せる方向を半分、まだ試していない分野を半分にする（同じ分野ばかりにしない）
- base（「もっと見せて」の元の商品）があるときは、似た商品・ひとつ上のブランド・価格違いの3方向で探す
- keyword：楽天で検索する言葉（名詞2〜4語をスペース区切り。型番は入れない。ブランド名は上のブランドを探すときだけ）
- angle：探す方向のひとこと（20字以内）
- taste：今の好みの読み取り（80字以内。履歴が少ないときは「まだ判断できない」と書く。断定しない）
出力形式: {"queries":[{"category":"服","keyword":"...","angle":"..."}],"taste":"..."}`;

export async function planQueries({ taste, refs = [], base, env, deadline, random = Math.random }) {
  const userContent = [
    `作る数: ${MAX_QUERIES}`,
    `分野: ${CATEGORIES.join('・')}`,
    taste.history.length ? `履歴:\n${tasteLines(taste).join('\n')}` : '履歴: まだありません',
    taste.note ? `前回の好みの読み取り: ${taste.note}` : '',
    refs.length ? `社長が参考にしているアカウント（その視聴者にも届く商品を、探す方向の一部にする。まねはしない）:\n${refLines(refs).join('\n')}` : '',
    base ? `base（もっと見せて）: ${base.name} / ${base.brand || 'ブランド不明'} / ${base.category} / ${base.price}円` : '',
    `ばらつきのための数: ${Math.floor(random() * 1000)}`
  ].filter(Boolean).join('\n');
  try {
    const { result } = await runWithModels({
      env, deadline, system: PLAN_PROMPT, userContent,
      parse: (c) => {
        const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
        const qs = (Array.isArray(d.queries) ? d.queries : []).map((q) => ({
          category: CATEGORIES.includes(q && q.category) ? q.category : '雑貨',
          keyword: clean(q && q.keyword, 40).replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim(),
          angle: clean(q && q.angle, 24)
        })).filter((q) => q.keyword);
        if (qs.length < 2) throw new AiError('探す方向が足りませんでした');
        return { queries: qs.slice(0, MAX_QUERIES), taste: clean(d.taste, 100) };
      }
    });
    return { ...result, fallback: false };
  } catch (e) {
    const pool = base
      ? [{ category: base.category || '雑貨', keyword: compact(base.name, 20), angle: '似た商品' }]
      : [...FALLBACK_QUERIES];
    const picked = [];
    while (picked.length < 3 && pool.length) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    return { queries: picked, taste: '', fallback: true, error: e.message };
  }
}

// 楽天で探して、前に提案した商品を外す
export async function gather({ queries, exclude, env, referer, until, perQuery = 6 }) {
  const found = [];
  const searched = [];
  for (const [i, q] of queries.entries()) {
    if (Date.now() + 1500 > until) break;
    if (i > 0) await sleep(1100); // 楽天APIは1秒1回まで
    try {
      const r = await searchPage({ keyword: q.keyword, env, referer, hits: 30 });
      let n = 0;
      for (const it of r.items) {
        if (exclude.codes.has(it.code) || exclude.names.has(seenKey(it.name))) continue;
        found.push({ ...it, query: i });
        if (++n >= perQuery) break;
      }
      searched.push({ ...q, count: n });
    } catch (e) {
      searched.push({ ...q, count: 0, error: e.message });
      if (/40[13]/.test(e.message)) break;
    }
  }
  return { items: dedupeProducts(found).items, searched };
}

const PITCH_PROMPT = `あなたはセレクトショップのバイヤーです。社長に「社長、これどうすか？」と1商品ずつプレゼンします。JSONだけを返してください。
${BUYER_POLICY}
守ること（とても大事）：
- 商品の特徴は、候補に書いてある商品名・説明・メモだけから書く。書いていない機能・数値・素材・受賞歴を足さない
- 使ってみた・愛用している・買ってよかった など、体験したように書かない
- 「最安」「絶対」「必ず」「神」「バズってる」「話題沸騰」など、根拠のない言葉や煽りは使わない
- 医療・健康の効果をうたわない。眼科医が勧めているように書かない
- 社長の履歴に合わせるが、決めつけない
各商品：
- id：候補の番号
- brand：ブランド名（商品名・説明に書いてあるときだけ。分からなければ空）
- category：服・靴・香り・インテリア・雑貨・ガジェット・ギフトのどれか
- pitch：プレゼン（100〜200字。「社長、」で始める自然な話し言葉。堅い説明ではなく、欲しくなるポイント（見た目・素材・使う場面・誰に贈るか）を具体的に。
  何が面白い商品か・どんな人に向くか・ほかの商品と何が違うか・なぜ社長に紹介する価値があるか、が伝わるように）
- point：商品の特徴（40字以内。候補の商品名・説明に書いてあることだけ）
- title：この商品で作る企画のタイトル（20字以内。誇張しない）／who：想定ターゲット（30字以内）
- revenue：収益につながる仮説（50字以内。例：贈り物の予算5千円帯で、ROOMで比べて買う人が多そう。仮説として書き、断定しない）
- score：推奨度1〜5（新しさ・意外性・実用性・デザイン・価格の納得感から）／scoreWhy：その理由（40字以内）
- fit：この商品が眼科医くまに合う理由（60字以内）
- caution：買う前の弱点や注意点（60字以内。サイズ・手入れ・好みが分かれる点・説明だけでは分からない点など。必ず書く）
出力形式: {"picks":[{"id":0,"brand":"","category":"雑貨","pitch":"社長、...","point":"...","fit":"...","caution":"...","title":"...","who":"...","revenue":"...","score":4,"scoreWhy":"..."}]}`;

function readPicks(d, items, limit) {
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(d.picks) ? d.picks : []) {
    const id = Number(x && x.id);
    if (!Number.isInteger(id) || id < 0 || id >= items.length || seen.has(id)) continue;
    const pitch = clean(x.pitch, 240);
    const fit = clean(x.fit, 80);
    const caution = clean(x.caution, 80);
    if (pitch.length < 40 || !caution || NG_RE.test(pitch) || NG_RE.test(fit) || NG_RE.test(caution)) continue;
    seen.add(id);
    const point = clean(x.point, 60);
    const plan = { title: clean(x.title, 24), who: clean(x.who, 40), revenue: clean(x.revenue, 70), score: Math.max(0, Math.min(5, Math.round(Number(x.score) || 0))), scoreWhy: clean(x.scoreWhy, 60) };
    ['title', 'who', 'revenue', 'scoreWhy'].forEach((k) => { if (NG_RE.test(plan[k])) plan[k] = ''; });
    out.push({ id, brand: clean(x.brand, 30), category: CATEGORIES.includes(x.category) ? x.category : '', pitch, fit, caution, point: NG_RE.test(point) ? '' : point, plan });
    if (out.length >= limit) break;
  }
  return out;
}

export async function writePitches({ items, taste, choose, env, deadline, diverse = false }) {
  const lines = items.slice(0, 45).map((it, i) => `${i}: ${it.major ? `［${majorName(it.major)}／${subName(it.major, it.sub)}］ ` : ''}${compact(it.name, 80)} / ${it.price}円${it.postage ? `（${it.postage}）` : ''} / ${it.shop} / レビュー${it.reviewCount || 0}件${it.note ? ` / メモ: ${it.note}` : ''} / 説明: ${compact(it.caption, 160)}`);
  const limit = choose || items.length;
  const { result } = await runWithModels({
    env, deadline, system: PITCH_PROMPT,
    userContent: [
      choose ? `候補から、社長が欲しくなりそうな商品を最大${choose}個選んでプレゼンしてください。珍しいだけ・安いだけの商品は選ばない。` : '候補のすべてについてプレゼンを書いてください（ふさわしくない商品は省いてよい）。',
      diverse ? '選ぶ商品は［ ］の大分類がすべて違うものにする（同じジャンルを続けて見せない）。新しさ・意外性・実用性・デザイン・価格帯も考える。社長の履歴は商品の質を判断する手がかりで、「採用された分類だから同じ分類を選ぶ」理由にはしない。魅力のない商品で数を合わせない' : '',
      taste.history.length ? `社長の履歴:\n${tasteLines(taste).join('\n')}` : '',
      `候補:\n${lines.join('\n')}`
    ].filter(Boolean).join('\n'),
    parse: (c) => {
      const out = readPicks(JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]), items.slice(0, 45), limit);
      if (!out.length) throw new AiError('プレゼンを書けませんでした');
      return out;
    }
  });
  return result;
}

export function toPitch(it, ai, extra, now) {
  const brand = ai.brand || (findBrand(it.name) || {}).name || '';
  return {
    key: it.code || it.url,
    code: it.code, name: it.name, brand, price: it.price, postage: it.postage || '', url: it.url, image: it.image, shop: it.shop,
    caption: compact(it.caption, 300),
    category: ai.category || extra.category || '',
    pitch: ai.pitch, fit: ai.fit, caution: ai.caution, feature: ai.point || '',
    planTitle: (ai.plan && ai.plan.title) || '', who: (ai.plan && ai.plan.who) || '', revenue: (ai.plan && ai.plan.revenue) || '', score: (ai.plan && ai.plan.score) || 0, scoreWhy: (ai.plan && ai.plan.scoreWhy) || '',
    // 楽天のデータで確認できた情報（AIが作ったものではない）
    verified: { price: it.price || 0, url: it.url || '', reviewCount: it.reviewCount || 0, reviewAverage: it.reviewAverage || 0, shop: it.shop || '', at: now.toISOString() },
    major: extra.major || '', sub: extra.sub || '', genre: extra.major ? `${majorName(extra.major)}／${subName(extra.major, extra.sub)}` : '',
    angle: extra.angle || '', origin: extra.origin || 'scout',
    fetchedAt: now.toISOString()
  };
}

// ---- いろいろなジャンルから探す（通常のプレゼン）----
// 1. 次に探す分類をコードで選ぶ（直近4件の大分類を外し、長く出していない分類を優先。採用率では選ばない）
// 2. AIが分類ごとに、新しさ・意外性・実用性・デザインのある商品が見つかる検索語を決める（1つは一覧にない新しい分類でもよい）
// 3. 楽天で探し、商品名から分類を決め直す（検索語ではなく「何の商品か」）
// 4. AIが選んでプレゼンを書く（大分類が違うものを選ぶ）→ コードで並べ方を確認し、続けて同じ分類になる商品は外す（理由を残す）
const DIVERSE_PROMPT = `あなたはセレクトショップのバイヤーです。社長に、いろいろなジャンルから「知らなかった」と思える商品をプレゼンするため、楽天市場の検索語を決めます。JSONだけを返してください。
${BUYER_POLICY}
- 指定された分類ごとに1つ、keyword（名詞2〜4語。型番なし）と angle（探す方向のひとこと20字以内）を決める。sub は分類の候補から選ぶ
- 定番の売れ筋そのものではなく、新しさ・意外性・実用性・デザイン性・素材のどれかで「おっ」と思える商品が見つかる言葉にする
- 指定の分類に加えて、一覧にない新しい分類を1つ提案してよい（major は "new:分類名"、sub は "new:細分類名"）。直近の分類と重ならないこと
出力形式: {"queries":[{"major":"kitchen","sub":"coffee","keyword":"...","angle":"..."}],"taste":"今の好みの読み取り（80字以内。まだ分からなければそう書く）"}`;

export async function planDiverse({ recent, taste, count = 6, env, deadline, random = Math.random }) {
  const targets = chooseTargets(recent, { count, random });
  const last4 = new Set(recent.slice(-4).map((h) => h.major));
  let ai = { queries: [], taste: '' };
  try {
    const { result } = await runWithModels({
      env, deadline, system: DIVERSE_PROMPT,
      userContent: [
        `探す分類:\n${targets.map((t) => `${t.major}（${t.majorName}）: sub の候補 ${t.subOptions.join('／')}（優先: ${t.sub}）`).join('\n')}`,
        `直近のプレゼンの分類（古い順）: ${recent.slice(-10).map((h) => `${majorName(h.major)}／${subName(h.major, h.sub)}`).join(' → ') || 'なし'}`,
        taste.history.length ? `社長の採用・不採用の理由（商品の質を判断する手がかり。ジャンル選びには使わない）:\n${tasteLines(taste).slice(0, 15).join('\n')}` : '',
        `ばらつきのための数: ${Math.floor(random() * 1000)}`
      ].filter(Boolean).join('\n'),
      parse: (c) => {
        const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
        const qs = (Array.isArray(d.queries) ? d.queries : []).map((q) => ({ major: str(q && q.major, 40), sub: str(q && q.sub, 40), keyword: clean(q && q.keyword, 40).replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim(), angle: clean(q && q.angle, 24) })).filter((q) => q.keyword);
        if (!qs.length) throw new AiError('検索語を決められませんでした');
        return { queries: qs, taste: clean(d.taste, 100) };
      }
    });
    ai = result;
  } catch (e) { ai.error = e.message; }
  // 分類ごとの検索語（AIの言葉がなければ、用意してある言葉）
  const queries = targets.map((t) => {
    const q = ai.queries.find((x) => x.major === t.major);
    return { major: t.major, sub: q && q.sub && t.subOptions.some((o) => o.startsWith(q.sub + '=')) ? q.sub : t.sub, keyword: q ? q.keyword : t.seedKeyword, angle: q ? q.angle : t.subName, category: '' };
  });
  // 一覧にない新しい分類（直近と重ならないものを1つだけ）
  const fresh = ai.queries.find((x) => /^new:/.test(x.major) && !last4.has(x.major));
  if (fresh) queries.push({ major: fresh.major, sub: /^new:/.test(fresh.sub) ? fresh.sub : fresh.major, keyword: fresh.keyword, angle: fresh.angle || '新しい分類', category: '' });
  return { queries, taste: ai.taste, fallback: !ai.queries.length, error: ai.error };
}

// want：1回に出す企画の数（標準8・5〜10）。分類は want＋1（最大10）を探す。良い候補が足りなければ少なく返し、理由を残す
export async function scoutDiverse({ taste, recent, exclude, want = 8, env, referer, startedAt = Date.now(), now = new Date() }) {
  const n = Math.max(5, Math.min(10, Number(want) || 8));
  const plan = await planDiverse({ recent, taste, count: Math.min(10, n + 1), env, deadline: startedAt + 14000 });
  const { items, searched } = await gather({ queries: plan.queries, exclude, env, referer, until: startedAt + 32000, perQuery: 4 });
  // 商品名から分類を決め直す（検索語の分類と違う商品もある。例：「ギフト」で探して香水が出る）。直近と同じ・ほぼ同じ商品は外す
  const recentNames = recent.map((h) => h.name);
  const tagged = items.map((it) => { const q = plan.queries[it.query] || {}; const c = classify(it.name); return { ...it, major: c ? c.major : q.major, sub: c ? c.sub : q.sub }; })
    .filter((it) => !recentNames.some((n) => sameish(n, it.name)));
  if (!tagged.length) return { items: [], searched, taste: plan.taste, notice: '新しい候補が見つかりませんでした。もう一度お試しください。' };
  let chosen;
  try {
    chosen = await writePitches({ items: tagged, taste, choose: n + 1, env, deadline: startedAt + 57000, diverse: true });
  } catch (e) {
    return { items: [], searched, taste: plan.taste, notice: 'AIでプレゼンを書けませんでした。少し時間をおいてもう一度お試しください。', detail: e.message };
  }
  const picks = [];
  chosen.forEach((c) => { const it = tagged[c.id]; if (!picks.some((p) => sameish(p.it.name, it.name))) picks.push({ c, it, major: it.major, sub: it.sub, name: it.name }); });
  const ordered = orderForDiversity(recent, picks);
  const out = ordered.items.slice(0, n).map((p) => {
    const q = plan.queries[p.it.query] || {};
    return toPitch(p.it, p.c, { category: p.c.category, angle: `${majorName(p.major)}／${subName(p.major, p.sub)}${q.angle ? '：' + q.angle : ''}`, origin: 'scout', major: p.major, sub: p.sub }, now);
  });
  const notice = [
    plan.fallback ? 'AIで検索語を決められなかったため、分類ごとに用意してある言葉で探しました' : '',
    ordered.dropped.length ? `ジャンルが続くため見送った商品：${ordered.dropped.length}件` : '',
    !out.length ? '続けて同じジャンルにならない良い候補が見つかりませんでした（質の低い商品で数を合わせていません）' : out.length < n ? `${n}件の予定のうち${out.length}件でした（ジャンルが重なる・魅力の弱い候補は数合わせに使っていません）` : ''
  ].filter(Boolean).join('。');
  return { items: out, searched, taste: plan.taste, notice, dropped: ordered.dropped, targets: plan.queries.map((q) => `${majorName(q.major)}／${subName(q.major, q.sub)}`) };
}

// 新しく探す（base があれば「もっと見せて」＝その商品の近くを探す。base がなければ、いろいろなジャンルから）
export async function scout({ taste, refs = [], exclude, base = null, recent = null, want = 8, env, referer, startedAt = Date.now(), now = new Date() }) {
  if (!base && recent) return scoutDiverse({ taste, recent: normalizeRecent(recent), exclude, want, env, referer, startedAt, now });
  const plan = await planQueries({ taste, refs, base, env, deadline: startedAt + 14000 });
  const { items, searched } = await gather({ queries: plan.queries, exclude, env, referer, until: startedAt + 26000 });
  if (!items.length) return { items: [], searched, taste: plan.taste, notice: '新しい候補が見つかりませんでした。もう一度お試しください。' };
  let chosen;
  try {
    chosen = await writePitches({ items, taste, choose: MAX_PITCHES, env, deadline: startedAt + 57000 });
  } catch (e) {
    return { items: [], searched, taste: plan.taste, notice: 'AIでプレゼンを書けませんでした。少し時間をおいてもう一度お試しください。', detail: e.message };
  }
  const out = chosen.map((c) => {
    const it = items[c.id];
    const q = plan.queries[it.query] || {};
    return toPitch(it, c, { category: q.category, angle: base ? `もっと見せて：${q.angle || ''}` : q.angle, origin: base ? 'more' : 'scout' }, now);
  });
  return { items: out, searched, taste: plan.taste, notice: plan.fallback ? 'AIで探す方向を決められなかったため、用意してある方向で探しました。' : '' };
}

// 初期候補：これまでに発掘・調査した商品を楽天で探し直して、プレゼンを書く
export async function seed({ exclude, env, referer, startedAt = Date.now(), now = new Date(), list = PITCH_SEED }) {
  const found = [];
  const missing = [];
  for (const [i, s] of list.entries()) {
    if (Date.now() + 1500 > startedAt + 22000) { missing.push(s.keyword); continue; }
    if (i > 0) await sleep(1100);
    try {
      const r = await searchPage({ keyword: s.keyword, env, referer, hits: 10 });
      // 先頭の商品をそのまま使わず、探している商品らしいもの（型番・ブランド・名前の言葉が合う、付属品ではない）を選ぶ
      const hit = bestMatch({ name: s.keyword }, r.items.filter((x) => !exclude.codes.has(x.code) && !exclude.names.has(seenKey(x.name))));
      if (hit) found.push({ ...hit.it, note: s.note, seedCategory: s.category, matchNote: hit.note }); else missing.push(s.keyword);
    } catch (e) {
      missing.push(s.keyword);
      if (/40[13]/.test(e.message)) break;
    }
  }
  if (!found.length) return { items: [], missing, notice: '楽天で初期候補を見つけられませんでした。' };
  const pitched = await writePitches({ items: found, taste: { history: [] }, choose: 0, env, deadline: startedAt + 57000 });
  const items = pitched.map((c) => toPitch(found[c.id], c, { category: found[c.id].seedCategory, angle: `これまでに発掘した商品（${found[c.id].matchNote}）`, origin: 'seed' }, now));
  return { items, missing };
}

// 登録前の確認：今の価格・送料・掲載を楽天で確かめる
export async function verify({ code, price, env, referer }) {
  const it = await lookupItem({ code, env, referer });
  if (!it) return { found: false, message: '楽天で商品が見つかりませんでした（販売終了・在庫切れの可能性）。商品ページで確認してください。' };
  const changed = Number(price) > 0 && it.price !== Number(price);
  return {
    found: true, price: it.price, postage: it.postage || '', url: it.url, name: it.name, caption: compact(it.caption, 300),
    priceChanged: changed,
    message: changed ? `価格が変わっています（${Number(price).toLocaleString('ja-JP')}円 → ${it.price.toLocaleString('ja-JP')}円）` : '価格と掲載を確認しました'
  };
}

const FEATURE_PROMPT = `あなたは「眼科医くま」のInstagram企画担当です。社長が「看板商品」に選んだ商品で、特集企画とカルーセルの原稿を作ります。JSONだけを返してください。
守ること：
- 商品の特徴は、渡された商品名・説明・プレゼンの内容だけ。書いていない機能・数値を足さない
- 体験したように書かない。根拠のない断定・煽り・医療の効果は使わない。眼科医が勧めているように書かない
- PR表記：表紙と、キャプションの1行目に「【PR】楽天アフィリエイトを利用しています」を入れる
- 表紙の1行目は、誰の・どんな場面か（検索されそうな具体的な言葉）が分かるように
- ハッシュタグは5個まで
出力形式: {"title":"特集のタイトル（24字以内）","target":"誰に向けた特集か（30字以内）","slides":["1 表紙：...","2 ...","..."],"caption":"キャプション全文","hashtags":["#...","#..."]}`;

export async function featurePlan({ product, env, deadline }) {
  const userContent = `商品: ${compact(product.name, 100)} / ${product.brand || ''} / ${product.price}円 / ${product.category || ''}\nプレゼン: ${compact(product.pitch, 240)}\n合う理由: ${compact(product.fit, 80)}\n注意点: ${compact(product.caution, 80)}\n説明: ${compact(product.caption, 240)}`;
  const { result } = await runWithModels({
    env, deadline, system: FEATURE_PROMPT, userContent,
    parse: (c) => {
      const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
      const slides = (Array.isArray(d.slides) ? d.slides : []).map((s) => clean(s, 60)).filter(Boolean).slice(0, 10);
      let caption = cleanText(d.caption).trim().slice(0, 1500);
      if (!slides.length || !caption) throw new AiError('原稿を作れませんでした');
      if (NG_RE.test(caption) || slides.some((s) => NG_RE.test(s))) throw new AiError('使えない表現が入っていました');
      if (!/^【PR】/.test(caption)) caption = `【PR】楽天アフィリエイトを利用しています\n${caption}`;
      const hashtags = (Array.isArray(d.hashtags) ? d.hashtags : []).map((h) => str(h, 30).replace(/^#?/, '#')).filter((h) => h.length > 1 && !/^#PR$/i.test(h)).slice(0, 5);
      return { title: clean(d.title, 30), target: clean(d.target, 40), slides, caption, hashtags };
    }
  });
  return result;
}
