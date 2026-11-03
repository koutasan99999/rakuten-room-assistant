// Instagram投稿セットの自動制作：AI社員が企画を決め、企画に合う実在の商品を楽天から3〜6点選んで、1つの投稿セットにする。
//   1. 企画（AI）：企画パターン・タイトル・誰向けか・選んだ理由・伝えたい魅力と、商品の枠（役割と楽天の検索語）を決める
//   2. 楽天で枠ごとに探す（1枠1回の検索）
//   3. 選定（AI）：枠ごとに、企画の中での役割に合う商品を1つ選び、特徴を書く。合わない枠は空けてよい（数合わせしない）
//   4. 品質確認（コード）：3点未満・価格やURLのない商品・体験の記述・根拠のない断定があれば、完成品にしない
// 画像（スライド）とキャプションは、画面で既存の仕組み（api/instagram と IgRender）を使って仕上げる。
// 商品名・価格・URL・画像は楽天のデータそのもの（AIに作らせない）。
import { searchPage, nameKey } from './rakuten.js';
import { AiError, compact, cleanText, runWithModels } from './ai.js';
import { findBrand } from './product-analysis.js';

export const PATTERNS = {
  new_arrival: '新商品速報（最近登場した注目の商品）',
  first_pick: 'まずコレ（迷ったら最初に選ぶ定番）',
  hero_alt: '本命と代替品（憧れの品と手頃な選択肢の比較）',
  brand: 'ブランド・シリーズ特集（世界観のそろった商品）',
  gift: 'ギフト特集（予算・相手別の贈り物）',
  discovery: '変わり種・発掘（こんな物があるのかと思う商品）',
  budget_use: '予算別・用途別（3,000円・5,000円・1万円、一人暮らし・休日など）'
};
export const MIN_ITEMS = 3;
export const MAX_ITEMS = 6;

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const clean = (v, n) => cleanText(v).replace(/\s+/g, ' ').trim().slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const NG_RE = /最安|絶対|必ず|神アイテム|バズ|話題沸騰|爆売れ|使ってみた|使ってます|愛用|買ってよかった|リピ買い|治る|効く|治療|眼科医が(勧|すすめ|おすすめ)/;

const POLICY = `お客様像：落ち着いているが無難ではない30代男性（本人用と、女性・男性への贈り物）。分野：服・靴・香り・インテリア・雑貨・ガジェット・ギフト。
Instagramで紹介する価値の基準：見た瞬間に興味を持てる／知らなかった商品との出会い／デザインや世界観の魅力／わざわざオンラインで買う理由／人に紹介したくなる特徴。
スーパーで買える一般的な日用品は、デザイン・機能・企画上の必然性がはっきりしない限り選ばない。
医薬品・医療機器・健康食品・メガネ・コンタクトなど、眼科医が勧めているように受け取られる商品は扱わない。`;

// 社長の判断の履歴（採用・差し替え・却下と理由）
export function readHistory(x) {
  const h = Array.isArray(x) ? x : [];
  return h.slice(0, 30).map((e) => ({
    status: ['adopt', 'revise', 'reject'].includes(e && e.status) ? e.status : '',
    pattern: str(e && e.pattern, 20), title: str(e && e.title, 50), reason: str(e && e.reason, 100)
  })).filter((e) => e.status && e.title);
}
function historyLines(h) {
  const label = { adopt: '採用', revise: '差し替え・修正', reject: '却下' };
  return h.map((e) => `${label[e.status]}: ${e.title}（${PATTERNS[e.pattern] || e.pattern}）${e.reason ? ` 理由: ${e.reason}` : ''}`);
}

const PLAN_PROMPT = `あなたは「眼科医くま」のInstagram企画担当とバイヤーです。1つの投稿で3〜6商品を紹介する企画を1つ決めます。JSONだけを返してください。
${POLICY}
- 企画パターンは次から1つ（直近の企画と同じパターンは避ける）：${Object.entries(PATTERNS).map(([k, v]) => `${k}=${v}`).join('／')}
- 商品を並べる理由がはっきりした企画にする（同じ場面・同じ相手・同じブランド・比較など）
- 社長の採用・却下の理由を手がかりにするが、1回の判断で決めつけない
- slots：商品の枠（3〜6）。role：企画の中での役割（例:本命・手頃な代替・まず1本目・5,000円枠）／keyword：楽天で探す検索語（名詞2〜4語。ブランド特集のときだけブランド名を入れる。型番は入れない）
- title：表紙のタイトル（24字以内。誇張しない）、target：誰向け（30字以内）、reason：この企画を選んだ理由（60字以内）、appeal：伝えたい魅力（60字以内）
出力形式: {"pattern":"gift","title":"...","target":"...","reason":"...","appeal":"...","slots":[{"role":"...","keyword":"..."}]}`;

