// 「経営報告」の画面と、毎日の経営会議（アプリを開いたとき、その日にまだ会議がなければ自動で開く）。
// 1. 事実を集める（コード）：採用商品・投稿セット・探索・業務・Instagramの設定と記録。番号 F1… を付ける
// 2. 決まった問題を見つける（コード）：根拠の事実が必ずある提言だけを作る（AIが失敗しても、ここまでは残る）
// 3. AIの会議（1日1回）：社員の発言・追加の問題・提言・業務の進捗・明日の計画。根拠のないものはサーバーで落とす
// 4. 担当社員の作業：デザイナー・コピーライターの業務は、改善案を自動で作って提出する（1日1件まで＋社長が発注した直後）
// 社長は提言に「承認・却下・保留・返信」、業務に「承認・差し戻し・却下」。返信は業務になり、次の会議に引き継ぐ。
(function () {
  'use strict';

  var K = window.AppKit;
  var C = window.CompanyStore;
  if (!K || !C) return;
  var el = K.el;
  var ROLES = { editor: '編集長', designer: 'デザイナー', copywriter: 'コピーライター', buyer: 'バイヤー', sns: 'SNS担当', sales: '営業担当', ceo: '経営責任者', owner: '社長' };
  var PRI = { high: '高', mid: '中', low: '低' };
  var STATUS = { todo: '未着手', doing: '対応中', blocked: '止まっている', review: '社長の確認待ち', done: '完了', rejected: '中止' };
  var PSTATUS = { open: '未回答', approved: '承認', rejected: '却下', hold: '保留' };
  var busy = '';
  var container = null;
  var showTasks = 'open';

  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function linkBtn(text, url) { var a = el('a', 'link-btn', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function stamp(iso) { try { return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function ago(iso) { return (Date.now() - new Date(iso).getTime()) / 86400000; }
  function within(iso, days) { return iso && ago(iso) <= days; }
  function cleanName(n) { return String(n || '').replace(/[【\[].*?[】\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30); }
  function call(body, label) {
    return K.jobCall('company', body, { label: label, genre: '' }).then(function (r) {
      if (r.status !== 200) return { error: (r.data && r.data.error) || '通信できませんでした' };
      if (r.data.status === 'error') return { error: r.data.error || 'うまくいきませんでした' };
      return r.data;
    });
  }

  // ---- 1. 事実を集める（すべて、このiPhoneに残っている記録から。外部の実績は取れたものだけ） ----
  function collectFacts(igStatus) {
    var facts = [];
    var stats = {};
    function add(area, text, key) { var f = { id: 'F' + (facts.length + 1), area: area, text: text }; facts.push(f); if (key) stats[key] = f.id; return f.id; }
    var D = window.DeliveryStore; var P = window.PitchStore; var X = window.ExploreStore;
    var sets = D ? D.all() : [];
    var adoptedSets = sets.filter(function (x) { return x.status === 'adopted'; });
    var posted = sets.filter(function (x) { return x.igPost && x.igPost.url; });
    var igPosts = C.activity().filter(function (a) { return a.type === 'post' && a.status === 'sent'; });
    stats.sets = sets.length; stats.adoptedSets = adoptedSets.length; stats.posted = posted.length + igPosts.filter(function (a) { return !a.setId; }).length;
    add('sets', '投稿セット：全' + sets.length + '件（確認待ち' + sets.filter(function (x) { return x.status === 'new'; }).length + '・採用' + adoptedSets.length + '・却下' + sets.filter(function (x) { return x.status === 'rejected'; }).length + '）。直近24時間に作成' + sets.filter(function (x) { return within(x.createdAt, 1); }).length + '件', 'fSets');
    add('instagram', 'Instagramに公開した記録：' + stats.posted + '件（投稿セットの「Instagramに投稿した」と社長の記録の合計）', 'fPosted');
    var rightsPending = sets.filter(function (x) { return x.status !== 'rejected' && !x.imageRightsOk; }).length;
    stats.rightsPending = rightsPending;
    if (rightsPending) add('quality', '楽天の商品画像のInstagramでの利用条件が未確認の投稿セット：' + rightsPending + '件（品質確認で「このまま投稿しない」）', 'fRights');
    if (igStatus) add('instagram', igStatus.ready ? 'Instagramの公式API：設定済み（自動投稿は' + (igStatus.publishEnabled ? 'オン' : 'オフ') + '）' + (igStatus.account && igStatus.account.followers_count != null ? '。フォロワー ' + igStatus.account.followers_count : '') : 'Instagramの公式API：未設定（トークンなし）。投稿・反応の数字は取得できない', 'fIg');
    else add('instagram', 'Instagramの公式APIの状態：確認できなかった（通信の失敗）', 'fIg');
    var adopted = P ? P.list('adopt') : [];
    var roomDone = adopted.filter(function (p) { return p.room === 'done'; }).length;
    stats.adopted = adopted.length; stats.roomDone = roomDone;
    add('room', '採用商品：' + adopted.length + '件（直近24時間の採用' + adopted.filter(function (p) { return p.decidedAt && Date.now() - p.decidedAt < 86400000; }).length + '件）。楽天ROOMに登録済みの記録：' + roomDone + '件', 'fAdopted');
    var unusedAdopted = adopted.filter(function (p) { return !sets.some(function (x) { return x.status !== 'rejected' && (x.items || []).some(function (it) { return it.code && it.code === p.code; }); }); }).length;
    add('room', 'まだ投稿セットに入っていない採用商品：' + unusedAdopted + '件');
    var searches7 = 0; var found = 0;
    if (X) X.roots().forEach(function (n) { [n].concat(X.children(n.id)).forEach(function (m) { var pool = X.pool(m.id); if (pool) { found += pool.items.length; searches7 += pool.batches.filter(function (b) { return within(b.at, 7); }).length; } }); });
    stats.searches7 = searches7;
    add('explore', '商品探索（広げる）：直近7日の探索' + searches7 + '回（起点と1段目の商品の分）。蓄積した候補' + found + '件', 'fExplore');
    var tasks = C.tasks(true);
    var overdue = tasks.filter(function (t) { return t.due && t.due < C.today() && t.status !== 'review'; });
    var review = tasks.filter(function (t) { return t.status === 'review'; });
    stats.overdue = overdue.length; stats.review = review.length;
    add('tasks', '未完了の業務：' + tasks.length + '件（期限切れ' + overdue.length + '・社長の確認待ち' + review.length + '）', 'fTasks');
    var openP = C.proposals('open');
    var oldest = openP.reduce(function (m, p) { return Math.max(m, ago(p.createdAt)); }, 0);
    stats.openProposals = openP.length; stats.oldestDays = Math.floor(oldest);
    add('owner', '社長が未回答の提言：' + openP.length + '件' + (openP.length ? '（最も古いもので' + Math.floor(oldest) + '日）' : ''), 'fOwner');
    // 実際に行った作業（記録があるものだけ。直近24時間）
    sets.filter(function (x) { return within(x.createdAt, 1); }).slice(0, 3).forEach(function (x) { add('activity', stamp(x.createdAt) + ' 投稿セット「' + (x.titleEdit || x.title) + '」を制作（記録：投稿セットの作成日時）'); });
    posted.filter(function (x) { return within(x.igPost.at, 1); }).forEach(function (x) { add('activity', stamp(x.igPost.at) + ' 社長がInstagramに投稿「' + (x.titleEdit || x.title) + '」（記録：' + x.igPost.url + '）'); });
    C.activity().filter(function (a) { return a.status === 'sent' && within(a.at, 1); }).slice(0, 5).forEach(function (a) { add('activity', stamp(a.at) + ' ' + a.label + '（記録：' + (a.url || 'URLなし') + '・' + (a.by === 'owner' ? '社長が記録' : 'APIの結果') + '）'); });
    C.tasks().filter(function (t) { return (t.deliverables || []).some(function (d) { return within(d.at, 1); }); }).slice(0, 3).forEach(function (t) { add('activity', '業務「' + t.title + '」の成果物を提出（' + ROLES[t.assignee] + '）'); });
    return { facts: facts, stats: stats };
  }

  // ---- 2. 決まった問題（根拠の事実が必ずある） ----
  function ruleItems(st, ids) {
    var issues = []; var proposals = [];
    if (st.adoptedSets > 0 && st.posted === 0) {
      issues.push({ title: '採用済みの投稿セットがあるのに、Instagramでの公開を確認できない', cause: '公開の記録が0件。公開したかどうかが分からない', facts: [ids.fSets, ids.fPosted], owner: 'sns' });
      proposals.push({ ruleKey: 'ig_unpublished', role: 'sns', kind: 'confirm', title: '社長、採用済みの投稿セットが' + st.adoptedSets + '件ありますが、Instagramでの公開を確認できていません', facts: [ids.fSets, ids.fPosted], impact: '公開されないと反応を測れず、画像や企画の改善の効果を検証できません', request: '公開したら投稿セットの「Instagramに投稿した」で投稿URLを記録してください。公開しない理由があれば返信してください' });
    } else if (st.sets > 0 && st.adoptedSets === 0) {
      proposals.push({ ruleKey: 'no_adopted_set', role: 'editor', kind: 'decision', title: '社長、投稿セットが' + st.sets + '件ありますが、採用が0件です', facts: [ids.fSets], impact: '採用されないと公開に進めず、何が足りないのかも分かりません', request: '採用できない理由（画像・商品・文章のどれか）を返信してください。改善の業務にします' });
    }
    if (st.adopted > 0 && st.roomDone === 0) proposals.push({ ruleKey: 'room_unconfirmed', role: 'sales', kind: 'confirm', title: '社長、採用商品が' + st.adopted + '件ありますが、楽天ROOMへの登録を確認できていません', facts: [ids.fAdopted], impact: 'ROOMに登録されていないと、Instagramから来た人が買える場所がなく、収益になりません', request: '登録した商品は「採用済み」で「ROOMに登録した」を押してください。未登録なら、登録できない理由を返信してください' });
    if (ids.fRights) {
      issues.push({ title: '投稿セットを公開できる完成品として扱えない', cause: '楽天の商品画像のInstagramでの利用条件が未確認', facts: [ids.fRights], owner: 'designer' });
      proposals.push({ ruleKey: 'image_rights', role: 'designer', kind: 'decision', title: '社長、楽天の商品画像をInstagramに使ってよいかが未確認のため、投稿セットを完成品にできません', facts: [ids.fRights], impact: 'このままでは、画像を何度作り直しても公開できる完成品になりません', request: '楽天アフィリエイトの規約を確認するか、商品画像を使わない作り方（文字と図・自分で撮った写真）に切り替えるか判断してください' });
    }
    if (st.searches7 >= 3 && st.posted === 0) proposals.push({ ruleKey: 'discover_over_post', role: 'ceo', kind: 'decision', title: '社長、商品の探索は進んでいますが（直近7日で' + st.searches7 + '回）、公開は0件です。今週は新規発掘より投稿公開を優先することを提案します', facts: [ids.fExplore, ids.fPosted], impact: '発掘だけでは集客・収益の数字が動かず、何が売れるかの検証もできません', request: '今週の優先を「公開」にしてよいか、承認か却下で答えてください' });
    if (st.overdue > 0) issues.push({ title: '期限を過ぎた業務が' + st.overdue + '件ある', cause: '担当の作業が止まっているか、社長の判断待ち', facts: [ids.fTasks], owner: 'ceo' });
    if (st.review > 0) proposals.push({ ruleKey: 'review_waiting', role: 'ceo', kind: 'confirm', title: '社長、確認待ちの成果物が' + st.review + '件あります', facts: [ids.fTasks], impact: '確認がないと、担当は次の改善に進めません', request: '「業務」で承認・差し戻し・却下のどれかを押してください' });
    if (st.openProposals >= 3 && st.oldestDays >= 3) issues.push({ title: '社長の未回答の提言がたまっている', cause: '最も古いもので' + st.oldestDays + '日', facts: [ids.fOwner], owner: 'ceo' });
    return { issues: issues, proposals: proposals };
  }

  function taskBrief(t) {
    var d = (t.deliverables || []).slice(-1)[0];
    return { id: t.id, title: t.title, assignee: t.assignee, priority: t.priority, due: t.due, doneWhen: t.doneWhen, status: t.status, lastProgress: ((t.progress || []).slice(-1)[0] || {}).text || '', deliverable: d ? (d.summary || d.type) : '', ownerCheck: t.ownerCheck };
  }
  function setsBrief() {
    var D = window.DeliveryStore;
    return (D ? D.all() : []).filter(function (x) { return x.status !== 'rejected'; }).slice(0, 6).map(function (x) {
      var ps = (x.items || []).map(function (it) { return it.price; }).filter(Boolean);
      return { title: x.titleEdit || x.title, pattern: x.patternLabel || x.pattern, coverStyle: x.coverStyle || '自動', items: (x.items || []).length, prices: ps.length ? Math.min.apply(null, ps) + '〜' + Math.max.apply(null, ps) + '円' : '', imageSource: '楽天の商品画像', issues: (x.issues || []).concat(x.imageRightsOk ? [] : ['画像の権利が未確認']).join('／').slice(0, 150), status: x.status };
    });
  }

  // ---- 3. 毎日の経営会議 ----
  function runMeeting(manual) {
    if (busy) return Promise.resolve();
    busy = '経営会議を開いています（事実を集めて、社員が話し合っています）';
    paint();
    var igP = K.postJson('api/ig', { action: 'status' }).then(function (r) { return r.status === 200 ? r.data : null; }, function () { return null; });
    return igP.then(function (ig) {
      var col = collectFacts(ig);
      var ids = col.stats; // fXxx の番号
      if (ig && !ig.ready) ids.fIgUnset = true;
      var rule = ruleItems(col.stats, ids);
      if (ig && !ig.ready) rule.proposals.push({ ruleKey: 'ig_api', role: 'sns', kind: 'decision', title: '社長、Instagramの公式APIが未設定のため、自動投稿も反応の数字の取得もできません', facts: [ids.fIg], impact: '公開と効果測定を社長の手作業に頼ることになり、改善の速度が落ちます', request: '自動投稿を使うか判断してください。使う場合は、Metaの開発者サイトでトークンを作り、Vercelにだけ入れてください（この会話やアプリには貼らない）' });
      var last = C.lastMeeting();
      var body = { action: 'meeting', date: C.today(), facts: col.facts, tasks: C.tasks(true).map(taskBrief), ownerNotes: C.pendingNotes(), improvements: C.improvements().slice(0, 15), lastPlan: last && last.plan ? last.plan : [] };
      return call(body, '経営会議（' + C.today() + '）').then(function (r) {
        var ai = r.meeting || null;
        var m = C.addMeeting({ date: C.today(), manual: !!manual, status: ai ? 'ok' : 'partial', error: r.error || '', facts: col.facts, ruleIssues: rule.issues, summary: ai ? ai.summary : '（AIの会議に失敗したため、決まった確認だけ行いました）', statements: ai ? ai.statements : [], issues: ai ? ai.issues : [], plan: ai ? ai.plan : [] });
        // 提言（決まった規則の分＋AIの分）。事実の文を写して残す（あとから見ても根拠が分かるように）
        var factText = function (fid) { var f = col.facts.filter(function (x) { return x.id === fid; })[0]; return f ? f.text : ''; };
        rule.proposals.concat(ai ? ai.proposals : []).forEach(function (p) {
          C.upsertProposal(Object.assign({}, p, { ruleKey: p.ruleKey || 'ai:' + p.role + ':' + p.title.slice(0, 40), meetingId: m.id, date: m.date, source: p.ruleKey ? 'rule' : 'ai', facts: p.facts.map(factText).filter(Boolean) })); // 同じ提言が未回答のまま残っていれば、新しく増やさず「何回目の指摘」にする
        });
        if (ai) {
          // 社長の確認待ち・完了した業務の状態は、会議では変えない（進捗のメモだけ残す。確認前にやり直させない）
          ai.taskUpdates.forEach(function (u) { var t = C.task(u.id); var locked = t && { review: 1, done: 1, rejected: 1 }[t.status]; C.progress(u.id, u.note, 'ceo', locked ? null : u.status || null); });
          ai.newTasks.forEach(function (t) { C.addTask(Object.assign({}, t, { from: { type: 'meeting', id: m.id } })); });
          ai.improvements.forEach(function (x) { C.addImprovement(Object.assign({ from: 'meeting ' + m.date }, x)); });
        }
        busy = '';
        paint();
        // 4. 担当社員の作業：改善案のまだない、デザイナー・コピーライターの業務を1件だけ進める（費用を抑えるため1日1件）
        var next = C.tasks(true).filter(function (t) { return (t.status === 'todo' || t.status === 'doing') && (t.assignee === 'designer' || t.assignee === 'copywriter'); })[0];
        if (next) return doWork(next.id);
      });
    }).catch(function (e) {
      C.addMeeting({ date: C.today(), status: 'failed', error: e.message, summary: '会議を開けませんでした' });
      busy = ''; paint();
    });
  }

  // ---- 4. 担当社員の作業（改善案・作業計画の提出） ----
  function doWork(tid) {
    var t = C.task(tid);
    if (!t) return Promise.resolve();
    busy = ROLES[t.assignee] + 'が「' + t.title.slice(0, 20) + '」に取り組んでいます';
    C.progress(tid, '作業を開始', t.assignee, 'doing');
    paint();
    return call({ action: 'work', task: taskBrief(t), sets: setsBrief(), ownerNote: t.ownerNote || '', facts: collectFacts(null).facts.filter(function (f) { return f.area !== 'activity'; }) }, '業務：' + t.title.slice(0, 16)).then(function (r) {
      busy = '';
      if (r.error) { C.progress(tid, '作業に失敗：' + r.error + '（次の会議でやり直します）', t.assignee, 'blocked'); paint(); return; }
      C.addDeliverable(tid, r.deliverable, t.assignee);
      if (r.deliverable.type === 'design') (r.deliverable.changes || []).slice(0, 2).forEach(function (c) { C.addImprovement({ problem: '画像：' + t.title.slice(0, 40), idea: c, from: '業務 ' + t.id }); });
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
      var made = r.newTasks.map(function (t) { return C.addTask(Object.assign({}, t, { from: { type: 'reply', text: text.slice(0, 120), about: about ? about.title : '' } })); });
      if (made.length) C.say('ceo', '業務を登録しました：' + made.map(function (t) { return '「' + t.title + '」（' + ROLES[t.assignee] + '・期限' + t.due + '）'; }).join('、'), about);
      paint();
      // デザイナー・コピーライターの業務は、その場で改善案に取りかかる
      var w = made.filter(function (t) { return t.assignee === 'designer' || t.assignee === 'copywriter'; })[0];
      if (w) return doWork(w.id);
    });
  }

  // 改善案から、改善版の投稿セットを作る（元のセットは残す。商品は同じで、表紙の見出しと型を変える）
  function makeImprovedSet(tid, di, variant, style) {
    var D = window.DeliveryStore;
    var base = D && D.all().filter(function (x) { return x.status !== 'rejected' && !x.improvedFrom; })[0];
    if (!base) { K.showToast('改善版の元になる投稿セットがありません'); return; }
    var copy = JSON.parse(JSON.stringify(base));
    copy.id = base.id + '-v' + Date.now().toString(36).slice(-4);
    copy.status = 'new';
    copy.createdAt = new Date().toISOString();
    copy.titleEdit = variant.title;
    copy.coverStyle = style;
    copy.improvedFrom = base.id;
    copy.improveNote = '業務の改善案（' + variant.angle + '）から作った改善版：表紙の見出しと型を変更（商品と画像の作り方は同じ）';
    delete copy.decidedAt; delete copy.igPost; delete copy.alt;
    D.save(copy);
    C.updateDeliverable(tid, di, { improvedSetId: copy.id, improvedAt: new Date().toISOString() });
    C.progress(tid, '改善版の投稿セット「' + variant.title + '」を作成（元：「' + (base.titleEdit || base.title) + '」）', 'designer');
    C.addImprovement({ problem: '表紙の見出しが似ている・興味を引けない', idea: variant.angle + 'の切り口の見出し「' + variant.title + '」と表紙の型 ' + style, from: '業務 ' + tid, status: 'adopted' });
    K.showToast('改善版の投稿セットを作りました（「投稿セット」で画像を確認できます）');
    paint();
  }

  // ---- 画面 ----
  function section(title, open) { var d = el('details', 'card co-sec'); d.open = open !== false; d.appendChild(el('summary', 'co-h', title)); return d; }
  function factList(list) { var ul = el('ul', 'co-facts'); (list || []).forEach(function (f) { ul.appendChild(el('li', null, typeof f === 'string' ? f : f.text)); }); return ul; }

  function proposalCard(p) {
    var c = el('div', 'co-prop');
    c.appendChild(el('p', 'co-who', ROLES[p.role] + (p.times > 1 ? '（' + p.times + '回目の指摘）' : '') + '｜' + PSTATUS[p.status]));
    c.appendChild(el('p', 'co-title', p.title));
    c.appendChild(el('p', 'co-label', '根拠'));
    c.appendChild(factList(p.facts));
    c.appendChild(el('p', 'hint', '業務への影響：' + p.impact));
    c.appendChild(el('p', 'hint co-req', '求める対応：' + p.request));
    (p.replies || []).slice(-3).forEach(function (r) { c.appendChild(el('p', 'co-reply', (ROLES[r.who] || r.who) + '：' + r.text)); });
    var row = el('div', 'pitch-row');
    if (p.status === 'open' || p.status === 'hold') {
      row.appendChild(btn('承認', 'btn btn-primary co-sbtn', function () { C.decideProposal(p.id, 'approved', ''); K.showToast('承認を記録しました（次の会議に引き継ぎます）'); paint(); }));
      row.appendChild(btn('却下', 'status-btn', function () { var r = window.prompt('却下の理由（任意）', ''); if (r == null) return; C.decideProposal(p.id, 'rejected', r.trim()); paint(); }));
      if (p.status !== 'hold') row.appendChild(btn('保留', 'status-btn', function () { C.decideProposal(p.id, 'hold', ''); paint(); }));
    }
    row.appendChild(btn('返信する', 'status-btn', function () {
      var r = window.prompt('社員への返信・追加の指示（業務になります）', '');
      if (!r || !r.trim()) return;
      ownerReply(r.trim(), { proposalId: p.id, title: p.title, text: p.request, role: p.role });
    }));
    c.appendChild(row);
    return c;
  }

  function deliverableView(t, d, di) {
    var w = el('div', 'co-deliv');
    w.appendChild(el('p', 'co-label', '成果物（' + stamp(d.at) + '・' + ROLES[d.by] + '）'));
    if (d.summary) w.appendChild(el('p', null, d.summary));
    if (d.type === 'design') {
      var dl = el('dl', 'radar-facts');
      d.diagnosis.forEach(function (x) { dl.appendChild(el('dt', null, x.point + '：' + '★★★★★'.slice(0, x.score) + '☆☆☆☆☆'.slice(0, 5 - x.score))); dl.appendChild(el('dd', null, x.finding)); });
      w.appendChild(el('p', 'co-label', '今の画像の評価（渡された情報からの評価。画像の細部は見ていません）'));
      w.appendChild(dl);
      w.appendChild(el('p', 'co-label', '改善の内容'));
      var ul = el('ul', 'co-facts'); d.changes.forEach(function (x) { ul.appendChild(el('li', null, x)); }); w.appendChild(ul);
      w.appendChild(el('p', 'co-label', '表紙の見出しの案（切り口を変えて）'));
      d.copyVariants.forEach(function (v) {
        var r = el('div', 'co-variant');
        r.appendChild(el('span', 'tag', v.angle));
        r.appendChild(el('span', 'co-vtitle', v.title));
        r.appendChild(btn(d.improvedSetId ? '改善版を作り直す' : 'この見出しで改善版を作る', 'status-btn co-sbtn', function () { makeImprovedSet(t.id, di, v, d.coverStyle); }));
        w.appendChild(r);
      });
      if (d.improvedSetId) w.appendChild(btn('改善版の投稿セットを見る', 'btn btn-secondary', function () { if (window.PitchView) window.PitchView.show('sets'); }));
      if (d.tool) {
        var tc = el('div', 'co-tool');
        tc.appendChild(el('p', 'co-label', 'ツール導入の提案：' + d.tool.name));
        [['今の問題', d.tool.problem], ['期待できる改善', d.tool.expected], ['無料で使える範囲', d.tool.free], ['追加費用', d.tool.cost], ['API・自動化', d.tool.api], ['社長に必要な操作', d.tool.ownerSteps], ['導入しない場合の代替案', d.tool.alternative], ['注意', d.tool.limits], ['確認日', d.tool.checked]].forEach(function (x) { if (x[1]) tc.appendChild(el('p', 'hint', x[0] + '：' + x[1])); });
        (d.tool.sources || []).forEach(function (u) { tc.appendChild(linkBtn('出典', u)); });
        tc.appendChild(el('p', 'hint', '有料の契約・課金は、社長の承認なしに行いません。成功の条件はツールの導入ではなく、制作物の質が上がることです。'));
        if (!d.toolDecision) {
          var tr = el('div', 'pitch-row');
          tr.appendChild(btn('導入を検討する（承認）', 'btn btn-primary co-sbtn', function () { C.updateDeliverable(t.id, di, { toolDecision: '承認' }); C.addTask({ title: d.tool.name + 'の試用と比較（契約は社長が行う）', assignee: 'designer', priority: 'mid', due: C.today(), doneWhen: '同じ投稿セットを今の作り方と比べた試作1件を社長に提出', from: { type: 'tool', id: t.id } }); C.say('owner', 'ツール「' + d.tool.name + '」の導入を検討する（承認）', { title: t.title }); paint(); }));
          tr.appendChild(btn('却下', 'status-btn', function () { C.updateDeliverable(t.id, di, { toolDecision: '却下' }); C.say('owner', 'ツール「' + d.tool.name + '」は導入しない', { title: t.title }); paint(); }));
          tr.appendChild(btn('保留', 'status-btn', function () { C.updateDeliverable(t.id, di, { toolDecision: '保留' }); paint(); }));
          tc.appendChild(tr);
        } else tc.appendChild(el('p', 'hint', '社長の判断：' + d.toolDecision));
        w.appendChild(tc);
      }
    } else if (d.type === 'plan') {
      var ol = el('ol', 'co-facts'); (d.steps || []).forEach(function (x) { ol.appendChild(el('li', null, x + '（予定）')); }); w.appendChild(ol);
      if (d.needOwner) w.appendChild(el('p', 'hint co-req', '社長に必要な操作：' + d.needOwner));
    }
    if (d.nextStep) w.appendChild(el('p', 'hint co-req', '社長に確認してほしいこと：' + d.nextStep));
    return w;
  }

  function taskCard(t) {
    var c = el('details', 'co-task');
    var head = el('summary');
    head.appendChild(el('span', 'tag co-st co-' + t.status, STATUS[t.status]));
    head.appendChild(el('span', 'co-ttitle', t.title));
    c.appendChild(head);
    c.appendChild(el('p', 'hint', '担当：' + ROLES[t.assignee] + '｜優先：' + PRI[t.priority] + '｜期限：' + (t.due || 'なし') + (t.due && t.due < C.today() && !{ done: 1, rejected: 1 }[t.status] ? '（期限切れ）' : '') + '｜社長の確認：' + t.ownerCheck));
    c.appendChild(el('p', 'hint', '発注内容：' + (t.from && t.from.text ? '「' + t.from.text + '」' : t.from && t.from.type === 'meeting' ? '経営会議で決定' : t.title)));
    c.appendChild(el('p', 'hint', '完了条件：' + t.doneWhen));
    var pr = el('ul', 'co-facts co-progress');
    (t.progress || []).slice(-6).forEach(function (p) { pr.appendChild(el('li', null, stamp(p.at) + ' ' + (ROLES[p.by] || '') + '：' + p.text)); });
    if ((t.progress || []).length) { c.appendChild(el('p', 'co-label', '進捗')); c.appendChild(pr); }
    (t.deliverables || []).forEach(function (d, i) { if (i === t.deliverables.length - 1) c.appendChild(deliverableView(t, d, i)); });
    var row = el('div', 'pitch-row');
    if (t.status === 'review') {
      row.appendChild(btn('承認（完了）', 'btn btn-primary co-sbtn', function () { C.checkTask(t.id, 'approve', ''); paint(); }));
      row.appendChild(btn('差し戻し（追加指示）', 'status-btn', function () {
        var r = window.prompt('どこを直してほしいですか（担当がやり直します）', '');
        if (!r || !r.trim()) return;
        C.checkTask(t.id, 'revise', r.trim());
        C.say('owner', r.trim(), { title: t.title, taskId: t.id }, true); // 引き継ぎのメモは checkTask で残している（二重にしない）
        doWork(t.id);
      }));
      row.appendChild(btn('却下', 'status-btn', function () { C.checkTask(t.id, 'reject', ''); paint(); }));
    } else if (!{ done: 1, rejected: 1 }[t.status] && (t.assignee === 'designer' || t.assignee === 'copywriter')) {
      row.appendChild(btn('今すぐ取りかかってもらう', 'status-btn', function () { if (busy) return; doWork(t.id); }));
    }
    if (row.childNodes.length) c.appendChild(row);
    return c;
  }

  function roomView() {
    var box = el('div', 'co-room');
    var m = C.todayMeeting() || C.lastMeeting();
    if (m && m.statements && m.statements.length) {
      box.appendChild(el('p', 'co-label', m.date + 'の会議での発言'));
      m.statements.forEach(function (s) { box.appendChild(el('p', 'co-msg', ROLES[s.role] + '：' + s.text)); });
    }
    var msgs = C.room().slice(-14);
    if (msgs.length) box.appendChild(el('p', 'co-label', '会議室のやりとり'));
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
    var m = C.todayMeeting() || C.lastMeeting();
    var acts = m && m.facts ? m.facts.filter(function (f) { return f.area === 'activity'; }) : [];
    box.appendChild(el('p', 'co-label', 'アプリ内で実際に行った作業（記録のあるものだけ・直近24時間）'));
    if (acts.length) box.appendChild(factList(acts)); else box.appendChild(el('p', 'hint', '記録のある作業はありません。'));
    box.appendChild(el('p', 'co-label', 'Instagramでの活動'));
    var ig = C.activity();
    if (ig.length) {
      var ul = el('ul', 'co-facts');
      ig.slice(0, 15).forEach(function (a) { ul.appendChild(el('li', null, stamp(a.at) + '｜' + a.label + '｜' + (a.account ? '@' + a.account + '｜' : '') + (a.text ? '「' + a.text + '」｜' : '') + { sent: '実行済み', failed: '失敗', draft: '案のみ（未実行）' }[a.status] + '｜' + (a.by === 'owner' ? '社長の記録' : 'APIの結果') + (a.url ? '｜' + a.url : ''))); });
      box.appendChild(ul);
    } else box.appendChild(el('p', 'hint', '記録はありません（公開・コメント・いいねの実行は0件として扱います）。'));
    box.appendChild(el('p', 'hint', 'AI社員はInstagramにコメント・いいね・フォローをしていません。公式APIでは他のアカウントの投稿へのコメントが提供されておらず、非公式な自動操作は規約違反の恐れがあるためです。社長が自分で行った場合は、下から記録できます。'));
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
      head.appendChild(el('p', 'hint', 'AI社員が毎日1回、経営会議を開きます（アプリを開いたとき、その日にまだ会議がなければ自動で開きます）。AIの呼び出しは1日2回程度（会議1回＋担当社員の作業1件）、今のOpenAIのキーで1日約1〜2円の見込みです。新しいサービスの契約はありません。'));
      head.appendChild(btn('了承して、毎日の経営会議を始める', 'btn btn-discover', function () { C.setConsent(); runMeeting(false); }));
      container.appendChild(head);
      return;
    }
    if (busy) head.appendChild(el('p', 'hint pitch-busy', busy + '…（20〜60秒）'));
    if (tm) head.appendChild(el('p', 'hint', stamp(tm.at) + ' 会議' + { ok: '済み', partial: '済み（AIの会議は失敗。決まった確認だけ）', failed: '失敗' }[tm.status] + (tm.error ? '：' + tm.error : '') + (tm.summary ? '｜' + tm.summary : '')));
    else if (!busy) head.appendChild(el('p', 'hint', '今日の会議はまだです。'));
    if (!busy) head.appendChild(btn(tm ? 'もう一度会議を開く' : '今すぐ会議を開く', 'status-btn', function () { runMeeting(true); }));
    container.appendChild(head);
    var m = tm || C.lastMeeting();

    // 本日の成果（実際に完了した仕事と成果物だけ）
    var s1 = section('本日の成果');
    var done = C.tasks().filter(function (t) { return t.status === 'done' && t.updatedAt && within(t.updatedAt, 1); });
    var dels = C.tasks().filter(function (t) { return (t.deliverables || []).some(function (d) { return within(d.at, 1); }); });
    var acts = m && m.facts ? m.facts.filter(function (f) { return f.area === 'activity'; }) : [];
    if (!done.length && !dels.length && !acts.length) s1.appendChild(el('p', 'hint', '記録のある成果はありません。'));
    done.forEach(function (t) { s1.appendChild(el('p', null, '完了：' + t.title + '（' + ROLES[t.assignee] + '）')); });
    dels.forEach(function (t) { s1.appendChild(el('p', null, '成果物を提出：' + t.title + '（' + ROLES[t.assignee] + '・' + STATUS[t.status] + '）')); });
    if (acts.length) s1.appendChild(factList(acts));
    container.appendChild(s1);

    // 本日の問題
    var s2 = section('本日の問題');
    var issues = m ? (m.ruleIssues || []).concat(m.issues || []) : [];
    if (!issues.length) s2.appendChild(el('p', 'hint', m ? '会議で挙がった問題はありません。' : 'まだ会議を開いていません。'));
    issues.forEach(function (i) { var p = el('div', 'co-issue'); p.appendChild(el('p', 'co-title', i.title)); if (i.cause) p.appendChild(el('p', 'hint', '原因：' + i.cause + '｜担当：' + ROLES[i.owner])); s2.appendChild(p); });
    container.appendChild(s2);

    // 社員から社長への提言・社長への確認事項
    var open = C.proposals().filter(function (p) { return p.status === 'open' || p.status === 'hold'; });
    var s3 = section('社員から社長への提言（' + open.filter(function (p) { return p.kind === 'decision'; }).length + '）');
    open.filter(function (p) { return p.kind === 'decision'; }).forEach(function (p) { s3.appendChild(proposalCard(p)); });
    if (!s3.querySelector('.co-prop')) s3.appendChild(el('p', 'hint', '未回答の提言はありません。'));
    container.appendChild(s3);
    var review = C.tasks(true).filter(function (t) { return t.status === 'review'; });
    var s4 = section('社長への確認事項（' + (open.filter(function (p) { return p.kind !== 'decision'; }).length + review.length) + '）');
    open.filter(function (p) { return p.kind !== 'decision'; }).forEach(function (p) { s4.appendChild(proposalCard(p)); });
    review.forEach(function (t) { var c = taskCard(t); c.open = true; s4.appendChild(c); });
    if (!s4.querySelector('.co-prop, .co-task')) s4.appendChild(el('p', 'hint', '確認事項はありません。'));
    container.appendChild(s4);

    // 明日の改善計画
    var s5 = section('明日の改善計画');
    if (m && m.plan && m.plan.length) { var ol = el('ol', 'co-facts'); m.plan.forEach(function (p) { ol.appendChild(el('li', null, p)); }); s5.appendChild(ol); } else s5.appendChild(el('p', 'hint', '計画はありません。'));
    container.appendChild(s5);

    // 実行履歴
    var s6 = section('実行履歴（記録のある操作だけ）', false);
    s6.appendChild(activityView());
    container.appendChild(s6);

    // 業務
    var all = C.tasks();
    var s7 = section('業務（発注の一覧・' + all.filter(function (t) { return !{ done: 1, rejected: 1 }[t.status]; }).length + '件が未完了）');
    var tabs = el('div', 'xp-filter');
    [['open', '未完了'], ['all', 'すべて']].forEach(function (x) { tabs.appendChild(btn(x[1], 'xp-chip' + (showTasks === x[0] ? ' active' : ''), function () { showTasks = x[0]; paint(); })); });
    s7.appendChild(tabs);
    var list = showTasks === 'open' ? C.tasks(true) : all;
    if (!list.length) s7.appendChild(el('p', 'hint', '業務はありません。会議室で発注すると、ここに入ります。'));
    list.forEach(function (t) { s7.appendChild(taskCard(t)); });
    container.appendChild(s7);

    // 会議室
    var s8 = section('会議室（社員への返信・反論・追加発注）');
    s8.appendChild(roomView());
    container.appendChild(s8);

    // 改善の記録
    var s9 = section('改善の記録（' + C.improvements().length + '）', false);
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

    // 過去の会議
    var s10 = section('過去の会議（' + C.meetings().length + '）', false);
    C.meetings().slice(0, 30).forEach(function (mm) {
      var d = el('details', 'co-task');
      d.appendChild(el('summary', null, mm.date + '｜' + { ok: '開催', partial: '一部（AIなし）', failed: '失敗' }[mm.status] + '｜' + (mm.summary || '')));
      if (mm.error) d.appendChild(el('p', 'hint pitch-warn', '失敗の記録：' + mm.error));
      (mm.statements || []).forEach(function (s) { d.appendChild(el('p', 'co-msg', ROLES[s.role] + '：' + s.text)); });
      if ((mm.plan || []).length) d.appendChild(el('p', 'hint', '計画：' + mm.plan.join('／')));
      if ((mm.facts || []).length) { d.appendChild(el('p', 'co-label', 'この日の事実')); d.appendChild(factList(mm.facts)); }
      s10.appendChild(d);
    });
    container.appendChild(s10);
  }

  // 毎日の会議：アプリを開いたとき（どの画面でも）、了承済みで今日の会議がなければ開く
  function autoRun() {
    if (C.consented() && !C.todayMeeting() && !busy) runMeeting(false);
  }
  function render(target) { container = target; paint(); }
  function badge() {
    var b = document.getElementById('company-count');
    if (!b) return;
    var n = C.proposals('open').length + C.tasks(true).filter(function (t) { return t.status === 'review'; }).length;
    b.textContent = n ? String(n) : '';
  }

  window.CompanyView = { render: render, runMeeting: runMeeting, ownerReply: ownerReply, doWork: doWork, collectFacts: collectFacts, badge: badge };
  var v = document.getElementById('company-body');
  if (location.hash.indexOf('#company') === 0 && v) render(v);
  setTimeout(function () { autoRun(); badge(); }, 1500);
  setInterval(badge, 5000);
})();
