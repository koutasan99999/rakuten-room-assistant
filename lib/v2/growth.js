// サングラスくま株式会社 2.0：集客の施策（2026-11-18 社長の依頼：Instagramの「入口」を増やす）
//   - 施策の一覧（ボード）：できるか（アプリで用意まで／社長の操作が必要／しない）・期待できる効果・根拠・状態・社長がそのまま使える手順と文面
//   - AI社員の準備（仕事探し）：ライター＝完成品ごとの「検索に出るための文言」（キーワード・代替テキスト・ハッシュタグ・ストーリーズの文）
//     ／広報＝プロフィールの名前欄・自己紹介の案／企画＝新しい施策の案（1日1回まで・未着手の案が3件あれば作らない）
//   - 効果の判定（コードだけ・AIは使わない）：社長が登録した実績に「使った施策」を付ける。施策ありの平均閲覧と、それ以外の平均を比べる
//     ／効果あり＝2投稿以上で1.3倍以上／見直し＝3投稿以上で平均以下。見直しになった施策は、企画が代わりの案を出す
//   Instagramへの投稿・コメント・いいね・フォローはしない。施策の実行は社長が手で行う（アプリは文面と手順の用意まで）
import { runWithModels, NG_RE } from '../ai.js';
import { MEDICAL_RE } from '../agents.js';
import { reelFileOk } from './kpi.js';
import { withRole } from './policy.js';

const K = { growth: 'v2:growth', perf: 'v2:perf', sets: 'v2:sets', set: (id) => `v2:set:${id}` };
export { K as GROWTH_KEYS };
export const STATUS = { proposed: '提案', preparing: '準備中', ready: '実行できる', doing: '実行中', measured: '効果あり', review: '見直し', dropped: 'やめた' };
export const HOW = { app: 'アプリが用意まで', owner: '社長の操作が必要', no: 'しない（規約・公式APIの制限）' };
export const EFFECT_X = 1.3; // 効果ありの目安（基準の何倍か）
const now = () => new Date().toISOString();
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const RISK = /私|僕|使ってみ|愛用|買ってよかった|最強|最高|絶対|必ず|No\.?\s*1|一番売れ|ランキング|人気|バズ|神|激安|最安|同等|匹敵|治る|効く|改善/;
const safe = (t) => !!t && !RISK.test(t) && !NG_RE.test(t) && !MEDICAL_RE.test(t);
// 規約違反・量産・費用のかかる施策は、AIの案でも入れない
const BAN_RE = /自動|ボット|bot|ツール|フォロワー(を)?(購入|買)|相互フォロー|フォロバ|いいね(回り|周り)|一斉|大量|スパム|DM|懸賞|プレゼント企画|キャンペーン|giveaway|広告|有料|課金|プロモーション(を)?(出|配信)/i;

