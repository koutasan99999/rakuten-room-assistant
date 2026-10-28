// 画面で使う一覧を返すAPI：企画（Instagramの最初の10投稿）、選び方の型、企画データベースのジャンル名。
import { send } from '../lib/http.js';
import { SERIES_PLANS } from '../lib/plans.js';
import { CURATION_TYPES } from '../lib/themes.js';
import { CATALOG } from '../lib/catalog.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GETで呼び出してください' });
  return send(res, 200, {
    plans: SERIES_PLANS.map((p) => ({
      id: p.id, no: p.no, topic: p.topic, subtitle: p.subtitle || '', category: p.category,
      postType: p.postType, purpose: p.purpose, roles: p.slots.map((s) => s.label)
    })),
    types: Object.entries(CURATION_TYPES).map(([id, t]) => ({ id, name: t.name, desc: t.desc })),
    genres: CATALOG.map((c) => c.name)
  });
}
