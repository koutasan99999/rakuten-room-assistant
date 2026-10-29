// AIコーデスタジオ：起点のファッションアイテムから、全身コーデを3パターン提案する。
// AIが考えるのは「コーデの方向性と、各アイテムの種類・検索語」だけ。商品は必ず楽天の検索結果（実在する商品）から入れる。
// AIに商品名・価格・URLは作らせない。
import { searchPage } from './rakuten.js';
import { analyzeProduct, dedupeProducts, findBrand, findKind, hasBrand } from './product-analysis.js';
import { AiError, compact, cleanText, runWithModels } from './ai.js';

// ---- アイテムの枠 ----
export const SLOTS = {
  outer: { label: 'アウター', weight: 3 },
  tops: { label: 'トップス', weight: 1.5 },
  bottoms: { label: 'ボトムス', weight: 2 },
  onepiece: { label: 'ワンピース', weight: 3 },
  shoes: { label: '靴', weight: 2.5 },
  bag: { label: 'バッグ', weight: 2 },
  hat: { label: '帽子', weight: 0.8 },
  accessory: { label: 'アクセサリー', weight: 1 }
};
export const SLOT_ORDER = ['outer', 'tops', 'onepiece', 'bottoms', 'shoes', 'bag', 'hat', 'accessory'];

const SLOT_RULES = [
  ['shoes', /スニーカー|シューズ|ブーツ|ローファー|サンダル|パンプス|スリッポン|革靴|靴(?!下)/],
  ['bag', /バッグ|リュック|バックパック|トート|ショルダー|サコッシュ|ポーチ|スーツケース|ボストン/],
  ['onepiece', /ワンピース|オールインワン|サロペット/],
  ['outer', /ジャケット|コート|ダウン|ブルゾン|マウンテンパーカー|フリース|ダウンベスト|アウター/],
  ['bottoms', /パンツ|ジーンズ|デニム|スラックス|チノ|スカート|ショーツ/],
  ['tops', /Tシャツ|ロンT|パーカー|スウェット|トレーナー|ニット|カーディガン|シャツ|ブラウス|ベスト|トップス|カットソー/],
  ['hat', /キャップ|ニット帽|ビーニー|ハット|帽子/],
  ['accessory', /ネックレス|ピアス|イヤリング|リング|ブレスレット|腕時計|時計|サングラス|メガネ|眼鏡|マフラー|ストール|手袋|ソックス|靴下|ベルト|財布/]
];

export function slotOf(text) {
  const s = String(text || '').normalize('NFKC');
  const hit = SLOT_RULES.find(([, re]) => re.test(s));
  return hit ? hit[0] : '';
}

export const STYLES = ['おまかせ', 'きれいめ', '大人カジュアル', 'ストリート', 'シンプル', '韓国系', 'モード', 'アメカジ', 'アウトドア'];
export const SEASONS = ['おまかせ', '春', '夏', '秋', '冬', 'オールシーズン'];
export const BUDGETS = { none: 0, '10000': 10000, '30000': 30000, '50000': 50000, '100000': 100000 };

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, n) => (Array.isArray(v) ? v : String(v || '').split(/[、,，\s]+/)).map((x) => str(x, 30)).filter(Boolean).slice(0, n);

export function readCoordConditions(x) {
  const c = x && typeof x === 'object' ? x : {};
  return {
    gender: ['mens', 'ladies'].includes(c.gender) ? c.gender : '',
    style: STYLES.includes(c.style) ? c.style : 'おまかせ',
    season: SEASONS.includes(c.season) ? c.season : 'おまかせ',
    budget: BUDGETS[c.budget] != null ? c.budget : 'none',
    age: str(c.age, 20),
    scene: str(c.scene, 40),
    likeBrands: list(c.likeBrands, 5),
    avoidBrands: list(c.avoidBrands, 8),
    colors: str(c.colors, 40)
  };
}

export function readCoordHero(x) {
  if (!x || typeof x !== 'object' || !x.name) return null;
  const url = str(x.url, 300);
  const image = str(x.image, 300);
  return {
    name: str(x.name, 200), code: str(x.code, 80), price: Number(x.price) || 0, brand: str(x.brand, 40), shop: str(x.shop, 60),
    url: /^https:\/\//.test(url) ? url : '', image: /^https:\/\//.test(image) ? image : '', caption: str(x.caption, 300), categoryLabel: str(x.categoryLabel, 20)
  };
}

