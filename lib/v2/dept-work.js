// 部署別の0円の仕事（2026-11-24・KOT-17）：AIも外部サイトも使わず、保存済みのデータだけから「具体的な成果物」を作る
//   KOT-13 の資料20ページの手法（登録済みの要約に基づく。資料の原本は直接確認していない）を、管理画面の説明ではなく実際の部署別の仕事にする
//   種類の分け方：free＝決定論的な無料処理（このファイルで実装）／external＝外部データが要る（未実装・実行済みにしない）／ai＝AIの推論が要る（予算の範囲・既存の仕事）
//   守ること：新規ROOM紹介は作らない（停止中のまま）／数字は保存された実データだけ・料率は仮説と明記／投稿・送信・購入はしない
//   変化が無ければ仕事にしない（署名が同じなら作り直さない＝稼働の演出をしない）
import { calendar } from './profit.js';
import { postable } from './kpi.js';

export const FK = { products: 'v2:free:products', plan: 'v2:free:plan', reuse: 'v2:free:reuse', assets: 'v2:free:assets', edit: 'v2:free:edit', tracking: 'v2:free:tracking', queue: 'v2:free:queue', log: 'v2:free:log', gap: 'v2:free:gap', decision: 'v2:free:decision', exec: 'v2:free:exec' };
const K = { sets: 'v2:sets', set: (id) => `v2:set:${id}`, perf: 'v2:perf', ventures: 'v2:ventures', calendar: 'v2:profit:calendar', rate: 'v2:profit:rate' };
const NAMES = { buyer: 'バイヤー', auditor: '監査', planner: '企画', writer: 'ライター', editor: '編集', designer: 'デザイナー', pr: '広報', appraiser: '鑑定' };
const now = () => new Date().toISOString();
const jst = (d = new Date()) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const RATE_HYPOTHESIS = 0.03; // 仮説（公式で未確認）。社長が公式の料率を登録すると置き換わる
const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;

// ---- 棚卸し：部署ごとの収益につながる仕事と、その種類・実装状況（資料20ページの手法との対応つき） ----
export const INVENTORY = [
  { dept: 'buyer', task: '既存の完成品の商品データの報酬の目安・欠損・重複の比較', kind: 'free', impl: true, method: 'compare', out: '商品の報酬の比較表（v2:free:products）' },
  { dept: 'buyer', task: '新商品の探索（楽天の検索）', kind: 'external', impl: true, note: '新規ROOM紹介の停止中は止めている（KOT-13）', method: 'new-room' },
  { dept: 'buyer', task: '競合・実レビューの分析', kind: 'external', impl: false, note: '公式に取る手段が無い（保留）', method: 'reviews' },
  { dept: 'planner', task: '既存企画の重複・需要仮説の整理と、販促日程との突き合わせ', kind: 'free', impl: true, method: 'calendar', out: '企画の整理と日程（v2:free:plan）' },
  { dept: 'planner', task: '新しい案件・事業案の企画', kind: 'ai', impl: true, note: 'AIの予算が要る', method: 'pain' },
  { dept: 'writer', task: '既存の文章の再利用案（テンプレの組み立て・事実だけ）', kind: 'free', impl: true, method: 'reuse', out: '再利用の下書き（v2:free:reuse）' },
  { dept: 'writer', task: '冒頭の一言・検索の文言の推敲', kind: 'ai', impl: true, note: 'AIの予算が要る', method: 'angles' },
  { dept: 'designer', task: '既存の画像の素材点検（表紙・商品画像・AI生成の表示・サイズの記録）', kind: 'free', impl: true, method: 'reuse', out: '素材の点検表（v2:free:assets）' },
  { dept: 'designer', task: '表紙画像の作成・作り直し', kind: 'ai', impl: true, note: '画像の予算が要る（月200円・1日2枚）' },
  { dept: 'editor', task: '完成品の不足項目チェック（文字数・ハッシュタグ・紹介文の重複）', kind: 'free', impl: true, method: 'reuse', out: '不足項目の一覧（v2:free:edit）' },
  { dept: 'editor', task: 'くまの一言メモの書き直し', kind: 'ai', impl: true, note: 'AIの予算が要る' },
  { dept: 'pr', task: '既存の導線・計測の設計と、投稿の順番案（日程つき）', kind: 'free', impl: true, method: 'funnel', out: '計測設計（v2:free:tracking）' },
  { dept: 'pr', task: 'コメント案・プロフィール案', kind: 'ai', impl: true, note: 'AIの予算が要る・送信は社長の手' },
  { dept: 'auditor', task: '販売導線の点検・商品の確かめ直し', kind: 'free', impl: true, method: 'official', out: '完成品の funnel・楽天での再確認' },
  { dept: 'appraiser', task: '成果の記録・計測の不足・週ごとの見直し・改善の優先順位', kind: 'free', impl: true, method: 'weekly', out: '部署別キュー（v2:free:queue）' },
  { dept: 'appraiser', task: '楽天の売上・Instagramの数字の自動取得', kind: 'external', impl: false, note: '公式の鍵・社長の登録が要る' }
];

