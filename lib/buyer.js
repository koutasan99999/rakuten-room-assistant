// バイヤー発掘便：「ランキングで見たことのある人気商品」ではなく「こんな商品があるなんて知らなかった」を探す。
// アプリのサーバーで動く範囲（楽天の商品検索・ランキングAPI ＋ OpenAI）で、バイヤーと企画担当の2役をこなす。
//   1. バイヤー（AI）：日常の小さな不便・時短・暮らしの小さな楽しみから、あまり知られていなさそうな「商品の種類」と楽天の検索語を考える
//   2. 楽天市場で探す。売れ筋ランキング（総合）に入っている商品・ユーザーが「知ってる」「興味なし」にした商品・紹介済みの商品は外す
//   3. バイヤー＋企画担当（AI）：候補から選び、発掘の理由・コメントと、投稿タイトル3案・刺さる人・解決する不便・カルーセル構成・紹介文を書く
// 商品名・価格・購入先・URLは楽天のデータそのもの（AIに作らせない）。知名度は「レビュー件数」と「ランキングに入っていないか」の目安で、断定しない。
// 公式サイトのURLは、ここでは探せない（検索エンジンのAPIを使わないため）。楽天の公式ショップのときだけ「公式ショップ」と表示する。
import { searchPage, nameKey } from './rakuten.js';
import { fetchRanking } from './ranking.js';
import { dedupeProducts, findBrand } from './product-analysis.js';
import { AiError, compact, cleanText, runWithModels } from './ai.js';

export const THEMES = {
  auto: 'おまかせ（暮らし全般）',
  jitan: '時短',
  stress: '日常の小さなストレス解消',
  gadget: '便利なガジェット',
  rich: '暮らしを豊かにする'
};
export const MAX_PICKS = 6;
const MAX_ANGLES = 7;

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, n, m) => (Array.isArray(v) ? v : []).map((x) => str(x, m)).filter(Boolean).slice(0, n);

// ユーザーの評価履歴（iPhone側で記録）：欲しい／知ってる／興味なし／投稿にした、と紹介済みの商品
export function readFeedback(x) {
  const f = x && typeof x === 'object' ? x : {};
  return {
    wanted: list(f.wanted, 30, 80), known: list(f.known, 120, 80), skipped: list(f.skipped, 120, 80),
    posted: list(f.posted, 60, 80), introduced: list(f.introduced, 200, 80),
    // 「知ってる」「興味なし」が多かった商品の種類（同じ種類ばかり出さないため）
    tiredKinds: list(f.tiredKinds, 20, 20), likedKinds: list(f.likedKinds, 20, 20)
  };
}

// AIが使えないときの切り口（あまり知られていなさそうな、具体的な不便から）
const FALLBACK_ANGLES = [
  { problem: 'ケーブルが机の裏に落ちる', kind: 'ケーブルホルダー', keyword: 'ケーブルホルダー マグネット 卓上' },
  { problem: '靴下が裏返しのまま洗濯に出てくる', kind: '洗濯ネット', keyword: '靴下 洗濯 ホルダー 裏返し' },
  { problem: '冷蔵庫の奥の物が取り出せない', kind: '冷蔵庫 回転トレー', keyword: '冷蔵庫 回転 トレー' },
  { problem: 'スマホを置く場所がベッドにない', kind: 'ベッド用 小物ポケット', keyword: 'ベッド サイド ポケット 収納' },
  { problem: '傘の水滴で玄関が濡れる', kind: '傘 水滴 吸収', keyword: '傘 水滴 吸水 スタンド' },
  { problem: '袋の口を何度も閉じ直すのが面倒', kind: '袋 クリップ', keyword: '袋 密閉 クリップ 注ぎ口' },
  { problem: 'レシートや紙が財布にたまる', kind: 'レシート 整理', keyword: 'レシート ホルダー 整理' },
  { problem: 'デスクのペンがすぐ転がる', kind: 'マグネット ペン立て', keyword: 'マグネット ペンホルダー デスク' },
  { problem: '片手で洗濯物を干すのが大変', kind: 'ピンチハンガー', keyword: 'ピンチハンガー 片手 外し' },
  { problem: '鍋のふたの置き場がない', kind: '鍋ふた スタンド', keyword: '鍋ふた スタンド 立てる' },
  { problem: '充電ケーブルが何本も絡まる', kind: 'ケーブル 巻き取り', keyword: 'ケーブル 巻き取り 自動' },
  { problem: '朝の歯磨き中に時間が分からない', kind: '防水 時計', keyword: '浴室 防水 時計 小型' }
];

