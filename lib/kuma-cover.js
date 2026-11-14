// サングラスくまの表紙画像（2026-11-14）：投稿セットの主役の商品を、サングラスくまが日常の場面で使っている3D調の画像を作る。
// 流れ（制作ラインで監査AIが合格にしたあと・1段階＝1回の定期実行）：
//   scene   : 表紙画像担当AI（文章のAI 1回）… 日常の場面の案を3つ出させ、コードが選ぶ（商品データにある使い方・医療の場面なし・最近の20件と重ならない）
//   image   : 画像生成（OpenAI images/edits・1枚）… マスター画像（指紋で確認）と商品写真を参考に。文字・ロゴは描かせない
//   imgcheck: 品質確認（画像を読めるAI 1回＋コード）… 固定要素・商品の一致・文字やロゴが無いか。不合格なら作り直しは1回まで
// 費用：画像は lib/budget.js の画像専用の上限（月200円・1日2枚）を呼ぶ前に確かめる。全体の月1,000円の中で数える
// マスター画像が使えない・予算が足りない・2回とも不合格なら、画像なしで投稿セットを渡す（理由を記録。別のくまで代用しない）
import crypto from 'node:crypto';
import { AiError, runWithModels } from './ai.js';
import { parseJson, tagRuns, failure } from './agents.js';
import { grounded } from './production.js';
import { usableMasters, verifyFile, FIXED_TRAITS } from './kuma-master.js';
import { imageCheck, imageRecord, IMAGE_ESTIMATE_YEN } from './budget.js';
import { YEN_PER_USD } from './ai-usage.js';
import { largeImageUrl, ALLOWED_HOST } from '../server/image.js';

export const IMAGE_MODEL = 'gpt-image-2';
export const IMAGE_SIZE = '1024x1536';
export const IMAGE_QUALITY = 'medium';
export const MAX_IMAGE_TRIES = 2;       // 1回作り直すまで
export const SCENE_HISTORY = 20;
export const MAX_MEDIA_BYTES = 900 * 1024; // 保存場所の1件の大きさの目安（base64の文字数）
// 画像の料金（100万トークンあたりの米ドル。第三者の資料・OpenAIの公式ページは未確認＝要確認。2026-11-14）
export const IMAGE_PRICE = { imageIn: 8, textIn: 5, out: 30 };
const K = { scenes: 'kuma:scenes', media: (id) => `media:${id}` };
const MEDICAL = /目薬|点眼|診察|治療|手術|注射|薬|病院|クリニック|視力|眼科|検査|症状|処方/;
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (t) => String(t || '').normalize('NFKC').replace(/[\s　、。・]/g, '').toLowerCase();

// 主役の商品（本命の役割・写真のあるもの）
export function heroItem(set) {
  const items = (set.items || []).filter((it) => it.image);
  return items.find((it) => /本命|主役/.test(it.role || '')) || items[0] || null;
}
export const sceneKey = (s) => `${norm(s.place)}|${norm(s.action)}|${norm(s.outfit)}`;

// ---- 場面の企画（表紙画像担当AI） ----
const SCENE_PROMPT = `あなたは「眼科医くま」の表紙画像担当AIです。Instagramの表紙画像の、日常の場面の案を3つ考えます。JSONだけを返してください。
主人公は「サングラスくま」（キャメル色のふわふわしたくま・大きな黒いサングラス・丸い顔・小さな鼻・短い手足・3Dぬいぐるみ風）。
- 主役の商品を、くまが実際に使っている場面にする。使い方（usage）は、渡された商品データ（商品名・説明）に書いてある用途だけ。usageQuote に、その用途が書いてある商品データの言葉をそのまま写す
- 商品データから使い方が分からないときは、usage を「手に持って眺めている」にし、usageQuote は空にする（推測で使い方を作らない）
- 場所（place）・時間帯（time）・動作（action）・衣装（outfit）を決める。衣装は場面と商品の用途に合わせる（ロゴの無い無地の服。白衣と紺スクラブは仕事・医療の場面のときだけ）
- 背景は生活感のある自然な場所。医療・診察・目薬・病院・視力の場面は使わない。誇張（光る・魔法）はしない
- 渡された「最近の場面」と、場所・動作・衣装がすべて同じにならないようにする
出力形式: {"scenes":[{"place":"","time":"","action":"","outfit":"","usage":"","usageQuote":"","mood":""}]}`;

