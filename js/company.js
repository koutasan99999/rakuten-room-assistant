// 「経営報告」の画面と、毎日の経営会議（アプリを開いたとき、その日にまだ会議がなければ自動で開く）。
// 2026-11-05 改善：社員が自分でできることは社長に聞かずに進め、成果物を持って会議に出る。社長への判断依頼は経営責任者が整理して1日3件まで。
//
// 1. 事実を集める（コード）：既存の記録から番号 F1… を付ける。投稿セットごとに「止まっている工程」と担当を決める
//    （商品→文章→素材の権利→デザイン→社長の最終デザインの選択→公開。社員の未完成を社長の責任にしない）
// 2. 社員の仕事を決める（コード）：社員の工程で止まっていれば、担当の業務を作る（同じ目的の業務は増やさない）
// 3. AIの会議（1日1回）：社員の発言・問題（根本原因の分類つき・前回からの進捗）・社長への判断依頼（社長にしか決められないものだけ）
// 4. 経営責任者の整理（コード）：同じ根本原因の判断依頼を1件にまとめ、優先順に3件まで。超えた分は「持ち越し」（消さない）
// 5. 担当社員の作業（1日2件まで）：デザイナーは改善版3案（少なくとも1案は商品写真なし）を作り、画像で比べられるようにする
(function () {
  'use strict';

  var K = window.AppKit;
  var C = window.CompanyStore;
  if (!K || !C) return;
  var el = K.el;
  var ROLES = { editor: '編集長', designer: 'デザイナー', copywriter: 'コピーライター', buyer: 'バイヤー', sns: 'SNS担当', sales: '営業担当', ceo: '経営責任者', owner: '社長' };
  var PRI = { high: '高', mid: '中', low: '低' };
  var STATUS = { todo: '未着手', doing: '対応中', blocked: '止まっている', review: '社長の確認待ち', done: '完了', rejected: '中止' };
  var PSTATUS = { open: '回答待ち', approved: '承認', rejected: '却下', hold: '保留', merged: '統合済み', queued: '持ち越し' };
  var OWNER_REASONS = { cost: '有料サービス・追加費用', external: '外部への公開・対外的な行動', policy: '事業方針の重要な変更', final_design: '最終デザインの選択', auth: '社長の認証・権限が必要' };
  var CAUSES = { publish: '投稿公開までの障害', rights: '素材の利用条件', design: '画像の品質', copy: '文章・見出し', product: '商品情報', room: '楽天ROOM', discovery: '商品発掘と投稿の釣り合い', ig_api: 'Instagramの連携', tool: '制作ツール', other: 'その他' };
  // 工程（投稿セットが公開されるまで）と、止まっているときの担当
  var STAGES = {
    product: { label: '商品情報の問題', who: 'buyer' }, copy: { label: '文章が未完成', who: 'copywriter' }, rights: { label: '素材（楽天の商品画像）の利用条件が未確認', who: 'designer' },
    design: { label: '画像の改善版が未提出', who: 'designer' }, final_design: { label: '社長の最終デザインの選択待ち', who: 'owner' }, approval: { label: '社長の採用待ち', who: 'owner' },
    publish: { label: '採用済みだが未公開', who: 'owner' }, published: { label: '公開済み', who: '' }
  };
  var MAX_OWNER = 3;      // 社長への判断依頼は1日3件まで
  var MAX_WORK = 2;       // 会議のあとに社員が進める作業は1日2件まで（費用を抑える）
  var busy = '';
  var container = null;
  var showTasks = 'open';

  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function linkBtn(text, url) { var a = el('a', 'link-btn', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function stamp(iso) { try { return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function ago(iso) { return (Date.now() - new Date(iso).getTime()) / 86400000; }
  function within(iso, days) { return iso && ago(iso) <= days; }
  function since(iso, from) { return iso && (!from || iso > from); }
  function titleOf(x) { return x.titleEdit || x.title || ''; }
  function call(body, label) {
    return K.jobCall('company', body, { label: label, genre: '' }).then(function (r) {
      if (r.status !== 200) return { error: (r.data && r.data.error) || '通信できませんでした' };
      if (r.data.status === 'error') return { error: r.data.error || 'うまくいきませんでした' };
      return r.data;
    });
  }
  // 却下と、改善版に置き換わった元の投稿セットは、工程の確認から外す（データは残す）
  function sets() { return window.DeliveryStore ? window.DeliveryStore.all().filter(function (x) { return x.status !== 'rejected' && !x.supersededBy; }) : []; }
  // 改善版3案が提出され、社長の選択を待っている投稿セット
  function variantsWaiting(setId) {
    return C.tasks(true).filter(function (t) { return t.status === 'review' && (t.deliverables || []).some(function (d) { return d.setId === setId && d.type === 'design' && !d.chosen; }); })[0] || null;
  }

  // ---- 投稿セットが止まっている工程（社員の工程か、社長の工程か） ----
  function stageOf(x) {
    if (x.igPost && x.igPost.url) return 'published';
    var probs = (x.issues || []).filter(function (i) { return !/画像の権利/.test(i); });
    if (probs.length) return 'product';
    if (!x.copy) return 'copy';
    if (variantsWaiting(x.id)) return 'final_design';
    if (!x.noPhoto && !x.imageRightsOk) return 'rights';
    if (!x.designOk && x.status !== 'adopted') return 'design';
    if (x.status === 'new') return 'approval';
    return 'publish';
  }
  function pipeline() {
    var by = {};
    sets().forEach(function (x) { var st = stageOf(x); (by[st] = by[st] || []).push(x); });
    return by;
  }

  // ---- 1. 事実を集める ----
  function collectFacts(igStatus) {
    var facts = []; var ids = {}; var st = {};
    function add(area, text, key) { var f = { id: 'F' + (facts.length + 1), area: area, text: text }; facts.push(f); if (key) ids[key] = f.id; return f.id; }
    var all = sets();
    var P = window.PitchStore; var X = window.ExploreStore;
    var pipe = pipeline();
    var posted = (pipe.published || []).length + C.activity().filter(function (a) { return a.type === 'post' && a.status === 'sent' && !a.setId; }).length;
    st.posted = posted; st.pipe = pipe; st.sets = all.length;
    add('sets', '投稿セット（却下を除く）：' + all.length + '件。直近24時間に作成' + all.filter(function (x) { return within(x.createdAt, 1); }).length + '件', 'sets');
    add('instagram', 'Instagramに公開した記録：' + posted + '件', 'posted');
    var ready = (pipe.approval || []).length + (pipe.publish || []).length;
    st.ready = ready;
    add('pipeline', '公開できる状態の投稿セット（社員の工程をすべて通過し、社長の採用待ちか採用済み）：' + ready + '件', 'ready');
    var stopped = Object.keys(STAGES).filter(function (k) { return k !== 'published' && (pipe[k] || []).length; })
      .map(function (k) { return STAGES[k].label + ' ' + pipe[k].length + '件（' + (STAGES[k].who === 'owner' ? '社長' : '担当：' + ROLES[STAGES[k].who]) + '）'; });
    add('pipeline', '止まっている工程：' + (stopped.join('、') || 'なし'), 'stages');
    if (igStatus) add('instagram', igStatus.ready ? 'Instagramの公式API：設定済み（自動投稿は' + (igStatus.publishEnabled ? 'オン' : 'オフ') + '）' : 'Instagramの公式API：未設定。公開と反応の数字の取得は社長の手作業か、API設定が必要', 'ig');
    var adopted = P ? P.list('adopt') : [];
    st.adopted = adopted.length; st.roomDone = adopted.filter(function (p) { return p.room === 'done'; }).length;
    add('room', '採用商品：' + st.adopted + '件。楽天ROOMに登録済みの記録：' + st.roomDone + '件', 'room');
    var searches7 = 0;
    if (X) X.roots().forEach(function (n) { [n].concat(X.children(n.id)).forEach(function (m) { var pool = X.pool(m.id); if (pool) searches7 += pool.batches.filter(function (b) { return within(b.at, 7); }).length; }); });
    st.searches7 = searches7;
    add('explore', '商品探索：直近7日に' + searches7 + '回', 'explore');
    var open = C.tasks(true);
    st.overdue = open.filter(function (t) { return t.due && t.due < C.today() && t.status !== 'review'; }).length;
    add('tasks', '未完了の業務：' + open.length + '件（期限切れ' + st.overdue + '・社長の確認待ち' + open.filter(function (t) { return t.status === 'review'; }).length + '）', 'tasks');
    // 実際に行った作業（記録のあるものだけ。直近24時間）
    all.filter(function (x) { return within(x.createdAt, 1); }).slice(0, 3).forEach(function (x) { add('activity', stamp(x.createdAt) + ' 投稿セット「' + titleOf(x) + '」を制作（記録：作成日時）'); });
    C.tasks().forEach(function (t) { (t.deliverables || []).filter(function (d) { return within(d.at, 1); }).forEach(function (d) { add('activity', stamp(d.at) + ' ' + ROLES[t.assignee] + 'が「' + t.title + '」の成果物を提出' + (d.type === 'design' ? '（改善版' + d.copyVariants.length + '案の画像）' : '')); }); });
    all.filter(function (x) { return x.igPost && within(x.igPost.at, 1); }).forEach(function (x) { add('activity', stamp(x.igPost.at) + ' 社長がInstagramに投稿「' + titleOf(x) + '」（記録：' + x.igPost.url + '）'); });
    C.activity().filter(function (a) { return a.status === 'sent' && !a.setId && within(a.at, 1); }).slice(0, 5).forEach(function (a) { add('activity', stamp(a.at) + ' ' + a.label + '（' + (a.by === 'owner' ? '社長の記録' : 'APIの結果') + '）'); });
    return { facts: facts, ids: ids, st: st };
  }

  // ---- 2. 社員の仕事（社員の工程で止まっていれば、担当の業務を作る。同じ目的の業務は増やさない） ----
  function ensureStaffTasks(pipe) {
    var made = [];
    var target = (pipe.rights || [])[0] || (pipe.design || [])[0];
    if (target && !C.taskByKey('pipe:design')) made.push(C.addTask({ key: 'pipe:design', setId: target.id, title: '投稿セット「' + titleOf(target).slice(0, 24) + '」の改善版3案（うち1案以上は商品写真なし）', assignee: 'designer', priority: 'high', due: C.today(), doneWhen: '改善版3案の画像を作り、推奨案と理由を添えて社長に提出', output: '改善版3案の画像（表紙と商品1枚目）', from: { type: 'pipeline', text: '工程の確認（' + ((pipe.rights || []).length ? '素材の利用条件' : '画像の改善版が未提出') + '）' } }));
    var p = (pipe.product || [])[0];
    if (p && !C.taskByKey('pipe:product')) made.push(C.addTask({ key: 'pipe:product', setId: p.id, title: '投稿セット「' + titleOf(p).slice(0, 24) + '」の商品の問題を直す', assignee: 'buyer', priority: 'mid', due: C.today(), doneWhen: '品質確認の問題が0件になる（商品の差し替え）', output: '差し替えた商品一覧', from: { type: 'pipeline', text: '工程の確認（商品情報）' } }));
    return made;
  }

  // ---- 問題（根本原因ごとに1件。社員が自分で行った対策と、残っている課題） ----
  function ruleIssues(col) {
    var st = col.st; var ids = col.ids; var pipe = st.pipe;
    var issues = [];
    if (st.posted === 0 && st.sets > 0) {
      var staffStage = ['product', 'copy', 'rights', 'design'].filter(function (k) { return (pipe[k] || []).length; })[0];
      var ownerStage = ['final_design', 'approval', 'publish'].filter(function (k) { return (pipe[k] || []).length; })[0];
      var who = staffStage ? STAGES[staffStage].who : ownerStage ? 'owner' : 'ceo';
      var cause = staffStage ? '公開できる状態の投稿セットは' + st.ready + '件。止まっている工程：' + STAGES[staffStage].label + '（担当：' + ROLES[STAGES[staffStage].who] + '。社員の未完成）'
        : ownerStage ? '社員の工程は済み。止まっているのは社長の工程：' + STAGES[ownerStage].label : '投稿セットがない';
      issues.push({ key: 'publish', title: 'Instagramの公開が0件', cause: cause, facts: [ids.posted, ids.ready, ids.stages], owner: who === 'owner' ? 'ceo' : who, ownerSide: !staffStage && !!ownerStage });
    }
    if (st.adopted > 0 && st.roomDone === 0) issues.push({ key: 'room', title: '楽天ROOMの登録の記録が0件', cause: '採用商品' + st.adopted + '件の登録状況が記録されていない（ROOMへの登録は社長の手作業）', facts: [ids.room], owner: 'sales', ownerSide: true });
    if (st.searches7 >= 3 && st.posted === 0) issues.push({ key: 'discovery', title: '発掘は進むが公開につながっていない', cause: '直近7日の探索' + st.searches7 + '回に対して公開0件。経営責任者の判断で、今週は新規の発掘より既存の投稿セットの完成を優先する', facts: [ids.explore, ids.posted], owner: 'ceo' });
    if (st.overdue > 0) issues.push({ key: 'other', title: '期限を過ぎた業務が' + st.overdue + '件', cause: '担当の作業が止まっているか、社長の確認待ち', facts: [ids.tasks], owner: 'ceo' });
    return issues;
  }
  // 社員が自分で行った対策（記録から）：その原因に関係する業務の成果物・進捗と、調査済みの記録
  function selfActionsOf(key, from) {
    var keys = { publish: ['pipe:design', 'pipe:product'], rights: ['pipe:design'], design: ['pipe:design'], product: ['pipe:product'] }[key] || [];
    var out = [];
    if (key === 'publish' || key === 'rights') out.push('楽天の商品画像の利用条件を調査（11/5。規約の原文はこの環境から閲覧できず未確認）→ 無料で権利の問題が起きない「商品写真なし版」をA案として推奨');
    C.tasks().filter(function (t) { return keys.indexOf(t.key) !== -1; }).forEach(function (t) {
      (t.deliverables || []).filter(function (d) { return since(d.at, from); }).forEach(function (d) { out.push(ROLES[t.assignee] + 'が成果物を提出：' + (d.type === 'design' ? '改善版' + d.copyVariants.length + '案の画像（' + stamp(d.at) + '）' : d.summary || '作業計画')); });
      (t.progress || []).filter(function (p) { return since(p.at, from) && /失敗|改善版/.test(p.text); }).slice(-1).forEach(function (p) { out.push(ROLES[p.by] + '：' + p.text); });
    });
    return out;
  }
  // 前回の会議から何が進んだか（記録から。なければ理由）
  function progressOf(key, last) {
    var from = last ? last.at : '';
    var acts = selfActionsOf(key, from).filter(function (a) { return !/^楽天の商品画像の利用条件を調査/.test(a); });
    if (acts.length) return '前回から：' + acts.join('／');
    if (key === 'room') { var pr = C.proposals().filter(function (p) { return p.ruleKey === 'case:room'; })[0]; return '前回から進捗なし（理由：ROOM登録の記録が0件のまま。社長の操作待ち' + (pr && pr.status !== 'open' ? '・回答：' + PSTATUS[pr.status] : '') + '）'; }
    var t = C.tasks(true).filter(function (x) { return x.key && (key === 'publish' || x.key.indexOf(key) !== -1); })[0];
    if (!t) return '前回から進捗なし（理由：担当の業務がまだなかった。今日の会議で割り当て）';
    if (t.status === 'blocked') return '前回から進捗なし（理由：' + ((t.progress || []).slice(-1)[0] || {}).text + '）';
    if (t.status === 'review') return '前回から：成果物を提出済みで、社長の確認待ち';
    return '前回から進捗なし（理由：業務が' + STATUS[t.status] + '。今日の作業で進める）';
  }

  // ---- 4. 経営責任者の整理：社長への判断依頼（社長にしか決められないものだけ・同じ原因は1件・3件まで） ----
  function ownerCases(col, ai) {
    var pipe = col.st.pipe; var ids = col.ids;
    var cases = [];
    // 投稿公開までの障害解消（社長の操作が必要なことだけをまとめる）
    var steps = []; var factsUsed = [ids.posted, ids.ready, ids.stages];
    (pipe.final_design || []).forEach(function (x) { var t = variantsWaiting(x.id); var d = t && t.deliverables.slice(-1)[0]; var r = d && d.copyVariants[d.recommend ? d.recommend.index : 0]; steps.push('「' + titleOf(x).slice(0, 20) + '」の改善版3案から1つ選ぶ（推奨：' + (r ? r.angle + '「' + r.title + '」' + (r.photo ? '' : '・商品写真なし') : '') + '）'); });
    if ((pipe.approval || []).length) steps.push('完成した投稿セット' + pipe.approval.length + '件を採用するか決める');
    if ((pipe.publish || []).length) steps.push('採用済みの' + pipe.publish.length + '件をInstagramに投稿し、投稿URLを記録する');
    if (steps.length) cases.push({ ruleKey: 'case:publish', cause: 'publish', ownerReason: (pipe.final_design || []).length ? 'final_design' : 'external', role: 'ceo', kind: 'approve', score: 100,
      title: '投稿公開までの障害解消：社長の操作が必要なこと（' + steps.length + '点）', facts: factsUsed, steps: steps,
      impact: '社員の工程は済んでおり、ここが止まると公開も改善の効果測定も進みません',
      request: steps.join('。'), recommend: steps[0] });
    if (col.st.adopted > 0 && col.st.roomDone === 0) cases.push({ ruleKey: 'case:room', cause: 'room', ownerReason: 'external', role: 'sales', kind: 'confirm', score: 70,
      title: '楽天ROOMへの登録状況を教えてください（採用商品' + col.st.adopted + '件・登録の記録0件）', facts: [ids.room],
      impact: 'ROOMに登録がないと、Instagramから来た人が買える場所がなく収益になりません', request: '登録した商品は「採用済み」で「ROOMに登録した」を押してください', recommend: '投稿に使う予定の商品から登録してください' });
    // 有料ツールの導入（費用がかかるものだけ社長に聞く）
    C.tasks().forEach(function (t) { (t.deliverables || []).forEach(function (d) { if (d.tool && !d.toolDecision && !/^0円/.test(d.tool.cost)) cases.push({ ruleKey: 'case:tool:' + d.tool.id, cause: 'tool', ownerReason: 'cost', role: t.assignee, kind: 'decision', score: 50, title: d.tool.name + 'の導入（費用：' + d.tool.cost + '）', facts: [ids.stages], impact: d.tool.expected || '', request: '試用するか決めてください（契約・課金は社長が行う）', recommend: '導入しない場合の代替案：' + (d.tool.alternative || '') }); }); });
    // AIの判断依頼（社長にしか決められない理由のあるものだけ。投稿公開・ROOMの件は上の1件にまとめる）
    (ai ? ai.proposals : []).forEach(function (p) {
      if (p.cause === 'publish' || p.cause === 'room' || p.cause === 'rights' || p.cause === 'design') return;
      cases.push(Object.assign({ ruleKey: 'ai:' + p.cause + ':' + p.ownerReason, score: { cost: 55, policy: 60, external: 65, auth: 45, final_design: 80 }[p.ownerReason] || 40 }, p));
    });
    cases.sort(function (a, b) { return b.score - a.score; });
    return cases;
  }

  function taskBrief(t) {
    var d = (t.deliverables || []).slice(-1)[0];
    return { id: t.id, title: t.title, assignee: t.assignee, priority: t.priority, due: t.due, doneWhen: t.doneWhen, status: t.status, lastProgress: ((t.progress || []).slice(-1)[0] || {}).text || '', deliverable: d ? (d.summary || d.type) : '', ownerCheck: t.ownerCheck };
  }
  function setsBrief(firstId) {
    var list = sets().slice();
    var i = list.findIndex(function (x) { return x.id === firstId; });
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
    return list.slice(0, 6).map(function (x) {
      var ps = (x.items || []).map(function (it) { return it.price; }).filter(Boolean);
      return { title: titleOf(x), pattern: x.patternLabel || x.pattern, coverStyle: x.coverStyle || '自動', items: (x.items || []).length, prices: ps.length ? Math.min.apply(null, ps) + '〜' + Math.max.apply(null, ps) + '円' : '', imageSource: x.noPhoto ? '商品写真なし' : '楽天の商品画像', issues: (x.issues || []).concat(x.imageRightsOk || x.noPhoto ? [] : ['画像の権利が未確認']).join('／').slice(0, 150), status: x.status };
    });
  }

  // ---- 3. 毎日の経営会議 ----
  function runMeeting(manual) {
    if (busy) return Promise.resolve();
    busy = '経営会議を開いています（工程を確認し、社員が話し合っています）';
    paint();
    var igP = K.postJson('api/ig', { action: 'status' }).then(function (r) { return r.status === 200 ? r.data : null; }, function () { return null; });
    var last = C.lastMeeting();
    return igP.then(function (ig) {
      var col = collectFacts(ig);
      var made = ensureStaffTasks(col.st.pipe);
      var rIssues = ruleIssues(col);
      var track = C.issueTrack();
      var continuing = Object.keys(track).filter(function (k) { return !track[k].resolved; }).map(function (k) { var x = track[k]; return { key: k, title: x.title, days: x.days, done: progressOf(k, last) }; });
      var body = { action: 'meeting', date: C.today(), facts: col.facts, tasks: C.tasks(true).map(taskBrief), ownerNotes: C.pendingNotes(), improvements: C.improvements().slice(0, 15), lastPlan: last && last.plan ? last.plan : [], continuing: continuing };
      return call(body, '経営会議（' + C.today() + '）').then(function (r) {
        var ai = r.meeting || null;
        // 問題：同じ根本原因は1件に（コードの問題を基本に、AIの「自分で行った対策・進捗」を足す）
        var byKey = {};
        rIssues.forEach(function (i) { byKey[i.key] = Object.assign({}, i); });
        (ai ? ai.issues : []).forEach(function (i) {
          var k = i.key === 'rights' || i.key === 'design' ? (byKey.publish ? 'publish' : i.key) : i.key;
          if (byKey[k]) { if (i.selfActions) byKey[k].aiSelf = i.selfActions; if (i.remaining) byKey[k].remaining = i.remaining; if (i.progress) byKey[k].aiProgress = i.progress; }
          else byKey[k] = Object.assign({}, i, { key: k });
        });
        var issues = Object.keys(byKey).map(function (k) {
          var i = byKey[k];
          var seen = track[k];
          i.selfActions = selfActionsOf(k, '').slice(-4);
          i.days = seen && !seen.resolved ? seen.days + (seen.lastDate === C.today() ? 0 : 1) : 1;
          i.progress = i.days > 1 ? progressOf(k, last) : '';
          if (!i.remaining) i.remaining = i.ownerSide ? '社長の操作待ち（下の「社長に判断してほしいこと」）' : '担当が改善中（下の「明日、社員が進める仕事」）';
          C.trackIssue(k, i.title, C.today(), i.progress);
          return i;
        });
        C.resolveIssues(Object.keys(byKey), C.today());
        var cases = ownerCases(col, ai);
        var m = C.addMeeting({ date: C.today(), manual: !!manual, status: ai ? 'ok' : 'partial', error: r.error || '', facts: col.facts, summary: ai ? ai.summary : '（AIの会議に失敗したため、工程の確認と業務の割り当てだけ行いました）', statements: ai ? ai.statements : [], issues: issues, ruleIssues: [], plan: ai ? ai.plan : [], madeTasks: made.map(function (t) { return t.id; }) });
        // 社長への判断依頼：3件まで。超えた分は持ち越し（消さない）。今日の依頼に入らなかった前日までの未回答は「統合済み」に
        var factText = function (fid) { var f = col.facts.filter(function (x) { return x.id === fid; })[0]; return f ? f.text : ''; };
        var keep = {};
        cases.forEach(function (c, i) {
          var x = C.upsertProposal(Object.assign({}, c, { meetingId: m.id, date: m.date, source: c.ruleKey.indexOf('ai:') === 0 ? 'ai' : 'ceo', facts: (c.facts || []).map(factText).filter(Boolean) }));
          keep[x.id] = true;
          C.setProposalStatus(x.id, i < MAX_OWNER ? (x.status === 'hold' ? 'hold' : 'open') : 'queued', i < MAX_OWNER ? '' : '経営責任者が優先順で明日以降に回した（' + m.date + '）');
        });
        C.proposals().forEach(function (p) { if (!keep[p.id] && (p.status === 'open' || p.status === 'queued')) C.setProposalStatus(p.id, 'merged', '経営責任者が整理：社員で対応するか、ほかの判断依頼に統合（' + m.date + '）'); });
        if (ai) {
          ai.taskUpdates.forEach(function (u) { var t = C.task(u.id); var locked = t && { review: 1, done: 1, rejected: 1 }[t.status]; C.progress(u.id, u.note, 'ceo', locked ? null : u.status || null); });
          ai.newTasks.concat(ai.staffTasks || []).forEach(function (t) { if (!C.tasks(true).some(function (x) { return x.title === t.title; })) C.addTask(Object.assign({}, t, { from: { type: 'meeting', id: m.id, text: '経営会議で社員が自分で決めた仕事' } })); });
          ai.improvements.forEach(function (x) { C.addImprovement(Object.assign({ from: 'meeting ' + m.date }, x)); });
        }
        busy = '';
        paint();
        // 5. 担当社員の作業：デザイナーの工程の業務を優先して、1日2件まで
        var queue = C.tasks(true).filter(function (t) { return t.status === 'todo' || t.status === 'doing'; })
          .sort(function (a, b) { return (b.key === 'pipe:design') - (a.key === 'pipe:design') || ({ high: 3, mid: 2, low: 1 }[b.priority] - { high: 3, mid: 2, low: 1 }[a.priority]); }).slice(0, MAX_WORK);
        return queue.reduce(function (p, t) { return p.then(function () { return doWork(t.id); }); }, Promise.resolve());
      });
    }).catch(function (e) {
      C.addMeeting({ date: C.today(), status: 'failed', error: e.message, summary: '会議を開けませんでした' });
      busy = ''; paint();
    });
  }

  // ---- 5. 担当社員の作業（改善版3案・作業計画の提出） ----
  function doWork(tid) {
    var t = C.task(tid);
    if (!t) return Promise.resolve();
    busy = ROLES[t.assignee] + 'が「' + t.title.slice(0, 24) + '」に取り組んでいます';
    C.progress(tid, '作業を開始', t.assignee, 'doing');
    paint();
    var target = t.setId || (sets()[0] || {}).id || '';
    return call({ action: 'work', task: taskBrief(t), sets: setsBrief(target), ownerNote: t.ownerNote || '', facts: collectFacts(null).facts.filter(function (f) { return f.area !== 'activity'; }) }, '業務：' + t.title.slice(0, 16)).then(function (r) {
      busy = '';
      if (r.error) { C.progress(tid, '作業に失敗：' + r.error + '（次の会議でやり直します）', t.assignee, 'blocked'); paint(); return; }
      var d = Object.assign({}, r.deliverable, { setId: r.deliverable.type === 'design' ? target : '' });
      C.addDeliverable(tid, d, t.assignee);
      // 作業計画は完成した成果物ではないので、社長の確認には回さない（社員が進める。実行したら記録で報告）
      if (d.type === 'plan') C.updateTask(tid, { status: 'doing', ownerCheck: '不要（社員の判断）' });
      if (d.type === 'design') (d.changes || []).slice(0, 2).forEach(function (c) { C.addImprovement({ problem: '画像：' + t.title.slice(0, 40), idea: c, from: '業務 ' + t.id }); });
      paint();
    });
  }

  // ---- 社長の返信 → 社員の応答と業務 ----
  function ownerReply(text, about) {
    if (!text) return;
    C.say('owner', text, about);
    if (about && about.proposalId) C.replyProposal(about.proposalId, 'owner', text);
    busy = '社員が返信を読んで、業務にしています';
    paint();
    var col = collectFacts(null);
    return call({ action: 'reply', message: text, about: about ? { title: about.title, text: about.text || '', role: about.role || '' } : null, tasks: C.tasks(true).map(taskBrief), facts: col.facts, date: C.today() }, '会議室の返信').then(function (r) {
      busy = '';
      if (r.error) { C.say('ceo', '（返信を業務にできませんでした：' + r.error + '。次の会議で扱います）', about); paint(); return; }
      r.messages.forEach(function (m) { C.say(m.role, m.text, about); });
      (r.taskUpdates || []).forEach(function (u) { var t = C.task(u.id); var locked = t && { review: 1, done: 1, rejected: 1 }[t.status]; C.progress(u.id, u.note, 'ceo', locked ? null : u.status || null); });
      var made = r.newTasks.map(function (t) { return C.addTask(Object.assign({}, t, { setId: (sets()[0] || {}).id || '', from: { type: 'reply', text: text.slice(0, 120), about: about ? about.title : '' } })); });
      if (made.length) C.say('ceo', '業務を登録しました：' + made.map(function (t) { return '「' + t.title + '」（' + ROLES[t.assignee] + '・期限' + t.due + '）'; }).join('、'), about);
      paint();
      var w = made.filter(function (t) { return t.assignee === 'designer' || t.assignee === 'copywriter'; })[0];
      if (w) return doWork(w.id);
    });
  }

  // 社長が改善版の1案に決める（最終デザインの選択＝この投稿の採用）。元の投稿セットは残し、改善版を「採用」で作る
  function chooseVariant(tid, di, v) {
    var D = window.DeliveryStore;
    var t = C.task(tid); var d = t && t.deliverables[di];
    var base = D && (D.get(d.setId) || sets()[0]);
    if (!base) { K.showToast('改善版の元になる投稿セットがありません'); return; }
    var copy = JSON.parse(JSON.stringify(base));
    copy.id = base.id + '-v' + Date.now().toString(36).slice(-4);
    copy.status = 'adopted'; copy.decidedAt = new Date().toISOString();
    copy.createdAt = new Date().toISOString();
    copy.titleEdit = v.title; copy.coverStyle = v.coverStyle || d.coverStyle; copy.noPhoto = !v.photo; copy.designOk = true;
    copy.improvedFrom = base.id;
    copy.improveNote = '改善版（' + v.angle + (v.photo ? '' : '・商品写真なし') + '）：社長が3案から選択（' + stamp(copy.decidedAt) + '）';
    delete copy.igPost; delete copy.alt;
    delete copy.supersededBy;
    D.save(copy);
    D.save(Object.assign({}, base, { supersededBy: copy.id })); // 元の投稿セットは消さずに「改善版に置き換え」の印だけ付ける
    C.updateDeliverable(tid, di, { chosen: v.title, improvedSetId: copy.id });
    C.checkTask(tid, 'approve', '「' + v.title + '」に決定');
    C.addImprovement({ problem: '表紙・画像の改善', idea: v.angle + '「' + v.title + '」' + (v.photo ? '' : '（商品写真なし）'), from: '業務 ' + tid, status: 'adopted' });
    K.showToast('改善版を採用しました。「投稿セット」で画像を保存して投稿できます');
    paint();
  }

  // ---- 画面 ----
  function details(title, open) { var d = el('details', 'card co-sec'); d.open = !!open; d.appendChild(el('summary', 'co-h', title)); return d; }
  function block(title) { var d = el('div', 'card co-sec'); d.appendChild(el('p', 'co-h', title)); return d; }
  function factList(list) { var ul = el('ul', 'co-facts'); (list || []).forEach(function (f) { ul.appendChild(el('li', null, typeof f === 'string' ? f : f.text)); }); return ul; }

  function proposalCard(p) {
    var c = el('div', 'co-prop');
    c.appendChild(el('p', 'co-who', ROLES[p.role] + '｜' + (OWNER_REASONS[p.ownerReason] || '判断') + '｜' + PSTATUS[p.status] + (p.times > 1 ? '｜' + p.times + '日目' : '')));
    c.appendChild(el('p', 'co-title', p.title));
    if (p.steps && p.steps.length) c.appendChild(factList(p.steps));
    if (p.recommend) c.appendChild(el('p', 'hint co-rec', '推奨：' + p.recommend));
    c.appendChild(el('p', 'hint', '理由・影響：' + p.impact));
    var dd = el('details', 'co-more');
    dd.appendChild(el('summary', null, '根拠'));
    dd.appendChild(factList(p.facts));
    c.appendChild(dd);
    (p.replies || []).slice(-2).forEach(function (r) { c.appendChild(el('p', 'co-reply', (ROLES[r.who] || r.who) + '：' + r.text)); });
    var row = el('div', 'pitch-row');
    if (p.status === 'open' || p.status === 'hold' || p.status === 'queued') {
      row.appendChild(btn('承認', 'btn btn-primary co-sbtn', function () { C.decideProposal(p.id, 'approved', ''); K.showToast('承認を記録しました（次の会議に引き継ぎます）'); paint(); }));
      row.appendChild(btn('却下', 'status-btn', function () { var r = window.prompt('却下の理由（任意）', ''); if (r == null) return; C.decideProposal(p.id, 'rejected', r.trim()); paint(); }));
    }
    row.appendChild(btn('返信する', 'status-btn', function () {
      var r = window.prompt('社員への返信・追加の指示（業務になります）', '');
      if (!r || !r.trim()) return;
      ownerReply(r.trim(), { proposalId: p.id, title: p.title, text: p.request, role: p.role });
    }));
    c.appendChild(row);
    return c;
  }

  // 改善版3案：実際の画像（表紙と商品1枚目）を描いて比べる
  function variantsView(t, d, di) {
    var w = el('div', 'co-variants');
    var D = window.DeliveryStore; var DV = window.DeliveryView;
    var base = D && D.get(d.setId);
    d.copyVariants.forEach(function (v, i) {
      var card = el('div', 'co-vcard' + (d.recommend && d.recommend.index === i ? ' co-recommended' : ''));
      var head = el('p', 'co-vhead', 'ABC'[i] + '案｜' + v.angle + (v.photo ? '' : '｜商品写真なし') + (d.recommend && d.recommend.index === i ? '｜推奨' : ''));
      card.appendChild(head);
      card.appendChild(el('p', 'co-vtitle', v.title));
      var imgs = el('div', 'co-vimgs');
      imgs.appendChild(el('p', 'hint', base ? '画像を描いています…' : '元の投稿セットが見つからないため、画像を描けません'));
      card.appendChild(imgs);
      if (base && DV && DV.previewVariant) DV.previewVariant(base, Object.assign({ key: t.id + i }, v)).then(function (out) { imgs.innerHTML = ''; out.urls.forEach(function (u) { var im = el('img'); im.src = u; im.alt = ''; imgs.appendChild(im); }); }, function () { imgs.innerHTML = ''; imgs.appendChild(el('p', 'hint pitch-warn', '画像を描けませんでした')); });
      if (v.why) card.appendChild(el('p', 'hint', '狙い：' + v.why));
      if (!d.chosen && t.status === 'review') card.appendChild(btn('この案に決める（採用）', 'btn btn-primary co-sbtn', function () { chooseVariant(t.id, di, v); }));
      else if (d.chosen === v.title) card.appendChild(el('p', 'hint co-rec', '社長が選んだ案'));
      w.appendChild(card);
    });
    return w;
  }

  function deliverableView(t, d, di) {
    var w = el('div', 'co-deliv');
    w.appendChild(el('p', 'co-label', '成果物（' + stamp(d.at) + '・' + ROLES[d.by] + '）'));
    if (d.summary) w.appendChild(el('p', null, d.summary));
    if (d.type === 'design') {
      if (d.recommend && d.recommend.why) w.appendChild(el('p', 'hint co-rec', '推奨：' + 'ABC'[d.recommend.index] + '案。' + d.recommend.why));
      w.appendChild(variantsView(t, d, di));
      if (d.improvedSetId) w.appendChild(btn('採用した改善版の投稿セットを見る', 'btn btn-secondary', function () { if (window.PitchView) window.PitchView.show('sets'); }));
      var more = el('details', 'co-more');
      more.appendChild(el('summary', null, '今の画像の評価と改善の内容'));
      var dl = el('dl', 'radar-facts');
      d.diagnosis.forEach(function (x) { dl.appendChild(el('dt', null, x.point + '：' + '★★★★★'.slice(0, x.score) + '☆☆☆☆☆'.slice(0, 5 - x.score))); dl.appendChild(el('dd', null, x.finding)); });
      more.appendChild(dl);
      more.appendChild(factList(d.changes));
      w.appendChild(more);
      if (d.tool) {
        var tc = el('details', 'co-more co-tool');
        tc.appendChild(el('summary', null, '制作方法の比較：' + d.tool.name + ' と今の方法'));
        [['今の問題', d.tool.problem], ['期待できる改善', d.tool.expected], ['無料で使える範囲', d.tool.free], ['追加費用', d.tool.cost], ['API・自動化', d.tool.api], ['導入の手間（社長の操作）', d.tool.ownerSteps], ['導入しない場合（今の方法）', d.tool.alternative], ['注意', d.tool.limits], ['確認日', d.tool.checked]].forEach(function (x) { if (x[1]) tc.appendChild(el('p', 'hint', x[0] + '：' + x[1])); });
        (d.tool.sources || []).forEach(function (u) { tc.appendChild(linkBtn('出典', u)); });
        tc.appendChild(el('p', 'hint', /^0円/.test(d.tool.cost) ? '費用がかからないため、社員の判断で試します。' : '費用がかかるため、導入するかは社長に確認します（「社長に判断してほしいこと」）。契約・課金は社長の承認なしに行いません。'));
        w.appendChild(tc);
      }
    } else if (d.type === 'plan') {
      var ol = el('ol', 'co-facts'); (d.steps || []).forEach(function (x) { ol.appendChild(el('li', null, x + '（予定）')); }); w.appendChild(ol);
      if (d.needOwner) w.appendChild(el('p', 'hint co-req', '社長に必要な操作：' + d.needOwner));
    }
    return w;
  }

  function taskCard(t, open) {
    var c = el('details', 'co-task');
    c.open = !!open;
    var head = el('summary');
    head.appendChild(el('span', 'tag co-st co-' + t.status, STATUS[t.status]));
    head.appendChild(el('span', 'co-ttitle', t.title));
    c.appendChild(head);
    c.appendChild(el('p', 'hint', '担当：' + ROLES[t.assignee] + '｜優先：' + PRI[t.priority] + '｜期限：' + (t.due || 'なし') + '｜社長の確認：' + t.ownerCheck));
    c.appendChild(el('p', 'hint', '完了条件：' + t.doneWhen + (t.output ? '｜予定の成果物：' + t.output : '')));
    c.appendChild(el('p', 'hint', '発注：' + (t.from && t.from.text ? t.from.text : t.from && t.from.type === 'meeting' ? '経営会議' : '—')));
    var last = (t.deliverables || []).slice(-1)[0];
    if (last) c.appendChild(deliverableView(t, last, t.deliverables.length - 1));
    var pr = el('details', 'co-more');
    pr.appendChild(el('summary', null, '進捗の記録（' + (t.progress || []).length + '）'));
    var ul = el('ul', 'co-facts');
    (t.progress || []).slice(-8).forEach(function (p) { ul.appendChild(el('li', null, stamp(p.at) + ' ' + (ROLES[p.by] || '') + '：' + p.text)); });
    pr.appendChild(ul);
    c.appendChild(pr);
    var row = el('div', 'pitch-row');
    if (t.status === 'review' && !(last && last.type === 'design')) {
      row.appendChild(btn('承認（完了）', 'btn btn-primary co-sbtn', function () { C.checkTask(t.id, 'approve', ''); paint(); }));
    }
    if (t.status === 'review') {
      row.appendChild(btn('差し戻し（追加指示）', 'status-btn', function () {
        var r = window.prompt('どこを直してほしいですか（担当がやり直します）', '');
        if (!r || !r.trim()) return;
        C.checkTask(t.id, 'revise', r.trim());
        C.say('owner', r.trim(), { title: t.title, taskId: t.id }, true);
        doWork(t.id);
      }));
      row.appendChild(btn('却下', 'status-btn', function () { C.checkTask(t.id, 'reject', ''); paint(); }));
    } else if (!{ done: 1, rejected: 1 }[t.status]) {
      row.appendChild(btn('今すぐ取りかかってもらう', 'status-btn', function () { if (busy) return; doWork(t.id); }));
    }
    if (row.childNodes.length) c.appendChild(row);
    return c;
  }

  function roomView() {
    var box = el('div', 'co-room');
    var msgs = C.room().slice(-14);
    msgs.forEach(function (r) { box.appendChild(el('p', 'co-msg' + (r.who === 'owner' ? ' co-owner' : ''), stamp(r.at) + ' ' + (ROLES[r.who] || r.who) + '：' + r.text)); });
    var ta = el('textarea', 'input');
    ta.rows = 3;
    ta.placeholder = '社員への返信・反論・追加の発注（例：画像が微妙だから改善してほしい）';
    box.appendChild(ta);
    box.appendChild(btn('送る（業務にします）', 'btn btn-primary', function () { var v = ta.value.trim(); if (!v || busy) return; ta.value = ''; ownerReply(v, null); }));
    return box;
  }

  function activityView() {
    var box = el('div');
    var ig = C.activity();
    box.appendChild(el('p', 'co-label', 'Instagramでの活動'));
    if (ig.length) {
      var ul = el('ul', 'co-facts');
      ig.slice(0, 15).forEach(function (a) { ul.appendChild(el('li', null, stamp(a.at) + '｜' + a.label + '｜' + (a.account ? '@' + a.account + '｜' : '') + (a.text ? '「' + a.text + '」｜' : '') + { sent: '実行済み', failed: '失敗', draft: '案のみ（未実行）' }[a.status] + '｜' + (a.by === 'owner' ? '社長の記録' : 'APIの結果') + (a.url ? '｜' + a.url : ''))); });
      box.appendChild(ul);
    } else box.appendChild(el('p', 'hint', '記録はありません（公開・コメント・いいねの実行は0件として扱います）。'));
    box.appendChild(el('p', 'hint', 'AI社員はInstagramにコメント・いいね・フォローをしていません（公式APIでは他のアカウントへのコメントが提供されていないため）。社長が行った場合は記録できます。'));
    box.appendChild(btn('社長が行った活動を記録する', 'status-btn', function () {
      var type = window.prompt('種類を入力：投稿／コメント／いいね', 'コメント');
      if (!type) return;
      var account = (window.prompt('相手のアカウント名（@なし。投稿なら自分）', '') || '').replace(/^@/, '').trim();
      var url = (window.prompt('対象の投稿URL', '') || '').trim();
      var text = type.indexOf('コメント') !== -1 ? (window.prompt('送ったコメントの文面', '') || '').trim() : '';
      C.addActivity({ type: type.indexOf('投稿') !== -1 ? 'post' : type.indexOf('いいね') !== -1 ? 'like' : 'comment', label: type.trim(), account: account, url: url, text: text, status: 'sent', by: 'owner' });
      K.showToast('記録しました');
      paint();
    }));
    return box;
  }

  function paint() {
    if (!container || !container.isConnected) return;
    container.innerHTML = '';
    var tm = C.todayMeeting();
    var head = el('div', 'card');
    head.appendChild(el('h3', 'cand-name', '本日の経営報告（' + C.today().slice(5).replace('-', '/') + '）'));
    if (!C.consented()) {
      head.appendChild(el('p', 'hint', 'AI社員が毎日1回、経営会議を開きます（アプリを開いたとき、その日にまだ会議がなければ自動で開きます）。AIの呼び出しは1日3回程度（会議1回＋社員の作業2件まで）、今のOpenAIのキーで1日約2〜3円の見込みです。新しいサービスの契約はありません。'));
      head.appendChild(btn('了承して、毎日の経営会議を始める', 'btn btn-discover', function () { C.setConsent(); runMeeting(false); }));
      container.appendChild(head);
      return;
    }
    if (busy) head.appendChild(el('p', 'hint pitch-busy', busy + '…（20〜60秒）'));
    if (tm) head.appendChild(el('p', 'hint', stamp(tm.at) + ' 会議' + { ok: '済み', partial: '済み（AIの会議は失敗。工程の確認と割り当てだけ）', failed: '失敗' }[tm.status] + (tm.error ? '：' + tm.error : '') + (tm.summary ? '｜' + tm.summary : '')));
    else if (!busy) head.appendChild(el('p', 'hint', '今日の会議はまだです。'));
    if (tm || C.lastMeeting()) {
      var mr = el('div', 'co-minutes');
      mr.appendChild(btn('議事録をコピー（全文）', 'btn btn-primary co-sbtn', function () { copyMinutes(true); }));
      mr.appendChild(btn('議事録をコピー（省略版）', 'status-btn', function () { copyMinutes(false); }));
      head.appendChild(mr);
    }
    if (!busy) head.appendChild(btn(tm ? 'もう一度会議を開く' : '今すぐ会議を開く', 'link-btn', function () { runMeeting(true); }));
    container.appendChild(head);
    container.appendChild(dashboard());
    var m = tm || C.lastMeeting();

    // 1. 今日、社員が完了した仕事（成果物・実行した操作の記録）
    var s1 = block('1. 今日、社員が完了した仕事');
    var dels = [];
    C.tasks().forEach(function (t) { (t.deliverables || []).forEach(function (d, i) { if (within(d.at, 1)) dels.push({ t: t, d: d, i: i }); }); });
    dels.forEach(function (x) {
      var r = el('div', 'co-issue');
      r.appendChild(el('p', 'co-title', ROLES[x.t.assignee] + '：' + x.t.title));
      r.appendChild(el('p', 'hint', (x.d.type === 'design' ? '改善版' + x.d.copyVariants.length + '案の画像を制作' + (x.d.chosen ? '（社長が「' + x.d.chosen + '」に決定）' : '（社長の選択待ち）') : '作業計画を作成（実行は予定。完了ではありません）') + '｜' + stamp(x.d.at)));
      r.appendChild(btn('成果物を見る', 'link-btn', function () { var el2 = container.querySelector('[data-task="' + x.t.id + '"]'); if (el2) { el2.open = true; el2.scrollIntoView({ behavior: 'smooth' }); } }));
      s1.appendChild(r);
    });
    var acts = m && m.facts ? m.facts.filter(function (f) { return f.area === 'activity' && !/成果物を提出/.test(f.text); }) : [];
    if (acts.length) { s1.appendChild(el('p', 'co-label', '実行した操作の記録')); s1.appendChild(factList(acts)); }
    if (!dels.length && !acts.length) s1.appendChild(el('p', 'hint', '今日、記録のある完了した仕事はありません。'));
    container.appendChild(s1);

    // 2. 社員が発見した問題と改善策
    var s2 = block('2. 社員が発見した問題と改善策');
    var issues = m ? (m.issues || []).concat(m.ruleIssues || []) : [];
    if (!issues.length) s2.appendChild(el('p', 'hint', m ? '問題はありません。' : 'まだ会議を開いていません。'));
    issues.forEach(function (i) {
      var p = el('div', 'co-issue');
      p.appendChild(el('p', 'co-title', i.title + (i.days > 1 ? '（' + i.days + '日目）' : '')));
      if (i.cause) p.appendChild(el('p', 'hint', '原因：' + i.cause));
      if (i.progress) p.appendChild(el('p', 'hint co-rec', i.progress));
      if ((i.selfActions || []).length || i.aiSelf) { p.appendChild(el('p', 'co-label', '社員が自分で行った対策')); p.appendChild(factList((i.selfActions || []).concat(i.aiSelf && !(i.selfActions || []).length ? [i.aiSelf] : []))); }
      if (i.remaining) p.appendChild(el('p', 'hint', '残っている課題：' + i.remaining + '｜担当：' + (ROLES[i.owner] || '経営責任者')));
      s2.appendChild(p);
    });
    container.appendChild(s2);

    // 3. 社長に判断してほしいこと（3件まで）
    var open = C.proposals().filter(function (p) { return p.status === 'open' || p.status === 'hold'; }).slice(0, MAX_OWNER);
    var s3 = block('3. 社長に判断してほしいこと（' + open.length + '件）');
    open.forEach(function (p) { s3.appendChild(proposalCard(p)); });
    // 判断に使う成果物（改善版3案の画像など）は、ここで直接見て選べるように（判断依頼の件数には数えない）
    var reviews = C.tasks(true).filter(function (t) { return t.status === 'review'; });
    if (reviews.length) s3.appendChild(el('p', 'co-label', '判断に使う成果物（社員が提出済み）'));
    reviews.forEach(function (t) { var c = taskCard(t, true); c.setAttribute('data-task', t.id); s3.appendChild(c); });
    if (!s3.querySelector('.co-prop, .co-task')) s3.appendChild(el('p', 'hint', '今日、社長に判断してほしいことはありません。社員で進めます。'));
    container.appendChild(s3);

    // 4. 明日、社員が自主的に進める仕事
    var s4 = block('4. 明日、社員が自主的に進める仕事');
    var next = C.tasks(true).filter(function (t) { return t.status !== 'review'; });
    if (!next.length) s4.appendChild(el('p', 'hint', '予定の仕事はありません。'));
    next.forEach(function (t) {
      var r = el('div', 'co-issue');
      r.appendChild(el('p', 'co-title', ROLES[t.assignee] + '：' + t.title));
      r.appendChild(el('p', 'hint', '完了条件：' + t.doneWhen + (t.output ? '｜予定の成果物：' + t.output : '') + '｜期限：' + (t.due || 'なし') + '｜' + STATUS[t.status]));
      s4.appendChild(r);
    });
    if (m && (m.plan || []).length) { s4.appendChild(el('p', 'co-label', '会議で決めた改善計画')); s4.appendChild(factList(m.plan)); }
    container.appendChild(s4);

    // ここから下は折りたたみ
    var queued = C.proposals('queued');
    if (queued.length) { var q = details('持ち越しの判断依頼（' + queued.length + '件・明日以降）'); queued.forEach(function (p) { q.appendChild(proposalCard(p)); }); container.appendChild(q); }
    var room = details('会議室（社員への返信・反論・追加発注）');
    room.appendChild(roomView());
    container.appendChild(room);
    var minutes = details('今日の議事録（社員の発言）');
    if (m && (m.statements || []).length) m.statements.forEach(function (s) { minutes.appendChild(el('p', 'co-msg', ROLES[s.role] + '：' + s.text)); }); else minutes.appendChild(el('p', 'hint', '発言はありません。'));
    if (m && (m.facts || []).length) { minutes.appendChild(el('p', 'co-label', '会議で使った事実')); minutes.appendChild(factList(m.facts)); }
    container.appendChild(minutes);
    var all = C.tasks();
    var s7 = details('業務の一覧（' + all.length + '）');
    var tabs = el('div', 'xp-filter');
    [['open', '未完了'], ['all', 'すべて']].forEach(function (x) { tabs.appendChild(btn(x[1], 'xp-chip' + (showTasks === x[0] ? ' active' : ''), function () { showTasks = x[0]; paint(); })); });
    s7.appendChild(tabs);
    (showTasks === 'open' ? C.tasks(true) : all).forEach(function (t) { var c = taskCard(t); c.setAttribute('data-task', t.id); s7.appendChild(c); });
    container.appendChild(s7);
    var s6 = details('実行履歴（記録のある操作だけ）');
    s6.appendChild(activityView());
    container.appendChild(s6);
    var s9 = details('改善の記録（' + C.improvements().length + '）');
    var IST = { proposed: '提案', adopted: '採用', done: '実行済み', success: '成功', failed: '失敗', unverified: '未検証' };
    C.improvements().slice(0, 30).forEach(function (x) {
      var r = el('div', 'co-issue');
      r.appendChild(el('p', null, x.problem + ' → ' + x.idea));
      r.appendChild(el('p', 'hint', stamp(x.at) + '｜' + IST[x.status] + (x.result ? '｜結果：' + x.result : '') + (x.from ? '｜' + x.from : '')));
      var rr = el('div', 'pitch-row');
      ['success', 'failed', 'unverified'].forEach(function (k) { if (x.status !== k) rr.appendChild(btn(IST[k], 'link-btn', function () { var res = k === 'unverified' ? '' : window.prompt('結果（任意。例：保存数が増えた）', '') || ''; C.setImprovement(x.id, { status: k, result: res }); paint(); })); });
      r.appendChild(rr);
      s9.appendChild(r);
    });
    container.appendChild(s9);
    var past = C.proposals().filter(function (p) { return p.status === 'merged' || p.status === 'approved' || p.status === 'rejected'; });
    var s11 = details('整理済み・回答済みの提言（' + past.length + '）');
    past.slice(0, 30).forEach(function (p) { s11.appendChild(el('p', 'hint', PSTATUS[p.status] + '｜' + p.title + (p.note ? '｜' + p.note : ''))); });
    container.appendChild(s11);
    var s10 = details('過去の会議（' + C.meetings().length + '）');
    C.meetings().slice(0, 30).forEach(function (mm) {
      var d = el('details', 'co-task');
      d.appendChild(el('summary', null, mm.date + '｜' + { ok: '開催', partial: '一部（AIなし）', failed: '失敗' }[mm.status] + '｜' + (mm.summary || '')));
      if (mm.error) d.appendChild(el('p', 'hint pitch-warn', '失敗の記録：' + mm.error));
      (mm.issues || []).concat(mm.ruleIssues || []).forEach(function (i) { d.appendChild(el('p', 'hint', '問題：' + i.title + (i.progress ? '｜' + i.progress : ''))); });
      (mm.statements || []).forEach(function (s) { d.appendChild(el('p', 'co-msg', ROLES[s.role] + '：' + s.text)); });
      if ((mm.plan || []).length) d.appendChild(el('p', 'hint', '計画：' + mm.plan.join('／')));
      s10.appendChild(d);
    });
    container.appendChild(s10);
  }

  // ---- 経営ダッシュボード：成果（売上・公開・ROOM）・準備状況・自動運用の状態・コスト・問題を1枚で ----
  var igCache = null; var igAt = 0;
  function igStatus() {
    if (Date.now() - igAt < 10 * 60000) return Promise.resolve(igCache);
    igAt = Date.now();
    return K.postJson('api/ig', { action: 'status' }).then(function (r) { igCache = r.status === 200 ? r.data : null; return igCache; }, function () { return null; });
  }
  var failedJobs = [];
  function refreshJobs() { if (window.SearchJobs) window.SearchJobs.list().then(function (js) { failedJobs = js.filter(function (j) { return j.status === 'failed' && within(new Date(j.finishedAt || j.updatedAt || 0).toISOString(), 1); }); }, function () {}); }
  function tile(label, value, sub, cls) { var t = el('div', 'co-tile' + (cls ? ' ' + cls : '')); t.appendChild(el('p', 'co-tile-label', label)); t.appendChild(el('p', 'co-tile-value', value)); if (sub) t.appendChild(el('p', 'co-tile-sub', sub)); return t; }
  var STATE = { auto: '自動', manual: '手動', off: '未接続', none: '未実装' };
  function dashboard() {
    var box = el('div', 'card co-dash');
    box.appendChild(el('p', 'co-h', '経営ダッシュボード'));
    var month = C.today().slice(0, 7);
    var rev = C.revenue()[month];
    var col = collectFacts(null);
    var pipe = col.st.pipe;
    var A = window.AiUsage;
    var cost = A ? A.month() : { yen: 0, calls: 0 };
    var caps = A ? A.caps() : { capYen: 0 };
    var P = window.PitchStore;
    var presented7 = P ? P.recent(500).length : 0;
    var grid = el('div', 'co-tiles');
    grid.appendChild(tile('今月の報酬', rev ? rev.amount.toLocaleString('ja-JP') + '円' : '未取得', '目標 30,000円' + (rev ? '（' + Math.round(rev.amount * 100 / 30000) + '%・社長の記録）' : '（社長の記録が必要）'), rev && rev.amount >= 30000 ? 'co-good' : ''));
    grid.appendChild(tile('Instagram公開', col.st.posted + '件', '記録のある公開（自動取得は未接続）'));
    grid.appendChild(tile('ROOM登録', col.st.roomDone + '件', '採用' + col.st.adopted + '件のうち（社長の申告）'));
    grid.appendChild(tile('公開できる投稿', col.st.ready + '件', '社員の工程を通過した投稿セット'));
    grid.appendChild(tile('プレゼンした商品', presented7 + '件', '通常のプレゼンの累計'));
    grid.appendChild(tile('AIの費用（今月）', '約' + cost.yen + '円', cost.calls + '回・上限' + caps.capYen + '円（推定）', cost.yen > caps.capYen * 0.8 ? 'co-warn' : ''));
    box.appendChild(grid);
    // 投稿の準備状況（工程ごと）
    var stages = Object.keys(STAGES).filter(function (k) { return (pipe[k] || []).length; }).map(function (k) { return STAGES[k].label + ' ' + pipe[k].length + '件'; });
    box.appendChild(el('p', 'hint', '投稿の準備状況：' + (stages.join('／') || '投稿セットなし')));
    // 自動運用の状態（実行中・完了・失敗・未実装を分けて）
    var ig = igCache;
    var rows = [
      ['商品の発掘（プレゼン）', 'manual', '「次の商品を探してもらう」を押したとき（ジャンルの偏りはコードで防止）'],
      ['投稿企画・投稿セットの制作', 'auto', 'アプリを開いているとき、確認待ちが3件より少なければ自動で作る（初回の了承が必要）'],
      ['経営会議・提言・改善案', 'auto', 'その日に初めてアプリを開いたとき、1日1回' + (C.todayMeeting() ? '（今日：' + { ok: '完了', partial: '一部完了', failed: '失敗' }[C.todayMeeting().status] + '）' : '（今日：まだ）')],
      ['楽天ROOMへの登録', 'manual', '紹介文とハッシュタグは自動。登録は社長がROOMで行う（ROOMは機械的な投稿を禁止しているため自動化しない）'],
      ['Instagramへの投稿', ig && ig.ready ? (ig.publishEnabled ? 'auto' : 'manual') : 'off', ig && ig.ready ? (ig.publishEnabled ? '公式APIで1日1回（予定表の投稿のみ。投稿セットの画像の公開には画像の置き場所が必要）' : '公式APIは設定済み・自動投稿はオフ') : '公式APIのトークンが未設定（Vercelに設定が必要）。今は社長が投稿し、URLを記録'],
      ['投稿結果の収集（リーチ・保存）', ig && ig.ready ? 'manual' : 'off', ig && ig.ready ? '公式APIで取得できる（画面への取り込みは未実装）' : 'Instagramの公式APIが未設定のため未取得'],
      ['ROOMへの流入・クリック・報酬', 'none', '楽天アフィリエイトの成果を取れるAPIがないため未取得。報酬は社長が月ごとに記録'],
      ['アプリを開かない時間の定時実行', 'none', '会社のデータがiPhoneの中にあり、サーバーから見えない。サーバー側の保存場所が必要（社長の承認が必要）']
    ];
    var ul = el('div', 'co-auto');
    rows.forEach(function (r) { var line = el('p', 'co-auto-row'); line.appendChild(el('span', 'tag co-state co-state-' + r[1], STATE[r[1]])); line.appendChild(el('span', 'co-auto-name', r[0])); line.appendChild(el('span', 'co-auto-note', r[2])); ul.appendChild(line); });
    box.appendChild(ul);
    // 問題・エラー（直近24時間の失敗したジョブと会議）
    var errs = failedJobs.map(function (j) { return '失敗：' + j.label + '（' + (j.error || '理由不明') + '）'; });
    var tm = C.todayMeeting();
    if (tm && tm.status === 'failed') errs.unshift('失敗：今日の経営会議（' + tm.error + '）');
    box.appendChild(el('p', errs.length ? 'hint pitch-warn' : 'hint', '問題・エラー（直近24時間）：' + (errs.length ? errs.slice(0, 4).join('／') : 'なし')));
    var row = el('div', 'pitch-row');
    row.appendChild(btn(rev ? '今月の報酬を直す' : '今月の報酬を記録する', 'status-btn', function () {
      var v = window.prompt('楽天アフィリエイトの今月の成果報酬（円。成果報告の画面の数字）', rev ? String(rev.amount) : '');
      if (v == null || v.trim() === '' || isNaN(Number(v.replace(/[,円]/g, '')))) return;
      C.setRevenue(month, Number(v.replace(/[,円]/g, '')), '楽天アフィリエイトの成果報告（社長の記録）');
      paint();
    }));
    row.appendChild(btn('AIの予算の上限を変える', 'status-btn', function () {
      var v = window.prompt('今月のAIの予算の上限（円・推定。超えるとAIを使う処理を止めます）', String(caps.capYen));
      if (v == null || !(Number(v) > 0)) return;
      A.setCaps(Number(v), 0);
      paint();
    }));
    box.appendChild(row);
    var d = el('details', 'co-more');
    d.appendChild(el('summary', null, 'AIの費用の内訳（今月・推定）'));
    d.appendChild(factList(Object.keys(cost.byType || {}).sort(function (a, b) { return cost.byType[b] - cost.byType[a]; }).map(function (k) { return k + '：' + cost.byType[k] + '回（約' + Math.round(cost.byType[k] * (A ? A.YEN_PER_CALL : 0.5) * 10) / 10 + '円）'; })));
    d.appendChild(el('p', 'hint', '1回約' + (A ? A.YEN_PER_CALL : 0.5) + '円の推定です（OpenAIの単価は第三者の情報）。実際の請求額はOpenAIの管理画面で確認してください。'));
    box.appendChild(d);
    return box;
  }

  // ---- 議事録（Markdown）：ChatGPTなどに貼れる形。全文版は会議の記録をそのまま載せる（AIで要約しない） ----
  function minutesMarkdown(m, full) {
    if (!m) return '';
    var L = [];
    var issues = (m.issues || []).concat(m.ruleIssues || []);
    var props = C.proposals().filter(function (p) { return p.meetingId === m.id || p.date === m.date; });
    var tasks = C.tasks().filter(function (t) { return t.from && t.from.id === m.id || (t.createdAt || '').slice(0, 10) === m.date; });
    L.push('# 眼科医くま 経営会議 議事録（' + m.date + '）');
    L.push('');
    L.push('- 日時：' + new Date(m.at).toLocaleString('ja-JP'));
    L.push('- 状態：' + ({ ok: '開催', partial: '一部（AIの会議は失敗。工程の確認と割り当てのみ）', failed: '失敗' }[m.status] || m.status) + (m.error ? '（' + m.error + '）' : ''));
    L.push('- 参加AI社員：' + Object.keys(ROLES).filter(function (k) { return k !== 'owner'; }).map(function (k) { return ROLES[k]; }).join('、'));
    if (m.summary) L.push('- 要点：' + m.summary);
    if (full && (m.facts || []).length) { L.push(''); L.push('## 会議で使った事実（記録から集めたもの）'); m.facts.forEach(function (f) { L.push('- ' + f.id + '（' + f.area + '）：' + f.text); }); }
    if ((m.statements || []).length) { L.push(''); L.push('## 各部署の報告'); m.statements.forEach(function (st) { L.push('- **' + ROLES[st.role] + '**：' + st.text + (full && st.facts && st.facts.length ? '（根拠：' + st.facts.join('・') + '）' : '')); }); }
    L.push(''); L.push('## 議論（問題と原因）');
    if (!issues.length) L.push('- なし');
    issues.forEach(function (i) {
      L.push('- **' + i.title + '**' + (i.days > 1 ? '（' + i.days + '日目）' : ''));
      if (i.cause) L.push('  - 原因：' + i.cause);
      if (full && (i.selfActions || []).length) L.push('  - 社員が行った対策：' + i.selfActions.join('／'));
      if (i.progress) L.push('  - ' + i.progress);
      if (i.remaining) L.push('  - 残っている課題：' + i.remaining);
    });
    L.push(''); L.push('## 決定事項');
    var decided = props.filter(function (p) { return p.status === 'approved' || p.status === 'rejected'; });
    if (!decided.length && !tasks.length) L.push('- なし');
    decided.forEach(function (p) { L.push('- 社長の判断（' + PSTATUS[p.status] + '）：' + p.title); });
    tasks.forEach(function (t) { L.push('- 業務を割り当て：' + t.title + '（' + ROLES[t.assignee] + '・期限' + (t.due || 'なし') + '）' + (full ? '｜完了条件：' + t.doneWhen : '')); });
    L.push(''); L.push('## 次のアクション');
    var next = C.tasks(true);
    if (!next.length && !(m.plan || []).length) L.push('- なし');
    (m.plan || []).forEach(function (x) { L.push('- ' + x); });
    next.slice(0, full ? 30 : 6).forEach(function (t) { L.push('- [' + STATUS[t.status] + '] ' + ROLES[t.assignee] + '：' + t.title + (full && t.output ? '（予定の成果物：' + t.output + '）' : '')); });
    L.push(''); L.push('## 未解決の課題（社長の判断待ち）');
    var open = C.proposals().filter(function (p) { return p.status === 'open' || p.status === 'hold' || p.status === 'queued'; });
    if (!open.length) L.push('- なし');
    open.forEach(function (p) { L.push('- ' + p.title + (full ? '｜求める対応：' + p.request + (p.recommend ? '｜推奨：' + p.recommend : '') + '｜根拠：' + (p.facts || []).join('／') : '')); });
    if (full) {
      var room = C.room().filter(function (r) { return (r.at || '').slice(0, 10) === m.date; });
      if (room.length) { L.push(''); L.push('## 会議室のやりとり'); room.forEach(function (r) { L.push('- ' + new Date(r.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) + ' ' + (ROLES[r.who] || r.who) + '：' + r.text); }); }
    }
    L.push('');
    L.push('（' + (full ? '全文版：会議の記録をそのまま書き出しています' : '省略版：事実の一覧・根拠・会議室のやりとりを省いています。全文は全文版で') + '）');
    return L.join('\n');
  }
  function copyMinutes(full) {
    var m = C.todayMeeting() || C.lastMeeting();
    if (!m) { K.showToast('まだ会議の記録がありません'); return; }
    K.copyText(minutesMarkdown(m, full)).then(function () { K.showToast('議事録（' + (full ? '全文' : '省略版') + '）をコピーしました'); }, function () { K.showToast('コピーできませんでした。もう一度押してください'); });
  }

  function autoRun() { if (C.consented() && !C.todayMeeting() && !busy) runMeeting(false); }
  function render(target) { container = target; paint(); }
  function badge() {
    var b = document.getElementById('company-count');
    if (!b) return;
    var n = C.proposals().filter(function (p) { return p.status === 'open'; }).slice(0, MAX_OWNER).length + C.tasks(true).filter(function (t) { return t.status === 'review'; }).length;
    b.textContent = n ? String(n) : '';
  }

  window.CompanyView = { minutesMarkdown: minutesMarkdown, render: render, runMeeting: runMeeting, ownerReply: ownerReply, doWork: doWork, collectFacts: collectFacts, pipeline: pipeline, badge: badge };
  var v = document.getElementById('company-body');
  if (location.hash.indexOf('#company') === 0 && v) render(v);
  setTimeout(function () { autoRun(); badge(); refreshJobs(); igStatus().then(function () { paint(); }); }, 1500);
  setInterval(badge, 5000);
})();