// ---- 共通 ----
async function loadSets(kv, statuses = ['waiting', 'adopted', 'posted']) {
  const list = ((await kv.getJson(K.sets)) || []).filter((x) => statuses.includes(x.status)).slice(0, 40);
  const out = [];
  for (const x of list) { const s = await kv.getJson(K.set(x.id)); if (s) out.push({ ...s, id: x.id, status: x.status }); }
  return out;
}
const setSig = (sets) => sets.map((s) => [s.id, s.status, s.deliveredAt || '', (s.products || []).length, s.image ? 1 : 0, s.hooks ? 1 : 0]);
async function rateInfo(kv) {
  const r = await kv.getJson(K.rate);
  return r && Number(r.rate) > 0 ? { rate: Number(r.rate), kind: 'actual', basis: '社長が公式で確認した料率' } : { rate: RATE_HYPOTHESIS, kind: 'hypothesis', basis: '仮説：料率3%（公式で未確認）' };
}
async function record(kv, dept, kind, title, summary) { await kv.pushJson(FK.log, { at: now(), dept, kind, title, summary: String(summary).slice(0, 200), yen: 0 }, 80); }
// 仕事の共通の形：署名が前回と同じなら仕事にしない
async function sigWork(kv, key, sig) { const last = await kv.getJson(key); return !(last && last.sig === JSON.stringify(sig)); }
const bigrams = (t) => { const s = String(t || '').replace(/[\s　【】「」『』（）()・、。!！?？]/g, ''); const a = new Set(); for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2)); return a; };
const jacc = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };

// ---- 1. バイヤー：商品データの報酬・欠損・重複の比較 ----
export function compareProducts(sets, ri) {
  const rows = []; const codes = new Map();
  for (const s of sets) {
    for (const p of s.products || []) {
      const price = Number(p.price) > 0 ? Number(p.price) : null;
      const gaps = [];
      if (price == null) gaps.push('価格');
      if (!p.code) gaps.push('商品番号');
      if (!p.url) gaps.push('URL');
      if (!p.image) gaps.push('商品画像');
      if (p.unverified) gaps.push('価格が未確認');
      rows.push({ setId: s.id, set: s.title, name: String(p.short || p.name || '').slice(0, 40), price, reward: price == null ? null : Math.round(price * ri.rate * 10) / 10, gaps, code: p.code || '' });
      if (p.code) codes.set(p.code, [...(codes.get(p.code) || []), s.title]);
    }
  }
  const dups = [...codes.entries()].filter(([, t]) => new Set(t).size > 1).map(([code, t]) => ({ code, sets: [...new Set(t)] }));
  const ranked = rows.filter((r) => r.reward != null).sort((a, b) => b.reward - a.reward);
  return { rows, ranked: ranked.slice(0, 5), top: ranked[0] || null, gapRows: rows.filter((r) => r.gaps.length), dups };
}
export async function productCompareWork(kv) {
  const sets = await loadSets(kv); if (!sets.length) return null;
  const ri = await rateInfo(kv); const sig = [setSig(sets), ri.rate];
  if (!(await sigWork(kv, FK.products, sig))) return null;
  return { kind: 'product-compare', task: `既存の完成品${sets.length}件の商品を、報酬の目安・欠けている情報・重複で比べる（AIも外部サイトも使わない・0円）`, doing: '商品データの報酬と欠損を比べています', est: 0, run: async () => {
    const c = compareProducts(sets, ri);
    const queue = [];
    if (c.gapRows.length) queue.push({ dept: 'auditor', task: `商品${c.gapRows.length}点の欠けている情報（${[...new Set(c.gapRows.flatMap((r) => r.gaps))].join('・')}）を確かめ直す`, why: `例：「${c.gapRows[0].set}」の${c.gapRows[0].name}＝${c.gapRows[0].gaps.join('・')}`, need: 'free', priority: 2 });
    if (c.dups.length) queue.push({ dept: 'planner', task: `同じ商品が複数の完成品にある（${c.dups.length}件）。訴求を分けるか1つに絞る`, why: c.dups[0].sets.join('と'), need: 'free', priority: 3 });
    if (c.top) queue.push({ dept: 'pr', task: `報酬の目安がいちばん高い商品「${c.top.name}」（${yen(c.top.price)}・目安 ${yen(c.top.reward)}／1件）を含む完成品「${c.top.set}」の投稿を優先して検討`, why: `${ri.basis}。目安であり売上の保証ではない`, need: 'owner', priority: 2 });
    await kv.setJson(FK.products, { at: now(), sig: JSON.stringify(sig), rate: ri, count: c.rows.length, top: c.ranked, gapCount: c.gapRows.length, gaps: c.gapRows.slice(0, 12), dups: c.dups.slice(0, 8), queue });
    await record(kv, 'buyer', 'product-compare', '商品の報酬・欠損の比較', `商品${c.rows.length}点・欠損${c.gapRows.length}点・重複${c.dups.length}件`);
    return { done: `商品${c.rows.length}点を比べた：報酬の目安が最大は「${c.top ? c.top.name : '未計算'}」${c.top ? `（${yen(c.top.reward)}・${ri.kind === 'actual' ? '公式の料率' : '仮説の料率3%'}）` : ''}。情報が欠けた商品${c.gapRows.length}点・重複${c.dups.length}件。監査へ引き継ぎ`, title: '商品の報酬・欠損の比較', handoff: c.gapRows.length ? 'auditor' : undefined, what: '欠けた商品情報の確かめ直し' };
  } };
}

