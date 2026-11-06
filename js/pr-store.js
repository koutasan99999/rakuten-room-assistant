// Instagram広報部の記録（このiPhoneのブラウザ内。既存の保存データとは別のキー）。
// accounts：フォロー候補（アカウント名・URL・ジャンル・理由・優先度・状態＝候補／フォロー済み／興味なし）
// posts：コメント候補（投稿URL・投稿者・投稿の文章の抜粋・選んだ理由・コメント案・状態＝未対応／コメント済み／見送り）
// フォロー・コメントはアプリからは送らない（公式APIで第三者への操作は提供されていない）。「フォローした」「コメントした」は社長の申告として記録する。
(function () {
  'use strict';

  var KEY = 'room-pr';
  function read() {
    var s; try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    s = s && typeof s === 'object' ? s : {};
    s.accounts = s.accounts && typeof s.accounts === 'object' ? s.accounts : {};
    s.posts = s.posts && typeof s.posts === 'object' ? s.posts : {};
    s.log = Array.isArray(s.log) ? s.log : [];
    // 社長が登録したブランドの公式サイト（ブランド名→URL）。自動発掘で使う
    s.sites = s.sites && typeof s.sites === 'object' ? s.sites : {};
    return s;
  }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
  function now() { return new Date().toISOString(); }
  function log(s, type, x) { s.log.unshift({ at: now(), type: type, handle: x.handle || '', url: x.url || '', genre: x.genre || '', text: x.text || '' }); s.log = s.log.slice(0, 1000); }

  // URLから、アカウント名（プロフィールのURL）か投稿（/p/・/reel/）を読み取る
  function parseUrl(u) {
    var m = String(u || '').trim().match(/^https?:\/\/(?:www\.)?instagram\.com\/([^/?#]+)(?:\/([^/?#]+))?/i);
    if (!m) return null;
    if (/^(p|reel|reels|tv)$/i.test(m[1]) && m[2]) return { kind: 'post', code: m[2], url: 'https://www.instagram.com/' + m[1].toLowerCase().replace('reels', 'reel') + '/' + m[2] + '/' };
    if (/^(explore|stories|accounts|direct)$/i.test(m[1])) return null;
    var h = m[1].replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(h)) return null;
    if (m[2] && /^(p|reel)$/i.test(m[2])) return null;
    return { kind: 'account', handle: h, url: 'https://www.instagram.com/' + h + '/' };
  }
  function normHandle(h) { h = String(h || '').trim().replace(/^@/, '').toLowerCase(); return /^[a-z0-9._]{1,30}$/.test(h) ? h : ''; }

  var api = {
    parseUrl: parseUrl, normHandle: normHandle,
    // フォロー候補を足す（同じアカウントは足さない＝再表示しない。興味なしにしたものも残して、二度と候補に出さない）
    addAccount: function (a) {
      var s = read(); var h = normHandle(a.handle);
      if (!h) return { error: 'アカウント名が読み取れません' };
      if (s.accounts[h]) return { account: s.accounts[h], dup: true };
      var x = { handle: h, url: 'https://www.instagram.com/' + h + '/', genre: a.genre || '', reason: String(a.reason || '').slice(0, 120), priority: a.priority || 2, status: 'candidate', source: a.source || '社長が追加', official: !!a.official, addedAt: now(), auto: !!a.auto, evidence: String(a.evidence || '').slice(0, 300), checkedAt: a.checkedAt || '' };
      s.accounts[h] = x; log(s, 'add-account', x); write(s);
      return { account: x };
    },
    setAccount: function (h, status) {
      var s = read(); var x = s.accounts[h]; if (!x) return null;
      x.status = status; x[status + 'At'] = now(); log(s, 'account-' + status, x); write(s); return x;
    },
    updateAccount: function (h, patch) { var s = read(); var x = s.accounts[h]; if (!x) return null; Object.assign(x, patch); write(s); return x; },
    accounts: function () { var s = read(); return Object.keys(s.accounts).map(function (k) { return s.accounts[k]; }); },
    account: function (h) { return read().accounts[h] || null; },
    // コメント候補を足す（同じ投稿は足さない）
    addPost: function (p) {
      var s = read(); var u = parseUrl(p.url);
      if (!u || u.kind !== 'post') return { error: '投稿のURL（instagram.com/p/… か /reel/…）を入れてください' };
      if (s.posts[u.code]) return { post: s.posts[u.code], dup: true };
      var h = normHandle(p.handle);
      var x = { id: u.code, url: u.url, handle: h, caption: String(p.caption || '').slice(0, 1000), summary: String(p.caption || '').replace(/\s+/g, ' ').slice(0, 80), genre: p.genre || '', reason: String(p.reason || '').slice(0, 120), drafts: [], status: 'todo', addedAt: now(), source: p.source || '社長が追加', auto: !!p.auto, postedAt: p.postedAt || '', comments: p.comments == null ? null : Number(p.comments), checkedAt: p.checkedAt || '' };
      s.posts[u.code] = x; log(s, 'add-post', x); write(s);
      return { post: x };
    },
    updatePost: function (id, patch) { var s = read(); var x = s.posts[id]; if (!x) return null; Object.assign(x, patch); write(s); return x; },
    setPost: function (id, status, text) {
      var s = read(); var x = s.posts[id]; if (!x) return null;
      x.status = status;
      if (status === 'commented') { x.commentedAt = now(); x.commentedText = String(text || '').slice(0, 300); }
      log(s, 'post-' + status, { handle: x.handle, url: x.url, genre: x.genre, text: x.commentedText || '' }); write(s); return x;
    },
    posts: function () { var s = read(); return Object.keys(s.posts).map(function (k) { return s.posts[k]; }); },
    // 同じアカウントへの営業が重ならないように：直近 days 日にコメントした・フォローした記録
    recentContact: function (h, days) {
      if (!h) return null;
      var since = Date.now() - (days || 7) * 86400000;
      var s = read();
      var c = Object.keys(s.posts).map(function (k) { return s.posts[k]; }).filter(function (p) { return p.handle === h && p.status === 'commented' && new Date(p.commentedAt).getTime() > since; })[0];
      if (c) return { type: 'comment', at: c.commentedAt, url: c.url };
      var a = s.accounts[h];
      if (a && a.status === 'followed' && a.followedAt && new Date(a.followedAt).getTime() > since) return { type: 'follow', at: a.followedAt };
      return null;
    },
    sites: function () { return read().sites; },
    setSite: function (brand, url) {
      var s = read(); var b = String(brand || '').trim().slice(0, 40); var u = String(url || '').trim();
      if (!b || !/^https:\/\/[^\s]+$/.test(u)) return false;
      s.sites[b] = u.slice(0, 300); write(s); return true;
    },
    log: function () { return read().log; }
  };
  window.PrStore = api;
})();
