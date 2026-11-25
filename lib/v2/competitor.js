// 競合調査の記録と、自社との差分（2026-11-25・KOT-24・広報＝ECグロース責任者の仕事）
//   アプリは外部のサイトを取りに行かない（Instagramの他アカウントの調査は今の公式APIでは不可）。
//   観測は「社長が公開ページで見た内容」を、出典URL・取得日・観測した事実・推測に分けて登録する。分けていない・架空・一般論は入れない。
//   取得できないときは、完了扱いにせず、原因の分類・再試行の条件・代替の確認・必要最小限の社長の操作を記録する（アクセス制限の回避はしない）。
//   差分の優先順位と販促タスクはコードの計算（AI不要・0円）。AIが要るのは文章の推敲だけで、予算が無くても差分表は作れる。
import { isGenericOrFake } from './policy.js';

export const COMP_KEYS = { obs: 'v2:competitors', report: 'v2:competitors:report', fail: 'v2:competitors:fail' };
export const AXES = ['商品選定', '対象顧客', '訴求', '画像', '冒頭', 'CTA', '投稿頻度', '導線', '反応'];
const now = () => new Date().toISOString();
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const PUBLIC_HOST = /^https:\/\/([\w-]+\.)*(instagram\.com|room\.rakuten\.co\.jp|rakuten\.co\.jp|item\.rakuten\.co\.jp|rakuten\.com|meta\.com|facebook\.com)\//;
const SALES_RE = /月[0-9０-９,，万]+円|売上[はが]?[0-9０-９,，万]+|[0-9０-９,，万]+円(売|稼)|稼い|収益[はが]?[0-9０-９]/;

// 観測1件の検証。通らなければ理由つきで入れない
export function checkObservation(o = {}) {
  const issues = [];
  const url = str(o.sourceUrl, 300);
  if (!PUBLIC_HOST.test(url) || /example\./i.test(url)) issues.push('出典URLが無い（公開ページの https の URL が必要）');
  const at = str(o.fetchedAt, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at) || Number.isNaN(Date.parse(at)) || Date.parse(at) > Date.now() + 86400000) issues.push('取得日（YYYY-MM-DD・未来でない）が無い');
  const facts = (Array.isArray(o.facts) ? o.facts : []).map((f) => ({ axis: str(f && f.axis, 12), text: str(f && f.text, 200) })).filter((f) => f.text);
  if (!facts.length) issues.push('観測した事実が無い');
  for (const f of facts) {
    if (!AXES.includes(f.axis)) issues.push(`比較軸「${f.axis || '空'}」は対象外（${AXES.join('・')}）`);
    if (isGenericOrFake(f.text)) issues.push(`事実の文が具体的でない：「${f.text.slice(0, 30)}」`);
    if (SALES_RE.test(f.text) && !o.salesDisclosed) issues.push('実売上は非公開が前提。公開ページに売上が明記されている場合だけ salesDisclosed を付けて登録');
  }
  const inference = str(o.inference, 300);
  if (inference && SALES_RE.test(inference)) issues.push('推測の欄に売上の断定は書けない');
  if (issues.length) return { ok: false, issues: [...new Set(issues)] };
  return { ok: true, value: { id: `${at}-${Math.random().toString(36).slice(2, 8)}`, sourceUrl: url, fetchedAt: at, account: str(o.account, 60), facts, inference, inferenceNote: inference ? '推測（観測した事実ではない）' : '', salesDisclosed: !!o.salesDisclosed, addedAt: now() } };
}
export async function addObservation(kv, o) {
  const c = checkObservation(o);
  if (!c.ok) throw new Error(`競合の観測を入れられません：${c.issues.join('／')}`);
  const list = (await kv.getJson(COMP_KEYS.obs)) || [];
  if (list.some((x) => x.sourceUrl === c.value.sourceUrl && x.fetchedAt === c.value.fetchedAt && JSON.stringify(x.facts) === JSON.stringify(c.value.facts))) throw new Error('同じ観測がもう入っています');
  await kv.setJson(COMP_KEYS.obs, [c.value, ...list].slice(0, 200));
  return c.value;
}

