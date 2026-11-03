// 「この商品から広げる」：1つの商品を起点に、関連する実在の商品を楽天で探す（何段階でも続けられる）。
//   1. 探し方（6種類）に合わせて、AIが楽天で探す検索語を決める（価格の上下限・ブランドの条件はコードで決める）
//   2. 楽天で探す（1語1回。1秒1回まで）
//   3. AIが候補から5〜8点を選び、元の商品との関係（似ている点・違う点・合わせる理由）を書く
//   4. コードで確認：価格・URL・画像のない商品、同じ・ほぼ同じ商品、起点の商品と探索の途中の商品を外す。価格帯（高・中・低）を付ける
// 商品名・価格・URL・画像・レビュー件数は楽天のデータそのもの（AIに作らせない）。「人気」はレビュー件数など確認できる数字があるときだけ。
import { searchPage, nameKey } from './rakuten.js';
import { AiError, compact, cleanText, runWithModels } from './ai.js';
import { findBrand, findKind, mentionsBrand } from './product-analysis.js';

export const MODES = {
  cheaper: '似たデザインでもっと安い',
  brand: '同じブランドの別商品',
  same_price: '同じ価格帯の他ブランド',
  coord: 'コーディネート・組み合わせ',
  accessory: '小物・周辺アイテム',
  omakase: 'AIにおまかせで広げる'
};
export const MIN_RESULTS = 5;
export const MAX_RESULTS = 8;

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
- cheaper（似たデザインでもっと安い）：起点と同じ種類の商品。デザイン・素材・形の特徴を検索語に入れる。2語まで
- brand（同じブランドの別商品）：検索語の最初にブランド名。同じ種類と、ブランドの別の種類。2語まで
- same_price（同じ価格帯の他ブランド）：起点と同じ種類の商品。起点のブランド名は入れない。2語まで
- coord（コーディネート・組み合わせ）：起点と組み合わせるアイテム（服なら、パンツ・靴・バッグ・時計・帽子など。服以外なら一緒に使う物）を3〜4語。looks に、組み合わせの案を2つ（name：案の名前／concept：どう合わせるか40字以内／labels：使う label）
- accessory（小物・周辺アイテム）：起点と同じ人・同じ場面で使う、別の分野の小物を3語（例：Tシャツ→サングラス・バッグ／デスクライト→ケーブル整理・デスクマット）
- omakase（AIにおまかせ）：社長が思いつかなそうだが、起点との関係をはっきり説明できる商品を3語（関係も why に書く）
出力形式: {"queries":[{"keyword":"...","label":"...","why":"..."}],"looks":[{"name":"...","concept":"...","labels":["..."]}]}`;

const PICK_PROMPT = `あなたは「眼科医くま」のバイヤーです。起点の商品から広げて見つけた楽天の候補から、社長に見せる商品を選びます。JSONだけを返してください。
- 5〜8点を選ぶ（良い候補が少なければ少なくてよい。数合わせしない）。同じ商品・色違いだけの商品・ほぼ同じ商品を並べない。検索語ごとに偏らせない
- relation：起点（または直前の商品）との関係（40字以内。例：「同じボックスシルエットで約半額」「このTシャツに合わせる太めのカーゴ」）
- similar：似ている点／differ：違う点（cheaper・same_price のときは必ず書く。デザイン・素材・用途のうち、商品名・説明から分かることだけ。分からなければ「商品名からは不明」）
- feature：その商品の特徴（40字以内。商品名・説明に書いてあることだけ。書いていない素材・数値・受賞歴を足さない）
- look：coord のとき、どの組み合わせの案か（looks の番号）
- 体験したように書かない。「人気」「売れている」と書かない（確認できる数字は画面に別に出す）。根拠のない断定・医療の効果は書かない
出力形式: {"picks":[{"id":"0-2","relation":"...","similar":"...","differ":"...","feature":"...","look":0}]}`;

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
      const max = mode === 'coord' ? 4 : mode === 'accessory' || mode === 'omakase' ? 3 : 2;
      const seen = new Set();
      const queries = (Array.isArray(d.queries) ? d.queries : []).map((q) => ({ keyword: kw(q && q.keyword), label: clean(q && q.label, 14), why: clean(q && q.why, 60) }))
        .filter((q) => q.keyword && !seen.has(q.keyword) && seen.add(q.keyword)).slice(0, max);
      if (!queries.length) throw new AiError('探し方を決められませんでした');
      const looks = mode === 'coord' ? (Array.isArray(d.looks) ? d.looks : []).slice(0, 3).map((l) => ({ name: clean(l && l.name, 20), concept: clean(l && l.concept, 60), labels: (Array.isArray(l && l.labels) ? l.labels : []).map((x) => clean(x, 14)).filter(Boolean) })).filter((l) => l.name) : [];
      return { queries, looks };
    }
  });
  // ブランドの別商品は、ブランド名を必ず入れる。同じ価格帯の他ブランドは、起点のブランド名を外す
  if (mode === 'brand' && brand) result.queries = result.queries.map((q) => (mentionsBrand(q.keyword, brand) ? q : { ...q, keyword: `${brand} ${q.keyword}`.slice(0, 40) }));
  if (mode === 'same_price' && brand) result.queries = result.queries.map((q) => ({ ...q, keyword: q.keyword.split(' ').filter((w) => !mentionsBrand(w, brand)).join(' ') || kind || q.keyword }));
  return result;
}

// 楽天で探す。起点・探索の途中・前に出した商品を外し、探し方の条件（価格・ブランド）に合う商品だけ残す
export async function gatherExpand({ queries, mode, base, brand, exclude, env, referer, until, perQuery = 6 }) {
  const range = priceRange(mode, base.price);
  const out = [];
  for (const [i, q] of queries.entries()) {
    if (Date.now() + 1500 > until) { out.push({ ...q, candidates: [] }); continue; }
    if (i > 0) await sleep(1100);
    try {
      // 同じブランドの1語目は、レビューの多い順で確認する（「よく買われている」を数字で示せるように）
      const sort = mode === 'brand' && i === 0 ? '-reviewCount' : undefined;
      const r = await searchPage({ keyword: q.keyword, env, referer, hits: 30, sort, ...range });
      const seen = new Set();
      const cands = r.items.filter((it) => {
        const k = nameKey(it.name);
        if (!it.image || exclude.has(it.code) || exclude.has(k) || seen.has(k)) return false;
        if (mode === 'brand' && brand && !mentionsBrand(it.name, brand)) return false;
        if (mode === 'same_price' && brand && mentionsBrand(it.name, brand)) return false;
        if (mode === 'cheaper' && base.price && it.price >= base.price) return false;
        seen.add(k);
        return true;
      }).slice(0, perQuery);
      out.push({ ...q, sort: sort || '', candidates: cands });
    } catch (e) {
      out.push({ ...q, candidates: [], error: e.message });
      if (/40[13]/.test(e.message)) break;
    }
  }
  return out;
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

export async function pickExpand({ base, mode, plan, groups, env, deadline }) {
  const lines = groups.map((g, gi) => `検索${gi}（${g.label}／${g.keyword}${g.sort ? '／レビューの多い順' : ''}）\n${g.candidates.map((c, j) => `  ${gi}-${j}: ${compact(c.name, 70)} / ${c.price}円 / ${c.shop} / 説明: ${compact(c.caption, 100)}`).join('\n') || '  （候補なし）'}`);
  const looks = plan.looks.length ? `\n組み合わせの案: ${plan.looks.map((l, i) => `${i}=${l.name}（${l.concept}）`).join('／')}` : '';
  const { result } = await runWithModels({
    env, deadline, system: PICK_PROMPT,
    userContent: `探し方: ${mode}（${MODES[mode]}）\n起点の商品: ${compact(base.name, 90)} / ${base.price ? `${base.price}円` : '価格不明'}${looks}\n${lines.join('\n')}`,
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
        const look = Number(p.look);
        out.push({
          code: it.code, name: it.name, brand: (findBrand(it.name) || {}).name || '', price: it.price, postage: it.postage || '', url: it.url, image: it.image, shop: it.shop,
          caption: compact(it.caption, 200), reviewCount: it.reviewCount || 0, reviewAverage: it.reviewAverage || 0,
          group: g.label || g.keyword, keyword: g.keyword, byReviews: !!g.sort,
          relation, feature, similar, differ, look: mode === 'coord' && Number.isInteger(look) && plan.looks[look] ? look : null
        });
        if (out.length >= MAX_RESULTS) break;
      }
      if (!out.length) throw new AiError('関係を説明できる商品が見つかりませんでした');
      return out;
    }
  });
  return result;
}

export async function expand({ base, mode, path = [], exclude = new Set(), env, referer, startedAt = Date.now(), now = new Date() }) {
  if (!MODES[mode]) throw new AiError('探し方が分かりません');
  if (!base.name) throw new AiError('起点の商品がありません');
  const brand = base.brand || (findBrand(base.name) || {}).name || '';
  const kind = findKind(base.name) || '';
  if (mode === 'brand' && !brand) throw new AiError('この商品のブランドが商品名から分からないため、「同じブランドの別商品」は探せません。ほかの探し方を選んでください');
  const plan = await planExpand({ base, mode, path, brand, kind, env, deadline: startedAt + 15000 });
  const ex = new Set([...exclude, base.code, nameKey(base.name), ...path.flatMap((p) => [p.code, nameKey(p.name)])].filter(Boolean));
  const groups = await gatherExpand({ queries: plan.queries, mode, base, brand, exclude: ex, env, referer, until: startedAt + 30000 });
  if (!groups.some((g) => g.candidates.length)) throw new AiError(`楽天で条件に合う商品が見つかりませんでした（探した言葉：${groups.map((g) => g.keyword).join('、')}）`);
  const picked = await pickExpand({ base, mode, plan, groups, env, deadline: startedAt + 55000 });
  const items = priceTiers(picked.filter((it) => it.price > 0 && /^https:\/\/item\.rakuten\.co\.jp\//.test(it.url) && it.image), base.price);
  const notice = [
    items.length < MIN_RESULTS ? `条件に合う商品は${items.length}件でした（数合わせはしていません）` : '',
    groups.filter((g) => g.error).length ? `一部の検索に失敗しました（${groups.filter((g) => g.error).map((g) => g.keyword).join('、')}）` : ''
  ].filter(Boolean).join('。');
  return {
    mode, modeLabel: MODES[mode], base: { name: base.name, code: base.code, price: base.price, brand }, at: now.toISOString(),
    searched: groups.map((g) => ({ keyword: g.keyword, label: g.label, found: g.candidates.length, byReviews: !!g.sort })),
    looks: plan.looks, items, notice
  };
}
