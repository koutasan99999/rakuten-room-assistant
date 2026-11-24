// サングラスくま株式会社 2.0 の画面（2026-11-15・2026-11-16 24時間の自律運営に対応）。サーバー（/api/v2）の状態だけを表示する。点数・技術ログは出さない
(function () {
  'use strict';
  var PASS_KEY = 'room-passcode'; // 1.0と同じ合言葉
  var SEEN_KEY = 'v2-seen-notice';
  var state = null, seenAt = '', openSet = null, tab = 'office';
  var COLOR = { buyer: '#2f6f9f', auditor: '#3d7a4f', planner: '#a0522d', writer: '#7b4fa0', editor: '#b5893a', designer: '#c0504d', pr: '#2b2b2b', appraiser: '#3b6e8f', owner: '#c49a00' };
  // 担当中＝今この瞬間に処理しているときだけ（2026-11-16）。ほかは理由ごとに分ける
  var ST_LABEL = { work: '仕事中', queued: '順番待ち（続けて進めます）', handoff: '引き継ぎ中', approval: '承認待ち', error: 'エラー・再試行待ち', budget: '予算待ち', wait: '画像待ち', idle: '仕事なし' };
  var WAIT_LABEL = { image: '画像待ち', budget: '予算待ち', retry: '再試行待ち', quota: 'OpenAIの残高待ち', slot: '完成品の枠待ち（企画と商品は保存済み）', hold: '保留（商品が6点に足りない。24時間後にもう一度探す）', stopped: '停止中（新規ROOM商品紹介の停止・社長の再開待ち）' };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = el('button', cls || 'btn', text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) {} return ''; }
  function pass() { return store(PASS_KEY); }
  function hm(iso) { var d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function day(iso) { var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function today(iso) { return new Date(iso).toDateString() === new Date().toDateString(); }
  function yen(n) { return (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('ja-JP') + '円'; }
  function pct(n) { return n == null ? '未集計' : n + '%'; }
  function nameOf(id) { if (id === 'owner') return '社長'; var s = state && state.staff.filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }

  function api(body) {
    return fetch('../api/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-passcode': pass() }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); });
  }
  function askPass() { $('pass').hidden = false; $('pass-input').focus(); }
  $('pass-form').addEventListener('submit', function (e) { e.preventDefault(); store(PASS_KEY, $('pass-input').value.trim()); $('pass').hidden = true; refresh(); });

  function refresh() {
    return api({ action: 'state' }).then(function (r) {
      if (r.status === 401) return askPass();
      if (r.status !== 200 || !r.data.configured) { $('top-status').textContent = (r.data && r.data.error) || '読み込めませんでした'; return; }
      var prev = state; state = r.data;
      // 新しく届いた引き継ぎの記録だけ、書類が飛ぶ（架空の動きはしない）
      if (prev) state.events.filter(function (e) { return e.type === 'handoff' && e.at > seenAt; }).reverse().forEach(function (e) { Office.handoff(e.agent, e.to); });
      seenAt = state.events[0] ? state.events[0].at : seenAt;
      render();
    }, function () { $('top-status').textContent = '通信できませんでした（次に自動で読み直します）'; });
  }

  // 案件の内訳（実態どおり：進む／社長の承認待ち／画像待ちなどを分けて出す。承認待ちは「進行中」に数えない）
  function caseLine(s) {
    var m = s.summary || { total: s.cases.length, advancing: s.cases.filter(function (c) { return !c.wait; }).length, approval: 0, image: 0, budget: 0, error: 0 };
    var parts = [];
    if (m.running) parts.push('実行中' + m.running + '件');
    if (m.queued) parts.push('次の定期実行で進む' + m.queued + '件');
    if (m.approval) parts.push('社長の承認待ち（完成品の枠待ち）' + m.approval + '件');
    if (m.image) parts.push('画像待ち' + m.image + '件');
    if (m.budget) parts.push('予算・残高待ち' + m.budget + '件');
    if (m.error) parts.push('エラー・保留' + m.error + '件');
    if (m.stopped) parts.push('停止中（新規紹介の停止）' + m.stopped + '件');
    return '案件' + m.total + '件：' + parts.join('／') + (m.advancing ? '' : '（いま進められる案件は0件。理由は下の案件ごとの表示）');
  }
  function render() {
    var s = state;
    var working = s.staff.filter(function (x) { return x.status === 'work'; })[0];
    var active = s.cases.filter(function (c) { return !c.wait; }).length;
    if (s.quota) { $('top-status').textContent = 'OpenAIの残高がないため、AIを使う仕事を止めています。残高が戻ったら自動で続きから再開します（次に確かめる時刻 ' + hm(s.quota.until) + '）'; } else
    $('top-status').textContent = working ? working.name + 'が仕事中' : s.cases.length ? caseLine(s) : s.blocked ? '今日のAIの費用の上限に達しました。明日0時に戻ったら再開します' : s.idle || '次の定期実行で新しい仕事を始めます';
    $('badge-sets').textContent = s.waiting ? String(s.waiting) : '';
    $('badge-pr').textContent = s.pr && s.pr.counts.approval ? String(s.pr.counts.approval) : '';
    var todo = todoItems(); $('badge-todo').textContent = todo.length ? String(todo.length) : '';
    notice(); roomStopBar();
    Office.update(s.staff);
    renderCrew(); renderCases(); renderFlow();
    if (tab === 'sets' && !openSet) renderSets();
    if (tab === 'todo') renderTodo();
    if (tab === 'money') renderMoney();
    if (tab === 'pr') renderPr();
    $('badge-biz').textContent = s.ventures && s.ventures.dash.ownerWaiting ? String(s.ventures.dash.ownerWaiting) : '';
    if (tab === 'biz') renderBiz();
  }

  // ---- 開発管理（2026-11-24・KOT-14）：ChatGPT → Linear → Claude Code → PR → 独立レビュー → 自動マージ → 本番反映 → 本番の確認 の進み具合。実際の記録だけ ----
  var DEV_STATUS = { done: '完了', running: '進行中', failed: '失敗・停止', skipped: '省略', waiting: '人の確認待ち' };
  function stamp(iso) { return iso ? day(iso) + ' ' + hm(iso) : '—'; }
  function link(text, href) { var a = el('a', 'link', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function devNext(t) {
    var last = t.stages && t.stages.length ? t.stages[t.stages.length - 1] : null;
    if (t.next) return t.next;
    if (!last) return '受付を待っています';
    if (last.name === 'finish' && last.status === 'done') return 'なし（本番に反映し、動作を確認済み）';
    if (last.status === 'waiting') return '人の確認が必要：PRを開き、自動マージしなかった理由を見て、取り込むか決める';
    if (last.status === 'failed') return '原因を直す。直したら Linear の「Claude失敗」ラベルを外すと、もう一度処理します';
    return '自動で次の段階へ進みます';
  }
  function renderDev() {
    var box = $('dev'); box.textContent = '';
    box.appendChild(el('p', 'hint', '読み込み中…'));
    fetch('../api/dev', { headers: { 'x-app-passcode': pass() } }).then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); }).then(function (r) {
      box.textContent = '';
      box.appendChild(el('p', 'hint', 'ChatGPT からの依頼が、Linear → Claude Code → テスト → 独立レビュー → 自動マージ → 本番反映 → 本番の確認 と進む様子を、実際の記録だけで表示します。'));
      if (r.status !== 200) { box.appendChild(el('p', 'card hint warn', (r.data && r.data.error) || '読み込めませんでした')); return; }
      var D = r.data;
      var k = el('div', 'card');
      k.appendChild(el('p', 'field', '5分ごとの起動（QStash → /api/linear-kick → GitHub Actions）'));
      if (!D.kick) k.appendChild(el('p', 'hint warn', 'QStash からの呼び出しの記録がまだありません。Upstash の QStash に、/api/linear-kick を5分ごとに呼ぶ定期実行が無い可能性があります（それまでは GitHub の定期実行だけで、数時間に1回の起動になります）'));
      else {
        k.appendChild(el('p', 'hint', '最後の呼び出し：' + stamp(D.kick.at) + '（' + (D.kick.start ? '起動した' : D.kick.why || '起動しなかった') + '）'));
        if (D.kickStats) k.appendChild(el('p', 'hint', '今日（' + D.kickStats.day + '）：呼び出し ' + D.kickStats.calls + '回・起動 ' + D.kickStats.started + '回・断った ' + D.kickStats.rejected + '回・起動しなかった ' + D.kickStats.skipped + '回（実行中や直前の実行と重ならないように）'));
        if (D.kick.tokenConfigured === false) k.appendChild(el('p', 'hint warn', 'GitHub を起動する鍵（GH_DISPATCH_TOKEN）が Vercel に未設定のため、起動できません'));
      }
      box.appendChild(k);
      var q = (D.queue && D.queue.items) || [];
      var qc = el('div', 'card');
      qc.appendChild(el('p', 'field', '依頼の待ち行列（Linear・優先度の高い順）' + (D.queue ? '　' + stamp(D.queue.at) + ' 時点' : '')));
      if (!q.length) qc.appendChild(el('p', 'hint', '待っている依頼はありません（または、まだ記録がありません）'));
      q.forEach(function (x) { var p = el('p', 'hint'); p.appendChild(link(x.id, x.url || '#')); p.appendChild(document.createTextNode('　' + x.title + '（' + (x.ok ? '次に処理できる' : '処理しない理由：' + x.why) + '）')); qc.appendChild(p); });
      box.appendChild(qc);
      var ts = D.tickets || [];
      $('badge-dev').textContent = ts.filter(function (t) { return t.stageStatus === 'failed' || t.stageStatus === 'waiting'; }).length || '';
      if (!ts.length) box.appendChild(el('p', 'card hint', 'まだ開発の記録がありません。新しい依頼が処理されると、ここに段階ごとに表示されます。'));
      ts.forEach(function (t) {
        var c = el('div', 'card dev-card st-' + (t.stageStatus || ''));
        var h = el('p', 'field'); h.appendChild(link(t.id, t.url || '#')); h.appendChild(document.createTextNode('　' + (t.title || ''))); c.appendChild(h);
        c.appendChild(el('p', 'hint', '依頼：' + stamp(t.requestedAt) + '　着手：' + stamp(t.startedAt) + '　更新：' + stamp(t.updatedAt)));
        c.appendChild(el('p', '', '今：' + (t.stage || '—') + '（' + (DEV_STATUS[t.stageStatus] || '—') + '）'));
        var rows = [['テスト', t.test_text || '未実施'], ['独立レビュー', t.review_verdict ? ({ approve: '承認', changes: '直す必要あり', unknown: '判定できず' })[t.review_verdict] || t.review_verdict : '未実施'], ['マージ', t.merge_sha ? '済み（' + t.merge_sha.slice(0, 7) + '）' : '未マージ'], ['本番反映', t.prod_commit ? '確認済み（本番のコミット ' + t.prod_commit.slice(0, 7) + '）' : '未確認'], ['次の対応', devNext(t)]];
        rows.forEach(function (x) { var p = el('p', 'money-row'); p.appendChild(el('span', null, x[0])); p.appendChild(el('b', null, x[1])); c.appendChild(p); });
        if (t.error) c.appendChild(el('p', 'hint warn', '停止・失敗の理由：' + t.error));
        var lk = el('p', 'hint'); if (t.pr_url) { lk.appendChild(link('PR', t.pr_url)); lk.appendChild(document.createTextNode('　')); } if (t.run) lk.appendChild(link('実行の記録', t.run)); c.appendChild(lk);
        var d = el('details'); d.appendChild(el('summary', null, '段階の履歴（' + (t.stages || []).length + '件）'));
        (t.stages || []).forEach(function (s) { d.appendChild(el('p', 'hint', stamp(s.at) + '　' + s.label + '：' + (DEV_STATUS[s.status] || s.status) + (s.detail ? '（' + s.detail + '）' : ''))); });
        c.appendChild(d);
        box.appendChild(c);
      });
    }, function () { box.textContent = ''; box.appendChild(el('p', 'card hint warn', '通信できませんでした')); });
  }

  // 新規ROOM商品紹介の停止（KOT-13）：停止の理由と、社長の明示の再開の操作（確認の言葉つき）
  function roomStopBar() {
    var R = state.roomStop, box = $('room-stop'); if (!box) return;
    box.textContent = '';
    if (!R || !R.stopped) { box.hidden = true; return; }
    box.hidden = false;
    var more = el('details', 'room-stop-more'); // KOT-18：帯は1行にして、理由は開いたときだけ
    more.appendChild(el('summary', null, '新規ROOM商品紹介：停止中（' + R.since + ' から）'));
    more.appendChild(el('p', 'hint', R.reason + '。作りかけの案件と完成品は消さずに残しています。既存の完成品の販売改善と、ROOM以外で稼ぐ仕事は続けています。'));
    box.appendChild(more);
    box.appendChild(btn('新規紹介を再開する', 'btn ghost small-ghost', function () {
      var w = prompt('新規ROOM商品紹介を再開します。よければ「再開する」と入力してください', '');
      if (w === null) return;
      api({ action: 'roomResume', confirm: w }).then(function (r) { if (r.status !== 200) { alert((r.data && r.data.error) || '再開できませんでした'); return; } refresh(); });
    }));
  }

  // 事業タブ（KOT-12）：ROOMとは独立した3本の流れ。実際の記録だけを表示（無い数字は「未計測」）
  var BIZ_STATUS = { active: '作成中', review: '社長の判断待ち', adopted: '採用', hold: '保留', rejected: '却下・不合格', stopped: '止まった（失敗）' };
  // 収益の手法（KOT-13）：不足条件・月3万円の逆算・投稿ごとの数字・販促カレンダー・週ごとの見直し・資料の手法の判断。実績と仮説を分けて表示
  function pct(v) { return v == null ? '未計測' : (Math.round(v * 10000) / 100) + '%'; }
  function nv2(v, u) { return v == null ? '未計測' : v + (u || ''); }
  function renderProfit(box) {
    var P = state.profit; if (!P) return;
    var c = el('div', 'card profit');
    c.appendChild(el('p', 'field', '不足条件（月' + P.target.toLocaleString() + '円の利益に足りないもの）'));
    P.missing.forEach(function (m) {
      var d = el('details', 'biz-item'); d.appendChild(el('summary', null, (m.status === 'open' ? '［未解決］' : '［解決済み］') + m.what + '（優先' + m.priority + '）'));
      [['根拠', m.basis], ['利益への影響', m.impact], ['解決策', m.fix], ['費用', m.cost], ['担当', nameOf(m.owner)], ['社長の操作', m.ownerAction || 'なし（AIが進める）'], ['備考', m.note]].forEach(function (x) { if (x[1]) d.appendChild(el('p', 'hint', x[0] + '：' + x[1])); });
      c.appendChild(d);
    });
    box.appendChild(c);
    var R = P.reverse, rc = el('div', 'card');
    rc.appendChild(el('p', 'field', '月' + R.target.toLocaleString() + '円からの逆算' + (R.allActual ? '（すべて実績）' : '（仮説を含む・保証ではない）')));
    var lab = { price: '単価', rate: '料率', cvr: '成約率（CVR）', ctr: 'クリック率（CTR）' };
    Object.keys(lab).forEach(function (k) { var x = R.inputs[k]; rc.appendChild(el('p', 'hint', lab[k] + '：' + (k === 'price' ? yen(x.value) : pct(x.value)) + '【' + (x.kind === 'actual' ? '実績' : '仮説') + '】' + x.basis)); });
    rc.appendChild(el('p', 'hint', '1件あたりの報酬 ' + yen(R.perOrder) + ' → 必要な成約 ' + nv2(R.need.orders, '件') + '・クリック ' + nv2(R.need.clicks, '回') + '・閲覧 ' + nv2(R.need.views, '回') + '（1日 ' + nv2(R.need.viewsPerDay, '回') + '）'));
    rc.appendChild(el('p', 'hint', '直近30日の閲覧の実績：' + nv2(R.recentViews30, '回') + (R.gap ? '（必要な量の' + R.gap + '分の1）' : '')));
    box.appendChild(rc);
    var T = P.totals, pc = el('div', 'card');
    pc.appendChild(el('p', 'field', '投稿ごとの数字（閲覧→クリック→成約→確定報酬→利益）'));
    pc.appendChild(el('p', 'hint', '合計：投稿 ' + T.posts + '・閲覧 ' + nv2(T.views) + '・クリック ' + nv2(T.clicks) + '・CTR ' + pct(T.ctr) + '・成約 ' + nv2(T.orders) + '・CVR ' + pct(T.cvr) + '・確定報酬 ' + nv2(T.reward, '円') + '・利益 ' + nv2(T.profit, '円') + '（社長の登録だけ。因果は仮説）'));
    P.posts.slice(0, 10).forEach(function (r) { pc.appendChild(el('p', 'hint', r.title + '：閲覧 ' + nv2(r.views) + '・クリック ' + nv2(r.clicks) + '・CTR ' + pct(r.ctr) + '・成約 ' + nv2(r.orders) + '・CVR ' + pct(r.cvr) + '・利益 ' + nv2(r.profit, '円'))); });
    box.appendChild(pc);
    var cc = el('div', 'card');
    cc.appendChild(el('p', 'field', '販促カレンダー（' + P.calendar.from + '〜' + P.calendar.until + '・過ぎたものは出さない）'));
    P.calendar.items.forEach(function (e) { cc.appendChild(el('p', 'hint', e.start + (e.end !== e.start ? '〜' + e.end : '') + '　' + e.name + '（' + e.basis + '）')); });
    P.calendar.unconfirmed.forEach(function (e) { cc.appendChild(el('p', 'hint', '日付未登録：' + e.name + '（' + e.basis + '）')); });
    cc.appendChild(btn('公式で確かめたセールを登録', 'btn small', function () {
      var name = prompt('イベントの名前（例：楽天スーパーSALE）', ''); if (!name) return;
      var st = prompt('始まりの日（YYYY-MM-DD）', ''); if (!st) return;
      var en = prompt('終わりの日（YYYY-MM-DD）', st) || st;
      var u = prompt('確かめた楽天の公式ページのURL', 'https://event.rakuten.co.jp/'); if (!u) return;
      api({ action: 'calendarAdd', event: { name: name, start: st, end: en, url: u } }).then(function (r) { if (r.status !== 200) alert((r.data && r.data.error) || '登録できませんでした'); refresh().then(renderBiz); });
    }));
    cc.appendChild(btn('公式で確かめた料率を登録', 'btn ghost small-ghost', function () {
      var r0 = prompt('料率（%の数字。例：3）', ''); if (!r0) return;
      var u = prompt('確かめた楽天の公式ページのURL', 'https://affiliate.rakuten.co.jp/'); if (!u) return;
      api({ action: 'rateSet', rate: Number(r0) / 100, url: u }).then(function (r) { if (r.status !== 200) alert((r.data && r.data.error) || '登録できませんでした'); refresh().then(renderBiz); });
    }));
    box.appendChild(cc);
    var wc = el('div', 'card');
    wc.appendChild(el('p', 'field', '週ごとの見直し（7日に1回・鑑定がコードの計算で行う・0円）'));
    if (!P.reviews.length) wc.appendChild(el('p', 'hint', 'まだ見直していない（次の定期実行で鑑定が行う）'));
    P.reviews.forEach(function (r) { wc.appendChild(el('p', 'hint', r.week + '：いちばん詰まっている段階「' + r.bottleneck + '」（' + r.evidence + '）→ 次の検証「' + r.nextTest + '」・担当 ' + r.deptName + '・成果物 ' + r.deliverable + '・やめる条件 ' + r.stopCondition)); });
    box.appendChild(wc);
    var mc = el('div', 'card');
    mc.appendChild(el('p', 'field', '参考資料（楽天アフィ攻略 1〜20ページ）の手法の判断'));
    P.methods.forEach(function (m) {
      var d = el('details', 'biz-item'); d.appendChild(el('summary', null, '【' + m.decisionLabel + '】' + m.name + (m.working === true ? '（動いている）' : m.working === false ? '（まだ動いていない）' : '')));
      [['理由', m.why], ['担当', m.ownerName], ['成果物', m.deliverable], ['確かめ方', m.verify]].forEach(function (x) { d.appendChild(el('p', 'hint', x[0] + '：' + x[1])); });
      mc.appendChild(d);
    });
    box.appendChild(mc);
    renderDeptWork(box);
  }
  // 部署別の0円の仕事（KOT-17）：実際の成果物・実行ログ・部署別のキュー・棚卸し（無料／外部データ／AI）
  function renderDeptWork(box) {
    var D = state.deptWork; if (!D) return;
    var c = el('div', 'card'); var KL = { free: '無料（コードの計算）', external: '外部データが必要', ai: 'AIの推論が必要' };
    c.appendChild(el('p', 'field', '部署別の0円の仕事（実行ログと成果物）'));
    c.appendChild(el('p', 'hint', D.note));
    var n = (D.log || []).length;
    c.appendChild(el('p', 'hint', '直近の実行：' + n + '件（費用はすべて0円）' + (n ? '' : '。まだ実行されていない（次の定期実行で、データが変わった部署だけ動く）')));
    (D.log || []).slice(0, 10).forEach(function (l) { c.appendChild(el('p', 'hint', String(l.at).slice(5, 16).replace('T', ' ') + ' ' + nameOf(l.dept) + '：' + l.title + '（' + l.summary + '）')); });
    box.appendChild(c);
    var i = el('div', 'card'); i.appendChild(el('p', 'field', '全8部署の仕事の棚卸し・実装状況'));
    (D.inventory || []).forEach(function (x) { i.appendChild(el('p', 'hint', x.deptName + '：' + x.task + '【' + KL[x.kind] + '】' + (x.impl ? '' : '（未実装）') + (x.note ? ' ' + x.note : ''))); });
    box.appendChild(i);
  }
  // 折りたたみ（初期は閉じる）。KOT-18：summary は短く、長文は本文に置く
  function fold(title, sub) {
    var d = el('details', 'card fold-card');
    var s = el('summary', null, title); if (sub) s.appendChild(el('small', 'sub', sub));
    d.appendChild(s);
    var body = el('div', 'fold-body'); d.appendChild(body);
    d.body = body; return d;
  }
  function clip(t, n) { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n) + '…' : t; }
  function ventureGo(x, dec) { return function () { var w = dec === 'adopt' ? '' : (prompt('理由（任意・次の案づくりに活かします）', '') || ''); api({ action: 'ventureDecide', id: x.id, decision: dec, why: w }).then(function (r) { if (r.status !== 200) alert((r.data && r.data.error) || 'できませんでした'); refresh().then(renderBiz); }); }; }
  var NEED_CLS = { free: 'free', ai: 'ai', owner: 'owner', external: 'ext' };
  var NEED_SHORT = { free: '無料で自動', ai: 'AI予算が要る', owner: '社長の操作', external: '外部データが要る' };
  // 冒頭：実利益・目標・投稿できる在庫・社長の判断待ち（具体的な案件と次の操作）
  function bizTop(box) {
    var P = state.profit, V = state.ventures;
    var profit = P && P.totals ? P.totals.profit : null, target = P ? P.target : 30000;
    var postable = state.kpi && state.kpi.current ? state.kpi.current.postable : null;
    var reviews = V ? V.items.filter(function (x) { return x.status === 'review'; }) : [];
    var waitSets = (state.sets || []).filter(function (x) { return x.status === 'waiting'; });
    var ownerQ = ((state.deptWork && state.deptWork.queue) || []).filter(function (x) { return x.need === 'owner'; });
    var total = reviews.length + waitSets.length;
    var c = el('div', 'card biz-top');
    var g = el('div', 'kpi-grid');
    [['実利益', profit == null ? '未計測' : yen(profit), profit == null], ['月の目標', target.toLocaleString('ja-JP') + '円', false], ['投稿できる在庫', postable == null ? '未取得' : postable + '件', postable == null], ['社長の判断待ち', total + '件', false]].forEach(function (x) {
      var d = el('div', 'kpi' + (x[2] ? ' none' : '')); d.appendChild(el('small', null, x[0])); d.appendChild(el('b', null, x[1])); g.appendChild(d);
    });
    c.appendChild(g);
    c.appendChild(el('p', 'hint', '実利益は社長が登録した確定報酬と費用だけで計算（未登録は未計測）。目標は保証ではありません'));
    box.appendChild(c);
    var w = el('div', 'card');
    w.appendChild(el('p', 'field', '社長の判断待ち（' + total + '件）'));
    if (!total) w.appendChild(el('p', 'hint', '今、社長の判断が必要な案件はありません'));
    reviews.slice(0, 5).forEach(function (x) {
      var r = el('div', 'wait-row'); r.appendChild(el('p', 'wait-title', clip(x.title, 40))); r.appendChild(el('p', 'hint', (x.stream === 'venture' ? '新規副業' : x.stream === 'growth' ? '集客・販促' : 'デジタル商品') + 'の案。次の操作：採用・保留・却下を選ぶ（中身は下の各カードで確認）'));
      var row = el('div', 'row'); row.appendChild(btn('採用', 'btn small', ventureGo(x, 'adopt'))); row.appendChild(btn('保留', 'btn ghost small-ghost', ventureGo(x, 'hold'))); row.appendChild(btn('却下', 'btn ghost small-ghost', ventureGo(x, 'reject')));
      r.appendChild(row); w.appendChild(r);
    });
    if (waitSets.length) {
      var r2 = el('div', 'wait-row'); r2.appendChild(el('p', 'wait-title', 'ROOMの完成品の確認待ち ' + waitSets.length + '件（例：' + clip(waitSets[0].title, 24) + '）'));
      r2.appendChild(el('p', 'hint', '次の操作：「完成品」タブで内容を見て採用・修正依頼'));
      r2.appendChild(btn('完成品タブを開く', 'btn small', function () { switchTab('sets'); })); w.appendChild(r2);
    }
    if (ownerQ.length) w.appendChild(el('p', 'hint', '社長の操作が要る改善：' + ownerQ.length + '件（下の「改善キュー」）'));
    box.appendChild(w);
  }
  // 4つの流れ（ROOM・新規副業・集客販促・デジタル商品）：件数・状態・次の行動だけ短く。詳細は折りたたみ
  function bizStreams(box) {
    var V = state.ventures, D = V.dash, st = state.roomStop;
    var rc = el('div', 'card stream-card');
    rc.appendChild(el('p', 'field', 'ROOM（楽天ROOM商品紹介）'));
    rc.appendChild(el('p', 'hint', '状態：' + (st && st.stopped ? '新規紹介は停止中（社長の再開待ち）' : '稼働中') + '／在庫：確認待ち ' + D.inventory.waiting + '・採用済み未投稿 ' + D.inventory.adopted + '・投稿済み ' + D.inventory.posted));
    rc.appendChild(el('p', 'next', '次の行動：' + (D.inventory.waiting ? '完成品の確認' : D.inventory.adopted ? '採用済みをInstagramとROOMに投稿（社長が手で）' : st && st.stopped ? '既存の完成品の販売改善（停止中のまま）' : 'AIが新しい完成品を作る')));
    box.appendChild(rc);
    ['venture', 'growth', 'digital'].forEach(function (k) {
      var S = V.streams[k], n = S.counts, card = el('div', 'card stream-card');
      card.appendChild(el('p', 'field', S.label));
      card.appendChild(el('p', 'hint', '作成中 ' + n.active + '・判断待ち ' + n.review + '・採用 ' + n.adopted + '・保留 ' + n.hold + '・却下 ' + n.rejected + '・止まった ' + n.stopped));
      card.appendChild(el('p', 'next', '次の行動：' + (n.review ? '社長が判断（上の「判断待ち」）' : n.stopped ? '止まった案を「もう一度」で再開（社長）' : n.active ? 'AIが作成中' : 'AIが次の案を作る（20時間に1回まで）')));
      var items = V.items.filter(function (x) { return x.stream === k; }).slice(0, 6);
      var d = el('details', 'fold-in'); d.appendChild(el('summary', null, '詳細（案 ' + items.length + '件・費用・流れ）'));
      d.appendChild(el('p', 'hint', '今日のAI費用 ' + yen(S.spentToday) + '（上限 ' + S.dayCapYen + '円）／新しい案は' + (S.lastDiscoverAt ? '直近 ' + day(S.lastDiscoverAt) + ' ' + hm(S.lastDiscoverAt) : 'まだ作っていない')));
      d.appendChild(el('p', 'hint', '流れ：' + S.stages.map(function (s) { return nameOf(s.agent) + '「' + s.task + '」'; }).join(' → ')));
      items.forEach(function (x) { d.appendChild(bizItem(x)); });
      card.appendChild(d); box.appendChild(card);
    });
  }
  // 8部署：部署名・最終実行・成果物・次の行動を短い行で
  function bizDepts(box) {
    var D = state.deptWork || {}, log = D.log || [], q = D.queue || [];
    var c = el('div', 'card'); c.appendChild(el('p', 'field', '8部署の成果'));
    state.staff.forEach(function (s) {
      var i = s.indep || {}, l = log.filter(function (x) { return x.dept === s.id; })[0], nq = q.filter(function (x) { return x.dept === s.id; })[0];
      var at = l ? l.at : i.last ? i.last.at : null;
      var out = l ? l.title : i.last ? i.last.text : '成果物はまだありません';
      var next = nq ? nq.task : i.next ? i.next : '待機：' + (i.wait || '今は担当の仕事がない');
      var d = el('details', 'dept-row');
      var sm = el('summary'); sm.appendChild(el('b', null, s.name)); sm.appendChild(el('span', 'dt', at ? day(at) + ' ' + hm(at) : '未実行'));
      sm.appendChild(el('span', 'dl', '成果：' + clip(out, 28))); sm.appendChild(el('span', 'dl nx', '次：' + clip(next, 28))); d.appendChild(sm);
      d.appendChild(el('p', 'hint', '成果物：' + out + (l && l.summary ? '（' + l.summary + '）' : '')));
      d.appendChild(el('p', 'hint', '次の行動：' + next + (nq ? '（' + nq.needLabel + '）' : '')));
      if (i.last) d.appendChild(el('p', 'hint', '最後の独立した仕事：' + day(i.last.at) + ' ' + hm(i.last.at) + '「' + (i.last.text || '') + '」（' + i.last.count + '件）'));
      c.appendChild(d);
    });
    box.appendChild(c);
  }
  // 改善キュー：担当・優先度・状態・次の行動。無料で処理できるものと社長の操作が要るものを区別
  function bizQueue(box) {
    var D = state.deptWork; if (!D) return;
    var q = D.queue || [];
    var c = el('div', 'card'); c.appendChild(el('p', 'field', '改善キュー（優先順）'));
    var nf = q.filter(function (x) { return x.need === 'free'; }).length, no = q.filter(function (x) { return x.need === 'owner'; }).length;
    c.appendChild(el('p', 'hint', q.length ? '無料で自動処理 ' + nf + '件・社長の操作が要る ' + no + '件・そのほか ' + (q.length - nf - no) + '件' : 'キューは空（成果物がまだ無い、または改善点が見つかっていない）'));
    q.slice(0, 12).forEach(function (x) {
      var d = el('details', 'q-row'); var sm = el('summary');
      sm.appendChild(el('span', 'rk', String(x.rank))); sm.appendChild(el('span', 'qn', x.deptName));
      sm.appendChild(el('span', 'pill need-' + NEED_CLS[x.need], NEED_SHORT[x.need] || x.need));
      sm.appendChild(el('span', 'qt', clip(x.task, 44))); d.appendChild(sm);
      d.appendChild(el('p', 'hint', '次の行動：' + x.task)); d.appendChild(el('p', 'hint', '状態：' + x.needLabel + (x.need === 'owner' ? '（社長が操作するまで進まない）' : x.need === 'free' ? '（AI・予算を使わず自動で進む）' : '')));
      if (x.why) d.appendChild(el('p', 'hint', '根拠：' + x.why));
      c.appendChild(d);
    });
    box.appendChild(c);
  }
  function renderBiz() {
    var box = $('biz'); box.textContent = '';
    var V = state.ventures;
    if (!V) { box.appendChild(el('p', 'hint', '事業のデータを読み込めませんでした')); var pf = fold('収益の分析'); renderProfit(pf.body); box.appendChild(pf); return; }
    bizTop(box);
    bizStreams(box);
    bizDepts(box);
    bizQueue(box);
    var D = V.dash, nv = function (v) { return v == null ? '未計測' : v; };
    var f1 = fold('経営ダッシュボードの詳細', '成果物 ' + D.artifacts + '件');
    f1.body.appendChild(el('p', 'hint', '成果物 ' + D.artifacts + '件・社長の判断待ち ' + D.ownerWaiting + '件・販売ページの下書き ' + D.salesPageDrafts + '件・note等の原稿の下書き ' + D.noteDrafts + '件・集客の実験案 ' + D.experiments + '件・これらにかけたAI費用 ' + yen(D.spentTotalYen)));
    f1.body.appendChild(el('p', 'hint', '売上に近い数字：閲覧 ' + nv(D.funnel && D.funnel.views) + '・プロフィール ' + nv(D.funnel && D.funnel.profileVisits) + '・ROOMへの流入 ' + nv(D.funnel && D.funnel.roomClicks) + '・売上 ' + nv(D.funnel && D.funnel.sales) + '（社長の登録だけ。無いものは未計測）'));
    if (V.rank.length) f1.body.appendChild(el('p', 'hint', '新規副業の優先順（低コスト・手間が少ない・再現性。収益の予測は点に使わない）：' + V.rank.map(function (r, i) { return (i + 1) + '. ' + r.title + '（' + r.priority + '点）'; }).join(' ／ ')));
    box.appendChild(f1);
    var f2 = fold('収益の分析・販促カレンダー・成果登録', '不足条件・月3万円の逆算・投稿ごとの数字・週次・手法'); renderProfit(f2.body); box.appendChild(f2);
    var f3 = fold('実行ログ・棚卸し・不足条件', '長文。必要なときだけ開く'); renderDeptWork(f3.body); box.appendChild(f3);
    var dc = el('div', 'card'); dc.appendChild(el('p', 'field', '部署ごとの独立した仕事（最後にした仕事・成果物・次に着手できる仕事・待機の理由）'));
    state.staff.forEach(function (s) {
      var i = s.indep || {}; var p = el('p', 'hint');
      p.textContent = s.name + '：' + (i.last ? '最後の仕事 ' + day(i.last.at) + ' ' + hm(i.last.at) + '「' + (i.last.text || '') + '」（' + i.last.count + '件）' : '独立した仕事はまだしていない') + '／' + (i.next ? '次に着手：' + i.next : '待機の理由：' + (i.wait || '今は担当の仕事がない'));
      dc.appendChild(p);
    });
    f3.body.appendChild(dc);
    if (V.runs.length) { var rc = el('div', 'card'); rc.appendChild(el('p', 'field', '実行ログ（直近）')); V.runs.slice(0, 10).forEach(function (r) { rc.appendChild(el('p', 'hint', day(r.at) + ' ' + hm(r.at) + ' ' + nameOf(r.agent) + '：' + r.text + (r.yen ? '（' + yen(r.yen) + '）' : '（0円）') + (r.ok ? '' : '［失敗］'))); }); f3.body.appendChild(rc); }
  }
  function bizItem(x) {
    var d = el('details', 'biz-item'); var sm = el('summary', null, x.title + '【' + BIZ_STATUS[x.status] + '】' + (x.priority != null ? '・' + x.priority + '点' : '')); d.appendChild(sm);
    var D = x.data || {}, add = function (t) { d.appendChild(el('p', 'hint', t)); };
    add('出典：' + x.basis);
    (x.sources || []).forEach(function (s) { add('調べた事実（' + day(s.at) + '）：' + s.label + '／' + s.status + (s.pages ? '・' + s.pages + 'ページ分' : '') + (s.priceMin ? '・上位の価格帯 ' + s.priceMin + '〜' + s.priceMax + '円' : '') + (s.why ? '（' + s.why + '）' : '')); });
    if (x.stream === 'venture') { add('対象：' + D.customer + '／課題：' + D.problem); add('商品：' + D.product + '／販売経路：' + D.channel + '／収益モデル：' + D.revenueModel); add('収益の予測（仮定）：' + D.revenueAssumption); add('費用：初期 ' + D.initialCostYen + '円・維持 ' + D.monthlyCostYen + '円／オーナーの作業 週' + D.ownerHoursPerWeek + '時間／AIが代行：' + (D.aiDoes || []).join('・')); add('競合・需要：' + D.competitorsNote); add('リスク：規約 ' + ((D.risks || {}).terms || '') + '／著作権 ' + ((D.risks || {}).copyright || '') + '／医療 ' + ((D.risks || {}).medical || '')); add('最小の実験：' + D.minExperiment + '／成功：' + D.success + '／撤退：' + D.withdraw); add('なぜこの案か：' + D.whyChosen); }
    if (x.proto) { add('販売ページの下書き（未公開）：' + x.proto.headline + '／' + x.proto.lead); add('注意：' + x.proto.notes); }
    if (x.stream === 'growth') { add('仮説：' + D.hypothesis + '（対象：' + D.funnelStage + '）'); if (D.experiment) add('実験：' + D.experiment.what + '／測る数字：' + D.experiment.metric + '／成功：' + D.experiment.success); ((D.drafts || {}).posts || []).forEach(function (p) { add('投稿案：' + p.caption); }); ((D.drafts || {}).replies || []).forEach(function (p) { add('返信案（' + p.situation + '）：' + p.reply); }); if (x.funnel) add('実績の数字：閲覧 ' + (x.funnel.views == null ? '未計測' : x.funnel.views) + '・プロフィール ' + (x.funnel.profileVisits == null ? '未計測' : x.funnel.profileVisits) + '・ROOM流入 ' + (x.funnel.roomClicks == null ? '未計測' : x.funnel.roomClicks) + '・売上 ' + (x.funnel.sales == null ? '未計測' : x.funnel.sales)); add('アプリは投稿・コメントを送りません。実行は社長が手で行います'); }
    if (x.stream === 'digital') { add('形：' + D.format + '／対象：' + D.target + '／独自性：' + D.originality + '／価格案（仮定）：' + D.priceIdea); if (x.manuscript) { add('無料記事の下書き：' + x.manuscript.freeArticle.slice(0, 200) + '…（' + x.manuscript.chars + '字）'); add('人間の確認が必要：' + x.manuscript.needsReview.join('・')); } }
    if (x.audit) add('監査：' + (x.audit.ok ? '合格' : '不合格（' + x.audit.problems.join('／') + '）'));
    add('費用（AI）：' + yen(x.yen) + '／成果物 ' + x.artifacts.length + '件');
    x.log.forEach(function (l) { add(day(l.at) + ' ' + hm(l.at) + ' ' + nameOf(l.by) + '：' + l.text); });
    if (x.decision) add('判断：' + x.decision.label + (x.decision.why ? '（' + x.decision.why + '）' : ''));
    var row = el('div', 'row');
    var go = function (dec) { return ventureGo(x, dec); };
    if (x.status === 'review') { row.appendChild(btn('採用', 'btn small', go('adopt'))); row.appendChild(btn('保留', 'btn ghost small-ghost', go('hold'))); row.appendChild(btn('却下', 'btn ghost small-ghost', go('reject'))); }
    if (x.status === 'stopped') row.appendChild(btn('もう一度', 'btn small', go('retry')));
    if (row.children.length) d.appendChild(row);
    return d;
  }

  // 完成品のお知らせ（社長に通知：画面のお知らせ・タブの数字・ホーム画面のアイコンの数字（対応している端末））
  function notice() {
    var box = $('notice'); box.textContent = '';
    var last = store(SEEN_KEY);
    var fresh = (state.notices || []).filter(function (n) { return n.at > last; });
    try { if (navigator.setAppBadge) { if (state.waiting) navigator.setAppBadge(state.waiting); else navigator.clearAppBadge(); } } catch (e) {}
    document.title = (state.waiting ? '(' + state.waiting + ') ' : '') + 'サングラスくま株式会社';
    if (!fresh.length) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el('span', null, '新しい完成品が届きました：「' + fresh[0].title + '」' + (fresh.length > 1 ? ' ほか' + (fresh.length - 1) + '件' : '')));
    box.appendChild(btn('見る', 'btn small', function () { store(SEEN_KEY, fresh[0].at); switchTab('sets'); showSet(fresh[0].id); }));
  }

  // ---- 社員の一覧（色・名前・状態。タップで担当案件・直近の成果・次の工程） ----
  function renderCrew() {
    var box = $('crew'); box.textContent = '';
    state.staff.forEach(function (x) {
      var b = el('button', x.status); b.type = 'button';
      var top = el('span'); var dot = el('span', 'dot'); dot.style.background = COLOR[x.id]; top.appendChild(dot); top.appendChild(document.createTextNode(' ' + x.name)); b.appendChild(top);
      b.appendChild(el('span', 's', ST_LABEL[x.status] + (x.cases.length > 1 ? '（' + x.cases.length + '件）' : '')));
      b.addEventListener('click', function () { showStaff(x.id); });
      box.appendChild(b);
    });
  }
  // ---- 進行中の案件（並行して進む） ----
  function renderCases() {
    var box = $('now-card'); box.textContent = '';
    var s = state;
    box.appendChild(el('p', 'field', '進行中の案件（' + s.cases.length + '件）'));
    if (!s.cases.length) { box.appendChild(el('p', 'hint', s.blocked ? '今日のAIの費用の上限に達しました。明日0時に戻ったら再開します' : s.idle || '次の定期実行で、企画が新しい案件を自分で始めます')); }
    s.cases.forEach(function (c) {
      var row = el('div', 'case-row');
      var who = el('span', 'ev-who', nameOf(c.agent)); who.style.background = COLOR[c.agent] || '#777'; row.appendChild(who);
      var t = el('div', 'case-txt');
      t.appendChild(el('p', 'case-title', c.title + (c.kind === 'fix' ? '（社長の修正依頼）' : '')));
      t.appendChild(el('p', 'hint', c.working ? '仕事中：' + c.task : c.wait ? WAIT_LABEL[c.wait.kind] + '：' + c.wait.why : '次の番：' + c.task + (c.next ? ' → 次は' + c.nextAgent + '（' + c.next + '）' : '')));
      row.appendChild(t);
      if (c.wait) row.classList.add('wait-' + c.wait.kind);
      box.appendChild(row);
    });
    if (s.lanes && s.lanes.length) {
      var lp = el('details', 'lanes'); lp.appendChild(el('summary', null, '前回の定期実行：同時に最大' + s.peak + '件の工程を進めた（' + s.lanes.length + '工程）'));
      s.lanes.forEach(function (x) { lp.appendChild(el('p', 'hint', 'レーン' + x.lane + '　' + x.from + '〜' + x.to + '秒　' + nameOf(x.agent) + '：' + (x.side ? '仕事探し（' + x.step + '）' : x.step) + (x.final ? '・' + ({ deliver: '納品', stop: '停止', wait: '待ち', done: '完了', fail: '失敗' })[x.final] : ''))); });
      box.appendChild(lp);
    }
    if (s.reach) { var Rc = s.reach, Sm = Rc.summary; var rc = el('div', 'reach-sum'); rc.appendChild(el('p', 'field', '集客（Instagramから楽天ROOMへ）')); rc.appendChild(el('p', 'hint', 'リールの動画 ' + Rc.reels + '本（実ファイル）・冒頭の一言 ' + Rc.hooks + '件（未作成 ' + Rc.noHooks + '件）・実績の登録 ' + Sm.posts + '件' + (Sm.posts ? '（最高 閲覧' + Sm.topViews + '回' + (Sm.nextTarget ? '・次の目標 ' + Sm.nextTarget + '回' : '') + '）' : '') + '')); if (s.kpi) { var Kc = s.kpi.current; var nv = function (v) { return v == null ? '未取得' : v; }; rc.appendChild(el('p', 'hint', '成果：投稿できる完成品 ' + Kc.postable + '件（確認待ち ' + Kc.postableWaiting + '・採用 ' + Kc.postableAdopted + '）・投稿済み ' + Kc.posted + '件・リールの動画 ' + Kc.reelFiles + '本（実ファイル）・閲覧 ' + nv(Kc.views) + '・プロフィールへのアクセス ' + nv(Kc.profileVisits) + '・楽天ROOMへの流入 ' + nv(Kc.roomClicks) + '・売上 ' + (Kc.sales == null ? '未取得' : Kc.sales + '円') + '（閲覧・アクセス・流入・売上は社長の登録だけ。推測しない）')); }
    if (s.growth) { var Gn = s.growth.counts; rc.appendChild(el('p', 'hint', '集客の施策：実行できる ' + Gn.ready + '・実行中 ' + Gn.doing + '・効果あり ' + Gn.measured + '・見直し ' + Gn.review + '・AIの提案 ' + Gn.proposed + '（広報タブ）')); } box.appendChild(rc); }
    if (!s.active && !s.v1Retired) box.appendChild(el('p', 'hint note', '動作確認中：15分ごとの定期実行を1.0と交互に使います。1.0の番でも1.0に仕事が無ければ、同じ回で2.0が進みます（切り替えは「対応」タブ）'));
    if (s.lastTickAt) box.appendChild(el('p', 'hint', '最後に動いた時刻：' + day(s.lastTickAt) + ' ' + hm(s.lastTickAt)));
  }
  var LABEL = { start: '開始', done: '完成', handoff: '引き継ぎ', wait: '画像待ち', stop: '停止', deliver: '納品', owner: '社長', retry: '再試行', budget: '予算待ち', resume: '再開' };
  function renderFlow() {
    var ol = $('flow'); ol.textContent = '';
    var evs = state.events.filter(function (e) { return today(e.at); });
    var showDate = false;
    if (!evs.length) { evs = state.events.slice(0, 20); showDate = true; if (evs.length) ol.appendChild(el('li', 'flow-note', '今日はまだ記録がありません。最近の記録：')); }
    if (!evs.length) { ol.appendChild(el('li', 'flow-note', 'まだ仕事の記録がありません')); return; }
    evs.slice(0, 80).reverse().forEach(function (e) { // 時刻の古い順（上から下へ）
      var li = el('li', 'ev ev-' + e.type);
      li.appendChild(el('span', 'ev-time', (showDate ? day(e.at) + ' ' : '') + hm(e.at)));
      var who = el('span', 'ev-who', nameOf(e.agent)); who.style.background = COLOR[e.agent] || '#777'; li.appendChild(who);
      var t = el('span', 'ev-text'); t.textContent = e.text; if (e.title && e.type !== 'deliver' && e.type !== 'owner') { var sm = el('small', 'ev-case', e.title); t.appendChild(document.createElement('br')); t.appendChild(sm); }
      li.appendChild(t);
      if (e.type !== 'done' && e.type !== 'handoff') li.appendChild(el('span', 'ev-tag', LABEL[e.type] || ''));
      if (e.type === 'deliver' && e.set) li.addEventListener('click', function () { switchTab('sets'); showSet(e.set); });
      ol.appendChild(li);
    });
  }
  function showStaff(id) {
    var s = state.staff.filter(function (x) { return x.id === id; })[0]; if (!s) return;
    var b = $('sheet-body'); b.textContent = '';
    var h = el('p', 'sheet-name', s.name + '（' + s.job + '）'); h.style.borderColor = COLOR[id]; b.appendChild(h);
    b.appendChild(el('p', 'sheet-st', ST_LABEL[s.status] + (s.doing ? '：' + s.doing.replace(/^仕事なし：?/, '') : '')));
    if (s.indep) b.appendChild(el('p', 'hint', '独立した仕事（ROOMの案件とは別）：' + (s.indep.last ? '最後に ' + day(s.indep.last.at) + ' ' + hm(s.indep.last.at) + '「' + s.indep.last.text + '」' : 'まだしていない') + '／' + (s.indep.next ? '次に着手：' + s.indep.next : '待機の理由：' + (s.indep.wait || '今は担当の仕事がない'))));
    var k = s.stats || {};
    var sg = el('div', 'stat-grid');
    [['今日の仕事', (k.today || 0) + '件'], ['これまでの工程', (k.steps || 0) + '件'], ['仕事探しで見つけた仕事', (k.side || 0) + '件'], ['完成品への貢献', (k.delivered || 0) + '件'], ['やり直し・停止', (k.retries || 0) + '・' + (k.stops || 0) + '件'], ['使ったAIの費用', yen(k.yen)]].forEach(function (x) { var d = el('div'); d.appendChild(el('small', null, x[0])); d.appendChild(el('b', null, x[1])); sg.appendChild(d); });
    b.appendChild(sg);
    b.appendChild(el('p', 'hint', '件数は実際の記録から数えています（2026-11-16 の改修から）。完成品への貢献＝その社員が工程を完成させた案件のうち、納品まで届いた数'));
    b.appendChild(el('p', 'field', '担当している案件'));
    if (!s.cases.length) b.appendChild(el('p', 'hint', 'なし'));
    s.cases.forEach(function (c) { b.appendChild(el('p', '', '「' + c.title + '」：' + c.task + (c.wait ? '（' + WAIT_LABEL[c.wait.kind] + '）' : ''))); });
    if (s.next) { b.appendChild(el('p', 'field', '次の工程')); b.appendChild(el('p', '', s.next)); }
    b.appendChild(el('p', 'field', '直近の成果'));
    b.appendChild(el('p', '', s.last ? day(s.last.at) + ' ' + hm(s.last.at) + '　' + s.last.text + (s.last.title ? '（' + s.last.title + '）' : '') : 'まだありません'));
    var mine = (s.history || []).slice(1, 10);
    if (mine.length) { b.appendChild(el('p', 'field', '作業の履歴')); mine.forEach(function (e) { b.appendChild(el('p', 'hint', day(e.at) + ' ' + hm(e.at) + '　' + e.text + (e.title ? '（' + e.title + '）' : ''))); }); }
    b.appendChild(btn('閉じる', 'btn ghost', function () { $('sheet').hidden = true; }));
    $('sheet').hidden = false;
  }
  $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) $('sheet').hidden = true; });

  // ---- 完成品 ----
  var ST = { waiting: '確認待ち', adopted: '採用', rejected: '却下', fixing: '修正中', posted: '投稿済み' };
  // 紹介番号の一覧（KOT-11）：商品と番号を確認・コピーする。番号の無い既存の完成品には「番号を付ける」で割り当てる（消さない・番号は使い回さない）
  function numbersPanel() {
    var d = el('details', 'card'); d.appendChild(el('summary', null, '紹介番号の一覧（Instagramと楽天ROOMで同じ番号）'));
    var body = el('div'); d.appendChild(body);
    function paintNums(r) {
      body.textContent = '';
      body.appendChild(el('p', 'hint', 'Instagramの画像・キャプションと楽天ROOMの紹介文に、同じ番号を載せています。楽天ROOM内で番号を検索できるかは未確認のため、検索できるとは案内していません。'));
      if (!r.numbers.length) body.appendChild(el('p', 'hint', 'まだ番号を付けた商品はありません。'));
      r.numbers.forEach(function (n) {
        var row = el('p', '', n.no + '　' + n.name.slice(0, 40) + (n.sets.length ? '（' + n.sets.map(function (s) { return s.title; }).join('、') + '）' : ''));
        row.appendChild(copyBtn('番号をコピー', n.no)); body.appendChild(row);
      });
      if (r.numbers.length) body.appendChild(copyBtn('一覧をまとめてコピー', r.numbers.map(function (n) { return n.no + ' ' + n.name; }).join('\n')));
      if (r.unnumbered && r.unnumbered.length) {
        body.appendChild(el('p', 'hint warn', '番号の無い完成品が' + r.unnumbered.length + '件あります：' + r.unnumbered.map(function (s) { return s.title; }).join('、')));
        body.appendChild(btn('既存の完成品に番号を付ける（中身は消しません）', 'btn small', function () { api({ action: 'productNumbersMigrate' }).then(function (m) { if (m.status === 200) paintNums(m.data); else body.appendChild(el('p', 'hint warn', (m.data && m.data.error) || '番号を付けられませんでした')); }); }));
      }
    }
    d.addEventListener('toggle', function () { if (d.open && !body.firstChild) api({ action: 'productNumbers' }).then(function (r) { if (r.status === 200 && r.data.numbers) paintNums(r.data); else body.appendChild(el('p', 'hint warn', (r.data && (r.data.error || r.data.notice)) || '一覧を読めませんでした')); }); });
    return d;
  }
  function renderSets() {
    openSet = null;
    var box = $('sets'); box.textContent = '';
    box.appendChild(numbersPanel());
    (state.drafts || []).forEach(function (d) {
      var c = el('details', 'card draft');
      c.appendChild(el('summary', null, '画像待ちの制作物：「' + d.title + '」'));
      c.appendChild(el('p', 'hint', '画像以外はできています（' + d.step + (d.wait ? '・' + d.wait : '') + '）。画像ができたら正式な投稿セットとして届きます'));
      if (d.pickReason) c.appendChild(el('p', '', '選定理由：' + d.pickReason));
      d.products.forEach(function (p) { c.appendChild(el('p', '', p.role + '：' + p.name.slice(0, 40) + '（' + Number(p.price).toLocaleString('ja-JP') + '円）')); });
      c.appendChild(el('p', 'field', 'Instagramのキャプション（案）')); c.appendChild(el('pre', 'text', d.caption));
      box.appendChild(c);
    });
    if (!state.sets.length) { box.appendChild(el('p', 'card hint', 'まだ完成品はありません。社員が完成させると、ここに届きます。')); return; }
    state.sets.forEach(function (x) {
      var c = el('button', 'card set-row'); c.type = 'button';
      var img = el('img'); img.src = '..' + x.image; img.alt = ''; img.loading = 'lazy'; c.appendChild(img);
      var t = el('div', 'set-txt'); t.appendChild(el('p', 'set-title', x.title)); t.appendChild(el('p', 'hint', day(x.deliveredAt) + ' 納品・' + (ST[x.status] || x.status) + (x.unverified ? '・未確認の商品' + x.unverified + '点' : ''))); c.appendChild(t);
      if (x.status === 'waiting') c.classList.add('waiting');
      c.addEventListener('click', function () { showSet(x.id); });
      box.appendChild(c);
    });
  }
  function copyBtn(label, text) { return btn(label, 'btn small', function (e) { var b = e.target; navigator.clipboard.writeText(text).then(function () { b.textContent = 'コピーしました'; setTimeout(function () { b.textContent = label; }, 1500); }); }); }
  function list(items, ordered) { var l = el(ordered ? 'ol' : 'ul', 'plain'); items.forEach(function (t) { l.appendChild(el('li', null, t)); }); return l; }
  function showSet(id) {
    var box = $('sets'); box.textContent = ''; openSet = id;
    box.appendChild(btn('← 完成品の一覧', 'btn ghost', function () { renderSets(); }));
    api({ action: 'set', id: id }).then(function (r) {
      if (r.status !== 200) { box.appendChild(el('p', 'card hint', (r.data && r.data.error) || '読み込めませんでした')); return; }
      var s = r.data.set;
      var c = el('div', 'card');
      c.appendChild(el('p', 'set-title big', s.title));
      c.appendChild(el('p', 'hint', (ST[s.status] || s.status) + '・' + day(s.deliveredAt) + ' ' + hm(s.deliveredAt) + ' 納品' + (s.revisions ? '・修正' + s.revisions + '回' : '')));
      if (s.postable) c.appendChild(el('p', s.postable.ok ? 'hint' : 'hint warn', s.postable.ok ? '投稿できる状態です（表紙・PR表記・商品6点・URL・ROOM紹介文がそろっている）' : '投稿できない：' + s.postable.missing.join('・') + 'が足りない'));
      if (s.theme || s.aim) { c.appendChild(el('p', 'field', '投稿テーマと狙い')); c.appendChild(el('p', '', (s.theme ? 'テーマ：' + s.theme : '') + (s.target ? '／対象：' + s.target : ''))); if (s.aim) c.appendChild(el('p', '', '狙い：' + s.aim)); }
      if (s.pickReason) c.appendChild(el('p', '', '選定理由：' + s.pickReason + (s.band ? '（' + s.band + '）' : '')));
      if (s.who) c.appendChild(el('p', 'hint', '誰に：' + s.who + (s.problem ? '／悩み：' + s.problem : '') + (s.whyNow ? '／なぜ今：' + s.whyNow : '')));
      if (s.image) { var fig = el('figure', 'cover'); var img = el('img'); img.src = '..' + s.image.url; img.alt = '表紙画像'; fig.appendChild(img); fig.appendChild(el('figcaption', null, s.image.label)); c.appendChild(fig); }
      // 表紙画像は社長がChatGPTで作って追加する（2026-11-17 AIの画像生成を停止）。前の画像は消さずに残る
      var up = el('div', 'cover-up');
      up.appendChild(el('p', 'field', s.image ? '表紙画像を差し替える' : '表紙画像はまだありません'));
      // デザイナーAIの作り直し（2026-11-17 再開：1企画1枚・自動の描き直しなし。作り直しは社長が頼む）
      var left = 3 - (s.regenCount || 0);
      if (s.regenPending) up.appendChild(el('p', 'hint', 'デザイナーが表紙画像を作り直しています（次の定期実行で1枚描きます。前の画像は残ります）'));
      else if (left > 0) up.appendChild(btn('AIで表紙画像を作り直す（1枚 約15円・あと' + left + '回）', 'btn ghost small-ghost', function () { if (!confirm('デザイナーAIに表紙画像を1枚描き直してもらいますか？（約15円・前の画像は残ります）')) return; api({ action: 'regenImage', id: s.id }).then(function (r) { if (r.status !== 200) { alert((r.data && r.data.error) || '頼めませんでした'); return; } refresh().then(function () { showSet(s.id); }); }); }));
      up.appendChild(el('p', 'hint', '自分で作った画像（ChatGPTなど）を選ぶと、表紙に入ります（費用0円）'));
      var fi = el('input'); fi.type = 'file'; fi.accept = 'image/*'; up.appendChild(fi);
      var upMsg = el('p', 'hint');
      up.appendChild(btn(s.image ? '画像を差し替える' : '表紙画像を追加', 'btn small', function () {
        var f = fi.files && fi.files[0]; if (!f) { upMsg.textContent = '画像を選んでください'; return; }
        upMsg.textContent = '送っています…';
        shrink(f).then(function (dataUrl) { return api({ action: 'setImage', id: s.id, image: dataUrl }); }).then(function (r) { if (r.status !== 200) { upMsg.textContent = (r.data && r.data.error) || '追加できませんでした'; return; } refresh().then(function () { showSet(s.id); }); }, function (e) { upMsg.textContent = e.message; });
      }));
      up.appendChild(upMsg); c.appendChild(up);
      box.appendChild(c);
      if (s.order && s.order.length) { var o = el('div', 'card'); o.appendChild(el('p', 'field', '推奨の投稿順')); o.appendChild(list(s.order, true)); box.appendChild(o); }
      var ig = el('div', 'card');
      ig.appendChild(el('p', 'field', 'Instagramに貼る画像'));
      ig.appendChild(el('p', 'hint', (s.image ? '表紙（社長が追加した画像）' : '表紙（商品写真で組み立て。表紙画像を追加すると差し替わります）') + '→ 商品カード → 楽天ROOMへの案内の順です。この端末で作ります（費用はかかりません）'));
      var strip = el('div', 'slides'); ig.appendChild(strip);
      var igStatus = el('p', 'hint', '画像を作っています…'); ig.appendChild(igStatus);
      box.appendChild(ig);
      if (window.V2Reel) box.appendChild(reelCard(s));
      if (s.seo) box.appendChild(seoCard(s));
      if (window.V2Ig) window.V2Ig.buildSlides(s).then(function (out) {
        igStatus.textContent = out.files.length + '枚' + (out.missing ? '（商品写真を読み込めなかった商品が' + out.missing + '点あります）' : '') + (out.cover ? '' : '（表紙画像を読み込めなかったため、表紙は文字だけです）');
        out.urls.forEach(function (u, i) { var im = el('img'); im.src = u; im.alt = out.files[i].name; strip.appendChild(im); });
        ig.appendChild(btn('画像をまとめて保存（' + out.files.length + '枚）', 'btn', function () { window.V2Ig.saveFiles(out.files); }));
        ig.appendChild(el('p', 'hint', 'iPhoneでは共有の画面で「画像を保存」を選ぶと、写真に入ります'));
      }, function (e) { igStatus.textContent = '画像を作れませんでした（' + e.message + '）'; });
      var cap = el('div', 'card'); cap.appendChild(el('p', 'field', 'Instagramのキャプション')); cap.appendChild(el('pre', 'text', s.caption)); cap.appendChild(copyBtn('キャプションをコピー', s.caption)); box.appendChild(cap);
      if (s.hashtags && s.hashtags.length) { var h = el('div', 'card'); h.appendChild(el('p', 'field', 'ハッシュタグ（' + s.hashtags.length + '個）')); var ht = s.hashtags.join(' '); h.appendChild(el('pre', 'text', ht)); h.appendChild(copyBtn('ハッシュタグをコピー', ht)); box.appendChild(h); }
      s.products.forEach(function (p, i) {
        var pc = el('div', 'card product');
        var row = el('div', 'p-row'); var pi = el('img'); pi.src = p.image; pi.alt = ''; row.appendChild(pi);
        var pt = el('div'); pt.appendChild(el('p', 'p-role', (p.no ? p.no + '　' : '') + (p.role || (i ? '代替・比較' : '本命')))); pt.appendChild(el('p', 'p-name', p.name)); pt.appendChild(el('p', 'hint', Number(p.price).toLocaleString('ja-JP') + '円' + (p.band ? '（' + p.band + '）' : '') + '・' + p.shop)); row.appendChild(pt); pc.appendChild(row);
        if (p.check) pc.appendChild(el('p', 'hint ' + (p.unverified ? 'warn' : 'ok'), p.check));
        var a = el('a', 'link', '楽天の商品ページを開く'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; pc.appendChild(a);
        pc.appendChild(el('p', 'field', '楽天ROOMの紹介文')); pc.appendChild(el('pre', 'text', p.room));
        var roomText = (p.no && p.room.indexOf(p.no) < 0 ? '【' + p.no + '】' : '') + p.room +(p.tags && p.tags.length ? '\n\n' + p.tags.join(' ') : '');
        if (p.code && window.V2Ig) {
          pc.appendChild(el('p', 'hint', p.roomDone ? '楽天ROOMに登録済み（社長の記録）' : '① 紹介文をコピー → ② 楽天ROOMで貼り付けて登録 → ③「ROOMに登録した」を押す'));
          var rb = el('div', 'btns');
          // ROOMは普通のリンクで開く（1.0と同じ）。押した瞬間に紹介文をコピーし、そのままリンクが開く（2026-11-16 社長の報告：プログラムで新しい画面を開くと、iPhoneで真っ白のページになった）
          var ra = el('a', 'btn small', '紹介文をコピーしてROOMを開く'); ra.href = window.V2Ig.roomUrl(p.code); ra.target = '_blank'; ra.rel = 'noopener';
          ra.addEventListener('click', function () { var ok = window.V2Ig.copyNow(roomText); ra.textContent = ok ? 'コピーしました。ROOMを開きます' : 'コピーできませんでした（下の「紹介文だけコピー」を使ってください）'; });
          rb.appendChild(ra);
          rb.appendChild(btn('紹介文だけコピー', 'btn ghost', function (e) { var b = e.currentTarget; b.textContent = window.V2Ig.copyNow(roomText) ? 'コピーしました' : 'コピーできませんでした'; setTimeout(function () { b.textContent = '紹介文だけコピー'; }, 2000); }));
          rb.appendChild(btn(p.roomDone ? '登録を取り消す（記録だけ）' : 'ROOMに登録した', p.roomDone ? 'btn ghost' : 'btn', function () { api({ action: 'room', id: s.id, code: p.code, done: !p.roomDone }).then(function () { showSet(s.id); }); }));
          pc.appendChild(rb);
        } else pc.appendChild(copyBtn('紹介文をコピー', roomText));
        box.appendChild(pc);
      });
      if (s.compare && s.compare.length) { var cp = el('div', 'card'); cp.appendChild(el('p', 'field', '本命と代替の比較')); s.compare.forEach(function (x) { cp.appendChild(el('p', '', x.name + '：' + Number(x.price).toLocaleString('ja-JP') + '円（' + x.vsHero + '）')); }); cp.appendChild(el('p', 'hint', (s.compare[0] || {}).note || '')); box.appendChild(cp); }
      if (s.notes && s.notes.length) { var nt = el('div', 'card'); nt.appendChild(el('p', 'field', '投稿時の注意事項')); nt.appendChild(list(s.notes)); box.appendChild(nt); }
      var d = el('div', 'card decide');
      d.appendChild(el('p', 'field', '社長の判断'));
      if (s.status === 'waiting') {
        var note = el('textarea'); note.placeholder = '修正依頼のときは、直してほしい所を書いてください'; note.rows = 2;
        var row2 = el('div', 'btns');
        row2.appendChild(btn('採用', 'btn', function () { decide(s.id, 'adopt', ''); }));
        row2.appendChild(btn('修正依頼', 'btn sub', function () { if (!note.value.trim()) { note.focus(); return; } decide(s.id, 'revise', note.value); }));
        row2.appendChild(btn('却下', 'btn ghost', function () { decide(s.id, 'reject', note.value); }));
        d.appendChild(note); d.appendChild(row2);
      } else if (s.status === 'adopted') {
        d.appendChild(el('p', '', '投稿したら押してください（成果の記録に使います）'));
        d.appendChild(btn('投稿した', 'btn', function () { decide(s.id, 'posted', ''); }));
      } else d.appendChild(el('p', 'hint', ST[s.status] || s.status));
      d.appendChild(el('p', 'hint', '投稿は社長が行います（Instagram・楽天ROOMへの自動投稿はしません）'));
      box.appendChild(d);
    });
  }
  function decide(id, decision, note) {
    api({ action: 'decide', id: id, decision: decision, note: note }).then(function (r) {
      if (r.status !== 200) { alert((r.data && r.data.error) || 'できませんでした'); return; }
      refresh().then(function () { showSet(id); });
    });
  }

  // ---- 対応（社長にしかできないこと・社長の指定） ----
  function todoItems() {
    var s = state, out = [];
    if (!s) return out;
    if (s.waiting) out.push({ key: 'sets', title: '完成品の確認（' + s.waiting + '件）', text: '採用・却下・修正依頼を選んでください。確認待ちが5件になると、新しい案件は始めません。' });
    if (s.pr && s.pr.counts.approval) out.push({ key: 'pr', title: 'Instagramのコメント案の承認（' + s.pr.counts.approval + '件）', text: '広報が作り、監査が合格にした案です。送るかどうかは社長が決め、送るときは社長がInstagramで送ります（アプリは送りません）。' });
    if (s.pr && !s.pr.access.fb) out.push({ key: 'prfb', title: '広報が投稿を自分で集めるための設定（1回だけ）', text: 'MetaのFacebookログイン方式でInstagramの公式APIを使えるようにすると、広報が関連アカウントの直近の投稿を毎日自分で集め、コメント案まで作ります。社長にしかできないのは、Metaの開発者ページでのログインと権限の承認です。発行された IG_FB_ACCESS_TOKEN と IG_FB_USER_ID は Vercel の環境変数に入れます（画面・会話には貼らないでください）。費用はかかりません。コメントの送信はこの設定でもできません。' });
    if (!s.active) out.push({ key: 'switch', title: '会社を2.0に切り替える', text: '切り替えると、15分ごとの定期実行をすべて2.0が使います（1.0は止まります。データは消しません。いつでも戻せます）。' });
    return out;
  }
  function renderTodo() {
    var box = $('todo'); box.textContent = '';
    var items = todoItems();
    if (!items.length) box.appendChild(el('p', 'card hint', '今、社長に対応していただくことはありません。'));
    items.forEach(function (it) {
      var c = el('div', 'card'); c.appendChild(el('p', 'field', it.title)); c.appendChild(el('p', '', it.text));
      if (it.key === 'sets') c.appendChild(btn('完成品を見る', 'btn', function () { switchTab('sets'); }));
      if (it.key === 'pr') c.appendChild(btn('広報を開く', 'btn', function () { switchTab('pr'); }));
      if (it.key === 'switch') {
        var lab = el('label', 'check'); var cb = el('input'); cb.type = 'checkbox'; lab.appendChild(cb); lab.appendChild(document.createTextNode(' 1.0のデータのバックアップを保存した')); c.appendChild(lab);
        var a = el('a', 'link', '1.0の「社長の対応」を開く（バックアップを保存）'); a.href = '../v1/#todo'; c.appendChild(a);
        c.appendChild(btn('2.0に切り替える', 'btn', function () { if (!cb.checked) { alert('先に1.0のバックアップを保存してください'); return; } if (!confirm('2.0に切り替えますか？（1.0の定期実行は止まります。データは消しません）')) return; api({ action: 'activate', on: true }).then(refresh); }));
      }
      box.appendChild(c);
    });
    // 社長の指定（任意）：次の新しい案件で優先する
    var rq = el('div', 'card');
    rq.appendChild(el('p', 'field', 'テーマ・商品の指定（任意）'));
    rq.appendChild(el('p', 'hint', '指定がなくても、企画が自分で新しい案件を始めます。指定すると次の新しい案件で優先します。'));
    var ti = el('input'); ti.type = 'text'; ti.placeholder = 'テーマ（例：冬の乾燥対策）'; rq.appendChild(ti);
    var ui = el('input'); ui.type = 'url'; ui.placeholder = '楽天の商品ページのURL（任意）'; rq.appendChild(ui);
    rq.appendChild(btn('指定する', 'btn', function () { api({ action: 'request', text: ti.value, url: ui.value }).then(function (r) { if (r.status !== 200) { alert((r.data && r.data.error) || 'できませんでした'); return; } ti.value = ''; ui.value = ''; refresh(); }); }));
    (state.requests || []).forEach(function (q) { rq.appendChild(el('p', 'hint', '待っている指定：' + (q.text || '') + (q.url ? '（商品の指定）' : ''))); });
    box.appendChild(rq);
    if (state.active && !state.v1Retired) { var back = el('div', 'card'); back.appendChild(el('p', 'field', '1.0に戻す')); back.appendChild(el('p', 'hint', '定期実行を1.0と交互に戻します（2.0のデータは消しません）')); back.appendChild(btn('1.0に戻す', 'btn ghost', function () { if (confirm('1.0に戻しますか？')) api({ action: 'activate', on: false }).then(refresh); })); box.appendChild(back); }
  }

  // ---- 成果とお金（完成品・品質・正確性・重複・費用。売上は社長の入力） ----
  // ---- リール（2026-11-18 集客）：完成品の商品写真・価格・特徴から、この端末で縦型の動画を作る（AIなし・費用0円）。投稿は社長がInstagramで手動 ----
  // ---- 検索に出るための文言（2026-11-18 集客・ライター作）：キャプションの2行目・代替テキスト・ハッシュタグ・ストーリーズの文。投稿は社長 ----
  function seoCard(s) {
    var o = s.seo, c = el('div', 'card');
    c.appendChild(el('p', 'field', '検索に出るための文言（ライター作）'));
    c.appendChild(el('p', 'hint', '探す人が入れそうな言葉：' + o.keywords.join('・')));
    [['キャプションの2行目に貼る1文', o.line], ['代替テキスト（投稿の「詳細設定」→「代替テキストを書く」）', o.alt], ['ハッシュタグ（3〜5個にしぼる）', o.hashtags.join(' ')], ['ストーリーズの文（リンクスタンプで楽天ROOMへ）', o.story]].forEach(function (x) {
      var r = el('div', 'copy-row'); r.appendChild(el('p', 'hint', x[0])); r.appendChild(el('p', '', x[1])); r.appendChild(copyBtn('コピー', x[1])); c.appendChild(r);
    });
    return c;
  }
  // ---- 集客の施策のボード（2026-11-18）：できるか・効果・根拠・状態・手順と文面。実行は社長がInstagramで手で（アプリは送らない・投稿しない） ----
  function growthBoard() {
    var G = state.growth, c = el('div', 'card growth');
    c.appendChild(el('p', 'field', '集客の施策（入口を増やす）'));
    if (!G) { c.appendChild(el('p', 'hint', '読み込めませんでした')); return c; }
    var n = G.counts;
    c.appendChild(el('p', 'hint', '実行できる ' + n.ready + '・実行中 ' + n.doing + '・効果あり ' + n.measured + '・見直し ' + n.review + '・AIの提案 ' + n.proposed + '・準備中 ' + n.preparing + '。効果は、成果タブで実績を登録するときに「使った施策」を付けると、ほかの投稿の平均閲覧と比べて自動で判定します（' + G.effectX + '倍以上で効果あり・3投稿以上で平均以下なら見直し）。'));
    var order = ['review', 'proposed', 'ready', 'doing', 'measured', 'preparing'];
    var list = G.tactics.filter(function (t) { return t.status !== 'dropped'; }).sort(function (a, b) { return order.indexOf(a.status) - order.indexOf(b.status); });
    list.forEach(function (t) { c.appendChild(tacticItem(t)); });
    var gone = G.tactics.filter(function (t) { return t.status === 'dropped'; });
    if (gone.length) { var d = el('details'); d.appendChild(el('summary', null, 'しないこと・やめた施策（' + gone.length + '件）')); gone.forEach(function (t) { var p = el('p', 'hint', t.name + '：' + (t.how === 'no' ? t.why : (t.droppedWhy || 'やめた'))); if (t.how !== 'no') p.appendChild(btn('戻す', 'btn ghost small-ghost', function () { growthDo(t.id, 'reopen'); })); d.appendChild(p); }); c.appendChild(d); }
    return c;
  }
  function tacticItem(t) {
    var d = el('details', 'tactic st-' + t.status);
    var sm = el('summary'); sm.appendChild(el('span', 'tag', t.statusLabel)); sm.appendChild(document.createTextNode(' ' + t.name)); d.appendChild(sm);
    d.appendChild(el('p', 'hint', t.channel + '・' + t.howLabel + '・期待できる効果：' + t.effect + (t.source === 'ai' ? '（AIの提案' + (t.replaces ? '：「' + t.replaces + '」の代わり' : '') + '）' : '')));
    d.appendChild(el('p', 'hint', t.why));
    d.appendChild(el('p', 'hint', t.basis));
    if (t.note) d.appendChild(el('p', t.status === 'preparing' ? 'hint warn' : 'hint', t.note));
    var e = t.eval || {};
    if (e.posts) d.appendChild(el('p', 'hint', '実績：' + e.posts + '投稿・平均閲覧 ' + e.avg + '（ほかの投稿の平均 ' + (e.base == null ? '未集計' : e.base) + '）' + (e.profile != null ? '・プロフィール平均 ' + e.profile : '') + (e.room ? '・ROOMへの流入 ' + e.room : '') + '　判定：' + ({ effective: '効果あり', review: '見直し', measuring: 'まだ判定できる数がない' })[e.result]));
    else if (t.status === 'doing') d.appendChild(el('p', 'hint', t.scope === 'post' ? '実績を登録するとき「使った施策」にこの施策を付けると、効果を判定します' : '始めた日（' + (t.doneAt ? day(t.doneAt) : '-') + '）の前後の投稿の閲覧を比べて判定します'));
    if (t.steps.length) { d.appendChild(el('p', 'field', '社長の手順')); d.appendChild(list(t.steps, true)); }
    t.texts.forEach(function (x) { var r = el('div', 'copy-row'); r.appendChild(el('p', 'hint', x.label)); r.appendChild(el('p', 'pre', x.text)); r.appendChild(copyBtn('コピー', x.text)); d.appendChild(r); });
    var row = el('div', 'btns');
    if (t.status !== 'doing' && t.status !== 'measured') row.appendChild(btn(t.status === 'proposed' ? 'やってみる' : 'やった（始めた）', 'btn small', function () { growthDo(t.id, 'doing'); }));
    row.appendChild(btn('やめる', 'btn ghost small-ghost', function () { var w = prompt('やめる理由（任意）：例）設定が見つからなかった', ''); if (w === null) return; growthDo(t.id, 'drop', w); }));
    d.appendChild(row);
    return d;
  }
  function growthDo(id, decision, why) { api({ action: 'growthDecide', id: id, decision: decision, why: why || '' }).then(function (r) { if (r.status !== 200) { alert((r.data && r.data.error) || 'できませんでした'); return; } refresh().then(renderPr); }); }
  function reelCard(s) {
    var c = el('div', 'card');
    c.appendChild(el('p', 'field', 'リールを作る（10〜20秒・縦型）'));
    c.appendChild(el('p', 'hint', '商品写真・価格・特徴だけで、この端末の中で動画にします（AIは使いません・費用0円）。最初の2秒で引きつけ、最後に楽天ROOMへ案内します。作ったら「動画を保存」→ Instagramでリールとして投稿してください。'));
    var msg = el('p', 'hint'); var out = el('div');
    var row = el('div', 'btns');
    window.V2Reel.formats(s).forEach(function (f) {
      var b = btn(f.label, f.ok ? 'btn small' : 'btn ghost', function () {
        if (!f.ok) { msg.textContent = f.why || 'この完成品では作れません'; return; }
        msg.textContent = '動画を作っています（実際の長さの時間がかかります）… 0%'; out.textContent = '';
        window.V2Reel.make(s, f.id, window.V2Ig.loadImage, function (p) { msg.textContent = '動画を作っています… ' + Math.round(p * 100) + '%'; }).then(function (r) {
          msg.textContent = f.label + '（' + Math.round(r.seconds) + '秒・' + (r.mime === 'video/mp4' ? 'MP4' : 'WebM：iPhoneのSafariで作るとMP4になります') + '）';
          var v = el('video'); v.src = r.url; v.controls = true; v.setAttribute('playsinline', ''); v.muted = true; v.className = 'reel-video'; out.appendChild(v);
          var rb = el('div', 'btns');
          rb.appendChild(btn('動画を保存', 'btn small', function () { var file = new File([r.blob], r.name, { type: r.mime }); if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).catch(function () {}); else { var a = document.createElement('a'); a.href = r.url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); } }));
          rb.appendChild(btn('リール用キャプションをコピー', 'btn ghost', function (e) { var bb = e.currentTarget; bb.textContent = window.V2Ig.copyNow(window.V2Reel.caption(s, f.id)) ? 'コピーしました' : 'コピーできませんでした'; }));
          out.appendChild(rb);
          out.appendChild(el('p', 'hint', '投稿したら、数日後に「成果」タブでインサイトの数字（スクショでも可）を登録してください。次の企画とリールに反映します。'));
          api({ action: 'reelMade', id: s.id, format: f.id, bytes: r.blob ? r.blob.size : 0, seconds: r.seconds, mime: r.mime }); // 実ファイルの大きさ・長さを記録（作れていなければサーバーが記録しない）
        }, function (e) { msg.textContent = 'リールを作れませんでした：' + e.message; });
      });
      if (!f.ok) b.title = f.why || '';
      row.appendChild(b);
    });
    c.appendChild(row); c.appendChild(msg); c.appendChild(out);
    if (s.hooks) c.appendChild(el('p', 'hint', '冒頭の一言（ライター作）：' + [s.hooks.reveal, s.hooks.top3].filter(Boolean).join('／')));
    return c;
  }
  // ---- Instagramの実績（2026-11-18 集客）：インサイトの数字を登録（スクショから読み取り→社長が確かめて登録）。推測で埋めない ----
  var PF = [['views', '閲覧数'], ['reach', 'リーチ'], ['nonFollowerPct', 'フォロワー以外の割合（%）'], ['saves', '保存'], ['shares', 'シェア'], ['likes', 'いいね'], ['comments', 'コメント'], ['profileVisits', 'プロフィールへのアクセス'], ['linkClicks', 'リンクのタップ'], ['roomClicks', '楽天ROOMへの流入（楽天アフィリエイトで確認）'], ['sales', '売上（円・確認できたもの）'], ['orders', '成約件数（楽天アフィリエイトのレポート）'], ['reward', '確定報酬（円）'], ['cost', 'この投稿にかけた費用（円）']];
  function perfCard() {
    var R = state.reach; var c = el('div', 'card');
    c.appendChild(el('p', 'field', 'Instagramの実績（集客の成果）'));
    if (!R) { c.appendChild(el('p', 'hint', '読み込めませんでした')); return c; }
    var S = R.summary;
    c.appendChild(el('p', 'hint', '段階の検証目標（保証ではありません）：1投稿あたり閲覧 ' + S.milestones.map(function (m) { return m.target + '回（達成' + m.reached + '件）'; }).join('・') + (S.posts ? '。これまでの最高 ' + S.topViews + '回' + (S.nextTarget ? '・次の目標 ' + S.nextTarget + '回' : '') : '。まだ登録がありません')));
    if (S.formats.length) { var t = el('div'); S.formats.forEach(function (f) { var p = el('p', 'money-row'); p.appendChild(el('span', null, f.label + '（' + f.posts + '件）')); p.appendChild(el('b', null, '平均閲覧 ' + f.avgViews + (f.avgSaves != null ? '・保存 ' + f.avgSaves : '') + (f.avgProfile != null ? '・プロフィール ' + f.avgProfile : '') + (f.avgNonFollower != null ? '・非フォロワー ' + f.avgNonFollower + '%' : ''))); t.appendChild(p); }); c.appendChild(t); }
    c.appendChild(el('p', 'hint', '合計：プロフィールへのアクセス ' + S.totals.profileVisits + '・楽天ROOMへの流入 ' + S.totals.roomClicks + '・売上 ' + S.totals.sales + '円（登録した分だけ）'));
    if (S.best.length) { c.appendChild(el('p', 'field', 'よく見られた投稿')); S.best.forEach(function (b) { c.appendChild(el('p', 'hint', b.title + '（' + b.format + '）閲覧 ' + b.views + (b.saves != null ? '・保存 ' + b.saves : ''))); }); }
    // 登録フォーム
    var f = el('details', 'perf-form'); f.appendChild(el('summary', null, '実績を登録する'));
    f.appendChild(el('p', 'hint', 'インサイトの画面のスクショを選ぶと、数字を読み取って下に入れます（約1円）。確かめて直してから「登録」を押してください。読めない数字は空のままです。'));
    var shot = el('input'); shot.type = 'file'; shot.accept = 'image/*'; f.appendChild(shot);
    var rmsg = el('p', 'hint');
    var inputs = {};
    f.appendChild(btn('スクショから数字を読む', 'btn small ghost', function () { var file = shot.files && shot.files[0]; if (!file) { rmsg.textContent = 'スクショを選んでください'; return; } rmsg.textContent = '読み取っています…'; shrink(file).then(function (d) { return api({ action: 'perfRead', image: d }); }).then(function (r) { if (r.status !== 200) { rmsg.textContent = (r.data && r.data.error) || '読めませんでした'; return; } var x = r.data.read || {}; PF.forEach(function (k) { if (x[k[0]] != null) inputs[k[0]].value = x[k[0]]; }); if (x.format) fmt.value = x.format; if (x.postedAt) dt.value = x.postedAt; rmsg.textContent = '読み取りました。確かめてから登録してください' + (r.data.note ? '（' + r.data.note + '）' : ''); }, function (e) { rmsg.textContent = e.message; }); }));
    f.appendChild(rmsg);
    var setSel = el('select'); setSel.appendChild(new Option('完成品（任意）', '')); (state.sets || []).forEach(function (x) { setSel.appendChild(new Option(x.title, x.id)); }); f.appendChild(setSel);
    var fmt = el('select'); Object.keys(R.formats).forEach(function (k) { fmt.appendChild(new Option(R.formats[k], k)); }); f.appendChild(fmt);
    var dt = el('input'); dt.type = 'date'; f.appendChild(dt);
    var url = el('input'); url.type = 'url'; url.placeholder = '投稿のURL（任意）'; f.appendChild(url);
    PF.forEach(function (k) { var i = el('input'); i.type = 'number'; i.inputMode = 'decimal'; i.placeholder = k[1]; inputs[k[0]] = i; f.appendChild(i); });
    var note = el('input'); note.type = 'text'; note.placeholder = 'メモ（任意）：例）冒頭を問いかけにした'; f.appendChild(note);
    var tks = ((state.growth && state.growth.tactics) || []).filter(function (t) { return t.scope === 'post' && t.status !== 'dropped'; }); var tkBox = {};
    if (tks.length) { f.appendChild(el('p', 'field', '使った集客の施策（効果の判定に使います）')); tks.forEach(function (t) { var lb = el('label', 'check'); var cb = el('input'); cb.type = 'checkbox'; tkBox[t.id] = cb; lb.appendChild(cb); lb.appendChild(document.createTextNode(' ' + t.name)); f.appendChild(lb); }); }
    f.appendChild(btn('登録', 'btn', function () { var p = { setId: setSel.value, format: fmt.value, postedAt: dt.value, url: url.value, note: note.value, source: shot.files && shot.files[0] ? 'screenshot' : 'owner' }; PF.forEach(function (k) { p[k[0]] = inputs[k[0]].value; }); p.tactics = Object.keys(tkBox).filter(function (k) { return tkBox[k].checked; }); api({ action: 'perfAdd', perf: p }).then(function (r) { if (r.status !== 200) { rmsg.textContent = (r.data && r.data.error) || '登録できませんでした'; return; } refresh().then(renderMoney); }); }));
    c.appendChild(f);
    if (R.perf.length) { var l = el('details'); l.appendChild(el('summary', null, '登録した実績（' + R.perf.length + '件）')); R.perf.forEach(function (r) { var p = el('p', 'hint', (r.postedAt || '日付なし') + '　' + (r.title || r.theme || '題名なし') + '（' + (R.formats[r.format] || r.format) + '）閲覧 ' + (r.views ?? '-') + '・リーチ ' + (r.reach ?? '-') + '・保存 ' + (r.saves ?? '-') + '・プロフィール ' + (r.profileVisits ?? '-') + '・ROOM ' + (r.roomClicks ?? '-') + (r.source === 'screenshot' ? '（スクショから）' : '')); var d = btn('消す', 'btn ghost small-ghost', function () { if (confirm('この実績を消しますか？')) api({ action: 'perfDelete', id: r.id }).then(function () { refresh().then(renderMoney); }); }); p.appendChild(d); l.appendChild(p); }); c.appendChild(l); }
    return c;
  }
  function renderMoney() {
    var m = state.money, R = state.results, box = $('money'); box.textContent = '';
    box.appendChild(perfCard());
    var T = state.trial;
    if (T) {
      var t = el('div', 'card');
      t.appendChild(el('p', 'field', '14日間の試験運用（' + day(T.start) + '〜' + day(new Date(Date.parse(T.end) - 1000).toISOString()) + (T.active ? '・実施中' : '・終了') + '）'));
      [['完成した投稿セット', T.delivered + '件'], ['社長が採用', T.adopted + '件'], ['1セットあたりの実費', T.yenPerSet == null ? '未集計（完成0件）' : yen(T.yenPerSet)], ['期間中のAIの費用', yen(T.used) + ' ／ 上限 ' + yen(T.cap)], ['使える残り', yen(T.left) + '（試験の残りと今月の残りの少ない方）'], ['開始時点の今月の支出', yen(T.baseSpent)]].forEach(function (x) { var p = el('p', 'money-row'); p.appendChild(el('span', null, x[0])); p.appendChild(el('b', null, x[1])); t.appendChild(p); });
      t.appendChild(el('p', 'hint', T.active ? '期間中の合計が上限に届く有料の処理はしません。' : '試験は終わりました。上限は自動では増やしません（費用と成果を見て社長が決めます）。'));
      box.appendChild(t);
    }
    if ((state.stopped || []).length) {
      var sp = el('details', 'card');
      sp.appendChild(el('summary', null, '止まった案件と理由（直近' + state.stopped.length + '件）'));
      state.stopped.forEach(function (x) { sp.appendChild(el('p', 'hint', day(x.at) + ' ' + hm(x.at) + '「' + x.title + '」' + x.agent + '：' + x.why)); });
      box.appendChild(sp);
    }
    var r = el('div', 'card');
    r.appendChild(el('p', 'field', '会社の成果（' + R.month.replace('-', '年') + '月）'));
    [['完成した投稿セット', R.delivered + '件（これまでの合計 ' + R.deliveredTotal + '件）'], ['投稿できる品質に届いた割合', pct(R.passRate) + '（完成 ' + R.delivered + '件／途中で止まった ' + R.stopped + '件）'], ['商品情報を楽天で確認できた割合', pct(R.accuracy)], ['企画の重複率（似た企画を弾いた割合）', pct(R.dupRate)], ['1セットあたりの制作費（AI・画像）', R.yenPerSet == null ? '未集計' : yen(R.yenPerSet)], ['社長が採用', R.adopted + '件（投稿済み ' + R.posted + '件）'], ['投稿後の閲覧・クリック', '未取得（Instagramの公式APIの鍵が未設定）']].forEach(function (x) { var p = el('p', 'money-row'); p.appendChild(el('span', null, x[0])); p.appendChild(el('b', null, x[1])); r.appendChild(p); });
    box.appendChild(r);
    var c = el('div', 'card');
    c.appendChild(el('p', 'field', 'AIの費用（実測）'));
    var inTrial = state.trial && state.trial.active;
    [['今日（自律運営）', yen(m.spent.dayAuto) + (inTrial ? '（試験運用中は1日の上限なし）' : ' ／ 上限 ' + yen(m.limits.dayAuto))], ['今月（全体）', yen(m.spent.month) + ' ／ 上限 ' + yen(m.limits.month)], ['今月の画像', yen(m.image.month) + (inTrial ? '（試験運用中は画像の上限なし）' : ' ／ 上限 ' + yen(m.imageLimits.month) + '（今日 ' + yen(m.image.dayYen) + ' ／ 目安 ' + yen(m.imageToday) + '）')]].forEach(function (x) { var p = el('p', 'money-row'); p.appendChild(el('span', null, x[0])); p.appendChild(el('b', null, x[1])); c.appendChild(p); });
    c.appendChild(el('p', 'hint', inTrial ? '試験運用中は、試験期間の合計1,000円と今月の合計1,000円の範囲で、画像の枚数とタイミングを社員が判断します' : '画像の枚数は社員が判断します。月200円の残りを月末までに配分した目安と、ほかの工程に残す100円を守ります'));
    box.appendChild(c);
    var s = el('div', 'card');
    s.appendChild(el('p', 'field', '売上（' + m.month.replace('-', '年') + '月・楽天アフィリエイトの報酬）'));
    s.appendChild(el('p', 'money-big', yen(m.salesMonth) + ' ／ 目標 30,000円'));
    s.appendChild(el('p', 'hint', '楽天には自動で取れる仕組みが無いため、楽天アフィリエイトの報告を見て入力してください。'));
    var inp = el('input'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.placeholder = '今月の報酬（円）'; s.appendChild(inp);
    s.appendChild(btn('保存', 'btn', function () { api({ action: 'sales', month: m.month, yen: inp.value }).then(refresh); }));
    box.appendChild(s);
  }

  // ---- ポスト：社長が「ただ調べてほしい」スクショを入れる（鑑定が商品の候補を抜き出し、バイヤーが楽天で探す。投稿セットは作らない） ----
  var postBusy = false, postMsg = '';
  var LV = { same: '同一商品確認済み', maybe: '同一商品の可能性あり', similar: '類似商品', none: '未特定' };
  // 端末で縮小してから送る（長い辺1280px・JPEG）
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1280 / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { reject(new Error('画像を読み込めませんでした')); };
      img.src = URL.createObjectURL(file);
    });
  }
  function renderPost() {
    var box = $('post'); box.textContent = '';
    var c = el('div', 'card');
    c.appendChild(el('p', 'field', '調べてほしいスクショを入れる'));
    c.appendChild(el('p', 'hint', 'Instagram・ストーリーズ・YouTube・テレビなどのスクショ。鑑定が身につけている物の候補を見つけ、バイヤーが楽天で探します（1枚およそ1〜2円）。人物は画像からは判断しないので、分かればメモに書いてください。'));
    var fi = el('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.id = 'post-file'; c.appendChild(fi);
    var note = el('input'); note.type = 'text'; note.id = 'post-note'; note.placeholder = 'メモ（任意）：例）紅しょうがの帽子とTシャツ'; c.appendChild(note);
    var go = btn(postBusy ? '鑑定が調べています（30秒ほど）…' : 'ポストに入れて調べる', 'btn', function () {
      if (postBusy) return;
      var f = fi.files && fi.files[0];
      if (!f) { postMsg = '画像を選んでください'; renderPost(); return; }
      postBusy = true; postMsg = ''; renderPost();
      shrink(f).then(function (dataUrl) { return api({ action: 'post', image: dataUrl, note: note.value }); }).then(function (r) {
        postBusy = false;
        if (r.status !== 200) postMsg = (r.data && r.data.error) || '調べられませんでした';
        refresh(); renderPost();
      }, function (e) { postBusy = false; postMsg = e.message; renderPost(); });
    });
    go.disabled = postBusy; c.appendChild(go);
    if (postMsg) c.appendChild(el('p', 'hint warn', postMsg));
    box.appendChild(c);
    var list = el('div'); box.appendChild(list);
    api({ action: 'posts' }).then(function (r) {
      var posts = (r.data && r.data.posts) || [];
      if (!posts.length) { list.appendChild(el('p', 'card hint', 'まだポストに入れたスクショはありません。')); return; }
      posts.forEach(function (p) { list.appendChild(postCard(p)); });
    });
  }
  function postCard(p) {
    var c = el('div', 'card post');
    var head = el('div', 'p-row');
    var im = el('img', 'post-img'); im.src = '..' + p.image; im.alt = 'スクショ'; head.appendChild(im);
    var t = el('div');
    t.appendChild(el('p', 'p-name', p.note ? '社長のメモ：' + p.note : 'メモなし（人物は未確認）'));
    t.appendChild(el('p', 'hint', day(p.at) + ' ' + hm(p.at) + '・' + ({ running: '調査中', done: '調査済み', error: '止まった' })[p.status] + (p.yen ? '・' + yen(p.yen) : '')));
    head.appendChild(t); c.appendChild(head);
    if (p.status === 'error') c.appendChild(el('p', 'hint warn', p.error || '調べられませんでした'));
    if (p.lookNote) c.appendChild(el('p', 'hint', '鑑定の注意：' + p.lookNote));
    (p.candidates || []).forEach(function (cd) {
      var d = el('details', 'cand');
      var sm = el('summary'); sm.appendChild(el('span', 'pill lv-' + (cd.level || 'none'), LV[cd.level] || '未特定')); sm.appendChild(document.createTextNode(' ' + (cd.who ? cd.who + '：' : '') + cd.category + (cd.color ? '（' + cd.color + '）' : ''))); d.appendChild(sm);
      var facts = [];
      if (cd.visibleText) facts.push('読めた文字：' + cd.visibleText);
      if (cd.logo) facts.push('ロゴ：' + cd.logo);
      if (cd.print) facts.push('プリント：' + cd.print);
      if (cd.material) facts.push('素材：' + cd.material);
      if (cd.features && cd.features.length) facts.push('特徴：' + cd.features.join('・'));
      facts.forEach(function (x) { d.appendChild(el('p', 'hint', x)); });
      if (!cd.visibleText) d.appendChild(el('p', 'hint', 'ブランドの文字やロゴが読めないため、同じ商品とは言えません。下は見た目の種類・色で探した似た商品です。'));
      (cd.matches || []).forEach(function (m) {
        var row = el('div', 'p-row match');
        var mi = el('img'); mi.src = m.image; mi.alt = ''; row.appendChild(mi);
        var mt = el('div'); mt.appendChild(el('p', 'p-name small', m.name.slice(0, 60))); mt.appendChild(el('p', 'hint', Number(m.price).toLocaleString('ja-JP') + '円・' + m.shop + '・' + m.label));
        mt.appendChild(el('p', 'hint', '根拠：' + m.why));
        var a = el('a', 'link', '楽天で見る'); a.href = m.url; a.target = '_blank'; a.rel = 'noopener'; mt.appendChild(a);
        row.appendChild(mt); d.appendChild(row);
      });
      if (!(cd.matches || []).length) d.appendChild(el('p', 'hint', '楽天で見つかりませんでした（未特定）'));
      c.appendChild(d);
    });
    c.appendChild(btn('このスクショを消す', 'btn ghost small-ghost', function () { api({ action: 'postDelete', id: p.id }).then(renderPost); }));
    return c;
  }

  // ---- 広報：Instagramの交流（コメント案は社長の承認制。アプリは送らない） ----
  var prMsg = '';
  function renderPr() {
    var box = $('pr'); box.textContent = '';
    var P = state.pr; if (!P) { box.appendChild(el('p', 'card hint', '読み込めませんでした')); return; }
    box.appendChild(growthBoard());
    var info = el('div', 'card');
    info.appendChild(el('p', 'field', '広報の交流（常設の仕事）'));
    info.appendChild(el('p', 'hint', '広報は、公式サイトから関連アカウントを自分で探し、投稿の文章を読めたものにだけコメント案を作ります。Instagramの公式APIには、他の人の投稿にコメント・いいね・フォローする機能が無いため、アプリからは送りません（非公式な方法・ブラウザの自動操作でも送りません）。「送った」と表示するのは、Instagramで確認できたものと社長の記録だけです。'));
    info.appendChild(el('p', 'hint', '決まり：1日' + P.access.limits.dayDrafts + '件まで／同じアカウントには' + P.access.limits.handleDays + '日に1件まで／投稿の文章に無いことは書かない／宣伝・定型の褒め言葉・絵文字は監査とコードで落とす'));
    info.appendChild(el('p', 'hint ' + (P.access.fb ? '' : 'warn'), P.access.fb ? '公式API（Facebookログイン方式）：設定済み。関連アカウントの直近の投稿を1日1回集めます' : '公式API（Facebookログイン方式）：未設定。投稿を自動では集められないため、交流候補は社長が追加した投稿だけです'));
    box.appendChild(info);
    // 人気投稿を探す場所（完成品のハッシュタグのページ。開くのは社長・自動では集めない）
    var tags = (state.reach && state.reach.exploreTags) || [];
    if (tags.length) { var ex = el('div', 'card'); ex.appendChild(el('p', 'field', '今日、交流先を探す場所（完成品のハッシュタグ）')); ex.appendChild(el('p', 'hint', 'タップするとInstagramのハッシュタグのページが開きます。買ってくれそうな人が見ている人気の投稿を選び、URLと投稿の文章を下の「交流候補の投稿を追加」に入れると、広報がコメント案を作ります（アプリは自動で集めたり、コメントを送ったりしません）。')); var tr = el('div', 'tag-row'); tags.forEach(function (t) { var a = el('a', 'tag-link', '#' + t); a.href = 'https://www.instagram.com/explore/tags/' + encodeURIComponent(t) + '/'; a.target = '_blank'; a.rel = 'noopener'; tr.appendChild(a); }); ex.appendChild(tr); box.appendChild(ex); }
    box.appendChild(prHistory(P));
    box.appendChild(prReach(P));
    box.appendChild(el('h2', 'h2', 'コメント案（まだ送っていない）'));
    var groups = [['approval', '社長の承認待ち'], ['approved', '承認済み（Instagramで送ったら記録）'], ['audit', '監査の採点待ち'], ['revise', '広報が直している'], ['sent', '送った（社長の申告）'], ['failed', '送れなかった（社長の申告）'], ['rejected', '見送り'], ['dropped', '監査で不合格（送らない）']];
    groups.forEach(function (g) {
      var ds = P.drafts.filter(function (d) { return d.status === g[0]; });
      if (!ds.length) return;
      box.appendChild(el('h2', 'h2', g[1] + '（' + ds.length + '件）'));
      ds.forEach(function (d) { box.appendChild(prCard(d)); });
    });
    if (!P.drafts.length) box.appendChild(el('p', 'card hint', 'まだコメント案はありません。下で交流候補の投稿を追加すると、次の定期実行で広報が案を作ります。'));
    var add = el('div', 'card');
    add.appendChild(el('p', 'field', '交流候補の投稿を追加'));
    add.appendChild(el('p', 'hint', 'Instagramで見つけた投稿のURLと、その投稿の文章（キャプション）を貼ってください。文章が無い投稿には、内容を推測してコメント案を作りません。'));
    var u = el('input'); u.type = 'url'; u.placeholder = 'https://www.instagram.com/p/…'; add.appendChild(u);
    var h = el('input'); h.type = 'text'; h.placeholder = 'アカウント名（任意）：例）shop_name'; add.appendChild(h);
    var c = el('textarea'); c.rows = 4; c.placeholder = '投稿の文章'; add.appendChild(c);
    add.appendChild(btn('交流候補に入れる', 'btn', function () { api({ action: 'prAdd', url: u.value, handle: h.value, caption: c.value }).then(function (r) { prMsg = r.status === 200 ? '入れました。次の定期実行で広報がコメント案を作ります' : (r.data && r.data.error) || '入れられませんでした'; refresh().then(renderPr); }); }));
    if (prMsg) add.appendChild(el('p', 'hint warn', prMsg));
    box.appendChild(add);
    var tg = P.targets.filter(function (t) { return t.status === 'new' || t.status === 'skipped'; });
    if (tg.length) { var tc = el('details', 'card'); tc.appendChild(el('summary', null, 'まだ案の無い交流候補（' + tg.length + '件）')); tg.forEach(function (t) { tc.appendChild(el('p', 'hint', '@' + (t.handle || '不明') + '・' + t.source + '・' + (t.status === 'skipped' ? '案を作らなかった：' + t.why : '案を作る順番待ち（1日の上限・同じアカウントの間隔を守ります）'))); }); box.appendChild(tc); }
    var ac = el('details', 'card'); ac.appendChild(el('summary', null, '関連アカウント（公式サイトがリンクしているInstagram・' + P.accounts.length + '件）'));
    ac.appendChild(el('p', 'hint', P.sitesAt ? '最後に調べた日：' + day(P.sitesAt) + '（7日ごと・費用0円）' : 'まだ調べていません（次の定期実行で広報が調べます）'));
    P.accounts.forEach(function (a) { var p = el('p', 'hint'); var l = el('a', 'link', '@' + a.handle); l.href = 'https://www.instagram.com/' + a.handle + '/'; l.target = '_blank'; l.rel = 'noopener'; p.appendChild(l); p.appendChild(document.createTextNode('　' + a.brand + '（' + a.from + '）')); ac.appendChild(p); });
    box.appendChild(ac);
  }
  // 実際にInstagramへ送ったコメント（根拠つき）と、社長の事後確認
  function prHistory(P) {
    var c = el('div', 'card');
    var H = P.history || [];
    var sent = H.filter(function (e) { return e.result === 'sent'; });
    var flagged = H.filter(function (e) { return e.review && e.review.status === 'flagged'; }).length;
    var unchecked = sent.filter(function (e) { return !e.review || e.review.status === 'unchecked'; }).length;
    c.appendChild(el('p', 'field', '交流の履歴（実際にInstagramへ送ったコメント）'));
    c.appendChild(el('p', 'hint', '送信済み ' + sent.length + '件・送れなかった ' + (H.length - sent.length) + '件／社長が未確認 ' + unchecked + '件' + (flagged ? '・不適切の印 ' + flagged + '件' : '') + '。記録の無い送信・失敗は確認できません（推測で埋めません）。'));
    if (!H.length) { c.appendChild(el('p', 'hint', 'まだ送信の記録はありません。')); return c; }
    var d = el('details'); d.open = unchecked > 0 && unchecked <= 5;
    d.appendChild(el('summary', null, '履歴を見る（' + H.length + '件）'));
    H.forEach(function (e) {
      var r = el('div', 'pr-card');
      var top = el('p', 'hint');
      top.appendChild(el('b', null, '@' + (e.handle || '不明')));
      top.appendChild(document.createTextNode('　' + (e.sentAt ? day(e.sentAt) + ' ' + hm(e.sentAt) : '送信日時の記録なし') + '　' + (e.result === 'sent' ? '送信成功' : '送れなかった')));
      r.appendChild(top);
      r.appendChild(el('p', 'pr-comment', e.text));
      r.appendChild(el('p', 'hint', '根拠：' + e.evidence + (e.by ? '／実行：' + e.by : '／実行：記録なし')));
      r.appendChild(el('p', 'hint' + (e.review.status === 'flagged' ? ' warn' : ''), e.reviewLabel + (e.review.note ? '（' + e.review.note + '）' : '')));
      var row = el('div', 'p-row');
      var a = el('a', 'btn small', 'Instagramで投稿を開く'); a.href = e.postUrl; a.target = '_blank'; a.rel = 'noopener'; row.appendChild(a);
      var rv = function (st, label, cls) { return btn(label, cls || 'btn ghost', function () { var note = st === 'flagged' ? (prompt('どこが不適切か（任意）') || '') : ''; api({ action: 'commentReview', id: e.id, status: st, note: note }).then(function (x) { if (x.status !== 200) alert((x.data && x.data.error) || 'できませんでした'); refresh().then(renderPr); }); }); };
      if (e.result === 'sent' && e.review.status !== 'deleted') {
        if (e.review.status !== 'ok') row.appendChild(rv('ok', '問題なし'));
        if (e.review.status !== 'flagged') row.appendChild(rv('flagged', '不適切'));
        else row.appendChild(rv('deleted', 'Instagramで削除した'));
      }
      r.appendChild(row);
      if (e.review.status === 'flagged') r.appendChild(el('p', 'hint warn', '削除のしかた：「Instagramで投稿を開く」→ 自分のコメントを左にスワイプ（iPhone）→ ゴミ箱のマーク。アプリからは削除できません（公式APIで消せるのは自分の投稿のコメントだけ）。消したら「Instagramで削除した」を押してください。'));
      d.appendChild(r);
    });
    c.appendChild(d);
    return c;
  }
  // 広報が自分で見つけた交流先の実数と、送信できる方法の有無
  function prReach(P) {
    var c = el('div', 'card');
    c.appendChild(el('p', 'field', '広報が自分で見つけた交流先'));
    var sites = P.sites || [];
    var api2 = P.targets.filter(function (t) { return t.source === '公式APIで取得'; }).length;
    c.appendChild(el('p', 'hint', '関連アカウント ' + P.accounts.length + '件（公式サイト ' + sites.length + '件を調べ、' + sites.filter(function (x) { return x.ok; }).length + '件でInstagramへのリンクを確認）／公式APIで集めた投稿 ' + api2 + '件'));
    var leads = P.leads || [];
    if (leads.length) c.appendChild(el('p', 'hint', '企画・バイヤーへ引き継いだ手がかり ' + leads.length + '件（使った ' + leads.filter(function (l) { return l.used; }).length + '件）：' + leads.slice(0, 6).map(function (l) { return l.topic + (l.used ? '（企画「' + l.usedFor + '」で使用）' : ''); }).join('・')));
    c.appendChild(el('p', 'hint ' + (P.access.fb ? '' : 'warn'), P.access.fb ? '投稿の収集：公式API（Facebookログイン方式）で1日1回' : '投稿の収集：未設定。投稿の文章を読めないため、広報はコメント案を作れません（内容を推測して作らないため）。「対応」タブの設定をすると、関連アカウントの投稿を自分で集めます。'));
    c.appendChild(el('p', 'hint', '送信できる方法：他の人の投稿へのコメントは、公式に認められた自動の方法がありません（社長がInstagramで送るだけ）。自分の投稿へのコメントへの返信と、@サングラスくまが付いた投稿への返信は公式APIで送れますが、Instagramのトークン（' + (P.access.ig ? '設定済み' : '未設定') + '）とコメント管理の権限が必要です（未実装）。'));
    return c;
  }
  function prCard(d) {
    var c = el('div', 'card pr-card');
    var a = el('a', 'link', '@' + (d.handle || '不明') + ' の投稿を開く'); a.href = d.url; a.target = '_blank'; a.rel = 'noopener'; c.appendChild(a);
    c.appendChild(el('p', 'hint', '投稿の文章：' + d.caption.slice(0, 100) + (d.caption.length > 100 ? '…' : '') + '（' + d.source + '）'));
    c.appendChild(el('p', 'pr-comment', d.comment));
    c.appendChild(el('p', 'hint', '触れている点：「' + d.anchor + '」' + (d.relevanceWhy ? '・' + d.relevanceWhy : '')));
    if (d.why) c.appendChild(el('p', 'hint', '監査：' + d.why));
    var row = el('div', 'p-row');
    var act = function (decision, label, cls) { return btn(label, cls || 'btn small', function () { var note = decision === 'reject' || decision === 'failed' ? (prompt('理由（任意）') || '') : ''; api({ action: 'prDecide', id: d.id, decision: decision, note: note }).then(function (r) { if (r.status !== 200) alert((r.data && r.data.error) || 'できませんでした'); refresh().then(renderPr); }); }); };
    if (d.status === 'approval') { row.appendChild(act('approve', '承認する（自分で送る）')); row.appendChild(act('reject', '見送る', 'btn ghost')); }
    if (d.status === 'approved') {
      row.appendChild(btn('コメントをコピーして投稿を開く', 'btn small', function (e) { var b = e.currentTarget; b.textContent = window.V2Ig.copyNow(d.comment) ? 'コピーしました' : 'コピーできませんでした'; var w = window.open(d.url, '_blank'); if (!w) location.href = d.url; }));
      row.appendChild(act('sent', '送った')); row.appendChild(act('failed', '送れなかった', 'btn ghost')); row.appendChild(act('reject', 'やめる', 'btn ghost'));
    }
    if (row.childNodes.length) c.appendChild(row);
    var hs = el('details'); hs.appendChild(el('summary', 'hint', '経緯（' + (d.history || []).length + '件）')); (d.history || []).forEach(function (x) { hs.appendChild(el('p', 'hint', day(x.at) + ' ' + hm(x.at) + '　' + nameOf(x.by) + '：' + x.text)); }); c.appendChild(hs);
    return c;
  }

  function switchTab(t) {
    tab = t;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    ['office', 'sets', 'todo', 'post', 'pr', 'biz', 'money', 'dev'].forEach(function (k) { $('tab-' + k).hidden = k !== t; });
    if (!state) return;
    if (t === 'biz') renderBiz();
    if (t === 'dev') renderDev();
    if (t === 'sets') renderSets(); if (t === 'todo') renderTodo(); if (t === 'money') renderMoney(); if (t === 'post') renderPost(); if (t === 'pr') renderPr();
    window.scrollTo(0, 0);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.addEventListener('click', function () { switchTab(b.dataset.tab); }); });

  Office.init($('office'), $('office-labels'), showStaff);
  if (!pass()) askPass(); else refresh();
  setInterval(function () { if (!document.hidden && pass()) refresh(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && pass()) refresh(); });
  window.V2App = { refresh: refresh, switchTab: switchTab };
})();