// ---- 最初の施策（根拠のあるもの）。根拠の種類：official＝Instagram・楽天の公式の説明／know＝一般的な運用の知見（効果の数字は未確認）
//   scope：post＝投稿ごとに付けて比べる／account＝始めた日の前後で比べる
export const SEEDS = [
  { id: 'reels', name: 'リールを3つの型で続けて出す（用途当て・高い物と安い物・3選）', channel: 'リール', how: 'app', scope: 'post', effect: '高', basis: 'official', why: 'リールはフォロワー以外のおすすめ（発見）に載る形式だとInstagramが説明している。完成品からアプリが動画を作れる',
    steps: ['完成品の画面の「リール」で型を選んで動画を作る', '「動画を保存」で端末に保存し、Instagramでリールとして投稿する', 'キャプションは「リール用キャプションをコピー」を貼る', '投稿したら、成果タブで実績を登録するとき「使った施策」にこの施策を付ける'] },
  { id: 'trial', name: 'お試しリール（フォロワー以外に先に見せる機能）', channel: 'リール', how: 'owner', scope: 'post', effect: '中', basis: 'official', why: 'Instagramの公式機能で、まずフォロワー以外に見せて反応を確かめられる（2024年12月の発表）。このアカウントで使えるかは未確認',
    steps: ['リールを投稿する画面で「お試しリール」をオンにする（表示が無ければ、このアカウントではまだ使えない）', '数日後にインサイトを見て、閲覧が多ければそのまま公開、少なければ冒頭を変えて作り直す', '実績を登録するとき「使った施策」にこの施策を付ける'] },
  { id: 'seo', name: 'キャプションに検索される言葉・代替テキストを入れる', channel: '検索', how: 'app', scope: 'post', effect: '中', basis: 'official', why: 'Instagramの検索は、キャプションの言葉や名前欄を手がかりにするとInstagramが説明している。ライターが完成品ごとに文言を用意する',
    steps: ['完成品の画面の「検索に出るための文言」を開く', 'キーワードの入った1文をキャプションの2行目に貼る', '投稿の「詳細設定」→「代替テキストを書く」に代替テキストを貼る', '実績を登録するとき「使った施策」にこの施策を付ける'] },
  { id: 'hashtags', name: 'ハッシュタグは内容に合う3〜5個にしぼる', channel: '検索', how: 'app', scope: 'post', effect: '低', basis: 'official', why: 'Instagramは、内容に合う少数のハッシュタグを勧めている。多く付けても届く数は増えにくいと説明している',
    steps: ['完成品の画面の「検索に出るための文言」のハッシュタグ（3〜5個）を使う', '関係の薄いハッシュタグ・流行のハッシュタグは付けない'] },
  { id: 'story', name: 'ストーリーズのリンクスタンプで楽天ROOMへ', channel: 'ストーリーズ', how: 'app', scope: 'post', effect: '中', basis: 'official', why: 'リンクスタンプはInstagramの公式機能で、だれでも使える。投稿を見た人を楽天ROOMへ案内できる（フォロワー向けの入口）',
    steps: ['完成品の表紙画像をストーリーズに載せる', '「スタンプ」→「リンク」で楽天ROOMの自分のページのURLを入れる', 'ストーリーズの文は「検索に出るための文言」のストーリーズの文を使う（PRの表記を残す）', '実績を登録するとき、形式を「ストーリーズ」にして「使った施策」にこの施策を付ける'] },
  { id: 'profile', name: 'プロフィールの名前欄と自己紹介を、検索される言葉にする', channel: 'プロフィール', how: 'app', scope: 'account', effect: '中', basis: 'official', why: 'Instagramの検索は、ユーザーネームと名前欄の言葉で見つかるとInstagramが説明している。広報が名前欄と自己紹介の案を用意する',
    steps: ['下の案から名前欄・自己紹介を1つ選んでコピーする', 'Instagramの「プロフィールを編集」で名前・自己紹介に貼る（ユーザーネーム @gla_san_kuma_ は変えない）', '貼ったら「やった」を押す（その日から前後の閲覧を比べます）'] },
  { id: 'pin', name: 'いちばん見られた投稿をプロフィールに固定する', channel: 'プロフィール', how: 'owner', scope: 'account', effect: '低', basis: 'official', why: '投稿の固定（3件まで）はInstagramの公式機能。プロフィールを見に来た人に、反応の良かった投稿を最初に見せられる',
    steps: ['成果タブの「よく見られた投稿」でいちばん上の投稿を確かめる', 'その投稿の「…」→「プロフィールに固定」を押す', '押したら「やった」を押す'] },
  { id: 'google', name: '投稿を検索エンジン（Google など）に出す設定', channel: '検索', how: 'owner', scope: 'account', effect: '低', basis: 'official', why: 'プロ（ビジネス・クリエイター）アカウントの公開の投稿は、検索エンジンの結果に出せるとInstagramが発表している（2025年）。設定の名前と場所は端末で違う場合があり未確認',
    steps: ['Instagramの「設定とアクティビティ」で「検索エンジン」と検索する', '検索エンジンの結果に表示する設定がオンか確かめる（無ければ使えないので「やめる」を押す）', '確かめたら「やった」を押す'] },
  { id: 'threads', name: 'Threads・Facebook にも同時にシェアする', channel: 'ほかのSNS', how: 'owner', scope: 'account', effect: '低', basis: 'official', why: '投稿の画面からThreads・Facebookへのシェアを選べる（Instagramの公式機能）。追加の費用なしで別の場所の人にも見てもらえる。届く数は未確認',
    steps: ['投稿の最後の画面で「Facebookでシェア」や「Threadsでシェア」の項目があればオンにする', '項目が無ければ「やめる」を押す', 'オンにしたら「やった」を押す'] },
  { id: 'engage', name: '関連アカウントの投稿に、内容を読んだコメントを送る', channel: '交流', how: 'app', scope: 'account', effect: '低', basis: 'know', why: '自分から関わると、相手やその読者にプロフィールを見てもらえる機会になる（一般的な運用の知見・数字の効果は未確認）。広報が案を作り、監査が採点し、送るのは社長',
    steps: ['広報タブの「社長の承認待ち」のコメント案を読む', '良ければ承認し、Instagramで社長が手で送る', '送ったら「送った」を押す（アプリは送らない）'] },
  { id: 'collab', name: '同じジャンルの小さなアカウントに、コラボ投稿をお願いする', channel: '交流', how: 'owner', scope: 'account', effect: '中', basis: 'official', why: 'コラボ投稿（共同投稿）はInstagramの公式機能で、両方のフォロワーに表示される。相手が引き受けるかは分からない',
    steps: ['広報タブの関連アカウントや、ハッシュタグのページで、同じくらいの規模のアカウントを1つ選ぶ', '下の文面をコピーし、相手の投稿の「…」から連絡するか、メッセージで社長が手で送る（1週間に1件まで）', '引き受けてもらえたら、投稿の「タグ付け」→「コラボレーターを招待」で相手を招待する'] },
  { id: 'room', name: '楽天ROOMの中で、似た商品を紹介している人をフォローする', channel: '楽天ROOM', how: 'owner', scope: 'account', effect: '低', basis: 'know', why: '楽天ROOMの中でも、フォローやいいねで自分のROOMを見てもらえる（一般的な運用の知見・数字の効果は未確認）。ROOMは機械的な操作を禁止しているので、社長が手で行う',
    steps: ['楽天ROOMで、完成品と同じジャンルの商品を紹介している人を1日数人だけ見る', '本当に参考になった人だけフォローする（大量のフォロー・いいねはしない）', '始めたら「やった」を押す'] },
  { id: 'no-auto', name: '自動のいいね・フォロー・コメント、フォロワーの購入', channel: 'しないこと', how: 'no', scope: 'account', effect: '-', basis: 'official', why: 'Instagramの利用規約で、自動化した操作・偽のやり取りは禁止されている。アカウントの制限につながるため、しない', steps: [] }
];
const BASIS = { official: '根拠：Instagram・楽天の公式の説明（効果の数字は未確認）', know: '根拠：一般的な運用の知見（効果の数字は未確認）', ai: '根拠：AIの知識（未確認）' };
export const COLLAB_TEXT = 'はじめまして。Instagramで楽天市場の便利な商品を紹介している「サングラスくま」（@gla_san_kuma_）です。\n○○さんの投稿を拝見し、紹介の切り口がとても分かりやすいと感じました。\nもしよろしければ、同じテーマで「コラボ投稿」をご一緒できないでしょうか。投稿の内容・時期は○○さんのご都合に合わせます。\nご興味がなければ、このメッセージは読み流してください。失礼いたしました。';

