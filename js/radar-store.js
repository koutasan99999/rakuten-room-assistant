// 新作・予約レーダーで見つけた商品を保存する部品（今はこのiPhoneのブラウザ内。DBに移すときはこの中身だけ差し替える）。
// 巡回するたびに同じ商品は1つにまとめ、初めて見つけた日（今日の新着）・価格や状態の変化（ウォッチリスト）を記録する。
//
// 1件のデータ:
// {
//   productId, name, brand, category（ジャンルid）, categoryLabel, price, imageUrl,
//   releaseDate, releaseMonth, releaseText, preorderStart, preorderEnd, restockDate,
//   status: ['PRE_ORDER', ...], source, sourceLabel, sourceUrl, rakutenUrl, code, shops: [{ name, url, price }],
//   score, createdAt（初めて見つけた日時）, updatedAt, lastSeenAt,
//   favorite（気になる）, usedForPost（企画に使った）, hidden（非表示）,
//   priceHistory: [{ at, price }], changes: [{ at, text }]（気になる商品の変化）
// }
(function () {
  'use strict';

  var KEY = 'room-radar-items';
  var SETTINGS_KEY = 'room-radar-settings';
  var MAX = 800;
  var DATE_KEYS = ['releaseDate', 'releaseMonth', 'releaseText', 'preorderStart', 'preorderEnd', 'restockDate'];
  var STATUS_TEXT = { PRE_ORDER: '予約受付が始まりました', RESTOCK: '再販・再入荷が見つかりました', COMING_SOON: '発売予定になりました', LIMITED: '限定の表記が付きました' };

  function readAll() {
    try {
      var data = JSON.parse(localStorage.getItem(KEY));
      return data && data.version === 1 && data.items ? data.items : {};
    } catch (e) { return {}; }
  }
  function writeAll(items) {
    // 多すぎるときは、気になる以外の古いものから消す
    var ids = Object.keys(items);
    if (ids.length > MAX) {
      ids.filter(function (id) { return !items[id].favorite; })
        .sort(function (a, b) { return items[a].lastSeenAt - items[b].lastSeenAt; })
        .slice(0, ids.length - MAX)
        .forEach(function (id) { delete items[id]; });
    }
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, items: items }));
      return true;
    } catch (e) { return false; }
  }

  var RadarStore = {
    // 巡回の結果を取り込む。戻り値：{ added: 新しく見つけた数, changed: 気になる商品で変化があった数 }
    merge: function (found, now) {
      now = now || Date.now();
      var items = readAll();
      var added = 0;
      var changed = 0;
      (found || []).forEach(function (it) {
        var cur = items[it.productId];
        if (!cur) {
          items[it.productId] = Object.assign({}, it, {
            createdAt: now, updatedAt: now, lastSeenAt: now, favorite: false, usedForPost: false, hidden: false,
            priceHistory: [{ at: now, price: it.price }], changes: []
          });
          added++;
          return;
        }
        var notes = [];
        if (it.price && it.price !== cur.price) {
          notes.push('価格が' + cur.price.toLocaleString('ja-JP') + '円 → ' + it.price.toLocaleString('ja-JP') + '円に変わりました');
          cur.priceHistory = (cur.priceHistory || []).concat([{ at: now, price: it.price }]).slice(-20);
          cur.price = it.price;
        }
        (it.status || []).forEach(function (s) {
          if ((cur.status || []).indexOf(s) === -1) {
            if (STATUS_TEXT[s]) notes.push(STATUS_TEXT[s]);
            cur.status = (cur.status || []).concat([s]);
          }
        });
        DATE_KEYS.forEach(function (k) {
          if (it[k] && it[k] !== cur[k]) {
            if (cur[k] && k !== 'releaseText') notes.push((k === 'preorderEnd' ? '予約締切' : k === 'preorderStart' ? '予約開始日' : '発売日') + 'が ' + it[k] + ' に変わりました');
            else if (!cur[k] && k === 'releaseDate') notes.push('発売日（' + it[k] + '）が分かりました');
            cur[k] = it[k];
          }
        });
        (it.shops || []).forEach(function (s) {
          if (!(cur.shops || []).some(function (x) { return x.url === s.url; })) cur.shops = (cur.shops || []).concat([s]);
        });
        ['score', 'brand', 'imageUrl', 'followedBrand'].forEach(function (k) { if (it[k] != null && it[k] !== '') cur[k] = it[k]; });
        cur.lastSeenAt = now;
        if (notes.length) {
          cur.updatedAt = now;
          if (cur.favorite) {
            cur.changes = (cur.changes || []).concat(notes.map(function (t) { return { at: now, text: t }; })).slice(-20);
            changed++;
          }
        }
      });
      writeAll(items);
      return Promise.resolve({ added: added, changed: changed });
    },

    list: function () {
      var items = readAll();
      return Promise.resolve(Object.keys(items).map(function (k) { return items[k]; }));
    },

    get: function (id) {
      return Promise.resolve(readAll()[id] || null);
    },

    // favorite / hidden / usedForPost を変える
    set: function (id, patch) {
      var items = readAll();
      if (!items[id]) return Promise.resolve(false);
      ['favorite', 'hidden', 'usedForPost'].forEach(function (k) { if (patch[k] != null) items[id][k] = !!patch[k]; });
      items[id].updatedAt = Date.now();
      return Promise.resolve(writeAll(items));
    },

    settings: function () {
      var s;
      try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) { s = null; }
      return Object.assign({ genres: null, brands: [], hiddenBrands: [], cursor: 0, round: 0, lastScanAt: 0 }, s || {});
    },
    saveSettings: function (s) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
    },

    exportAll: function () {
      return Promise.resolve({ version: 1, items: readAll(), settings: RadarStore.settings() });
    }
  };

  window.RadarStore = RadarStore;
})();
