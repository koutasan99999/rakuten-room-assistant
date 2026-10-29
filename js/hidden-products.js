// 「今後非表示」にした商品（このiPhoneのブラウザ内）。発掘・候補・新作レーダー・売れ筋・検索結果のどこでも出さない。
// 投稿管理の「非表示」タブで一覧を見て、表示に戻せる。
// 同じ商品の見分け：商品コード → URL（?より前）→ 商品名の先頭（記号・空白・【】を除いた24文字）
(function () {
  'use strict';

  var KEY = 'room-hidden-products';
  var MAX = 500;
  var cache = null;

  function nameKey(name) {
    return String(name || '').replace(/[【\[（(].*?[】\]）)]/g, '').replace(/[\s　・,，、。!！?？/／|｜]/g, '').toLowerCase().slice(0, 24);
  }
  function urlKey(url) { return String(url || '').replace(/[?#].*$/, ''); }
  function read() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { cache = []; }
    if (!Array.isArray(cache)) cache = [];
    return cache;
  }
  function write(list) {
    cache = list.slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {}
  }
  function match(h, p) {
    if (!p) return false;
    if (h.code && p.code && h.code === p.code) return true;
    var u = urlKey(p.url || p.rakutenUrl || p.sourceUrl);
    if (h.url && u && h.url === u) return true;
    var n = nameKey(p.name);
    return !!(h.nameKey && n && n.length >= 8 && h.nameKey === n);
  }

  window.HiddenProducts = {
    list: function () { return read().slice(); },
    isHidden: function (p) { return read().some(function (h) { return match(h, p); }); },
    // where: どこで非表示にしたか（画面の名前）
    add: function (p, where) {
      if (!p || !p.name || window.HiddenProducts.isHidden(p)) return;
      var list = read().slice();
      list.unshift({
        code: p.code || '', url: urlKey(p.url || p.rakutenUrl || p.sourceUrl), name: String(p.name).slice(0, 120), nameKey: nameKey(p.name),
        image: p.image || p.imageUrl || '', price: p.price || 0, shop: p.shop || ((p.shops || [])[0] || {}).name || '', where: where || '', at: Date.now()
      });
      write(list);
    },
    remove: function (p) { write(read().filter(function (h) { return !match(h, p) && h !== p; })); },
    filter: function (items) { return (items || []).filter(function (p) { return !window.HiddenProducts.isHidden(p); }); },
    // サーバーの検索でも避けてもらう分（新しい順に）
    refs: function (n) { return read().slice(0, n || 40).map(function (h) { return { code: h.code, name: h.name, url: h.url }; }); }
  };
})();
