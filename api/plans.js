// 企画（Instagramの最初の10投稿）の一覧を返すAPI。画面の「企画から作る」で使う。
import { send } from '../lib/http.js';
import { SERIES_PLANS } from '../lib/plans.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GETで呼び出してください' });
  return send(res, 200, {
    plans: SERIES_PLANS.map((p) => ({
      id: p.id, no: p.no, topic: p.topic, subtitle: p.subtitle || '', category: p.category,
      postType: p.postType, purpose: p.purpose, roles: p.slots.map((s) => s.label)
    }))
  });
}
