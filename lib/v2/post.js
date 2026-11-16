// サングラスくま株式会社 2.0「ポスト」（2026-11-16 社長の依頼）：社長が「ただ調べてほしい」スクショを入れると、
//   鑑定（画像を読むAI）が身につけている物・使っている物の候補を抜き出し、バイヤーが楽天で探して、根拠つきで結果を返す。投稿セットは作らない。
//   - 人物が誰かは画像から判断しない（社長のメモだけを使う）。画像の文字・ロゴが読めないときは、ブランドを作らない
//   - 判定：同一商品確認済み（型番の文字が一致）／同一商品の可能性あり（ブランドなどの文字が一致）／類似商品（見た目の種類・色だけで探した）／未特定（楽天で見つからない）
//   - スクショは調べるためだけに使う（非公開・推測できないIDで保存。投稿には使わない）。費用は今と同じ予算（月1,000円・試験運用の合計）で数える
import crypto from 'node:crypto';
import { searchPage } from '../rakuten.js';
import { runWithModels } from '../ai.js';
import { takeCalls } from '../ai-usage.js';
import { check as budgetCheck, record as budgetRecord } from '../budget.js';
import * as C from '../kuma-cover.js';
import { record } from './company.js';

const K = { posts: 'v2:posts', post: (id) => `v2:post:${id}` };
export { K as POST_KEYS };
export const MAX_IMAGE_B64 = 1200 * 1024; // 端末で縮小してから送る（保存場所の1件の大きさの目安）
export const MAX_CANDIDATES = 6;
export const POST_ESTIMATE_YEN = 3;
export const DAY_LIMIT = 30; // 1日に受け付ける枚数（使いすぎを防ぐ）
const now = () => new Date().toISOString();
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const flat = (t) => String(t || '').normalize('NFKC').toLowerCase().replace(/[\s　\-_/・.]/g, '');

const LOOK_PROMPT = `あなたは「サングラスくま株式会社」の鑑定担当です。画像に写っている人が身につけている物・使っている物（服・帽子・メガネ・アクセサリー・バッグ・靴・小物・コスメ・家電など）の候補を挙げます。JSONだけを返してください。
- 人物が誰かは答えない・推測しない。人は「左の人」「右の人」「中央の人」のように位置で呼ぶ
- 背景の家具・番組のロゴ・テロップ・マイクなど、身につけていない・使っていない物は除く
- 候補ごとに：who（位置）、category（種類）、color（色）、material（見て分かる範囲。分からなければ空）、visibleText（その物に読める文字・ロゴ・型番。読めないなら空。作らない）、logo（ロゴやワンポイントの形の説明。無ければ空）、print（プリント・柄の説明）、features（見た目の特徴3つまで）、confidence（high/medium/low）、searchQuery（楽天で探す検索語。読めた文字があれば含める）
- ブランドは、その物にロゴや文字がはっきり読めるときだけ visibleText に書く（雰囲気で推測しない）
出力形式: {"candidates":[{"who":"","category":"","color":"","material":"","visibleText":"","logo":"","print":"","features":[],"confidence":"low","searchQuery":""}],"note":"写りが小さい・ぼやけているなどの注意"}`;

// 楽天の結果と、画像から読めた文字を比べて判定する（コード。AIに判定させない）
const MODEL_RE = /^(?=.*\d)[a-z0-9]{4,}$/i; // 英数字が混ざった4文字以上＝型番らしい
export function judge(cand, item) {
  const name = flat(`${item.name} ${item.caption || ''}`);
  const tokens = String(cand.visibleText || '').split(/[\s　,、/・]+/).map((t) => t.trim()).filter((t) => t.length >= 3);
  const model = tokens.find((t) => MODEL_RE.test(t.replace(/[-_.]/g, '')) && name.includes(flat(t)));
  if (model) return { level: 'same', label: '同一商品確認済み', why: `画像に読めた型番「${model}」が商品名・説明と一致` };
  const word = tokens.find((t) => name.includes(flat(t)));
  if (word) return { level: 'maybe', label: '同一商品の可能性あり', why: `画像に読めた文字「${word}」が商品名・説明に含まれる（型番までは確認できない）` };
  return { level: 'similar', label: '類似商品', why: `画像の文字やロゴが読めないため、種類・色（${[cand.category, cand.color].filter(Boolean).join('・')}）だけで探した似た商品` };
}

export async function listPosts(kv) {
  const ids = (await kv.getJson(K.posts)) || [];
  const out = [];
  for (const id of ids.slice(0, 30)) { const p = await kv.getJson(K.post(id)); if (p) out.push(p); }
  return out;
}

