// 「この商品から広げる」の記録（このiPhoneのブラウザ内。再読み込みしても残る）。既存の記録（room-pitch など）とは別のキーに保存し、既存のデータには触れない。
// node：探索した商品1つ（どの商品から・どの探し方で見つけたか＝親と関係を持つ）。results：商品ごと・探し方ごとの探索結果。
// 今見ている商品（current）から親をたどると、起点からの探索経路になる。
(function () {
  'use strict';

  var KEY = 'room-explore';
  var MAX_NODES = 300;
  var MAX_RESULTS = 120;

  function read() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    s = s && typeof s === 'object' ? s : {};
    s.nodes = s.nodes && typeof s.nodes === 'object' ? s.nodes : {};
    s.results = s.results && typeof s.results === 'object' ? s.results : {};
    s.current = s.current || '';
    s.seq = Number(s.seq) || 0;
    return s;
  }
  function write(s) {
    // 古い探索結果から消して、保存できる量に収める（商品と経路＝nodes は残す）
    for (var i = 0; i < 6; i++) {
      try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) {}
      var ks = Object.keys(s.results).sort(function (a, b) { return (s.results[a].savedAt || 0) - (s.results[b].savedAt || 0); });
      ks.slice(0, Math.max(1, Math.ceil(ks.length / 4))).forEach(function (k) { delete s.results[k]; });
    }
    return false;
  }
  function slim(p) {
    return {
      key: String(p.key || p.code || p.url || p.name || '').slice(0, 200), code: p.code || '', name: String(p.name || '').slice(0, 200), brand: p.brand || '', price: Number(p.price) || 0, postage: p.postage || '',
      url: p.url || '', image: p.image || '', shop: p.shop || '', caption: String(p.caption || '').slice(0, 300), category: p.category || '',
      relation: p.relation || '', similar: p.similar || '', differ: p.differ || '', feature: p.feature || '', tier: p.tier || '', group: p.group || '',
      reviewCount: p.reviewCount || 0, reviewAverage: p.reviewAverage || 0, byReviews: !!p.byReviews, pitch: String(p.pitch || '').slice(0, 300), fit: p.fit || ''
    };
  }
  function chain(s, id) {
    var out = [];
    var guard = 0;
    while (id && s.nodes[id] && guard++ < 50) { out.unshift(s.nodes[id]); id = s.nodes[id].parent; }
    return out;
  }

  window.ExploreStore = {
    // 起点の商品から探索を始める（同じ商品の起点がすでにあれば、それを開く）
    start: function (product, from) {
      var s = read();
      var p = slim(product);
      var same = Object.keys(s.nodes).map(function (k) { return s.nodes[k]; }).filter(function (n) { return !n.parent && n.product.key === p.key; })[0];
      if (same) { s.current = same.id; same.openedAt = Date.now(); write(s); return same; }
      s.seq += 1;
      var n = { id: 'n' + Date.now().toString(36) + s.seq, parent: '', mode: '', product: p, from: from || '', createdAt: Date.now(), openedAt: Date.now() };
      s.nodes[n.id] = n;
      s.current = n.id;
      this._trim(s);
      write(s);
      return n;
    },
    // 探索結果の商品から、さらに広げる（親と探し方・関係を残す）
    branch: function (parentId, product, mode) {
      var s = read();
      if (!s.nodes[parentId]) return null;
      var p = slim(product);
      var same = Object.keys(s.nodes).map(function (k) { return s.nodes[k]; }).filter(function (n) { return n.parent === parentId && n.product.key === p.key; })[0];
      if (same) { s.current = same.id; write(s); return same; }
      s.seq += 1;
      var n = { id: 'n' + Date.now().toString(36) + s.seq, parent: parentId, mode: mode || '', product: p, createdAt: Date.now(), openedAt: Date.now() };
      s.nodes[n.id] = n;
      s.current = n.id;
      this._trim(s);
      write(s);
      return n;
    },
    _trim: function (s) {
      var ks = Object.keys(s.nodes);
      if (ks.length <= MAX_NODES) return;
      // いちばん古い起点の木から消す（今見ている経路は残す）
      var keep = {};
      chain(s, s.current).forEach(function (n) { keep[n.id] = true; });
      ks.sort(function (a, b) { return (s.nodes[a].openedAt || 0) - (s.nodes[b].openedAt || 0); }).filter(function (k) { return !keep[k]; }).slice(0, ks.length - MAX_NODES)
        .forEach(function (k) { delete s.nodes[k]; Object.keys(s.results).forEach(function (r) { if (r.indexOf(k + ':') === 0) delete s.results[r]; }); });
    },
    current: function () { var s = read(); return s.nodes[s.current] || null; },
    setCurrent: function (id) { var s = read(); if (!id) { s.current = ''; write(s); return; } if (s.nodes[id]) { s.current = id; s.nodes[id].openedAt = Date.now(); write(s); } },
    get: function (id) { return read().nodes[id] || null; },
    // 起点から今の商品までの経路
    path: function (id) { var s = read(); return chain(s, id || s.current); },
    // 経路を文章にする（採用した商品に残す：どの商品から見つけたか）
    pathText: function (id, labels) {
      return this.path(id).map(function (n, i) { return (i ? '→（' + (labels[n.mode] || n.mode) + '）' : '') + String(n.product.name).replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 24); }).join(' ');
    },
    // 起点の一覧（最近開いた順）
    roots: function () {
      var s = read();
      return Object.keys(s.nodes).map(function (k) { return s.nodes[k]; }).filter(function (n) { return !n.parent; }).sort(function (a, b) { return (b.openedAt || 0) - (a.openedAt || 0); });
    },
    // この商品から広げた先（前に戻ったあと、また先へ進めるように）
    children: function (id) {
      var s = read();
      return Object.keys(s.nodes).map(function (k) { return s.nodes[k]; }).filter(function (n) { return n.parent === id; }).sort(function (a, b) { return (b.openedAt || 0) - (a.openedAt || 0); });
    },
    countUnder: function (id) {
      var s = read();
      var n = 0;
      Object.keys(s.nodes).forEach(function (k) { var c = chain(s, k); if (c.length > 1 && c[0].id === id) n++; });
      return n;
    },
    result: function (id, mode) { return read().results[id + ':' + mode] || null; },
    setResult: function (id, mode, r) {
      var s = read();
      s.results[id + ':' + mode] = Object.assign({ savedAt: Date.now() }, r);
      var ks = Object.keys(s.results);
      if (ks.length > MAX_RESULTS) ks.sort(function (a, b) { return s.results[a].savedAt - s.results[b].savedAt; }).slice(0, ks.length - MAX_RESULTS).forEach(function (k) { delete s.results[k]; });
      write(s);
    },
    // 前に見せた商品（同じ商品を何度も出さないため。今の経路の商品はサーバー側でも外す）
    shownCodes: function (id) {
      var s = read();
      var codes = [];
      Object.keys(s.results).forEach(function (k) { if (k.indexOf(id + ':') === 0) (s.results[k].items || []).forEach(function (it) { if (it.code) codes.push(it.code); }); });
      return codes.slice(0, 200);
    },
    slim: slim
  };
})();
