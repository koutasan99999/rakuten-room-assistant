// サングラスくまのマスター画像（2026-11-14）：表紙画像を生成するときに参考として渡す、くま1体だけの高品質な画像。
// - 画像の一覧（ファイル名・種類・大きさ・指紋 sha256）は lib/kuma-master-manifest.js（scripts/kuma-master-add.mjs で取り込む）
// - 社長が選定した正式マスター（2026-11-14 の2枚）は、一覧に ownerSelected（選定日と指紋）を記録してある。毎回の承認は求めない
// - 整合性（指紋・大きさ・形式）はプログラムが自動で確かめる。指紋が選定したときと違う＝差し替えられたら使わず、社長の確認を待つ
// - マスターの追加・差し替えのときだけ、社長が画面で確認する（サーバーの保存場所 kuma:master:approvals に、確認したときの指紋と一緒に残す）
// - 使えるマスターが無ければ画像の生成はしない（別のくまで代用しない）
// - デザインの参考資料（assets/kuma-reference/ の15場面のコラージュ）はマスターにしない
import crypto from 'node:crypto';
import { MASTERS } from './kuma-master-manifest.js';

export const KINDS = { front: '正面・上半身', full: '正面・全身', side: '斜め' };
export const MAX_MASTERS = 3;          // 参考画像が増えるほど生成の費用が増えるため
export const MIN_LONG_SIDE = 1024;
export const MAX_BYTES = 10 * 1024 * 1024;
export const APPROVALS_KEY = 'kuma:master:approvals';
// 衣装はマスターに固定しない（社長の決定 2026-11-14）。マスターの黒いパーカーは撮影用の衣装
export const FIXED_TRAITS = ['キャメル色のふわふわした毛並み', '大きな黒いサングラス', '丸い顔・小さな鼻・短い手足', 'かわいくデフォルメされた体型', '立体感のある3Dぬいぐるみ風の質感'];

// 画像の形式と大きさ（PNG・JPEG）を中身から読む
export function imageInfo(buf) {
  const b = Buffer.from(buf);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { format: 'jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}
export const sha256 = (buf) => crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');

// マスターの条件（コードで確かめられるもの）。1体だけか・文字やロゴが無いかは、取り込むときに人が確かめて記録する（checked）
export function validateMaster(m, all = []) {
  const why = [];
  if (!m || typeof m !== 'object') return ['中身がありません'];
  if (!/^[a-z0-9-]{1,40}$/.test(String(m.id || ''))) why.push('IDは英小文字・数字・ハイフンで40字まで');
  if (!KINDS[m.kind]) why.push(`種類は ${Object.keys(KINDS).join('／')} のどれか`);
  if (!/^[a-z0-9-]+\.(png|jpe?g)$/.test(String(m.file || ''))) why.push('ファイルは assets/kuma-master/ の PNG か JPEG');
  if (!['png', 'jpeg'].includes(m.format)) why.push('PNG か JPEG だけ');
  if (Math.max(Number(m.width) || 0, Number(m.height) || 0) < MIN_LONG_SIDE) why.push(`長い辺が${MIN_LONG_SIDE}ピクセル未満`);
  if (!(Number(m.bytes) > 0) || Number(m.bytes) > MAX_BYTES) why.push('ファイルの大きさが0か10MBを超える');
  if (!/^[0-9a-f]{64}$/.test(String(m.sha256 || ''))) why.push('指紋（sha256）が無い');
  const c = m.checked || {};
  if (c.single !== true) why.push('くまが1体だけか未確認（コラージュ・複数の場面は使えない）');
  if (c.noText !== true || c.noLogo !== true) why.push('文字・ロゴが無いか未確認');
  if (all.filter((x) => x.id !== m.id).length >= MAX_MASTERS) why.push(`マスターは${MAX_MASTERS}枚まで`);
  return why;
}

async function approvals(kv) { return (kv && (await kv.getJson(APPROVALS_KEY).catch(() => null))) || {}; }

// 実際の画像の中身が一覧と同じか（生成の直前に、取ってきた画像で確かめる）
export function verifyFile(buf, m) {
  const info = imageInfo(buf);
  if (!info) return 'PNG・JPEG として読めない';
  if (sha256(buf) !== m.sha256) return '指紋が一覧と違う（差し替えられた可能性）';
  if (info.width !== m.width || info.height !== m.height) return '大きさが一覧と違う';
  return '';
}

// 一覧と状態：approved（承認済み・指紋が一致）／pending（確認待ち）／changed（承認後に画像が差し替えられた＝使わない）／invalid（条件を満たさない）
export async function listMasters(kv, masters = MASTERS) {
  const ap = await approvals(kv);
  return masters.map((m) => {
    const problems = validateMaster(m, masters);
    const a = ap[m.id];
    const sel = m.ownerSelected && m.ownerSelected.sha256 ? m.ownerSelected : null;
    const okBy = sel && sel.sha256 === m.sha256 ? { at: sel.at, by: '社長が選定' } : a && a.sha256 === m.sha256 ? { at: a.approvedAt, by: '社長が確認' } : null;
    const state = problems.length ? 'invalid' : okBy ? 'approved' : (sel || a) ? 'changed' : 'pending';
    return { id: m.id, kind: m.kind, kindLabel: KINDS[m.kind] || '', file: m.file, url: `/assets/kuma-master/${m.file}?h=${String(m.sha256).slice(0, 8)}`, width: m.width, height: m.height, bytes: m.bytes, sha256: m.sha256, addedAt: m.addedAt, note: m.note || '', state, problems, approvedAt: okBy ? okBy.at : null, approvedBy: okBy ? okBy.by : '' };
  });
}

// 画像の生成に使えるマスター。無ければ理由を返す（生成しない）
export async function usableMasters(kv, masters = MASTERS) {
  const list = await listMasters(kv, masters);
  const ok = list.filter((m) => m.state === 'approved');
  if (!list.length) return { ok: false, masters: [], reason: 'マスター画像が未登録のため、表紙画像は作らない' };
  if (!ok.length) return { ok: false, masters: [], reason: list.some((m) => m.state === 'changed') ? '承認したあとにマスター画像が差し替えられたため、もう一度社長の承認が必要（画像は作らない）' : 'マスター画像が社長の確認待ちのため、表紙画像は作らない' };
  if (!ok.some((m) => m.kind === 'front' || m.kind === 'full')) return { ok: false, masters: [], reason: '正面のマスター画像（上半身か全身）が承認されていない' };
  return { ok: true, masters: ok, reason: '' };
}

// 社長の承認：画面で見た画像の指紋（sha256）を一緒に送る。今の一覧の指紋と違えば承認しない（見たものと違う画像を承認しない）
export async function approve(kv, id, shaSeen, { by = '社長', now = new Date() } = {}, masters = MASTERS) {
  const m = masters.find((x) => x.id === id);
  if (!m) throw new Error('そのマスター画像は登録されていません');
  const problems = validateMaster(m, masters);
  if (problems.length) throw new Error(`条件を満たさないため承認できません：${problems.join('／')}`);
  if (String(shaSeen || '') !== m.sha256) throw new Error('画面の画像と登録されている画像が違います。画面を開き直してから承認してください');
  const ap = await approvals(kv);
  ap[id] = { sha256: m.sha256, approvedAt: now.toISOString(), by };
  await kv.setJson(APPROVALS_KEY, ap);
  return ap[id];
}
// 承認の取り消し（画像そのものは消さない）
export async function revoke(kv, id) {
  const ap = await approvals(kv);
  const had = !!ap[id];
  delete ap[id];
  await kv.setJson(APPROVALS_KEY, ap);
  return had;
}
