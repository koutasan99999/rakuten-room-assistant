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
      setCodes: D ? D.exclude().codes : [], skipCodes: skip.slice(0, 300), pendingSets: D ? D.pendingCount() : 0,
      // 営業候補調査：採用した商品のブランドと、社長が登録した公式サイト
      brands: (function () { var b = {}; (window.PitchStore ? window.PitchStore.list('adopt') : []).forEach(function (p) { if (p.brand) b[p.brand] = true; }); return Object.keys(b).slice(0, 40); })(),
      sites: R && R.sites ? R.sites() : {},
      // 経営企画AIに渡す会社の事実（記録にあるものだけ。無いものは「未記録」）
      facts: facts()
    };
  }

  function facts() {
    var out = [];
    var C = window.CompanyStore; var month = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
    var rev = C && C.revenue ? C.revenue()[month] : null;
    out.push('今月の楽天アフィリエイトの報酬：' + (rev ? rev.amount + '円（社長の記録）' : '未記録'));
    var D = window.DeliveryStore;
    if (D) out.push('社長の確認待ちの投稿セット：' + D.pendingCount() + '件／採用済み：' + D.all().filter(function (x) { return x.status === 'adopted'; }).length + '件');
    var P = window.PerfStore; var acc = P && P.accountLog ? P.accountLog().slice(-1)[0] : null;
    out.push('Instagramのフォロワー：' + (acc && acc.followers != null ? acc.followers + '人（公式APIで取得）' : '未取得'));
    out.push('楽天ROOMへの流入・クリック：取得する手段がない（未取得）');
    var A = window.AiUsage; if (A && A.month) out.push('今月のAIの費用：約' + A.month().yen + '円（上限1,000円）');
    return out;
  }

  // サーバーの成果物を、このiPhoneの記録に入れる
  function merge(st) {
    var A = window.AgentsStore; var R = window.PrStore;
    var n = { buyer: 0, outreach: 0, sets: 0, production: 0, leads: 0 };
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
    // 営業候補調査：公式サイトがリンクしていたアカウントを、フォロー候補に入れる（同じアカウントは入れない・興味なしにしたものも二度と出さない）
    if (R && R.addAccount) (st.leads || []).forEach(function (rec) {
      (rec.results || []).forEach(function (x) { (x.handles || []).forEach(function (h) {
        var res = R.addAccount({ handle: h, genre: 'brand', official: true, priority: 3, auto: true, source: '公式サイトのリンク（自律運営）', reason: x.brand + 'の公式サイトがリンクしているアカウント', evidence: x.url, checkedAt: x.checkedAt });
        if (res.account && !res.dup) n.leads++;
      }); });
    });
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