async function readStore(kv) { return (await kv.getJson(K.growth)) || { tactics: {}, ideas: [] }; }
async function saveStore(kv, g) { await kv.setJson(K.growth, g); }
const vOf = (r) => (r.views != null ? r.views : r.reach);
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

// 効果の判定（コードだけ）
export function evaluate(t, perf, doneAt) {
  const rows = (perf || []).filter((r) => vOf(r) != null);
  let mine; let others;
  if (t.scope === 'post') { mine = rows.filter((r) => (r.tactics || []).includes(t.id)); others = rows.filter((r) => !(r.tactics || []).includes(t.id)); }
  else if (doneAt) { const d = String(doneAt).slice(0, 10); const dateOf = (r) => r.postedAt || String(r.at || '').slice(0, 10); mine = rows.filter((r) => dateOf(r) >= d); others = rows.filter((r) => dateOf(r) < d); }
  else return { posts: 0, avg: null, base: null, result: '' };
  const a = avg(mine.map(vOf)); const b = avg(others.map(vOf));
  let result = mine.length ? 'measuring' : '';
  if (b != null && b > 0 && mine.length >= 2 && a >= b * EFFECT_X) result = 'effective';
  else if (b != null && mine.length >= 3 && a <= b) result = 'review';
  const prof = avg(mine.filter((r) => r.profileVisits != null).map((r) => r.profileVisits));
  const room = mine.reduce((x, r) => x + (r.roomClicks || 0), 0);
  return { posts: mine.length, avg: a, base: b, basePosts: others.length, profile: prof, room, result };
}
function statusOf(def, st, ev, ready) {
  if (def.how === 'no') return 'dropped';
  if (st.status === 'dropped') return 'dropped';
  if (ev.result === 'effective') return 'measured';
  if (ev.result === 'review') return 'review';
  if (st.status === 'doing' || ev.posts > 0) return 'doing';
  if (def.source === 'ai' && !st.status) return 'proposed';
  return ready ? 'ready' : 'preparing';
}

