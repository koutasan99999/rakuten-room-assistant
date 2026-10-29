// AIで作った着用イメージの保存（このiPhoneのブラウザ内・IndexedDB）と、生成回数・料金の目安の記録。
// 同じ条件（同じ商品・背景・ポーズ・画質・パターン番号）で作った画像は保存してあるものを使い、もう一度お金をかけない。
(function () {
  'use strict';

  var DB = 'room-images';
  var STORE = 'images';
  var USAGE_KEY = 'room-image-usage';
  var memory = {}; // IndexedDB が使えないときの代わり（ページを閉じると消える）
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve) {
        try {
          var t = db.transaction(STORE, mode);
          var r = fn(t.objectStore(STORE));
          t.oncomplete = function () { resolve(r && 'result' in r ? r.result : undefined); };
          t.onerror = t.onabort = function () { resolve(undefined); };
        } catch (e) { resolve(undefined); }
      });
    });
  }

  function month() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function readUsage() {
    var u;
    try { u = JSON.parse(localStorage.getItem(USAGE_KEY)); } catch (e) {}
    u = u || {};
    if (u.month !== month()) u = { month: month(), count: 0, yen: 0, limit: u.limit || 20, log: [] };
    return u;
  }

  window.ImageStore = {
    // 条件から決まる鍵（同じ鍵なら同じ画像を使い回す）
    keyOf: function (parts) {
      var s = JSON.stringify(parts);
      var h = 0;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return 'img' + (h >>> 0).toString(36) + s.length.toString(36);
    },
    get: function (key) {
      if (memory[key]) return Promise.resolve(memory[key]);
      return tx('readonly', function (s) { return s ? s.get(key) : null; }).then(function (v) { return v || null; });
    },
    put: function (key, dataUrl) {
      memory[key] = dataUrl;
      return tx('readwrite', function (s) { return s ? s.put(dataUrl, key) : null; });
    },
    remove: function (key) {
      delete memory[key];
      return tx('readwrite', function (s) { return s ? s.delete(key) : null; });
    },
    usage: readUsage,
    setLimit: function (n) {
      var u = readUsage();
      u.limit = Math.max(0, Math.min(500, Math.round(Number(n) || 0)));
      try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch (e) {}
      return u;
    },
    // 生成した回数と料金の目安を記録する
    record: function (yen, model) {
      var u = readUsage();
      u.count += 1;
      u.yen += yen || 0;
      u.log = (u.log || []).concat([{ at: Date.now(), yen: yen || 0, model: model || '' }]).slice(-100);
      try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch (e) {}
      return u;
    }
  };
})();
