// Instagram広報部：フォロー候補・コメント候補・実施状況を1つの画面で。
// 調べた事実：Instagramの公式API（今のアプリの「Instagramログイン」の方式）では、ハッシュタグ検索・他のアカウントの調査・第三者へのフォローやコメントは提供されていない。
// そのため、アプリが自動でするのは「探す場所の用意・分類・優先順位・重複の防止・コメント案・履歴」まで。フォローとコメントは社長がInstagramで行い、ここに記録する。
(function () {
  'use strict';

  var K = window.AppKit;
  var R = window.PrStore;
  if (!K || !R) return;
  var el = K.el;
  // 優先ジャンルと、毎日の「探す場所」に使うハッシュタグ（日ごとに入れ替える）
  var GENRES = [
    ['useful', '便利グッズ・生活雑貨', ['便利グッズ', '暮らしの道具', '生活雑貨', '暮らしを整える', '買ってよかったもの']],
    ['gadget', 'ガジェット', ['ガジェット', 'デスクツアー', 'デスク周り', 'ガジェット好き']],
    ['outdoor', 'キャンプ・アウトドア', ['キャンプギア', 'キャンプ道具', 'ソロキャンプ', 'アウトドアギア']],
    ['interior', 'インテリア', ['インテリア', '部屋づくり', 'インテリア雑貨', '一人暮らしインテリア']],
    ['fashion', 'ファッション', ['メンズファッション', '大人カジュアル', '30代コーデ', 'シンプルコーデ']],
    ['gift', 'ギフト・プレゼント', ['プレゼント選び', 'ギフト', '誕生日プレゼント', '贈り物']],
    ['brand', 'ブランド・メーカー公式', []]
  ];
  var GNAME = { theme: '今のテーマ' }; GENRES.forEach(function (g) { GNAME[g[0]] = g[1]; });
  var tabA = 'candidate'; var tabP = 'todo'; var genreF = '';
  var busy = {};
  var container = null;

  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function linkBtn(text, url, cls) { var a = el('a', cls || 'link-btn', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function today() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function isToday(iso) { return iso && new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10) === today(); }
  function within(iso, d) { return iso && Date.now() - new Date(iso).getTime() < d * 86400000; }
  function stamp(iso) { try { return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function stars(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n); }
  function companyLog(a) { if (window.CompanyStore) window.CompanyStore.addActivity(a); }

  // ---- 探す場所：今紹介している商品・企画から（固定のジャンルにしない。防災も特別扱いしない）＋ジャンルの探す場所（日替わり） ----
  var STOP = /^(送料無料|送料込み|ポイント|公式|楽天|日本製|メンズ|レディース|おしゃれ|人気|新作|限定|セット|対応|大容量|正規品)$/;
  function themeWords() {
    var words = [];
    currentThemes().forEach(function (t) {
      String(t).split(/[\s　・／\/、,]+/).forEach(function (w) {
        w = w.replace(/[0-9０-９]+(cm|mm|ml|g|L|個|枚|本|色|cm)?$/i, '').trim();
        if (w.length >= 2 && w.length <= 12 && !STOP.test(w) && /[ぁ-んァ-ヶ一-龯]/.test(w) && words.indexOf(w) === -1) words.push(w);
      });
    });
    return words.slice(0, 8);
  }
  function places() {
    var out = [];
    themeWords().forEach(function (w) {
      out.push({ genre: 'theme', label: '#' + w, url: 'https://www.instagram.com/explore/tags/' + encodeURIComponent(w) + '/' });
      out.push({ genre: 'theme', label: w + '（Googleで投稿を探す）', url: 'https://www.google.com/search?q=' + encodeURIComponent('site:instagram.com ' + w) });
    });
    var day = Math.floor(Date.now() / 86400000);
    GENRES.forEach(function (g, gi) {
      g[2].forEach(function (t, i) { if ((i + day + gi) % g[2].length < 1) out.push({ genre: g[0], label: '#' + t, url: 'https://www.instagram.com/explore/tags/' + encodeURIComponent(t) + '/' }); });
    });
    var brands = {};
    (window.PitchStore ? window.PitchStore.list('adopt') : []).forEach(function (p) { if (p.brand) brands[p.brand] = true; });
    Object.keys(brands).slice(0, 5).forEach(function (b) { out.push({ genre: 'brand', label: b + '（公式アカウントを探す）', url: 'https://www.google.com/search?q=' + encodeURIComponent('site:instagram.com ' + b + ' 公式') }); });
    return out;
  }

  // ---- 登録済みの参考アカウントを、フォロー候補に入れる（自動。重複は入れない） ----
  function importRefs() {
    var n = 0;
    if (window.ThiefStore) window.ThiefStore.accounts().forEach(function (a) { if (a.handle && !R.account(R.normHandle(a.handle))) { var themes = a.research && a.research.themes ? a.research.themes.join('・') : ''; if (!R.addAccount({ handle: a.handle, genre: '', reason: '社長が登録した参考アカウント' + (themes ? '（テーマ：' + themes + '）' : ''), priority: 2, source: '参考アカウント' }).dup) n++; } });
    return fetch('data/reference-accounts.json').then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }).then(function (d) {
      Object.keys((d && d.accounts) || {}).forEach(function (h) { var x = d.accounts[h]; if (x && x.status !== 'not_found' && !R.account(R.normHandle(h))) { var unknown = /見つから|未確認/.test(x.summary || '');
          // 調べても情報が見つからなかったアカウントは、内容を推測で書かない
          var res = R.addAccount({ handle: h, genre: '', reason: unknown ? '社長が登録した参考アカウント（Web上の情報は見つからず、内容は未確認）' : '参考アカウントの調査記録あり（' + (x.checkedAt || '') + '）' + (x.themes ? '：' + x.themes.slice(0, 2).join('・') : ''), priority: unknown ? 1 : 2, source: '参考アカウントの調査' }); if (res.account && !res.dup) n++; } });
      return n;
    });
  }

  // ---- 営業・交流担当AI（第2段階・2026-11-14）：コメント案 → コードの確認 → 監査AI（別のAI呼び出し）→ 修正（最大2回）→ 判定 ----
  // 使うのは、実在する投稿のURLと、確認できた投稿の文章だけ。文章のない投稿には作らない。送信はしない（社長がInstagramで行う）
  var MAX_REV = 2;
  var running = null; // 実行中の記録
  // 眼科医くまの今のテーマ：今紹介している商品（採用した商品）・投稿セットの企画・広げるの起点（固定のジャンルにしない）
  function currentThemes() {
    var out = [];
    var add = function (t) { t = String(t || '').replace(/[【\[].*?[】\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30); if (t && out.indexOf(t) === -1) out.push(t); };
    var D = window.DeliveryStore;
    if (D) D.all().filter(function (x) { return x.status !== 'rejected'; }).slice(0, 5).forEach(function (x) { add(x.titleEdit || x.title); });
    (window.PitchStore ? window.PitchStore.list('adopt') : []).slice(0, 8).forEach(function (p) { add(p.name); });
    var X = window.ExploreStore;
    if (X && X.roots) X.roots().slice(0, 3).forEach(function (n) { add(n.product && n.product.name); });
    return out.slice(0, 12);
  }
  function run_save(r) { R.saveRun(r); }
  function call(r, step, body) {
    r.steps.push({ name: step, status: 'running', at: new Date().toISOString() });
    run_save(r); paint();
    return K.postJson('api/pr', body).then(function (x) {
      var st = r.steps[r.steps.length - 1];
      if (x.data && Array.isArray(x.data.runs)) r.runs = r.runs.concat(x.data.runs);
      if (x.status !== 200 || !x.data || x.data.ok !== true) {
        st.status = 'failed';
        r.status = 'failed'; r.failedStep = (x.data && x.data.failedStep) || step; r.error = (x.data && x.data.error) || ('通信できませんでした（' + (x.status || '通信エラー') + '）');
        run_save(r); paint();
        return null;
      }
      st.status = 'ok'; run_save(r);
      return x.data;
    }, function () { var st = r.steps[r.steps.length - 1]; st.status = 'failed'; r.status = 'failed'; r.failedStep = step; r.error = '通信できませんでした'; run_save(r); paint(); return null; });
  }
  function slim(p) { return { id: p.id, url: p.url, handle: p.handle, caption: p.caption, source: p.source }; }
  function makeDrafts(ids) {
    if (!Array.isArray(ids)) ids = [ids];
    if (running) { K.showToast('いま営業・交流担当AIが作業中です'); return; }
    var all = R.posts();
    var posts = ids.map(function (id) { return all.filter(function (x) { return x.id === id; })[0]; }).filter(function (p) { return p && p.status === 'todo'; }).slice(0, 5);
    var noText = posts.filter(function (p) { return !p.caption || p.caption.length < 5; });
    posts = posts.filter(function (p) { return noText.indexOf(p) === -1; });
    noText.forEach(function (p) { R.updatePost(p.id, { draftError: '投稿の文章がないため、コメント案を作りません（内容を推測しない）。投稿の文章を貼ってください' }); });
    if (!posts.length) { K.showToast('投稿の文章がある候補がありません'); paint(); return; }
    var stop = window.AiUsage && window.AiUsage.blocked(2 + MAX_REV * 2);
    if (stop) { K.showToast(stop); return; }
    var themes = currentThemes();
    var past = R.pastComments();
    var r = { id: 'o' + Date.now().toString(36), at: new Date().toISOString(), status: 'running', posts: posts.map(function (p) { return p.id; }), themes: themes, steps: [], runs: [], result: {} };
    running = r;
    posts.forEach(function (p) { busy[p.id] = true; R.updatePost(p.id, { draftError: '', outreach: { runId: r.id, status: 'running', versions: [], revisions: 0 } }); });
    var cur = {}; // id → { draft, check }
    var revisions = {};
    function finish() {
      posts.forEach(function (p) {
        delete busy[p.id];
        var o = (R.posts().filter(function (x) { return x.id === p.id; })[0] || {}).outreach || {};
        if (o.status === 'running' || o.status === 'revise') { o.status = r.status === 'failed' ? 'failed' : 'hold'; o.why = r.status === 'failed' ? '失敗：' + r.failedStep + '（' + r.error + '）' : (o.why || '') + '（修正' + MAX_REV + '回でも合格にならなかった）'; }
        R.updatePost(p.id, { outreach: o, drafts: o.status === 'pass' && o.final ? [o.final] : [] });
        r.result[p.id] = o.status;
      });
      if (r.status !== 'failed') r.status = 'done';
      r.endedAt = new Date().toISOString();
      run_save(r); running = null; paint();
      K.showToast(r.status === 'failed' ? '営業・交流担当AIの作業が失敗しました：' + r.failedStep : '合格したコメント案：' + Object.keys(r.result).filter(function (k) { return r.result[k] === 'pass'; }).length + '件');
    }
    function store(id, patch, version) {
      var p = R.posts().filter(function (x) { return x.id === id; })[0];
      var o = Object.assign({}, p.outreach || {}, patch);
      if (version) o.versions = (o.versions || []).concat([version]);
      R.updatePost(id, { outreach: o });
      return o;
    }
    function audit(list) {
      return call(r, '監査AI：コメント案の採点（別のAI呼び出し）', { action: 'outreach_audit', posts: posts.filter(function (p) { return list.indexOf(p.id) !== -1; }).map(slim), drafts: list.map(function (id) { return cur[id].draft; }), past: past, revisions: revisions }).then(function (a) {
        if (!a) return finish();
        var again = [];
        (a.decisions || []).forEach(function (dc) {
          var au = (a.audits || []).filter(function (x) { return x.id === dc.id; })[0] || null;
          var ck = (a.checks || []).filter(function (x) { return x.id === dc.id; })[0] || cur[dc.id].check;
          var o = (R.posts().filter(function (x) { return x.id === dc.id; })[0] || {}).outreach || {};
          var vs = (o.versions || []).slice();
          if (vs.length) { vs[vs.length - 1] = Object.assign({}, vs[vs.length - 1], { audit: au, check: ck, decision: dc }); }
          store(dc.id, { versions: vs, status: dc.status, why: dc.why, final: dc.status === 'pass' ? cur[dc.id].draft.comment : '', score: au ? au.total : null, follow: cur[dc.id].draft.follow, followWhy: cur[dc.id].draft.followWhy, relevance: cur[dc.id].draft.relevance, relevanceWhy: cur[dc.id].draft.relevanceWhy, revisions: revisions[dc.id] || 0 });
          if (dc.status === 'revise' && (revisions[dc.id] || 0) < MAX_REV) again.push({ id: dc.id, comment: cur[dc.id].draft.comment, anchor: cur[dc.id].draft.anchor, why: dc.why, fixes: au ? au.fixes : [] });
        });
        if (!again.length) return finish();
        again.forEach(function (x) { revisions[x.id] = (revisions[x.id] || 0) + 1; });
        return draft(again.map(function (x) { return x.id; }), again);
      });
    }
    function draft(list, revise) {
      return call(r, revise ? '営業・交流担当AI：修正 ' + revisions[list[0]] + '回目' : '営業・交流担当AI：コメント案を作る', { action: 'outreach_draft', posts: posts.filter(function (p) { return list.indexOf(p.id) !== -1; }).map(slim), themes: themes, past: past, revise: revise || null }).then(function (d) {
        if (!d) return finish();
        var next = [];
        (d.drafts || []).forEach(function (x) {
          if (x.giveUp) { store(x.id, { status: 'hold', why: '追加の情報が必要（推測で補わない）：' + x.giveUp }); return; }
          var ck = (d.checks || []).filter(function (k) { return k.id === x.id; })[0] || null;
          cur[x.id] = { draft: x, check: ck };
          store(x.id, {}, { v: ((R.posts().filter(function (y) { return y.id === x.id; })[0] || {}).outreach || { versions: [] }).versions.length + 1, comment: x.comment, anchor: x.anchor, at: new Date().toISOString(), check: ck });
          next.push(x.id);
        });
        (d.skipped || []).forEach(function (x) { store(x.id, { status: 'hold', why: x.why }); });
        list.filter(function (id) { return next.indexOf(id) === -1 && !(d.drafts || []).some(function (x) { return x.id === id; }); }).forEach(function (id) { store(id, { status: 'hold', why: 'コメント案が返されなかった' }); });
        if (!next.length) return finish();
        return audit(next);
      });
    }
    paint();
    draft(posts.map(function (p) { return p.id; }), null);
  }

  function addFromForm(url, handle, caption, genre, reason) {
    var u = R.parseUrl(url);
    if (!u) { K.showToast('InstagramのプロフィールURLか投稿のURLを入れてください'); return false; }
    if (u.kind === 'account') {
      var r = R.addAccount({ handle: u.handle, genre: genre, reason: reason || '社長が追加' + (genre ? '（' + GNAME[genre] + '）' : ''), priority: genre === 'brand' ? 3 : 2, official: genre === 'brand', source: '社長が追加' });
      K.showToast(r.dup ? 'すでに候補にあります（同じアカウントは二重に入れません）' : 'フォロー候補に入れました');
    } else {
      var rp = R.addPost({ url: url, handle: handle, caption: caption, genre: genre, reason: reason || '社長が見つけた投稿', source: '社長が追加' });
      if (rp.error) { K.showToast(rp.error); return false; }
      if (rp.dup) { K.showToast('この投稿はすでに候補にあります'); return false; }
      // 投稿者もフォロー候補に入れて、コメントとフォローを同じアカウントでまとめて管理する
      if (R.normHandle(handle)) R.addAccount({ handle: handle, genre: genre, reason: 'コメント候補の投稿者', priority: 2, source: 'コメント候補から' });
      K.showToast('コメント候補に入れました' + (caption ? '。コメント案を作ります' : '（投稿の文章を貼ると、コメント案を作れます）'));
      if (caption) makeDrafts(rp.post.id);
    }
    return true;
  }

  // ---- 画面 ----
  function card(title) { var d = el('div', 'card'); d.appendChild(el('p', 'co-h', title)); return d; }
  function dashboard() {
    var c = card('広報ダッシュボード');
    var acc = R.accounts(); var posts = R.posts();
    var tiles = el('div', 'co-tiles');
    var made = acc.filter(function (a) { return isToday(a.addedAt); }).length + posts.filter(function (p) { return isToday(p.addedAt); }).length;
    var drafted = posts.filter(function (p) { return isToday(p.draftAt) && p.drafts.length; }).length;
    var commented7 = posts.filter(function (p) { return p.status === 'commented' && within(p.commentedAt, 7); }).length;
    var followed7 = acc.filter(function (a) { return a.status === 'followed' && within(a.followedAt, 7); }).length;
    [['今日の候補', made + '件', '目標10〜30件（候補づくりの目安。送信のノルマではない）'], ['今日のコメント案', drafted + '件', '投稿の文章から作成'], ['コメントした（7日）', commented7 + '件', '社長の申告'], ['フォローした（7日）', followed7 + '件', '社長の申告']].forEach(function (t) {
      var x = el('div', 'co-tile'); x.appendChild(el('p', 'co-tile-label', t[0])); x.appendChild(el('p', 'co-tile-value', t[1])); x.appendChild(el('p', 'co-tile-sub', t[2])); tiles.appendChild(x);
    });
    c.appendChild(tiles);
    // ジャンル別
    var rows = GENRES.map(function (g) {
      var a = acc.filter(function (x) { return x.genre === g[0]; }); var p = posts.filter(function (x) { return x.genre === g[0]; });
      return g[1] + '：フォロー候補' + a.filter(function (x) { return x.status === 'candidate'; }).length + '・フォロー済み' + a.filter(function (x) { return x.status === 'followed'; }).length + '・コメント済み' + p.filter(function (x) { return x.status === 'commented'; }).length;
    });
    var d = el('details', 'co-more'); d.appendChild(el('summary', null, 'ジャンル別の実施状況'));
    var ul = el('ul', 'co-facts'); rows.forEach(function (r) { ul.appendChild(el('li', null, r)); }); d.appendChild(ul);
    c.appendChild(d);
    // Instagramの数字（公式APIで取れるものだけ）
    var ig = el('div', 'pr-ig');
    ig.appendChild(el('p', 'hint', 'プロフィールアクセス・フォロワーの増減・リーチ：確認しています…'));
    c.appendChild(ig);
    K.postJson('api/ig', { action: 'status' }).then(function (r) {
      ig.innerHTML = '';
      if (r.status !== 200 || !r.data.ready) { ig.appendChild(el('p', 'hint', 'プロフィールアクセス・フォロワーの増減・リーチ・ROOMへの流入：未取得（Instagramの公式APIが未設定のため。ROOMへの流入は楽天側で取れるAPIがありません）')); return; }
      ig.appendChild(btn('Instagramの数字を取得（直近7日）', 'status-btn', function () {
        ig.appendChild(el('p', 'hint', '取得しています…'));
        K.postJson('api/ig', { action: 'insights', days: 7 }).then(function (x) {
          if (x.status !== 200 || !x.data.insights) { ig.appendChild(el('p', 'hint pitch-warn', '取得できませんでした：' + ((x.data && x.data.error) || ''))); return; }
          var m = x.data.insights.metrics || {};
          var v = function (k) { return m[k] == null ? '未取得' : typeof m[k] === 'object' ? (m[k].error ? '未取得' : JSON.stringify(m[k]).slice(0, 40)) : m[k]; };
          ig.appendChild(el('p', 'hint', '直近7日：リーチ ' + v('reach') + '・閲覧 ' + v('views') + '・プロフィールのリンクのタップ ' + v('profile_links_taps') + '・フォロー/解除 ' + v('follows_and_unfollows') + '｜フォロワー ' + ((x.data.account || {}).followers_count != null ? x.data.account.followers_count : '未取得')));
        });
      }));
    });
    c.appendChild(el('p', 'hint', '注意：数字の増減を、コメントやフォローの効果だと断定しません（投稿・季節・ほかの要因も重なるため）。期間を並べて傾向を見るだけにします。'));
    return c;
  }


  // ---- 自動発掘（AIが探す）：公式サイトのリンク・公式APIの投稿から、実在を確かめたものだけを候補に入れる ----
  var autoState = { status: null, running: '', last: null, missing: [], siteBrand: '', siteUrl: '' };
  function adoptedBrands() {
    var b = {};
    (window.PitchStore ? window.PitchStore.list('adopt') : []).forEach(function (p) { if (p.brand) b[p.brand] = true; });
    return Object.keys(b).slice(0, 40);
  }
  function loadStatus() {
    if (autoState.status) return;
    autoState.status = { loading: true };
    K.postJson('api/pr', { action: 'status' }).then(function (r) { autoState.status = r.status === 200 ? r.data : { error: true }; paint(); });
  }
  function runSites() {
    if (autoState.running) return;
    autoState.running = 'sites'; paint();
    K.postJson('api/pr', { action: 'sites', brands: adoptedBrands(), registered: R.sites() }).then(function (r) {
      autoState.running = '';
      if (r.status !== 200) { autoState.last = { error: (r.data && r.data.error) || '公式サイトを調べられませんでした' }; paint(); return; }
      var added = 0; var found = 0;
      (r.data.results || []).forEach(function (x) {
        (x.handles || []).forEach(function (h) {
          found++;
          var res = R.addAccount({ handle: h, genre: 'brand', official: true, priority: 3, auto: true, source: '公式サイトのリンク（自動）', reason: x.brand + 'の公式サイトがリンクしているアカウント', evidence: x.pageUrl || x.url, checkedAt: x.checkedAt });
          if (res.account && !res.dup) added++;
        });
      });
      autoState.last = { kind: 'sites', at: new Date().toISOString(), added: added, found: found, results: r.data.results || [] };
      autoState.missing = r.data.missing || [];
      companyLog({ type: 'pr-discover', label: '公式サイトからInstagramのアカウントを自動で探した（新しく' + added + '件）', status: 'done', by: 'ai' });
      K.showToast(added ? '実在を確かめたアカウントを' + added + '件、フォロー候補に入れました' : '新しいアカウントは見つかりませんでした');
      paint();
    });
  }
  function runRecent() {
    if (autoState.running) return;
    var handles = R.accounts().filter(function (a) { return a.status !== 'hidden'; }).sort(function (a, b) { return (b.priority || 0) - (a.priority || 0) || ((a.recentAt || '') < (b.recentAt || '') ? -1 : 1); }).slice(0, 8).map(function (a) { return a.handle; });
    if (!handles.length) { K.showToast('先にフォロー候補を入れてください'); return; }
    autoState.running = 'recent'; paint();
    K.postJson('api/pr', { action: 'recent', handles: handles, hours: 72 }).then(function (r) {
      autoState.running = '';
      if (r.status !== 200 || !r.data.ready) { autoState.last = { error: (r.data && (r.data.notice || r.data.error)) || '最近の投稿を取れませんでした' }; paint(); return; }
      var newIds = [];
      handles.forEach(function (h) { R.updateAccount(h, { recentAt: r.data.checkedAt }); });
      (r.data.accounts || []).forEach(function (a) {
        if (a.followers != null) R.updateAccount(a.handle, { followers: a.followers });
        a.posts.forEach(function (m) {
          var acc = R.account(a.handle) || {};
          var res = R.addPost({ url: m.url, handle: a.handle, caption: m.caption, genre: acc.genre || '', reason: '直近72時間の投稿' + (m.comments != null ? '・コメント' + m.comments + '件' : ''), source: 'Instagram公式API（自動）', auto: true, postedAt: m.timestamp, comments: m.comments, checkedAt: r.data.checkedAt });
          if (res.post && !res.dup) newIds.push(res.post.id);
        });
      });
      autoState.last = { kind: 'recent', at: r.data.checkedAt, added: newIds.length, errors: r.data.errors || [] };
      // コメント案は、新しい候補のうち5件まで自動で作る（AIの費用：1件あたり推定0.5円）
      if (newIds.length) makeDrafts(newIds.slice(0, 5));
      K.showToast(newIds.length ? 'コメント候補を' + newIds.length + '件入れました' : '直近72時間の新しい投稿はありませんでした');
      paint();
    });
  }
  function autoCard() {
    loadStatus();
    var c = card('営業・交流活動：自動で探す（公式に許された方法だけ）');
    var st = autoState.status || {};
    var acc = R.accounts(); var posts = R.posts();
    var tiles = el('div', 'co-tiles');
    [['自動で見つけた実在アカウント', acc.filter(function (a) { return a.auto; }).length + '件', '公式サイトのリンクで確認'], ['自動で作ったコメント候補', posts.filter(function (p) { return p.auto; }).length + '件', '公式APIで取得'], ['社長の手操作（1件あたり）', st.recent ? '2回' : '4〜5回', st.recent ? '開く→送信（候補探し・URLのコピーは不要）' : '探す→URLコピー→貼る→開く→送信']].forEach(function (t) {
      var x = el('div', 'co-tile'); x.appendChild(el('p', 'co-tile-label', t[0])); x.appendChild(el('p', 'co-tile-value', t[1])); x.appendChild(el('p', 'co-tile-sub', t[2])); tiles.appendChild(x);
    });
    c.appendChild(tiles);
    // 1. 公式サイト
    c.appendChild(el('p', 'co-title', '1. 採用した商品のブランドの公式サイトから探す（費用0円）'));
    c.appendChild(el('p', 'hint', '公式サイトがリンクしているInstagramだけを候補に入れます（リンクが無ければ入れません。Instagramのページは開きません）。対象：採用した商品のブランド ' + adoptedBrands().length + '件＋登録した公式サイト ' + Object.keys(R.sites()).length + '件'));
    c.appendChild(btn(autoState.running === 'sites' ? '公式サイトを調べています…' : '公式サイトから探す', 'btn btn-primary', runSites));
    if (autoState.missing.length) c.appendChild(el('p', 'hint', '公式サイトのURLが分からず調べなかったブランド：' + autoState.missing.slice(0, 10).join('・') + '（URLを1回登録すると、次から自動で調べます）'));
    var sb = el('input', 'input'); sb.placeholder = 'ブランド名（例：Harley of Scotland）'; sb.value = autoState.siteBrand; sb.addEventListener('input', function () { autoState.siteBrand = sb.value; });
    var su = el('input', 'input'); su.placeholder = '公式サイトのURL（https://…）'; su.value = autoState.siteUrl; su.addEventListener('input', function () { autoState.siteUrl = su.value; });
    var reg = el('details', 'co-more'); reg.appendChild(el('summary', null, '公式サイトを登録する（ブランドごとに1回だけ）'));
    reg.appendChild(sb); reg.appendChild(su);
    reg.appendChild(btn('登録する', 'status-btn', function () { if (R.setSite(autoState.siteBrand, autoState.siteUrl)) { autoState.siteBrand = ''; autoState.siteUrl = ''; K.showToast('登録しました。「公式サイトから探す」で調べます'); paint(); } else K.showToast('ブランド名と https:// で始まるURLを入れてください'); }));
    c.appendChild(reg);
    // 2. 公式API
    c.appendChild(el('p', 'co-title', '2. 候補アカウントの最近の投稿を集めて、コメント案まで作る（費用0円＋AI 1件約0.5円）'));
    if (st.recent) c.appendChild(btn(autoState.running === 'recent' ? '最近の投稿を集めています…' : '最近の投稿を集める（直近72時間）', 'btn btn-primary', runRecent));
    else c.appendChild(el('p', 'hint', st.loading ? '確認しています…' : '未設定：Instagramの公式API「Facebookログイン方式」の設定が必要です（無料。社長の作業は初回の1回だけ。手順は報告書を参照）。設定すると、ビジネス／クリエイターのアカウントの直近の投稿（URL・本文・コメント数）を自動で集め、コメント案まで作ります。個人のアカウントの投稿は、公式APIでは取れません。'));
    if (autoState.last) {
      var L = autoState.last;
      if (L.error) c.appendChild(el('p', 'hint pitch-warn', L.error));
      else if (L.kind === 'sites') {
        c.appendChild(el('p', 'hint', stamp(L.at) + '：公式サイト ' + L.results.length + '件を調べ、アカウント ' + L.found + '件を確認（新しく候補に ' + L.added + '件）'));
        L.results.filter(function (x) { return x.error; }).forEach(function (x) { c.appendChild(el('p', 'hint', x.brand + '：' + x.error)); });
      } else c.appendChild(el('p', 'hint', stamp(L.at) + '：新しいコメント候補 ' + L.added + '件' + (L.errors.length ? '（取れなかったアカウント ' + L.errors.length + '件：個人アカウント・存在しない名前など）' : '')));
    }
    return c;
  }

  function placesCard() {
    var c = card('探す場所（今紹介している商品・企画から自動で用意）');
    c.appendChild(el('p', 'hint', '今紹介している商品・投稿の企画から、言葉を選んで探す場所を用意します（固定のジャンルにしません）。公式APIでは、ハッシュタグや個人の投稿を自動で集められないため、開いて良い投稿を見つけたら、URLと投稿の文章を下の「候補に入れる」に貼ってください。今のテーマ：' + (currentThemes().slice(0, 5).join('／') || '（採用した商品・投稿セットがまだありません）')));
    var grid = el('div', 'pr-places');
    places().forEach(function (p) { var a = linkBtn(p.label, p.url, 'pr-place'); a.appendChild(el('span', 'pr-place-genre', GNAME[p.genre] || '')); grid.appendChild(a); });
    c.appendChild(grid);
    return c;
  }

  // 入力中の内容は、画面を描き直しても消えないように覚えておく
  var form = { url: '', handle: '', cap: '', genre: '', reason: '' };
  function bind(input, key) { input.value = form[key]; input.addEventListener('input', function () { form[key] = input.value; }); input.addEventListener('change', function () { form[key] = input.value; }); return input; }
  function addCard() {
    var c = card('営業・交流活動：候補に入れる（投稿のURLと文章を貼る）');
    var url = el('input', 'input'); url.placeholder = 'InstagramのプロフィールURL または 投稿のURL';
    var handle = el('input', 'input'); handle.placeholder = '投稿のとき：投稿者のアカウント名（@なしでOK）';
    var cap = el('textarea', 'input'); cap.rows = 3; cap.placeholder = '投稿のとき：投稿の文章を貼る（コメント案を作ります。見ていない内容は書きません）';
    var gs = el('select', 'select'); var o0 = el('option', null, 'ジャンルを選ぶ'); o0.value = ''; gs.appendChild(o0);
    GENRES.forEach(function (g) { var o = el('option', null, g[1]); o.value = g[0]; gs.appendChild(o); });
    var reason = el('input', 'input'); reason.placeholder = '選んだ理由（任意。例：コメント欄が活発・新作の紹介が丁寧）';
    [[url, 'url'], [handle, 'handle'], [cap, 'cap'], [gs, 'genre'], [reason, 'reason']].forEach(function (x) { c.appendChild(bind(x[0], x[1])); });
    c.appendChild(btn('候補に入れる', 'btn btn-primary', function () {
      var ok = addFromForm(form.url, form.handle, form.cap.trim(), form.genre, form.reason.trim());
      if (ok) { form = { url: '', handle: '', cap: '', genre: form.genre, reason: '' }; paint(); }
    }));
    return c;
  }

  function accountsCard() {
    var c = card('営業・交流活動：フォロー候補');
    var tabs = el('div', 'xp-filter');
    var acc = R.accounts();
    [['candidate', '候補'], ['followed', 'フォロー済み'], ['hidden', '興味なし']].forEach(function (t) { tabs.appendChild(btn(t[1] + '（' + acc.filter(function (a) { return a.status === t[0]; }).length + '）', 'xp-chip' + (tabA === t[0] ? ' active' : ''), function () { tabA = t[0]; paint(); })); });
    c.appendChild(tabs);
    var gt = el('div', 'xp-filter');
    gt.appendChild(btn('すべてのジャンル', 'xp-chip' + (!genreF ? ' active' : ''), function () { genreF = ''; paint(); }));
    GENRES.forEach(function (g) { gt.appendChild(btn(g[1], 'xp-chip' + (genreF === g[0] ? ' active' : ''), function () { genreF = g[0]; paint(); })); });
    c.appendChild(gt);
    var list = acc.filter(function (a) { return a.status === tabA && (!genreF || a.genre === genreF); }).sort(function (a, b) { return (b.priority || 0) - (a.priority || 0) || (a.addedAt < b.addedAt ? 1 : -1); });
    if (!list.length) c.appendChild(el('p', 'hint', tabA === 'candidate' ? '候補はありません。「今日の探す場所」から見つけて、URLを貼ってください。' : 'ありません。'));
    list.forEach(function (a) {
      var r = el('div', 'co-issue');
      r.appendChild(el('p', 'co-title', '@' + a.handle + (a.official ? '（公式）' : '')));
      r.appendChild(el('p', 'hint', '優先度 ' + stars(a.priority || 1) + '｜ジャンル：' + (GNAME[a.genre] || '未分類') + '｜' + a.source + '｜' + stamp(a.addedAt) + ' 追加'));
      if (a.reason) r.appendChild(el('p', 'hint', 'おすすめ理由：' + a.reason));
      // 営業・交流担当AIの評価（この人の投稿から。AIの評価で、実績ではない）
      var fs = R.posts().filter(function (p) { return p.handle === a.handle && p.outreach && p.outreach.follow != null; }).sort(function (x, y) { return y.outreach.follow - x.outreach.follow; })[0];
      if (fs) r.appendChild(el('p', 'hint', 'フォロー候補としての評価（AI）：' + fs.outreach.follow + '点・' + (fs.outreach.followWhy || '')));
      if (a.evidence) r.appendChild(el('p', 'hint', '根拠：' + a.evidence + (a.checkedAt ? '（' + stamp(a.checkedAt) + ' 確認）' : '')));
      var rc = R.recentContact(a.handle, 7);
      if (rc) r.appendChild(el('p', 'hint pitch-warn', '直近7日に' + (rc.type === 'comment' ? 'コメント' : 'フォロー') + '済み（' + stamp(rc.at) + '）。続けての営業は控えめに'));
      r.appendChild(el('p', 'hint', '状態：' + { candidate: '未フォロー', followed: 'フォロー済み（社長の申告）', hidden: '興味なし' }[a.status] + (a.followers != null ? '｜フォロワー ' + a.followers + '（公式API）' : '｜フォロワー数は未確認')));
      var row = el('div', 'pitch-row');
      row.appendChild(linkBtn('Instagramで開く', a.url, 'btn btn-secondary co-sbtn'));
      if (a.status === 'candidate') {
        row.appendChild(btn('フォローした', 'btn btn-primary co-sbtn', function () { R.setAccount(a.handle, 'followed'); companyLog({ type: 'follow', label: 'フォロー（社長が実施）', account: a.handle, url: a.url, status: 'sent', by: 'owner' }); paint(); }));
        row.appendChild(btn('興味なし', 'status-btn', function () { R.setAccount(a.handle, 'hidden'); paint(); }));
      } else row.appendChild(btn('候補に戻す', 'status-btn', function () { R.setAccount(a.handle, 'candidate'); paint(); }));
      var gsel = el('select', 'select pr-gsel'); var o = el('option', null, 'ジャンルを変える'); o.value = ''; gsel.appendChild(o);
      GENRES.forEach(function (g) { var x = el('option', null, g[1]); x.value = g[0]; if (g[0] === a.genre) x.selected = true; gsel.appendChild(x); });
      gsel.addEventListener('change', function () { if (gsel.value) { R.updateAccount(a.handle, { genre: gsel.value, official: gsel.value === 'brand' || a.official, priority: gsel.value === 'brand' ? 3 : a.priority }); paint(); } });
      row.appendChild(gsel);
      r.appendChild(row);
      c.appendChild(r);
    });
    return c;
  }

  var OSTATUS = { pass: '合格（コピーして使える）', revise: '修正中', hold: '保留', reject: '不合格・コメントしない方がよい', failed: '失敗' };
  function outreachView(p, o) {
    var box = el('div', 'pr-draft');
    box.appendChild(el('p', 'co-title', '営業・交流担当AIの案：' + (OSTATUS[o.status] || o.status) + (o.score != null ? '｜監査AI ' + o.score + '点' : '') + (o.revisions ? '｜修正' + o.revisions + '回' : '')));
    var last = (o.versions || [])[(o.versions || []).length - 1];
    if (o.status === 'pass' && o.final) {
      box.appendChild(el('p', 'pr-draft-text', o.final));
      box.appendChild(btn('コメントをコピー', 'btn btn-primary co-sbtn', function () { K.copyText(o.final).then(function () { K.showToast('コピーしました。Instagramで投稿を開いて、内容を確かめてから送ってください'); }, function () { K.showToast('コピーできませんでした'); }); }));
    } else if (last) box.appendChild(el('p', 'hint', '最後の案（合格していないのでコピーは出しません）：' + last.comment));
    if (o.why) box.appendChild(el('p', 'hint' + (o.status === 'pass' ? '' : ' pitch-warn'), o.why));
    if (o.relevance != null) box.appendChild(el('p', 'hint', '今のテーマとの関係：' + o.relevance + '点（' + (o.relevanceWhy || '') + '）｜フォロー候補として：' + (o.follow != null ? o.follow + '点（' + (o.followWhy || '') + '）' : '未評価') + '｜※AIの評価'));
    var det = el('details');
    det.appendChild(el('summary', null, '採点と修正の記録（' + (o.versions || []).length + '版）'));
    (o.versions || []).forEach(function (v) {
      det.appendChild(el('p', 'field-label', 'v' + v.v + '：' + v.comment + '（触れた点「' + (v.anchor || '') + '」）'));
      if (v.check) v.check.checks.forEach(function (k) { det.appendChild(el('p', 'hint' + (k.ok === false ? ' pitch-warn' : ''), (k.ok === true ? 'OK ' : k.ok === false ? 'NG ' : '未確認 ') + k.label + '：' + k.detail)); });
      if (v.audit) {
        det.appendChild(el('p', 'hint', '監査AI：' + v.audit.total + '点・提案 ' + v.audit.proposal + (v.audit.summary ? '｜' + v.audit.summary : '')));
        Object.keys(v.audit.scores || {}).forEach(function (k) { var sc = v.audit.scores[k]; det.appendChild(el('p', 'hint', sc.label + ' ' + sc.score + '/' + sc.max + (sc.deductions ? '｜減点：' + sc.deductions : ''))); });
        if ((v.audit.fixes || []).length) det.appendChild(el('p', 'hint', '修正指示：' + v.audit.fixes.join('／')));
      }
      if (v.decision) det.appendChild(el('p', 'hint', '判定（コード）：' + (OSTATUS[v.decision.status] || v.decision.status) + '｜' + v.decision.why));
    });
    box.appendChild(det);
    return box;
  }

  function postsCard() {
    var c = card('営業・交流活動：コメント候補（他の人の投稿）');
    var posts = R.posts();
    var waiting = posts.filter(function (p) { return p.status === 'todo' && p.caption && p.caption.length >= 5 && !(p.outreach && p.outreach.status); });
    c.appendChild(el('p', 'hint', '営業・交流担当AIがコメント案を作り、別のAI呼び出しの監査AIが採点します（80点以上・監査AIも合格・コードの確認もOKだけ合格。修正は2回まで）。投稿の文章がない候補には作りません。コメントとフォローは、社長がInstagramで行います。'));
    if (running) c.appendChild(el('p', 'hint pitch-busy', '営業・交流担当AIが作業中：' + ((running.steps[running.steps.length - 1] || {}).name || '準備')));
    else if (waiting.length) c.appendChild(btn('コメント案をまとめて作る（文章のある未対応 ' + Math.min(5, waiting.length) + '件）', 'btn btn-discover', function () { makeDrafts(waiting.slice(0, 5).map(function (p) { return p.id; })); }));
    var tabs = el('div', 'xp-filter');
    [['todo', '未対応'], ['commented', 'コメント済み'], ['skipped', '見送り']].forEach(function (t) { tabs.appendChild(btn(t[1] + '（' + posts.filter(function (p) { return p.status === t[0]; }).length + '）', 'xp-chip' + (tabP === t[0] ? ' active' : ''), function () { tabP = t[0]; paint(); })); });
    c.appendChild(tabs);
    var list = posts.filter(function (p) { return p.status === tabP && (!genreF || p.genre === genreF); }).sort(function (a, b) { return a.addedAt < b.addedAt ? 1 : -1; });
    if (!list.length) c.appendChild(el('p', 'hint', 'ありません。'));
    list.forEach(function (p) {
      var r = el('div', 'co-issue');
      r.appendChild(el('p', 'co-title', (p.handle ? '@' + p.handle : '投稿者：未入力') + '｜' + (GNAME[p.genre] || '未分類')));
      if (p.summary) r.appendChild(el('p', 'hint', '投稿の内容：' + p.summary + (p.caption.length > 80 ? '…' : '')));
      r.appendChild(el('p', 'hint', '選んだ理由：' + (p.reason || '—') + '｜' + (p.postedAt ? '投稿 ' + stamp(p.postedAt) + '｜' : '') + stamp(p.addedAt) + ' 追加｜' + p.source));
      var rc = R.recentContact(p.handle, 7);
      if (rc && p.status === 'todo') r.appendChild(el('p', 'hint pitch-warn', 'このアカウントには直近7日に' + (rc.type === 'comment' ? 'コメント' : 'フォロー') + '済みです（' + stamp(rc.at) + '）。続けてのコメントは控えましょう'));
      if (busy[p.id]) r.appendChild(el('p', 'hint pitch-busy', 'コメント案を作っています…'));
      var o = p.outreach;
      if (!p.caption && p.status === 'todo') r.appendChild(el('p', 'hint', '投稿の文章がないため、コメント案は作りません（内容を推測しないため）。Instagramで投稿を開き、文章をコピーして貼り直すと作れます。'));
      if (o && o.status && o.status !== 'running') r.appendChild(outreachView(p, o));
      else if (!o && (p.drafts || []).length) (p.drafts || []).forEach(function (d, i) {
        // 前の方式（監査なし）で作ったコメント案：残しておく（消さない）
        var dr = el('div', 'pr-draft');
        dr.appendChild(el('p', 'pr-draft-text', '前の方式の案' + (i + 1) + '（監査なし）：' + d));
        dr.appendChild(btn('コピー', 'status-btn co-sbtn', function () { K.copyText(d).then(function () { K.showToast('コピーしました。Instagramで内容を確かめてから送ってください'); }, function () { K.showToast('コピーできませんでした'); }); }));
        r.appendChild(dr);
      });
      if (p.draftError) r.appendChild(el('p', 'hint pitch-warn', p.draftError));
      var row = el('div', 'pitch-row');
      row.appendChild(linkBtn('Instagramで開く', p.url, 'btn btn-secondary co-sbtn'));
      if (p.status === 'todo') {
        row.appendChild(btn('コメントした', 'btn btn-primary co-sbtn', function () {
          var t = window.prompt('実際に送ったコメント（記録用。送った文面に直してください）', (p.outreach && p.outreach.final) || (p.drafts || [])[0] || '');
          if (t == null) return;
          R.setPost(p.id, 'commented', t.trim());
          companyLog({ type: 'comment', label: 'コメント（社長が送信）', account: p.handle, url: p.url, text: t.trim(), status: 'sent', by: 'owner' });
          paint();
        }));
        row.appendChild(btn('見送り', 'status-btn', function () { R.setPost(p.id, 'skipped'); paint(); }));
        if (p.caption && !running) row.appendChild(btn(p.outreach && p.outreach.status ? 'コメント案を作り直す' : 'コメント案を作る', 'status-btn', function () { makeDrafts([p.id]); }));
      } else if (p.status === 'commented') r.appendChild(el('p', 'hint', stamp(p.commentedAt) + ' コメント（社長の申告）：' + (p.commentedText || '')));
      r.appendChild(row);
      c.appendChild(r);
    });
    c.appendChild(el('p', 'hint', 'コメントの自動送信はしません（公式APIでは他のアカウントの投稿へのコメントが提供されていません）。自分の投稿へのコメントの返信は、公式APIで可能なので、Instagramの設定のあとに検討します（未実装）。'));
    return c;
  }

  function paint() {
    if (!container || !container.isConnected) return;
    var y = window.scrollY;
    container.innerHTML = '';
    // 営業・交流活動（第2段階）を先に：他の人の投稿へのコメント候補 → 候補の入れ方 → 探す場所 → 自動で探す → フォロー候補。実績（P0）はそのあと
    container.appendChild(dashboard());
    container.appendChild(postsCard());
    container.appendChild(addCard());
    container.appendChild(placesCard());
    container.appendChild(autoCard());
    container.appendChild(accountsCard());
    // P0：投稿ごとの実績（公式APIか社長の手入力。未取得は推測しない）
    if (window.PerfView) container.appendChild(window.PerfView.panel(paint));
    window.scrollTo(0, y);
  }
  var imported = false;
  function render(target) {
    container = target;
    paint();
    if (!imported) { imported = true; importRefs().then(function (n) { if (n) { K.showToast('登録済みの参考アカウント' + n + '件をフォロー候補に入れました'); paint(); } }); }
  }
  window.PrView = { render: render, places: places, GENRES: GENRES, liveRunId: function () { return running ? running.id : ''; } };
  var v = document.getElementById('pr-body');
  if (location.hash.indexOf('#pr') === 0 && v) render(v);
})();
