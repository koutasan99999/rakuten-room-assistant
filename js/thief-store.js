// 商品ドロボーの記録（このiPhoneのブラウザ内。画面を閉じても残る）：
// 登録したInstagramのアカウント（ID・投稿URL）と、そこで紹介されていた商品（社長の入力・スクリーンショットの読み取り）、楽天の候補。
// Instagramの画像・動画は保存しない。商品の写真は楽天の商品画像だけを使う。
(function () {
  'use strict';

  var KEY = 'room-thief';
  var NO_ID = '_posts'; // IDが分からない投稿URLだけの登録

  function read() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    s = s && typeof s === 'object' ? s : {};
    s.accounts = s.accounts && typeof s.accounts === 'object' ? s.accounts : {};
    s.products = s.products && typeof s.products === 'object' ? s.products : {};
    return s;
  }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // 「@id」「id」「https://www.instagram.com/id/」→ id。投稿URL → 投稿URL
  function parseInput(v) {
    var s = String(v || '').trim();
    var post = s.match(/^https:\/\/(?:www\.)?instagram\.com\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reel|tv)\/([A-Za-z0-9_-]{5,40})/);
    if (post) return { postUrl: 'https://www.instagram.com/' + post[2] + '/' + post[3] + '/', handle: post[1] ? post[1].toLowerCase() : '' };
    var m = s.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/) || s.match(/^@?([A-Za-z0-9._]{1,30})$/);
    if (m && !/^(p|reel|reels|tv|stories|explore)$/i.test(m[1])) return { handle: m[1].toLowerCase(), postUrl: '' };
    return null;
  }

  window.ThiefStore = {
    NO_ID: NO_ID,
    parseInput: parseInput,
    accounts: function () {
      var s = read();
      return Object.keys(s.accounts).map(function (k) {
        var a = s.accounts[k];
        a.count = Object.keys(s.products).filter(function (p) { return s.products[p].accountId === k; }).length;
        return a;
      }).sort(function (a, b) { return b.addedAt - a.addedAt; });
    },
    account: function (id) { return read().accounts[id] || null; },
    // アカウントを登録する（同じIDは1つ）。memo：どんなアカウントか
    addAccount: function (handle, memo) {
      var s = read();
      var id = handle || NO_ID;
      if (!s.accounts[id]) s.accounts[id] = { id: id, handle: handle, url: handle ? 'https://www.instagram.com/' + handle + '/' : '', memo: String(memo || '').slice(0, 80), addedAt: Date.now() };
      else if (memo) s.accounts[id].memo = String(memo).slice(0, 80);
      write(s);
      return s.accounts[id];
    },
    // 自動調査の状態と結果（status: pending 調査待ち／running 調査中／done 調査済み／insufficient 情報不足／error エラー／off 自動調査がオフ）
    setResearch: function (handle, r) {
      var s = read();
      var a = s.accounts[handle];
      if (!a) return null;
      a.research = Object.assign({}, a.research || {}, r, { updatedAt: Date.now() });
      write(s);
      return a;
    },
    // 投稿企画・商品選びに使う、参考アカウントのまとめ（調査済みのものだけ）
    insights: function () {
      var s = read();
      return Object.keys(s.accounts).map(function (k) { return s.accounts[k]; }).filter(function (a) { return a.research && a.research.status === 'done'; })
        .slice(0, 8).map(function (a) { return { handle: a.handle, memo: a.memo || '', themes: a.research.themes || [], angles: a.research.angles || [], learn: a.research.learn || [] }; });
    },
    removeAccount: function (id) {
      var s = read();
      delete s.accounts[id];
      Object.keys(s.products).forEach(function (k) { if (s.products[k].accountId === id) delete s.products[k]; });
      write(s);
    },
    products: function (accountId) {
      var p = read().products;
      return Object.keys(p).map(function (k) { return p[k]; }).filter(function (x) { return x.accountId === accountId; }).sort(function (a, b) { return b.addedAt - a.addedAt; });
    },
    product: function (id) { return read().products[id] || null; },
    // source: manual（社長が入力）／screenshot（スクリーンショットから読み取り）
    addProduct: function (accountId, p) {
      var s = read();
      var id = newId();
      s.products[id] = {
        id: id, accountId: accountId, postUrl: p.postUrl || '', name: String(p.name || '').slice(0, 120), brand: String(p.brand || '').slice(0, 40), model: String(p.model || '').slice(0, 30),
        aliases: (p.aliases || []).slice(0, 3), evidence: String(p.evidence || '').slice(0, 80), source: p.source || 'manual', addedAt: Date.now(), candidates: null, tried: [], pitchKey: ''
      };
      write(s);
      return s.products[id];
    },
    update: function (id, patch) { var s = read(); if (!s.products[id]) return null; Object.assign(s.products[id], patch); write(s); return s.products[id]; },
    removeProduct: function (id) { var s = read(); delete s.products[id]; write(s); }
  };
})();