// 受け付けて、その場で調べる（鑑定：画像を読むAI 1回 → バイヤー：楽天で候補ごとに探す）
export async function submitPost(kv, env, { image, note = '', referer = '', startedAt = Date.now() }) {
  const m = String(image || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('画像（JPEG・PNG）を選んでください');
  if (m[2].length > MAX_IMAGE_B64) throw new Error('画像が大きすぎます（端末で縮小してから送ってください）');
  const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const count = Number(await kv.incr(`v2:post:count:${day}`)) || 0; await kv.expire(`v2:post:count:${day}`, 3 * 86400);
  if (count > DAY_LIMIT) throw new Error(`今日はもう${DAY_LIMIT}枚調べました。明日また送ってください`);
  const b = await budgetCheck(kv, env, { estimate: POST_ESTIMATE_YEN });
  if (!b.ok) throw new Error(b.reason);
  try { const { trialState } = await import('./company.js'); const t = await trialState(kv, env); if (t && t.active && t.used + POST_ESTIMATE_YEN > t.cap) throw new Error(`14日間の試験運用の上限（合計${t.cap}円）に届くため、調べられません`); } catch (e) { if (/試験運用/.test(e.message)) throw e; }
  const id = `post${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const mediaId = await C.saveMedia(kv, m[2]);
  const post = { id, at: now(), note: str(note, 120), mediaId, image: `/api/media?id=${mediaId}`, status: 'running', candidates: [], yen: 0 };
  await kv.setJson(K.post(id), post);
  await kv.setJson(K.posts, [id, ...((await kv.getJson(K.posts)) || [])].slice(0, 60));
  await record(kv, { job: id, agent: 'appraiser', type: 'start', text: `ポストに届いたスクショを調べ始めた${post.note ? `（社長のメモ：${post.note.slice(0, 30)}）` : ''}`, title: 'ポストのスクショ' });
  try {
    // 鑑定：画像を読むAI（人物は特定しない）
    const { result } = await runWithModels({
      env, deadline: startedAt + 35000, system: LOOK_PROMPT,
      userContent: [{ type: 'text', text: post.note ? `社長のメモ（人物名などは、このメモだけを使う）：${post.note}` : '社長のメモはありません（人物名は不明として扱う）' }, { type: 'image_url', image_url: { url: `data:image/${m[1]};base64,${m[2]}`, detail: 'high' } }],
      parse: (c) => { const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]); if (!Array.isArray(d.candidates)) throw new Error('候補がありませんでした'); return d; }
    });
    post.lookNote = str(result.note, 200);
    post.candidates = result.candidates.slice(0, MAX_CANDIDATES).map((c) => ({
      who: str(c.who, 20), category: str(c.category, 40), color: str(c.color, 30), material: str(c.material, 40), visibleText: str(c.visibleText, 80), logo: str(c.logo, 80), print: str(c.print, 80),
      features: (Array.isArray(c.features) ? c.features : []).map((x) => str(x, 30)).filter(Boolean).slice(0, 3), confidence: ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : 'low', searchQuery: str(c.searchQuery, 40), matches: []
    })).filter((c) => c.category);
    await record(kv, { job: id, agent: 'appraiser', type: 'done', text: `身につけている物の候補を${post.candidates.length}点見つけた${post.candidates.some((c) => c.visibleText) ? '（文字・ロゴが読めた物あり）' : '（文字・ロゴは読めず）'}`, title: 'ポストのスクショ' });
    await record(kv, { job: id, agent: 'appraiser', to: 'buyer', type: 'handoff', text: 'バイヤーへ引き継ぎ（楽天で探す）', title: 'ポストのスクショ' });
    // バイヤー：候補ごとに楽天で探す（3件まで）。判定はコード
    for (const c of post.candidates) {
      if (Date.now() - startedAt > 50000) { c.status = 'timeout'; continue; }
      try {
        const r = await searchPage({ keyword: c.searchQuery || `${c.color} ${c.category}`, env, referer, hits: 10 });
        c.matches = r.items.slice(0, 3).map((it) => ({ name: it.name, price: it.price, url: it.url, image: it.image, shop: it.shop, code: it.code, ...judge(c, it) }));
      } catch (e) { c.error = str(e.message, 80); }
      c.level = c.matches.length ? c.matches.reduce((best, x) => (({ same: 3, maybe: 2, similar: 1 })[x.level] > ({ same: 3, maybe: 2, similar: 1 })[best] ? x.level : best), 'similar') : 'none';
      c.label = ({ same: '同一商品確認済み', maybe: '同一商品の可能性あり', similar: '類似商品', none: '未特定' })[c.level];
    }
    const n = (lv) => post.candidates.filter((c) => c.level === lv).length;
    await record(kv, { job: id, agent: 'buyer', type: 'done', text: `楽天で探した（同一${n('same')}・可能性あり${n('maybe')}・類似${n('similar')}・未特定${n('none')}）`, title: 'ポストのスクショ' });
    post.status = 'done';
    await record(kv, { job: id, agent: 'buyer', type: 'deliver', text: 'ポストのスクショの調査結果を社長に返した', title: 'ポストのスクショ' });
  } catch (e) {
    post.status = 'error'; post.error = str(e.message, 160);
    await record(kv, { job: id, agent: 'appraiser', type: 'stop', text: `止まった：スクショを調べられなかった（${post.error.slice(0, 60)}）`, dev: e.message, title: 'ポストのスクショ' });
  } finally {
    const yen = Math.round(takeCalls().reduce((a, c) => a + (Number(c.yen) || 0), 0) * 1000) / 1000;
    post.yen = yen; post.endedAt = now();
    await budgetRecord(kv, yen, { auto: false });
    await kv.setJson(K.post(id), post);
  }
  return post;
}
export async function removePost(kv, id) {
  const ids = ((await kv.getJson(K.posts)) || []).filter((x) => x !== id);
  await kv.setJson(K.posts, ids);
  await kv.del(K.post(id));
  return { ok: true };
}
