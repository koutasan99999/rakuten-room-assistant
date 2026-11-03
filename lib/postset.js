// Instagram投稿セットの自動制作：AI社員が企画を決め、企画に合う実在の商品を楽天から3〜8点選んで、1つの投稿セットにする。
//   1. 企画（AI）：企画パターン・タイトル・誰向けか・選んだ理由・伝えたい魅力と、商品の枠（役割と楽天の検索語）を決める
//   2. 楽天で枠ごとに探す（1枠1回の検索）
//   3. 選定（AI）：枠ごとに、企画の中での役割に合う商品を1つ選び、特徴を書く。合わない枠は空けてよい（数合わせしない）
//   4. 品質確認（コード）：3点未満・価格やURLのない商品・体験の記述・根拠のない断定があれば、完成品にしない
// 画像（スライド）とキャプションは、画面で既存の仕組み（api/instagram と IgRender）を使って仕上げる。
// 商品名・価格・URL・画像は楽天のデータそのもの（AIに作らせない）。
import { searchPage, nameKey, lookupItem } from './rakuten.js';
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
export const MAX_ITEMS = 8;

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const clean = (v, n) => cleanText(v).replace(/\s+/g, ' ').trim().slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const NG_RE = /最安|絶対|必ず|神アイテム|バズ|話題沸騰|爆売れ|使ってみた|使ってます|愛用|買ってよかった|リピ買い|治る|効く|治療|眼科医が(勧|すすめ|おすすめ)/;

const POLICY = `お客様像：落ち着いているが無難ではない30代男性（本人用と、女性・男性への贈り物）。分野：服・靴・香り・インテリア・雑貨・ガジェット・ギフト。
Instagramで紹介する価値の基準：見た瞬間に興味を持てる／知らなかった商品との出会い／デザインや世界観の魅力／わざわざオンラインで買う理由／人に紹介したくなる特徴。
スーパーで買える一般的な日用品は、デザイン・機能・企画上の必然性がはっきりしない限り選ばない。
医薬品・医療機器・健康食品・メガネ・コンタクトなど、眼科医が勧めているように受け取られる商品は扱わない。`;

