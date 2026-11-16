// サングラスくま株式会社 2.0 の画面（2026-11-15・2026-11-16 24時間の自律運営に対応）。サーバー（/api/v2）の状態だけを表示する。点数・技術ログは出さない
(function () {
  'use strict';
  var PASS_KEY = 'room-passcode'; // 1.0と同じ合言葉
  var SEEN_KEY = 'v2-seen-notice';
  var state = null, seenAt = '', openSet = null, tab = 'office';
  var COLOR = { buyer: '#2f6f9f', auditor: '#3d7a4f', planner: '#a0522d', writer: '#7b4fa0', editor: '#b5893a', designer: '#c0504d', pr: '#2b2b2b', owner: '#c49a00' };
  var ST_LABEL = { work: '仕事中', turn: '担当中', handoff: '引き継ぎ中', error: 'エラー', budget: '予算待ち', wait: '画像待ち', idle: '待機' };
  var WAIT_LABEL = { image: '画像待ち', budget: '予算待ち', retry: '再試行待ち' };

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
    $('top-status').textContent = working ? working.name + 'が仕事中' : s.cases.length ? '案件' + s.cases.length + '件を進行中（' + active + '件が次の定期実行で進みます）' : s.blocked ? '今日のAIの費用の上限に達しました。明日0時に戻ったら再開します' : s.idle || '次の定期実行で新しい仕事を始めます';
    $('badge-sets').textContent = s.waiting ? String(s.waiting) : '';
    var todo = todoItems(); $('badge-todo').textContent = todo.length ? String(todo.length) : '';
    notice();
    Office.update(s.staff);
    renderCrew(); renderCases(); renderFlow();
    if (tab === 'sets' && !openSet) renderSets();
    if (tab === 'todo') renderTodo();
    if (tab === 'money') renderMoney();
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
    if (!s.active) box.appendChild(el('p', 'hint note', '動作確認中：15分ごとの定期実行を1.0と交互に使い、2.0は30分に1回進みます（切り替えは「対応」タブ）'));
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
    b.appendChild(el('p', 'sheet-st', ST_LABEL[s.status] + (s.doing ? '：' + s.doing : '（今は担当の仕事がありません）')));
    b.appendChild(el('p', 'field', '担当している案件'));
    if (!s.cases.length) b.appendChild(el('p', 'hint', 'なし'));
    s.cases.forEach(function (c) { b.appendChild(el('p', '', '「' + c.title + '」：' + c.task + (c.wait ? '（' + WAIT_LABEL[c.wait.kind] + '）' : ''))); });
    if (s.next) { b.appendChild(el('p', 'field', '次の工程')); b.appendChild(el('p', '', s.next)); }
    b.appendChild(el('p', 'field', '直近の成果'));
    b.appendChild(el('p', '', s.last ? day(s.last.at) + ' ' + hm(s.last.at) + '　' + s.last.text + (s.last.title ? '（' + s.last.title + '）' : '') : 'まだありません'));
    var mine = state.events.filter(function (e) { return e.agent === id && (e.type === 'done' || e.type === 'deliver' || e.type === 'stop' || e.type === 'retry'); }).slice(1, 7);
    if (mine.length) { b.appendChild(el('p', 'field', 'その前の仕事')); mine.forEach(function (e) { b.appendChild(el('p', 'hint', day(e.at) + ' ' + hm(e.at) + '　' + e.text)); }); }
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
      var fig = el('figure', 'cover'); var img = el('img'); img.src = '..' + s.image.url; img.alt = '表紙画像'; fig.appendChild(img); fig.appendChild(el('figcaption', null, s.image.label)); c.appendChild(fig);
      box.appendChild(c);
      if (s.order && s.order.length) { var o = el('div', 'card'); o.appendChild(el('p', 'field', '推奨の投稿順')); o.appendChild(list(s.order, true)); box.appendChild(o); }
      var cap = el('div', 'card'); cap.appendChild(el('p', 'field', 'Instagramのキャプション')); cap.appendChild(el('pre', 'text', s.caption)); cap.appendChild(copyBtn('キャプションをコピー', s.caption)); box.appendChild(cap);
      if (s.hashtags && s.hashtags.length) { var h = el('div', 'card'); h.appendChild(el('p', 'field', 'ハッシュタグ（' + s.hashtags.length + '個）')); var ht = s.hashtags.join(' '); h.appendChild(el('pre', 'text', ht)); h.appendChild(copyBtn('ハッシュタグをコピー', ht)); box.appendChild(h); }
      s.products.forEach(function (p, i) {
        var pc = el('div', 'card product');
        var row = el('div', 'p-row'); var pi = el('img'); pi.src = p.image; pi.alt = ''; row.appendChild(pi);
        var pt = el('div'); pt.appendChild(el('p', 'p-role', p.role || (i ? '代替・比較' : '本命'))); pt.appendChild(el('p', 'p-name', p.name)); pt.appendChild(el('p', 'hint', Number(p.price).toLocaleString('ja-JP') + '円' + (p.band ? '（' + p.band + '）' : '') + '・' + p.shop)); row.appendChild(pt); pc.appendChild(row);
        if (p.check) pc.appendChild(el('p', 'hint ' + (p.unverified ? 'warn' : 'ok'), p.check));
        var a = el('a', 'link', '楽天の商品ページを開く'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; pc.appendChild(a);
        pc.appendChild(el('p', 'field', '楽天ROOMの紹介文')); pc.appendChild(el('pre', 'text', p.room)); pc.appendChild(copyBtn('紹介文をコピー', p.room));
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
    if (s.waiting) out.push({ key: 'sets', title: '完成品の確認（' + s.waiting + '件）', text: '採用・却下・修正依頼を選んでください。確認待ちが3件になると、新しい案件は始めません。' });
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
      if (it.key === 'switch') {
        var lab = el('label', 'check'); var cb = el('input'); cb.type = 'checkbox'; lab.appendChild(cb); lab.appendChild(document.createTextNode(' 1.0のデータのバックアップを保存した')); c.appendChild(lab);
        var a = el('a', 'link', '1.0の「社長の対応」を開く（バックアップを保存）'); a.href = '../#todo'; c.appendChild(a);
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
    if (state.active) { var back = el('div', 'card'); back.appendChild(el('p', 'field', '1.0に戻す')); back.appendChild(el('p', 'hint', '定期実行を1.0と交互に戻します（2.0のデータは消しません）')); back.appendChild(btn('1.0に戻す', 'btn ghost', function () { if (confirm('1.0に戻しますか？')) api({ action: 'activate', on: false }).then(refresh); })); box.appendChild(back); }
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
