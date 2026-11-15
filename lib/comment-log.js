// Instagramのコメントの送信記録（2026-11-15）。広報の仕事を社長が確かめられるように、サーバーに残す。
// 記録の出どころ（source）を必ず分ける：
//   instagram_activity … Instagram自身の「アクティビティ → コメント」で、送信済みと確認できたもの（確認した日時つき）
//   owner_report       … 社長が「コメントした」と記録したもの（Instagramとはまだ照合していない）
// 送信の結果（result）：sent（送信成功）／failed（送信失敗）。分からないものは記録しない（推測で埋めない）。
// アプリ・サーバーはコメントを送らない（公式APIに他の人の投稿へのコメントは無い）。ここは記録だけ。
const KEY = 'pr:comment:log';
export const SOURCES = { instagram_activity: 'Instagramのアクティビティで確認', owner_report: '社長の記録（Instagramとは未照合）' };
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function readEntry(x) {
  if (!x || typeof x !== 'object') return null;
  const m = String(x.postUrl || '').trim().match(/^https:\/\/(?:www\.)?instagram\.com\/(p|reel)\/([A-Za-z0-9_-]{5,40})\/?/);
  if (!m) return null;
  const text = str(x.text, 300);
  const sentAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(x.sentAt || '')) && !Number.isNaN(Date.parse(x.sentAt)) ? new Date(x.sentAt).toISOString() : '';
  const source = SOURCES[x.source] ? x.source : '';
  const result = ['sent', 'failed'].includes(x.result) ? x.result : '';
  if (!text || !source || !result) return null;
  const handle = str(x.handle, 30).replace(/^@/, '').toLowerCase();
  return {
    id: `${m[2]}:${text.slice(0, 40)}`,
    postUrl: `https://www.instagram.com/${m[1]}/${m[2]}/`,
    handle: /^[a-z0-9._]{1,30}$/.test(handle) ? handle : '',
    text, sentAt, result, source,
    by: str(x.by, 60), // 実行した人・道具の記録があるときだけ（例：Claude in Chrome（社長の承認））。無ければ空欄＝記録なし
    checkedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(x.checkedAt || '')) ? new Date(x.checkedAt).toISOString() : new Date().toISOString(),
    note: str(x.note, 160)
  };
}

export async function list(kv) {
  const h = (await kv.hgetallJson(KEY)) || {};
  return Object.values(h).sort((a, b) => String(b.sentAt || b.checkedAt).localeCompare(String(a.sentAt || a.checkedAt)));
}

// 追加・更新（同じ投稿・同じ文章は1件。Instagramで確認できた記録は、社長の記録より優先して残す）
export async function add(kv, entries) {
  const cur = (await kv.hgetallJson(KEY)) || {};
  let added = 0; let updated = 0; const rejected = [];
  for (const raw of (Array.isArray(entries) ? entries : []).slice(0, 100)) {
    const e = readEntry(raw);
    if (!e) { rejected.push(String((raw && raw.postUrl) || '').slice(0, 80)); continue; }
    const old = cur[e.id];
    if (old && old.source === 'instagram_activity' && e.source !== 'instagram_activity') continue; // 確認済みの記録を未照合で上書きしない
    const next = old ? { ...old, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v !== '')) } : e;
    await kv.cmd('HSET', KEY, e.id, JSON.stringify(next));
    if (old) updated += 1; else added += 1;
  }
  return { added, updated, rejected };
}
export { KEY as COMMENT_LOG_KEY };
