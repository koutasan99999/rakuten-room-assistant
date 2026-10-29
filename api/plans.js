// 画面で使う一覧を返すAPI：企画（Instagramの最初の10投稿）、選び方の型、企画データベースのジャンル名。
import { send } from '../lib/http.js';
import { SERIES_PLANS } from '../lib/plans.js';
import { CURATION_TYPES } from '../lib/themes.js';
import { CATALOG } from '../lib/catalog.js';
import { COVER_FOR_TYPE, COVER_STYLES } from '../lib/covers.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GETで呼び出してください' });
  return send(res, 200, {
    plans: SERIES_PLANS.map((p) => ({
      id: p.id, no: p.no, topic: p.topic, subtitle: p.subtitle || '', category: p.category,
      postType: p.postType, purpose: p.purpose, roles: p.slots.map((s) => s.label)
    })),
    // cover: その型で作る表紙のシリーズと、見本の大見出し（選択画面の小さな表紙の見本に使う）
    types: Object.entries(CURATION_TYPES).map(([id, t]) => {
      const style = COVER_FOR_TYPE[id] === 'auto' ? 'serious_think' : COVER_FOR_TYPE[id];
      const ex = COVER_STYLES[style].examples[0] || '';
      return { id, name: t.name, desc: t.desc, cover: { style, title: ex, accent: COVER_STYLES[style].accent || '' } };
    }),
    genres: CATALOG.map((c) => c.name)
  });
}