// 準備の状況（実際の保存内容だけで決める）
async function prepInfo(kv, g) {
  const list = ((await kv.getJson(K.sets)) || []).filter((x) => ['waiting', 'adopted', 'posted'].includes(x.status)).slice(0, 15);
  let seo = 0; let reels = 0;
  for (const x of list) { const s = await kv.getJson(K.set(x.id)); if (s && s.seo) seo += 1; if (s && s.hooks) reels += 1; }
  const reelFiles = ((await kv.getJson('v2:reels')) || []).filter(reelFileOk).length;
  return { sets: list.length, seo, reels, reelFiles, profile: !!(g.profile && g.profile.bios && g.profile.bios.length) };
}
function packFor(def, g, prep, perf) {
  const texts = [];
  let ready = true; let note = '';
  if (def.id === 'profile') { ready = prep.profile; if (g.profile) { texts.push({ label: '名前欄', text: g.profile.name }); g.profile.bios.forEach((b, i) => texts.push({ label: `自己紹介の案${i + 1}`, text: b })); if (g.profile.highlights && g.profile.highlights.length) texts.push({ label: 'ハイライトの名前', text: g.profile.highlights.join('／') }); } else note = '広報が名前欄と自己紹介の案を作ります（次の定期実行）'; }
  if (['seo', 'hashtags', 'story'].includes(def.id)) { ready = prep.seo > 0; note = prep.seo ? `完成品${prep.sets}件のうち${prep.seo}件に用意済み（完成品の画面で使えます）` : 'ライターが完成品ごとに文言を作ります（次の定期実行）'; }
  if (def.id === 'reels') { note = `動画の実ファイルを作れたリール${prep.reelFiles}本（完成品${prep.sets}件のうち冒頭の一言は${prep.reels}件に用意済み）。動画を作っていないものは完成に数えない`; ready = prep.reelFiles > 0; }
  if (def.id === 'pin') { const best = [...(perf || [])].filter((r) => vOf(r) != null).sort((a, b) => vOf(b) - vOf(a))[0]; ready = !!best; note = best ? `いちばん見られた投稿：${best.title || best.theme || '題名なし'}（閲覧${vOf(best)}）` : '実績が登録されると、固定する投稿が決まります'; }
  if (def.id === 'collab') texts.push({ label: 'コラボのお願いの文面（○○を相手の名前に）', text: COLLAB_TEXT });
  return { texts, ready, note };
}