const ANGLE_PROMPT = `あなたは「眼科医くま」の商品バイヤーです。JSONだけを返してください。
目的は「ランキングで見たことのある人気商品」ではなく、「こんな商品があるなんて知らなかった！」と思える商品の発掘です。
対象：生活を豊かにするもの、時短につながるもの、便利なガジェット、日常の小さなストレスを解消するもの。
「日常の小さな不便・面倒」を具体的に1つずつ挙げ、それを解決する「あまり知られていなさそうな商品の種類」と、楽天市場で探す検索語を考えます。
- 定番すぎる種類（モバイルバッテリー・ワイヤレスイヤホン・加湿器・電動歯ブラシ など誰でも知っているもの）は避ける
- 「知ってる」「興味なし」が多い種類は避け、「欲しい」が多い種類の近くも少し探す
- problem：具体的な場面（20字以内。例:「濡れた傘で玄関がびしょびしょ」）
- kind：商品の種類（15字以内）
- keyword：楽天で検索する言葉（名詞2〜3語をスペース区切り。ブランド名・型番は入れない）
- 切り口どうしで、場面（キッチン・デスク・玄関・洗面・寝室・外出・車 など）を散らす
出力形式: {"angles":[{"problem":"...","kind":"...","keyword":"..."}]}`;