// 性別：指定がなければ商品名から（メンズ・レディース）。分からなければ、どちらでもない検索語にする
export function genderOf(cond, hero) {
  if (cond.gender) return cond.gender;
  const s = String(hero.name || '');
  if (/レディース|ウィメンズ|women|WOMEN|ladies/i.test(s)) return 'ladies';
  if (/メンズ|men's|MENS|\bmen\b/i.test(s)) return 'mens';
  return '';
}
const GENDER_WORD = { mens: 'メンズ', ladies: 'レディース', '': '' };

// ---- AIの提案（枠と検索語だけ） ----
function prompt(heroSlot) {
  return `あなたはファッション誌のコーディネーターです。JSONだけを返してください。
起点のアイテム（ユーザーが選んだ実在の商品）を主役に、全身コーデを3パターン考えます。
あなたが決めるのは「コーデの名前・方向性・各アイテムの種類と、楽天市場で探すための検索語」だけです。商品名・価格・URL・品番は書かないでください（実在の商品はアプリが検索して入れます）。

ルール:
- 3パターンはスタイル・雰囲気がはっきり違うものにする（スタイルの指定があれば、その中で着こなしを変える）
- 起点のアイテムは「${SLOTS[heroSlot] ? SLOTS[heroSlot].label : '小物'}」の枠に入っているので、その枠のアイテムは出さない
- 各パターン3〜5アイテム。全身になるようにする（トップス＋ボトムス、またはワンピース。靴が起点でなければ靴も）
- slot: ${Object.keys(SLOTS).join(' / ')} のどれか。ワンピースのときは tops と bottoms は入れない
- keyword: 楽天で検索する言葉。商品名に入りやすい名詞を2〜4語（性別の言葉・種類・素材・色・形）。「おしゃれ」「人気」「コーデ」のような曖昧な言葉は入れない。好きなブランドの指定があるときだけブランド名を入れてよい。避けたいブランドは入れない
- 季節に合わないもの（夏にダウン・冬にサンダルなど）は入れない
- 起点のアイテムの色・雰囲気と合う色を選ぶ。色の好みがあれば優先する

出力形式:
{"looks":[{"name":"コーデ名（12字以内）","style":"スタイル（10字以内）","concept":"ねらい（40字以内）","items":[{"slot":"tops","kind":"種類（8字以内）","keyword":"メンズ クルーネック ニット グレー","color":"グレー"}]}]}`;
}

function conditionLines(cond, gender) {
  return [
    `性別: ${gender === 'mens' ? 'メンズ' : gender === 'ladies' ? 'レディース' : '指定なし（ユニセックスで考える）'}`,
    `スタイル: ${cond.style}`,
    `季節: ${cond.season}`,
    cond.budget !== 'none' && `予算（全身の合計）: ${Number(cond.budget).toLocaleString('ja-JP')}円以内`,
    cond.age && `年齢層: ${cond.age}`,
    cond.scene && `着用シーン: ${cond.scene}`,
    cond.likeBrands.length && `好きなブランド: ${cond.likeBrands.join('、')}`,
    cond.avoidBrands.length && `避けたいブランド: ${cond.avoidBrands.join('、')}`,
    cond.colors && `色の好み: ${cond.colors}`
  ].filter(Boolean).join('\n');
}

function cleanKeyword(k) {
  return cleanText(k).replace(/[「」『』"'、。,.!?！？×]/g, ' ').replace(/おしゃれ|人気|コーデ|おすすめ/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function normalizeLooks(data, { heroSlot, gender, cond }) {
  const looks = [];
  for (const l of Array.isArray(data && data.looks) ? data.looks : []) {
    const items = [];
    const used = new Set([heroSlot]);
    for (const x of Array.isArray(l && l.items) ? l.items : []) {
      const slot = SLOTS[x && x.slot] ? x.slot : slotOf(`${x && x.kind} ${x && x.keyword}`);
      if (!slot || used.has(slot)) continue;
      if (slot === 'onepiece' && (used.has('tops') || used.has('bottoms'))) continue;
      if ((slot === 'tops' || slot === 'bottoms') && used.has('onepiece')) continue;
      let keyword = cleanKeyword(x.keyword);
      for (const b of cond.avoidBrands) if (hasBrand(keyword, b)) keyword = keyword.replace(new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ').trim();
      const kind = cleanText(x.kind).slice(0, 10) || findKind(keyword) || SLOTS[slot].label;
      if (!keyword) keyword = kind;
      if (gender && !/メンズ|レディース|ウィメンズ/.test(keyword)) keyword = `${GENDER_WORD[gender]} ${keyword}`;
      used.add(slot);
      items.push({ slot, kind, keyword: keyword.slice(0, 40), color: cleanText(x.color).slice(0, 10) });
      if (items.length >= 5) break;
    }
    if (items.length < 2) continue;
    looks.push({ name: cleanText(l.name).slice(0, 16) || `コーデ${looks.length + 1}`, style: cleanText(l.style).slice(0, 12), concept: cleanText(l.concept).slice(0, 60), items });
    if (looks.length >= 3) break;
  }
  return looks;
}

// AIが使えないときの3パターン（起点の枠は抜き、靴が起点でなければ靴を足す）
export function fallbackLooks({ heroSlot, gender, cond }) {
  const g = GENDER_WORD[gender];
  const ladies = gender === 'ladies';
  const raw = [
    { name: 'きれいめカジュアル', style: 'きれいめ', concept: '落ち着いた色でまとめて、起点のアイテムを引き立てる', items: [['tops', 'ニット', 'クルーネック ニット'], ['bottoms', ladies ? 'スカート' : 'スラックス', ladies ? 'ロングスカート' : 'スラックス テーパード'], ['shoes', 'ローファー', 'ローファー'], ['bag', 'レザーバッグ', 'レザー ショルダーバッグ']] },
    { name: '大人ストリート', style: 'ストリート', concept: 'ゆるいシルエットで、程よく力を抜いた雰囲気に', items: [['outer', 'ブルゾン', 'ブルゾン'], ['tops', 'Tシャツ', 'Tシャツ 無地 オーバーサイズ'], ['bottoms', 'ワイドデニム', 'ワイドデニム'], ['shoes', 'スニーカー', 'スニーカー']] },
    { name: '休日カジュアル', style: '大人カジュアル', concept: '動きやすさを優先した、休日にちょうどいい組み合わせ', items: [['tops', 'スウェット', 'スウェット'], ['bottoms', 'チノパン', 'チノパン'], ['shoes', 'スニーカー', 'スニーカー'], ['bag', 'ショルダーバッグ', 'ショルダーバッグ ナイロン']] }
  ];
  return normalizeLooks({ looks: raw.map((l) => ({ ...l, items: l.items.map(([slot, kind, keyword]) => ({ slot, kind, keyword: `${g} ${keyword}`.trim() })) })) }, { heroSlot, gender, cond });
}

export async function planLooks({ hero, analysis, heroSlot, gender, cond, env, deadline }) {
  const userContent = [
    `起点のアイテム: ${compact(hero.name, 100)}`,
    analysis.brand && `ブランド: ${analysis.brand}`,
    `種類: ${analysis.category || SLOTS[heroSlot].label}（枠: ${heroSlot}）`,
    analysis.color && `色: ${analysis.color}`,
    hero.price && `価格: ${hero.price}円`,
    conditionLines(cond, gender)
  ].filter(Boolean).join('\n');
  const { result } = await runWithModels({
    env, deadline, system: prompt(heroSlot), userContent,
    parse: (content) => {
      let data;
      try { data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]); } catch { throw new AiError('AIの応答を読み取れませんでした'); }
      const looks = normalizeLooks(data, { heroSlot, gender, cond });
      if (looks.length < 2) throw new AiError(`コーデが${looks.length}パターンしか作れませんでした`);
      return looks;
    }
  });
  return result;
}

// ---- 実在の商品を探す ----
// 予算：起点の商品を除いた残りを、枠の重みで分ける（起点だけで予算を超えるときは、予算の4割を残りに使う）
export function slotCaps(items, cond, heroPrice) {
  const budget = BUDGETS[cond.budget] || 0;
  if (!budget) return items.map(() => undefined);
  const rest = Math.max(budget - (heroPrice || 0), budget * 0.4);
  const total = items.reduce((s, it) => s + SLOTS[it.slot].weight, 0) || 1;
  return items.map((it) => Math.max(1500, Math.round((rest * SLOTS[it.slot].weight) / total / 100) * 100));
}

function toProduct(it, slot, kind, now) {
  const b = findBrand(it.name);
  return {
    code: it.code, name: it.name, brand: b ? b.name : '', price: it.price, image: it.image, url: it.url, shop: it.shop,
    category: kind || SLOTS[slot].label, caption: String(it.caption || '').slice(0, 200), fetchedAt: now.toISOString()
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 検索語のゆるめ方：性別の言葉と種類の言葉は残し、ほかの言葉（色・形・素材）を後ろから1つずつ外す。最後は「性別＋種類」
export function relaxSteps(keyword, kind, genderWord = '') {
  const words = String(keyword || '').split(/\s+/).filter(Boolean);
  const keep = (w) => w === genderWord || (kind && (w.includes(kind) || kind.includes(w))) || !!findKind(w);
  const out = [words.join(' ')];
  const cur = [...words];
  for (let i = cur.length - 1; i >= 0; i--) {
    if (keep(cur[i])) continue;
    cur.splice(i, 1);
    if (cur.length) out.push(cur.join(' '));
  }
  out.push(`${genderWord} ${kind}`.trim());
  return [...new Set(out.filter(Boolean))].map((k) => ({ keyword: k }));
}

// 1アイテム分を探す：検索語をゆるめながら、別の枠の商品・避けたいブランド・すでに使った商品を除いて、候補を最大4件
export async function searchSlotProducts({ item, cap, cond, avoid, env, referer, gender, budgetCalls, now = new Date() }) {
  const steps = relaxSteps(item.keyword, item.kind, GENDER_WORD[gender]);
  const ng = cond.avoidBrands.filter((b) => !/\s/.test(b));
  for (const st of steps) {
    if (budgetCalls.left <= 0 || Date.now() + 1200 > budgetCalls.until) break;
    if (budgetCalls.used > 0) await sleep(1100); // 楽天APIは1秒1リクエストまで
    budgetCalls.left--;
    budgetCalls.used++;
    let r;
    try {
      r = await searchPage({ keyword: st.keyword, maxPrice: cap, ngWords: ng, env, referer });
    } catch (e) {
      if (/40[13]/.test(e.message)) { budgetCalls.left = 0; throw e; }
      continue;
    }
    const ok = r.items.filter((it) => {
      if (cond.avoidBrands.some((b) => hasBrand(it.name, b))) return false;
      const s = slotOf(findKind(it.name) || '');
      return !s || s === item.slot || (item.slot === 'outer' && s === 'tops'); // 検索語と違う種類の商品は入れない
    });
    // ほかのコーデで使った商品は後回し（それしか無ければ使い回す）。起点の商品は入れない
    const fresh = dedupeProducts(ok, avoid).items;
    const reuse = dedupeProducts(ok, avoid.slice(0, 1)).items.filter((it) => !fresh.includes(it));
    const items = fresh.concat(reuse);
    if (items.length) return { options: items.slice(0, 4).map((it) => toProduct(it, item.slot, item.kind, now)), keyword: st.keyword, relaxed: st.keyword !== item.keyword };
  }
  return { options: [], keyword: item.keyword, relaxed: false };
}

export async function buildCoords({ hero, cond, env, referer, startedAt = Date.now(), now = new Date() }) {
  const analysis = analyzeProduct(hero);
  const heroSlot = slotOf(`${analysis.category} ${hero.categoryLabel} ${hero.name}`) || 'accessory';
  const gender = genderOf(cond, hero);
  let looks;
  let notice = '';
  let detail;
  try {
    looks = await planLooks({ hero, analysis, heroSlot, gender, cond, env, deadline: startedAt + 22000 });
  } catch (e) {
    console.error('[openai] coord fallback:', e.message);
    looks = fallbackLooks({ heroSlot, gender, cond });
    notice = 'AIでコーデを考えられなかったため、定番の組み合わせで探しました。';
    detail = `原因: ${e.message}`.slice(0, 300);
  }
  const budgetCalls = { left: 24, used: 0, until: startedAt + 52000 };
  const used = [hero];
  const out = [];
  let missing = 0;
  for (const [li, look] of looks.entries()) {
    const caps = slotCaps(look.items, cond, hero.price);
    const items = [];
    for (const [i, item] of look.items.entries()) {
      let r = { options: [], keyword: item.keyword, relaxed: false };
      try {
        r = await searchSlotProducts({ item, cap: caps[i], cond, avoid: used, env, referer, gender, budgetCalls, now });
      } catch (e) {
        if (!out.length && !items.length) throw e;
      }
      if (!r.options.length) missing++;
      if (r.options[0]) used.push(r.options[0]);
      items.push({
        slot: item.slot, slotLabel: SLOTS[item.slot].label, kind: item.kind, keyword: r.keyword, color: item.color, cap: caps[i] || null,
        product: r.options[0] || null, options: r.options, source: 'ai'
      });
    }
    items.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
    out.push({ id: `look${li + 1}`, name: look.name, style: look.style, concept: look.concept, items });
  }
  if (missing) notice = [notice, `${missing}アイテムは条件に合う商品が見つかりませんでした（あとで自分で探して入れられます）。`].filter(Boolean).join(' ');
  return {
    analysis: { brand: analysis.brand, category: analysis.category, color: analysis.color },
    heroSlot, heroSlotLabel: SLOTS[heroSlot].label, gender, looks: out, notice, detail
  };
}
