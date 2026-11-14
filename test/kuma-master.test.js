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

test('社長が承認するまで生成に使えない。承認は画面で見た画像の指紋が一致するときだけ', async () => {
  const kv = memoryKv();
  let u = await M.usableMasters(kv);
  assert.equal(u.ok, false); assert.match(u.reason, /承認待ち/);
  assert.equal((await M.usableMasters(null)).ok, false, '保存場所が無ければ使わない');
  assert.equal((await M.usableMasters(kv, [])).reason, 'マスター画像が未登録のため、表紙画像は作らない');
  await assert.rejects(M.approve(kv, MASTERS[0].id, 'f'.repeat(64)), /画面の画像と登録されている画像が違います/);
  await assert.rejects(M.approve(kv, 'nai', MASTERS[0].sha256), /登録されていません/);
  await M.approve(kv, MASTERS[0].id, MASTERS[0].sha256);
  u = await M.usableMasters(kv);
  assert.equal(u.ok, true); assert.equal(u.masters.length, 1);
  assert.equal((await M.listMasters(kv)).find((m) => m.id === MASTERS[1].id).state, 'pending');
});

test('承認したあとに画像が差し替えられたら使わない（もう一度承認が必要）。取り消しても画像は消さない', async () => {
  const kv = memoryKv();
  await M.approve(kv, MASTERS[0].id, MASTERS[0].sha256);
  const swapped = MASTERS.map((m, i) => (i === 0 ? { ...m, sha256: 'a'.repeat(64) } : m));
  const list = await M.listMasters(kv, swapped);
  assert.equal(list[0].state, 'changed');
  const u = await M.usableMasters(kv, swapped);
  assert.equal(u.ok, false); assert.match(u.reason, /差し替え/);
  assert.equal(await M.revoke(kv, MASTERS[0].id), true);
  assert.equal((await M.usableMasters(kv)).ok, false);
  assert.ok(fs.existsSync(new URL(`../assets/kuma-master/${MASTERS[0].file}`, import.meta.url)));
});

function call(body, { passcode = 'p', env = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method: 'POST', headers: { 'x-app-passcode': passcode }, body };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(t) { resolve({ status: this.statusCode, data: JSON.parse(t) }); } };
    Object.defineProperty(res, 'status', { value(c) { res.statusCode = c; return res; } });
    handler(req, res, { APP_PASSCODE: 'p', ...env });
  });
}

test('API：合言葉が必須。保存場所が無ければ承認できない。一覧に秘密の値を出さない。AIを呼ばない', async () => {
  assert.equal((await call({ action: 'list' }, { passcode: 'x' })).status, 401);
  assert.equal((await new Promise((r) => { const res = { statusCode: 0, setHeader() {}, end(t) { r({ status: this.statusCode, data: JSON.parse(t) }); } }; handler({ method: 'POST', headers: {}, body: {} }, res, {}); })).status, 503);
  const l = await call({ action: 'list' });
  assert.equal(l.status, 200); assert.equal(l.data.configured, false); assert.equal(l.data.masters.length, 2); assert.equal(l.data.usable.ok, false);
  assert.ok(!/APP_PASSCODE.*p"|sk-/.test(JSON.stringify(l.data)));
  const a = await call({ action: 'approve', id: MASTERS[0].id, sha256: MASTERS[0].sha256 });
  assert.equal(a.data.configured, false); assert.match(a.data.error, /未接続/);
  const src = fs.readFileSync(new URL('../server/kuma-master.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../lib/kuma-master.js', import.meta.url), 'utf8');
  assert.ok(!/runWithModels|openai\.com|images\/(edits|generations)/.test(src), '画像生成・AIの呼び出しは入っていない');
});
