// AI着用イメージ（完成コーデの予想画像）。ユーザーが「完成コーデを生成」を押したときだけ呼ぶ。
// 選んだ実在の商品の写真を参考画像として渡し、色・形・素材感・シルエットをなるべく保った全身の着用イメージを作る。
// ロゴや細かい部分は正確に再現できないことがあるので、画面と画像に「AIによる着用イメージ」と必ず出す（実物の写真として扱わない）。
import { largeImageUrl, ALLOWED_HOST } from '../api/image.js';

// 安い順に試す（使えないモデルなら次へ）。環境変数 OPENAI_IMAGE_MODEL で先頭を変えられる
export const IMAGE_MODELS = ['gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2'];
// 1枚あたりの目安（円。縦長1024×1536、参考画像の入力分を少し足した概算。為替や入力画像の数で前後する）
export const COST_YEN = {
  'gpt-image-1-mini': { low: 2, medium: 4 },
  'gpt-image-1.5': { low: 3, medium: 9 },
  'gpt-image-2': { low: 5, medium: 12 }
};
export const MAX_REFS = 6; // 参考画像の数（多いほど入力の料金が増えるので上限を決める）

export const BACKGROUNDS = {
  studio: '明るい無地のスタジオ（白〜ライトグレーの背景）',
  street: '落ち着いた街並み（日中の自然光）',
  cafe: 'おしゃれなカフェの前',
  park: '緑のある公園',
  indoor: 'シンプルな室内（白い壁と床）'
};
export const POSES = {
  front: '正面を向いて自然に立つ',
  walk: '歩いている途中の自然な動き',
  angle: '体を少し斜めにして立つ',
  lean: '壁に軽くもたれる'
};

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function readTryOnRequest(b) {
  if (!b || typeof b !== 'object') return null;
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 10).map((x) => ({
    name: str(x && x.name, 120), kind: str(x && x.kind, 20), brand: str(x && x.brand, 30), image: str(x && x.image, 400), hero: !!(x && x.hero)
  })).filter((x) => x.name);
  if (!items.length) return null;
  return {
    items,
    gender: ['mens', 'ladies'].includes(b.gender) ? b.gender : '',
    background: BACKGROUNDS[b.background] ? b.background : 'studio',
    pose: POSES[b.pose] ? b.pose : 'front',
    quality: b.quality === 'medium' ? 'medium' : 'low',
    variant: Math.max(1, Math.min(20, Number(b.variant) || 1)),
    style: str(b.style, 20),
    age: str(b.age, 20)
  };
}

export function tryOnPrompt(r) {
  const who = r.gender === 'ladies' ? '女性' : r.gender === 'mens' ? '男性' : '人物';
  const lines = r.items.map((it, i) => `${i + 1}. ${it.kind || 'アイテム'}${it.brand ? `（${it.brand}）` : ''}: ${it.name.slice(0, 60)}${it.hero ? ' ← 主役のアイテム。とくに色と形をそのまま保つ' : ''}`);
  return [
    `ファッション誌のコーディネート写真のような、${who}の全身の着用イメージを1枚作ってください。`,
    `参考画像は、このコーデで実際に使う商品の写真です（順番は下の一覧と同じ）。それぞれの商品の色・形・素材感・シルエットをできるだけそのまま再現し、すべてのアイテムを身につけた（または持った）状態にしてください。`,
    lines.join('\n'),
    r.style && `雰囲気: ${r.style}`,
    r.age && `年齢層: ${r.age}`,
    `背景: ${BACKGROUNDS[r.background]}`,
    `ポーズ: ${POSES[r.pose]}`,
    '構図: 頭から足先まで全身が入る縦長の写真。商品がよく見えるように、自然な光で。',
    '参考画像にない服や小物は足さない。文字・ロゴ・透かしを新しく描き足さない。実在の有名人に似せない。',
    r.variant > 1 ? `バリエーション${r.variant}: 前とは少し違う角度・立ち位置で。` : ''
  ].filter(Boolean).join('\n');
}

// 参考画像を取ってくる（楽天の画像サーバーのものだけ。大きめのサイズで）
async function fetchRef(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !ALLOWED_HOST.test(u.hostname)) return null;
  try {
    const r = await fetch(largeImageUrl(u.toString()), { signal: AbortSignal.timeout(8000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 5 * 1024 * 1024) return null;
    return { buf, type };
  } catch {
    return null;
  }
}

function modelList(env) {
  const first = str(env.OPENAI_IMAGE_MODEL, 40);
  return first ? [first, ...IMAGE_MODELS.filter((m) => m !== first)] : IMAGE_MODELS;
}

// 使えないモデル（存在しない・権限がない）かどうか。ほかのエラーは次のモデルを試さない（料金を重ねない）
function modelUnavailable(status, text) {
  return status === 404 || ((status === 400 || status === 403) && /model|not.*(found|exist|available|access)|does not have access/i.test(text));
}

export async function generateTryOn(r, env, { deadline = Date.now() + 55000 } = {}) {
  if (!env.OPENAI_API_KEY) throw new Error('OpenAIのAPIキーが設定されていません');
  // 主役のアイテムを先頭に、参考画像は最大 MAX_REFS 枚
  const ordered = [...r.items.filter((x) => x.hero), ...r.items.filter((x) => !x.hero)].slice(0, MAX_REFS);
  const refs = (await Promise.all(ordered.map((it) => fetchRef(it.image)))).map((x, i) => x && { ...x, item: ordered[i] }).filter(Boolean);
  if (!refs.length) throw new Error('商品の写真を読み込めませんでした（楽天の商品写真のみ使えます）');
  const prompt = tryOnPrompt({ ...r, items: refs.map((x) => x.item) });
  let lastError = '';
  for (const model of modelList(env)) {
    const left = deadline - Date.now();
    if (left < 8000) break;
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', '1024x1536');
    form.append('quality', r.quality);
    form.append('n', '1');
    form.append('output_format', 'jpeg');
    refs.forEach((x, i) => form.append('image[]', new Blob([x.buf], { type: x.type }), `item${i + 1}.${x.type.includes('png') ? 'png' : 'jpg'}`));
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(left - 2000)
      });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? '画像の生成に時間がかかりすぎました' : `画像生成APIに接続できませんでした（${e.name}）`);
    }
    const text = await res.text();
    if (!res.ok) {
      lastError = `${model}: ${res.status} ${text.slice(0, 160)}`;
      if (modelUnavailable(res.status, text)) continue;
      throw new Error(res.status === 429 ? '画像生成の利用上限に達しました（OpenAIの残高・上限を確認してください）' : `画像を生成できませんでした（${res.status}）`);
    }
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('画像生成の応答を読み取れませんでした'); }
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) throw new Error('画像が返ってきませんでした');
    return { image: `data:image/jpeg;base64,${b64}`, model, refs: refs.length, costYen: (COST_YEN[model] || COST_YEN['gpt-image-2'])[r.quality] };
  }
  throw new Error(`使える画像生成モデルが見つかりませんでした${lastError ? `（${lastError}）` : ''}`);
}
