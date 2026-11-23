// 紹介番号（2026-11-23・KOT-11）：紹介する商品ごとに一意の連番 No.001, No.002… を付ける。
// Instagramの画像・キャプションと、楽天ROOMの紹介文に同じ番号を載せ、Instagramで見た商品をROOMで探しやすくする。
// 決まり：
//  - 番号は商品（楽天の商品コード。無ければ商品URL）ごとに1つ。同じ商品は、投稿の編集・作り直しをしても同じ番号（台帳 productno:map）。
//  - 番号は増える一方（productno:seq）。台帳の最大の番号より小さくならず、使った番号を別の商品に再利用しない。
//  - 1投稿に複数の商品があれば、商品ごとに番号を付ける。
//  - 付番は鍵（SET NX）で1つずつ行い、同時に動いても同じ番号を2つの商品に渡さない。
//  - カテゴリ・ラベル・コレクションの分類はしない（台帳の1件は { no, name, url, at } のまま。あとで項目を足せる）。
//  - 楽天ROOM内で番号を検索できるかは未確認。文面は「検索できる」と言わず、「同じ番号を載せています」と書く。
const MAP = 'productno:map';
const SEQ = 'productno:seq';
const LOCK = 'productno:lock';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const NO_KEYS = { map: MAP, seq: SEQ };
export const formatNo = (n) => `No.${String(n).padStart(3, '0')}`;
export const parseNo = (s) => { const m = String(s || '').match(/No\.(\d{3,})/); return m ? Number(m[1]) : 0; };
export const itemKey = (it) => String((it && (it.code || it.url)) || '').trim().slice(0, 300);

// 投稿のキャプションに載せる案内（番号つきの商品の一覧）。番号が1つも無ければ空
export function captionNoLines(entries) {
  const list = (entries || []).filter((e) => e && e.no);
  if (!list.length) return '';
  return `楽天ROOMの商品紹介にも、同じ番号を載せています。\n${list.map((e) => `${e.no}${e.name ? ` ${String(e.name).slice(0, 20)}` : ''}`).join('\n')}`;
}
// ROOMの紹介文の先頭に番号を付ける（もう付いていれば何もしない＝何度呼んでも同じ）
export function withNo(text, no) {
  const t = String(text || '');
  if (!no || !t || t.includes(no)) return t;
  return `【${no}】${t}`;
}

async function readMap(kv) { return kv.hgetallJson(MAP); }

// 商品の一覧に番号を付ける（すでに台帳にあれば同じ番号）。items の各要素に no（"No.023"）を入れて返す。
// kv が無い（保存場所が未接続）ときは何もしない（番号なしのまま。作り話の番号は付けない）
export async function ensureNumbers(kv, items, { now = () => new Date().toISOString() } = {}) {
  if (!kv || !Array.isArray(items) || !items.length) return { assigned: [], reused: [], skipped: !kv };
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let got = false;
  for (let i = 0; i < 40 && !got; i++) { got = !!(await kv.set(LOCK, token, { nx: true, ex: 15 })); if (!got) await sleep(100); }
  if (!got) throw new Error('紹介番号の鍵を取れませんでした（ほかの処理が番号を付けています）');
  const out = { assigned: [], reused: [], skipped: false };
  try {
    const map = await readMap(kv);
    let seq = Math.max(Number(await kv.get(SEQ)) || 0, ...Object.values(map).map((v) => Number(v && v.n) || 0));
    for (const it of items) {
      const key = itemKey(it);
      if (!key) continue;
      let rec = map[key];
      if (rec && rec.n) out.reused.push(key);
      else {
        seq += 1;
        rec = { n: seq, name: String(it.name || '').slice(0, 120), url: String(it.url || '').slice(0, 300), at: now() };
        await kv.cmd('HSET', MAP, key, JSON.stringify(rec));
        await kv.set(SEQ, String(seq));
        map[key] = rec;
        out.assigned.push(key);
      }
      it.no = formatNo(rec.n);
    }
  } finally { await kv.delIf(LOCK, token).catch(() => {}); }
  return out;
}

// 管理画面用：番号の一覧（番号の順）
export async function listNumbers(kv) {
  const map = await readMap(kv);
  return Object.entries(map).map(([key, v]) => ({ key, no: formatNo(v.n), n: v.n, name: v.name || '', url: v.url || '', at: v.at || '' })).sort((a, b) => a.n - b.n);
}
