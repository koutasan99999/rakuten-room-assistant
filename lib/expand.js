// 「この商品から広げる」：1つの商品を起点に、関連する実在の商品を楽天で探す（何段階でも続けられる）。
//   1. 探し方（6種類）に合わせて、AIが楽天で探す検索語を決める（価格の上下限・ブランドの条件はコードで決める）
//   2. 楽天で探す（1語1回。1秒1回まで）
//   3. AIが候補から5〜8点を選び、元の商品との関係（似ている点・違う点・合わせる理由）を書く
//   4. コードで確認：価格・URL・画像のない商品、同じ・ほぼ同じ商品、起点の商品と探索の途中の商品を外す。価格帯（高・中・低）を付ける
// 商品名・価格・URL・画像・レビュー件数は楽天のデータそのもの（AIに作らせない）。「人気」はレビュー件数など確認できる数字があるときだけ。
import { searchPage, nameKey } from './rakuten.js';
import { AiError, compact, cleanText, runWithModels } from './ai.js';
import { findBrand, findKind, mentionsBrand } from './product-analysis.js';
import { classify, MAJORS } from './pitch-genres.js';

export const MODES = {
  cheaper: '似たデザインでもっと安い',
  brand: '同じブランドの別商品',
  same_price: '同じ価格帯の他ブランド',
  coord: 'コーディネート・組み合わせ',
  accessory: '小物・周辺アイテム',
  omakase: 'テーマで広げる（おまかせ）'
};
// 探索カテゴリー（1つの商品が、どの比較軸で見つかったか）。おまかせは軸を混ぜる
export const AXES = {
  brand: '同ブランド・同系統', same_line: '同ブランド・同系統', cheaper: '安い代替', same_price: '同価格帯の他ブランド',
  coord: 'コーデ・組み合わせ', accessory: '関連小物', unexpected: '意外な関連',
  similar: '比較候補（同じジャンル）', related: '関連用品', scene: '利用シーン'
};
// テーマで広げる（おまかせ）：起点と同じ種類の商品は少しだけ（社長の指示 2026-11-10：フライパンから広げたら、別のフライパンより関連する便利グッズ・キッチン用品を）
// 同じ種類は2点まで。ただし有名ブランド（商品名からブランドが分かるもの）の定番は、合わせて3点まで
export const SIMILAR_MAX = 2;
export const SIMILAR_BRAND_MAX = 3;
// 同じ細かい分類（例：キッチン／調理道具）は3点まで（1つの分野に偏らせない）
export const PER_SUB_MAX = 3;
const THEME_AXES = ['similar', 'related', 'scene', 'unexpected'];
// 確認できないランキング・売上の主張（楽天のランキングはこの探索では確認していない）
const RANK_RE = /\d+\s*位|No\.?\s*1|ナンバーワン|売上(げ)?(No|1|一)|ランキング(上位|入り|常連)|人気(No|1|一)/i;
// おまかせ（ミックス）の配分の目安（固定ではない。商品数と品質でAIが調整する）
export const MIX_PLAN = '同ブランド・同系統3、安い代替2、同価格帯の他ブランド2、コーデ・関連小物2（合計9前後）';
export const MIN_RESULTS = 5;
export const MAX_RESULTS = 10;
// 1回に出せる上限（社長の指示 2026-11-10：最初も追加も10件以上）
export const MAX_WANT = 15;

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const clean = (v, n) => cleanText(v).replace(/\s+/g, ' ').trim().slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NG_RE = /最安|絶対|必ず|神アイテム|バズ|話題沸騰|爆売れ|使ってみた|使ってます|愛用|買ってよかった|リピ買い|治る|効く|治療|眼科医が(勧|すすめ|おすすめ)/;
const kw = (v) => clean(v, 40).replace(/[「」『』"'、。,.!?！？()（）]/g, ' ').replace(/\s+/g, ' ').trim();

export function readBase(x) {
  const p = x && typeof x === 'object' ? x : {};
  return {
    key: str(p.key || p.code || p.url, 200), code: str(p.code, 120), name: str(p.name, 200), brand: str(p.brand, 40), price: Number(p.price) || 0,
    url: str(p.url, 400), image: str(p.image, 400), shop: str(p.shop, 60), caption: str(p.caption, 300), category: str(p.category, 10)
  };
}
// 探索の途中の商品（起点 → … → 今の商品）。AIに経路を渡し、同じ商品を出さないために使う
export function readPath(x) {
  return (Array.isArray(x) ? x : []).slice(-8).map((p) => ({ name: str(p && p.name, 80), code: str(p && p.code, 120), mode: MODES[p && p.mode] ? p.mode : '' })).filter((p) => p.name);
}

const PLAN_PROMPT = `あなたは「眼科医くま」のバイヤーです。社長が選んだ商品を起点に、楽天市場で関連する「具体的な商品」を探すための検索語を決めます。JSONだけを返してください。
お客様像：落ち着いているが無難ではない30代男性（本人用と贈り物）。医薬品・医療機器・健康食品・メガネ・コンタクトは扱わない。
- keyword：楽天で探す検索語（名詞2〜4語。型番は入れない。色・素材・形など、起点の商品のデザインの特徴を入れてよい）
- label：その検索で探すもの（10字以内。例：カーゴパンツ／白スニーカー／レザートート）
- 一般論ではなく、実際に売っている商品が見つかる検索語にする
探し方ごとの決まり：
- cheaper（似たデザインでもっと安い）：起点と同じ種類の商品。デザイン・素材・形の特徴を検索語に入れる。3語まで（言い方を変える）
- brand（同じブランドの別商品）：検索語の最初にブランド名。同じ種類と、ブランドの別の種類。3語まで
- same_price（同じ価格帯の他ブランド）：起点と同じ種類の商品。起点のブランド名は入れない。3語まで
- coord（コーディネート・組み合わせ）：起点と組み合わせるアイテム（服なら、パンツ・靴・バッグ・時計・帽子など。服以外なら一緒に使う物）を4〜5語。looks に、組み合わせの案を2つ（name：案の名前／concept：どう合わせるか40字以内／labels：使う label）
- accessory（小物・周辺アイテム）：起点と同じ人・同じ場面で使う、別の分野の小物を5語（例：Tシャツ→サングラス・バッグ／デスクライト→ケーブル整理・デスクマット）
- omakase（テーマで広げる）：起点と同じ種類の商品ばかりにしない。起点の用途・利用シーン・関連ジャンル・投稿企画まで広げる
  themes：起点から発想した投稿企画を2〜3（title 20字以内。例：キャンプ初心者セット／秋冬キャンプ用品／防災にも使えるキャンプ用品。angle：どんな人に何を伝える企画か40字以内）
  queries：8語。axis=similar（起点と同じ種類の比較候補。有名ブランドの定番・高評価など、比べる意味のある商品が見つかる語）は1語だけ。
  残り7語は axis=related（一緒に使う関連用品・便利グッズ）／scene（同じ場所・同じ場面で使う別ジャンル）／unexpected（意外だが関係を説明できる商品）を混ぜ、起点とちがう種類の商品にする。7語はすべて別の種類にする。各語に theme（themes の番号）
  例：フライパンから広げる → フライパン用のふた／油はねガード／シリコントング／鍋敷き／フライパン収納ラック／キッチンペーパーホルダー／スパイスラック（同じキッチンで使う便利グッズ。別のフライパンは1語だけ）
出力形式: {"themes":[{"title":"...","angle":"..."}],"queries":[{"keyword":"...","label":"...","axis":"related","theme":0,"why":"..."}],"looks":[{"name":"...","concept":"...","labels":["..."]}]}`;

const PICK_PROMPT = `あなたは「眼科医くま」のバイヤーです。起点の商品から広げて見つけた楽天の候補から、社長に見せる商品を選びます。JSONだけを返してください。
- 指定された点数まで選ぶ（良い候補が少なければ少なくてよい。数合わせしない）。同じ商品・色違いだけの商品・ほぼ同じ商品を並べない。検索語ごとに偏らせない
- relation：起点（または直前の商品）との関係（40字以内。例：「同じボックスシルエットで約半額」「このTシャツに合わせる太めのカーゴ」）
- similar：似ている点／differ：違う点（cheaper・same_price のときは必ず書く。デザイン・素材・用途のうち、商品名・説明から分かることだけ。分からなければ「商品名からは不明」）
- feature：その商品の特徴（40字以内。商品名・説明に書いてあることだけ。書いていない素材・数値・受賞歴を足さない）
- look：coord のとき、どの組み合わせの案か（looks の番号）
- value：この商品を紹介する価値（40字以内。具体的に：そのジャンルの定番／レビューの数字が多い（数字は画面に出すので書かなくてよい）／コスパがはっきり高い／デザインや機能の独自性／起点と価格帯や用途が違い比べる意味がある、など）。
  ブランド名だけを理由にしない。ランキングの順位・売上の順位は書かない（確認していない）。同じ特徴の商品が続くなら、より魅力的な方を選ぶ
- theme：テーマで広げるとき、どの投稿企画か（themes の番号）。比較候補（similar）は2点まで（有名ブランドの定番なら3点まで）。残りは関連用品・同じ場面の便利グッズ・意外な関連から選ぶ
- 体験したように書かない。「人気」「売れている」と書かない（確認できる数字は画面に別に出す）。根拠のない断定・医療の効果は書かない
出力形式: {"picks":[{"id":"0-2","relation":"...","similar":"...","differ":"...","feature":"...","value":"...","look":0,"theme":0}]}`;

// 探し方ごとの価格の条件（価格が分かるときだけ）
function priceRange(mode, price) {
  if (!(price > 0)) return {};
  if (mode === 'cheaper') return { maxPrice: Math.floor(price * 0.75) };
  if (mode === 'same_price') return { minPrice: Math.floor(price * 0.7), maxPrice: Math.round(price * 1.35) };
  return {};
}

export async function planExpand({ base, mode, path, brand, kind, env, deadline }) {
  const userContent = [
    `探し方: ${mode}（${MODES[mode]}）`,
    `起点の商品: ${compact(base.name, 100)} / ${base.price ? `${base.price}円` : '価格不明'}${brand ? ` / ブランド: ${brand}` : ' / ブランド: 不明'}${kind ? ` / 種類: ${kind}` : ''}`,
    base.caption ? `説明: ${compact(base.caption, 160)}` : '',
    path.length > 1 ? `ここまでの探索: ${path.map((p) => compact(p.name, 30)).join(' → ')}` : ''
  ].filter(Boolean).join('\n');
  const { result } = await runWithModels({
    env, deadline, system: PLAN_PROMPT, userContent,
    parse: (c) => {
      const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
      const max = mode === 'coord' ? 5 : mode === 'omakase' ? 8 : mode === 'accessory' ? 5 : 3; // 10件以上を選べるだけの候補を集める
      const seen = new Set();
      const axisOf = (a) => (mode !== 'omakase' ? mode : THEME_AXES.includes(a) ? a : a === 'brand' || a === 'same_line' || a === 'cheaper' || a === 'same_price' ? 'similar' : 'related');
      const themes = mode === 'omakase' ? (Array.isArray(d.themes) ? d.themes : []).slice(0, 3).map((t) => ({ title: clean(t && t.title, 24), angle: clean(t && t.angle, 60) })).filter((t) => t.title && !NG_RE.test(t.title)) : [];
      let similarUsed = 0;
      const queries = (Array.isArray(d.queries) ? d.queries : []).map((q) => ({ keyword: kw(q && q.keyword), label: clean(q && q.label, 14), why: clean(q && q.why, 60), axis: axisOf(q && q.axis), theme: themes[Number(q && q.theme)] ? Number(q.theme) : null }))
        // テーマで広げるとき、同じジャンルの比較候補の検索は1語だけ（周辺ジャンル・別の企画に十分に広げる）
        .filter((q) => q.keyword && !seen.has(q.keyword) && seen.add(q.keyword) && !(mode === 'omakase' && q.axis === 'similar' && similarUsed++ >= 1)).slice(0, max);
      if (!queries.length) throw new AiError('探し方を決められませんでした');
      const looks = mode === 'coord' ? (Array.isArray(d.looks) ? d.looks : []).slice(0, 3).map((l) => ({ name: clean(l && l.name, 20), concept: clean(l && l.concept, 60), labels: (Array.isArray(l && l.labels) ? l.labels : []).map((x) => clean(x, 14)).filter(Boolean) })).filter((l) => l.name) : [];
      return { queries, looks, themes };
    }
  });
  // ブランドの別商品は、ブランド名を必ず入れる。同じ価格帯の他ブランドは、起点のブランド名を外す
  // （おまかせのミックスでも、軸ごとに同じ決まりを当てる）
  result.queries = result.queries.map((q) => {
    if (q.axis === 'brand' && brand && !mentionsBrand(q.keyword, brand)) return { ...q, keyword: `${brand} ${q.keyword}`.slice(0, 40) };
    if (q.axis === 'same_price' && brand) return { ...q, keyword: q.keyword.split(' ').filter((w) => !mentionsBrand(w, brand)).join(' ') || kind || q.keyword };
    return q;
  });
  return result;
}

// 楽天で探す。起点・探索の途中・前に出した商品を外し、探し方の条件（価格・ブランド）に合う商品だけ残す
export async function gatherExpand({ queries, mode, base, brand, exclude, env, referer, until, perQuery = 6 }) {
  perQuery = queries.length >= 7 ? Math.min(perQuery, 5) : Math.max(perQuery, 8); // 合わせて40件ほどの候補から選ぶ
  const out = [];
  let brandSorted = false;
  for (const [i, q] of queries.entries()) {
    const axis = q.axis || mode;
    const range = priceRange(axis, base.price);
    if (Date.now() + 1500 > until) { out.push({ ...q, candidates: [] }); continue; }
    if (i > 0) await sleep(1100);
    try {
      // 同じブランドの1語目は、レビューの多い順で確認する（「よく買われている」を数字で示せるように）
      // テーマで広げるときの比較候補も、レビューの多い順で探す（高評価・定番を、確認できる数字で選べるように）
      const sort = (axis === 'brand' && !brandSorted) || axis === 'similar' ? '-reviewCount' : undefined;
      if (sort && axis === 'brand') brandSorted = true;
      const r = await searchPage({ keyword: q.keyword, env, referer, hits: 30, sort, ...range });
      const seen = new Set();
      const cands = r.items.filter((it) => {
        const k = nameKey(it.name);
        if (!it.image || exclude.has(it.code) || exclude.has(k) || exclude.has(k.slice(0, 14)) || seen.has(k)) return false; // 名前の除外は先頭14字（readExclude と同じ）
        if (axis === 'brand' && brand && !mentionsBrand(it.name, brand)) return false;
        if (axis === 'same_price' && brand && mentionsBrand(it.name, brand)) return false;
        if (axis === 'cheaper' && base.price && it.price >= base.price) return false;
        seen.add(k);
        return true;
      }).slice(0, perQuery);
      out.push({ ...q, axis, sort: sort || '', candidates: cands });
    } catch (e) {
      out.push({ ...q, candidates: [], error: e.message });
      if (/40[13]/.test(e.message)) break;
    }
  }
  return out;
}

// 起点の商品の種類の言葉（例：「鉄フライパン 26cm」→ フライパン）。辞書（findKind）になければ、分類の目印の言葉
export function kindWord(name) {
  const k = findKind(name);
  if (k) return k;
  const t = String(name || '').normalize('NFKC');
  const c = classify(t);
  const sub = c && MAJORS.find((m) => m.id === c.major).subs.find((x) => x[0] === c.sub);
  const m = sub && t.match(sub[2]);
  return m ? m[0] : '';
}
// 同じ種類の商品か（「フライパン用のふた」「フライパン収納」は別の種類＝関連用品として数える）
export function sameKind(name, word) {
  const t = String(name || '').normalize('NFKC');
  if (!word || !t.includes(word)) return false;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !new RegExp(`${esc}\\s*(用|の|対応|収納|スタンド|ラック|ふた|蓋|カバー|ケース|置き|立て|ホルダー|ガード|クリーナー|ハンドル|取っ手)`).test(t);
}

// ほぼ同じ商品（色違い・サイズ違い・別ショップ）：ショップの飾りを除いた商品名の前半が同じ
export function sameish(a, b) {
  const n = (s) => String(s || '').normalize('NFKC').replace(/[【\[（(].*?[】\]）)]/g, '').replace(/送料無料|ポイント\d+倍|楽天\S*位|即納|あす楽|メンズ|レディース|ユニセックス|ホワイト|ブラック|ネイビー|グレー|ベージュ|ブラウン|カーキ|オリーブ|アイボリー|チャコール|全\d+色|[白黒紺灰茶赤青緑](?=[\s　]|$)|\b(XXL|XL|L|M|S)\b/g, '').replace(/[\s　・/|]/g, '').toLowerCase();
  const x = n(a); const y = n(b);
  if (!x || !y) return false;
  const len = Math.min(16, x.length, y.length);
  return len >= 6 && x.slice(0, len) === y.slice(0, len);
}

// 価格帯：同じ「探したもの（label）」の中で、真ん中の価格と比べて決める（カテゴリーごとに価格の感覚が違うため）。
// 1つしかない分類は、起点の価格と比べる
export function priceTiers(items, basePrice) {
  const groups = {};
  items.forEach((it) => { (groups[it.group] = groups[it.group] || []).push(it.price); });
  return items.map((it) => {
    const g = groups[it.group].slice().sort((a, b) => a - b);
    const ref = g.length >= 2 ? g[Math.floor(g.length / 2)] : basePrice || it.price;
    const tier = it.price >= ref * 1.4 ? 'high' : it.price <= ref * 0.7 ? 'low' : 'mid';
    return { ...it, tier };
  });
}

export async function pickExpand({ base, mode, plan, groups, want = MAX_RESULTS, env, deadline }) {
  const lines = groups.map((g, gi) => `検索${gi}（${AXES[g.axis] || g.label}／${g.label}／${g.keyword}${g.sort ? '／レビューの多い順' : ''}）\n${g.candidates.map((c, j) => `  ${gi}-${j}: ${compact(c.name, 70)} / ${c.price}円 / ${c.shop} / レビュー${c.reviewCount || 0}件（平均${c.reviewAverage || '-'}） / 説明: ${compact(c.caption, 100)}`).join('\n') || '  （候補なし）'}`);
  const looks = (plan.looks.length ? `\n組み合わせの案: ${plan.looks.map((l, i) => `${i}=${l.name}（${l.concept}）`).join('／')}` : '') + ((plan.themes || []).length ? `\n投稿企画（themes）: ${plan.themes.map((t, i) => `${i}=${t.title}（${t.angle}）`).join('／')}` : '');
  const { result } = await runWithModels({
    env, deadline, system: PICK_PROMPT,
    userContent: `探し方: ${mode}（${MODES[mode]}）\n選ぶ点数: 最大${want}点${mode === 'omakase' ? `（起点と同じ種類は${SIMILAR_MAX}点まで、有名ブランドの定番なら${SIMILAR_BRAND_MAX}点まで。関連用品・同じ場面の便利グッズ・意外な関連・別の投稿企画に十分に広げる。カテゴリーごとの数は商品の質で決める）` : ''}\n起点の商品: ${compact(base.name, 90)} / ${base.price ? `${base.price}円` : '価格不明'}${looks}\n${lines.join('\n')}`,
    parse: (c) => {
      const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
      const out = [];
      for (const p of Array.isArray(d.picks) ? d.picks : []) {
        const m = String(p && p.id).match(/^(\d+)-(\d+)$/);
        const g = m && groups[Number(m[1])];
        const it = g && g.candidates[Number(m[2])];
        if (!it || out.some((o) => o.code === it.code || nameKey(o.name) === nameKey(it.name) || sameish(o.name, it.name))) continue;
        const relation = clean(p.relation, 60);
        const feature = clean(p.feature, 60);
        const similar = clean(p.similar, 60);
        const differ = clean(p.differ, 60);
        if (!relation || [relation, feature, similar, differ].some((t) => NG_RE.test(t))) continue; // 関係を説明できない商品は出さない
        let value = clean(p.value, 60);
        if (RANK_RE.test(value) || NG_RE.test(value)) value = ''; // 確認できない順位・断定は出さない
        if (RANK_RE.test(relation + feature)) continue;
        const look = Number(p.look);
        const th = Number(p.theme);
        out.push({
          code: it.code, name: it.name, brand: (findBrand(it.name) || {}).name || '', price: it.price, postage: it.postage || '', url: it.url, image: it.image, shop: it.shop,
          caption: compact(it.caption, 200), reviewCount: it.reviewCount || 0, reviewAverage: it.reviewAverage || 0,
          group: g.label || g.keyword, keyword: g.keyword, byReviews: !!g.sort, axis: g.axis || mode, axisLabel: AXES[g.axis || mode] || MODES[mode],
          relation, feature, similar, differ, value, look: mode === 'coord' && Number.isInteger(look) && plan.looks[look] ? look : null,
          theme: (plan.themes || [])[th] ? th : g.theme != null ? g.theme : null
        });
        if (out.length >= want) break;
      }
      if (!out.length) throw new AiError('関係を説明できる商品が見つかりませんでした');
      return out;
    }
  });
  return result;
}

// want：選ぶ点数（最初の探索はおまかせ12・ほかは10。今の結果に足すときも10）。exclude には今の結果の商品も入る（重複させない）
export async function expand({ base, mode, path = [], exclude = new Set(), want = 0, env, referer, startedAt = Date.now(), now = new Date() }) {
  const limit = Math.max(1, Math.min(MAX_WANT, Number(want) || (mode === 'omakase' ? 12 : MAX_RESULTS)));
  if (!MODES[mode]) throw new AiError('探し方が分かりません');
  if (!base.name) throw new AiError('起点の商品がありません');
  const brand = base.brand || (findBrand(base.name) || {}).name || '';
  const kind = findKind(base.name) || '';
  if (mode === 'brand' && !brand) throw new AiError('この商品のブランドが商品名から分からないため、「同じブランドの別商品」は探せません。ほかの探し方を選んでください');
  const plan = await planExpand({ base, mode, path, brand, kind, env, deadline: startedAt + 15000 });
  const ex = new Set([...exclude, base.code, nameKey(base.name), ...path.flatMap((p) => [p.code, nameKey(p.name)])].filter(Boolean));
  const groups = await gatherExpand({ queries: plan.queries, mode, base, brand, exclude: ex, env, referer, until: startedAt + 34000 });
  if (!groups.some((g) => g.candidates.length)) throw new AiError(`楽天で条件に合う商品が見つかりませんでした（探した言葉：${groups.map((g) => g.keyword).join('、')}）`);
  // おまかせは、同じ種類・同じ分野の見送りが出ても指定の点数に届くよう、多めに選んでもらってから絞る
  const picked = await pickExpand({ base, mode, plan, groups, want: mode === 'omakase' ? limit + 8 : limit, env, deadline: startedAt + 57000 });
  let usable = picked.filter((it) => it.price > 0 && /^https:\/\/item\.rakuten\.co\.jp\//.test(it.url) && it.image);
  let capped = 0;
  if (mode === 'omakase') {
    // 起点と同じ種類（比較候補）は2点まで（有名ブランドの商品なら合わせて3点まで）。同じ細かい分類も3点まで（同じジャンルの偏りを防ぐ）
    const bc = classify(base.name);
    const bk = kindWord(base.name);
    const perSub = {};
    let same = 0;
    usable = usable.filter((it) => {
      const c = classify(it.name);
      // 同じ分野の数え方：商品の種類の言葉（ふた・トング・鍋敷き…は別々に数える）。分からなければ分類
      const kw = kindWord(it.name);
      const sub = kw ? 'k:' + kw + (sameKind(it.name, kw) ? '' : ':' + it.group) : c ? c.major + ':' + c.sub : 'x:' + it.group;
      // 同じ種類：比較候補の検索で見つけた／起点と同じ種類の名前（例：フライパン）が商品名にある
      const isSame = it.axis === 'similar' || (bk ? sameKind(it.name, bk) : !!(bc && c && c.sub === bc.sub));
      if (isSame && same >= (it.brand ? SIMILAR_BRAND_MAX : SIMILAR_MAX)) { capped++; return false; }
      if (!isSame && (perSub[sub] || 0) >= PER_SUB_MAX) { capped++; return false; }
      if (isSame) same++;
      perSub[sub] = (perSub[sub] || 0) + 1;
      return true;
    });
  }
  const items = priceTiers(usable.slice(0, limit), base.price);
  const notice = [
    items.length < Math.min(MIN_RESULTS, limit) ? `条件に合う商品は${items.length}件でした（数合わせはしていません）` : '',
    capped ? `同じ種類・同じジャンルの商品が多いため${capped}件を見送りました（起点と同じ種類は${SIMILAR_MAX}件まで・有名ブランドなら${SIMILAR_BRAND_MAX}件まで）` : '',
    groups.filter((g) => g.error).length ? `一部の検索に失敗しました（${groups.filter((g) => g.error).map((g) => g.keyword).join('、')}）` : ''
  ].filter(Boolean).join('。');
  return {
    mode, modeLabel: MODES[mode], base: { name: base.name, code: base.code, price: base.price, brand }, at: now.toISOString(),
    searched: groups.map((g) => ({ keyword: g.keyword, label: g.label, axis: g.axis, found: g.candidates.length, byReviews: !!g.sort })), want: limit,
    looks: plan.looks, themes: plan.themes || [], items, notice
  };
}
