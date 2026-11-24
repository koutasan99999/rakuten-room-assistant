// バイヤーの自律発掘（KOT-9・2026-11-20）：案件の工程が無いとき、季節の言葉で楽天を1回だけ検索し、新しい商品の「候補メモ」をためる
//   - AIは使わない（費用0円）。楽天の検索は1回（1秒1回の決まりの範囲）
//   - 候補メモは「採用」ではない。企画が案件を始めるときの参考にするだけ。外部への投稿・購入はしない
//   - 水増し防止：12時間に1回／ためる上限 SCOUT_MAX 件／同じ商品（商品番号）は重複して入れない／新しい候補が0件なら理由を残す
import { searchPage } from '../rakuten.js';
import { seasonWords } from '../buyer-angles.js';

export const SCOUT_KEY = 'v2:scout';
export const SCOUT_EVERY_HOURS = 12;
export const SCOUT_MAX = 30;
export const SCOUT_ADD_MAX = 5;
const MARKS = ['予約', '新発売', '新商品'];

export async function scoutState(kv) {
  const s = (await kv.getJson(SCOUT_KEY)) || {};
  return { at: s.at || '', items: Array.isArray(s.items) ? s.items : [], tries: Number(s.tries) || 0 };
}
export function scoutNone(s, nowMs = Date.now()) {
  if (s.items.length >= SCOUT_MAX) return `候補メモが上限（${SCOUT_MAX}件）。企画が使うまで増やさない`;
  if (s.at && nowMs - Date.parse(s.at) < SCOUT_EVERY_HOURS * 3600000) return `新商品・予約商品の探索は${SCOUT_EVERY_HOURS}時間に1回（前回 ${s.at.slice(5, 16).replace('T', ' ')}）`;
  return '';
}
// 重複を除いて追加する（純粋関数）
export function mergeCandidates(old, found, known = [], at = new Date().toISOString()) {
  const seen = new Set([...old.map((x) => x.code), ...known]);
  const add = [];
  for (const it of found) {
    if (add.length >= SCOUT_ADD_MAX || old.length + add.length >= SCOUT_MAX) break;
    if (!it || !it.code || seen.has(it.code)) continue;
    seen.add(it.code);
    add.push({ code: it.code, name: String(it.name || '').slice(0, 80), price: Number(it.price) || 0, url: it.url || '', at });
    if (add.length >= SCOUT_ADD_MAX || old.length + add.length >= SCOUT_MAX) break;
  }
  return { items: [...old, ...add], added: add.length };
}
export async function scoutWork(kv, knownCodes = async () => []) {
  const s = await scoutState(kv);
  const none = scoutNone(s);
  if (none) return { none };
  return { kind: 'scout', task: '新商品・予約商品を楽天で探して、候補メモにためる（AIは使わない・採用はしない）', doing: '新商品・予約商品を楽天で探しています', est: 0, run: (ctx) => scoutRun(kv, ctx, knownCodes) };
}
async function scoutRun(kv, ctx, knownCodes) {
  const s = await scoutState(kv);
  const words = seasonWords();
  const word = words.length ? words[s.tries % words.length] : '';
  const mark = MARKS[s.tries % MARKS.length];
  const keyword = `${word} ${mark}`.trim();
  const at = new Date().toISOString();
  await kv.setJson(SCOUT_KEY, { ...s, at, tries: s.tries + 1 }); // 失敗しても同じ時間に何度も呼ばない
  let r;
  try { r = await searchPage({ keyword, env: ctx.env, referer: ctx.referer, hits: 20 }); } catch (e) { return { fail: `楽天の検索に失敗：${String(e.message || e).slice(0, 60)}` }; }
  const m = mergeCandidates(s.items, r.items || [], await knownCodes(), at);
  await kv.setJson(SCOUT_KEY, { at, tries: s.tries + 1, items: m.items });
  return { done: m.added ? `「${keyword}」で探し、新しい候補メモを${m.added}件ためた（合計${m.items.length}件・採用はしていない）` : `「${keyword}」で探したが、新しい候補は無かった（重複は入れない）` };
}