// 画面に渡す一覧
export async function growthState(kv) {
  const [g, perf0] = await Promise.all([readStore(kv), kv.getJson(K.perf)]);
  const perf = perf0 || [];
  const prep = await prepInfo(kv, g);
  const defs = [...SEEDS.map((d) => ({ ...d, source: 'seed' })), ...(g.ideas || []).map((d) => ({ ...d, source: 'ai' }))];
  const tactics = defs.map((d) => {
    const st = (g.tactics || {})[d.id] || {};
    const ev = d.how === 'no' ? { posts: 0, result: '' } : evaluate(d, perf, st.doneAt);
    const pk = packFor(d, g, prep, perf);
    const status = statusOf(d, st, ev, pk.ready);
    return { id: d.id, name: d.name, channel: d.channel, how: d.how, howLabel: HOW[d.how], scope: d.scope, effect: d.effect, why: d.why, basis: BASIS[d.source === 'ai' ? 'ai' : d.basis], steps: d.steps || [], texts: pk.texts, note: pk.note, source: d.source, status, statusLabel: STATUS[status], doneAt: st.doneAt || '', droppedWhy: st.why || '', eval: ev, replaces: d.replaces || '', createdAt: d.createdAt || '' };
  });
  const count = (s) => tactics.filter((t) => t.status === s).length;
  return { tactics, counts: { ready: count('ready'), doing: count('doing'), measured: count('measured'), review: count('review'), proposed: count('proposed'), preparing: count('preparing') }, ideasAt: g.ideasAt || '', prep, effectX: EFFECT_X };
}
// 実績に付けられる施策（投稿ごとに比べるもの・やめていないもの）
export async function postTactics(kv) {
  const s = await growthState(kv);
  return s.tactics.filter((t) => t.scope === 'post' && t.status !== 'dropped').map((t) => ({ id: t.id, name: t.name }));
}

// 社長の操作：やった（実行中）／やめる／戻す。Instagramへは何もしない
export async function decideTactic(kv, { id, decision, why }) {
  const g = await readStore(kv);
  const def = [...SEEDS, ...(g.ideas || [])].find((d) => d.id === id);
  if (!def || def.how === 'no') throw new Error('その施策はありません');
  const st = { ...((g.tactics || {})[id] || {}) };
  if (decision === 'doing') { st.status = 'doing'; st.doneAt = st.doneAt || now(); }
  else if (decision === 'drop') { st.status = 'dropped'; st.why = str(why, 80) || '社長がやめた'; st.droppedAt = now(); }
  else if (decision === 'reopen') { delete st.status; delete st.why; delete st.droppedAt; }
  else throw new Error('この操作はありません');
  g.tactics = { ...(g.tactics || {}), [id]: st };
  await saveStore(kv, g);
  return { id, name: def.name, status: st.status || 'ready' };
}
// 実績の登録・削除のあとに、判定が変わった施策を返す（記録に残すため）
export async function evalChanges(kv) {
  const g = await readStore(kv);
  const s = await growthState(kv);
  const seen = g.evalSeen || {};
  const changed = [];
  for (const t of s.tactics) { const r = t.eval.result; if ((r === 'effective' || r === 'review') && seen[t.id] !== r) changed.push(t); }
  g.evalSeen = Object.fromEntries(s.tactics.map((t) => [t.id, t.eval.result || '']));
  if (changed.some((t) => t.eval.result === 'review')) delete g.ideasAt; // 見直しが出たら、企画は1日を待たずに代わりの施策を考える
  await saveStore(kv, g);
  return changed.map((t) => ({ id: t.id, name: t.name, result: t.eval.result, avg: t.eval.avg, base: t.eval.base, posts: t.eval.posts }));
}

