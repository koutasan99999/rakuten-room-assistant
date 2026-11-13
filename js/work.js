// 第1段階（2026-11-14）：AI社員の仕事の見える化（経営報告のいちばん上）。
// 表示するのは、実際に動いた記録だけ（AIを呼んだ記録・コードが処理した記録・保存された成果物）。会議の文章に「しました」と書いてあっても、記録がなければ完了にしない。
// 状態：実行中／失敗／承認待ち（社長の判断が必要な成果物がある）／完了（24時間以内に動いて成功）／待機中（24時間以内に動いていない・一度も動いていない）
(function () {
  'use strict';

  var K = window.AppKit;
  var open = {};   // 社員のキー → 詳細を開いている
  var repaint = function () {};
  var DAY = 86400000;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function stamp(iso) { try { var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; } }
  function yen(n) { return (Math.round((Number(n) || 0) * 100) / 100) + '円'; }
  function sum(runs) { return (runs || []).reduce(function (a, r) { return a + (Number(r.yen) || 0); }, 0); }
  function go(hash, after) { location.hash = hash; setTimeout(function () { if (after) after(); window.scrollTo(0, 0); }, 300); }
  function log() { return window.AiUsage && window.AiUsage.log ? window.AiUsage.log() : []; }

  // ---- 社員ごとの仕事（実際の記録から作る） ----
  // item：{ at, what, ok:true/false/null(実行中), cost, calls:[{model, openaiId, ok, yen}], deliverables:[文字], pending:数, open:()=>{} }
  function buyerItems() {
    var A = window.AgentsStore;
    if (!A) return [];
    return A.sessions().slice(0, 10).map(function (x) {
      var runs = (x.runs || []).filter(function (r) { return r.role === 'buyer'; });
      var pass = (x.candidates || []).filter(function (c) { return c.status === 'pass'; });
      return {
        at: x.at, what: '商品の候補を探す（テーマ：' + x.theme + '）', ok: x.status === 'running' ? null : x.status !== 'failed', error: x.status === 'failed' ? x.failedStep + '：' + x.error : '',
        cost: sum(runs), calls: runs, rakuten: x.rakutenCalls || 0,
        deliverables: (x.candidates || []).map(function (c) { var v = c.versions[c.versions.length - 1]; return v.data.name.slice(0, 30) + '（' + v.data.price + '円）：' + ({ pass: '合格', hold: '保留', reject: '不合格', revise: '修正中' }[c.status] || c.status) + (v.audit ? '・' + v.audit.total + '点' : '') + (c.owner ? '・社長が' + (c.owner.decision === 'adopt' ? '採用' : '見送り') : ''); }),
        pending: x.status === 'done' ? pass.filter(function (c) { return !c.owner; }).length : 0,
        open: function () { go('#company'); }
      };
    });
  }
  function auditorItems() {
    var out = [];
    var A = window.AgentsStore;
    if (A) A.sessions().slice(0, 10).forEach(function (x) {
      var runs = (x.runs || []).filter(function (r) { return r.role === 'auditor'; });
      if (!runs.length) return;
      out.push({ at: runs[0].at || x.at, what: 'バイヤーAIの候補を採点（' + (x.candidates || []).length + '件）', ok: runs.every(function (r) { return r.ok; }) ? true : runs.some(function (r) { return r.ok; }) ? true : false, cost: sum(runs), calls: runs,
        deliverables: (x.candidates || []).map(function (c) { var v = c.versions[c.versions.length - 1]; return v.data.name.slice(0, 24) + '：' + (v.audit ? v.audit.total + '点・' + ({ pass: '合格', revise: '修正', hold: '保留', reject: '却下' }[v.audit.proposal] || '') : '採点なし'); }), pending: 0, open: function () { go('#company'); } });
    });
    var R = window.PrStore;
    if (R) R.runs().slice(0, 10).forEach(function (r) {
      var runs = (r.runs || []).filter(function (x) { return x.role === 'auditor'; });
      if (!runs.length) return;
      out.push({ at: r.at, what: '営業・交流担当AIのコメント案を採点（' + (r.posts || []).length + '件）', ok: runs.some(function (x) { return x.ok; }), cost: sum(runs), calls: runs, deliverables: Object.keys(r.result || {}).map(function (k) { return k + '：' + ({ pass: '合格', hold: '保留', reject: '不合格', failed: '失敗' }[r.result[k]] || r.result[k]); }), pending: 0, open: function () { go('#pr'); } });
    });
    return out.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }
  function outreachItems() {
    var R = window.PrStore;
    if (!R) return [];
    var posts = R.posts();
    return R.runs().slice(0, 10).map(function (r) {
      var runs = (r.runs || []).filter(function (x) { return x.role === 'outreach'; });
      var mine = posts.filter(function (p) { return (r.posts || []).indexOf(p.id) !== -1; });
      return {
        at: r.at, what: '他の人の投稿へのコメント案（' + mine.length + '件）', ok: r.status === 'running' ? null : r.status !== 'failed', error: r.status === 'failed' ? r.failedStep + '：' + r.error : '',
        cost: sum(runs), calls: runs,
        deliverables: mine.map(function (p) { var o = p.outreach || {}; return '@' + (p.handle || '不明') + '：' + ({ pass: '合格「' + (o.final || '') + '」', hold: '保留', reject: '不合格', failed: '失敗', running: '作業中' }[o.status] || '未') + (p.status === 'commented' ? '・社長がコメント済み' : p.status === 'skipped' ? '・見送り' : ''); }),
        pending: mine.filter(function (p) { return p.status === 'todo' && p.outreach && p.outreach.status === 'pass'; }).length,
        open: function () { go('#pr'); }
      };
    });
  }
  function aiLogItems(types, label, openFn) {
    var groups = {};
    log().filter(function (r) { return types.some(function (t) { return r.type.indexOf(t) === 0; }); }).forEach(function (r) {
      var k = r.at.slice(0, 16) + r.type;
      (groups[k] = groups[k] || { at: r.at, type: r.type, runs: [] }).runs.push(r);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 10).map(function (g) {
      return { at: g.at, what: label(g.type), ok: g.runs.some(function (r) { return r.ok; }), error: g.runs.every(function (r) { return !r.ok; }) ? (g.runs[0].error || '失敗') : '', cost: sum(g.runs), calls: g.runs, deliverables: [], pending: 0, open: openFn };
    });
  }
  function meetingItems() {
    var C = window.CompanyStore;
    if (!C) return [];
    return C.meetings().slice(0, 10).map(function (m) {
      return { at: m.at, what: '毎日の経営会議（旧方式：1回のAI呼び出しで複数の役を書き分ける）', ok: m.status === 'ok' ? true : m.status === 'partial' ? false : false, error: m.status !== 'ok' ? (m.error || (m.status === 'partial' ? 'AIの会議は失敗（工程の確認と割り当てだけ）' : '失敗')) : '',
        cost: null, calls: [], deliverables: [m.summary || ''].filter(Boolean), pending: 0, open: function () { go('#company'); } };
    });
  }
  function perfItems() {
    var P = window.PerfStore;
    if (!P) return [];
    var out = [];
    P.accountLog().slice(-5).reverse().forEach(function (a) { out.push({ at: a.at, what: 'Instagramの数字を公式APIから取り込み（コード・AIなし）', ok: !a.error, error: a.error || '', cost: 0, calls: [], deliverables: ['フォロワー ' + (a.followers == null ? '未取得' : a.followers)], pending: 0, open: function () { go('#pr'); } }); });
    return out;
  }

  // 社員の一覧（担当業務と、仕事の記録の出どころ）
  function staff() {
    var C = window.CompanyStore;
    var P = window.PitchStore;
    var D = window.DeliveryStore;
    var proposals = C ? C.proposals().filter(function (p) { return p.status === 'open'; }).length : 0;
    var review = C ? C.tasks(true).filter(function (t) { return t.status === 'review'; }).length : 0;
    return [
      { key: 'outreach', name: '営業・交流担当AI', duty: '他の人の投稿（文章を確認できたもの）へのコメント案とフォロー候補の評価。送信は社長', items: outreachItems() },
      { key: 'buyer', name: 'バイヤーAI（試験）', duty: '楽天の実際の検索結果から、紹介する商品の候補を最大3件', items: buyerItems() },
      { key: 'auditor', name: '監査AI', duty: 'バイヤーAI・営業・交流担当AIの成果物を、別のAI呼び出しで採点・修正指示', items: auditorItems() },
      { key: 'pitch', name: '商品の提案（プレゼン）', duty: '「次の商品を探してもらう」で、楽天の商品を探してプレゼンを書く', items: aiLogItems(['pitch:scout', 'pitch:more', 'pitch:seed', 'pitch:expand', 'explore'], function (t) { return /expand|explore/.test(t) ? '「広げる」で関連商品を探す' : '商品を探してプレゼンを書く'; }, function () { go('#pitch'); }), extraPending: P ? P.queue().length : 0, extraLabel: '社長の判断待ちのプレゼン' },
      { key: 'set', name: '投稿セットの制作', duty: '採用した商品で、Instagramの1投稿分（企画・画像の文字・キャプション）を作る', items: aiLogItems(['pitch:set', 'pitch:roomtext', 'pitch:tags'], function (t) { return /roomtext|tags/.test(t) ? 'ROOM紹介文・ハッシュタグを作る' : '投稿セットを作る'; }, function () { go('#pitch', function () { if (window.PitchView && window.PitchView.show) window.PitchView.show('sets'); }); }), extraPending: D ? D.all().filter(function (x) { return x.status === 'new' && !x.supersededBy; }).length : 0, extraLabel: '確認待ちの投稿セット' },
      { key: 'meeting', name: '経営会議（旧方式）', duty: '毎日1回、事実を集めて会議の文章を作る（1回のAI呼び出しで複数の役。新方式に置き換え予定）', items: meetingItems(), extraPending: proposals + review, extraLabel: '社長の判断待ちの提言・業務' },
      { key: 'perf', name: '実績の取り込み（コード）', duty: 'Instagramの数字を公式APIから取り込む（AIなし。鍵が未設定なら動かない）', items: perfItems() }
    ];
  }

  function stateOf(s) {
    var last = s.items[0];
    var pending = s.items.reduce(function (a, x) { return a + (x.pending || 0); }, 0) + (s.extraPending || 0);
    if (last && last.ok === null) return { key: 'running', label: '実行中', pending: pending };
    if (last && last.ok === false && Date.now() - new Date(last.at).getTime() < DAY) return { key: 'failed', label: '失敗', pending: pending };
    if (pending) return { key: 'approval', label: '承認待ち ' + pending + '件', pending: pending };
    if (last && last.ok && Date.now() - new Date(last.at).getTime() < DAY) return { key: 'done', label: '完了', pending: 0 };
    return { key: 'idle', label: '待機中', pending: 0 };
  }

  function itemView(x) {
    var box = el('div', 'wk-item');
    box.appendChild(el('p', 'field-label', stamp(x.at) + '｜' + (x.ok === null ? '実行中' : x.ok ? '成功' : '失敗') + '｜' + x.what));
    if (x.error) box.appendChild(el('p', 'hint pitch-warn', '失敗の理由：' + x.error));
    var cost = x.cost == null ? '費用：記録なし（旧方式は実測の記録がない）' : '費用（実測）：' + yen(x.cost) + '（AI ' + x.calls.length + '回' + (x.rakuten ? '・楽天の検索 ' + x.rakuten + '回は無料' : '') + '）';
    box.appendChild(el('p', 'hint', cost));
    if (x.calls.length) box.appendChild(el('p', 'hint', 'AIの呼び出し：' + x.calls.map(function (r) { return (r.step || r.type || '') + '・' + r.model + '・' + (r.ok ? '成功' : '失敗') + '・応答ID ' + (r.openaiId || 'なし'); }).join('／')));
    if (x.deliverables.length) {
      var ul = el('ul', 'co-facts');
      x.deliverables.slice(0, 6).forEach(function (d) { ul.appendChild(el('li', null, d)); });
      box.appendChild(el('p', 'hint', '成果物：'));
      box.appendChild(ul);
    }
    if (x.open) box.appendChild(btn('成果物の画面を開く', 'status-btn', x.open));
    return box;
  }

  function panel(rp) {
    repaint = rp || repaint;
    var wrap = el('div', 'card wk-panel');
    var head = el('div', 'wk-head');
    head.appendChild(el('h3', 'cand-name', 'AI社員の仕事'));
    if (window.Backup) head.appendChild(btn('データのバックアップを保存', 'btn btn-secondary wk-backup', function () { window.Backup.save().then(function (r) { K.showToast(r === 'shared' ? 'バックアップを保存しました' : 'バックアップのファイルを書き出しました'); }, function () { K.showToast('保存できませんでした'); }); }));
    wrap.appendChild(head);
    wrap.appendChild(el('p', 'hint', '実際に動いた記録（AIの呼び出し・処理・成果物）だけを表示します。記録のない仕事は「完了」にしません。24時間動いていない社員は「待機中」です。社員を押すと、仕事の中身と成果物を見られます。'));
    staff().forEach(function (s) {
      var st = stateOf(s);
      var row = el('div', 'wk-row wk-' + st.key);
      var top = btn('', 'wk-toggle', function () { open[s.key] = !open[s.key]; repaint(); });
      top.appendChild(el('span', 'wk-name', s.name));
      top.appendChild(el('span', 'wk-state wk-state-' + st.key, st.label));
      var last = s.items[0];
      top.appendChild(el('span', 'wk-last', last ? '最後の仕事：' + stamp(last.at) + '・' + last.what.slice(0, 22) : 'まだ一度も動いていません'));
      row.appendChild(top);
      if (open[s.key]) {
        row.appendChild(el('p', 'hint', '担当：' + s.duty));
        if (s.extraPending) row.appendChild(el('p', 'hint', s.extraLabel + '：' + s.extraPending + '件'));
        if (!s.items.length) row.appendChild(el('p', 'hint', '仕事の記録はまだありません（待機中）。'));
        s.items.slice(0, 5).forEach(function (x) { row.appendChild(itemView(x)); });
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  window.WorkView = { panel: panel, staff: staff, stateOf: stateOf };
})();
