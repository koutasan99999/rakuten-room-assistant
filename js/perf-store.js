// P0（2026-11-13）：Instagramの投稿ごとの実績の記録（このiPhoneのブラウザ内。キー room-ig-perf。既存のデータには触れない）
// 実績＝Instagramの公式APIで取得した数字、または社長が手で入れた数字だけ。取れない数字は null（画面では「未取得」）。推測で埋めない。
// AIの事前の採点（preScore）は、実績とは別の項目に記録する。
// posts[id]：{ id, url, mediaId, postedAt, format, theme, setId, caption, hypothesis, preScore, snapshots:[{ id, at, timing, hours, source:'api'|'manual', metrics:{…} }] }
// account：アカウント全体の数字（フォロワー数、直近7日の閲覧・リーチのフォロワー／フォロワー以外）の記録
(function () {
  'use strict';

  var KEY = 'room-ig-perf';
  // 記録する指標（API：Instagramの公式APIで取れる見込み／手入力：APIでは取れないので社長が入れる）
  var METRICS = [
    { key: 'views', label: '閲覧', api: 'views' },
    { key: 'reach', label: 'リーチ', api: 'reach' },
    { key: 'nonFollowerPct', label: 'フォロワー以外の割合（%）', api: '', note: '投稿ごとの内訳はAPIで取れるか未確認。Instagramアプリの「インサイト」で見て入力' },
    { key: 'likes', label: 'いいね', api: 'likes' },
    { key: 'comments', label: 'コメント', api: 'comments' },
    { key: 'saves', label: '保存', api: 'saved' },
    { key: 'shares', label: 'シェア', api: 'shares' },
    { key: 'profileVisits', label: 'プロフィールへのアクセス', api: 'profile_visits' },
    { key: 'follows', label: 'フォロー（この投稿から）', api: 'follows' },
    { key: 'linkTaps', label: 'プロフィールのリンクのタップ', api: '', note: 'アカウント全体ではAPIで取れる。投稿ごとは手入力' },
    { key: 'roomClicks', label: 'ROOMへの流入（クリック）', api: '', note: '楽天にAPIがないため手入力' },
    { key: 'sales', label: '売上（円）', api: '', note: '楽天アフィリエイトの報告から手入力' }
  ];
  var FORMATS = { carousel: 'カルーセル', reel: 'リール', image: '画像1枚', story: 'ストーリー', other: 'その他' };

  function read() { var s; try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {} s = s && typeof s === 'object' ? s : {}; s.posts = s.posts && typeof s.posts === 'object' ? s.posts : {}; s.account = Array.isArray(s.account) ? s.account : []; return s; }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
  function now() { return new Date().toISOString(); }
  // URLを比べやすくする（https://www.instagram.com/p/XXXX/ の形に）
  function normUrl(u) {
    var m = String(u || '').match(/instagram\.com\/(?:[^/]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return m ? 'https://www.instagram.com/' + (m[1] === 'tv' ? 'reel' : m[1]) + '/' + m[2] + '/' : String(u || '').trim();
  }
  function num(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(/[,，%％円\s]/g, '')); return isFinite(n) && n >= 0 ? n : null; }
  // 公開からの時間で、測った時点を決める（24時間後・72時間後・7日後・それ以外）
  function timingOf(postedAt, at) {
    var h = postedAt ? (new Date(at).getTime() - new Date(postedAt).getTime()) / 3600000 : null;
    if (h == null || !isFinite(h)) return { timing: 'その他', hours: null };
    var t = h <= 36 ? '24時間後' : h <= 96 ? '72時間後' : h <= 240 ? '7日後' : 'それ以降';
    return { timing: t, hours: Math.round(h) };
  }

  var api = {
    KEY: KEY, METRICS: METRICS, FORMATS: FORMATS, normUrl: normUrl, num: num, timingOf: timingOf,
    all: function () { var s = read(); return Object.keys(s.posts).map(function (k) { return s.posts[k]; }).sort(function (a, b) { return String(b.postedAt || b.createdAt).localeCompare(String(a.postedAt || a.createdAt)); }); },
    get: function (id) { return read().posts[id] || null; },
    findByUrl: function (url) { var u = normUrl(url); return api.all().filter(function (p) { return p.url && normUrl(p.url) === u; })[0] || null; },
    // 投稿を登録（同じURLがあればそれを返す）
    add: function (p) {
      var s = read();
      var u = p.url ? normUrl(p.url) : '';
      var same = u && Object.keys(s.posts).map(function (k) { return s.posts[k]; }).filter(function (x) { return x.url && normUrl(x.url) === u; })[0];
      if (same) return { post: same, dup: true };
      var id = p.id || 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      var x = { id: id, url: u, mediaId: p.mediaId || '', postedAt: p.postedAt || '', format: FORMATS[p.format] ? p.format : 'other', theme: String(p.theme || '').slice(0, 80), setId: p.setId || '', caption: String(p.caption || '').slice(0, 200), hypothesis: String(p.hypothesis || '').slice(0, 200), preScore: p.preScore || null, createdAt: now(), snapshots: [] };
      s.posts[id] = x;
      write(s);
      return { post: x, dup: false };
    },
    update: function (id, patch) { var s = read(); if (!s.posts[id]) return null; Object.assign(s.posts[id], patch); write(s); return s.posts[id]; },
    // 数字を記録（空欄は null＝未取得）。source：'api' か 'manual'
    addSnapshot: function (id, metrics, source, at) {
      var s = read();
      var p = s.posts[id];
      if (!p) return null;
      at = at || now();
      var m = {};
      METRICS.forEach(function (d) { m[d.key] = num(metrics[d.key]); });
      var t = timingOf(p.postedAt, at);
      var snap = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), at: at, timing: t.timing, hours: t.hours, source: source === 'api' ? 'api' : 'manual', metrics: m };
      p.snapshots = (p.snapshots || []).concat([snap]).slice(-30);
      write(s);
      return snap;
    },
    // 最新の数字（指標ごとに、いちばん新しい記録の値と、その出どころ）
    latest: function (p, timing) {
      var out = {};
      (p.snapshots || []).filter(function (x) { return !timing || x.timing === timing; }).forEach(function (x) {
        METRICS.forEach(function (d) { if (x.metrics[d.key] != null) out[d.key] = { value: x.metrics[d.key], source: x.source, at: x.at, timing: x.timing }; });
      });
      return out;
    },
    addAccount: function (a) { var s = read(); s.account = s.account.concat([Object.assign({ at: now() }, a)]).slice(-60); write(s); },
    accountLog: function () { return read().account.slice(); },
    // 投稿セットで「Instagramに投稿した」を記録した投稿を、成績の記録に入れる（社長の記録をもとに。重複は入れない）
    syncFromSets: function () {
      var D = window.DeliveryStore;
      if (!D) return 0;
      var n = 0;
      D.all().forEach(function (set) {
        if (!set.igPost || !set.igPost.url) return;
        var r = api.add({ url: set.igPost.url, postedAt: set.igPost.at || '', format: 'carousel', theme: set.titleEdit || set.title, setId: set.id, caption: '' });
        if (!r.dup) n++;
        else if (!r.post.setId) api.update(r.post.id, { setId: set.id, theme: r.post.theme || set.titleEdit || set.title });
      });
      return n;
    },
    // 公式APIの結果を取り込む（URLで照合。記録にない投稿は新しく入れる）。取れなかった指標は null のまま
    importApi: function (data) {
      var res = { added: 0, snaps: 0, errors: 0 };
      (data.media || []).forEach(function (m) {
        var url = normUrl(m.permalink);
        var p = api.findByUrl(url);
        if (!p) { p = api.add({ url: url, mediaId: m.id, postedAt: m.timestamp, format: /REEL/i.test(m.type) ? 'reel' : /CAROUSEL/i.test(m.type) ? 'carousel' : /IMAGE/i.test(m.type) ? 'image' : 'other', theme: String(m.caption || '').split('\n').filter(function (l) { return l && !/【PR】/.test(l); })[0] || '', caption: m.caption }).post; res.added++; }
        else api.update(p.id, { mediaId: m.id, postedAt: p.postedAt || m.timestamp });
        var ins = m.insights || {};
        if (ins.error) res.errors++;
        var vals = {};
        METRICS.forEach(function (d) { if (d.api && ins[d.api] != null && typeof ins[d.api] !== 'object') vals[d.key] = ins[d.api]; });
        if (vals.likes == null && m.likes != null) vals.likes = m.likes;
        if (vals.comments == null && m.comments != null) vals.comments = m.comments;
        if (Object.keys(vals).length) { api.addSnapshot(p.id, vals, 'api', data.fetchedAt); res.snaps++; }
      });
      var ft = data.followType && data.followType.metrics;
      api.addAccount({ at: data.fetchedAt || now(), followers: data.account && data.account.followers_count != null ? data.account.followers_count : null, days: data.followType ? data.followType.days : 7, views: ft && ft.views && !ft.views.error ? ft.views : null, reach: ft && ft.reach && !ft.reach.error ? ft.reach : null, error: ft && ft.views && ft.views.error ? ft.views.error : '' });
      return res;
    },
    exportJson: function () { var s = read(); return { exportedAt: now(), key: KEY, note: '実績は公式APIまたは社長の手入力。null は未取得', posts: api.all(), account: s.account }; },
    exportCsv: function () {
      var head = ['投稿ID', 'URL', '投稿日時', '形式', 'テーマ', '投稿前のAI評価', '記録日時', '時点', '出どころ'].concat(METRICS.map(function (d) { return d.label; }));
      var rows = [head];
      api.all().forEach(function (p) {
        var base = [p.id, p.url, p.postedAt, FORMATS[p.format] || p.format, p.theme, p.preScore && p.preScore.score != null ? p.preScore.score : '未評価'];
        if (!(p.snapshots || []).length) rows.push(base.concat(['', '', ''], METRICS.map(function () { return '未取得'; })));
        (p.snapshots || []).forEach(function (x) { rows.push(base.concat([x.at, x.timing, x.source === 'api' ? 'API' : '手入力'], METRICS.map(function (d) { return x.metrics[d.key] == null ? '未取得' : x.metrics[d.key]; }))); });
      });
      return rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    }
  };
  window.PerfStore = api;
})();