// 取得の失敗の分類（取得できたことにしない・回避しない）
export function classifyFailure({ status = 0, message = '', target = '' } = {}) {
  const m = String(message || '');
  const base = { target: str(target, 200), at: now(), bypass: '禁止（ログイン・アクセス制限・取得制限の回避はしない）' };
  if (status === 401 || status === 403 || /login|ログイン|permission|権限/i.test(m)) return { ...base, category: 'login-or-permission', retryWhen: '公式APIの権限が付いたとき（Meta の審査後）。アプリは自動で再試行しない', alternative: '公開ページ（ブラウザで誰でも見られる範囲）を社長が見て、観測として登録する', humanAction: '見える範囲の投稿1〜3件の内容を、URLと日付つきで登録（ログインが要る範囲は見ない）' };
  if (status === 429 || /rate|too many|制限/i.test(m)) return { ...base, category: 'rate-limited', retryWhen: '24時間後に1回だけ', alternative: '既存データ（自社の実績・完成品）での確認を先に行う', humanAction: 'なし（待つだけ）' };
  if (status === 404) return { ...base, category: 'not-found', retryWhen: 'URLが変わったとき', alternative: '別の公開ページを探す', humanAction: '正しいURLの登録' };
  if (/timeout|ECONN|network|fetch failed/i.test(m) || status >= 500) return { ...base, category: 'network-or-server', retryWhen: '次の定期実行（15分後）から最大3回', alternative: '既存データでの確認', humanAction: 'なし' };
  return { ...base, category: 'unknown', retryWhen: '原因が分かるまで再試行しない', alternative: '既存データでの確認', humanAction: 'エラーの内容を確認して知らせる' };
}
export async function recordFetchFailure(kv, f) {
  const c = classifyFailure(f);
  const list = (await kv.getJson(COMP_KEYS.fail)) || [];
  await kv.setJson(COMP_KEYS.fail, [c, ...list].slice(0, 30));
  return c;
}

// 軸ごとの差分の優先順位：観測した競合の数（出典の種類数）→新しい取得日。自社の欄が無い軸は「自社は未確認」と書く
const ACTION = {
  '商品選定': { owner: 'buyer', make: '競合が扱う商品の特徴と、自社の完成品の商品の違いを並べる' },
  '対象顧客': { owner: 'planner', make: '対象の顧客と悩みを、完成品の企画に書き足す' },
  '訴求': { owner: 'writer', make: '冒頭・紹介文の訴求を、観測した型に合わせた別案にする（事実は保存済みのものだけ）' },
  '画像': { owner: 'designer', make: '表紙の構図・文字量を観測と比べて点検する' },
  '冒頭': { owner: 'writer', make: 'リール冒頭の一言を観測した型の別案にする' },
  'CTA': { owner: 'writer', make: 'ROOMへ案内する一文を観測した型の別案にする' },
  '投稿頻度': { owner: 'planner', make: '観測した頻度と、自社の投稿の順番案を比べる（ノルマにしない）' },
  '導線': { owner: 'pr', make: 'プロフィール→ROOM→楽天の導線を観測と比べて短くする' },
  '反応': { owner: 'pr', make: '観測した反応（公開の数字）と、自社の登録済みの実績を比べる' }
};
export function buildReport(obs, sets = [], perf = []) {
  const byAxis = {};
  for (const o of obs) for (const f of o.facts) (byAxis[f.axis] = byAxis[f.axis] || []).push({ id: o.id, url: o.sourceUrl, at: o.fetchedAt, text: f.text, account: o.account });
  const postable = sets.filter((s) => ['waiting', 'adopted', 'posted'].includes(s.status));
  const gaps = Object.entries(byAxis).map(([axis, rows]) => ({ axis, sources: new Set(rows.map((r) => r.url)).size, latest: rows.map((r) => r.at).sort().pop(), evidence: rows.slice(0, 5), own: axis === '反応' && perf.length ? `自社の登録済みの実績 ${perf.length}件` : '自社の同じ軸の記録は、このアプリには無い（未確認）' }))
    .sort((a, b) => b.sources - a.sources || (a.latest < b.latest ? 1 : -1))
    .map((g, i) => ({ ...g, priority: i + 1 }));
  const tasks = gaps.flatMap((g) => postable.slice(0, 2).map((s) => ({ axis: g.axis, priority: g.priority, owner: ACTION[g.axis].owner, setId: s.id, setTitle: s.title, what: `「${s.title}」：${ACTION[g.axis].make}`, evidence: g.evidence.map((e) => e.url).slice(0, 3), verify: '完成品の更新後に、使った施策つきで実績（閲覧・クリック・成約）を登録して比べる。実績が出るまで「効果あり」とは言わない' })));
  return { at: now(), observations: obs.length, gaps, tasks: postable.length ? tasks.slice(0, 12) : [], noTaskReason: postable.length ? '' : '販促できる既存の完成品が無いため、タスクにしない',
    needs: { free: ['差分の優先順位づけ（コード）', '販促タスクへの変換（コード）', '完成品の点検（既存の0円の仕事）'], ai: ['タスクの文章の推敲（AI予算が要る・無くても差分表は有効）'], humanOnly: ['公開ページの観測の登録（社長）'] },
    caution: '競合の実売上は非公開。観測した事実と推測は分けて保存している。この表だけで売上が改善したとは言えない' };
}

