// 企画タイトルの再提案：今の企画の内容（テーマ・方向性・ジャンル・入っている商品）から、タイトルを3〜5案。
// 提案は候補として返すだけで、画面ではユーザーが選んだときだけ置き換える（手で直したタイトルを勝手に上書きしない）。
import { AiError, compact, cleanText, runWithModels } from './ai.js';
import { titleIssues } from './release.js';

export const MIN_TITLES = 3;
export const MAX_TITLES = 5;
const SERIES_RE = /(について)?本気出して考えてみた$/;
const HYPE_RE = /完売確実|爆売れ|史上最高|史上最強|絶対|最安|売り切れ必至|今すぐ買/;

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function readPlanForTitles(x) {
  if (!x || typeof x !== 'object') return null;
  const series = ['serious', 'release', 'other'].includes(x.series) ? x.series : 'other';
  const products = (Array.isArray(x.products) ? x.products : []).slice(0, 20)
    .map((p) => (p && p.name ? { name: str(p.name, 80), brand: str(p.brand, 30), price: Number(p.price) || 0 } : null)).filter(Boolean);
  const hero = x.hero && x.hero.name ? {
    name: str(x.hero.name, 120), brand: str(x.hero.brand, 30), price: Number(x.hero.price) || 0,
    status: (Array.isArray(x.hero.status) ? x.hero.status : []).map((s) => str(s, 20)).slice(0, 8),
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(String(x.hero.releaseDate || '')) ? x.hero.releaseDate : null,
    releaseMonth: /^\d{4}-\d{2}$/.test(String(x.hero.releaseMonth || '')) ? x.hero.releaseMonth : null
  } : null;
  const plan = {
    series,
    title: str(x.title, 60), subtitle: str(x.subtitle, 40), theme: str(x.theme, 40), direction: str(x.direction, 200),
    genre: str(x.genre, 30), catchCopy: str(x.catchCopy, 40), avoid: (Array.isArray(x.avoid) ? x.avoid : []).map((t) => str(t, 60)).filter(Boolean).slice(0, 12),
    products, hero
  };
  return plan.title || plan.theme || plan.products.length || plan.hero ? plan : null;
}

function prompt(plan) {
  const shape = plan.series === 'serious'
    ? '「○○について本気出して考えてみた」のシリーズ。title には ○○ の部分だけを入れる（24字以内。シリーズの言葉は付けない）'
    : plan.series === 'release'
      ? '新作特集の表紙に大きく載せる短いキャッチ。16字前後、長くても24字。「本気出して考えてみた」は使わない。予約・発売日・限定・再販・コラボ・新色は「確認できた情報」にあるときだけ書く'
      : 'Instagramの表紙に載せる、何の投稿か一目で分かるタイトル（24字以内）';
  return `あなたはInstagram投稿のタイトル係です。JSONだけを返してください。
今の企画の内容と、企画に入っている商品を見て、タイトルを${MIN_TITLES}〜${MAX_TITLES}案つくります。
- 形: ${shape}
- 企画のテーマ・方向性・入っている商品に合わせる。具体的な言葉（商品の種類・ブランド・用途・価格）を優先する
- 案ごとに切り口と言い回しを変える（語尾をそろえない）。「今のタイトル」「避けるタイトル」と同じ・ほぼ同じ案は出さない
- 「完売確実」「爆売れ」「史上最高」「最安」など根拠のない言葉は使わない

出力形式:
{"titles":[{"title":"...","why":"この案のねらい（30字以内）"}]}`;
}

const STATUS_JA = { NEW: '新発売', COMING_SOON: '発売予定', PRE_ORDER: '予約受付中', RESTOCK: '再販・再入荷', LIMITED: '限定', COLLAB: 'コラボ', NEW_COLOR: '新色', SPECIAL: '期間限定' };

