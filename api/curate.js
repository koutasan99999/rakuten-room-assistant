// 「選び方まとめを作る」ボタンから呼ばれるAPI。
// テーマの枠ごとに楽天で商品を集め、AIが「どれを・なぜこの順番で・どんな人に」を組み立てる。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { pickTheme, CURATION_TYPES } from '../lib/themes.js';
import { searchSlot } from '../lib/rakuten.js';
import { buildCuration, fallbackCuration } from '../lib/curation.js';
import { maskSecrets } from '../lib/ai.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;

  const body = await readBody(req);
  const type = CURATION_TYPES[body.type] ? body.type : null; // 未指定ならおまかせ
  const theme = pickTheme(type);
  const referer = requestReferer(req, env);

  // 枠ごとに楽天で検索（楽天APIは1秒1リクエストまでなので間を空ける）
  const slots = [];
  let lastError = null;
  for (const [i, slot] of theme.slots.entries()) {
    if (i > 0) await sleep(1100);
    try {
      slots.push({ ...slot, items: await searchSlot({ ...slot, env, referer }) });
    } catch (e) {
      lastError = e;
      console.error('[rakuten]', e.message);
      if (/40[13]/.test(e.message)) break; // 認証エラーは繰り返さない
      slots.push({ ...slot, items: [] });
    }
  }
  const filled = slots.filter((s) => s.items.length);
  if (filled.length < 2) {
    if (lastError && !filled.length) {
      return send(res, 502, { error: '楽天市場の商品を取得できませんでした。少し時間をおいてもう一度お試しください。', detail: lastError.message });
    }
    return send(res, 200, { typeName: CURATION_TYPES[theme.type].name, title: theme.title, products: [], notice: 'このテーマでは商品が十分に見つかりませんでした。もう一度押してみてください。' });
  }

  let curation;
  let notice = '';
  let detail;
  try {
    curation = await buildCuration({ theme, slots: filled, env, deadline: startedAt + 52000 });
  } catch (e) {
    console.error('[openai] fallback:', e.message);
    curation = fallbackCuration({ theme, slots: filled });
    notice = 'AIでのまとめ作成に失敗したため、各枠の商品だけを表示しています。';
    detail = `原因: ${maskSecrets(e.message)}`.slice(0, 400);
  }
  return send(res, 200, { typeName: CURATION_TYPES[theme.type].name, themeId: theme.id, ...curation, notice, detail });
}
