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
  // 移行：端末の投稿セットを取り込み、サーバーの中身・判断・件数と照合する。差異があれば黙って成功にせず、端末の中身を競合の控えに残して知らせる（端末のデータは消さない）
  function migrate(D, notes) {
    var m = syncMeta();
    if (m.migratedAt) return Promise.resolve({ already: true });
    var all = D.all().map(function (x) { var c = Object.assign({}, x); delete c._server; return c; });
    var chunks = []; for (var i = 0; i < all.length; i += 10) chunks.push(all.slice(i, i + 10));
    var res = { total: all.length, created: 0, same: 0, different: [] };
    return chunks.reduce(function (p, c) { return p.then(function () { return api({ action: 'import', sets: c }).then(function (r) {
      if (r.status !== 200 || !r.data.configured) throw new Error('移行できませんでした（' + r.status + '：' + ((r.data && (r.data.error || r.data.notice)) || '通信できませんでした') + '）。端末のデータはそのまま残っています');
      res.created += r.data.created.length; res.same += r.data.same.length; res.different = res.different.concat(r.data.different || []);
    }); }); }, Promise.resolve())
      .then(function () { var cs = []; for (var j = 0; j < all.length; j += 20) cs.push(all.slice(j, j + 20)); return cs.reduce(function (p, c) { return p.then(function (acc) { return api({ action: 'verify', sets: c }).then(function (v) { if (v.status !== 200) throw new Error('照合できませんでした（' + v.status + '）。端末のデータはそのまま残っています'); acc.matched += v.data.matched; acc.missing = acc.missing.concat(v.data.missing); acc.different = acc.different.concat(v.data.different); return acc; }); }); }, Promise.resolve({ matched: 0, missing: [], different: [] })); })
      .then(function (v) {
        m = syncMeta();
        res.verified = { matched: v.matched, missing: v.missing, different: v.different };
        // 差異のある投稿セットは、この端末の中身を競合の控えに残す（サーバーの内容に入れ替わっても、あとで戻せる）
        v.different.forEach(function (d) { var x = D.get(d.id); if (x && !D.conflicts().some(function (c) { return c.id === d.id && c.kind === 'migration'; })) D.addConflict({ id: d.id, kind: 'migration', why: d.why, local: Object.assign({}, x) }); });
        if (v.missing.length) throw new Error('照合で、サーバーに無い投稿セットがありました：' + v.missing.join('、') + '。端末のデータはそのまま残っています');
        if (v.matched === all.length) { m.migratedAt = new Date().toISOString(); m.migrated = res; m.migrationIssue = null; }
        else { m.migrationIssue = { at: new Date().toISOString(), matched: v.matched, total: all.length, different: v.different }; notes.push('移行の照合で、中身や判断がサーバーと違う投稿セットが ' + v.different.length + '件ありました（この端末の中身は「同期の問題」に残しています。消していません）'); }
        saveMeta(m);
        return res;
      });
  }
  // 送る予定を順に送る。失敗の種類で分ける：
  //   409 競合 → この端末の中身を競合の控えに残してから、サーバーの最新に入れ替える（確認・復旧できる）
  //   400・404・422 → 直さないと送れない：消さずに「送れなかった変更」として残す（社長が もう一度送る／送らない を選ぶ）
  //   401・403・503 → 合言葉・設定の問題：止めて、すべて残す
  //   500台・通信の失敗 → 一時的：残して、次に自動で送る
  function flush(D, notes) {
    var ops = D.outbox();
    return ops.reduce(function (p, op) {
      return p.then(function (stop) {
        if (stop || op.blocked) return stop;
        var x = D.get(op.id);
        if (!x) { D.markOp(op, { blocked: { status: 0, error: 'この端末に投稿セットが見つかりません', at: new Date().toISOString() } }); return false; }
        var body = op.op === 'import' ? { action: 'import', sets: [Object.assign({}, x, { _server: undefined })] }
          : op.op === 'put' ? { action: 'put', id: op.id, expectedRev: x._server ? x._server.rev : 0, set: Object.assign({}, x, { _server: undefined, status: undefined }) }
          : { action: 'decide', id: op.id, expectedRev: x._server ? x._server.rev : 0, decision: op.decision, reason: op.reason };
        return api(body).then(function (r) {
          var st = r.status;
          if (st === 200 && r.data.rec) { if (!D.applyServer(r.data.rec)) return true; D.doneOp(op); return false; }
          if (st === 200 && op.op === 'import') {
            (r.data.different || []).forEach(function (d) { D.addConflict({ id: d.id, kind: 'import', why: d.why, local: Object.assign({}, x) }); notes.push('「' + String(x.title || op.id).slice(0, 20) + '」はサーバーの内容と違うため、この端末の中身を「同期の問題」に残しました'); });
            D.doneOp(op); return false;
          }
          if (st === 409 && r.data.current) {
            if (!D.addConflict({ id: op.id, kind: op.op, decision: op.decision || '', reason: op.reason || '', local: Object.assign({}, x), serverRev: r.data.current.rev })) return true; // 控えを保存できなければ、予定を消さない
            if (!D.applyServer(r.data.current)) return true;
            D.doneOp(op);
            notes.push('「' + String(x.title || op.id).slice(0, 20) + '」はほかの端末で先に変更されたため、最新の内容に入れ替えました（この端末の' + (op.op === 'decide' ? '判断' : '中身') + 'は「同期の問題」に残しています）');
            return false;
          }
          if (st === 400 || st === 404 || st === 422) { D.markOp(op, { blocked: { status: st, error: String((r.data && r.data.error) || '').slice(0, 200), at: new Date().toISOString() } }); notes.push('送れなかった変更があります（' + ((r.data && r.data.error) || st) + '）。「同期の問題」で確認してください'); return false; }
          if (st === 401 || st === 403 || st === 503) { notes.push('サーバーの合言葉・設定の問題で送れませんでした（' + st + '）。変更は端末に残っています'); return true; }
          D.markOp(op, { retry: { status: st, at: new Date().toISOString(), count: (op.retry ? op.retry.count : 0) + 1 } });
          return true; // 一時的な失敗：残りは次に送る
        }, function () { D.markOp(op, { retry: { status: 0, at: new Date().toISOString(), count: (op.retry ? op.retry.count : 0) + 1 } }); return true; });
      });
    }, Promise.resolve(false));
  }
  // 送れなかった変更を、もう一度送る（社長が選んだとき）／送らない（端末の中身は残る）
  function retryOp(op) { var D = window.DeliveryStore; D.markOp(op, { blocked: null, retry: null }); return syncData(); }
  function dropOp(op) { return window.DeliveryStore.doneOp(op); }
  function syncData() {
    var D = window.DeliveryStore;
    if (!D || !D.applyServer) return Promise.resolve(null);
    var notes = [];
    return migrate(D, notes).then(function (mig) {
      return flush(D, notes).then(function () { return api({ action: 'list' }); }).then(function (r) {
        if (r.status !== 200 || !r.data.configured) return { error: (r.data && (r.data.error || r.data.notice)) || '一覧を読めませんでした', migration: mig, notes: notes };
        var pending = {}; D.outbox().forEach(function (op) { pending[op.id] = true; });
        var failed = 0;
        r.data.sets.forEach(function (rec) {
          var local = D.get(rec.id); if (pending[rec.id]) return;
          if (!local || !local._server || local._server.rev !== rec.rev) { if (!D.applyServer(rec)) failed += 1; }
        });
        if (failed) notes.push('サーバーの内容 ' + failed + '件を端末に保存できませんでした（端末の保存容量）。サーバーの正本には残っています');
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

  window.ServerSync = { refresh: refresh, status: function () { return last; }, on: function (fn) { listeners.push(fn); }, snapshot: snapshot, syncData: syncData, syncMeta: syncMeta, retryOp: retryOp, dropOp: dropOp };
  // アプリを開いたとき・開いている間は10分ごと
  setTimeout(function () { refresh(); }, 2500);
  setInterval(function () { if (!document.hidden) refresh(); }, 10 * 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && (!last || Date.now() - new Date(last.receivedAt).getTime() > 60000)) refresh(); });
})();
