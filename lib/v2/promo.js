// 既存商品の販売促進キュー（2026-11-24・KOT-25）
//   新規商品の探索・紹介が停止中でも、すでに納品した「投稿できる完成品」を売るための成果物を、担当の社員が順に作って引き継ぐ。
//   企画 → ライター → デザイナー → 広報 → 監査 → 鑑定。すべてコードの計算だけ（AI・外部サイト・費用なし）。
//   事実は完成品の保存データだけ。価格・在庫・効果・実績は作らない。投稿・送信はしない（社長が手で行う）。
//   成果物は v2:promo:<完成品ID> に保存。完成品が納品し直されたら作り直す。作るものが無ければ仕事にしない（稼働の演出をしない）。
import { postable } from './kpi.js';
import { UNSOURCED_CLAIM } from '../buyer-angles.js';

const K = { sets: 'v2:sets', set: (id) => `v2:set:${id}`, promo: (id) => `v2:promo:${id}`, index: 'v2:promo:index' };
const now = () => new Date().toISOString();
export const PROMO_KEYS = K;

// 段階：担当の社員と、その段階の完了後に渡す相手
export const STAGES = [
  { name: 'plan', agent: 'planner', label: '販促の企画（主役の商品・誰に・何を見せるか）' },
  { name: 'write', agent: 'writer', label: 'ストーリーズ・リールの文言とコメント欄の一言' },
  { name: 'design', agent: 'designer', label: '使う画像の確認と、ストーリーズの構成' },
  { name: 'post', agent: 'pr', label: '投稿の手順（社長が手で行うもの）' },
  { name: 'audit', agent: 'auditor', label: '文言と手順の確認（根拠のない主張・PR表記・楽天のURL）' },
  { name: 'measure', agent: 'appraiser', label: '成果の測り方（登録する数字）' }
];
const stageOf = (name) => STAGES.find((s) => s.name === name);
const clip = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function candidates(kv) {
  const list = ((await kv.getJson(K.sets)) || []).filter((x) => ['waiting', 'adopted'].includes(x.status)).slice(0, 40);
  const out = [];
  for (const x of list) { const s = await kv.getJson(K.set(x.id)); if (s && postable(s).ok) out.push({ ...s, id: x.id, status: x.status }); }
  return out;
}

