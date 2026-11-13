// AI社員（段階1・試験）：バイヤーAI×監査AI。画面が1段階ずつ呼ぶ（1リクエストは60秒以内）。
// action: buyer（バイヤーAI：検索語→楽天の検索→候補）／check（コードの客観確認・AIなし）／audit（監査AI：採点・修正指示）／revise（バイヤーAI：修正）
// 失敗は ok:false と、失敗した段階・理由で返す（正常終了として扱わない）。AIを呼んだ記録（OpenAIの応答ID・使用量・費用）は runs に入れて返す。
// 商品の採用・外部への投稿はここでは行わない（社長が画面で承認したときだけ、画面が採用の記録を付ける）。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { buyerStep, checkStep, auditStep, reviseStep, decide, readCandidates, readResults, ROLES, PASS_SCORE, MAX_REVISIONS, MAX_CANDIDATES, AUDIT_MODELS } from '../lib/agents.js';
import { maskSecrets } from '../lib/ai.js';

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const body = await readBody(req);
  const referer = requestReferer(req, env);
  const action = str(body.action, 20);
  try {
    if (action === 'spec') return send(res, 200, { ok: true, roles: ROLES, passScore: PASS_SCORE, maxRevisions: MAX_REVISIONS, maxCandidates: MAX_CANDIDATES, auditModels: AUDIT_MODELS, auditModelDefault: str(env.OPENAI_AUDIT_MODEL, 40) });
    if (action === 'buyer') {
      const theme = str(body.theme, 80);
      if (!theme) return send(res, 400, { ok: false, failedStep: '準備', error: 'テーマがありません' });
      const avoid = (Array.isArray(body.avoid) ? body.avoid : []).map((x) => str(x, 80)).filter(Boolean).slice(0, 30);
      return send(res, 200, await buyerStep({ theme, avoid, env, referer, startedAt }));
    }
    const candidates = readCandidates(body.candidates);
    const results = readResults(body.results);
    if (action === 'check') {
      if (!candidates.length) return send(res, 400, { ok: false, failedStep: 'コードの確認', error: '候補がありません' });
      return send(res, 200, await checkStep({ candidates, results, env, referer, startedAt }));
    }
    if (action === 'audit') {
      if (!candidates.length) return send(res, 400, { ok: false, failedStep: '監査AI：採点', error: '候補がありません' });
      const checks = (Array.isArray(body.checks) ? body.checks : []).slice(0, MAX_CANDIDATES).map((c) => {
        const list = (Array.isArray(c && c.checks) ? c.checks : []).slice(0, 10).map((x) => ({ label: str(x && x.label, 60), ok: x && x.ok === true ? true : x && x.ok === false ? false : null, detail: str(x && x.detail, 200), hard: !(x && x.hard === false) }));
        // 合否はサーバーで数え直す（画面から送られた hardFail を信じない）
        return { id: str(c && c.id, 6), checks: list, hardFail: list.some((x) => x.hard && x.ok === false), unknown: list.some((x) => x.hard && x.ok === null) };
      });
      const r = await auditStep({ candidates, results, checks, model: str(body.model, 40), env, startedAt });
      if (r.ok) {
        const rev = body.revisions && typeof body.revisions === 'object' ? body.revisions : {};
        // 判定はコードが決める（コードの確認 → 監査AIのフラグ → 合計点 → 修正の回数）
        r.decisions = candidates.map((c) => ({ id: c.id, ...decide({ check: checks.find((k) => k.id === c.id) || null, audit: r.audits.find((a) => a.id === c.id) || null, revisions: Math.max(0, Math.min(MAX_REVISIONS, Number(rev[c.id]) || 0)) }) }));
      }
      return send(res, 200, r);
    }
    if (action === 'revise') {
      const targets = (Array.isArray(body.targets) ? body.targets : []).slice(0, MAX_CANDIDATES).map((t) => ({
        candidate: readCandidates([t && t.candidate])[0], why: str(t && t.why, 200), needResearch: str(t && t.needResearch, 160),
        fixes: (Array.isArray(t && t.fixes) ? t.fixes : []).map((x) => str(x, 160)).slice(0, 5), codeNg: (Array.isArray(t && t.codeNg) ? t.codeNg : []).map((x) => str(x, 160)).slice(0, 6)
      })).filter((t) => t.candidate);
      if (!targets.length) return send(res, 400, { ok: false, failedStep: 'バイヤーAI：修正', error: '直す候補がありません' });
      return send(res, 200, await reviseStep({ targets, results, env, startedAt }));
    }
    return send(res, 400, { ok: false, error: '操作が分かりません' });
  } catch (e) {
    return send(res, 200, { ok: false, failedStep: action || '不明', error: maskSecrets(e.message).slice(0, 300) });
  }
}
