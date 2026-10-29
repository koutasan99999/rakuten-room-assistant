// ブランドの概要（AIの説明）。「知らないブランド発見」で、押したときだけ呼ぶ。
// AIの知識による説明なので、画面では「AIの説明（未確認）」と分けて表示する。知らないブランドは「分かりません」と答えさせる。
import { send, checkAccess, readBody } from '../lib/http.js';
import { runWithModels, cleanText, maskSecrets } from '../lib/ai.js';

const PROMPT = `あなたはファッション・雑貨・家電などのブランドに詳しい編集者です。JSONだけを返してください。
指定されたブランドについて、知っている事実だけを短く説明します。
- 確かに知っていることだけを書く。知らない・自信がないときは known を false にして、summary は空にする
- 創業年・国・人気の商品など、確信のない数字や固有名詞は書かない
- 宣伝の言葉（最高・必ず・大人気など）は使わない
- summary は60字以内、taste（テイスト）は12字以内
出力形式: {"known":true,"summary":"...","taste":"..."}`;

export default async function handler(req, res, env = process.env) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;
  const b = await readBody(req);
  const brand = String(b.brand || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 40);
  if (!brand) return send(res, 400, { error: 'ブランド名がありません' });
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 3).map((x) => String(x || '').slice(0, 60));
  try {
    const { result } = await runWithModels({
      env, deadline: Date.now() + 20000, system: PROMPT,
      userContent: `ブランド: ${brand}\n楽天の売れ筋に出ていた商品（参考）: ${items.join('／') || 'なし'}`,
      parse: (c) => {
        const d = JSON.parse(String(c).match(/\{[\s\S]*\}/)[0]);
        return { known: d.known === true, summary: d.known === true ? cleanText(d.summary).slice(0, 60) : '', taste: d.known === true ? cleanText(d.taste).slice(0, 12) : '' };
      }
    });
    return send(res, 200, result);
  } catch (e) {
    return send(res, 502, { error: 'AIの説明を取得できませんでした', detail: maskSecrets(e.message).slice(0, 200) });
  }
}
