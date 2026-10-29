// ブランドのフォロー設定（新作・予約レーダーの「商品の取得」とは別に管理する）。
//
// 考え方：おすすめブランドは原則すべてフォロー。ユーザーは要らないブランドだけ外す。
// そのため「フォローしているブランド」ではなく「外したブランド」を保存する。
// → あとから追加されたブランドは自動でフォロー対象になる（ただし、そのジャンルを丸ごと外していれば対象にしない）
//
// 保存する内容（このiPhoneのブラウザ内）:
// { version: 2, excluded: [外したブランド], excludedGenres: [丸ごと外したジャンル], custom: [{ name, genre }],
//   checked: { ブランド名: 最後に新作を確認した日時 } }
//
// 検索の回数を抑えるため、1回の更新では「最後に確認してから時間がたっている」ブランドを数個ずつだけ探す。
(function () {
  'use strict';

  var KEY = 'room-brand-follow';
  var CACHE_MS = 12 * 60 * 60 * 1000; // 12時間以内に確認したブランドは探し直さない
  var PER_SCAN = 5;

  function read() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      return s && s.version === 2 ? s : null;
    } catch (e) { return null; }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }
  function lower(x) { return String(x || '').toLowerCase(); }

  // 画面に出すブランドの一覧（ジャンルのおすすめ＋自分で追加したもの）。同じブランドが複数のジャンルにあれば1つにまとめる
  function catalog(genres, s) {
    var map = {};
    var list = [];
    (genres || []).forEach(function (g) {
      (g.brands || []).forEach(function (b) {
        var k = lower(b);
        if (!map[k]) { map[k] = { name: b, genres: [], custom: false }; list.push(map[k]); }
        if (map[k].genres.indexOf(g.id) === -1) map[k].genres.push(g.id);
      });
    });
    ((s && s.custom) || []).forEach(function (c) {
      var k = lower(c.name);
      if (!map[k]) { map[k] = { name: c.name, genres: c.genre ? [c.genre] : [], custom: true }; list.push(map[k]); }
    });
    return list;
  }

  var BrandFollow = {
    CACHE_MS: CACHE_MS,

    // 初めて使うときの設定。以前の設定（レーダーの「フォロー中」「非表示」）があれば、その選び方を引き継ぐ（勝手に上書きしない）
    load: function (genres, legacy) {
      var s = read();
      if (s) return s;
      s = { version: 2, excluded: [], excludedGenres: [], custom: [], checked: {} };
      var followed = (legacy && legacy.brands) || [];
      var hidden = (legacy && legacy.hiddenBrands) || [];
      if (followed.length || hidden.length) {
        var keep = followed.map(lower);
        catalog(genres, s).forEach(function (b) {
          if (keep.indexOf(lower(b.name)) === -1) s.excluded.push(b.name);
        });
        hidden.forEach(function (b) { if (s.excluded.indexOf(b) === -1) s.excluded.push(b); });
        // 以前フォローしていて一覧にないブランドは、自分で追加したブランドとして残す
        followed.forEach(function (b) {
          if (!catalog(genres, s).some(function (c) { return lower(c.name) === lower(b); })) s.custom.push({ name: b, genre: '' });
        });
      }
      save(s);
      return s;
    },

    catalog: catalog,

    isFollowed: function (brand, s) {
      if (s.excluded.some(function (x) { return lower(x) === lower(brand.name); })) return false;
      // ジャンルを丸ごと外していれば、そのジャンルだけのブランドは対象にしない
      if (brand.genres.length && brand.genres.every(function (g) { return s.excludedGenres.indexOf(g) !== -1; })) return false;
      return true;
    },

    followed: function (genres, s) {
      return catalog(genres, s).filter(function (b) { return BrandFollow.isFollowed(b, s); }).map(function (b) { return b.name; });
    },

    // まとめて選ぶ・外す（names に入っているブランドだけ）
    setSelected: function (s, names, on) {
      names.forEach(function (n) {
        s.excluded = s.excluded.filter(function (x) { return lower(x) !== lower(n); });
        if (!on) s.excluded.push(n);
      });
      save(s);
    },

    // ジャンルを丸ごと外す／戻す（外したジャンルに、あとから追加されたブランドも対象にしない）
    setGenreExcluded: function (s, genre, on) {
      s.excludedGenres = s.excludedGenres.filter(function (g) { return g !== genre; });
      if (on) s.excludedGenres.push(genre);
      save(s);
    },

    addCustom: function (s, name, genre) {
      if (!s.custom.some(function (c) { return lower(c.name) === lower(name); })) s.custom.push({ name: name, genre: genre || '' });
      s.excluded = s.excluded.filter(function (x) { return lower(x) !== lower(name); });
      save(s);
    },

    // 今回の更新で探すブランド：フォロー中のうち、最後に確認してから時間がたっている順に数個
    pickForScan: function (genres, s, now, n) {
      now = now || Date.now();
      return BrandFollow.followed(genres, s)
        .filter(function (b) { return !s.checked[b] || now - s.checked[b] >= CACHE_MS; })
        .sort(function (a, b) { return (s.checked[a] || 0) - (s.checked[b] || 0); })
        .slice(0, n || PER_SCAN);
    },

    markChecked: function (s, names, now) {
      (names || []).forEach(function (b) { s.checked[b] = now || Date.now(); });
      save(s);
    },

    // 新作レーダーのリセットのとき：ブランドを確認した日時を消す（次の更新で探し直す）。フォローの設定は残す
    resetChecked: function (s) {
      s.checked = {};
      save(s);
    },

    lastChecked: function (s, name) {
      return s.checked[name] || 0;
    }
  };

  window.BrandFollow = BrandFollow;
})();