export async function planAngles({ theme, feedback, env, deadline, random = Math.random }) {
  const userContent = [
    `テーマ: ${THEMES[theme] || THEMES.auto}`,
    `作る数: ${MAX_ANGLES}`,
    feedback.likedKinds.length ? `「欲しい」と言われた種類: ${feedback.likedKinds.join('、')}` : '',
    feedback.tiredKinds.length ? `「知ってる」「興味なし」が多かった種類（避ける）: ${feedback.tiredKinds.join('、')}` : '',
    `ばらつきのための数: ${Math.floor(random() * 1000)}`
  ].filter(Boolean).join('\n');
  try {
    const { result } = await runWithModels({
      env, deadline, system: ANGLE_PROMPT, userContent,
      parse: (c) => {
        const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
        const out = (Array.isArray(d.angles) ? d.angles : []).map((a) => ({
          problem: cleanText(a && a.problem).slice(0, 24), kind: cleanText(a && a.kind).slice(0, 16),
          keyword: cleanText(a && a.keyword).replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30)
        })).filter((a) => a.keyword && a.kind);
        if (out.length < 3) throw new AiError('切り口が足りませんでした');
        return out.slice(0, MAX_ANGLES);
      }
    });
    return { angles: result, fallback: false };
  } catch (e) {
    const pool = FALLBACK_ANGLES.filter((a) => !feedback.tiredKinds.includes(a.kind));
    const picked = [];
    while (picked.length < 6 && pool.length) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    return { angles: picked, fallback: true, error: e.message };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function seenKey(name) { return nameKey(String(name || '')).slice(0, 14); }

// 楽天で探して、ランキング上位・知ってる・興味なし・紹介済みを外す
export async function gatherCandidates({ angles, feedback, env, referer, until }) {
  const avoid = new Set([...feedback.known, ...feedback.skipped, ...feedback.posted, ...feedback.introduced].map(seenKey));
  let ranking = null;
  try {
    const r = await fetchRanking({ genre: 'other', env, referer });
    ranking = new Set(r.items.map((x) => seenKey(x.name)));
  } catch { ranking = null; }
  const found = [];
  const searched = [];
  for (const [i, a] of angles.entries()) {
    if (Date.now() + 1500 > until) break;
    await sleep(1100); // 楽天APIは1秒1回まで（ランキングの直後も含めて）
    try {
      const r = await searchPage({ keyword: a.keyword, env, referer, hits: 30 });
      let n = 0;
      for (const it of r.items) {
        const k = seenKey(it.name);
        if (avoid.has(k) || (ranking && ranking.has(k))) continue;
        found.push({ ...it, angle: i });
        if (++n >= 6) break;
      }
      searched.push({ ...a, count: n });
    } catch (e) {
      searched.push({ ...a, count: 0, error: e.message });
      if (/40[13]/.test(e.message)) break;
    }
  }
  return { items: dedupeProducts(found).items, searched, rankingChecked: !!ranking };
}

// 知名度の目安（データから。断定はしない）
export function awarenessHint(it, rankingChecked) {
  const n = it.reviewCount || 0;
  const level = n >= 3000 ? 'high' : n >= 300 ? 'mid' : 'low';
  return {
    level,
    reviewCount: n,
    rankingChecked,
    text: `${rankingChecked ? '楽天の総合ランキング上位には入っていない' : 'ランキングは確認できなかった'}・レビュー${n.toLocaleString('ja-JP')}件（知名度の目安。断定ではありません）`
  };
}

const PICK_PROMPT = `あなたたちは「眼科医くま」の商品バイヤーと企画担当です。JSONだけを返してください。
バイヤー：候補の中から「こんな商品があるなんて知らなかった！」と思える商品を最大${MAX_PICKS}個選ぶ。定番すぎる物・どこでも見る物・説明しないと用途が分からない物は選ばない。
企画担当：選んだ商品ごとに、Instagramのカルーセル投稿の案を作る。
守ること（とても大事）：
- 商品の特徴は、候補に書いてある商品名・説明だけから書く。書いていない機能・数値・素材を足さない
- 使ってみた・愛用している・買ってよかった など、体験したように書かない
- 「最安」「絶対」「必ず」「神」「バズってる」「話題沸騰」など根拠のない言葉や煽りは使わない
- 知名度は分からないので「知られていない」と断定しない（「見かけることが少ない」程度にとどめる）
- 医療・健康の効果をうたわない
各商品：
- id：候補の番号
- surprise：意外性（1〜5。こういう物があること自体を知らない人が多そうか）
- solve：不便の解決（1〜5。解決する不便がはっきりしているか）
- everyday：日常での使いやすさ（1〜5）
- reason：選んだ理由（60字以内。候補の情報にもとづいて）
- buyerComment：バイヤーのひとこと（40字以内。友だちに話す口調）
- titles：思わず見たくなる投稿タイトル3案（各24字以内。誇張しない）
- target：どんな人に刺さるか（30字以内）
- pain：どんな不便を解決するか（30字以内）
- slides：カルーセルの構成（4〜7枚。各20字以内。例:「1 表紙：○○」「2 こんな不便ありませんか」）
- intro：紹介文（120〜200字。誇張せず、候補の情報にある特徴だけで魅力を伝える。最後に「気になる人は商品ページで詳細を確認してみてください」のような一文）
出力形式: {"picks":[{"id":0,"surprise":4,"solve":5,"everyday":4,"reason":"...","buyerComment":"...","titles":["...","...","..."],"target":"...","pain":"...","slides":["..."],"intro":"..."}]}`;

const NG_RE = /最安|絶対|必ず|神|バズ|話題沸騰|爆売れ|使ってみた|愛用|買ってよかった|リピ買い|治る|効く|治療/;
const clean = (v, n) => cleanText(v).replace(/\s+/g, ' ').trim().slice(0, n);
const rate = (v) => Math.max(1, Math.min(5, Math.round(Number(v) || 3)));

export function discoveryScore({ surprise, solve, everyday }, awareness) {
  const ai = Math.round(((surprise * 0.45 + solve * 0.35 + everyday * 0.2) / 5) * 70);
  const data = (awareness.rankingChecked ? 10 : 0) + (awareness.level === 'low' ? 20 : awareness.level === 'mid' ? 10 : 0);
  return { total: Math.min(100, ai + data), ai, data };
}

export async function pickAndPlan({ items, angles, theme, env, deadline }) {
  const lines = items.slice(0, 40).map((it, i) => `${i}: ${compact(it.name, 70)} / ${it.price}円 / ${it.shop} / レビュー${it.reviewCount || 0}件 / 探した不便: ${(angles[it.angle] || {}).problem || ''} / 説明: ${compact(it.caption, 120)}`);
  const { result } = await runWithModels({
    env, deadline, system: PICK_PROMPT, userContent: `テーマ: ${THEMES[theme] || THEMES.auto}\n候補:\n${lines.join('\n')}`,
    parse: (c) => {
      const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
      const seen = new Set();
      const out = [];
      for (const x of Array.isArray(d.picks) ? d.picks : []) {
        const id = Number(x && x.id);
        if (!Number.isInteger(id) || id < 0 || id >= Math.min(items.length, 40) || seen.has(id)) continue;
        seen.add(id);
        const titles = (Array.isArray(x.titles) ? x.titles : []).map((t) => clean(t, 30)).filter((t) => t && !NG_RE.test(t)).slice(0, 3);
        const intro = clean(x.intro, 260);
        out.push({
          id, surprise: rate(x.surprise), solve: rate(x.solve), everyday: rate(x.everyday),
          reason: clean(x.reason, 80), buyerComment: NG_RE.test(x.buyerComment || '') ? '' : clean(x.buyerComment, 50),
          plan: {
            titles, target: clean(x.target, 40), pain: clean(x.pain, 40),
            slides: (Array.isArray(x.slides) ? x.slides : []).map((t) => clean(t, 30)).filter(Boolean).slice(0, 7),
            intro: NG_RE.test(intro) ? '' : intro
          }
        });
        if (out.length >= MAX_PICKS) break;
      }
      if (!out.length) throw new AiError('選べませんでした');
      return out;
    }
  });
  return result;
}

function toPick(it, angle, ai, rankingChecked, now) {
  const awareness = awarenessHint(it, rankingChecked);
  const brand = findBrand(it.name);
  const official = /公式|オフィシャル|official/i.test(it.shop || '');
  return {
    key: it.code || it.url,
    name: it.name, brand: brand ? brand.name : '', price: it.price, image: it.image, url: it.url, code: it.code, shop: it.shop,
    caption: compact(it.caption, 200),
    source: 'rakuten',
    purchase: { where: '楽天市場', status: '取得時点で楽天市場に掲載あり（在庫・価格は商品ページで確認）' },
    room: { status: 'likely', text: '楽天市場の商品なので、楽天ROOMに載せられる見込み（ROOMで商品が出るか確認してください）' },
    official: official ? { url: it.url, label: `楽天の公式ショップ（${it.shop}）` } : null,
    officialNote: official ? '' : 'メーカー公式サイトのURLは、このアプリからは探せません（未取得）',
    problem: angle ? angle.problem : '', kind: angle ? angle.kind : '',
    awareness,
    score: discoveryScore(ai || { surprise: 3, solve: 3, everyday: 3 }, awareness),
    scoreParts: ai ? { surprise: ai.surprise, solve: ai.solve, everyday: ai.everyday } : null,
    reason: ai ? ai.reason : '', buyerComment: ai ? ai.buyerComment : '',
    plan: ai ? ai.plan : null,
    fetchedAt: now.toISOString()
  };
}

export async function scout({ theme = 'auto', feedback, env, referer, startedAt = Date.now(), now = new Date() }) {
  const plan = await planAngles({ theme, feedback, env, deadline: startedAt + 15000 });
  const { items, searched, rankingChecked } = await gatherCandidates({ angles: plan.angles, feedback, env, referer, until: startedAt + 34000 });
  if (!items.length) return { picks: [], searched, notice: '新しい候補が見つかりませんでした。テーマを変えてもう一度お試しください。' };
  let picks;
  let notice = plan.fallback ? 'AIで切り口を考えられなかったため、用意してある切り口で探しました。' : '';
  try {
    const chosen = await pickAndPlan({ items, angles: plan.angles, theme, env, deadline: startedAt + 57000 });
    picks = chosen.map((c) => toPick(items[c.id], plan.angles[items[c.id].angle], c, rankingChecked, now));
  } catch (e) {
    // AIが使えないとき：発掘スコアはデータの部分だけ、企画案はなし
    picks = items.slice(0, MAX_PICKS).map((it) => toPick(it, plan.angles[it.angle], null, rankingChecked, now));
    notice = [notice, 'AIで選定・企画案を作れなかったため、見つけた候補をそのまま並べています（企画案なし）。'].filter(Boolean).join(' ');
  }
  picks.sort((a, b) => b.score.total - a.score.total);
  return { picks, searched, rankingChecked, notice };
}