// ---- ライター：完成品ごとの「検索に出るための文言」 ----
const SEO_PROMPT = `あなたは「サングラスくま株式会社」のライターです（集客の担当）。Instagramの検索で見つけてもらうための文言を作ります。JSONだけを返してください。
- keywords：この投稿を探す人が検索に入れそうな言葉を3〜6個（「〇〇 収納」「〇〇 便利」のような普通の言葉。商品データに無い性能・ブランドは書かない）
- line：keywordsのうち2〜3個を自然に入れた、キャプションの2行目に入れる1文（50字以内）
- alt：代替テキスト（画像に写っている物と用途を説明する文・100字以内）
- hashtags：内容に合うハッシュタグを3〜5個（#から始める。#PR・#楽天ROOM・#サングラスくま は別に付けるので入れない）
- story：ストーリーズに載せる短い文（30字以内・問いかけでもよい）
- 書かない：体験談（使ってみた・愛用）、人気・ランキング・最強・最安・絶対、商品データに無い数字や性能、医療の効果
出力形式: {"keywords":["..."],"line":"...","alt":"...","hashtags":["#..."],"story":"..."}`;
export function seoOk(x, set) {
  const data = JSON.stringify((set.products || []).map((p) => [p.name, p.price])) + (set.title || '');
  const numsOk = (t) => (String(t).match(/\d[\d,]*/g) || []).every((d) => data.includes(d.replace(/,/g, '')) || data.includes(d));
  const keywords = (Array.isArray(x.keywords) ? x.keywords : []).map((k) => str(k, 20)).filter((k) => k && safe(k)).slice(0, 6);
  const hashtags = (Array.isArray(x.hashtags) ? x.hashtags : []).map((h) => '#' + str(h, 24).replace(/^#+/, '').replace(/\s/g, '')).filter((h) => h.length > 1 && safe(h) && !/PR|楽天ROOM|サングラスくま/.test(h)).filter((h, i, a) => a.indexOf(h) === i).slice(0, 5);
  const line = str(x.line, 60); const alt = str(x.alt, 110); const story = str(x.story, 34);
  const ng = [];
  if (keywords.length < 3) ng.push('キーワードが3個未満');
  if (!line || line.length > 50 || !safe(line) || !numsOk(line)) ng.push('2行目の1文');
  if (!alt || alt.length > 100 || !safe(alt) || !numsOk(alt)) ng.push('代替テキスト');
  if (hashtags.length < 3) ng.push('ハッシュタグが3個未満');
  if (!story || story.length > 30 || !safe(story) || !numsOk(story)) ng.push('ストーリーズの文');
  return { ok: !ng.length, ng, seo: { keywords, line, alt, hashtags, story: `${story}\n（PR・楽天ROOMで紹介中）` } };
}
export async function seoWork(kv) {
  const list = ((await kv.getJson(K.sets)) || []).filter((x) => ['waiting', 'adopted', 'posted'].includes(x.status)).slice(0, 8);
  for (const x of list) {
    const s = await kv.getJson(K.set(x.id));
    if (!s || s.seo || (s.seoTries || 0) >= 2) continue;
    return { kind: 'seo', task: `完成品「${s.title}」の検索に出るための文言（キーワード・代替テキスト・ハッシュタグ・ストーリーズの文）を作る（集客）`, doing: '検索に出るための文言を作っています', est: 1, run: (ctx) => seoRun(kv, ctx, s.id) };
  }
  return null;
}
async function seoRun(kv, ctx, id) {
  const s = await kv.getJson(K.set(id));
  if (!s) return { fail: '完成品が見つからない' };
  const lines = (s.products || []).map((p, i) => `${i + 1}. ${p.role || ''}：${String(p.name || '').slice(0, 50)}（${p.price}円）`).join('\n');
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: Date.now() + 30000, system: withRole('writer', SEO_PROMPT), userContent: `企画: ${s.title}／誰に: ${s.who || s.target || ''}／悩み: ${s.problem || ''}\n${lines}`, parse: (c) => JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]) });
    const v = seoOk(result || {}, s);
    if (!v.ok) { await kv.setJson(K.set(id), { ...s, seoTries: (s.seoTries || 0) + 1 }); return { fail: `決まりに合わない項目があった（${v.ng.join('・')}）` }; }
    await kv.setJson(K.set(id), { ...s, seo: { ...v.seo, at: now() } });
    return { done: `「${s.title}」の検索に出るための文言を作った（キーワード：${v.seo.keywords.slice(0, 3).join('・')}）`, title: s.title };
  } catch (e) { return { fail: String(e.message || e).slice(0, 120) }; }
}

