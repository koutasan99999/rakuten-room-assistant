// サングラスくまのマスター画像（2026-11-14）：登録・社長の承認・差し替えの検出・未承認なら生成しない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memoryKv } from '../lib/kv.js';
import * as M from '../lib/kuma-master.js';
import { MASTERS } from '../lib/kuma-master-manifest.js';
import handler from '../server/kuma-master.js';

const read = (f) => fs.readFileSync(new URL(`../assets/kuma-master/${f}`, import.meta.url));

test('登録した2枚：一覧の大きさ・指紋が実際のファイルと一致し、条件を満たす（正面・全身／正面・上半身）', () => {
  assert.deepEqual(MASTERS.map((m) => m.kind).sort(), ['front', 'full']);
  for (const m of MASTERS) {
    const buf = read(m.file);
    assert.equal(M.sha256(buf), m.sha256, `${m.file} の指紋が一覧と違う（差し替えられた）`);
    const info = M.imageInfo(buf);
    assert.equal(info.width, m.width); assert.equal(info.height, m.height); assert.equal(buf.length, m.bytes);
    assert.deepEqual(M.validateMaster(m, MASTERS), [], m.id);
  }
});

test('デザインの参考資料（15場面のコラージュ）はマスターとして扱わない。既存のアイコン kuma.png も変えていない', () => {
  assert.ok(fs.existsSync(new URL('../assets/kuma-reference/collage-15scenes-2026-11-14.png', import.meta.url)), '参考資料は残す');
  assert.ok(!MASTERS.some((m) => /collage|reference/.test(m.file)));
  const icon = M.imageInfo(fs.readFileSync(new URL('../assets/kuma.png', import.meta.url)));
  assert.equal(icon.width, 640, 'kuma.png はそのまま');
  // 確認していない画像（1体だけか・文字やロゴが無いかを確かめていない）は条件を満たさない
  const unchecked = { ...MASTERS[0], id: 'x', checked: {} };
  assert.ok(M.validateMaster(unchecked, MASTERS).some((w) => /1体だけ/.test(w)));
  assert.ok(M.validateMaster({ ...MASTERS[0], id: 'y', width: 900, height: 800 }, []).some((w) => /1024/.test(w)), '小さい画像は使えない');
  assert.ok(M.validateMaster({ ...MASTERS[0], id: 'z' }, [...MASTERS, { id: 'a' }]).some((w) => /3枚まで/.test(w)), '4枚目は登録できない');
});

test('社長が選定した正式マスター2枚は、毎回の承認なしで使える（整合性はプログラムが確認）', async () => {
  assert.ok(MASTERS.every((m) => m.ownerSelected && m.ownerSelected.sha256 === m.sha256), '選定したときの指紋を記録してある');
  const u = await M.usableMasters(memoryKv());
  assert.equal(u.ok, true); assert.equal(u.masters.length, 2);
  assert.equal((await M.usableMasters(null)).ok, true, '保存場所が無くても、選定済みのマスターは使える');
  assert.ok((await M.listMasters(null)).every((m) => m.state === 'approved' && m.approvedBy === '社長が選定'));
  assert.equal((await M.usableMasters(memoryKv(), [])).reason, 'マスター画像が未登録のため、表紙画像は作らない');
  // 生成の直前の確認：取ってきた画像の中身が一覧と違えば使わない
  assert.equal(M.verifyFile(read(MASTERS[0].file), MASTERS[0]), '');
  assert.match(M.verifyFile(read(MASTERS[1].file), MASTERS[0]), /指紋/);
  assert.match(M.verifyFile(Buffer.from('xx'), MASTERS[0]), /読めない/);
});

test('差し替え・追加のときだけ社長の確認が要る。確認するまで使わない。確認は画面で見た画像の指紋が一致するときだけ', async () => {
  const kv = memoryKv();
  const swapped = MASTERS.map((m) => ({ ...m, sha256: 'a'.repeat(64) }));
  assert.equal((await M.listMasters(kv, swapped))[0].state, 'changed');
  const u = await M.usableMasters(kv, swapped);
  assert.equal(u.ok, false); assert.match(u.reason, /差し替え/);
  await assert.rejects(M.approve(kv, swapped[0].id, MASTERS[0].sha256, {}, swapped), /画面の画像と登録されている画像が違います/);
  await M.approve(kv, swapped[0].id, swapped[0].sha256, {}, swapped);
  assert.equal((await M.usableMasters(kv, swapped)).ok, true, '社長が確認したら使える');
  // 新しく追加した（選定していない）マスターは確認待ち
  const added = [{ ...MASTERS[0], id: 'side-1', kind: 'side', ownerSelected: undefined }];
  assert.equal((await M.listMasters(kv, added))[0].state, 'pending');
  assert.equal(await M.revoke(kv, swapped[0].id), true);
  assert.ok(fs.existsSync(new URL(`../assets/kuma-master/${MASTERS[0].file}`, import.meta.url)), '画像は消さない');
});

function call(body, { passcode = 'p', env = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method: 'POST', headers: { 'x-app-passcode': passcode }, body };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(t) { resolve({ status: this.statusCode, data: JSON.parse(t) }); } };
    Object.defineProperty(res, 'status', { value(c) { res.statusCode = c; return res; } });
    handler(req, res, { APP_PASSCODE: 'p', ...env });
  });
}

test('API：合言葉が必須。保存場所が無ければ（差し替えの）確認を記録できない。一覧に秘密の値を出さない。AIを呼ばない', async () => {
  assert.equal((await call({ action: 'list' }, { passcode: 'x' })).status, 401);
  assert.equal((await new Promise((r) => { const res = { statusCode: 0, setHeader() {}, end(t) { r({ status: this.statusCode, data: JSON.parse(t) }); } }; handler({ method: 'POST', headers: {}, body: {} }, res, {}); })).status, 503);
  const l = await call({ action: 'list' });
  assert.equal(l.status, 200); assert.equal(l.data.configured, false); assert.equal(l.data.masters.length, 2); assert.equal(l.data.usable.ok, true, '選定済みの2枚が使える');
  assert.ok(!/APP_PASSCODE.*p"|sk-/.test(JSON.stringify(l.data)));
  const a = await call({ action: 'approve', id: MASTERS[0].id, sha256: MASTERS[0].sha256 });
  assert.equal(a.data.configured, false); assert.match(a.data.error, /未接続/);
  const src = fs.readFileSync(new URL('../server/kuma-master.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../lib/kuma-master.js', import.meta.url), 'utf8');
  assert.ok(!/runWithModels|openai\.com|images\/(edits|generations)/.test(src), '画像生成・AIの呼び出しは入っていない');
});