export function pickScene(scenes, item, history = []) {
  const used = new Set((history || []).map(sceneKey));
  const notes = [];
  for (const raw of scenes || []) {
    const s = { place: str(raw.place, 40), time: str(raw.time, 20), action: str(raw.action, 60), outfit: str(raw.outfit, 40), usage: str(raw.usage, 60), usageQuote: str(raw.usageQuote, 60), mood: str(raw.mood, 30) };
    if (!s.place || !s.action || !s.outfit) { notes.push('項目が足りない'); continue; }
    if (MEDICAL.test(`${s.place}${s.action}${s.outfit}${s.usage}`)) { notes.push(`医療の場面「${s.place}」`); continue; }
    if (used.has(sceneKey(s))) { notes.push(`最近と同じ場面「${s.place}・${s.action}」`); continue; }
    // 使い方は商品データにある言葉だけ。照合できなければ無難な使い方に置き換える（推測で使い方を作らない）
    if (!s.usageQuote || !grounded(s.usageQuote, item)) { s.usage = '手に持って眺めている'; s.usageQuote = ''; s.usageFallback = true; }
    return { scene: s, notes };
  }
  return { scene: null, notes };
}

export async function sceneStep({ set, history = [], env, startedAt = Date.now() }) {
  const item = heroItem(set);
  if (!item) return { ok: true, skip: '写真のある商品が無いため、表紙画像は作らない', runs: [] };
  try {
    const { result } = await runWithModels({
      env, deadline: startedAt + 40000, system: SCENE_PROMPT,
      userContent: `投稿の企画：${set.title}（${set.target || ''}）\n主役の商品：${item.name}\n商品の説明：${str(item.caption, 300) || '（なし）'}\n最近の場面：${(history || []).slice(0, SCENE_HISTORY).map((s) => `${s.place}・${s.action}・${s.outfit}`).join('／') || '（なし）'}`,
      parse: (c) => { const d = parseJson(c); if (!Array.isArray(d.scenes) || !d.scenes.length) throw new AiError('場面の案がありませんでした'); return d.scenes.slice(0, 3); }
    });
    const runs = tagRuns('illustrator', '表紙画像の場面を決める', SCENE_PROMPT);
    const p = pickScene(result, item, history);
    if (!p.scene) return { ok: true, skip: `使える場面が無かった（${p.notes.join('／')}）`, runs };
    return { ok: true, scene: p.scene, item: { name: item.name, image: item.image, code: item.code }, notes: p.notes, runs };
  } catch (e) { return failure('表紙画像担当AI：場面', e, tagRuns('illustrator', '表紙画像の場面を決める', SCENE_PROMPT)); }
}

// ---- 画像生成への指示（文字・ロゴを描かせない。タイトルはアプリがプログラムで重ねる） ----
export function imagePrompt(scene, item, masterCount) {
  const refs = Array.from({ length: masterCount }, (_, i) => i + 1).join('・');
  return [
    `参考画像${refs}は、このキャラクター「サングラスくま」の正式な見た目（マスター）です。顔つき・頭身・体型・毛の色と質感・サングラスの形を、参考画像とできるだけ同じにしてください。`,
    `キャラクターの固定要素：${FIXED_TRAITS.join('、')}。`,
    `マスター画像の黒いパーカーは撮影用の衣装です。今回の衣装：${scene.outfit}（ロゴ・文字の無い無地の服）。`,
    `参考画像${masterCount + 1}は実在の商品「${String(item.name).slice(0, 60)}」の写真です。商品の形・色・部品の位置を写真のとおりにし、別の形にしないでください。`,
    `場面：${scene.place}、${scene.time || '日中'}。キャラクターが${scene.action}（商品の使い方：${scene.usage}）。背景は生活感のある自然な場所。雰囲気：${scene.mood || '落ち着いた'}。`,
    '仕上がり：ぬいぐるみの毛並みが分かる立体的な3DCG、あたたかく自然な光、背景は少しぼかす。縦長の構図で、画面の上の3分の1は文字を載せるため、空や壁などの落ち着いた余白にする。キャラクターと商品は画面の中央から下に大きく。',
    'してはいけないこと：文字・数字・ロゴ・ブランド名・透かしを描く（服・帽子・小物・商品にも）。平面的なイラストにする。別のデザインのくまにする。キャラクターを2体以上描く。医療・治療を思わせる表現。'
  ].join('\n');
}