// ---- 広報：プロフィールの名前欄・自己紹介の案 ----
const PROFILE_PROMPT = `あなたは「サングラスくま株式会社」の広報です。Instagramのプロフィール（名前欄・自己紹介）の案を作ります。JSONだけを返してください。
- アカウント：サングラスくま（ユーザーネーム @gla_san_kuma_）。楽天市場の「こんな商品あったんだ」と思える便利な商品を、くまのキャラクターが紹介する。紹介は楽天ROOM（アフィリエイト・PRを含む）
- name：名前欄（30字以内）。「サングラスくま」を必ず入れ、検索されそうな言葉（例：便利グッズ・楽天）を1〜2個足す
- bios：自己紹介の案を3つ（各120字以内・改行は\\nで2〜4行）。何を紹介するアカウントか・だれ向けかが分かること。最後に楽天ROOMへの案内を入れる
- highlights：ストーリーズのハイライトの名前を3〜5個（各8字以内）
- 書かない：体験談（使ってみた・愛用）、人気・ランキング・最強・最安・絶対、フォロワー数や実績の数字、医療の効果、眼科医であること
出力形式: {"name":"...","bios":["...","...","..."],"highlights":["..."]}`;
export function profileOk(x) {
  const name = str(x.name, 40);
  const bios = (Array.isArray(x.bios) ? x.bios : []).map((b) => String(b || '').replace(/\\n/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, ' ').trim().slice(0, 130)).filter((b) => b && b.length <= 120 && safe(b) && !/\d{2,}/.test(b) && !/眼科医/.test(b)).map((b) => (/PR/.test(b) ? b : `${b}\n※PRを含みます`)).slice(0, 3);
  const highlights = (Array.isArray(x.highlights) ? x.highlights : []).map((h) => str(h, 10)).filter((h) => h && h.length <= 8 && safe(h)).slice(0, 5);
  const ng = [];
  if (!name || name.length > 30 || !name.includes('サングラスくま') || !safe(name) || /眼科医/.test(name)) ng.push('名前欄');
  if (bios.length < 2) ng.push('自己紹介の案が2つ未満');
  return { ok: !ng.length, ng, profile: { name, bios, highlights } };
}
export async function profileWork(kv) {
  const g = await readStore(kv);
  if ((g.profile && g.profile.bios) || (g.profileTries || 0) >= 2 || ((g.tactics || {}).profile || {}).status === 'dropped') return null;
  return { kind: 'profile', task: 'Instagramのプロフィールの名前欄と自己紹介の案を作る（検索に出る入口・集客）', doing: 'プロフィールの案を作っています', est: 1, run: (ctx) => profileRun(kv, ctx) };
}
async function profileRun(kv, ctx) {
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: Date.now() + 30000, system: withRole('pr', PROFILE_PROMPT), userContent: 'プロフィールの案を作ってください', parse: (c) => JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]) });
    const v = profileOk(result || {});
    const g = await readStore(kv);
    if (!v.ok) { g.profileTries = (g.profileTries || 0) + 1; await saveStore(kv, g); return { fail: `決まりに合わない項目があった（${v.ng.join('・')}）` }; }
    g.profile = { ...v.profile, at: now() };
    await saveStore(kv, g);
    return { done: `プロフィールの案を作った（名前欄「${v.profile.name}」・自己紹介${v.profile.bios.length}案）` };
  } catch (e) { return { fail: String(e.message || e).slice(0, 120) }; }
}

