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
    return s;
  }
  function write(s) {
    // 古い却下から消して、保存できる量に収める
    for (var i = 0; i < 5; i++) {
      try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) {}
      var old = Object.keys(s.sets).filter(function (k) { return s.sets[k].status === 'rejected'; }).sort(function (a, b) { return s.sets[a].createdAt < s.sets[b].createdAt ? -1 : 1; })[0];
      if (!old) break;
      delete s.sets[old];
    }
    return false;
  }

  window.DeliveryStore = {
    STATUS: STATUS,
    all: function () {
      var st = read().sets;
      return Object.keys(st).map(function (k) { return st[k]; }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    },
    get: function (id) { return read().sets[id] || null; },
    save: function (set) {
      var s = read();
      s.sets[set.id] = Object.assign({ status: 'new' }, s.sets[set.id] || {}, set);
      write(s);
      return s.sets[set.id];
    },
    // 社長の判断（採用・差し替え・却下）を記録する。履歴は次の企画に渡す
    decide: function (id, status, reason, kind) {
      var s = read();
      var x = s.sets[id];
      if (!x) return null;
      if (status) { x.status = status; x.decidedAt = new Date().toISOString(); }
      x.reason = String(reason || x.reason || '').slice(0, 120);
      s.history.unshift({ status: kind || (status === 'adopted' ? 'adopt' : status === 'rejected' ? 'reject' : 'revise'), pattern: x.pattern, title: x.title, reason: String(reason || '').slice(0, 100), at: Date.now() });
      s.history = s.history.slice(0, 60);
      write(s);
      return x;
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
    pendingCount: function () { return window.DeliveryStore.all().filter(function (x) { return x.status === 'new' && !x.supersededBy; }).length; }
  };
})();
