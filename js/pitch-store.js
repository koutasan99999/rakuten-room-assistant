// 「社長、これどうすか？」の記録（このiPhoneのブラウザ内。画面を閉じても残る）。
// 提案された商品と、社長の判断（いいじゃん！／保留／違うな）・理由・ROOM紹介文・ROOM登録の状態を持つ。
// 判断と理由は次の発掘に渡す（好みの学習）。一度出した商品は、判断の有無にかかわらず二度と提案しない。
(function () {
  'use strict';

  var KEY = 'room-pitch';
  var MAX_ITEMS = 500;
  var STATUS = { new: '未判断', adopt: 'いいじゃん！', hold: '保留', reject: '違うな' };

  function read() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    s = s && typeof s === 'object' ? s : {};
    s.items = s.items && typeof s.items === 'object' ? s.items : {};
    s.seq = Number(s.seq) || 0;
    s.tasteNote = String(s.tasteNote || '');
    s.seeded = !!s.seeded;
    return s;
  }
  // 保存できる量を超えたら、古い「違うな」から説明だけ削って入れ直す（商品番号と名前は残す＝同じ商品を出さないため）
  function write(s) {
    for (var i = 0; i < 3; i++) {
      try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) {}
      Object.keys(s.items).forEach(function (k) {
        var x = s.items[k];
        if (x.status === 'reject' || i > 0) { x.caption = ''; if (i > 1) { x.pitch = ''; x.image = ''; } }
      });
    }
    return false;
  }
  function keyOf(p) { return String(p.key || p.code || p.url || p.name || '').slice(0, 200); }
  // 同じ商品が別のショップで出ることがあるので、商品名の先頭でも重複を見る（lib/rakuten.js の nameKey と同じ考え方）
  function nameKey(name) { return String(name || '').replace(/[【\[（(].*?[】\]）)]/g, '').replace(/[\s　]/g, '').slice(0, 14); }
  function byOrder(a, b) { return a.order - b.order; }

  var api = {
    STATUS: STATUS,
    nameKey: nameKey,
    get: function (key) { return read().items[key] || null; },
    // 新しく届いた商品を足す（前に出した商品は足さない）。after を渡すと、その商品のすぐ後ろに並べる（もっと見せて）
    addMany: function (items, after) {
      var s = read();
      var names = {};
      Object.keys(s.items).forEach(function (k) { names[nameKey(s.items[k].name)] = true; });
      var base = after && s.items[after] ? s.items[after].order : null;
      var added = 0;
      (items || []).forEach(function (p, i) {
        var k = keyOf(p);
        if (!k || s.items[k] || names[nameKey(p.name)]) return;
        names[nameKey(p.name)] = true;
        s.seq += 1;
        s.items[k] = Object.assign({}, p, { key: k, status: 'new', reason: '', intro: '', room: '', order: base != null ? base + (i + 1) / 100 : s.seq, addedAt: Date.now() });
        added++;
      });
      var keys = Object.keys(s.items);
      if (keys.length > MAX_ITEMS) {
        keys.filter(function (k) { return s.items[k].status === 'reject'; }).sort(function (a, b) { return s.items[a].addedAt - s.items[b].addedAt; })
          .slice(0, keys.length - MAX_ITEMS).forEach(function (k) { delete s.items[k]; });
      }
      write(s);
      return added;
    },
    // 判断を記録する。いいじゃん！はROOM登録待ちにする
    decide: function (key, status, reason) {
      var s = read();
      var x = s.items[key];
      if (!x || !STATUS[status]) return null;
      x.status = status;
      x.reason = String(reason || '').slice(0, 120);
      x.decidedAt = Date.now();
      if (status === 'adopt' && !x.room) x.room = 'waiting';
      if (status !== 'adopt') x.room = '';
      write(s);
      return x;
    },
    update: function (key, patch) {
      var s = read();
      if (!s.items[key]) return null;
      Object.assign(s.items[key], patch);
      write(s);
      return s.items[key];
    },
    // まだ判断していない商品（プレゼンの順番待ち）
    queue: function () {
      var it = read().items;
      return Object.keys(it).map(function (k) { return it[k]; }).filter(function (x) { return x.status === 'new'; }).sort(byOrder);
    },
    list: function (status) {
      var it = read().items;
      return Object.keys(it).map(function (k) { return it[k]; }).filter(function (x) { return x.status === status; })
        .sort(function (a, b) { return (b.decidedAt || 0) - (a.decidedAt || 0); });
    },
    // サーバーで除いてもらう、前に出した商品
    exclude: function () {
      var it = read().items;
      var ks = Object.keys(it);
      return { codes: ks.map(function (k) { return it[k].code; }).filter(Boolean).slice(-600), names: ks.map(function (k) { return it[k].name; }).slice(-600) };
    },
    // 次の発掘に渡す好みの材料：判断した商品と理由（新しい順）
    taste: function () {
      var it = read().items;
      var hist = Object.keys(it).map(function (k) { return it[k]; }).filter(function (x) { return x.status !== 'new'; })
        .sort(function (a, b) { return (b.decidedAt || 0) - (a.decidedAt || 0); }).slice(0, 40)
        .map(function (x) { return { status: x.status, name: String(x.name).slice(0, 60), brand: x.brand || '', category: x.category || '', price: x.price || 0, reason: x.reason || '' }; });
      return { history: hist, note: read().tasteNote };
    },
    tasteNote: function () { return read().tasteNote; },
    setTasteNote: function (t) { var s = read(); if (t) { s.tasteNote = String(t).slice(0, 200); write(s); } },
    seeded: function () { return read().seeded; },
    markSeeded: function () { var s = read(); s.seeded = true; write(s); },
    // 同じ商品がほかに採用されていないか（ROOM登録前の重複の確認）
    duplicates: function (key) {
      var it = read().items;
      var x = it[key];
      if (!x) return [];
      return Object.keys(it).map(function (k) { return it[k]; }).filter(function (y) {
        return y.key !== key && y.status === 'adopt' && (y.code && y.code === x.code || nameKey(y.name) === nameKey(x.name));
      });
    }
  };
  window.PitchStore = api;
})();
