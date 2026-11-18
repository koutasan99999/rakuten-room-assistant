// サングラスくま株式会社 2.0：成果の数字（2026-11-18 社長の指示：評価は「実際に投稿できる完成セットの数・投稿の実績・楽天ROOMへの流入」）
//   - 投稿できる完成品の判定（コードだけ・AIは使わない）：表紙画像・PR表記のあるキャプション・商品数・商品ごとのURLとROOM紹介文（価格が未確認の商品は画面で「未確認」と出すので、判定では止めない）
//   - リール：端末で動画の実ファイルを作れた記録（大きさ・長さ）があるものだけ数える（作っていない・作れなかったものは数えない）
//   - 鑑定（ポストの担当）が、手が空いたときに1日1回、数字を記録する（費用0円。数字が変わらない日は記録しない）
//   取れない数字（投稿ごとの売上・ROOMへのクリック）は推測しない。社長の登録（Instagramのインサイト・楽天のレポート）だけを足す
const K = { sets: 'v2:sets', set: (id) => `v2:set:${id}`, perf: 'v2:perf', reels: 'v2:reels', kpi: 'v2:kpi', kpiHist: 'v2:kpi:hist' };
export { K as KPI_KEYS };
export const POSTABLE_MIN_ITEMS = 6;
export const REEL_MIN_BYTES = 50 * 1024;
export const REEL_MIN_SECONDS = 5;
const now = () => new Date().toISOString();
const jst = (d = new Date()) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);

// 投稿できる完成品か（足りないものを返す）
export function postable(s) {
  const missing = [];
  if (!s) return { ok: false, missing: ['完成品が無い'] };
  if (!(s.image && (s.image.mediaId || s.image.url))) missing.push('表紙画像');
  if (!/PR|アフィリエイト/.test(String(s.caption || ''))) missing.push('PR表記のあるキャプション');
  const ps = s.products || [];
  if (ps.length < POSTABLE_MIN_ITEMS) missing.push(`商品${POSTABLE_MIN_ITEMS}点（今${ps.length}点）`);
  if (ps.some((p) => !p.url)) missing.push('商品のURL');
  if (ps.some((p) => !String(p.room || '').trim())) missing.push('ROOM紹介文');
  return { ok: !missing.length, missing };
}
// リールの実ファイルの記録として認めるか
export function reelFileOk(r) { return !!r && Number(r.bytes) >= REEL_MIN_BYTES && Number(r.seconds) >= REEL_MIN_SECONDS && /^video\/(mp4|webm)/.test(String(r.mime || '')); }

export async function computeKpi(kv) {
  const [list, perf0, reels0] = await Promise.all([kv.getJson(K.sets), kv.getJson(K.perf), kv.getJson(K.reels)]);
  const sets = (list || []).slice(0, 80);
  const reels = (reels0 || []).filter(reelFileOk);
  const reelSets = new Set(reels.map((r) => r.setId));
  const out = { postable: 0, postableWaiting: 0, postableAdopted: 0, notPostable: 0, posted: 0, reelFiles: reels.length, reelSets: 0, notPostableWhy: {} };
  for (const x of sets) {
    if (!['waiting', 'adopted', 'posted'].includes(x.status)) continue;
    if (x.status === 'posted') out.posted += 1;
    const s = await kv.getJson(K.set(x.id));
    const p = postable(s);
    if (p.ok) { out.postable += 1; if (x.status === 'waiting') out.postableWaiting += 1; if (x.status === 'adopted') out.postableAdopted += 1; if (reelSets.has(x.id)) out.reelSets += 1; }
    else { out.notPostable += 1; for (const m of p.missing) out.notPostableWhy[m] = (out.notPostableWhy[m] || 0) + 1; }
  }
  const perf = perf0 || [];
  const sum = (k) => perf.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const has = (k) => perf.some((r) => r[k] != null);
  out.perfPosts = perf.length;
  out.views = has('views') ? sum('views') : null;
  out.profileVisits = has('profileVisits') ? sum('profileVisits') : null;
  out.roomClicks = has('roomClicks') ? sum('roomClicks') : null;
  out.sales = has('sales') ? sum('sales') : null;
  out.sources = { sets: 'アプリの記録', reelFiles: '端末で作れた動画の記録（大きさ・長さつき）', perf: '社長の登録（Instagramのインサイト・楽天のレポート）。未登録は「未取得」' };
  return out;
}
const sig = (k) => JSON.stringify([k.postable, k.postableWaiting, k.postableAdopted, k.notPostable, k.posted, k.reelFiles, k.reelSets, k.perfPosts, k.views, k.profileVisits, k.roomClicks, k.sales]);

// 鑑定の仕事探し：1日1回、または数字が変わったときだけ記録する（変わらなければ仕事にしない）
export async function kpiWork(kv) {
  const last = await kv.getJson(K.kpi);
  const k = await computeKpi(kv);
  if (last && last.day === jst() && last.sig === sig(k)) return null;
  return { kind: 'kpi', task: '成果の数字（投稿できる完成品・投稿の実績・リールの動画・ROOMへの流入）を記録する（AIは使わない）', doing: '成果の数字を記録しています', est: 0, run: () => kpiRun(kv) };
}
async function kpiRun(kv) {
  const k = await computeKpi(kv);
  const rec = { ...k, day: jst(), at: now(), sig: sig(k) };
  await kv.setJson(K.kpi, rec);
  const hist = ((await kv.getJson(K.kpiHist)) || []).filter((h) => h.day !== rec.day);
  await kv.setJson(K.kpiHist, [{ day: rec.day, postable: k.postable, posted: k.posted, reelFiles: k.reelFiles, roomClicks: k.roomClicks, sales: k.sales }, ...hist].slice(0, 60));
  const why = Object.entries(k.notPostableWhy).map(([m, n]) => `${m}${n}件`).join('・');
  return { done: `成果の数字を記録した（投稿できる完成品${k.postable}件・投稿済み${k.posted}件・リールの動画${k.reelFiles}本・ROOMへの流入${k.roomClicks ?? '未取得'}${why ? `。投稿できない完成品の不足：${why}` : ''}）` };
}
export async function kpiState(kv) {
  const [last, hist] = await Promise.all([kv.getJson(K.kpi), kv.getJson(K.kpiHist)]);
  const cur = await computeKpi(kv);
  return { current: cur, recordedAt: last ? last.at : '', history: (hist || []).slice(0, 30) };
}