// 参考画像を取る：マスターは自分のサイトの静的ファイル（指紋で確認）、商品写真は楽天の画像サーバーだけ
async function fetchBuf(url, ms = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) throw new Error(`画像を読めませんでした（${r.status}）`);
  return { buf: Buffer.from(await r.arrayBuffer()), type };
}
export async function loadMasters(origin, masters) {
  const out = [];
  // 正面・全身を先に（体型をそろえる手がかり）
  for (const m of [...masters].sort((a, b) => (a.kind === 'full' ? -1 : b.kind === 'full' ? 1 : 0))) {
    const x = await fetchBuf(new URL(`/assets/kuma-master/${m.file}`, origin).toString());
    const bad = verifyFile(x.buf, m);
    if (bad) throw new Error(`マスター画像「${m.kindLabel}」の確認で問題：${bad}（画像は作らない）`);
    out.push({ ...x, name: m.file });
  }
  return out;
}
async function loadProduct(url) {
  let u; try { u = new URL(url); } catch { throw new Error('商品写真のURLが正しくない'); }
  if (u.protocol !== 'https:' || !ALLOWED_HOST.test(u.hostname)) throw new Error('楽天の商品写真ではないため使わない');
  const x = await fetchBuf(largeImageUrl(u.toString()));
  if (x.buf.length > 5 * 1024 * 1024) throw new Error('商品写真が大きすぎる');
  return { ...x, name: 'product.jpg' };
}

export function imageCost(usage) {
  const u = usage || {};
  const d = u.input_tokens_details || {};
  const imageIn = Number(d.image_tokens) || 0;
  const textIn = Number(d.text_tokens) || Math.max(0, (Number(u.input_tokens) || 0) - imageIn);
  const out = Number(u.output_tokens) || 0;
  if (!imageIn && !textIn && !out) return { yen: IMAGE_ESTIMATE_YEN, measured: false };
  const usd = (imageIn * IMAGE_PRICE.imageIn + textIn * IMAGE_PRICE.textIn + out * IMAGE_PRICE.out) / 1e6;
  return { yen: Math.round(usd * YEN_PER_USD * 1000) / 1000, measured: true, imageIn, textIn, out };
}

// ---- 画像生成（1枚）。呼ぶ前に予算を確かめ、呼んだら成否にかかわらず記録する ----
export async function imageStep({ kv, env, origin, scene, item, startedAt = Date.now(), quality = IMAGE_QUALITY, fetchImpl = fetch }) {
  const um = await usableMasters(kv);
  if (!um.ok) return { ok: true, skip: um.reason };
  const b = await imageCheck(kv, env);
  if (!b.ok) return { ok: true, skip: b.reason };
  let refs;
  try { refs = [...(await loadMasters(origin, um.masters)), await loadProduct(item.image)]; } catch (e) { return { ok: true, skip: String(e.message || e).slice(0, 200) }; }
  const prompt = imagePrompt(scene, item, refs.length - 1);
  const model = str(env.OPENAI_IMAGE_MODEL, 40) || IMAGE_MODEL;
  const form = new FormData();
  form.append('model', model); form.append('prompt', prompt); form.append('size', IMAGE_SIZE); form.append('quality', quality === 'low' ? 'low' : IMAGE_QUALITY);
  form.append('n', '1'); form.append('output_format', 'jpeg'); form.append('output_compression', '80');
  refs.forEach((x) => form.append('image[]', new Blob([x.buf], { type: x.type }), x.name));
  const left = startedAt + 56000 - Date.now();
  if (left < 20000) return { ok: false, error: '画像を作る時間が足りない（次の定期実行で）' };
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetchImpl('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${String(env.OPENAI_API_KEY || '').trim()}` }, body: form, signal: AbortSignal.timeout(left - 1500) });
    text = await res.text();
  } catch (e) {
    // 時間切れ・通信の切断：OpenAI側で費用がかかった可能性があるので、見込みの額で数える
    await imageRecord(kv, IMAGE_ESTIMATE_YEN);
    return { ok: false, timedOut: e.name === 'TimeoutError', error: e.name === 'TimeoutError' ? '画像の生成が時間内に終わらなかった（見込みの費用で記録）' : `画像生成APIにつながらなかった（${e.name}）`, run: { role: 'illustrator', step: '表紙画像を作る', model, ok: false, imageYen: IMAGE_ESTIMATE_YEN, measured: false, ms: Date.now() - t0 } };
  }
  if (!res.ok) {
    await imageRecord(kv, 0);
    return { ok: false, error: res.status === 429 ? '画像生成の利用上限（OpenAIの残高・上限）' : `画像を作れなかった（${res.status}）`, detail: text.slice(0, 200), run: { role: 'illustrator', step: '表紙画像を作る', model, ok: false, status: res.status, imageYen: 0, ms: Date.now() - t0 } };
  }
  let data; try { data = JSON.parse(text); } catch { data = null; }
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  const cost = imageCost(data && data.usage);
  await imageRecord(kv, cost.yen);
  const run = { role: 'illustrator', roleName: '表紙画像担当AI', step: '表紙画像を作る', model, quality, ok: !!b64, imageYen: cost.yen, measured: cost.measured, ms: Date.now() - t0, at: new Date().toISOString(), refs: refs.length };
  if (!b64) return { ok: false, error: '画像が返ってこなかった', run };
  if (b64.length > MAX_MEDIA_BYTES) return { ok: false, error: `画像が大きすぎて保存できない（${Math.round(b64.length / 1024)}KB）`, run };
  return { ok: true, b64, prompt, model, cost, run };
}

