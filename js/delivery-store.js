// 投稿セットの納品の記録（このiPhoneのブラウザ内）：AI社員が作った投稿セット（企画・商品・文章）と、社長の判断（採用・差し替え・却下）。
// 画像（スライド）は保存せず、開くたびに商品画像から描き直す（容量を使わないため）。判断の履歴は次の企画づくりに渡す。
(function () {
  'use strict';

  var KEY = 'room-delivery';
  var STATUS = { new: '確認待ち', adopted: '採用', rejected: '却下' };

  function read() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    s = s && typeof s === 'object' ? s : {};
    s.sets = s.sets && typeof s.sets === 'object' ? s.sets : {};
    s.history = Array.isArray(s.history) ? s.history : [];
    s.outbox = Array.isArray(s.outbox) ? s.outbox : []; // サーバーへまだ送っていない変更（2026-11-14・段階1）
    s.conflicts = Array.isArray(s.conflicts) ? s.conflicts : []; // 競合・移行の差異で採用されなかった、この端末の中身（確認・復旧用）
    return s;
  }
  // 保存する。容量が足りないときも、既存の投稿セットは消さない（2026-11-14 修正：以前は古い却下を自動で消していた）。
  // 保存できなければ false を返し、lastError に理由を残す（呼んだ側は成功として扱わない）
  function write(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); api.lastError = ''; return true; } catch (e) {
      api.lastError = '投稿セットを端末に保存できませんでした（' + (e && e.name === 'QuotaExceededError' ? '端末の保存容量が足りません' : (e && e.name) || '不明') + '）。データは消していません。サーバーにつながっていれば、サーバーの正本には残っています';
      if (window.AppKit && window.AppKit.showToast) window.AppKit.showToast(api.lastError);
      return false;
    }
  }

  function pruneResolved(s) {
    var resolved = s.conflicts.filter(function (x) { return x.resolved; });
    if (resolved.length <= 50) return;
    var drop = resolved.slice(50).map(function (x) { return x.at; });
    s.conflicts = s.conflicts.filter(function (x) { return !x.resolved || drop.indexOf(x.at) === -1; });
  }
  // 送る予定に入れる（同じ投稿セットの同じ種類の予定は1つにまとめる。判断は順番どおり残す）
  function queue(s, op) {
    op.at = new Date().toISOString();
    if (op.op !== 'decide') {
      var prev = s.outbox.filter(function (x) { return x.id === op.id && (x.op === 'put' || x.op === 'import') && x.restoreOf; })[0];
      if (prev && !op.restoreOf) op.restoreOf = prev.restoreOf; // まとめても、復旧中の印は引き継ぐ
      s.outbox = s.outbox.filter(function (x) { return !(x.id === op.id && (x.op === 'put' || x.op === 'import')); });
    }
    s.outbox.push(op); // 件数の上限で消さない（送信の成功か、社長の明示的な「送らない」まで残す。容量が足りなければ保存の失敗として返す）
  }

  var api = window.DeliveryStore = {
    STATUS: STATUS,
    all: function () {
      var st = read().sets;
      return Object.keys(st).map(function (k) { return st[k]; }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    },
    get: function (id) { return read().sets[id] || null; },
    save: function (set) {
      var s = read();
      s.sets[set.id] = Object.assign({ status: 'new' }, s.sets[set.id] || {}, set);
      // サーバーの正本へ送る予定に入れる（サーバーに既にあれば中身の更新、無ければ新しく取り込む）。送るときに最新の中身を読む
      queue(s, { op: s.sets[set.id]._server ? 'put' : 'import', id: set.id });
      return write(s) ? s.sets[set.id] : null; // 保存できなければ null（成功として扱わない）
    },
    // サーバーの正本の内容を、この端末の写しに書く（送る予定には入れない）。状態の読み替え：公開待ち・控え・期限切れ→確認待ち（_server.state で見分ける）／採用・公開済み→採用／却下→却下
    applyServer: function (rec) {
      var s = read();
      var local = s.sets[rec.id] || {};
      var status = rec.state === 'approved' || rec.state === 'published' ? 'adopted' : rec.state === 'rejected' ? 'rejected' : 'new';
      s.sets[rec.id] = Object.assign({}, local, rec.set || {}, { id: rec.id, status: status, _server: { rev: rec.rev, state: rec.state, updatedAt: rec.updatedAt, score: rec.score, decision: rec.decision || null } });
      return write(s) ? s.sets[rec.id] : null;
    },
    outbox: function () { return read().outbox.slice(); },
    // 送り終えた（または競合で取りやめた）予定を外す
    doneOp: function (op) { var s = read(); s.outbox = s.outbox.filter(function (x) { return !(x.op === op.op && x.id === op.id && x.at === op.at); }); return write(s); },
    // 送れなかった予定に印を付ける（消さない）。blocked：直さないと送れない（社長の確認が必要）／retry：通信などの一時的な失敗（次に自動で送る）
    markOp: function (op, patch) { var s = read(); s.outbox.forEach(function (x) { if (x.op === op.op && x.id === op.id && x.at === op.at) Object.assign(x, patch); }); return write(s); },
    // 競合・移行の差異で採用されなかった、この端末の中身を残す（確認・復旧用）
    // 未解決の競合は件数にかかわらず残す。整理してよいのは解決済みだけ（新しい解決済み50件は残す）
    addConflict: function (c) {
      var s = read();
      var at = new Date().toISOString(); while (s.conflicts.some(function (x) { return x.at === at; })) at = at.replace(/Z$/, '') + '1Z'; // 同じ時刻でも区別する
      s.conflicts.unshift(Object.assign({ at: at }, c));
      pruneResolved(s);
      return write(s);
    },
    conflicts: function (opt) { var all = read().conflicts.slice(); return opt && opt.all ? all : all.filter(function (x) { return !x.resolved; }); },
    // 「サーバーの内容のままにする」：解決済みにする（記録は残す）
    removeConflict: function (at) { var s = read(); s.conflicts.forEach(function (x) { if (x.at === at && !x.resolved) { x.resolved = { at: new Date().toISOString(), how: 'サーバーの内容のまま' }; x.restoring = false; } }); pruneResolved(s); return write(s); },
    // 復旧の結果：成功したら解決済みに／再競合なら未解決のまま（もう一度選べる）
    resolveConflict: function (at, how) { var s = read(); s.conflicts.forEach(function (x) { if (x.at === at) { x.resolved = { at: new Date().toISOString(), how: how }; x.restoring = false; } }); pruneResolved(s); return write(s); },
    reopenConflict: function (at, patch) { var s = read(); s.conflicts.forEach(function (x) { if (x.at === at) Object.assign(x, { restoring: false }, patch || {}); }); return write(s); },
    // 競合した端末の中身で、サーバーを上書きする（社長がはっきり選んだときだけ。今の更新番号で送る）
    // 原本（c.local）は、サーバーへの書き込みが成功したと確かめるまで消さない
    restoreConflict: function (at) {
      var s = read(); var c = s.conflicts.filter(function (x) { return x.at === at && !x.resolved; })[0];
      if (!c || !c.local) return false;
      var cur = s.sets[c.id] || {};
      s.sets[c.id] = Object.assign({}, c.local, { _server: cur._server, status: cur.status });
      queue(s, { op: cur._server ? 'put' : 'import', id: c.id, restoreOf: at });
      c.restoring = true;
      return write(s);
    },
    // 社長の判断（採用・差し替え・却下）を記録する。履歴は次の企画に渡す
    decide: function (id, status, reason, kind) {
      var s = read();
      var x = s.sets[id];
      if (!x) return null;
      if (status) { x.status = status; x.decidedAt = new Date().toISOString(); }
      // 採用・却下はサーバーの正本へ（更新番号つき。ほかの端末が先に変えていたら競合になり、最新を読み直す）
      if (status === 'adopted' || status === 'rejected') queue(s, { op: 'decide', id: id, decision: status === 'adopted' ? 'approve' : 'reject', reason: String(reason || '').slice(0, 200) });
      x.reason = String(reason || x.reason || '').slice(0, 120);
      s.history.unshift({ status: kind || (status === 'adopted' ? 'adopt' : status === 'rejected' ? 'reject' : 'revise'), pattern: x.pattern, title: x.title, reason: String(reason || '').slice(0, 100), at: Date.now() });
      s.history = s.history.slice(0, 60);
      return write(s) ? x : null;
    },
    history: function () { return read().history.slice(0, 30); },
    // 直近の企画パターン（同じ企画ばかりにしないため）
    recentPatterns: function () { return window.DeliveryStore.all().slice(0, 4).map(function (x) { return x.pattern; }); },
    // 前に出した商品（同じ商品を何度も出さないため）
    exclude: function () {
      var codes = [];
      window.DeliveryStore.all().forEach(function (x) { (x.items || []).forEach(function (it) { if (it.code) codes.push(it.code); }); });
      return { codes: codes.slice(0, 600), names: [] };
    },
    // 自律運営の制作ライン（企画→制作→監査→修正）の記録。投稿セットとは別に残す（保留・失敗の理由も日報に出すため）
    saveAuto: function (rec) {
      var s = read();
      s.auto = (Array.isArray(s.auto) ? s.auto : []).filter(function (x) { return x.id !== rec.id; });
      s.auto.unshift(rec);
      s.auto = s.auto.slice(0, 30);
      write(s);
      return rec;
    },
    autoRuns: function () { var a = read().auto; return Array.isArray(a) ? a : []; },
    autoGet: function (id) { return window.DeliveryStore.autoRuns().filter(function (x) { return x.id === id; })[0] || null; },
    // 確認待ち（サーバーの正本があるものは「公開待ち」だけを数える。控え・期限切れは数えない）
    pendingCount: function () { return window.DeliveryStore.all().filter(function (x) { return x.status === 'new' && !x.supersededBy && (!x._server || x._server.state === 'ready'); }).length; }
  };
})();
