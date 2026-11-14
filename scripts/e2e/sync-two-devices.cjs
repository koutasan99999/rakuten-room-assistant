// 使い方：APP_PASSCODE=e2e-pass PORT=3143 MOCK=1 MOCK_KV=1 node scripts/dev-server.js を起動してから、node scripts/e2e/sync-two-devices.cjs 画面写真の保存先.png
// 別端末相当の同期テスト：同じサーバー（MOCK_KV）に、別々のブラウザ（＝別の端末）A・B でつなぐ
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const out = {}; const errors = [];
  const mk = async (pass = 'e2e-pass') => { const ctx = await b.newContext({ ...devices['iPhone 13'] }); await ctx.addInitScript((pw) => { try { if (pw) localStorage.setItem('room-passcode', pw); } catch (e) {} }, pass); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.accept()); return p; };
  const waitData = (p) => p.waitForFunction(() => { const s = window.ServerSync && window.ServerSync.status(); return s && s.data && (s.data.ok || s.data.error); }, null, { timeout: 40000 });
  const setOf = (id, status, extra = {}) => ({ id, status, title: '企画' + id, pattern: 'discovery', patternLabel: '変わり種', target: '30代', createdAt: new Date(Date.now() - Number(id.slice(1)) * 60000).toISOString(), items: [{ name: '商品' + id, price: 1000, code: 'c:' + id, url: 'https://item.rakuten.co.jp/s/' + id + '/', image: '' }], copy: { caption: 'x ※楽天アフィリエイトを利用しています。', items: [] }, ...extra });
  const seed = { sets: {}, history: [] };
  [['s1', 'new'], ['s2', 'new'], ['s3', 'new'], ['s4', 'new'], ['s5', 'adopted'], ['s6', 'rejected']].forEach(([id, st]) => { seed.sets[id] = setOf(id, st, st === 'adopted' ? { decidedAt: new Date().toISOString() } : {}); });

  // 端末A：既存のデータ（6件）を持っている → 開くと移行・照合
  const A = await mk();
  await A.goto('http://localhost:3143/#company');
  await A.evaluate((s) => { localStorage.setItem('room-delivery', JSON.stringify(s)); localStorage.setItem('room-delivery-ok', '1'); }, seed);
  await A.reload(); await waitData(A);
  out.A_first = await A.evaluate(() => { const s = window.ServerSync.status(); return { data: s.data && { ok: s.data.ok, error: s.data.error, migration: s.data.migration, count: s.data.count, capacity: s.data.capacity }, meta: window.ServerSync.syncMeta() }; });
  out.A_local = await A.evaluate(() => window.DeliveryStore.all().map((x) => x.id + ':' + x.status + ':' + (x._server ? x._server.state + '@' + x._server.rev : '-')).sort());
  // もう一度開いても移行を繰り返さない・増えない
  await A.reload(); await waitData(A);
  out.A_second = await A.evaluate(() => { const s = window.ServerSync.status().data; return { migration: s.migration, count: s.count }; });

  // 端末B：何も持っていない新しい端末 → サーバーの正本が写る
  const B = await mk();
  await B.goto('http://localhost:3143/#company'); await waitData(B);
  out.B_local = await B.evaluate(() => window.DeliveryStore.all().map((x) => x.id + ':' + x.status + ':' + (x._server ? x._server.state + '@' + x._server.rev : '-')).sort());

  // 同じ投稿セット（公開待ちの s1）を、Aが採用 → Bは古い内容のまま却下しようとする（更新番号が古い）
  await A.evaluate(() => { window.DeliveryStore.decide('s1', 'adopted', ''); return window.ServerSync.syncData(); });
  out.A_after = await A.evaluate(() => { const x = window.DeliveryStore.get('s1'); return x.status + ':' + x._server.state + '@' + x._server.rev; });
  out.B_decide = await B.evaluate(() => { window.DeliveryStore.decide('s1', 'rejected', 'Bの判断'); return window.ServerSync.syncData().then((r) => ({ notes: r.notes, s1: (function () { const x = window.DeliveryStore.get('s1'); return x.status + ':' + x._server.state + '@' + x._server.rev; })() })); });
  // Bの中身の修正（タイトル）→ Aにも写る
  await B.evaluate(() => { const x = window.DeliveryStore.get('s2'); window.DeliveryStore.save(Object.assign({}, x, { titleEdit: 'Bで直したタイトル' })); return window.ServerSync.syncData(); });
  await A.evaluate(() => window.ServerSync.syncData());
  out.A_sees_B_edit = await A.evaluate(() => window.DeliveryStore.get('s2').titleEdit);
  // 端末Aのデータは消えていない（6件のまま）
  out.A_count = await A.evaluate(() => window.DeliveryStore.all().length);
  // 投稿セットの画面（Bで表示）：公開待ち・控え・採用・却下
  await B.goto('http://localhost:3143/#pitch'); await B.waitForTimeout(1500);
  await B.evaluate(() => window.PitchView && window.PitchView.show && window.PitchView.show('sets')); await B.waitForTimeout(1200);
  out.B_tabs = await B.evaluate(() => [...document.querySelectorAll('.field-label')].map((x) => x.textContent).filter((t) => /公開待ち|控え|採用（|却下（|期限切れ/.test(t)));
  out.overflow = await B.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await B.screenshot({ path: process.argv[2] });
  // 端末C：合言葉を知らない端末 → サーバーの投稿セットは読めない（何も写らない）
  const C = await mk('');
  await C.goto('http://localhost:3143/#company');
  await C.waitForFunction(() => window.ServerSync && window.ServerSync.status(), null, { timeout: 40000 });
  out.C_noauth = await C.evaluate(() => { const s = window.ServerSync.status(); return { configured: s.configured, error: s.error || (s.data && s.data.error) || '', sets: window.DeliveryStore.all().length }; });
  out.C_direct = await C.evaluate(() => fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }).then((r) => r.status));
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