// ---- 2. 企画：重複・需要仮説の整理と販促日程の突き合わせ ----
export function organizePlan(sets, ventureItems, cal) {
  const titles = [...sets.map((s) => ({ t: s.title, src: '完成品' })), ...ventureItems.map((v) => ({ t: v.title || v.name || '', src: '事業案' })).filter((x) => x.t)];
  const dup = [];
  for (let i = 0; i < titles.length; i++) for (let j = i + 1; j < titles.length; j++) { const j2 = jacc(bigrams(titles[i].t), bigrams(titles[j].t)); if (j2 >= 0.45) dup.push({ a: titles[i].t, b: titles[j].t, score: Math.round(j2 * 100) / 100 }); }
  const bands = {}; for (const s of sets) for (const p of s.products || []) { const b = p.band || '価格帯不明'; bands[b] = (bands[b] || 0) + 1; }
  const events = cal.items.filter((e) => e.start <= jst(new Date(Date.now() + 60 * 86400000))).slice(0, 6).map((e) => {
    const key = e.name.replace(/[（(].*$/, '').replace(/デー$/, '');
    const hit = sets.filter((s) => [s.title, s.theme, s.caption].join(' ').includes(key)).map((s) => s.title);
    return { name: e.name, start: e.start, kind: e.kind, fit: hit.slice(0, 3), basis: e.basis };
  });
  return { dup, bands, events, total: titles.length };
}
export async function planOrganizeWork(kv) {
  const sets = await loadSets(kv); const v = (await kv.getJson(K.ventures)) || {}; const items = Array.isArray(v.items) ? v.items : [];
  if (!sets.length && !items.length) return null;
  const sig = [setSig(sets), items.map((x) => [x.id, x.status]), jst()];
  if (!(await sigWork(kv, FK.plan, sig))) return null;
  return { kind: 'plan-organize', task: `既存の企画${sets.length + items.length}件の重複と需要の偏りを整理し、60日以内の販促日程と突き合わせる（AIも外部サイトも使わない・0円）`, doing: '既存の企画の重複と販促日程を整理しています', est: 0, run: async () => {
    const cal = calendar((await kv.getJson(K.calendar)) || []);
    const o = organizePlan(sets, items, cal);
    const queue = [];
    if (o.dup.length) queue.push({ dept: 'planner', task: `重複の疑いが強い企画${o.dup.length}組を1つに絞るか訴求を分ける`, why: `例：「${o.dup[0].a}」と「${o.dup[0].b}」（類似度${o.dup[0].score}）`, need: 'free', priority: 3 });
    const noFit = o.events.filter((e) => !e.fit.length);
    const fit = o.events.filter((e) => e.fit.length);
    if (fit[0]) queue.push({ dept: 'pr', task: `${fit[0].start}の「${fit[0].name}」に合う既存の完成品「${fit[0].fit[0]}」を、その前に投稿する順番の候補にする`, why: '既存の完成品の再利用（新規ROOM紹介は停止中）', need: 'owner', priority: 1 });
    if (noFit[0]) queue.push({ dept: 'planner', task: `${noFit[0].start}の「${noFit[0].name}」に合う既存の完成品が無い。既存の再利用か、社長が再開を判断するまで待つ`, why: '新規ROOM商品紹介は停止中（KOT-13）。勝手に作らない', need: 'owner', priority: 4 });
    await kv.setJson(FK.plan, { at: now(), sig: JSON.stringify(sig), ...o, queue, note: '需要は仮説（外部の需要データは未取得）。日付は暦と社長が登録した公式の日付だけ' });
    await record(kv, 'planner', 'plan-organize', '企画の整理と日程', `企画${o.total}件・重複候補${o.dup.length}組・60日以内の行事${o.events.length}件（合う完成品あり${fit.length}）`);
    return { done: `企画${o.total}件を整理：重複候補${o.dup.length}組。60日以内の行事${o.events.length}件のうち、既存の完成品で合うもの${fit.length}件${fit[0] ? `（「${fit[0].name}」→「${fit[0].fit[0]}」）` : ''}。広報へ引き継ぎ`, title: '企画の整理と販促日程', handoff: queue.some((q) => q.dept === 'pr') ? 'pr' : undefined, what: '投稿の順番の候補' };
  } };
}

// ---- 3. ライター：既存の文章の再利用案（テンプレの組み立て・事実だけ） ----
const NG = /使ってみ|愛用|最強|絶対|必ず|治る|効果が|おすすめ度|No\.?1/;
export function reuseVariants(s) {
  const ps = (s.products || []).filter((p) => Number(p.price) > 0);
  if (!ps.length) return [];
  const prices = ps.map((p) => Number(p.price)); const lo = Math.min(...prices); const hi = Math.max(...prices);
  const hero = ps[0]; const nm = String(hero.short || hero.name || '').slice(0, 20);
  const out = [
    { type: 'price', text: `${yen(lo)}〜${yen(hi)}で比べられる${ps.length}点をまとめました（${nm}ほか）`, basis: '商品の保存済みの価格の最小・最大' },
    { type: 'order', text: `最初に見てほしいのは「${nm}」（${yen(hero.price)}）。ほかの${ps.length - 1}点は代わりの候補です`, basis: '本命と代替の順番（保存済み）' }
  ];
  if (s.who && s.problem) out.push({ type: 'target', text: `${String(s.who).slice(0, 20)}の方へ：${String(s.problem).slice(0, 30)}を考えるときの候補です`, basis: '企画に保存された対象と課題' });
  return out.filter((v) => !NG.test(v.text)).map((v) => ({ ...v, text: `${v.text.slice(0, 80)}（PR）` }));
}
export async function reuseDraftWork(kv) {
  const sets = (await loadSets(kv)).filter((s) => postable(s).ok);
  const saved = (await kv.getJson(FK.reuse)) || { sets: {} };
  const todo = sets.filter((s) => !saved.sets[s.id] || saved.sets[s.id].ver !== (s.deliveredAt || ''));
  if (!todo.length) return null;
  const s0 = todo[0];
  return { kind: 'reuse-draft', task: `投稿できる完成品「${s0.title}」の既存の文章・商品データから、冒頭の言い回しの別案をテンプレで組み立てる（AIは使わない・0円・下書き）`, doing: '既存の文章の再利用案を組み立てています', est: 0, run: async () => {
    const cur = (await kv.getJson(FK.reuse)) || { sets: {} };
    const v = reuseVariants(s0);
    cur.sets[s0.id] = { ver: s0.deliveredAt || '', title: s0.title, at: now(), variants: v, note: 'テンプレの組み立て。AIの推敲は未実施。投稿前に社長が確認する（体験・効果は書かない）' };
    cur.at = now();
    cur.queue = Object.values(cur.sets).slice(-1).flatMap((x) => (x.variants.length ? [{ dept: 'pr', task: `「${x.title}」の冒頭の別案${x.variants.length}つのどれで投稿するか決める（閲覧を比べる）`, why: '同じ完成品で言い回しだけ変えて比べる（新規ROOM紹介は作らない）', need: 'owner', priority: 3 }] : []));
    await kv.setJson(FK.reuse, cur);
    await record(kv, 'writer', 'reuse-draft', s0.title, `別案${v.length}つ`);
    return { done: v.length ? `「${s0.title}」の冒頭の別案を${v.length}つ組み立てた（例：${v[0].text.slice(0, 50)}）。事実は保存済みの価格・順番だけ。広報へ引き継ぎ` : `「${s0.title}」は価格のある商品が無く、別案を作れなかった（未確認のまま）`, title: s0.title, handoff: v.length ? 'pr' : undefined, what: '冒頭の別案での投稿の比較' };
  } };
}

// ---- 4. デザイナー：既存の画像の素材点検 ----
export function assetProblems(s) {
  const issues = []; const ps = s.products || [];
  if (!(s.image && (s.image.mediaId || s.image.url))) issues.push('表紙画像が無い');
  else if (s.image.label !== 'AI生成イメージ' && s.image.mediaId) issues.push('表紙に「AI生成イメージ」の表示が記録されていない');
  const noImg = ps.filter((p) => !p.image).length;
  if (noImg) issues.push(`商品画像のURLが無い商品${noImg}点`);
  const httpImg = ps.filter((p) => p.image && !/^https:\/\//.test(String(p.image))).length;
  if (httpImg) issues.push(`https でない商品画像${httpImg}点`);
  return issues;
}
export async function assetCheckWork(kv) {
  const sets = await loadSets(kv); if (!sets.length) return null;
  const sig = [setSig(sets)];
  if (!(await sigWork(kv, FK.assets, sig))) return null;
  return { kind: 'asset-check', task: `既存の完成品${sets.length}件の画像（表紙・商品画像・AI生成の表示）を点検する（AIも外部サイトも使わない・0円）`, doing: '既存の画像の素材を点検しています', est: 0, run: async () => {
    const rows = sets.map((s) => ({ id: s.id, title: s.title, issues: assetProblems(s), regen: s.regenCount || 0 }));
    const bad = rows.filter((r) => r.issues.length);
    const noCover = rows.filter((r) => r.issues.some((i) => /表紙画像が無い/.test(i)));
    const queue = [];
    if (noCover.length) queue.push({ dept: 'designer', task: `表紙の無い完成品${noCover.length}件の表紙を描く（画像の予算が要る）`, why: `例：「${noCover[0].title}」`, need: 'ai', priority: 2 });
    if (bad.length - noCover.length > 0) queue.push({ dept: 'editor', task: '商品画像・AI生成の表示の記録が欠けた完成品を直す', why: bad.find((r) => !noCover.includes(r)).issues.join('・'), need: 'free', priority: 3 });
    await kv.setJson(FK.assets, { at: now(), sig: JSON.stringify(sig), rows: rows.slice(0, 40), badCount: bad.length, sizeNote: '画像のピクセルサイズは保存していない（未確認）。実ファイルを開いて確かめる仕組みは未実装', queue });
    await record(kv, 'designer', 'asset-check', '画像の素材点検', `点検${rows.length}件・不備${bad.length}件`);
    return { done: `画像を${rows.length}件点検：不備${bad.length}件${bad[0] ? `（例：「${bad[0].title}」＝${bad[0].issues[0]}）` : ''}。画像のサイズは保存していないため未確認${bad.length ? '。編集へ引き継ぎ' : ''}`, title: '画像の素材点検', handoff: bad.length - noCover.length > 0 ? 'editor' : undefined, what: '欠けた画像情報の補い' };
  } };
}

// ---- 5. 編集：完成品の不足項目チェック ----
export function editProblems(s) {
  const out = [];
  const cap = String(s.caption || '');
  if (cap.length < 40) out.push(`キャプションが短い（${cap.length}文字）`);
  if (cap.length > 2200) out.push('キャプションがInstagramの上限（2200文字）を超える');
  const tags = s.hashtags || [];
  if (!tags.length) out.push('ハッシュタグが無い'); else if (tags.length > 30) out.push('ハッシュタグが30個を超える');
  const rooms = (s.products || []).map((p) => String(p.room || '').trim());
  const empty = rooms.filter((r) => !r).length;
  if (empty) out.push(`ROOM紹介文が空の商品${empty}点`);
  const dup = rooms.filter((r) => r).length - new Set(rooms.filter((r) => r)).size;
  if (dup > 0) out.push(`同じROOM紹介文が${dup}点で重複`);
  const short = rooms.filter((r) => r && r.length < 20).length;
  if (short) out.push(`ROOM紹介文が20文字未満の商品${short}点`);
  if (!(s.products || []).every((p) => p.no)) out.push('紹介番号が無い商品がある');
  return out;
}
export async function editCheckWork(kv) {
  const sets = await loadSets(kv); if (!sets.length) return null;
  const sig = [setSig(sets)];
  if (!(await sigWork(kv, FK.edit, sig))) return null;
  return { kind: 'edit-check', task: `既存の完成品${sets.length}件の不足項目（文字数・ハッシュタグ・紹介文の重複・紹介番号）を点検する（AIは使わない・0円）`, doing: '完成品の不足項目を点検しています', est: 0, run: async () => {
    const rows = sets.map((s) => ({ id: s.id, title: s.title, issues: editProblems(s) }));
    const bad = rows.filter((r) => r.issues.length);
    const noNo = rows.filter((r) => r.issues.some((i) => /紹介番号/.test(i)));
    const queue = [];
    if (noNo.length) queue.push({ dept: 'editor', task: `紹介番号が無い完成品${noNo.length}件に番号を付ける（既存の安全な番号付与で自動実行）`, why: '台帳・鍵・再利用なしの既存の仕組み', need: 'free', exec: 'numbering', priority: 1 });
    queue.push(...bad.map((r) => ({ ...r, issues: r.issues.filter((i) => !/紹介番号/.test(i)) })).filter((r) => r.issues.length).slice(0, 3).map((r) => ({ dept: 'editor', task: `「${r.title}」の不足を直す：${r.issues.join('・')}`, why: '完成品の保存データから判定', need: /ROOM紹介文|ハッシュタグ|キャプション/.test(r.issues.join()) ? 'ai' : 'free', priority: 2 })));
    await kv.setJson(FK.edit, { at: now(), sig: JSON.stringify(sig), rows: rows.slice(0, 40), badCount: bad.length, queue });
    await record(kv, 'editor', 'edit-check', '不足項目の点検', `点検${rows.length}件・不足あり${bad.length}件`);
    return { done: `完成品${rows.length}件の不足項目を点検：不足あり${bad.length}件${bad[0] ? `（例：「${bad[0].title}」＝${bad[0].issues.slice(0, 2).join('・')}）` : ''}。直す順番を部署別のキューに載せた`, title: '完成品の不足項目の点検' };
  } };
}

// ---- 5b. 編集：改善キューの実行（KOT-19）：紹介番号の不足を、既存の安全な番号付与（company.js の migrateProductNumbers＝台帳・鍵・再利用なし）で直し、その場で再点検する ----
const lackNo = (s) => (s.products || []).filter((p) => !p.no).length;
async function allSetsForNo(kv) {
  const list = (await kv.getJson(K.sets)) || []; const out = [];
  for (const x of list) { const s = await kv.getJson(K.set(x.id)); if (s && Array.isArray(s.products) && s.products.length) out.push({ ...s, id: x.id }); }
  return out;
}
export async function numberFixWork(kv) {
  const bad = (await allSetsForNo(kv)).filter((s) => lackNo(s) > 0); if (!bad.length) return null;
  const sig = JSON.stringify(bad.map((s) => [s.id, lackNo(s)]));
  const last = await kv.getJson(FK.exec);
  if (last && last.sig === sig) return null; // 同じ状態で直せなかったものを繰り返さない
  const lacking = bad.reduce((n, s) => n + lackNo(s), 0);
  return { kind: 'number-fix', task: `改善キューの実行：紹介番号が無い商品${lacking}点（完成品${bad.length}件）に、既存の安全な番号付与で番号を付け、再点検する（AIも外部サイトも使わない・0円・キャプションは書き換えない）`, doing: '紹介番号の不足を直しています', est: 0, run: async () => {
    let err = '';
    try { const { migrateProductNumbers } = await import('./company.js'); await migrateProductNumbers(kv); } catch (e) { err = String((e && e.message) || e).slice(0, 80); }
    const after = await allSetsForNo(kv);
    const still = after.filter((s) => lackNo(s) > 0);
    const left = still.reduce((n, s) => n + lackNo(s), 0);
    // 再点検（実行の前後と成果を記録）
    const rows = after.map((s) => ({ id: s.id, title: s.title, issues: editProblems(s) }));
    const badRows = rows.filter((r) => r.issues.length);
    const prev = (await kv.getJson(FK.edit)) || {};
    await kv.setJson(FK.edit, { ...prev, at: now(), sig: JSON.stringify([setSig(after)]), rows: rows.slice(0, 40), badCount: badRows.length, queue: badRows.map((r) => ({ ...r, issues: r.issues.filter((i) => !/紹介番号/.test(i)) })).filter((r) => r.issues.length).slice(0, 3).map((r) => ({ dept: 'editor', task: `「${r.title}」の不足を直す：${r.issues.join('・')}`, why: '完成品の保存データから判定（再点検）', need: 'ai', priority: 2 })) });
    await kv.setJson(FK.exec, { at: now(), sig: JSON.stringify(still.map((s) => [s.id, lackNo(s)])), before: { lacking, sets: bad.length }, after: { lacking: left }, fixedSets: bad.length - still.length, error: err });
    await record(kv, 'editor', 'number-fix', '紹介番号の不足を修正', `前：不足${lacking}点（${bad.length}件）→後：不足${left}点${err ? `（失敗：${err}）` : ''}`);
    return { done: left === 0 && !err ? `紹介番号の不足${lacking}点（完成品${bad.length}件）に番号を付け、再点検した：不足は0点。実行の前後を記録。監査へ引き継ぎ` : `紹介番号の不足${lacking}点のうち${lacking - left}点を直した（残り${left}点${err ? `・失敗：${err}` : ''}）。残りは未解決のまま`, title: '紹介番号の不足を修正', handoff: left < lacking ? 'auditor' : undefined, what: '番号を付けた完成品の再確認' };
  } };
}

// ---- 6. 広報：既存の導線・計測の設計と投稿の順番案 ----
export function trackingPlan(sets, perf, cal) {
  const posted = new Set((perf || []).map((r) => r.setId).filter(Boolean));
  const target = sets.filter((s) => postable(s).ok);
  const next = cal.items.find((e) => e.kind === 'season' || e.kind === 'rakuten');
  const rows = target.map((s) => {
    const reg = (perf || []).filter((r) => r.setId === s.id);
    const lacks = [];
    if (!reg.length) lacks.push('閲覧・ROOMへのクリック');
    if (!reg.some((r) => r.orders != null)) lacks.push('成約件数');
    if (!reg.some((r) => r.reward != null)) lacks.push('確定報酬');
    return { id: s.id, title: s.title, status: s.status, posted: posted.has(s.id) || s.status === 'posted', route: 'Instagram投稿 → プロフィールのリンク → 楽天ROOM → 楽天市場', lacks, tactic: (reg[0] && reg[0].tactics && reg[0].tactics[0]) || '' };
  });
  const order = rows.filter((r) => !r.posted).map((r) => r.title);
  return { rows, order, nextEvent: next ? { name: next.name, start: next.start } : null };
}
export async function trackingDesignWork(kv) {
  const sets = await loadSets(kv); const perf = (await kv.getJson(K.perf)) || [];
  if (!sets.some((s) => postable(s).ok)) return null;
  const sig = [setSig(sets), perf.length, jst()];
  if (!(await sigWork(kv, FK.tracking, sig))) return null;
  return { kind: 'tracking-design', task: '投稿できる完成品ごとに、導線（Instagram→ROOM→楽天）と登録してもらう数字、投稿の順番案を設計する（AIは使わない・0円）', doing: '導線と計測の設計をしています', est: 0, run: async () => {
    const cal = calendar((await kv.getJson(K.calendar)) || []);
    const t = trackingPlan(sets, perf, cal);
    const todo = t.rows.filter((r) => !r.posted);
    const queue = [];
    if (todo[0]) queue.push({ dept: 'pr', task: `投稿の順番案：${t.order.slice(0, 3).join(' → ')}（社長が手で投稿。投稿したら実績を登録）`, why: `未投稿の投稿できる完成品${todo.length}件${t.nextEvent ? `。直近の行事：${t.nextEvent.start} ${t.nextEvent.name}` : ''}`, need: 'owner', priority: 1 });
    await kv.setJson(FK.tracking, { at: now(), sig: JSON.stringify(sig), ...t, queue, note: '投稿・送信は自動化しない。数字は社長の登録だけ（未登録は未計測）' });
    await record(kv, 'pr', 'tracking-design', '導線と計測の設計', `対象${t.rows.length}件・未投稿${todo.length}件`);
    return { done: `投稿できる完成品${t.rows.length}件の導線と計測を設計：未投稿${todo.length}件${todo[0] ? `。最初の候補「${todo[0].title}」（登録してもらう数字：${todo[0].lacks.join('・') || 'そろっている'}）` : ''}。鑑定へ引き継ぎ`, title: '導線と計測の設計', handoff: 'appraiser', what: '計測の不足の優先順位づけ' };
  } };
}

// ---- 6b. 広報：投稿順と冒頭案の決定（KOT-19）：社員が根拠つきで選び、社長には選択済みの投稿セットを納品する ----
// 実績が無いうちは暫定の決め方（販促日程との一致→報酬の目安→古い順）。実績の数字は作らない。冒頭案も暫定で、投稿後の実績で見直す
export function decideDelivery(sets, perf, cal, ri) {
  const posted = new Set((perf || []).map((r) => r.setId).filter(Boolean));
  const target = sets.filter((s) => postable(s).ok && s.status !== 'posted' && !posted.has(s.id));
  const evs = cal.items.filter((e) => e.start <= jst(new Date(Date.now() + 60 * 86400000)));
  const used = (perf || []).filter((r) => r.tactics && r.tactics.length);
  const rows = target.map((s) => {
    const ps = (s.products || []).filter((p) => Number(p.price) > 0);
    const top = ps.length ? Math.max(...ps.map((p) => Number(p.price))) * ri.rate : 0;
    const ev = evs.find((e) => [s.title, s.theme, s.caption].join(' ').includes(e.name.replace(/[（(].*$/, '').replace(/デー$/, '')));
    const variants = reuseVariants(s);
    const hook = variants.find((v) => used.some((r) => r.tactics.includes(v.type))) || variants.find((v) => v.type === 'target') || variants[0] || null;
    return { id: s.id, title: s.title, score: (ev ? 1000000 : 0) + Math.round(top), event: ev ? { name: ev.name, start: ev.start } : null, reward: Math.round(top * 10) / 10, hook, hookWhy: hook ? (used.length ? '過去の実績で使った型に合わせた' : '実績が無いので暫定：対象と課題が保存された型を優先し、投稿後の閲覧で他の型と比べる') : '価格のある商品が無く、別案を作れなかった（元の冒頭のまま）', deliveredAt: s.deliveredAt || '' };
  }).sort((a, b) => b.score - a.score || String(a.deliveredAt).localeCompare(String(b.deliveredAt)));
  return rows.map((r, i) => ({ ...r, rank: i + 1, why: [r.event ? `${r.event.start}の「${r.event.name}」に合う` : '合う販促日程は未確認', `報酬の目安 ${yen(r.reward)}／1件（${ri.kind === 'actual' ? '公式の料率' : '仮説の料率3%・売上の保証ではない'}）`].join('。') }));
}
export async function deliveryDecisionWork(kv) {
  const sets = await loadSets(kv); if (!sets.some((s) => postable(s).ok)) return null;
  const perf = (await kv.getJson(K.perf)) || []; const ri = await rateInfo(kv);
  const sig = [setSig(sets), perf.length, ri.rate, jst()];
  if (!(await sigWork(kv, FK.decision, sig))) return null;
  return { kind: 'delivery-decision', task: '投稿できる完成品の投稿順と冒頭案を、根拠つきで社員が決める（AIは使わない・0円・投稿は社長の手）', doing: '投稿順と冒頭案を決めています', est: 0, run: async () => {
    const cal = calendar((await kv.getJson(K.calendar)) || []);
    const order = decideDelivery(sets, perf, cal, ri);
    const first = order[0];
    const queue = first ? [{ dept: 'pr', task: `選択済み：1番目は「${first.title}」。冒頭は「${first.hook ? first.hook.text : '元のまま'}」。社長は確認して投稿するだけ（外部への投稿は社長だけ）`, why: `${first.why}。冒頭の根拠：${first.hookWhy}`, need: 'owner', exec: 'delivered', priority: 1 }] : [];
    await kv.setJson(FK.decision, { at: now(), sig: JSON.stringify(sig), order: order.slice(0, 10), queue, note: '社員が決めた暫定の選択（実績が無いため）。投稿・送信は自動化しない' });
    await record(kv, 'pr', 'delivery-decision', '投稿順と冒頭案の決定', `対象${order.length}件${first ? `・1番目「${first.title}」` : ''}`);
    return { done: first ? `投稿順を決めた：1番目「${first.title}」（${first.why.slice(0, 60)}）。冒頭案も選択済み。社長は選択済みの投稿セットを投稿するだけ。鑑定へ引き継ぎ` : '未投稿の投稿できる完成品が無く、決める対象が無かった', title: '投稿順と冒頭案の決定', handoff: first ? 'appraiser' : undefined, what: '決定の反映と計測の不足の確認' };
  } };
}

// ---- 7. 鑑定：全部署の成果物から、改善の優先順位（部署別キュー）を作る ----
export async function collectQueue(kv) {
  const parts = await Promise.all([FK.products, FK.plan, FK.reuse, FK.assets, FK.edit, FK.tracking, FK.decision].map((k) => kv.getJson(k)));
  const gap = await kv.getJson(FK.gap);
  const decided = !!(parts[6] && (parts[6].queue || []).length);
  // 社員が投稿順・冒頭案を決めたら、「社長が選ぶ」項目は出さず、選択済みの納品に置き換える
  const items = parts.flatMap((p) => (p && p.queue) || []).filter((x) => !(decided && x.need === 'owner' && x.dept === 'pr' && !x.exec && /順番|冒頭の別案|優先して検討/.test(x.task)));
  if (gap && gap.need && gap.need.length) items.push({ dept: 'appraiser', task: `計測の不足：${gap.need.length}件の完成品で登録が足りない`, why: `例：「${gap.need[0].title}」＝${gap.need[0].lacks.join('・')}`, need: 'owner', priority: 1 });
  return items.sort((a, b) => a.priority - b.priority).map((x, i) => ({ ...x, rank: i + 1, deptName: NAMES[x.dept] || x.dept, needLabel: ({ free: '無料の処理で進められる', ai: 'AIの予算が要る', owner: '社長の操作が要る', external: '外部データが要る' })[x.need] || x.need }));
}
export async function priorityQueueWork(kv) {
  const items = await collectQueue(kv); if (!items.length) return null;
  const sig = items.map((x) => [x.dept, x.task]);
  if (!(await sigWork(kv, FK.queue, sig))) return null;
  return { kind: 'priority-queue', task: `各部署の成果物から、改善の優先順位（部署別のキュー${items.length}件）を決める（AIは使わない・0円）`, doing: '改善の優先順位を決めています', est: 0, run: async () => {
    const cur = await collectQueue(kv);
    await kv.setJson(FK.queue, { at: now(), sig: JSON.stringify(cur.map((x) => [x.dept, x.task])), items: cur.slice(0, 30) });
    await record(kv, 'appraiser', 'priority-queue', '改善の優先順位', `キュー${cur.length}件`);
    const by = {}; for (const x of cur) by[x.deptName] = (by[x.deptName] || 0) + 1;
    return { done: `改善の優先順位を決めた（${Object.entries(by).map(([d, n]) => `${d}${n}件`).join('・')}）。1位：${cur[0].deptName}「${cur[0].task.slice(0, 50)}」（${cur[0].needLabel}）`, title: '改善の優先順位' };
  } };
}

// ---- 部署ごとの仕事探し（company.js の findWork から呼ぶ） ----
export async function deptFreeWork(agent, kv) {
  const f = { buyer: productCompareWork, planner: planOrganizeWork, writer: reuseDraftWork, designer: assetCheckWork, editor: async (k) => (await numberFixWork(k)) || editCheckWork(k), pr: async (k) => (await deliveryDecisionWork(k)) || trackingDesignWork(k), appraiser: priorityQueueWork }[agent];
  return f ? f(kv) : null;
}

// ---- 全員待機のとき：部署ごとの具体的な理由・次に必要な条件・社長の操作 ----
const NEXT = {
  buyer: { cond: '新規ROOM紹介の再開（社長の判断）、または完成品の商品に欠けた情報・重複が見つかること', owner: '新しい商品の探索を再開するなら、画面の「再開する」を入力（再開は社長だけ）' },
  planner: { cond: '完成品・事業案が増える、または販促の日付（公式URLつき）が登録されること', owner: '楽天のセールの日付を公式で確かめて登録（任意）' },
  writer: { cond: '投稿できる完成品が増える（表紙・PR表記・商品6点・紹介文がそろう）、またはAIの予算が戻ること', owner: 'なし（予算は月1000円のまま）' },
  designer: { cond: '表紙の無い完成品ができる、または画像の予算が使える状態になること', owner: 'なし' },
  editor: { cond: '完成品が増える・直される、または監査の指摘・社長の修正依頼が来ること', owner: '修正したい完成品があれば、完成品のページから修正を頼む' },
  pr: { cond: '未投稿の投稿できる完成品が増える、または実績が登録されること', owner: '投稿したら完成品の画面で「投稿した」を押し、Instagramのインサイトと楽天のレポートの数字を登録' },
  auditor: { cond: '完成品が納品される・納品し直される、または24時間たって確かめ直しの時期が来ること', owner: 'なし' },
  appraiser: { cond: '実績・売上の登録が変わる、または各部署の成果物が更新されること', owner: '楽天アフィリエイトのレポートの成果件数・確定報酬を登録（月1回以上）' }
};
export function idleDetail(agent, reason) {
  const n = NEXT[agent]; if (!n) return reason;
  return `${reason}｜次に必要な条件：${n.cond}｜社長に必要な操作：${n.owner}`;
}

// ---- 画面に渡す状態（実際の成果物・実行ログ・部署別キュー・棚卸し） ----
export async function deptWorkState(kv) {
  const [products, plan, reuse, assets, edit, tracking, queue, decision, exec, log] = await Promise.all([FK.products, FK.plan, FK.reuse, FK.assets, FK.edit, FK.tracking, FK.queue, FK.decision, FK.exec].map((k) => kv.getJson(k)).concat([kv.listJson(FK.log, 40)]));
  const counts = {}; for (const l of log || []) counts[l.dept] = (counts[l.dept] || 0) + 1;
  return {
    note: '資料の原本は直接確認していない。KOT-13 に登録済みの要約に基づく。無料＝コードの計算だけ（AI・外部サイト・費用なし）',
    inventory: INVENTORY.map((x) => ({ ...x, deptName: NAMES[x.dept] })),
    outputs: {
      products: products ? { at: products.at, count: products.count, gapCount: products.gapCount, top: (products.top || [])[0] || null, rate: products.rate } : null,
      plan: plan ? { at: plan.at, total: plan.total, dup: (plan.dup || []).length, events: plan.events } : null,
      reuse: reuse ? { at: reuse.at, sets: Object.values(reuse.sets || {}).slice(-5).map((x) => ({ title: x.title, variants: x.variants })) } : null,
      assets: assets ? { at: assets.at, badCount: assets.badCount, sizeNote: assets.sizeNote } : null,
      edit: edit ? { at: edit.at, badCount: edit.badCount, rows: (edit.rows || []).filter((r) => r.issues.length).slice(0, 5) } : null,
      decision: decision ? { at: decision.at, order: (decision.order || []).slice(0, 3) } : null,
      exec: exec ? { at: exec.at, before: exec.before, after: exec.after, fixedSets: exec.fixedSets, error: exec.error } : null,
      tracking: tracking ? { at: tracking.at, order: tracking.order, rows: (tracking.rows || []).slice(0, 5) } : null
    },
    queue: (queue && queue.items) || [], queueAt: queue ? queue.at : '', log: log || [], counts
  };
}
