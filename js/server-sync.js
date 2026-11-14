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
    var pending = A ? A.sessions().filter(function (x) { return x.origin === 'server' && x.status === 'done'; }).reduce(function (a, x) { return a + (x.candidates || []).filter(function (c) { return c.status === 'pass' && !c.owner && !c.usedIn; }).length; }, 0) : 0;
    var D = window.DeliveryStore;
    // 社長が見送った商品は、制作ラインに使わない
    var skip = [];
    if (A) A.sessions().forEach(function (x) { (x.candidates || []).forEach(function (c) { var v = c.versions && c.versions[c.versions.length - 1]; if (c.owner && c.owner.decision !== 'adopt' && v && v.data && v.data.code) skip.push(v.data.code); }); });
    var model = ''; try { model = localStorage.getItem('room-agents-model') || ''; } catch (e) {}
    return {
      themes: themes(),
      avoid: (window.PitchStore ? window.PitchStore.list('adopt') : []).slice(0, 30).map(function (p) { return p.name; }),
      past: R ? R.pastComments() : [],
      outreachPosts: posts.slice(0, 30).map(function (p) { return { id: p.id, url: p.url, handle: p.handle, caption: p.caption, source: p.source }; }),
      pendingBuyer: pending, auditModel: model,
      history: D ? D.history() : [], recentPatterns: D ? D.recentPatterns() : [],
      setCodes: D ? D.exclude().codes : [], skipCodes: skip.slice(0, 300), pendingSets: D ? D.pendingCount() : 0
    };
  }

  // サーバーの成果物を、このiPhoneの記録に入れる
  function merge(st) {
    var A = window.AgentsStore; var R = window.PrStore;
    var n = { buyer: 0, outreach: 0, sets: 0, production: 0 };
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
    // 制作ライン：合格した投稿セットを「社長の確認待ち」に入れる（社長の判断・既存の投稿セットは上書きしない）
    var D = window.DeliveryStore; var RT = window.RoomTextStore;
    if (D && D.saveAuto) (st.production || []).slice().reverse().forEach(function (rec) {
      if (D.autoGet(rec.id)) return; // 取り込み済み
      var set = rec.set;
      if (rec.result === 'pass' && set && !D.get(set.id)) {
        D.save(Object.assign({}, set, { status: 'new' }));
        if (RT) (set.roomTexts || []).forEach(function (t, i) { var it = set.items[i]; if (it && t.intro && !RT.peek(it)) RT.saveGenerated(it, t.intro, t.tags || [], set.title, t.tagsFrom || '商品のデータ'); });
        n.sets++;
      }
      // 使った合格候補に、引き継いだ記録を残す（バイヤーAIの画面で、どこへ渡ったか分かるように）
      if (A) (rec.source || []).forEach(function (c) {
        var s = A.get(c.sessionId); if (!s) return;
        var hit = false;
        (s.candidates || []).forEach(function (x) { if (x.id === c.candidateId && !x.usedIn) { x.usedIn = { prodId: rec.id, setId: set ? set.id : '', result: rec.result, why: rec.why || '', at: rec.endedAt || rec.at }; hit = true; } });
        if (hit) A.save(s);
      });
      var slim = Object.assign({}, rec); delete slim.set; slim.setId = set ? set.id : '';
      D.saveAuto(slim); n.production++;
    });
    return n;
  }

  // ---- サーバーの正本との同期（2026-11-14・段階1）：移行（冪等・照合つき）→ 送る予定を送る（更新番号つき）→ サーバーの内容を写す ----
  var SYNC_KEY = 'room-data-sync'; // この端末の識別子・移行の記録（端末のデータは消さない）
  function syncMeta() { var m; try { m = JSON.parse(localStorage.getItem(SYNC_KEY)); } catch (e) {} m = m && typeof m === 'object' ? m : {}; if (!m.deviceId) { m.deviceId = 'd' + Math.random().toString(36).slice(2, 10); saveMeta(m); } return m; }
  function saveMeta(m) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(m)); } catch (e) {} }
  function api(body) { return K.postJson('api/data', Object.assign({ deviceId: syncMeta().deviceId }, body)); }
  function migrate(D) {
    var m = syncMeta();
    if (m.migratedAt) return Promise.resolve({ already: true });
    var all = D.all().map(function (x) { var c = Object.assign({}, x); delete c._server; return c; });
    var ids = all.map(function (x) { return x.id; });
    var chunks = []; for (var i = 0; i < all.length; i += 10) chunks.push(all.slice(i, i + 10));
    var created = 0; var skipped = 0;
    return chunks.reduce(function (p, c) { return p.then(function () { return api({ action: 'import', sets: c }).then(function (r) { if (r.status !== 200 || !r.data.configured) throw new Error((r.data && (r.data.error || r.data.notice)) || '移行に失敗'); created += r.data.created.length; skipped += r.data.skipped.length; }); }); }, Promise.resolve())
      .then(function () { return api({ action: 'verify', ids: ids }); })
      .then(function (v) {
        if (v.status !== 200 || !v.data.ok) throw new Error('照合で足りない投稿セットがありました：' + ((v.data && v.data.missing) || []).join('、'));
        m = syncMeta(); m.migratedAt = new Date().toISOString(); m.migrated = { total: ids.length, created: created, skipped: skipped }; saveMeta(m);
        return { total: ids.length, created: created, skipped: skipped };
      });
  }
  function flush(D, notes) {
    var ops = D.outbox();
    return ops.reduce(function (p, op) {
      return p.then(function (stop) {
        if (stop) return true;
        var x = D.get(op.id);
        if (!x) { D.doneOp(op); return false; }
        var body = op.op === 'import' ? { action: 'import', sets: [Object.assign({}, x, { _server: undefined })] }
          : op.op === 'put' ? { action: 'put', id: op.id, expectedRev: x._server ? x._server.rev : 0, set: Object.assign({}, x, { _server: undefined, status: undefined }) }
          : { action: 'decide', id: op.id, expectedRev: x._server ? x._server.rev : 0, decision: op.decision, reason: op.reason };
        return api(body).then(function (r) {
          if (r.status === 200 && r.data.rec) { D.applyServer(r.data.rec); D.doneOp(op); return false; }
          if (r.status === 200 && op.op === 'import') { D.doneOp(op); return false; } // 取り込み済み（あとで一覧から写す）
          if (r.status === 409 && r.data.current) { D.applyServer(r.data.current); D.doneOp(op); notes.push('「' + String(x.title || op.id).slice(0, 20) + '」はほかの端末で先に変更されたため、最新の内容に入れ替えました' + (op.op === 'decide' ? '（判断はもう一度してください）' : '（この端末の変更はサーバーに控えとして残しています）')); return false; }
          if (r.status === 400) { D.doneOp(op); notes.push('送れなかった変更：' + ((r.data && r.data.error) || '')); return false; }
          return true; // 通信の失敗：残りは次に送る
        }, function () { return true; });
      });
    }, Promise.resolve(false));
  }
  function syncData() {
    var D = window.DeliveryStore;
    if (!D || !D.applyServer) return Promise.resolve(null);
    var notes = [];
    return migrate(D).then(function (mig) {
      return flush(D, notes).then(function () { return api({ action: 'list' }); }).then(function (r) {
        if (r.status !== 200 || !r.data.configured) return { error: (r.data && (r.data.error || r.data.notice)) || '一覧を読めませんでした', migration: mig, notes: notes };
        var pending = {}; D.outbox().forEach(function (op) { pending[op.id] = true; });
        r.data.sets.forEach(function (rec) { var local = D.get(rec.id); if (pending[rec.id]) return; if (!local || !local._server || local._server.rev !== rec.rev) D.applyServer(rec); });
        var m = syncMeta(); m.lastPullAt = new Date().toISOString(); saveMeta(m);
        return { ok: true, migration: mig, notes: notes, capacity: r.data.capacity, limits: r.data.limits, count: r.data.sets.length };
      });
    }).catch(function (e) { return { error: String(e && e.message || e), notes: notes }; });
  }

  function refresh(force) {
    if (busy || !K) return Promise.resolve(last);
    busy = true;
    return K.postJson('api/worker', { action: 'state' }).then(function (r) {
      var st = r.status === 200 && r.data ? r.data : { configured: false, error: (r.data && r.data.error) || '通信できませんでした' };
      st.receivedAt = new Date().toISOString();
      if (st.configured && !st.error) {
        st.merged = merge(st);
        return syncData().then(function (ds) { st.data = ds; if (ds && ds.notes && ds.notes.length && K.showToast) K.showToast(ds.notes[0]); }).then(function () {
          return K.postJson('api/worker', { action: 'sync', snapshot: snapshot() }).then(function (s) { st.syncedAt = s.status === 200 && s.data && s.data.ok ? s.data.at : ''; if (st.syncedAt) st.snapshotAt = st.syncedAt; return st; });
        });
      }
      return st;
    }, function () { return { configured: false, error: '通信できませんでした', receivedAt: new Date().toISOString() }; }).then(function (st) {
      busy = false; last = st;
      listeners.forEach(function (fn) { try { fn(st); } catch (e) {} });
      return st;
    });
  }

  window.ServerSync = { refresh: refresh, status: function () { return last; }, on: function (fn) { listeners.push(fn); }, snapshot: snapshot, syncData: syncData, syncMeta: syncMeta };
  // アプリを開いたとき・開いている間は10分ごと
  setTimeout(function () { refresh(); }, 2500);
  setInterval(function () { if (!document.hidden) refresh(); }, 10 * 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && (!last || Date.now() - new Date(last.receivedAt).getTime() > 60000)) refresh(); });
})();
