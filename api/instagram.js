// 「Instagram画像を作る」で、画像に載せる文字（短い商品名・補足1行・くまの一言メモ）を返すAPI。
import { send, checkAccess, readBody } from '../lib/http.js';
import { buildPostCopy, MAX_POST_ITEMS, fallbackCaptionBody, assembleCaption } from '../lib/instagram.js';
import { buildHashtags } from '../lib/hashtags.js';
import { isCoverStyle } from '../lib/covers.js';
import { maskSecrets } from '../lib/ai.js';

function cleanItem(x) {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  return { name: str(x.name, 200), price: Number(x.price) || 0, role: str(x.role, 20), reason: str(x.reason || x.why, 200), intro: str(x.intro, 300), memo: str(x.memo, 60) };
}

export default async function handler(req, res, env = process.env) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTで呼び出してください' });
  if (!checkAccess(req, res, env)) return;

  const body = await readBody(req);
  const items = (Array.isArray(body.items) ? body.items : []).filter((x) => x && x.name).slice(0, MAX_POST_ITEMS).map(cleanItem);
  if (!items.length) return send(res, 400, { error: '商品が選ばれていません' });
  if (!String(body.theme || '').trim()) return send(res, 400, { error: '投稿テーマを入れてください' });

  const collection = String(body.collection || '').slice(0, 40);
  const copy = await buildPostCopy({
    theme: String(body.theme).slice(0, 60),
    category: String(body.category || '').slice(0, 20),
    coverStyle: isCoverStyle(body.coverStyle) || body.coverStyle === 'auto' ? body.coverStyle : 'serious_think',
    priceBand: String(body.priceBand || '').slice(0, 30),
    items, needSummary: body.needSummary === true, needCaption: body.needCaption === true, collection, env, deadline: startedAt + 25000
  });
  const caption = body.needCaption === true
    ? assembleCaption({
      body: copy.caption || fallbackCaptionBody(copy.topic, copy.items.map((x, i) => ({ ...x, role: items[i].role }))),
      collection,
      hashtags: buildHashtags({ topic: copy.topic, category: String(body.category || ''), genre: String(body.genre || '').slice(0, 30), postType: String(body.postType || '').slice(0, 30), aiTags: copy.hashtags })
    })
    : undefined;
  const notice = copy.fallback ? 'AIでの文字作成に失敗したため、簡易的な商品名・メモで作りました。' : '';
  return send(res, 200, {
    topic: copy.topic, category: copy.category, topicSlug: copy.topicSlug, summary: copy.summary, items: copy.items, cover: copy.cover, notice,
    caption,
    detail: copy.fallback ? `原因: ${maskSecrets(copy.error || '')}`.slice(0, 300) : undefined
  });
}
