// 「この商品から広げる」の記録（このiPhoneのブラウザ内。再読み込みしても残る）。既存の記録（room-pitch など）とは別のキーに保存し、既存のデータには触れない。
// node：探索した商品1つ（どの商品から・どの探し方で見つけたか＝親と関係を持つ）。results：商品ごと・探し方ごとの探索結果。
// 今見ている商品（current）から親をたどると、起点からの探索経路になる。
// 2026-11-03 から：pools（商品ごとの探索結果の蓄積）。探すたびに「今の結果に追加」し、前の結果は消さない（明示的なリセットのときだけ空にし、控えを archive に残す）。
// 前の版の results（商品×探し方ごとの結果）は、そのまま残し、初めて開いたときに pools へ写す（互換性）。
(function () {
  'use strict';

  var KEY = 'room-explore';
  var MAX_NODES = 3000; // 上限は目安。探索した商品は自動では消さない
  var MAX_RESULTS = 120;

  function read() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    s = s && typeof s === 'object' ? s : {};
    s.nodes = s.nodes && typeof s.nodes === 'object' ? s.nodes : {};
    s.results = s.results && typeof s.results === 'object' ? s.results : {};
    s.pools = s.pools && typeof s.pools === 'object' ? s.pools : {};
    s.archive = s.archive && typeof s.archive === 'object' ? s.archive : {};
    s.current = s.current || '';
    s.seq = Number(s.seq) || 0;
    return s;
  }
  // 保存できる量を超えたときに消してよいのは、pools に写し終えた前の版の results と、リセットの控え（archive）だけ。pools と nodes は消さない
  function write(s) {
    for (var i = 0; i < 8; i++) {
      try { localStorage.setItem(KEY, JSON.stringify(s)); window.ExploreStore.lastWriteOk = true; return true; } catch (e) {}
      var legacy = Object.keys(s.results).filter(function (k) { return s.pools[k.split(':')[0]]; });
      if (legacy.length) { legacy.forEach(function (k) { delete s.results[k]; }); continue; }
      var arch = Object.keys(s.archive).sort(function (a, b) { return (s.archive[a].resetAt || 0) - (s.archive[b].resetAt || 0); });
      if (arch.length) { delete s.archive[arch[0]]; continue; }
      break;
    }
    window.ExploreStore.lastWriteOk = false;
    return false;
  }
  // 同じ商品か（商品番号・URL、または飾りを除いた商品名の先頭）
  function normName(n) { return String(n || '').normalize('NFKC').replace(/[【\[（(].*?[】\]）)]/g, '').replace(/送料無料|ポイント\d+倍|メンズ|レディース/g, '').replace(/[\s　・/|]/g, '').toLowerCase().slice(0, 16); }
  function samePro(a, b) { return a.code && a.code === b.code || a.url && a.url === b.url || normName(a.name) && normName(a.name) === normName(b.name); }
  // 前の版の results から pool を作る（古い順に足す。results は消さない）
  function poolOf(s, id) {
    if (s.pools[id]) return s.pools[id];
    var pool = { items: [], batches: [] };
    Object.keys(s.results).filter(function (k) { return k.indexOf(id + ':') === 0; }).sort(function (a, b) { return (s.results[a].savedAt || 0) - (s.results[b].savedAt || 0); }).forEach(function (k) {
      var r = s.results[k];
      if (r.error || !(r.items || []).length) return;
      mergeInto(pool, id, 'old' + pool.batches.length, k.split(':')[1], pool.items.length ? 'append' : 'new', r);
    });
    return pool.batches.length ? pool : null;
  }
  function mergeInto(pool, id, batchId, mode, kind, r) {
    if (pool.batches.some(function (b) { return b.id === batchId; })) return { added: 0, dup: 0, already: true };
    var no = pool.batches.length + 1;
    var added = 0; var dup = 0;
    (r.items || []).forEach(function (it) {
      if (pool.items.some(function (x) { return samePro(x, it); })) { dup++; return; }
      var look = it.look != null && r.looks && r.looks[it.look] ? r.looks[it.look] : null;
      var theme = it.theme != null && r.themes && r.themes[it.theme] ? r.themes[it.theme] : null;
      pool.items.push(Object.assign({}, it, { batch: batchId, batchNo: no, mode: mode, sourceNode: id, addedAt: Date.now(), axis: it.axis || mode, axisLabel: it.axisLabel || '', lookName: look ? look.name : '', lookConcept: look ? look.concept : '', themeTitle: theme ? theme.title : '', themeAngle: theme ? theme.angle : '' }));
      added++;
    });
    pool.batches.push({ id: batchId, no: no, mode: mode, kind: kind, at: r.at || new Date().toISOString(), added: added, dup: dup, notice: r.notice || '', searched: r.searched || [], themes: r.themes || [] });
    return { added: added, dup: dup };
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
    // 探索した商品・結果は自動では消さない（社長の指示：探索結果は蓄積する）。量の上限に近づいたら画面で知らせる
    _trim: function () {},
    size: function () { try { return (localStorage.getItem(KEY) || '').length; } catch (e) { return 0; } },
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
    // この商品の探索結果の蓄積（なければ null）。前の版の結果があれば、初回に写して保存する
    pool: function (id) {
      var s = read();
      if (!s.pools[id]) { var p = poolOf(s, id); if (p) { s.pools[id] = p; write(s); } return p; }
      return s.pools[id];
    },
    // 探索結果を「今の結果に追加」する（同じ商品は足さない。同じ検索の結果を二度足さない）。kind：new（最初・リセット後）／append（追加）
    addBatch: function (id, batchId, mode, kind, r) {
      var s = read();
      var pool = s.pools[id] || poolOf(s, id) || { items: [], batches: [] };
      var res = mergeInto(pool, id, batchId, mode, kind, r);
      s.pools[id] = pool;
      write(s);
      return res;
    },
    // 失敗した探索も記録する（結果は消さない）
    addError: function (id, batchId, mode, message) {
      var s = read();
      var pool = s.pools[id] || poolOf(s, id) || { items: [], batches: [] };
      if (!pool.batches.some(function (b) { return b.id === batchId; })) pool.batches.push({ id: batchId, no: pool.batches.length + 1, mode: mode, kind: 'error', at: new Date().toISOString(), added: 0, error: message });
      s.pools[id] = pool;
      write(s);
    },
    // 明示的なリセット：この商品の探索結果だけ空にする（控えは archive に残す。採用の記録・ほかの商品の結果・枝分かれ先には触れない）
    reset: function (id) {
      var s = read();
      var pool = s.pools[id] || poolOf(s, id);
      if (pool) s.archive[id] = Object.assign({ resetAt: Date.now() }, pool);
      s.pools[id] = { items: [], batches: [], resetAt: Date.now() };
      write(s);
    },
    // 前に見せた商品（同じ商品を何度も出さないため、サーバーに渡す）
    shownCodes: function (id) {
      var p = this.pool(id);
      return p ? p.items.map(function (it) { return it.code; }).filter(Boolean).slice(-300) : [];
    },
    shownNames: function (id) {
      var p = this.pool(id);
      return p ? p.items.map(function (it) { return it.name; }).slice(-300) : [];
    },
    slim: slim
  };
})();
