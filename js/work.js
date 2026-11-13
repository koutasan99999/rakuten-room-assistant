// 第1段階（2026-11-14）：AI社員の出勤状況・業務日報（経営報告のいちばん上。会社のトップ画面からも開ける）。
// 表示するのは、実際に動いた記録だけ（AIの呼び出し・コードの処理・保存された成果物）。架空の日報・活動は作らない。常に働いているような演出もしない。
// 稼働状況：仕事中（この画面で実際に処理が動いている）／承認待ち（成果物を提出済みで、社長の判断待ち）／今は仕事していません／エラー（最後の仕事が失敗）／状態未確認（途中で通信が切れた・アプリが閉じられた等で、完了を確かめられない）
// 出勤＝その日に最初の仕事を始めた時刻、退勤＝その日の最後の仕事が終わった時刻（仕事中なら退勤なし）。
(function () {
  'use strict';

  var K = window.AppKit;
  var open = {};
  var repaint = function () {};
  var DAY = 86400000;
  var liveJobs = {}; // 検索ジョブで今動いている種類（pitch・company・explore など）
  var jobsAt = 0;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function hm(iso) { try { var d = new Date(iso); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; } }
  function stamp(iso) { try { var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm(iso); } catch (e) { return ''; } }
  function jst(iso) { return new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10); }
  function today() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function yen(n) { return (Math.round((Number(n) || 0) * 100) / 100) + '円'; }
  function sum(runs, k) { return (runs || []).reduce(function (a, r) { return a + (Number(r[k]) || 0); }, 0); }
  function tokens(runs) { return sum(runs, 'promptTokens') + sum(runs, 'completionTokens'); }
  function startOf(runs, fallback) { var t = (runs || []).map(function (r) { return new Date(r.at).getTime() - (Number(r.ms) || 0); }).filter(function (x) { return isFinite(x); }); return t.length ? new Date(Math.min.apply(null, t)).toISOString() : fallback; }
  function endOf(runs, fallback) { var t = (runs || []).map(function (r) { return new Date(r.at).getTime(); }).filter(function (x) { return isFinite(x); }); return t.length ? new Date(Math.max.apply(null, t)).toISOString() : fallback; }
  function go(hash, after) { location.hash = hash; setTimeout(function () { if (after) after(); window.scrollTo(0, 0); }, 300); }
  function log() { return window.AiUsage && window.AiUsage.log ? window.AiUsage.log() : []; }

  // 検索ジョブ（時間のかかる処理）で、今動いているものを確かめる（画面を描くたびに、最大10秒に1回）
  function refreshJobs() {
    var J = window.SearchJobs;
    if (!J || Date.now() - jobsAt < 10000) return;
    jobsAt = Date.now();
    J.list().then(function (list) {
      var next = {};
      list.filter(function (j) { return j.status === 'running' || j.status === 'queued'; }).forEach(function (j) { next[j.type] = { label: j.label, at: j.startedAt ? new Date(j.startedAt).toISOString() : new Date(j.createdAt).toISOString() }; });
      var changed = JSON.stringify(Object.keys(next).sort()) !== JSON.stringify(Object.keys(liveJobs).sort());
      liveJobs = next;
      if (changed) repaint();
    }, function () {});
  }

  // ---- 仕事の記録（実際の記録から作る）----
  // item：{ start, end, state:'ok'|'failed'|'running'|'unknown', what, error, calls, cost, tokens, rakuten, deliverables, pending, open }
  function buyerItems() {
    var A = window.AgentsStore;
    if (!A) return [];
    var live = window.AgentsView && window.AgentsView.liveId ? window.AgentsView.liveId() : null;
    return A.sessions().slice(0, 20).map(function (x) {
      var runs = (x.runs || []).filter(function (r) { return r.role === 'buyer'; });
      var st = x.status === 'running' ? (live === x.id ? 'running' : 'unknown') : x.status === 'unknown' ? 'unknown' : x.status === 'failed' ? 'failed' : 'ok';
      return {
        start: x.at, end: st === 'running' || st === 'unknown' ? '' : x.endedAt || endOf(x.runs, x.at), state: st, what: '商品の候補を探す（テーマ：' + x.theme + '）',
        error: st === 'failed' || st === 'unknown' ? (x.failedStep || '') + '：' + (x.error || '') : '',
        calls: runs, cost: sum(runs, 'yen'), tokens: tokens(runs), rakuten: x.rakutenCalls || 0,
        deliverables: (x.candidates || []).map(function (c) { var v = c.versions[c.versions.length - 1]; return v.data.name.slice(0, 30) + '（' + v.data.price + '円）：' + ({ pass: '合格', hold: '保留', reject: '不合格', revise: '修正中' }[c.status] || c.status) + (v.audit ? '・' + v.audit.total + '点' : '') + (c.owner ? '・社長が' + (c.owner.decision === 'adopt' ? '採用' : '見送り') : ''); }),
        pending: x.status === 'done' ? (x.candidates || []).filter(function (c) { return c.status === 'pass' && !c.owner; }).length : 0,
        open: function () { go('#company'); }
      };
    });
  }
  function auditorItems() {
    var out = [];
    var A = window.AgentsStore;
    if (A) A.sessions().slice(0, 20).forEach(function (x) {
      var runs = (x.runs || []).filter(function (r) { return r.role === 'auditor'; });
      if (!runs.length) return;
      out.push({ start: startOf(runs, x.at), end: endOf(runs, x.at), state: runs.some(function (r) { return r.ok; }) ? 'ok' : 'failed', what: 'バイヤーAIの候補を採点（' + (x.candidates || []).length + '件）', error: runs.every(function (r) { return !r.ok; }) ? runs[0].error || '失敗' : '',
        calls: runs, cost: sum(runs, 'yen'), tokens: tokens(runs),
        deliverables: (x.candidates || []).map(function (c) { var v = c.versions[c.versions.length - 1]; return v.data.name.slice(0, 24) + '：' + (v.audit ? v.audit.total + '点・提案 ' + ({ pass: '合格', revise: '修正', hold: '保留', reject: '却下' }[v.audit.proposal] || '') : '採点なし'); }), pending: 0, open: function () { go('#company'); } });
    });
    var R = window.PrStore;
    if (R) R.runs().slice(0, 20).forEach(function (r) {
      var runs = (r.runs || []).filter(function (x) { return x.role === 'auditor'; });
      if (!runs.length) return;
      out.push({ start: startOf(runs, r.at), end: endOf(runs, r.at), state: runs.some(function (x) { return x.ok; }) ? 'ok' : 'failed', what: '営業・交流担当AIのコメント案を採点（' + (r.posts || []).length + '件）', error: runs.every(function (x) { return !x.ok; }) ? runs[0].error || '失敗' : '',
        calls: runs, cost: sum(runs, 'yen'), tokens: tokens(runs), deliverables: Object.keys(r.result || {}).map(function (k) { return '投稿 ' + k + '：' + ({ pass: '合格', hold: '保留', reject: '不合格', failed: '失敗' }[r.result[k]] || r.result[k]); }), pending: 0, open: function () { go('#pr'); } });
    });
    return out.sort(function (a, b) { return a.start < b.start ? 1 : -1; });
  }
  function outreachItems() {
    var R = window.PrStore;
    if (!R) return [];
    var live = window.PrView && window.PrView.liveRunId ? window.PrView.liveRunId() : '';
    var posts = R.posts();
    return R.runs().slice(0, 20).map(function (r) {
      var runs = (r.runs || []).filter(function (x) { return x.role === 'outreach'; });
      var mine = posts.filter(function (p) { return (r.posts || []).indexOf(p.id) !== -1; });
      var st = r.status === 'running' ? (live === r.id ? 'running' : 'unknown') : r.status === 'failed' ? 'failed' : 'ok';
      return {
        start: r.at, end: st === 'running' || st === 'unknown' ? '' : r.endedAt || endOf(r.runs, r.at), state: st, what: '他の人の投稿へのコメント案（' + mine.length + '件）',
        error: st === 'failed' ? r.failedStep + '：' + r.error : st === 'unknown' ? '途中でアプリが閉じられた・通信が切れたため、完了を確認できません' : '',
        calls: runs, cost: sum(runs, 'yen'), tokens: tokens(runs),
        // 成果物は、この仕事の結果（result）だけ。あとの仕事の結果をこの仕事の成果にしない
        deliverables: mine.map(function (p) { var res = (r.result || {})[p.id]; var o = p.outreach || {}; var own = o.runId === r.id; return '@' + (p.handle || '不明') + '：' + (res ? ({ pass: '合格' + (own && o.final ? '「' + o.final + '」' : ''), hold: '保留', reject: '不合格', failed: '失敗' }[res] || res) : '結果の記録なし') + (own && p.status === 'commented' ? '・社長がコメント済み' : own && p.status === 'skipped' ? '・見送り' : ''); }),
        pending: st === 'ok' ? mine.filter(function (p) { return p.status === 'todo' && p.outreach && p.outreach.runId === r.id && p.outreach.status === 'pass'; }).length : 0,
        open: function () { go('#pr'); }
      };
    });
  }
  // AIの呼び出しの記録（room-ai-usage）から：同じ種類で、続けて呼んだもの（2分以内）を1つの仕事にまとめる
  function aiLogItems(types, label, openFn) {
    var rows = log().filter(function (r) { return types.some(function (t) { return r.type.indexOf(t) === 0; }); }).sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    var groups = [];
    rows.forEach(function (r) {
      var g = groups[groups.length - 1];
      if (g && g.type === r.type && new Date(r.at).getTime() - new Date(g.end).getTime() < 120000) { g.runs.push(r); g.end = r.at; } else groups.push({ type: r.type, runs: [r], end: r.at });
    });
    return groups.reverse().slice(0, 20).map(function (g) {
      var ok = g.runs.some(function (r) { return r.ok; });
      return { start: startOf(g.runs, g.end), end: g.end, state: ok ? 'ok' : 'failed', what: label(g.type), error: ok ? '' : (g.runs[0].error || '失敗'), calls: g.runs, cost: sum(g.runs, 'yen'), tokens: tokens(g.runs), deliverables: [], pending: 0, open: openFn };
    });
  }
  function meetingItems() {
    var C = window.CompanyStore;
    if (!C) return [];
    return C.meetings().slice(0, 20).filter(function (m) { return m.at; }).map(function (m) {
      return { start: m.at, end: m.at, state: m.status === 'ok' ? 'ok' : 'failed', what: '毎日の経営会議（旧方式：1回のAI呼び出しで複数の役を書き分ける）', error: m.status !== 'ok' ? (m.error || (m.status === 'partial' ? 'AIの会議は失敗（工程の確認と割り当てだけ）' : '失敗')) : '',
        calls: null, cost: null, tokens: null, deliverables: [m.summary || ''].filter(Boolean), pending: 0, open: function () { go('#company'); } };
    });
  }
  function perfItems() {
    var P = window.PerfStore;
    if (!P) return [];
    return P.accountLog().slice(-20).reverse().map(function (a) { return { start: a.at, end: a.at, state: a.error ? 'failed' : 'ok', what: 'Instagramの数字を公式APIから取り込み（コード・AIなし）', error: a.error || '', calls: [], cost: 0, tokens: 0, deliverables: ['フォロワー ' + (a.followers == null ? '未取得' : a.followers)], pending: 0, open: function () { go('#pr'); } }; });
  }

  // 社員の一覧（名前・役職・担当業務と、仕事の記録の出どころ）
  function staff() {
    var C = window.CompanyStore;
    var P = window.PitchStore;
    var D = window.DeliveryStore;
    var proposals = C ? C.proposals().filter(function (p) { return p.status === 'open'; }).length : 0;
    var review = C ? C.tasks(true).filter(function (t) { return t.status === 'review'; }).length : 0;
    return [
      { key: 'outreach', name: '営業・交流担当AI', title: '営業部', duty: '他の人の投稿（文章を確認できたもの）へのコメント案とフォロー候補の評価。送信は社長', items: outreachItems() },
      { key: 'buyer', name: 'バイヤーAI（試験）', title: '商品部', duty: '楽天の実際の検索結果から、紹介する商品の候補を最大3件', items: buyerItems() },
      { key: 'auditor', name: '監査AI', title: '品質管理', duty: 'バイヤーAI・営業・交流担当AIの成果物を、別のAI呼び出しで採点・修正指示', items: auditorItems() },
      { key: 'pitch', name: '商品の提案（プレゼン）', title: '商品部', duty: '「次の商品を探してもらう」「広げる」で、楽天の商品を探してプレゼンを書く', jobTypes: ['pitch', 'explore', 'explore_more'], items: aiLogItems(['pitch:scout', 'pitch:more', 'pitch:seed', 'pitch:expand', 'explore'], function (t) { return /expand|explore/.test(t) ? '「広げる」で関連商品を探す' : '商品を探してプレゼンを書く'; }, function () { go('#pitch'); }), extraPending: P ? P.queue().length : 0, extraLabel: '社長の判断待ちのプレゼン' },
      { key: 'set', name: '投稿セットの制作', title: '制作部', duty: '採用した商品で、Instagramの1投稿分（企画・画像の文字・キャプション）とROOM紹介文を作る', items: aiLogItems(['pitch:set', 'pitch:roomtext', 'pitch:tags', 'pitch:intro'], function (t) { return /roomtext|tags|intro/.test(t) ? 'ROOM紹介文・ハッシュタグを作る' : '投稿セットを作る'; }, function () { go('#pitch', function () { if (window.PitchView && window.PitchView.show) window.PitchView.show('sets'); }); }), extraPending: D ? D.all().filter(function (x) { return x.status === 'new' && !x.supersededBy; }).length : 0, extraLabel: '確認待ちの投稿セット' },
      { key: 'meeting', name: '経営会議（旧方式）', title: '経営', duty: '毎日1回、事実を集めて会議の文章を作る（1回のAI呼び出しで複数の役。新方式に置き換え予定）', jobTypes: ['company'], items: meetingItems(), extraPending: proposals + review, extraLabel: '社長の判断待ちの提言・業務' },
      { key: 'perf', name: '実績の取り込み（コード）', title: '分析', duty: 'Instagramの数字を公式APIから取り込む（AIなし。鍵が未設定なら動かない）', items: perfItems() }
    ];
  }

  // 稼働状況（実際の記録から。常に働いているようには見せない）
  function stateOf(s) {
    var items = (s.items || []).slice().sort(function (a, b) { return (a.start || '') < (b.start || '') ? 1 : -1; });
    var last = items[0];
    var job = (s.jobTypes || []).map(function (t) { return liveJobs[t]; }).filter(Boolean)[0];
    var pending = items.reduce(function (a, x) { return a + (x.pending || 0); }, 0) + (s.extraPending || 0);
    if (items.some(function (x) { return x.state === 'running'; }) || job) return { key: 'working', label: '仕事中', pending: pending, job: job };
    if (last && last.state === 'unknown') return { key: 'unknown', label: '状態未確認', pending: pending };
    if (last && last.state === 'failed' && Date.now() - new Date(last.end || last.start).getTime() < DAY) return { key: 'error', label: 'エラー', pending: pending };
    if (pending) return { key: 'approval', label: '承認待ち ' + pending + '件', pending: pending };
    return { key: 'off', label: '今は仕事していません', pending: 0 };
  }
  // 今日の出勤・退勤（最初に仕事を始めた時刻・最後に仕事が終わった時刻）
  function attendance(s, st) {
    var t = today();
    var todays = (s.items || []).filter(function (x) { return x.start && jst(x.start) === t; });
    if (!todays.length && !(st && st.job)) return { in: '', out: '', items: [] };
    var starts = todays.map(function (x) { return x.start; }).concat(st && st.job ? [st.job.at] : []).sort();
    var working = st && st.key === 'working';
    var ends = todays.filter(function (x) { return x.end; }).map(function (x) { return x.end; }).sort();
    return { in: starts[0], out: working ? '' : ends[ends.length - 1] || '', items: todays };
  }

  var STATE_TEXT = { ok: '成功', failed: '失敗', running: '仕事中', unknown: '状態未確認' };
  function itemView(x) {
    var box = el('div', 'wk-item');
    box.appendChild(el('p', 'field-label', hm(x.start) + (x.end && x.end !== x.start ? '〜' + hm(x.end) : x.state === 'running' ? '〜（仕事中）' : '') + '｜' + (STATE_TEXT[x.state] || x.state) + '｜' + x.what));
    if (x.error) box.appendChild(el('p', 'hint pitch-warn', (x.state === 'unknown' ? '確認できない理由：' : '失敗の理由：') + x.error));
    if (x.calls == null) box.appendChild(el('p', 'hint', 'AIの呼び出し・トークン・費用：記録なし（旧方式は実測の記録がない）'));
    else box.appendChild(el('p', 'hint', 'AIの呼び出し ' + x.calls.length + '回（失敗 ' + x.calls.filter(function (r) { return !r.ok; }).length + '回）｜トークン ' + (x.tokens || 0).toLocaleString('ja-JP') + '｜費用（実測）' + yen(x.cost) + (x.rakuten ? '｜楽天の検索 ' + x.rakuten + '回（無料）' : '')));
    if (x.calls && x.calls.length) {
      var det = el('details');
      det.appendChild(el('summary', null, 'AIの呼び出しの記録'));
      x.calls.forEach(function (r) { det.appendChild(el('p', 'hint' + (r.ok ? '' : ' pitch-warn'), hm(r.at) + '｜' + (r.step || r.type || '') + '｜' + r.model + '｜' + (r.ok ? '成功' : '失敗：' + (r.error || '')) + '｜応答ID ' + (r.openaiId || 'なし') + '｜入力' + (r.promptTokens || 0) + '・出力' + (r.completionTokens || 0) + '｜' + yen(r.yen))); });
      box.appendChild(det);
    }
    if (x.deliverables.length) {
      box.appendChild(el('p', 'hint', '成果物：'));
      var ul = el('ul', 'co-facts');
      x.deliverables.slice(0, 8).forEach(function (d) { ul.appendChild(el('li', null, d)); });
      box.appendChild(ul);
    }
    if (x.open) box.appendChild(btn('成果物の画面を開く', 'status-btn', x.open));
    return box;
  }

  // 社員の個別の画面：出勤・退勤と、今日の業務日報（なければ最近の仕事）
  function detailView(s, st) {
    var box = el('div', 'wk-detail');
    box.appendChild(el('p', 'hint', s.title + '｜担当：' + s.duty));
    if (st.job) box.appendChild(el('p', 'hint', '仕事中：' + st.job.label + '（' + hm(st.job.at) + ' 開始・検索ジョブ）'));
    if (s.extraPending) box.appendChild(el('p', 'hint', s.extraLabel + '：' + s.extraPending + '件'));
    var at = attendance(s, st);
    var items = at.items;
    box.appendChild(el('p', 'field-label', '業務日報（今日 ' + today().slice(5).replace('-', '/') + '）'));
    if (!items.length) box.appendChild(el('p', 'hint', '今日はまだ仕事をしていません。'));
    else {
      box.appendChild(el('p', 'hint', '出勤 ' + hm(at.in) + '｜退勤 ' + (at.out ? hm(at.out) : st.key === 'working' ? '（仕事中・まだ退勤していません）' : '（確認できない）') + '｜仕事 ' + items.length + '件（成功 ' + items.filter(function (x) { return x.state === 'ok'; }).length + '・失敗 ' + items.filter(function (x) { return x.state === 'failed'; }).length + '・状態未確認 ' + items.filter(function (x) { return x.state === 'unknown'; }).length + '）｜AIの呼び出し ' + items.reduce(function (a, x) { return a + (x.calls ? x.calls.length : 0); }, 0) + '回｜トークン ' + items.reduce(function (a, x) { return a + (x.tokens || 0); }, 0).toLocaleString('ja-JP') + '｜費用（実測）' + yen(items.reduce(function (a, x) { return a + (x.cost || 0); }, 0))));
      items.forEach(function (x) { box.appendChild(itemView(x)); });
    }
    var older = (s.items || []).filter(function (x) { return items.indexOf(x) === -1; }).slice(0, 5);
    if (older.length) {
      var det = el('details');
      det.appendChild(el('summary', null, 'これまでの仕事（最近 ' + older.length + '件）'));
      older.forEach(function (x) { var v = itemView(x); v.firstChild.textContent = stamp(x.start) + v.firstChild.textContent.slice(hm(x.start).length); det.appendChild(v); });
      box.appendChild(det);
    }
    return box;
  }

  function panel(rp) {
    repaint = rp || repaint;
    refreshJobs();
    var wrap = el('div', 'card wk-panel');
    wrap.id = 'staff-attendance';
    var head = el('div', 'wk-head');
    head.appendChild(el('h3', 'cand-name', '社員の出勤状況・業務日報'));
    if (window.Backup) head.appendChild(btn('データのバックアップを保存', 'btn btn-secondary wk-backup', function () { window.Backup.save().then(function (r) { K.showToast(r === 'shared' ? 'バックアップを保存しました' : 'バックアップのファイルを書き出しました'); }, function () { K.showToast('保存できませんでした'); }); }));
    wrap.appendChild(head);
    wrap.appendChild(el('p', 'hint', '実際に動いた記録（AIの呼び出し・処理・成果物）だけを表示します。動いていない社員は「今は仕事していません」です。途中で通信が切れた等で完了を確かめられない仕事は「状態未確認」とし、成功にはしません。社員を押すと、業務日報と成果物を見られます。'));
    var all = staff();
    var counts = { working: 0, approval: 0, error: 0, unknown: 0, off: 0 };
    var rows = all.map(function (s) { var st = stateOf(s); counts[st.key]++; return { s: s, st: st }; });
    wrap.appendChild(el('p', 'hint wk-summary', '仕事中 ' + counts.working + '人｜承認待ち ' + counts.approval + '人｜エラー ' + counts.error + '人' + (counts.unknown ? '｜状態未確認 ' + counts.unknown + '人' : '') + '｜今は仕事していません ' + counts.off + '人'));
    rows.forEach(function (x) {
      var s = x.s, st = x.st;
      var row = el('div', 'wk-row wk-' + st.key);
      var top = btn('', 'wk-toggle', function () { open[s.key] = !open[s.key]; repaint(); });
      top.appendChild(el('span', 'wk-name', s.name));
      top.appendChild(el('span', 'wk-title', s.title));
      top.appendChild(el('span', 'wk-state wk-state-' + st.key, st.label));
      var items = (s.items || []).slice().sort(function (a, b) { return (a.start || '') < (b.start || '') ? 1 : -1; });
      var last = items[0];
      var at = attendance(s, st);
      top.appendChild(el('span', 'wk-last', (at.in ? '今日 出勤 ' + hm(at.in) + (at.out ? '・退勤 ' + hm(at.out) : st.key === 'working' ? '・退勤前（仕事中）' : '・退勤は確認できない') + '｜' : '今日は未出勤｜') + (last ? '最後の仕事：' + stamp(last.end || last.start) + '・' + last.what.slice(0, 20) : 'まだ一度も仕事をしていません')));
      row.appendChild(top);
      if (open[s.key]) row.appendChild(detailView(s, st));
      wrap.appendChild(row);
    });
    return wrap;
  }

  window.WorkView = { panel: panel, staff: staff, stateOf: stateOf, attendance: attendance };
})();
