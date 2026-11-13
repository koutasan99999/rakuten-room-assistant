// AIの実際の使用量の記録（段階0・2026-11-12）。
// OpenAIの応答に入っている使用量（トークン数）と応答ID・かかった時間・成功/失敗を、AIの呼び出し1回ごとに記録する。
// 1つのリクエストの中で呼んだAIは、AsyncLocalStorage でまとめ、応答（JSON）に aiUsage として付ける（lib/http.js の send）。
// 費用は「実際のトークン数 × 単価」で計算する。単価は下の表（出典と確認日つき）。表にないモデルは、表の中で一番高い単価で計算し、priceKnown: false にする（少なく見積もらない）。
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

// 100万トークンあたりの米ドル
export const PRICES = {
  'gpt-5.4-nano': { input: 0.20, cachedInput: 0.02, output: 1.25, source: 'OpenAIの開発者向けページ・OpenRouter（2026-11-12 の検索結果の要約。料金ページ本体は未確認）' },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.40, source: '未確認（2026-11-12 時点で出典を確認していない。以前に公表された値）' },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.60, source: '未確認（2026-11-12 時点で出典を確認していない。以前に公表された値）' }
};
// 1ドルあたりの円（為替の仮定。アプリの推定と同じ値）
export const YEN_PER_USD = 160;
const FALLBACK = Object.values(PRICES).reduce((a, b) => (b.output > a.output ? b : a));

// 使用量（OpenAIの usage）から費用（円）を計算する
export function costOf(model, usage) {
  const u = usage || {};
  const known = Object.keys(PRICES).find((k) => String(model || '').startsWith(k));
  const p = known ? PRICES[known] : FALLBACK;
  const prompt = Number(u.prompt_tokens) || 0;
  const cached = Number(u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
  const completion = Number(u.completion_tokens) || 0; // 推論のトークンも、出力のトークンに含まれる
  const usd = ((prompt - cached) * p.input + cached * p.cachedInput + completion * p.output) / 1e6;
  return { yen: Math.round(usd * YEN_PER_USD * 1000) / 1000, priceKnown: !!known };
}

const store = new AsyncLocalStorage();

// このリクエストの中で呼んだAIを記録する箱を用意して、fn を実行する
export function withUsage(fn) {
  return store.run({ calls: [], taken: 0 }, fn);
}

// AIを1回呼んだ記録（lib/ai.js の callOpenAI から呼ぶ）。成功も失敗も記録する
export function noteCall({ model, ok, usage = null, ms = 0, openaiId = '', status = 0, error = '' }) {
  const s = store.getStore();
  const u = usage || {};
  const c = ok && usage ? costOf(model, usage) : { yen: 0, priceKnown: true };
  const rec = {
    id: crypto.randomUUID(), openaiId: String(openaiId || ''), model: String(model || ''), ok: !!ok, status: Number(status) || 0, error: String(error || '').slice(0, 300),
    promptTokens: Number(u.prompt_tokens) || 0, completionTokens: Number(u.completion_tokens) || 0,
    reasoningTokens: Number(u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0,
    cachedTokens: Number(u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0,
    yen: c.yen, priceKnown: c.priceKnown, ms: Math.round(ms), at: new Date().toISOString()
  };
  if (s) s.calls.push(rec);
  return rec;
}

// このリクエストでまだ取り出していない記録（呼び出した側が、役割・段階の名前を付けるため）
export function takeCalls() {
  const s = store.getStore();
  if (!s) return [];
  const out = s.calls.slice(s.taken);
  s.taken = s.calls.length;
  return out;
}

// このリクエストで呼んだAIの合計（応答の aiUsage）
export function usageSummary() {
  const s = store.getStore();
  if (!s || !s.calls.length) return null;
  return summarize(s.calls);
}

export function summarize(calls) {
  const ok = calls.filter((c) => c.ok);
  return {
    calls: calls.length, okCalls: ok.length, failedCalls: calls.length - ok.length,
    yen: Math.round(calls.reduce((a, c) => a + c.yen, 0) * 1000) / 1000,
    promptTokens: calls.reduce((a, c) => a + c.promptTokens, 0), completionTokens: calls.reduce((a, c) => a + c.completionTokens, 0),
    priceKnown: calls.every((c) => c.priceKnown), measured: true,
    runs: calls.map((c) => ({ id: c.id, openaiId: c.openaiId, model: c.model, ok: c.ok, yen: c.yen, ms: c.ms, promptTokens: c.promptTokens, completionTokens: c.completionTokens, error: c.error, role: c.roleName || c.role || '', step: c.step || '' }))
  };
}

// サーバー側の予算の上限（lib/budget.js）を超えているとき、このリクエストの中のAIの呼び出しを止める
export function setBlocked(reason) { const s = store.getStore(); if (s) s.blocked = String(reason || ''); }
export function blockedReason() { const s = store.getStore(); return s && s.blocked ? s.blocked : ''; }
export function allCalls() { const s = store.getStore(); return s ? s.calls.slice() : []; }
