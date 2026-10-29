// 投稿履歴を保存する部品（今はこのiPhoneのブラウザ内。DBに移すときはこの中身だけ差し替える）。
// 次に企画を考えるとき、直近10投稿と同じジャンル・型・価格帯・ターゲット・ブランドが続かないように使う。
//
// 1件のデータ:
// {
//   id, title, topic, subtitle, genre, postType, target, priceBand, brands: [],
//   products: [{ id, code, name, shortName, brand, price, url, image, intro, role }],（投稿順）
//   collectionName: ROOMのコレクション名、collectionDone: コレクションに入れたか
//   roomDone: { 商品id: true }（この投稿の商品のうちROOMに入れたもの）,
//   status: 'planned'（企画を選んだ）| 'generated'（画像を作った）| 'posted'（Instagram投稿済み）,
//   series: 表紙のシリーズ（must_buy など）、criteria: 2枚目に書いた選び方の基準
//   carouselDone / reelDone / storyDone: カルーセル・Reel・Story を作ったか
//   reel: { title, hook, cta, seconds, scenes, narration }、story: { hook, hookSub, title, points, text, sub }
//   metrics: 将来の記録用 { reach, saves, shares, profileVisits, roomClicks, sales }（今は空）
//   createdAt, updatedAt
// }
(function () {
  'use strict';

  var KEY = 'room-post-history';
  var MAX = 100;

  function readAll() {
    try {
      var data = JSON.parse(localStorage.getItem(KEY));
      return data && data.version === 1 && Array.isArray(data.posts) ? data.posts : [];
    } catch (e) { return []; }
  }
  function writeAll(posts) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, posts: posts.slice(0, MAX) }));
      return true;
    } catch (e) { return false; }
  }

  var FIELDS = ['title', 'topic', 'subtitle', 'genre', 'postType', 'target', 'priceBand', 'brands', 'products', 'status', 'collectionName', 'collectionDone', 'roomDone',
    'series', 'criteria', 'carouselDone', 'reelDone', 'storyDone', 'reel', 'story', 'metrics'];

  // 楽天ROOMのコレクション名の提案（Instagramのテーマとそろえて、ROOM内で迷わないように）
  function collectionNameFor(topic) {
    return String(topic || '').replace(/について本気出して考えてみた$/, '') + '｜本気出して考えてみた';
  }

  var PostHistory = {
    STATUS_LABELS: { planned: '企画を選んだ', generated: '画像を作った', posted: 'Instagram投稿済み' },

    collectionNameFor: collectionNameFor,

    get: function (id) {
      return Promise.resolve(readAll().filter(function (p) { return p.id === id; })[0] || null);
    },

    // 新しく記録して id を返す
    add: function (post) {
      var posts = readAll();
      var now = Date.now();
      var rec = {
        id: 'p' + now.toString(36) + Math.random().toString(36).slice(2, 6), status: 'planned', brands: [], products: [],
        carouselDone: false, reelDone: false, storyDone: false,
        metrics: { reach: null, saves: null, shares: null, profileVisits: null, roomClicks: null, sales: null },
        createdAt: now, updatedAt: now
      };
      FIELDS.forEach(function (k) { if (post[k] != null) rec[k] = post[k]; });
      posts.unshift(rec);
      return writeAll(posts) ? Promise.resolve(rec.id) : Promise.reject(new Error('保存できませんでした'));
    },

    // null を渡すと、その項目を空に戻せる（例：商品を選び直したときの reel / story）
    update: function (id, patch) {
      var posts = readAll();
      var rec = posts.filter(function (p) { return p.id === id; })[0];
      if (!rec) return Promise.resolve(false);
      FIELDS.forEach(function (k) { if (patch[k] !== undefined) rec[k] = patch[k]; });
      rec.updatedAt = Date.now();
      return Promise.resolve(writeAll(posts));
    },

    remove: function (id) {
      return Promise.resolve(writeAll(readAll().filter(function (p) { return p.id !== id; })));
    },

    // 新しい順
    list: function () {
      return Promise.resolve(readAll());
    },

    // 企画を考えるときに送る直近10件（実際に画像を作った・投稿したものを優先し、足りなければ選んだだけの企画も）
    recentForIdeas: function () {
      var posts = readAll();
      var made = posts.filter(function (p) { return p.status !== 'planned'; });
      var list = made.concat(posts.filter(function (p) { return p.status === 'planned'; })).slice(0, 10);
      return Promise.resolve(list.map(function (p) {
        return { topic: p.topic || p.title, genre: p.genre, postType: p.postType, target: p.target, priceBand: p.priceBand, brands: p.brands || [] };
      }));
    },

    exportAll: function () {
      return Promise.resolve({ version: 1, posts: readAll() });
    }
  };

  window.PostHistory = PostHistory;
})();