// 社長が「いいじゃん！（採用）」した商品（このiPhoneの PitchStore から届く）。商品名・価格・URL・画像は楽天のデータのまま
export function readAdopted(x) {
  const a = Array.isArray(x) ? x : [];
  const seen = new Set();
  const out = [];
  for (const p of a.slice(0, 40)) {
    if (!p || typeof p !== 'object') continue;
    const it = {
      key: str(p.key || p.code || p.url, 200), code: str(p.code, 120), name: str(p.name, 200), price: Number(p.price) || 0, postage: str(p.postage, 10),
      url: str(p.url, 400), image: str(p.image, 400), shop: str(p.shop, 60), brand: str(p.brand, 40), category: str(p.category, 10),
      caption: str(p.caption, 300), pitch: str(p.pitch, 200), fit: str(p.fit, 120), reason: str(p.reason, 120), fetchedAt: str(p.fetchedAt, 40), decidedAt: Number(p.decidedAt) || 0,
      path: str(p.path, 200), relation: str(p.relation, 80)
    };
    if (!it.name || !/^https:\/\/item\.rakuten\.co\.jp\//.test(it.url) || seen.has(it.key || it.name)) continue;
    seen.add(it.key || it.name);
    out.push(it);
  }
  return out.slice(0, 20);
}
function adoptedLines(adopted) {
  return adopted.map((a, i) => `A${i}: ${compact(a.name, 70)} / ${a.price}円 / ${a.category || '分類なし'}${a.brand ? ` / ${a.brand}` : ''}${a.reason ? ` / 社長の採用理由: ${a.reason}` : ''}${a.path ? ` / 見つけた経路: ${compact(a.path, 120)}` : ''}${a.relation ? ` / 関係: ${a.relation}` : ''}${a.pitch ? ` / 説明: ${compact(a.pitch, 80)}` : ''}`);
}

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

const PLAN_PROMPT = `あなたは「眼科医くま」のInstagram企画担当とバイヤーです。1つの投稿で3〜8商品を紹介する企画を1つ決めます。JSONだけを返してください。
${POLICY}
- 「社長が採用した商品」が渡されたら、それを優先して企画の中心にする。adopted に使う商品（id と役割と特徴と理由）を入れる。
  ただし、企画として自然に並ぶものだけを使う（分野・相手・場面がばらばらの商品を無理に1つの投稿へ詰め込まない）。1つも自然に使えないときだけ adopted を空にする
- adopted の feature：その商品の特徴（40字以内。商品名・説明に書いてあることだけ）／why：この企画に入れる理由（40字以内）
- 採用した商品に「見つけた経路」（例：Tシャツ →（似たデザインでもっと安い）→ 別のTシャツ）があれば、その関係を企画に使う（本命と安い代替の比較・休日コーデ・同価格帯の比較・合わせたい小物など）
- slots は、採用した商品だけでは足りない分（採用した商品と合わせて3〜8点）。採用した商品で3点以上そろうなら slots は空でもよい。社長が探していなくても、採用商品の安い代替・同価格帯・合わせる物を自分で探してよい
- 価格帯に幅を持たせる：比較・セレクトの企画は、高価格帯3・中価格帯3・低価格帯2を基本にする（価格の高低はその商品の分類の中で考える）。高級ブランド特集・新商品速報・予算を決めたギフトは企画に合わせて変えてよい。低価格帯も、安さだけでなく選ぶ理由がある物にする。slots の role に「高価格帯」「中価格帯」「低価格帯」のどれかを含める
- 企画パターンは次から1つ（直近の企画と同じパターンは避ける）：${Object.entries(PATTERNS).map(([k, v]) => `${k}=${v}`).join('／')}
- 商品を並べる理由がはっきりした企画にする（同じ場面・同じ相手・同じブランド・比較など）
- 社長の採用・却下の理由を手がかりにするが、1回の判断で決めつけない
- slots：商品の枠（3〜8）。role：企画の中での役割（例:本命・手頃な代替・まず1本目・5,000円枠）／keyword：楽天で探す検索語（名詞2〜4語。ブランド特集のときだけブランド名を入れる。型番は入れない）
- title：表紙のタイトル（24字以内。誇張しない）、target：誰向け（30字以内）、reason：この企画を選んだ理由（60字以内）、appeal：伝えたい魅力（60字以内）
出力形式: {"pattern":"gift","title":"...","target":"...","reason":"...","appeal":"...","adopted":[{"id":0,"role":"...","feature":"...","why":"..."}],"slots":[{"role":"...","keyword":"..."}]}`;

export async function planSet({ history, recentPatterns = [], adopted = [], note = '', env, deadline, random = Math.random }) {
  const userContent = [
    adopted.length ? `社長が採用した商品（優先して使う。まだ投稿にしていないもの）:\n${adoptedLines(adopted).join('\n')}` : '社長が採用した商品: まだ投稿にしていないものはありません（AIが新しく探す）',
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
      const used = new Set();
      const picked = [];
      for (const a of Array.isArray(d.adopted) ? d.adopted : []) {
        const id = Number(String(a && a.id).replace(/^A/i, ''));
        if (!Number.isInteger(id) || !adopted[id] || used.has(id)) continue;
        const feature = clean(a.feature, 60);
        const why = clean(a.why, 60);
        used.add(id);
        picked.push({ id, role: clean(a.role, 16) || '社長の採用', feature: NG_RE.test(feature) ? '' : feature, why: NG_RE.test(why) ? '' : why });
      }
      const slotsLeft = slots.slice(0, MAX_ITEMS - picked.slice(0, MAX_ITEMS).length);
      const title = clean(d.title, 30);
      if (picked.length + slotsLeft.length < MIN_ITEMS || !title || NG_RE.test(title)) throw new AiError('企画を作れませんでした');
      return { pattern: PATTERNS[d.pattern] ? d.pattern : 'discovery', title, target: clean(d.target, 40), reason: clean(d.reason, 80), appeal: clean(d.appeal, 80), adopted: picked.slice(0, MAX_ITEMS), slots: slotsLeft };
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

function toItem(p, role, now, source = 'ai') {
  const it = p.item;
  const brand = (findBrand(it.name) || {}).name || '';
  const official = /公式|オフィシャル|official/i.test(it.shop || '');
  return {
    role, name: it.name, brand, price: it.price, postage: it.postage || '', priceCheckedAt: now.toISOString(),
    url: it.url, code: it.code, image: it.image, shop: it.shop, caption: compact(it.caption, 200),
    feature: p.feature, why: p.why,
    officialUrl: official ? it.url : '', officialNote: official ? `楽天の公式ショップ（${it.shop}）` : 'メーカー公式の商品ページは未取得',
    room: 'unregistered', source
  };
}

// 採用した商品を楽天で引き直す（価格・掲載の確認）。見つからなければ使わない（販売終了の可能性）。通信の失敗は採用時のデータで続ける
async function refreshAdopted({ list, env, referer, until }) {
  const out = [];
  const missing = [];
  for (const [i, a] of list.entries()) {
    const base = a.item;
    let fresh = null;
    let checked = false;
    if (base.code && Date.now() + 1500 < until) {
      if (i > 0) await sleep(1100);
      try { fresh = await lookupItem({ code: base.code, env, referer }); checked = true; } catch (e) { if (/40[13]/.test(e.message)) break; }
    }
    if (checked && !fresh) { missing.push(base.name); continue; }
    const it = fresh ? { ...base, price: fresh.price || base.price, postage: fresh.postage || base.postage, url: fresh.url || base.url, image: fresh.image || base.image, shop: fresh.shop || base.shop, caption: base.caption || fresh.caption } : base;
    out.push({ ...a, item: it, checked });
  }
  return { out, missing };
}
function adoptedItem(a, role, now) {
  const x = toItem({ item: a.item, feature: a.feature || compact(a.item.pitch || a.item.fit || '', 40), why: a.why }, role, now, 'adopted');
  x.adoptedKey = a.item.key || a.item.code;
  x.adoptedReason = a.item.reason || '';
  if (!a.checked) { x.priceCheckedAt = a.item.fetchedAt || ''; x.priceNote = '価格は採用時点のもの（楽天で再確認できませんでした）'; }
  return x;
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
// 採用した商品（adopted）があれば、それを優先して企画の中心にし、足りない分だけAIが楽天で探す
export async function buildSet({ history = [], recentPatterns = [], adopted = [], exclude = new Set(), note = '', env, referer, startedAt = Date.now(), now = new Date() }) {
  const plan = await planSet({ history, recentPatterns, adopted, note, env, deadline: startedAt + 15000 });
  const chosen = plan.adopted.map((a) => ({ ...a, item: adopted[a.id] }));
  const { out: fresh, missing } = await refreshAdopted({ list: chosen, env, referer, until: startedAt + 22000 });
  const ex = new Set([...exclude, ...adopted.flatMap((a) => [a.code, nameKey(a.name)])]);
  if (fresh.length) await sleep(1100);
  const slotResults = plan.slots.length ? await gatherSlots({ slots: plan.slots, exclude: ex, env, referer, until: startedAt + 30000 }) : [];
  const picks = slotResults.length ? await pickProducts({ plan, slotResults, env, deadline: startedAt + 55000 }).catch((e) => { if (fresh.length) return []; throw e; }) : [];
  const set = {
    id: `set-${now.getTime().toString(36)}`, createdAt: now.toISOString(),
    pattern: plan.pattern, patternLabel: PATTERNS[plan.pattern], title: plan.title, target: plan.target, reason: plan.reason, appeal: plan.appeal,
    slots: fresh.map((a) => ({ role: a.role, keyword: compact(a.item.name, 20) })).concat(plan.slots),
    items: fresh.map((a) => adoptedItem(a, a.role, now)).concat(picks.map((p) => toItem(p, plan.slots[p.slot].role, now))),
    adoptedOffered: adopted.length, adoptedMissing: missing
  };
  set.issues = qualityCheck(set);
  return set;
}

// 差し替えの候補を出す：社長が採用したがまだ投稿にしていない商品と、同じ枠（理由があれば理由に沿った検索語）の楽天の商品から、AIが3〜4点を選ぶ。
// 社長が選んだら、画面で商品一覧を入れ替え、表紙・商品カードの文字とキャプションを作り直す
const ALT_PROMPT = `あなたは「眼科医くま」のバイヤーです。投稿セットの1商品を差し替える候補を選びます。JSONだけを返してください。
${POLICY}
守ること：
- 企画の中での役割と、社長の修正理由（あれば最優先）に合う候補を、良い順に最大4つ。合うものがなければ少なくてよい
- 「社長が採用」の候補（S番号）が企画に自然に合うなら優先する。合わないなら選ばない
- keyword：修正理由に沿って楽天で探し直すなら、その検索語（名詞2〜4語）。いらなければ空
- feature：その商品の特徴（40字以内。商品名・説明に書いてあることだけ）／why：この企画に入れる理由（40字以内）
- 体験したように書かない。根拠のない断定・煽り・医療の効果は書かない
出力形式: {"picks":[{"id":"S0","feature":"...","why":"..."},{"id":"R2","feature":"...","why":"..."}]}`;

export async function alternatives({ set, index, reason = '', adopted = [], env, referer, startedAt = Date.now(), now = new Date() }) {
  const target = (set.items || [])[index];
  if (!target) throw new AiError('差し替える商品がありません');
  const inSet = new Set((set.items || []).flatMap((it) => [it.code, nameKey(it.name)]));
  const slot = (set.slots || []).find((s) => s.role === target.role) || { role: target.role, keyword: compact(target.name, 20) };
  let keyword = slot.keyword;
  // 理由があれば、まず検索語をAIに決めてもらう（例：「もっと高級感」→ 本革 キーケース 日本製）
  if (reason) {
    try {
      const { result } = await runWithModels({
        env, deadline: startedAt + 12000,
        system: '楽天市場で商品を探す検索語を1つ決めます。名詞2〜4語。型番は入れない。JSONだけを返す。出力形式: {"keyword":"..."}',
        userContent: `企画: ${set.title}\n役割: ${target.role}\n今の商品: ${compact(target.name, 60)}\n今の検索語: ${slot.keyword}\n社長の修正理由: ${reason}`,
        parse: (c) => { const k = clean(JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]).keyword, 40).replace(/[「」『』"'、。,.!?！？]/g, ' ').trim(); if (!k) throw new AiError('検索語なし'); return k; }
      });
      keyword = result;
    } catch (e) { /* 決められなければ同じ枠の検索語で探す */ }
  }
  const ex = new Set([...inSet, ...(set.exclude || [])]);
  const [res] = await gatherSlots({ slots: [{ ...slot, keyword }], exclude: ex, env, referer, until: startedAt + 25000, perSlot: 8 });
  const own = adopted.filter((a) => !inSet.has(a.code) && !inSet.has(nameKey(a.name))).slice(0, 8);
  if (!res.candidates.length && !own.length) throw new AiError('差し替えの候補が見つかりませんでした');
  const lines = [
    ...own.map((a, i) => `S${i}（社長が採用）: ${compact(a.name, 70)} / ${a.price}円 / ${a.category || ''}${a.reason ? ` / 採用理由: ${a.reason}` : ''} / 説明: ${compact(a.pitch || a.caption, 100)}`),
    ...res.candidates.map((c, i) => `R${i}: ${compact(c.name, 70)} / ${c.price}円 / ${c.shop} / 説明: ${compact(c.caption, 110)}`)
  ];
  const { result } = await runWithModels({
    env, deadline: startedAt + 55000, system: ALT_PROMPT,
    userContent: `企画: ${set.title}（${PATTERNS[set.pattern] || ''}）\n誰向け: ${set.target || ''}\n伝えたい魅力: ${set.appeal || ''}\n差し替える商品: ${compact(target.name, 60)}（役割: ${target.role}）\n社長の修正理由: ${reason || 'なし'}\n候補:\n${lines.join('\n')}`,
    parse: (c) => {
      const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
      const used = new Set();
      const out = [];
      for (const p of Array.isArray(d.picks) ? d.picks : []) {
        const m = String(p && p.id).match(/^([SR])(\d+)$/i);
        if (!m || used.has(m[0].toUpperCase())) continue;
        const isOwn = m[1].toUpperCase() === 'S';
        const src = isOwn ? own[Number(m[2])] : res.candidates[Number(m[2])];
        if (!src) continue;
        const feature = clean(p.feature, 60);
        const why = clean(p.why, 60);
        if (NG_RE.test(feature) || NG_RE.test(why) || (!isOwn && !feature)) continue;
        used.add(m[0].toUpperCase());
        out.push(isOwn ? adoptedItem({ item: src, feature, why, checked: false }, target.role, now) : toItem({ item: src, feature, why }, target.role, now));
      }
      if (!out.length) throw new AiError('合う候補が見つかりませんでした');
      return out.slice(0, 4);
    }
  });
  // 採用した商品の候補は、選ぶ前に楽天で価格を確認し直す（見つからなければ外す）
  const checked = [];
  for (const it of result) {
    if (it.source !== 'adopted' || !it.code || Date.now() + 1500 > startedAt + 58000) { checked.push(it); continue; }
    await sleep(1100);
    try {
      const f = await lookupItem({ code: it.code, env, referer });
      if (!f) continue;
      checked.push({ ...it, price: f.price || it.price, postage: f.postage || it.postage, url: f.url || it.url, image: f.image || it.image, priceCheckedAt: now.toISOString(), priceNote: '' });
    } catch (e) { checked.push(it); }
  }
  return { keyword, candidates: checked };
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