function userContent(plan) {
  return [
    plan.title && `今のタイトル: ${plan.title}`,
    plan.theme && `企画テーマ: ${plan.theme}`,
    plan.subtitle && `サブタイトル: ${plan.subtitle}`,
    plan.direction && `企画の方向性: ${plan.direction}`,
    plan.genre && `対象ジャンル: ${plan.genre}`,
    plan.hero && `表紙の主役（起点の商品）: ${compact(plan.hero.name, 80)}${plan.hero.brand ? `（${plan.hero.brand}）` : ''}`,
    plan.series === 'release' && `確認できた情報: ${(plan.hero && plan.hero.status.map((s) => STATUS_JA[s] || s).join('・')) || 'なし'}`,
    plan.products.length && `企画に入っている商品:\n${plan.products.map((p) => `- ${compact(p.name, 50)}${p.brand ? ` / ${p.brand}` : ''}${p.price ? ` / ${p.price}円` : ''}`).join('\n')}`,
    plan.avoid.length && `避けるタイトル: ${plan.avoid.join('／')}`
  ].filter(Boolean).join('\n');
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function cleanTitle(raw, plan) {
  let t = cleanText(raw).replace(/^[「『"]|[」』"]$/g, '');
  if (plan.series === 'serious') t = t.replace(SERIES_RE, '').replace(/について$/, '');
  t = t.slice(0, 40);
  if (!t || t.length > (plan.series === 'release' ? 28 : 30) || HYPE_RE.test(t)) return '';
  if (plan.series === 'release') {
    const h = plan.hero || { status: [] };
    if (titleIssues(t, { status: h.status || [], releaseDate: h.releaseDate, releaseMonth: h.releaseMonth, today: today() }).length) return '';
  }
  const same = (a) => a.replace(SERIES_RE, '').replace(/[\s、。！!？?]/g, '') === t.replace(/[\s、。！!？?]/g, '');
  if ((plan.title && same(plan.title)) || plan.avoid.some(same)) return '';
  return t;
}

// AIが使えないとき：テーマ・ジャンル・主役の商品から決まった言い回し
export function fallbackTitles(plan) {
  const base = plan.theme || plan.genre || (plan.hero && plan.hero.brand) || 'このジャンル';
  const brand = plan.hero && plan.hero.brand;
  const raw = plan.series === 'release'
    ? [brand && `${brand}の新作、待ってた。`, `今月の${plan.genre || '新作'}、気になるものだけ。`, 'この新作、ちょっと見てほしい。', `${base}の新作、集めました。`]
    : plan.series === 'serious'
      ? [base, `${base}、結局どれを選ぶ？`, `${base}の選び方`, `最初の${base}`]
      : [`${base}、結局どれ？`, `${base}の選び方`, `迷ったときの${base}`, `${base}まとめ`];
  return [...new Set(raw.filter(Boolean).map((t) => cleanTitle(t, plan)).filter(Boolean))].slice(0, MAX_TITLES).map((title) => ({ title, why: '' }));
}

export async function suggestTitles({ plan, env, deadline }) {
  try {
    const { result } = await runWithModels({
      env, deadline, system: prompt(plan), userContent: userContent(plan),
      parse: (content) => {
        let data;
        try { data = JSON.parse(String(content).match(/\{[\s\S]*\}/)[0]); } catch { throw new AiError('AIの応答を読み取れませんでした'); }
        const seen = new Set();
        const out = [];
        for (const x of Array.isArray(data.titles) ? data.titles : []) {
          const title = cleanTitle(x && x.title, plan);
          if (!title || seen.has(title)) continue;
          seen.add(title);
          out.push({ title, why: cleanText(x.why).slice(0, 40) });
          if (out.length >= MAX_TITLES) break;
        }
        if (out.length < 2) throw new AiError(`使えるタイトルが${out.length}案しかありませんでした`);
        return out;
      }
    });
    return { titles: result, fallback: false };
  } catch (e) {
    console.error('[openai] plan titles fallback:', e.message);
    return { titles: fallbackTitles(plan), fallback: true, error: e.message };
  }
}
