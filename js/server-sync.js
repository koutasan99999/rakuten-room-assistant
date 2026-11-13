// 自律運営とアプリのつなぎ（2026-11-14）：アプリを開いたとき（と、開いている間は10分ごと）に、
// 1. サーバーの状態・成果物（アプリを閉じている間にAI社員が作ったもの）を受け取り、このiPhoneの記録に入れる（重複は入れない・社長の判断は消さない）
// 2. 仕事を選ぶための情報（今のテーマ・採用済みの商品名・文章のある交流候補・過去のコメント）をサーバーへ送る
// サーバーの保存場所が未接続なら、何もしない（今までどおり、アプリを開いたときだけ動く）。
(function () {
  'use strict';

  var K = window.AppKit;
  var last = null;   // 最後に受け取った状態
  var busy = false;
  var listeners = [];

  function themes() {
    var out = [];
    var add = function (t) { t = String(t || '').replace(/[【\[].*?[】\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30); if (t && out.indexOf(t) === -1) out.push(t); };
    var D = window.DeliveryStore;
    if (D) D.all().filter(function (x) { return x.status !== 'rejected'; }).slice(0, 5).forEach(function (x) { add(x.titleEdit || x.title); });
    (window.PitchStore ? window.PitchStore.list('adopt') : []).slice(0, 8).forEach(function (p) { add(p.name); });
    var X = window.ExploreStore;
    if (X && X.roots) X.roots().slice(0, 3).forEach(function (n) { add(n.product && n.product.name); });
    return out.slice(0, 12);
  }
  function snapshot() {
    var R = window.PrStore; var A = window.AgentsStore;
    var posts = R ? R.posts().filter(function (p) { return p.status === 'todo' && p.caption && p.caption.length >= 5 && !(p.outreach && /^(pass|hold|reject|running)$/.test(p.outreach.status)); }) : [];
    var pending = A ? A.sessions().filter(function (x) { return x.origin === 'server' && x.status === 'done'; }).reduce(function (a, x) { return a + (x.candidates || []).filter(function (c) { return c.status === 'pass' && !c.owner; }).length; }, 0) : 0;
    var model = ''; try { model = localStorage.getItem('room-agents-model') || ''; } catch (e) {}
    return {
      themes: themes(),
      avoid: (window.PitchStore ? window.PitchStore.list('adopt') : []).slice(0, 30).map(function (p) { return p.name; }),
      past: R ? R.pastComments() : [],
      outreachPosts: posts.slice(0, 30).map(function (p) { return { id: p.id, url: p.url, handle: p.handle, caption: p.caption, source: p.source }; }),
      pendingBuyer: pending, auditModel: model
    };
  }

  // サーバーの成果物を、このiPhoneの記録に入れる
  function merge(st) {
    var A = window.AgentsStore; var R = window.PrStore;
    var n = { buyer: 0, outreach: 0 };
    if (A) (st.buyer || []).forEach(function (s) {
      var cur = A.get(s.id);
      if (cur && cur.status === 'done') return; // 取り込み済み（社長の判断を消さない）
      if (cur) (cur.candidates || []).forEach(function (c) { var t = (s.candidates || []).filter(function (x) { return x.id === c.id; })[0]; if (t && c.owner) t.owner = c.owner; });
      A.save(s); n.buyer++;
    });
    if (R) {
      var posts = R.posts();
      (st.outreach || []).slice().reverse().forEach(function (r) {
        var p = posts.filter(function (x) { return x.id === r.postId; })[0];
        if (!p || p.status !== 'todo') return;
        var o = p.outreach;
        if (o && o.runId === r.runId) return; // 取り込み済み
        if (o && /^(pass|hold|reject)$/.test(o.status) && o.runId && o.runId.indexOf('srv') !== 0) return; // アプリで作った新しい結果を上書きしない
        R.updatePost(p.id, { outreach: r.outreach, drafts: r.outreach.status === 'pass' && r.outreach.final ? [r.outreach.final] : [] });
        n.outreach++;
      });
      var have = {}; R.runs().forEach(function (x) { have[x.id] = true; });
      (st.outreachRuns || []).forEach(function (run) { if (!have[run.id]) R.saveRun(run); });
    }
    return n;
  }

  function refresh(force) {
    if (busy || !K) return Promise.resolve(last);
    busy = true;
    return K.postJson('api/worker', { action: 'state' }).then(function (r) {
      var st = r.status === 200 && r.data ? r.data : { configured: false, error: (r.data && r.data.error) || '通信できませんでした' };
      st.receivedAt = new Date().toISOString();
      if (st.configured && !st.error) {
        st.merged = merge(st);
        return K.postJson('api/worker', { action: 'sync', snapshot: snapshot() }).then(function (s) { st.syncedAt = s.status === 200 && s.data && s.data.ok ? s.data.at : ''; if (st.syncedAt) st.snapshotAt = st.syncedAt; return st; });
      }
      return st;
    }, function () { return { configured: false, error: '通信できませんでした', receivedAt: new Date().toISOString() }; }).then(function (st) {
      busy = false; last = st;
      listeners.forEach(function (fn) { try { fn(st); } catch (e) {} });
      return st;
    });
  }

  window.ServerSync = { refresh: refresh, status: function () { return last; }, on: function (fn) { listeners.push(fn); }, snapshot: snapshot };
  // アプリを開いたとき・開いている間は10分ごと
  setTimeout(function () { refresh(); }, 2500);
  setInterval(function () { if (!document.hidden) refresh(); }, 10 * 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && (!last || Date.now() - new Date(last.receivedAt).getTime() > 60000)) refresh(); });
})();
