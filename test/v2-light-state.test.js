// 2026-11-25 KOT-27：起動時の軽い状態（action:state・light:true）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryKv } from '../lib/kv.js';
import * as V from '../lib/v2/company.js';

const ENV = { APP_PASSCODE: 'pw' };

test('軽い状態：オフィス・社員・案件・お金は同じ。事業・成果・集客などは含めず partial で示す', async () => {
  const kv = memoryKv();
  const full = await V.officeState(kv, ENV);
  const light = await V.officeState(kv, ENV, { light: true });
  assert.equal(light.partial, true);
  assert.equal(full.partial, false);
  assert.deepEqual(light.staff.map((s) => [s.id, s.status, s.doing]), full.staff.map((s) => [s.id, s.status, s.doing]));
  assert.deepEqual(light.cases, full.cases);
  assert.deepEqual(light.money, full.money);
  assert.equal(light.roomStop.stopped, full.roomStop.stopped, 'ROOM停止の表示は軽い状態にも入る');
  assert.equal(light.ventures, null);
  assert.equal(light.kpi, null);
  assert.equal(light.profit, null);
  assert.ok(light.staff.every((s) => s.indep === undefined), '独立した仕事の欄は推測で埋めない');
});

test('画面：初回は軽い状態を先に取り、通信は打ち切り・再試行し、全体がそろうまで詳細タブは読み込み中', () => {
  const js = readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  assert.match(js, /light: true/);
  assert.match(js, /AbortController/);
  assert.match(js, /if \(inflight\) return inflight/);
  assert.match(js, /detailReady/);
});