export async function planSet({ history, recentPatterns = [], note = '', env, deadline, random = Math.random }) {
  const userContent = [
    recentPatterns.length ? `直近の企画パターン（避ける）: ${recentPatterns.join('、')}` : '',
    history.length ? `社長の判断の履歴:\n${historyLines(history).join('\n')}` : '社長の判断の履歴: まだありません',
    note ? `今回の方向の指示: ${note}` : '',
    `ばらつきのための数: ${Math.floor(random() * 1000)}`
  ].filter(Boolean).join('\n');
  const { result } = await runWithModels({
    env, deadline, system: PLAN_PROMPT, userContent,
    parse: (c) => {
      const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
      const slots = (Array.isArray(d.slots) ? d.slots : []).map((s) => ({
        role: clean(s && s.role, 16),
        keyword: clean(s && s.keyword, 40).replace(/[「」『』"'、。,.!?！？]/g, ' ').replace(/\s+/g, ' ').trim()
      })).filter((s) => s.role && s.keyword).slice(0, MAX_ITEMS);
      const title = clean(d.title, 30);
      if (slots.length < MIN_ITEMS || !title || NG_RE.test(title)) throw new AiError('企画を作れませんでした');
      return { pattern: PATTERNS[d.pattern] ? d.pattern : 'discovery', title, target: clean(d.target, 40), reason: clean(d.reason, 80), appeal: clean(d.appeal, 80), slots };
    }
  });
  return result;
}

// 枠ごとに楽天で探す（1枠1回。前に出した商品は外す）
export async function gatherSlots({ slots, exclude = new Set(), env, referer, until, perSlot = 6 }) {
  const out = [];
  for (const [i, s] of slots.entries()) {
    if (Date.now() + 1500 > until) { out.push({ ...s, candidates: [] }); continue; }
    if (i > 0) await sleep(1100); // 楽天APIは1秒1回まで
    try {
      const r = await searchPage({ keyword: s.keyword, env, referer, hits: 30 });
      const seen = new Set();
      const cands = r.items.filter((it) => {
        const k = nameKey(it.name);
        if (exclude.has(it.code) || exclude.has(k) || seen.has(k) || !it.image) return false;
        seen.add(k);
        return true;
      }).slice(0, perSlot);
      out.push({ ...s, candidates: cands });
    } catch (e) {
      out.push({ ...s, candidates: [], error: e.message });
      if (/40[13]/.test(e.message)) break;
    }
  }
  return out;
}

const PICK_PROMPT = `あなたは「眼科医くま」のバイヤーです。企画の枠ごとに、候補から商品を1つ選びます。JSONだけを返してください。
${POLICY}
守ること：
- 企画の中での役割に合わない枠は、選ばずに空けてよい（数合わせしない）
- feature：その商品の特徴（40字以内）。候補の商品名・説明に書いてあることだけ。書いていない機能・素材・数値・受賞歴を足さない
- why：この企画に入れる理由（40字以内）
- 体験したように書かない。根拠のない断定・煽り・医療の効果は書かない
出力形式: {"picks":[{"slot":0,"id":2,"feature":"...","why":"..."}]}`;

export async function pickProducts({ plan, slotResults, env, deadline }) {
  const lines = slotResults.map((s, i) => `枠${i}（役割: ${s.role}／検索語: ${s.keyword}）\n${s.candidates.map((c, j) => `  ${j}: ${compact(c.name, 70)} / ${c.price}円 / ${c.shop} / 説明: ${compact(c.caption, 110)}`).join('\n') || '  （候補なし）'}`);
  const { result } = await runWithModels({
    env, deadline, system: PICK_PROMPT,
    userContent: `企画: ${plan.title}（${PATTERNS[plan.pattern]}）\n誰向け: ${plan.target}\n伝えたい魅力: ${plan.appeal}\n${lines.join('\n')}`,
    parse: (c) => {
      const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
      const used = new Set();
      const out = [];
      for (const p of Array.isArray(d.picks) ? d.picks : []) {
        const si = Number(p && p.slot);
        const ci = Number(p && p.id);
        const slot = slotResults[si];
        if (!slot || used.has(si) || !Number.isInteger(ci) || !slot.candidates[ci]) continue;
        const feature = clean(p.feature, 60);
        const why = clean(p.why, 60);
        if (!feature || NG_RE.test(feature) || NG_RE.test(why)) continue; // 特徴が書けない（体験の言葉だけで消えた等）商品は選ばない
        used.add(si);
        out.push({ slot: si, item: slot.candidates[ci], feature, why });
      }
      if (!out.length) throw new AiError('商品を選べませんでした');
      return out.sort((a, b) => a.slot - b.slot);
    }
  });
  return result;
}

function toItem(p, role, now) {
  const it = p.item;
  const brand = (findBrand(it.name) || {}).name || '';
  const official = /公式|オフィシャル|official/i.test(it.shop || '');
  return {
    role, name: it.name, brand, price: it.price, postage: it.postage || '', priceCheckedAt: now.toISOString(),
    url: it.url, code: it.code, image: it.image, shop: it.shop, caption: compact(it.caption, 200),
    feature: p.feature, why: p.why,
    officialUrl: official ? it.url : '', officialNote: official ? `楽天の公式ショップ（${it.shop}）` : 'メーカー公式の商品ページは未取得',
    room: 'unregistered'
  };
}

// 品質確認（完成品として出してよいか）。問題があれば理由の一覧を返す
export function qualityCheck(set) {
  const issues = [];
  if (!set.title) issues.push('タイトルがない');
  if ((set.items || []).length < MIN_ITEMS) issues.push(`商品が${MIN_ITEMS}点に届かない（${(set.items || []).length}点）`);
  for (const it of set.items || []) {
    if (!(it.price > 0)) issues.push(`価格が取れていない：${it.name}`);
    if (!/^https:\/\/item\.rakuten\.co\.jp\//.test(it.url || '')) issues.push(`楽天の商品URLがない：${it.name}`);
    if (!it.image) issues.push(`商品画像がない：${it.name}`);
    if (NG_RE.test(`${it.feature} ${it.why}`)) issues.push(`体験・断定の表現：${it.name}`);
  }
  const names = new Set((set.items || []).map((it) => nameKey(it.name)));
  if (names.size !== (set.items || []).length) issues.push('同じ商品が重複している');
  return issues;
}

// 投稿セットを1件作る
export async function buildSet({ history = [], recentPatterns = [], exclude = new Set(), note = '', env, referer, startedAt = Date.now(), now = new Date() }) {
  const plan = await planSet({ history, recentPatterns, note, env, deadline: startedAt + 15000 });
  const slotResults = await gatherSlots({ slots: plan.slots, exclude, env, referer, until: startedAt + 25000 });
  const picks = await pickProducts({ plan, slotResults, env, deadline: startedAt + 55000 });
  const set = {
    id: `set-${now.getTime().toString(36)}`, createdAt: now.toISOString(),
    pattern: plan.pattern, patternLabel: PATTERNS[plan.pattern], title: plan.title, target: plan.target, reason: plan.reason, appeal: plan.appeal,
    slots: plan.slots, items: picks.map((p) => toItem(p, plan.slots[p.slot].role, now))
  };
  set.issues = qualityCheck(set);
  return set;
}

// 1商品の差し替え：同じ枠（役割・検索語）で、今の商品とほかの掲載商品を除いて選び直す
export async function replaceItem({ set, index, env, referer, startedAt = Date.now(), now = new Date() }) {
  const target = set.items[index];
  if (!target) throw new AiError('差し替える商品がありません');
  const slot = (set.slots || []).find((s) => s.role === target.role) || { role: target.role, keyword: compact(target.name, 20) };
  const exclude = new Set(set.items.flatMap((it) => [it.code, nameKey(it.name)]).concat(set.exclude || []));
  const [res] = await gatherSlots({ slots: [slot], exclude, env, referer, until: startedAt + 20000 });
  if (!res.candidates.length) throw new AiError('差し替えの候補が見つかりませんでした');
  const picks = await pickProducts({ plan: set, slotResults: [res], env, deadline: startedAt + 50000 });
  const items = set.items.slice();
  items[index] = toItem(picks[0], target.role, now);
  const next = { ...set, items };
  next.issues = qualityCheck(next);
  return next;
}