// ---- 企画：新しい施策の案（1日1回まで） ----
const IDEA_PROMPT = `あなたは「サングラスくま株式会社」の企画です。Instagram（@gla_san_kuma_・楽天市場の便利な商品をくまが紹介・楽天ROOMへ案内）の閲覧・フォロワー以外への到達・プロフィールへのアクセス・楽天ROOMへの流入を増やす、新しい施策を考えます。JSONだけを返してください。
- 今ある施策と同じもの・言い換えは出さない。「見直し」になった施策があれば、その代わりになる別の切り口を優先する
- 社長が1人で、費用0円で、Instagramの公式の機能だけでできること。1回の作業が15分以内
- してはいけないこと：自動のいいね・フォロー・コメント・DM、フォロワーの購入、相互フォローの募集、プレゼント企画、広告（有料）、大量の投稿、楽天ROOMへの自動の投稿、体験したような表現、医療の効果
- 根拠はあなたの知識で、確かではないと分かるように書く
- ideas は0〜3件（入れるのは2件まで）。良い案が無ければ空にする（数を増やすために作らない）
出力形式: {"ideas":[{"name":"施策の名前（40字以内）","channel":"リール/検索/ストーリーズ/プロフィール/交流/楽天ROOM/ほかのSNS","scope":"post か account","why":"なぜ閲覧が増えると考えるか（80字以内）","steps":["社長の手順（3つまで）"],"replaces":"代わりにする見直しの施策の名前（無ければ空）"}]}`;
const bigrams = (s) => { const t = String(s).replace(/[\s、。・（）()「」]/g, ''); const a = new Set(); for (let i = 0; i < t.length - 1; i += 1) a.add(t.slice(i, i + 2)); return a; };
export function similar(a, b) { const x = bigrams(a); const y = bigrams(b); if (!x.size || !y.size) return false; let n = 0; for (const v of x) if (y.has(v)) n += 1; return n / Math.min(x.size, y.size) >= 0.5; }
export function ideaOk(x, existing) {
  const name = str(x.name, 40); const why = str(x.why, 90);
  const steps = (Array.isArray(x.steps) ? x.steps : []).map((s) => str(s, 80)).filter(Boolean).slice(0, 3);
  const all = [name, why, ...steps].join(' ');
  if (!name || !why || !steps.length) return { ok: false, why: '名前・理由・手順が足りない' };
  if (BAN_RE.test(all)) return { ok: false, why: '規約違反・費用のかかる施策' };
  if (!safe(name) || NG_RE.test(all) || MEDICAL_RE.test(all)) return { ok: false, why: '使えない表現' };
  if (existing.some((e) => similar(e, name))) return { ok: false, why: '今ある施策と同じ' };
  return { ok: true, idea: { name, why, steps, channel: str(x.channel, 12) || 'ほか', scope: x.scope === 'post' ? 'post' : 'account', how: 'owner', effect: '未確認', replaces: str(x.replaces, 40) } };
}
export const IDEA_EVERY_HOURS = 20;
export const IDEA_OPEN_MAX = 3;
export async function ideaWork(kv) {
  const g = await readStore(kv);
  const open = (g.ideas || []).filter((d) => !((g.tactics || {})[d.id] || {}).status).length;
  if (open >= IDEA_OPEN_MAX) return { none: `社長がまだ見ていない施策の案が${open}件ある（案を増やすだけの仕事はしない）` };
  if (g.ideasAt && Date.now() - Date.parse(g.ideasAt) < IDEA_EVERY_HOURS * 3600000) return { none: '新しい施策の案は1日1回（今日は考えた）。新しい案件は、進行中の案件に空きができたら始める' };
  return { kind: 'growth-idea', task: '集客の新しい施策を考える（今の施策・実績・見直しの施策を見て）', doing: '集客の新しい施策を考えています', est: 1, run: (ctx) => ideaRun(kv, ctx) };
}
async function ideaRun(kv, ctx) {
  const st = await growthState(kv);
  const lines = st.tactics.map((t) => `- ${t.name}（${t.statusLabel}${t.eval.posts ? `・${t.eval.posts}投稿・平均閲覧${t.eval.avg}／基準${t.eval.base ?? '未集計'}` : ''}）`).join('\n');
  const g0 = await readStore(kv);
  g0.ideasAt = now(); await saveStore(kv, g0); // 失敗しても同じ日に何度も呼ばない
  try {
    const { result } = await runWithModels({ env: ctx.env, deadline: Date.now() + 30000, system: withRole('planner', IDEA_PROMPT), userContent: `今ある施策：\n${lines}\n準備の状況：完成品${st.prep.sets}件（検索の文言${st.prep.seo}件）`, parse: (c) => JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]) });
    const g = await readStore(kv);
    const names = st.tactics.map((t) => t.name);
    const added = []; const ng = [];
    for (const x of (result && Array.isArray(result.ideas) ? result.ideas : []).slice(0, 4)) {
      if (added.length >= 2) break;
      const v = ideaOk(x, [...names, ...added.map((a) => a.name)]);
      if (!v.ok) { ng.push(`${str(x && x.name, 20)}（${v.why}）`); continue; }
      added.push({ id: `idea${Date.now().toString(36)}${added.length}`, ...v.idea, createdAt: now() });
    }
    g.ideas = [...(g.ideas || []), ...added].slice(-30);
    await saveStore(kv, g);
    if (!added.length) return { done: `集客の施策を考えたが、新しく入れる案は無かった${ng.length ? `（${ng.join('・').slice(0, 80)}）` : ''}` };
    return { done: `集客の新しい施策の案を${added.length}件出した（${added.map((a) => a.name).join('／').slice(0, 80)}）。社長が見て、やるか決める` };
  } catch (e) { return { fail: String(e.message || e).slice(0, 120) }; }
}
