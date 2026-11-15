// サングラスくま株式会社 2.0 の画面（2026-11-15）。サーバー（/api/v2）の状態だけを表示する。点数・技術ログは出さない
(function () {
  'use strict';
  var PASS_KEY = 'room-passcode'; // 1.0と同じ合言葉
  var state = null, seenAt = '', openSet = null, tab = 'office';
  var COLOR = { buyer: '#2f6f9f', auditor: '#3d7a4f', planner: '#a0522d', writer: '#7b4fa0', editor: '#b5893a', designer: '#c0504d', pr: '#2b2b2b', owner: '#c49a00' };
  var NAME = { owner: '社長' };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = el('button', cls || 'btn', text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function pass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  function hm(iso) { var d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function day(iso) { var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function today(iso) { return new Date(iso).toDateString() === new Date().toDateString(); }
  function yen(n) { return (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('ja-JP') + '円'; }
  function nameOf(id) { if (NAME[id]) return NAME[id]; var s = state && state.staff.filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }

  function api(body) {
    return fetch('../api/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-passcode': pass() }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); });
  }
  function askPass() { $('pass').hidden = false; $('pass-input').focus(); }
  $('pass-form').addEventListener('submit', function (e) { e.preventDefault(); try { localStorage.setItem(PASS_KEY, $('pass-input').value.trim()); } catch (x) {} $('pass').hidden = true; refresh(); });

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
    var turn = s.staff.filter(function (x) { return x.status === 'turn'; })[0];
    $('top-status').textContent = working ? working.name + 'が仕事中' : turn ? turn.name + 'が担当中（次の定期実行で進めます）' : s.blocked ? '今日のAIの費用の上限に達したので、明日再開します' : s.idle ? '新しい仕事を待っています' : 'みんな待機中';
    $('badge-sets').textContent = s.waiting ? String(s.waiting) : '';
    var todo = todoItems(); $('badge-todo').textContent = todo.length ? String(todo.length) : '';
    Office.update(s.staff);
    renderCrew();
    renderNow(); renderFlow();
    if (tab === 'sets' && !openSet) renderSets();
    if (tab === 'todo') renderTodo();
    if (tab === 'money') renderMoney();
  }

  // ---- 社員の一覧（色・名前・状態。タップで今の仕事と直近の成果） ----
  function renderCrew() {
    var box = $('crew'); box.textContent = '';
    state.staff.forEach(function (x) {
      var b = el('button', x.status); b.type = 'button';
      var top = el('span'); var dot = el('span', 'dot'); dot.style.background = COLOR[x.id]; top.appendChild(dot); top.appendChild(document.createTextNode(' ' + x.name)); b.appendChild(top);
      b.appendChild(el('span', 's', x.status === 'work' ? '仕事中' : x.status === 'turn' ? '担当中' : x.status === 'wait' ? '待ち' : '待機'));
      b.addEventListener('click', function () { showStaff(x.id); });
      box.appendChild(b);
    });
  }

  // ---- オフィス：今の仕事・今日の流れ ----
  function renderNow() {
    var box = $('now-card'); box.textContent = '';
    var s = state;
    var w = s.staff.filter(function (x) { return x.status === 'work'; })[0];
    if (w) {
      box.appendChild(el('p', 'now-who', w.name + '（' + w.job + '）'));
      box.appendChild(el('p', 'now-doing', w.doing));
      if (w.title) box.appendChild(el('p', 'hint', '作っている投稿：「' + w.title + '」'));
    } else if (s.job) {
      box.appendChild(el('p', 'now-who', '次は' + nameOf(s.job.agent) + 'の番'));
      box.appendChild(el('p', 'hint', (s.job.title ? '「' + s.job.title + '」・' : '') + '15分ごとの定期実行で、次の工程に進みます'));
    } else {
      box.appendChild(el('p', 'now-who', 'いまは仕事の合間です'));
      box.appendChild(el('p', 'hint', s.blocked ? '今日のAIの費用の上限に達しました。明日0時に戻ったら再開します' : s.idle || '次の定期実行で新しい仕事を始めます'));
    }
    if (!s.active) box.appendChild(el('p', 'hint note', '動作確認中です（15分ごとの定期実行を1.0と交互に使い、2.0は30分に1回進みます。切り替えは「対応」タブ）'));
  }
  var LABEL = { start: '開始', done: '完成', handoff: '引き継ぎ', wait: '待ち', stop: '停止', deliver: '納品', owner: '社長', retry: 'やり直し' };
  function renderFlow() {
    var ol = $('flow'); ol.textContent = '';
    var evs = state.events.filter(function (e) { return today(e.at); });
    var showDate = false;
    if (!evs.length) { evs = state.events.slice(0, 20); showDate = true; if (evs.length) ol.appendChild(el('li', 'flow-note', '今日はまだ記録がありません。最近の記録：')); }
    if (!evs.length) { ol.appendChild(el('li', 'flow-note', 'まだ仕事の記録がありません')); return; }
    evs.slice(0, 60).reverse().forEach(function (e) { // 社長の例どおり、時刻の古い順（上から下へ）
      var li = el('li', 'ev ev-' + e.type);
      li.appendChild(el('span', 'ev-time', (showDate ? day(e.at) + ' ' : '') + hm(e.at)));
      var who = el('span', 'ev-who', nameOf(e.agent)); who.style.background = COLOR[e.agent] || '#777'; li.appendChild(who);
      var t = el('span', 'ev-text', e.text);
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
    b.appendChild(el('p', 'sheet-st', s.status === 'work' ? '仕事中：' + s.doing : s.status === 'turn' ? '担当中：' + s.doing : s.status === 'wait' ? '待ち：' + s.doing : '待機中（今は担当の仕事がありません）'));
    if (s.title) b.appendChild(el('p', 'hint', '「' + s.title + '」'));
    b.appendChild(el('p', 'field', '直近の成果'));
    b.appendChild(el('p', '', s.last ? day(s.last.at) + ' ' + hm(s.last.at) + '　' + s.last.text : 'まだありません'));
    var mine = state.events.filter(function (e) { return e.agent === id && (e.type === 'done' || e.type === 'deliver' || e.type === 'stop'); }).slice(1, 6);
    if (mine.length) { b.appendChild(el('p', 'field', 'その前の仕事')); mine.forEach(function (e) { b.appendChild(el('p', 'hint', day(e.at) + ' ' + hm(e.at) + '　' + e.text)); }); }
    b.appendChild(btn('閉じる', 'btn ghost', function () { $('sheet').hidden = true; }));
    $('sheet').hidden = false;
  }
  $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) $('sheet').hidden = true; });

  // ---- 完成品 ----
  var ST = { waiting: '確認待ち', adopted: '採用', rejected: '却下', fixing: '修正中' };
  function renderSets() {
    openSet = null;
    var box = $('sets'); box.textContent = '';
    if (!state.sets.length) { box.appendChild(el('p', 'card hint', 'まだ完成品はありません。社員が完成させると、ここに届きます。')); return; }
    state.sets.forEach(function (x) {
      var c = el('button', 'card set-row'); c.type = 'button';
      var img = el('img'); img.src = '..' + x.image; img.alt = ''; img.loading = 'lazy'; c.appendChild(img);
      var t = el('div', 'set-txt'); t.appendChild(el('p', 'set-title', x.title)); t.appendChild(el('p', 'hint', day(x.deliveredAt) + ' 納品・' + (ST[x.status] || x.status))); c.appendChild(t);
      if (x.status === 'waiting') c.classList.add('waiting');
      c.addEventListener('click', function () { showSet(x.id); });
      box.appendChild(c);
    });
  }
  function copyBtn(label, text) { return btn(label, 'btn small', function (e) { var b = e.target; navigator.clipboard.writeText(text).then(function () { b.textContent = 'コピーしました'; setTimeout(function () { b.textContent = label; }, 1500); }); }); }
  function showSet(id) {
    var box = $('sets'); box.textContent = ''; openSet = id;
    box.appendChild(btn('← 完成品の一覧', 'btn ghost', function () { renderSets(); }));
    api({ action: 'set', id: id }).then(function (r) {
      if (r.status !== 200) { box.appendChild(el('p', 'card hint', (r.data && r.data.error) || '読み込めませんでした')); return; }
      var s = r.data.set;
      var c = el('div', 'card');
      c.appendChild(el('p', 'set-title big', s.title));
      c.appendChild(el('p', 'hint', (ST[s.status] || s.status) + '・' + day(s.deliveredAt) + ' ' + hm(s.deliveredAt) + ' 納品' + (s.revisions ? '・修正' + s.revisions + '回' : '')));
      var fig = el('figure', 'cover'); var img = el('img'); img.src = '..' + s.image.url; img.alt = '表紙画像'; fig.appendChild(img); fig.appendChild(el('figcaption', null, s.image.label)); c.appendChild(fig);
      if (s.who) c.appendChild(el('p', '', '誰に：' + s.who + (s.problem ? '／悩み：' + s.problem : '') + (s.whyNow ? '／なぜ今：' + s.whyNow : '')));
      box.appendChild(c);
      var cap = el('div', 'card'); cap.appendChild(el('p', 'field', 'Instagramの文章')); cap.appendChild(el('pre', 'text', s.caption)); cap.appendChild(copyBtn('文章をコピー', s.caption)); box.appendChild(cap);
      s.products.forEach(function (p, i) {
        var pc = el('div', 'card product');
        var row = el('div', 'p-row'); var pi = el('img'); pi.src = p.image; pi.alt = ''; row.appendChild(pi);
        var pt = el('div'); pt.appendChild(el('p', 'p-name', (i + 1) + '. ' + p.short)); pt.appendChild(el('p', 'hint', Number(p.price).toLocaleString('ja-JP') + '円・' + p.shop)); row.appendChild(pt); pc.appendChild(row);
        var a = el('a', 'link', '楽天の商品ページを開く'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; pc.appendChild(a);
        pc.appendChild(el('p', 'field', '楽天ROOMの紹介文')); pc.appendChild(el('pre', 'text', p.room)); pc.appendChild(copyBtn('紹介文をコピー', p.room));
        box.appendChild(pc);
      });
      if (s.status === 'waiting') {
        var d = el('div', 'card decide');
        d.appendChild(el('p', 'field', '社長の判断'));
        var note = el('textarea'); note.placeholder = '修正依頼のときは、直してほしい所を書いてください'; note.rows = 2;
        var row2 = el('div', 'btns');
        row2.appendChild(btn('採用', 'btn', function () { decide(s.id, 'adopt', ''); }));
        row2.appendChild(btn('修正依頼', 'btn sub', function () { if (!note.value.trim()) { note.focus(); return; } decide(s.id, 'revise', note.value); }));
        row2.appendChild(btn('却下', 'btn ghost', function () { decide(s.id, 'reject', note.value); }));
        d.appendChild(note); d.appendChild(row2);
        d.appendChild(el('p', 'hint', '投稿は社長が行います（Instagram・楽天ROOMへの自動投稿はしません）'));
        box.appendChild(d);
      }
    });
  }
  function decide(id, decision, note) {
    api({ action: 'decide', id: id, decision: decision, note: note }).then(function (r) {
      if (r.status !== 200) { alert((r.data && r.data.error) || 'できませんでした'); return; }
      refresh().then(function () { showSet(id); });
    });
  }

  // ---- 対応（社長にしかできないこと） ----
  function todoItems() {
    var s = state, out = [];
    if (!s) return out;
    if (s.waiting) out.push({ key: 'sets', title: '完成品の確認（' + s.waiting + '件）', text: '採用・却下・修正依頼を選んでください。確認待ちが3件になると、新しい投稿セットは作りません。' });
    if (!s.active) out.push({ key: 'switch', title: '会社を2.0に切り替える', text: '切り替えると、15分ごとの定期実行で2.0の社員が働きます（1.0は止まります。データは消しません。いつでも戻せます）。' });
    return out;
  }
  function renderTodo() {
    var box = $('todo'); box.textContent = '';
    var items = todoItems();
    if (!items.length) box.appendChild(el('p', 'card hint', '今、社長に対応していただくことはありません。'));
    items.forEach(function (it) {
      var c = el('div', 'card'); c.appendChild(el('p', 'field', it.title)); c.appendChild(el('p', '', it.text));
      if (it.key === 'sets') c.appendChild(btn('完成品を見る', 'btn', function () { switchTab('sets'); }));
      if (it.key === 'switch') {
        var lab = el('label', 'check'); var cb = el('input'); cb.type = 'checkbox'; lab.appendChild(cb); lab.appendChild(document.createTextNode(' 1.0のデータのバックアップを保存した')); c.appendChild(lab);
        var a = el('a', 'link', '1.0の「社長の対応」を開く（バックアップを保存）'); a.href = '../#todo'; c.appendChild(a);
        c.appendChild(btn('2.0に切り替える', 'btn', function () { if (!cb.checked) { alert('先に1.0のバックアップを保存してください'); return; } if (!confirm('2.0に切り替えますか？（1.0の定期実行は止まります。データは消しません）')) return; api({ action: 'activate', on: true }).then(refresh); }));
      }
      box.appendChild(c);
    });
    if (state.active) { var back = el('div', 'card'); back.appendChild(el('p', 'field', '1.0に戻す')); back.appendChild(el('p', 'hint', '定期実行を1.0に戻します（2.0のデータは消しません）')); back.appendChild(btn('1.0に戻す', 'btn ghost', function () { if (confirm('1.0に戻しますか？')) api({ action: 'activate', on: false }).then(refresh); })); box.appendChild(back); }
  }

  // ---- お金（実測の費用と、社長が入力する売上） ----
  function renderMoney() {
    var m = state.money, box = $('money'); box.textContent = '';
    var c = el('div', 'card');
    c.appendChild(el('p', 'field', 'AIの費用（実測）'));
    [['今日（自律運営）', yen(m.spent.dayAuto) + ' ／ 上限 ' + yen(m.limits.dayAuto)], ['今月（全体）', yen(m.spent.month) + ' ／ 上限 ' + yen(m.limits.month)], ['今月の画像', yen(m.image.month) + ' ／ 上限 ' + yen(m.imageLimits.month) + '（今日 ' + m.image.dayCount + '枚 ／ ' + m.imageLimits.dayCount + '枚）']].forEach(function (r) { var p = el('p', 'money-row'); p.appendChild(el('span', null, r[0])); p.appendChild(el('b', null, r[1])); c.appendChild(p); });
    box.appendChild(c);
    var s = el('div', 'card');
    s.appendChild(el('p', 'field', '売上（' + m.month.replace('-', '年') + '月・楽天アフィリエイトの報酬）'));
    s.appendChild(el('p', 'money-big', yen(m.salesMonth)));
    s.appendChild(el('p', 'hint', '楽天には自動で取れる仕組みが無いため、楽天アフィリエイトの報告を見て入力してください。'));
    var inp = el('input'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.placeholder = '今月の報酬（円）'; s.appendChild(inp);
    s.appendChild(btn('保存', 'btn', function () { api({ action: 'sales', month: m.month, yen: inp.value }).then(refresh); }));
    box.appendChild(s);
  }

  function switchTab(t) {
    tab = t;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    ['office', 'sets', 'todo', 'money'].forEach(function (k) { $('tab-' + k).hidden = k !== t; });
    if (!state) return;
    if (t === 'sets') renderSets(); if (t === 'todo') renderTodo(); if (t === 'money') renderMoney();
    window.scrollTo(0, 0);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.addEventListener('click', function () { switchTab(b.dataset.tab); }); });

  Office.init($('office'), $('office-labels'), showStaff);
  if (!pass()) askPass(); else refresh();
  setInterval(function () { if (!document.hidden && pass()) refresh(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && pass()) refresh(); });
  window.V2App = { refresh: refresh, switchTab: switchTab };
})();
