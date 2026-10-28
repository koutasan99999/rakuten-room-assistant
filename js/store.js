// 商品の投稿状態（ROOM・Instagram）を保存する部品。
//
// 今はこのiPhone（ブラウザ）の中だけに保存している。画面側は必ずこの ProductStore を通して
// 読み書きし、どのメソッドも Promise を返すので、将来サーバーのDBに移すときは
// この中身を「APIを呼ぶ処理」に差し替えるだけで画面側は変えずに済む。
//
// 1件のデータ（DBに移すときもこの形のまま1行にできる）:
// {
//   id: 楽天の商品コード（例 "shop:10001234"）。無いときは商品URL
//   status: 下の STATUSES のどれか
//   name, price, url, image, shop, code: 商品情報（発掘したときの内容を保存）
//   intro: ROOM紹介文 / reason: 選定理由 / role: 役割
//   createdAt, updatedAt: 保存・更新した日時（ミリ秒）
// }
(function () {
  'use strict';

  var STORAGE_KEY = 'room-product-store';
  var SCHEMA_VERSION = 1;

  var STATUSES = [
    { id: 'none', label: '未選択' },
    { id: 'room_candidate', label: 'ROOM候補' },
    { id: 'room_posted', label: 'ROOM投稿済み' },
    { id: 'ig_waiting', label: 'Instagram投稿待ち' },
    { id: 'ig_posted', label: 'Instagram投稿済み' }
  ];
  var STATUS_IDS = STATUSES.map(function (s) { return s.id; });

  // 保存する商品情報（画面用の一時的な項目は保存しない）
  var PRODUCT_FIELDS = ['name', 'code', 'price', 'url', 'image', 'shop', 'intro', 'reason', 'why', 'role'];

  function productId(p) {
    return String((p && (p.code || p.url)) || '');
  }

  function readAll() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && data.version === SCHEMA_VERSION && data.items) return data.items;
    } catch (e) {}
    return {};
  }

  function writeAll(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, items: items }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function pickFields(p) {
    var out = {};
    PRODUCT_FIELDS.forEach(function (k) { if (p[k] != null && p[k] !== '') out[k] = p[k]; });
    return out;
  }

  var ProductStore = {
    STATUSES: STATUSES,

    statusLabel: function (status) {
      var s = STATUSES.filter(function (x) { return x.id === status; })[0];
      return s ? s.label : '未選択';
    },

    // 1商品の状態（保存されていなければ 'none'）
    getStatus: function (product) {
      var item = readAll()[productId(product)];
      return Promise.resolve(item ? item.status : 'none');
    },

    // 状態を変える。'none' にすると一覧から外す
    setStatus: function (product, status) {
      var id = productId(product);
      if (!id || STATUS_IDS.indexOf(status) === -1) return Promise.reject(new Error('invalid'));
      var items = readAll();
      var now = Date.now();
      if (status === 'none') {
        delete items[id];
      } else {
        var prev = items[id] || { createdAt: now };
        var next = pickFields(product);
        Object.keys(prev).forEach(function (k) { if (next[k] == null) next[k] = prev[k]; });
        next.id = id;
        next.status = status;
        next.createdAt = prev.createdAt || now;
        next.updatedAt = now;
        items[id] = next;
      }
      return writeAll(items) ? Promise.resolve(status) : Promise.reject(new Error('保存できませんでした'));
    },

    // 指定した状態の商品一覧（新しく更新した順）。status を省略すると全件
    list: function (status) {
      var items = readAll();
      var list = Object.keys(items).map(function (k) { return items[k]; })
        .filter(function (x) { return !status || x.status === status; })
        .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      return Promise.resolve(list);
    },

    // 状態ごとの件数
    counts: function () {
      var items = readAll();
      var counts = {};
      STATUS_IDS.forEach(function (s) { counts[s] = 0; });
      Object.keys(items).forEach(function (k) { counts[items[k].status] = (counts[items[k].status] || 0) + 1; });
      return Promise.resolve(counts);
    },

    // DBへ移すときや予備の控え用に、保存内容をまとめて取り出す
    exportAll: function () {
      return Promise.resolve({ version: SCHEMA_VERSION, items: readAll() });
    }
  };

  window.ProductStore = ProductStore;
})();
