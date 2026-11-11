// 接続の確認：検索やAIが止まったときに、どこで止まっているかを社長の画面から確かめる（2026-11-11）。
// 1. サーバーの設定（鍵が入っているか。値は返さない）
// 2. 楽天の商品検索APIを1回だけ呼ぶ（無料）
// 3. ai: true のときだけ、OpenAIを1回だけ短く呼ぶ（推定0.5円以下。画面で押したときだけ）
import { send, readBody, requestReferer } from '../lib/http.js';
import { searchPage } from '../lib/rakuten.js';
import { runWithModels, maskSecrets } from '../lib/ai.js';
import crypto from 'node:crypto';

function samePass(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  // 合言葉だけ確かめる（鍵が無いときも、無いことを報告できるように checkAccess は使わない）
  if (env.APP_PASSCODE && !samePass(req.headers['x-app-passcode'] || '', env.APP_PASSCODE)) return send(res, 401, { error: '合言葉が違います', needPasscode: true });
  const body = await readBody(req);
  const referer = requestReferer(req, env);
  const out = {
    at: new Date().toISOString(),
    settings: {
      rakutenAppId: !!env.RAKUTEN_APP_ID, rakutenAccessKey: !!env.RAKUTEN_ACCESS_KEY, openaiKey: !!env.OPENAI_API_KEY,
      referer, refererFixed: !!env.RAKUTEN_REFERER
    },
    rakuten: null,
    openai: null
  };
  if (env.RAKUTEN_APP_ID) {
    const t = Date.now();
    try {
      const r = await searchPage({ keyword: 'マグカップ', env, referer, hits: 3 });
      out.rakuten = { ok: r.items.length > 0, ms: Date.now() - t, count: r.items.length, error: r.items.length ? '' : '検索はできたが、商品が0件でした' };
    } catch (e) {
      out.rakuten = { ok: false, ms: Date.now() - t, count: 0, error: maskSecrets(e.message).slice(0, 200) };
    }
  } else out.rakuten = { ok: false, ms: 0, count: 0, error: '楽天の鍵（RAKUTEN_APP_ID）がサーバーに設定されていません' };
  if (body && body.ai === true) {
    if (env.OPENAI_API_KEY) {
      const t = Date.now();
      try {
        const { model } = await runWithModels({ env, deadline: Date.now() + 25000, system: 'JSONだけを返してください。', userContent: '{"ok":true} と返してください', parse: (c) => { if (!String(c || '').trim()) throw new Error('応答が空でした'); return true; } });
        out.openai = { ok: true, ms: Date.now() - t, model, error: '' };
      } catch (e) {
        out.openai = { ok: false, ms: Date.now() - t, model: '', error: maskSecrets(e.message).slice(0, 300) };
      }
    } else out.openai = { ok: false, ms: 0, model: '', error: 'OpenAIの鍵（OPENAI_API_KEY）がサーバーに設定されていません' };
  }
  return send(res, 200, out);
}