// 広報の仕事（0円）：観測が無ければ「取得できていない」を記録して終える。完了扱いにしない
export async function competitorWork(kv) {
  const [obs, sets, perf] = await Promise.all([kv.getJson(COMP_KEYS.obs), kv.getJson('v2:sets'), kv.getJson('v2:perf')]);
  const list = obs || [];
  const last = await kv.getJson(COMP_KEYS.report);
  if (!list.length) {
    if (last && last.unobtainable) return null;
    return { kind: 'competitor-unobtainable', task: '競合の公開情報の観測が無い。取得できない理由と、最小限の人間の操作を記録する（AI・外部サイトは使わない・0円）', doing: '競合調査の状況を整理しています', est: 0, run: async () => {
      const c = classifyFailure({ status: 403, target: 'Instagramの他アカウントの調査（今の公式APIでは不可）' });
      await kv.setJson(COMP_KEYS.report, { at: now(), unobtainable: true, cause: c, observations: 0, note: '競合の分析は未実施（観測が登録されるまで差分は出さない）' });
      return { done: `競合の分析は未実施：観測が0件（原因：${c.category}）。社長の操作：${c.humanAction}。完了とはしない`, title: '競合調査（未実施）' };
    } };
  }
  const sig = JSON.stringify([list.map((o) => o.id), (sets || []).length, (perf || []).length]);
  if (last && last.sig === sig) return null;
  return { kind: 'competitor-gap', task: `競合の観測${list.length}件と自社の差分を優先順位づけし、既存の完成品の販促タスクにする（AIは使わない・0円）`, doing: '競合との差分を整理しています', est: 0, run: async () => {
    const listSets = [];
    for (const x of ((await kv.getJson('v2:sets')) || []).slice(0, 40)) listSets.push(x);
    const rep = buildReport(list, listSets, (await kv.getJson('v2:perf')) || []);
    await kv.setJson(COMP_KEYS.report, { ...rep, sig });
    const top = rep.gaps[0];
    if (!rep.tasks.length) return { done: `競合の差分を${rep.gaps.length}軸で整理（最優先：${top.axis}）。${rep.noTaskReason}`, title: '競合との差分' };
    return { done: `競合との差分を${rep.gaps.length}軸で優先順位づけ（最優先：${top.axis}）。既存の完成品の販促タスクを${rep.tasks.length}件にした（効果は未検証）`, title: '競合との差分', handoff: rep.tasks[0].owner, what: rep.tasks[0].what };
  } };
}
export async function competitorState(kv) {
  const [obs, report, fail] = await Promise.all([kv.getJson(COMP_KEYS.obs), kv.getJson(COMP_KEYS.report), kv.getJson(COMP_KEYS.fail)]);
  return { observations: (obs || []).length, report: report || null, failures: fail || [], axes: AXES };
}
