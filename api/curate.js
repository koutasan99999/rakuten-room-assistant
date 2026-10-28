// 「選び方まとめを作る」ボタンから呼ばれるAPI。
// テーマの枠ごとに楽天で商品を集め、AIが「どれを・なぜこの順番で・どんな人に」を組み立てる。
import { send, checkAccess, readBody, requestReferer } from '../lib/http.js';
import { pickTheme, CURATION_TYPES } from '../lib/themes.js';
import { resolveFilterGenre } from '../lib/genres.js';
import { findPlan, planToTheme } from '../lib/plans.js';
import { normalizeIdea, ideaToTheme } from '../lib/ideas.js';
import { planSearch, sanitizeFreeText } from '../lib/planner.js';
import { searchSlot } from '../lib/rakuten.js';
import { buildCuration, fallbackCuration, replaceContext } from '../lib/curation.js';
import { maskSecrets } from '../lib/ai.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;

  const body = await readBody(req);
  const filterGenre = resolveFilterGenre(body.genre);
  const free = sanitizeFreeText(body.free);
  let type = CURATION_TYPES[body.type] ? body.type : null; // 未指定ならおまかせ
  let theme;
  const seriesPlan = findPlan(body.planId);
  const idea = body.idea ? normalizeIdea(body.idea) : null;
  if (idea) {
    // 「今日の企画を考える」で選んだ企画：企画の役割の枠で作る
    theme = ideaToTheme(idea);
    type = theme.type;
  } else if (seriesPlan) {
    // 企画（最初の10投稿）：決めてある役割の枠で作る
    theme = planToTheme(seriesPlan);
    type = theme.type;
  } else if (filterGenre || free) {
    // 条件の指定あり：AIが条件を読み取り、型に沿った枠（検索語・価格帯）を組み立てる
    type = type || 'first_pick';
    const plan = await planSearch({ genre: filterGenre, type, free, env, deadline: startedAt + 15000 });
    theme = {
      id: 'custom',
      type,
      title: plan.title || plan.summary,
      audience: plan.audience,
      brand: plan.brand || !!(filterGenre && filterGenre.brand),
      request: [plan.summary && `探すもの: ${plan.summary}`, free && `ユーザーの言葉: ${free}`].filter(Boolean).join('\n'),
      slots: plan.slots
    };
  } else {
    theme = pickTheme(type);
  }
  const referer = requestReferer(req, env);

  // 枠ごとに楽天で検索（楽天APIは1秒1リクエストまでなので間を空ける）
  const slots = [];
  let lastError = null;
  for (const [i, slot] of theme.slots.entries()) {
    if (i > 0) await sleep(1100);
    try {
      let items = await searchSlot({ ...slot, env, referer });
      const shorter = slot.keyword.split(' ').slice(0, 2).join(' ');
      if (!items.length && theme.id === 'custom' && shorter !== slot.keyword) {
        // 条件指定の検索語が細かすぎて0件のときは、語を減らして1回だけ取り直す
        await sleep(1100);
        items = await searchSlot({ ...slot, keyword: shorter, env, referer });
      }
      slots.push({ ...slot, items });
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
    return send(res, 200, { typeName: CURATION_TYPES[theme.type].name, title: theme.title, products: [], notice: theme.id === 'custom' ? 'この条件では商品が十分に見つかりませんでした。条件を少しゆるめてもう一度お試しください。' : 'このテーマでは商品が十分に見つかりませんでした。もう一度押してみてください。' });
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
  if (!notice && curation.warnings && curation.warnings.length) notice = curation.warnings.join('。') + '。';
  return send(res, 200, { typeName: CURATION_TYPES[theme.type].name, themeId: theme.id, plan: theme.plan || null, idea: theme.idea || null, ...curation, context: replaceContext(theme), notice, detail });
}
