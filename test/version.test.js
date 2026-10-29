import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 画面（index.html）とプログラムの版がずれると、更新直後にボタンや一覧が出なくなる。必ず同じ値にする
test('index.html と js/app.js の版がそろっている', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const v = app.match(/var APP_VERSION = '([^']+)'/)[1];
  assert.equal(html.match(/<meta name="app-version" content="([^"]+)">/)[1], v);
  const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 10);
  for (const r of refs) assert.ok(r.endsWith('?v=' + v), r + ' に ?v=' + v + ' が付いていない');
});