// ---- 品質確認（画像を読めるAI＋コード） ----
const CHECK_PROMPT = `あなたは「眼科医くま」の表紙画像の品質確認の担当です（作った担当とは別）。1枚目が確認する画像、2枚目がキャラクターのマスター画像、3枚目が実際の商品の写真です。はい／いいえで答え、JSONだけを返してください。
質問：
- single：キャラクターは1体だけか
- character：キャメル色のふわふわしたくまで、大きな黒いサングラス・丸い顔・小さな鼻・短い手足か
- sameAsMaster：顔つき・頭身・毛並み・サングラスがマスターと同じキャラクターに見えるか（衣装は違ってよい）
- plush3d：平面のイラストではなく、立体的な3Dのぬいぐるみの質感か
- productVisible：商品がはっきり写っているか
- productMatches：商品の形・色が写真と大きく違わないか
- inUse：キャラクターが商品を使っている・手に持っているか
- noText：文字・数字が描かれていないか
- noLogo：ロゴ・ブランド名・マークが描かれていないか（服・帽子・小物・商品も）
- handsOk：手足・指・体の形が崩れていないか
- noMedical：医療・治療・目薬・診察を思わせないか
- topSpace：画面の上の3分の1に、文字を載せられる落ち着いた余白があるか
- issues：「いいえ」の理由（どこが・何が）
出力形式: {"single":true,"character":true,"sameAsMaster":true,"plush3d":true,"productVisible":true,"productMatches":true,"inUse":true,"noText":true,"noLogo":true,"handsOk":true,"noMedical":true,"topSpace":true,"issues":[]}`;
export const CHECK_KEYS = ['single', 'character', 'sameAsMaster', 'plush3d', 'productVisible', 'productMatches', 'inUse', 'noText', 'noLogo', 'handsOk', 'noMedical', 'topSpace'];
export const CHECK_LABEL = { single: '1体だけ', character: '固定要素', sameAsMaster: 'マスターと同じキャラクター', plush3d: '3Dぬいぐるみの質感', productVisible: '商品が写っている', productMatches: '商品の形・色が写真どおり', inUse: '商品を使っている', noText: '文字なし', noLogo: 'ロゴなし', handsOk: '手足の崩れなし', noMedical: '医療を思わせない', topSpace: '上に文字の余白' };
export function judgeCheck(d) {
  const ng = CHECK_KEYS.filter((k) => d[k] !== true);
  return { pass: !ng.length, ng: ng.map((k) => CHECK_LABEL[k]), issues: (Array.isArray(d.issues) ? d.issues : []).map((x) => str(x, 80)).slice(0, 6) };
}
export async function checkStep({ b64, masterUrl, productUrl, env, startedAt = Date.now() }) {
  try {
    const { result } = await runWithModels({
      env, deadline: startedAt + 40000, system: CHECK_PROMPT,
      userContent: [{ type: 'text', text: '1枚目：確認する画像／2枚目：マスター／3枚目：商品の写真' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } }, { type: 'image_url', image_url: { url: masterUrl, detail: 'low' } }, { type: 'image_url', image_url: { url: productUrl, detail: 'low' } }],
      parse: (c) => { const d = parseJson(c); if (!CHECK_KEYS.some((k) => typeof d[k] === 'boolean')) throw new AiError('確認の結果がありませんでした'); return d; }
    });
    return { ok: true, check: { ...judgeCheck(result), raw: Object.fromEntries(CHECK_KEYS.map((k) => [k, result[k] === true])) }, runs: tagRuns('auditor', '表紙画像の品質確認', CHECK_PROMPT) };
  } catch (e) { return failure('品質確認：表紙画像', e, tagRuns('auditor', '表紙画像の品質確認', CHECK_PROMPT)); }
}

// ---- 保存（画像はサーバーの保存場所に1枚ずつ。推測できない長いIDで /api/media から配る） ----
export async function saveMedia(kv, b64) {
  const id = crypto.randomBytes(16).toString('hex');
  await kv.set(K.media(id), b64);
  return id;
}
export async function getMedia(kv, id) {
  if (!/^[0-9a-f]{32}$/.test(String(id || ''))) return null;
  return kv.get(K.media(id));
}
export async function sceneHistory(kv) { return (await kv.listJson(K.scenes, SCENE_HISTORY).catch(() => [])) || []; }
export async function pushScene(kv, scene) { await kv.pushJson(K.scenes, { place: scene.place, action: scene.action, outfit: scene.outfit, at: new Date().toISOString() }, SCENE_HISTORY); }