// ---- 各段階の成果物（コードの計算だけ） ----
export function makePlan(s) {
  const ps = (s.products || []).filter((p) => p.name && p.url);
  const hero = ps[0];
  return {
    hero: hero ? { name: clip(hero.name, 60), price: Number(hero.price) > 0 ? Number(hero.price) : null, url: hero.url } : null,
    others: ps.slice(1, 6).map((p) => clip(p.name, 40)),
    target: '忙しい社会人（買い物の失敗を減らしたい人）',
    aim: 'ROOMのコレクションを見てもらい、気になる商品を楽天の商品ページで確かめてもらう',
    note: '価格は確認した時点のもの。在庫・値下がりは書かない（商品ページで確認）'
  };
}
export function makeWrite(s, plan) {
  const ps = (s.products || []).filter((p) => p.name && p.room);
  const frames = ps.slice(0, 5).map((p, i) => ({ n: i + 1, product: clip(p.name, 40), text: clip(p.room, 60) }));
  return {
    storyFrames: frames,
    reelLines: [`${clip(s.title, 24)}`, ...frames.slice(0, 3).map((f) => f.text), '詳しくはROOMのコレクションへ（PR）'],
    firstComment: `紹介した商品は楽天ROOMのコレクションにまとめています（プロフィールのリンクから）。【PR】楽天アフィリエイトを利用しています。`,
    note: '体験した表現（使ってみた・愛用）や効果の断定は書かない。文言は完成品のROOM紹介文から取った'
  };
}
export function makeDesign(s, write) {
  const hasCover = !!(s.image && (s.image.mediaId || s.image.url));
  const withImg = (s.products || []).filter((p) => p.image || p.imageUrl).length;
  return {
    cover: hasCover ? '表紙画像あり（完成品の表紙を1枚目に使う）' : '表紙画像なし',
    productImages: withImg ? `商品画像が保存されているのは${withImg}点` : '商品画像は未保存（ストーリーズは文字と表紙で構成する。画像を作って足さない）',
    story: (write.storyFrames || []).map((f) => `${f.n}枚目：${f.product}`),
    note: '新しい画像は描かない（画像の予算は表紙のためのもの）'
  };
}
export function makePost(s, plan) {
  const tags = (s.hashtags || []).filter((t) => /^#\S+$/.test(String(t))).slice(0, 5);
  return {
    ownerSteps: ['完成品の画面で、キャプションをコピーして表紙とあわせてInstagramに投稿する（社長の手で。自動投稿はしない）', 'ROOMのコレクションに商品を登録する（紹介文をコピーして貼る。ROOMへの投稿は自動化しない）', '投稿したら完成品の画面で「投稿した」を押す', 'ストーリーズの文言とコメント欄の一言を使う（任意）'],
    hashtags: tags,
    hashtagNote: tags.length ? '内容に合う5個以内' : 'ハッシュタグは完成品に未登録',
    note: '外部への投稿・コメント・フォローは、アプリは行わない'
  };
}
export function makeAudit(s, kit) {
  const texts = [s.caption, ...(kit.write ? [...kit.write.reelLines, kit.write.firstComment, ...kit.write.storyFrames.map((f) => f.text)] : [])].filter(Boolean);
  const issues = [];
  const claim = texts.find((t) => UNSOURCED_CLAIM.test(t));
  if (claim) issues.push(`根拠のない主張の疑い：「${clip(claim, 30)}」`);
  if (/使ってみた|愛用|試してみた|買ってよかった/.test(texts.join('\n'))) issues.push('体験したような表現がある');
  if (!/PR|アフィリエイト/.test(String(s.caption || ''))) issues.push('キャプションにPR表記がない');
  if (!/PR/.test(kit.write ? kit.write.firstComment : '')) issues.push('コメント欄の一言にPR表記がない');
  if (!kit.plan || !kit.plan.hero) issues.push('主役の商品のURLがない');
  else if (!/^https:\/\/([\w-]+\.)*(rakuten\.co\.jp|rakuten\.com)\//.test(String(kit.plan.hero.url))) issues.push('主役の商品が楽天のURLでない');
  return { ok: !issues.length, issues, at: now() };
}
export function makeMeasure(s) {
  return {
    record: ['Instagramの閲覧数・プロフィールへのアクセス（インサイトの数字）', 'ROOMへのクリック数', '楽天アフィリエイトの成果件数・確定報酬（月1回以上）'],
    where: '完成品の画面の「実績を登録」（登録が無い間は未計測のまま。推測しない）',
    done: !!(s && s.id)
  };
}

const MAKERS = {
  plan: (s) => ({ plan: makePlan(s) }),
  write: (s, kit) => ({ write: makeWrite(s, kit.plan) }),
  design: (s, kit) => ({ design: makeDesign(s, kit.write) }),
  post: (s, kit) => ({ post: makePost(s, kit.plan) }),
  audit: (s, kit) => ({ audit: makeAudit(s, kit) }),
  measure: (s) => ({ measure: makeMeasure(s) })
};

// 完成品ごとの進み具合を見て、次にやる段階を決める
function nextStage(kit, s) {
  if (!kit || kit.deliveredAt !== (s.deliveredAt || '')) return STAGES[0];
  if (kit.status === 'done') return null;
  return stageOf(kit.stage) || null;
}

// 仕事探し：この社員の番の段階があれば、その仕事を返す。無ければ null
export async function promoWork(agent, kv) {
  if (!STAGES.some((x) => x.agent === agent)) return null;
  for (const s of await candidates(kv)) {
    const kit = await kv.getJson(K.promo(s.id));
    const st = nextStage(kit, s);
    if (!st || st.agent !== agent) continue;
    return { kind: `promo-${st.name}`, task: `販売促進：完成品「${s.title}」の${st.label}を作る（AIは使わない・0円）`, doing: `販売促進の成果物（${st.label}）を作っています`, est: 0, run: () => promoRun(kv, s.id, st.name) };
  }
  return null;
}

export async function promoRun(kv, id, stageName) {
  const s = await kv.getJson(K.set(id));
  if (!s) return { fail: '完成品が見つからない' };
  const st = stageOf(stageName);
  let kit = await kv.getJson(K.promo(id));
  if (!kit || kit.deliveredAt !== (s.deliveredAt || '')) kit = { id, title: s.title, deliveredAt: s.deliveredAt || '', startedAt: now(), stage: 'plan', status: 'active', log: [] };
  if (kit.stage !== stageName) return { done: 'すでに別の実行が進めていたので、何もしなかった（二重実行の防止）' };
  Object.assign(kit, MAKERS[stageName]({ ...s, id }, kit));
  kit.log = [...(kit.log || []), { at: now(), stage: stageName, agent: st.agent }].slice(-12);
  const i = STAGES.findIndex((x) => x.name === stageName);
  let msg = `「${s.title}」の販売促進：${st.label}を作った`;
  let handoff = STAGES[i + 1] ? STAGES[i + 1].agent : undefined;
  let what = STAGES[i + 1] ? STAGES[i + 1].label : undefined;
  if (stageName === 'audit' && !kit.audit.ok) {
    // 不合格：文言の担当に差し戻す（直せない指摘は理由を残して止める）。差し戻しは1回まで
    if ((kit.rework || 0) >= 1) { kit.status = 'done'; kit.stage = 'done'; kit.blocked = kit.audit.issues; msg += `。指摘が残ったため成果物は「要確認」（${kit.audit.issues.join('・').slice(0, 80)}）`; handoff = undefined; }
    else { kit.rework = (kit.rework || 0) + 1; kit.stage = 'write'; msg += `。不合格（${kit.audit.issues.join('・').slice(0, 80)}）。ライターへ差し戻し`; handoff = 'writer'; what = '指摘の直し'; }
  } else if (stageName === 'measure') { kit.status = 'done'; kit.stage = 'done'; kit.doneAt = now(); msg += '。販売促進の一式がそろった'; handoff = undefined; }
  else kit.stage = STAGES[i + 1].name;
  await kv.setJson(K.promo(id), kit);
  const idx = ((await kv.getJson(K.index)) || []).filter((x) => x.id !== id);
  idx.unshift({ id, title: s.title, stage: kit.stage, status: kit.status, at: now() });
  await kv.setJson(K.index, idx.slice(0, 40));
  return { done: msg, title: s.title, handoff, what };
}

// 画面に渡す状態：実際にある成果物だけ
export async function promoState(kv) {
  const idx = (await kv.getJson(K.index)) || [];
  const sets = await candidates(kv).catch(() => []);
  const kits = [];
  for (const x of idx.slice(0, 10)) { const k = await kv.getJson(K.promo(x.id)); if (k) kits.push({ id: k.id, title: k.title, stage: k.stage, status: k.status, doneAt: k.doneAt || null, blocked: k.blocked || null, audit: k.audit || null, hasPlan: !!k.plan, hasWrite: !!k.write, hasDesign: !!k.design, hasPost: !!k.post, hasMeasure: !!k.measure }); }
  return { note: '既存の完成品を売るための成果物。コードの計算だけ（AI・外部サイト・費用なし）。投稿はしない', postableSets: sets.length, kits, done: kits.filter((k) => k.status === 'done').length };
}
