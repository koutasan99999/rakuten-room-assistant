// サングラスくま株式会社 2.0 の画面用API（2026-11-15）：/api/v2
// action: state（オフィス・案件・仕事の流れ・完成品の一覧・成果・お金）／set（完成品1件）／decide（採用・却下・修正依頼・投稿した）／request（社長のテーマ・商品の指定）／sales（売上の手入力）／activate（2.0に切り替え・戻す）／prAdd（広報の交流候補を追加）／commentReview（送ったコメントの社長の事後確認）／prDecide（コメント案の承認・見送り・送った・送れなかった。送信はしない）
// 合言葉（APP_PASSCODE）が必要。AIは呼ばない（仕事は定期実行 /api/worker が進める）。鍵の値は応答・記録に出さない
import crypto from 'node:crypto';
import { send, readBody } from '../lib/http.js';
import { kvFrom } from '../lib/kv.js';
import { maskSecrets } from '../lib/ai.js';
import * as V from '../lib/v2/company.js';
import * as Post from '../lib/v2/post.js';
import * as Pr from '../lib/v2/pr.js';
import * as Reach from '../lib/v2/reach.js';
import * as Growth from '../lib/v2/growth.js';
import * as Ventures from '../lib/v2/ventures.js';
import { review as commentReview, withReview } from '../lib/comment-log.js';
import { requestReferer } from '../lib/http.js';

const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

// 実績の登録・削除で、施策の判定（効果あり・見直し）が変わったら記録に残す（コードの判定・AIは使わない）
async function noteEval(kv) {
  for (const c of await Growth.evalChanges(kv).catch(() => [])) await V.record(kv, { agent: 'auditor', type: 'done', side: 'growth-eval', text: c.result === 'effective' ? `集客の施策「${c.name}」は効果あり（${c.posts}投稿の平均閲覧${c.avg}・ほかの投稿の平均${c.base}）` : `集客の施策「${c.name}」は見直し（${c.posts}投稿の平均閲覧${c.avg}が、ほかの投稿の平均${c.base}以下）。企画が代わりの施策を考える` });
}

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!String(env.APP_PASSCODE || '').trim()) return send(res, 503, { error: 'サーバーの合言葉（APP_PASSCODE）が未設定です' });
  if (!same(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  const kv = kvFrom(env);
  if (!kv) return send(res, 200, { configured: false, error: 'サーバーの保存場所が未接続です' });
  const body = await readBody(req);
  const action = String(body.action || 'state');
  try {
    if (action === 'state') return send(res, 200, { configured: true, ...(await V.officeState(kv, env)) });
    if (action === 'set') { const s = await V.getSet(kv, body.id); return s ? send(res, 200, { set: s }) : send(res, 404, { error: 'その完成品はありません' }); }
    if (action === 'decide') return send(res, 200, await V.decide(kv, { id: String(body.id || ''), action: String(body.decision || ''), note: body.note }));
    if (action === 'post') return send(res, 200, { post: await Post.submitPost(kv, env, { image: body.image, note: body.note, referer: requestReferer(req, env) }) });
    if (action === 'posts') return send(res, 200, { posts: await Post.listPosts(kv) });
    if (action === 'postDelete') return send(res, 200, await Post.removePost(kv, String(body.id || '')));
    if (action === 'room') return send(res, 200, await V.markRoom(kv, { id: String(body.id || ''), code: body.code, done: body.done !== false }));
    if (action === 'request') return send(res, 200, { requests: await V.addRequest(kv, { text: body.text, url: body.url }) });
    if (action === 'sales') return send(res, 200, { sales: await V.setSales(kv, { month: body.month, yen: body.yen }) });
    if (action === 'prAdd') return send(res, 200, { target: await Pr.addTarget(kv, { url: body.url, caption: body.caption, handle: body.handle, note: body.note }) });
    if (action === 'prDecide') {
      const d = await Pr.decideDraft(kv, { id: String(body.id || ''), action: String(body.decision || ''), note: body.note });
      await V.record(kv, { agent: 'owner', type: 'owner', text: `社長が @${d.handle || '不明'} へのコメント案を「${Pr.STATUS_LABEL[d.status]}」にした` });
      return send(res, 200, { draft: d });
    }
    // 実際に送ったコメントの事後確認（問題なし／不適切／Instagramで削除した）。Instagramへは何も送らない
    if (action === 'commentReview') {
      const e = await commentReview(kv, String(body.id || ''), String(body.status || ''), body.note);
      await V.record(kv, { agent: 'owner', type: 'owner', text: `社長が @${e.handle || '不明'} へのコメントを確認した（${withReview(e).reviewLabel}）` });
      return send(res, 200, { entry: withReview(e) });
    }
    // 集客（2026-11-18）：投稿の実績の登録・スクショの読み取り（AI 1回）・削除、リールを作った記録
    if (action === 'perfAdd') { const r = await Reach.addPerf(kv, body.perf || {}); await V.record(kv, { agent: 'owner', type: 'owner', text: `社長がInstagramの実績を登録した（${r.title || r.theme || '題名なし'}・閲覧${r.views ?? '未入力'}）` }); await noteEval(kv); return send(res, 200, { perf: r }); }
    if (action === 'perfRead') return send(res, 200, await Reach.readInsight(kv, env, { image: body.image }));
    if (action === 'perfDelete') { const r = await Reach.removePerf(kv, String(body.id || '')); await noteEval(kv); return send(res, 200, r); }
    // 集客の施策（2026-11-18）：社長が「やった」「やめる」「戻す」を記録する。Instagramへは何もしない
    if (action === 'growthDecide') {
      const t = await Growth.decideTactic(kv, { id: String(body.id || ''), decision: String(body.decision || ''), why: body.why });
      await V.record(kv, { agent: 'owner', type: 'owner', text: `社長が集客の施策「${t.name}」を${({ doing: '実行中', dropped: 'やめた', ready: '戻した' })[t.status] || t.status}にした` });
      return send(res, 200, { tactic: t });
    }
    if (action === 'reelMade') { const r = await Reach.noteReel(kv, { setId: body.id, format: body.format, bytes: body.bytes, seconds: body.seconds, mime: body.mime }); return send(res, 200, { reel: r }); }
    // 新規事業・集客の実験・デジタル商品の案への社長の判断（採用・保留・却下・もう一度）。外部へは何もしない
    if (action === 'ventureDecide') {
      const v = await Ventures.decideVenture(kv, { id: String(body.id || ''), decision: String(body.decision || ''), why: body.why });
      await V.record(kv, { agent: 'owner', type: 'owner', text: `社長が「${v.title}」を${Ventures.STATUS_LABEL[v.status] || v.status}にした` });
      return send(res, 200, { item: v });
    }
    if (action === 'regenImage') return send(res, 200, await V.requestRegen(kv, { id: body.id }));
    if (action === 'setImage') return send(res, 200, { image: await V.setOwnerImage(kv, { id: body.id, image: body.image }) });
    if (action === 'activate') return send(res, 200, { active: await V.setActive(kv, body.on === true) });
    return send(res, 400, { error: 'この操作はありません' });
  } catch (e) {
    return send(res, 400, { error: maskSecrets(String(e && e.message || e)).slice(0, 200) });
  }
}
