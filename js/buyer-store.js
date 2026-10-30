// バイヤー発掘便の記録（このiPhoneのブラウザ内）：届いた便と、商品ごとの評価（欲しい／知ってる／興味なし／投稿にする）。
// 評価は次の「発掘開始」で使う（知ってる・興味なし・投稿にした商品は出さない。知ってる・興味なしが多い種類は避け、欲しいが多い種類の近くを探す）。
(function () {
  'use strict';

  var KEY = 'room-buyer';
  var MAX_BATCHES = 10;
  var MAX_RATINGS = 600;
  var VERDICTS = { want: '欲しい', known: '知ってる', skip: '興味なし', post: '投稿にした' };

  function read() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    s = s || {};
    s.batches = Array.isArray(s.batches) ? s.batches : [];
    s.ratings = s.ratings && typeof s.ratings === 'object' ? s.ratings : {};
    return s;
  }
  function write(s) {
    for (var n = s.batches.length; n >= 0; n--) {
      try { localStorage.setItem(KEY, JSON.stringify({ batches: s.batches.slice(0, n), ratings: s.ratings })); return; } catch (e) {}
    }
  }
  function keyOf(p) { return String(p.key || p.code || p.url || p.name || '').slice(0, 200); }

  window.BuyerStore = {
    VERDICTS: VERDICTS,
    batches: function () { return read().batches; },
    addBatch: function (batch) {
      var s = read();
      s.batches.unshift(batch);
      s.batches = s.batches.slice(0, MAX_BATCHES);
      write(s);
    },
    rating: function (p) { var r = read().ratings[keyOf(p)]; return r ? r.verdict : ''; },
    // 評価を付ける（同じ評価をもう一度押すと取り消し）
    rate: function (p, verdict) {
      var s = read();
      var k = keyOf(p);
      if (s.ratings[k] && s.ratings[k].verdict === verdict) delete s.ratings[k];
      else s.ratings[k] = { verdict: verdict, name: String(p.name).slice(0, 120), brand: p.brand || '', kind: p.kind || '', price: p.price || 0, image: p.image || '', url: p.url || '', at: Date.now(), pick: p };
      var keys = Object.keys(s.ratings);
      if (keys.length > MAX_RATINGS) keys.sort(function (a, b) { return s.ratings[a].at - s.ratings[b].at; }).slice(0, keys.length - MAX_RATINGS).forEach(function (x) { delete s.ratings[x]; });
      write(s);
      return s.ratings[k] ? verdict : '';
    },
    list: function (verdict) {
      var r = read().ratings;
      return Object.keys(r).map(function (k) { return r[k]; }).filter(function (x) { return !verdict || x.verdict === verdict; }).sort(function (a, b) { return b.at - a.at; });
    },
    // 次の発掘に渡す評価のまとめ
    feedback: function (introduced) {
      var all = window.BuyerStore.list();
      var names = function (v) { return all.filter(function (x) { return x.verdict === v; }).map(function (x) { return x.name; }); };
      var count = {};
      all.forEach(function (x) { if (!x.kind) return; count[x.kind] = count[x.kind] || { good: 0, bad: 0 }; if (x.verdict === 'want' || x.verdict === 'post') count[x.kind].good++; else count[x.kind].bad++; });
      var kinds = Object.keys(count);
      return {
        wanted: names('want').slice(0, 30), known: names('known').slice(0, 120), skipped: names('skip').slice(0, 120), posted: names('post').slice(0, 60),
        introduced: (introduced || []).slice(0, 200),
        tiredKinds: kinds.filter(function (k) { return count[k].bad >= 2 && count[k].bad > count[k].good; }).slice(0, 20),
        likedKinds: kinds.filter(function (k) { return count[k].good >= 1; }).slice(0, 20)
      };
    }
  };
})();
