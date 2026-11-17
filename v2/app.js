// サングラスくま株式会社 2.0 の画面（2026-11-15・2026-11-16 24時間の自律運営に対応）。サーバー（/api/v2）の状態だけを表示する。点数・技術ログは出さない
(function () {
  'use strict';
  var PASS_KEY = 'room-passcode'; // 1.0と同じ合言葉
  var SEEN_KEY = 'v2-seen-notice';
  var state = null, seenAt = '', openSet = null, tab = 'office';
  var COLOR = { buyer: '#2f6f9f', auditor: '#3d7a4f', planner: '#a0522d', writer: '#7b4fa0', editor: '#b5893a', designer: '#c0504d', pr: '#2b2b2b', appraiser: '#3b6e8f', owner: '#c49a00' };
  // 担当中＝今この瞬間に処理しているときだけ（2026-11-16）。ほかは理由ごとに分ける
  var ST_LABEL = { work: '仕事中', queued: '順番待ち（続けて進めます）', handoff: '引き継ぎ中', approval: '承認待ち', error: 'エラー・再試行待ち', budget: '予算待ち', wait: '画像待ち', idle: '仕事なし' };
  var WAIT_LABEL = { image: '画像待ち', budget: '予算待ち', retry: '再試行待ち', quota: 'OpenAIの残高待ち', slot: '完成品の枠待ち（企画と商品は保存済み）', hold: '保留（商品が6点に足りない。24時間後にもう一度探す）' };

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

  function render() {
    var s = state;
    var working = s.staff.filter(function (x) { return x.status === 'work'; })[0];
    var active = s.cases.filter(function (c) { return !c.wait; }).length;
    if (s.quota) { $('top-status').textContent = 'OpenAIの残高がないため、AIを使う仕事を止めています。残高が戻ったら自動で続きから再開します（次に確かめる時刻 ' + hm(s.quota.until) + '）'; } else
    $('top-status').textContent = working ? working.name + 'が仕事中' : s.cases.length ? '案件' + s.cases.length + '件を進行中（' + active + '件が次の定期実行で進みます）' : s.blocked ? '今日のAIの費用の上限に達しました。明日0時に戻ったら再開します' : s.idle || '次の定期実行で新しい仕事を始めます';
    $('badge-sets').textContent = s.waiting ? String(s.waiting) : '';
    $('badge-pr').textContent = s.pr && s.pr.counts.approval ? String(s.pr.counts.approval) : '';
    var todo = todoItems(); $('badge-todo').textContent = todo.length ? String(todo.length) : '';
    notice();
    Office.update(s.staff);
    renderCrew(); renderCases(); renderFlow();
    if (tab === 'sets' && !openSet) renderSets();
    if (tab === 'todo') renderTodo();
    if (tab === 'money') renderMoney();
    if (tab === 'pr') renderPr();
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
  function renderSets() {
    openSet = null;
    var box = $('sets'); box.textContent = '';
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
        var pt = el('div'); pt.appendChild(el('p', 'p-role', p.role || (i ? '代替・比較' : '本命'))); pt.appendChild(el('p', 'p-name', p.name)); pt.appendChild(el('p', 'hint', Number(p.price).toLocaleString('ja-JP') + '円' + (p.band ? '（' + p.band + '）' : '') + '・' + p.shop)); row.appendChild(pt); pc.appendChild(row);
        if (p.check) pc.appendChild(el('p', 'hint ' + (p.unverified ? 'warn' : 'ok'), p.check));
        var a = el('a', 'link', '楽天の商品ページを開く'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; pc.appendChild(a);
        pc.appendChild(el('p', 'field', '楽天ROOMの紹介文')); pc.appendChild(el('pre', 'text', p.room));
        var roomText = p.room + (p.tags && p.tags.length ? '\n\n' + p.tags.join(' ') : '');
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
  function renderMoney() {
    var m = state.money, R = state.results, box = $('money'); box.textContent = '';
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
    var info = el('div', 'card');
    info.appendChild(el('p', 'field', '広報の交流（常設の仕事）'));
    info.appendChild(el('p', 'hint', '広報は、公式サイトから関連アカウントを自分で探し、投稿の文章を読めたものにだけコメント案を作ります。Instagramの公式APIには、他の人の投稿にコメント・いいね・フォローする機能が無いため、アプリからは送りません（非公式な方法・ブラウザの自動操作でも送りません）。「送った」と表示するのは、Instagramで確認できたものと社長の記録だけです。'));
    info.appendChild(el('p', 'hint', '決まり：1日' + P.access.limits.dayDrafts + '件まで／同じアカウントには' + P.access.limits.handleDays + '日に1件まで／投稿の文章に無いことは書かない／宣伝・定型の褒め言葉・絵文字は監査とコードで落とす'));
    info.appendChild(el('p', 'hint ' + (P.access.fb ? '' : 'warn'), P.access.fb ? '公式API（Facebookログイン方式）：設定済み。関連アカウントの直近の投稿を1日1回集めます' : '公式API（Facebookログイン方式）：未設定。投稿を自動では集められないため、交流候補は社長が追加した投稿だけです'));
    box.appendChild(info);
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
    ['office', 'sets', 'todo', 'post', 'pr', 'money'].forEach(function (k) { $('tab-' + k).hidden = k !== t; });
    if (!state) return;
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
