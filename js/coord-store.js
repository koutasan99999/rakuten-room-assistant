// AIコーデスタジオで作ったコーデの保存（このiPhoneのブラウザ内）。
// 保存するもの：コーデ名・起点の商品・条件（スタイル・季節・予算…）・3パターンの中身（AIの提案と、手で変えた内容）・
// Instagram投稿の状況・ROOM登録の状況。保存したあとも、開き直して自由に編集できる。
(function () {
  'use strict';

  var KEY = 'room-coords';
  var MAX = 30;

  function readAll() {
    try { var x = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(x) ? x : []; } catch (e) { return []; }
  }
  function writeAll(list) {
    // 容量が足りないときは古いものから減らして入れ直す
    for (var n = list.length; n > 0; n = Math.floor(n * 0.7)) {
      try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, n))); return true; } catch (e) {}
    }
    return false;
  }

  window.CoordStore = {
    list: function () {
      return readAll().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    },
    get: function (id) {
      return readAll().filter(function (c) { return c.id === id; })[0] || null;
    },
    save: function (view) {
      var list = readAll().filter(function (c) { return c.id !== view.id; });
      view.updatedAt = Date.now();
      list.unshift(JSON.parse(JSON.stringify(view)));
      return writeAll(list.slice(0, MAX));
    },
    remove: function (id) {
      writeAll(readAll().filter(function (c) { return c.id !== id; }));
    }
  };
})();
