// 社長の対応（2026-11-15）：社長にしかできないこと・判断が要ることだけを1つのタブに集める。
//   同期の問題は、安全なものは自動で解決し（js/delivery-store.js autoResolve）、残りを「違いの種類」ごとにまとめて選べるようにする（1件ずつ選ばせない）
//   データの整理は「バックアップ → 件数の確認 → 整理」の順でしか進めない。消さずに「整理済み」へ移す（あとで戻せる）
(function () {
  'use strict';
  var K = window.AppKit;
  var D = window.DeliveryStore;
  var target = null;
  var st = { busy: '', backup: null, dry: null, result: null, msg: '' };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn, disabled) { var b = el('button', cls, text); b.type = 'button'; b.disabled = !!disabled; b.addEventListener('click', fn); return b; }
  function paint() { if (target) render(target); }
  function section(title, hint) { var s = el('section', 'card todo-sec'); s.appendChild(el('h3', 'todo-h', title)); if (hint) s.appendChild(el('p', 'hint', hint)); return s; }

  // 社長の対応の件数（タブの数字）
  function count() {
    if (!D) return 0;
    var groups = D.conflictGroups ? D.conflictGroups() : [];
    var blocked = D.outbox().filter(function (o) { return o.blocked; }).length;
    var ready = D.pendingCount ? D.pendingCount() : 0;
    return groups.length + (blocked ? 1 : 0) + (ready ? 1 : 0);
  }
  function updateBadge() { var b = document.getElementById('todo-count'); if (b) { var n = count(); b.textContent = n ? String(n) : ''; } }

  function syncSection() {
    var meta = window.ServerSync && window.ServerSync.syncMeta ? window.ServerSync.syncMeta() : {};
    var groups = D.conflictGroups ? D.conflictGroups() : [];
    var blocked = D.outbox().filter(function (o) { return o.blocked; });
    var s = section('同期の問題', groups.length || blocked.length ? 'データは消していません。違いの種類ごとにまとめて選べます。' : '対応が必要な同期の問題はありません。');
    if (meta.autoResolved) s.appendChild(el('p', 'hint', 'これまでに自動で解決した件数：' + meta.autoResolved + '件（中身が同じ・判断が反映済み・整理済み。端末の控えは残しています）'));
    groups.forEach(function (g) {
      var box = el('div', 'todo-group');
      box.appendChild(el('p', '', g.label + '：' + g.items.length + '件'));
      box.appendChild(btn('まとめてサーバーの内容のままにする', 'status-btn', function () { g.items.forEach(function (x) { D.removeConflict(x.at); }); K.showToast(g.items.length + '件をサーバーの内容のままにしました（端末の控えは残っています）'); paint(); }));
      if (g.key !== 'decide') box.appendChild(btn('まとめてこの端末の内容でサーバーを上書き', 'status-btn', function () {
        if (!window.confirm(g.items.length + '件を、この端末の内容でサーバーに上書きします。よろしいですか？（端末の控えは書き込みの成功まで残します）')) return;
        g.items.forEach(function (x) { D.restoreConflict(x.at); });
        window.ServerSync.syncData().then(paint);
      }));
      var det = el('details'); det.appendChild(el('summary', null, '対象を見る'));
      g.items.forEach(function (x) { det.appendChild(el('p', 'hint', '「' + x.title + '」')); });
      box.appendChild(det);
      s.appendChild(box);
    });
    if (blocked.length) {
      var b = el('div', 'todo-group');
      b.appendChild(el('p', '', 'サーバーに送れなかった変更：' + blocked.length + '件'));
      b.appendChild(btn('まとめてもう一度送る', 'status-btn', function () { blocked.forEach(function (o) { D.markOp(o, { blocked: null, retry: null }); }); window.ServerSync.syncData().then(paint); }));
      b.appendChild(btn('まとめて送らない（端末の中身は残る）', 'status-btn', function () { blocked.forEach(function (o) { window.ServerSync.dropOp(o); }); paint(); }));
      var det2 = el('details'); det2.appendChild(el('summary', null, '理由を見る'));
      blocked.forEach(function (o) { var x = D.get(o.id) || {}; det2.appendChild(el('p', 'hint', '「' + String(x.title || o.id).slice(0, 24) + '」：' + ((o.blocked && o.blocked.error) || ''))); });
      b.appendChild(det2);
      s.appendChild(b);
    }
    if (meta.lastNotes && meta.lastNotes.length) { var d3 = el('details'); d3.appendChild(el('summary', null, '直近の同期のお知らせ')); meta.lastNotes.forEach(function (n) { d3.appendChild(el('p', 'hint', n)); }); s.appendChild(d3); }
    return s;
  }

  function decideSection() {
    var n = D.pendingCount ? D.pendingCount() : 0;
    var s = section('判断が必要な投稿セット', n ? '公開待ちの投稿セットが' + n + '件あります。' : '判断を待っている投稿セットはありません。');
    if (n) s.appendChild(btn('投稿セットを見る', 'status-btn', function () { location.hash = '#pitch'; setTimeout(function () { if (window.PitchView && window.PitchView.show) window.PitchView.show('sets'); }, 300); }));
    return s;
  }

  // データの整理：バックアップ → 件数の確認 → 整理（消さずに整理済みへ）
  function cleanupSection() {
    var s = section('データの整理（未投稿・未判断の投稿セット）', '投稿済み・採用・却下（理由つき）の記録、費用・売上・商品URLは残します。整理した投稿セットは消さずに「整理済み」として保管し、画面と同期の対象から外します。');
    s.appendChild(el('p', 'field-label', '1. バックアップを保存（この端末とサーバーの全件）'));
    s.appendChild(btn(st.backup ? '保存しました（' + st.backup.name + '）' : 'バックアップを保存する', 'status-btn', function () {
      st.busy = 'backup'; paint();
      window.Backup.saveFull().then(function (r) { st.backup = r; st.busy = ''; paint(); }, function (e) { st.busy = ''; st.msg = String(e.message || e); paint(); });
    }, st.busy === 'backup'));
    if (st.backup) s.appendChild(el('p', 'hint', 'サーバー ' + st.backup.serverRecords + '件・端末のデータ ' + st.backup.localKeys + '種類（' + Math.round(st.backup.bytes / 1024) + 'KB）をファイルにしました。iPhoneの「ファイル」に保存してください。'));
    s.appendChild(el('p', 'field-label', '2. 整理の対象を確認（まだ何も変えません）'));
    s.appendChild(btn('対象の件数を確認する', 'status-btn', function () {
      st.busy = 'dry'; paint();
      K.postJson('api/data', { action: 'cleanup' }).then(function (r) { st.busy = ''; if (r.status === 200 && r.data.targets) st.dry = { server: r.data, local: D.localOnlyCount() }; else st.msg = (r.data && r.data.error) || '確認できませんでした'; paint(); });
    }, !st.backup || st.busy === 'dry'));
    if (st.dry) {
      var byState = {}; st.dry.server.targets.forEach(function (t) { byState[t.state] = (byState[t.state] || 0) + 1; });
      var keepState = {}; st.dry.server.keep.forEach(function (t) { keepState[t.state] = (keepState[t.state] || 0) + 1; });
      var L = { ready: '公開待ち', shelf: '控え', expired: '期限切れ', approved: '採用', published: '投稿済み', rejected: '却下', archived: '整理済み' };
      s.appendChild(el('p', '', '整理する：サーバー ' + st.dry.server.targets.length + '件（' + Object.keys(byState).map(function (k) { return (L[k] || k) + byState[k]; }).join('・') + '）＋この端末にしか無い未投稿 ' + st.dry.local + '件＋自律運営の「まだ使っていない合格候補」と「表紙画像待ち」'));
      s.appendChild(el('p', '', '残す：' + (Object.keys(keepState).map(function (k) { return (L[k] || k) + keepState[k]; }).join('・') || 'なし')));
      var det = el('details'); det.appendChild(el('summary', null, '整理する投稿セットを見る')); st.dry.server.targets.forEach(function (t) { det.appendChild(el('p', 'hint', (L[t.state] || t.state) + '：「' + t.title + '」')); }); s.appendChild(det);
    }
    s.appendChild(el('p', 'field-label', '3. 整理する'));
    s.appendChild(btn('整理する（消さずに整理済みへ）', 'btn btn-discover', function () {
      if (!window.confirm('サーバー ' + st.dry.server.targets.length + '件・この端末 ' + st.dry.local + '件を整理済みにします。投稿済み・採用・却下の記録は残ります。よろしいですか？')) return;
      st.busy = 'run'; paint();
      K.postJson('api/data', { action: 'cleanup', confirm: true }).then(function (r) {
        if (r.status !== 200 || !r.data.moved) { st.busy = ''; st.msg = (r.data && r.data.error) || '整理できませんでした（何も変えていません）'; paint(); return; }
        var n = D.archiveLocal();
        return window.ServerSync.syncData().then(function () { st.result = { server: r.data.moved.length, failed: r.data.failed.length, local: n, worker: r.data.workerArchived }; st.busy = ''; st.dry = null; paint(); });
      });
    }, !st.backup || !st.dry || st.busy === 'run'));
    if (st.result) s.appendChild(el('p', 'hint', '整理しました：サーバー ' + st.result.server + '件' + (st.result.failed ? '（できなかった ' + st.result.failed + '件）' : '') + '・この端末 ' + st.result.local + '件・表紙画像待ち ' + ((st.result.worker || {}).coverWait || 0) + '件。消していないので、記録から戻せます。'));
    if (st.msg) s.appendChild(el('p', 'hint pitch-warn', st.msg));
    return s;
  }

  function render(t) {
    target = t;
    t.textContent = '';
    if (!D) { t.appendChild(el('p', 'hint', '準備中です')); return; }
    t.appendChild(decideSection());
    t.appendChild(syncSection());
    t.appendChild(cleanupSection());
    updateBadge();
  }
  window.TodoView = { render: render, count: count, updateBadge: updateBadge };
  if (window.ServerSync) window.ServerSync.on(function () { updateBadge(); if (target && !target.closest('[hidden]')) paint(); });
  setTimeout(updateBadge, 1500);
})();
