// AI社員（段階1・試験）の画面：バイヤーAI×監査AI（経営報告の中に表示）。
// 社長がボタンを押したときだけ動く（1日5回まで）。1段階ずつサーバーを呼ぶ（検索ジョブは使わない＝既存の検索・投稿の処理を待たせない）。
// 流れ：バイヤーAI（検索語→楽天の検索→最大3件）→ コードの確認 → 監査AI（採点・修正指示）→ 80点未満などは修正（最大2回）→ 再確認・再採点
// 合格した候補だけを、社長の承認候補にする。承認ボタンを押すまで、採用の記録は付けない（外部への投稿もしない）。
(function () {
  'use strict';

  var K = window.AppKit;
  var A = window.AgentsStore;
  var MAX_REV = 2;
  var WORST_CALLS = 2 + 1 + MAX_REV * 2; // バイヤー2回＋監査1回＋（修正1回＋再採点1回）×2
  var SESSION_CAP_YEN = 10;              // 1回の実行で使ってよい費用（実測）。超えたら止める
  var STATUS = { pass: '合格（社長の承認候補）', revise: '修正が必要', hold: '保留', reject: '不合格・却下の提案', failed: '失敗' };
  var running = null;  // 実行中の session.id
  var progress = '';
  var openSession = '';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function stamp(iso) { try { var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; } }
  function yen(n) { return (Math.round((Number(n) || 0) * 100) / 100) + '円'; }
  var paintFn = function () {};

  function costOf(x) {
    var runs = x.runs || [];
    return { calls: runs.length, ok: runs.filter(function (r) { return r.ok; }).length, failed: runs.filter(function (r) { return !r.ok; }).length, yen: runs.reduce(function (a, r) { return a + (Number(r.yen) || 0); }, 0) };
  }
  function step(x, name) { var s = { name: name, status: 'running', startedAt: new Date().toISOString() }; x.steps.push(s); progress = name; A.save(x); paintFn(); return s; }
  function endStep(x, s, ok, note) { s.status = ok ? 'ok' : 'failed'; s.endedAt = new Date().toISOString(); if (note) s.note = note; A.save(x); paintFn(); }
  function fail(x, s, why) { endStep(x, s, false, why); x.status = 'failed'; x.failedStep = s.name; x.error = why; running = null; progress = ''; A.save(x); paintFn(); }
  function addRuns(x, data) { if (data && Array.isArray(data.runs)) x.runs = x.runs.concat(data.runs.map(function (r) { return Object.assign({ at: new Date().toISOString() }, r); })); }
  function call(x, s, body) {
    return K.postJson('api/agents', body).then(function (r) {
      addRuns(x, r.data);
      if (r.status !== 200 || !r.data || r.data.ok !== true) {
        var why = (r.data && (r.data.failedStep ? r.data.failedStep + '：' : '') + (r.data.error || '')) || ('通信できませんでした（' + (r.status || '通信エラー') + '）');
        fail(x, s, why);
        return null;
      }
      if (costOf(x).yen > SESSION_CAP_YEN) { fail(x, s, '1回の実行の費用の上限（' + SESSION_CAP_YEN + '円）を超えたため止めました'); return null; }
      return r.data;
    }, function () { fail(x, s, '通信できませんでした'); return null; });
  }
  function current(c) { return c.versions[c.versions.length - 1]; }
  function liveCands(x, filter) { return x.candidates.filter(function (c) { return !filter || filter(c); }).map(function (c) { return current(c).data; }); }
  function checksFor(x, ids) { return x.candidates.filter(function (c) { return ids.indexOf(c.id) !== -1; }).map(function (c) { var v = current(c); return { id: c.id, checks: v.check ? v.check.checks : [] }; }); }

  function avoidNames() {
    var P = window.PitchStore;
    return P ? P.list('adopt').slice(0, 20).map(function (p) { return p.name; }) : [];
  }

  // ---- 実行 ----
  function run(theme, model) {
    if (running) { K.showToast('いま実行中です'); return; }
    if (A.usedToday() >= A.DAILY_LIMIT) { K.showToast('今日は' + A.DAILY_LIMIT + '回まで実行しました（明日また使えます）'); return; }
    var stop = window.AiUsage && window.AiUsage.blocked(WORST_CALLS);
    if (stop) { K.showToast(stop); return; }
    var x = A.start(theme, model);
    running = x.id; openSession = x.id;
    // 1. バイヤーAI
    var s1 = step(x, 'バイヤーAI：検索語を決めて楽天で検索し、候補を選ぶ（AI 2回・楽天の検索）');
    call(x, s1, { action: 'buyer', theme: theme, avoid: avoidNames() }).then(function (d) {
      if (!d) return;
      x.searched = d.searched || []; x.results = d.results || []; x.notes = d.notes || ''; x.plan = d.plan || [];
      x.rakutenCalls += (d.searched || []).length;
      x.candidates = (d.candidates || []).map(function (c) { return { id: c.id, status: 'running', versions: [{ v: 1, data: c, at: new Date().toISOString() }], revisions: 0 }; });
      endStep(x, s1, true, (d.candidates || []).length + '件');
      if (!x.candidates.length) { x.status = 'done'; x.note = '候補が0件でした（数合わせはしていません）' + (x.notes ? '：' + x.notes : ''); running = null; progress = ''; A.save(x); paintFn(); return; }
      return checkAndAudit(x, x.candidates.map(function (c) { return c.id; }), 0);
    });
  }
  // コードの確認 → 監査AI → 判定。修正が必要なら、修正 → もう一度
  function checkAndAudit(x, ids, round) {
    var s2 = step(x, (round ? '再確認' : 'コードの確認') + '：楽天で商品番号を引き直し・引用の照合・禁止表現（AIなし）');
    return call(x, s2, { action: 'check', candidates: liveCands(x, function (c) { return ids.indexOf(c.id) !== -1; }), results: x.results }).then(function (d) {
      if (!d) return;
      x.rakutenCalls += d.rakutenCalls || 0;
      (d.checks || []).forEach(function (k) { var c = x.candidates.filter(function (y) { return y.id === k.id; })[0]; if (c) current(c).check = k; });
      endStep(x, s2, true);
      var s3 = step(x, (round ? '再採点' : '採点') + '：監査AI（別のAI呼び出し' + (x.auditModel ? '・' + x.auditModel : '') + '）');
      var rev = {}; x.candidates.forEach(function (c) { rev[c.id] = c.revisions; });
      return call(x, s3, { action: 'audit', model: x.auditModel, candidates: liveCands(x, function (c) { return ids.indexOf(c.id) !== -1; }), results: x.results, checks: checksFor(x, ids), revisions: rev }).then(function (a) {
        if (!a) return;
        (a.audits || []).forEach(function (au) { var c = x.candidates.filter(function (y) { return y.id === au.id; })[0]; if (c) current(c).audit = Object.assign({ model: (a.runs || []).filter(function (r) { return r.ok; }).map(function (r) { return r.model; })[0] || '' }, au); });
        (a.decisions || []).forEach(function (dc) { var c = x.candidates.filter(function (y) { return y.id === dc.id; })[0]; if (c) { current(c).decision = dc; c.status = dc.status; c.why = dc.why; } });
        endStep(x, s3, true);
        var need = x.candidates.filter(function (c) { return ids.indexOf(c.id) !== -1 && c.status === 'revise' && c.revisions < MAX_REV; });
        if (!need.length) return finish(x);
        return revise(x, need, round + 1);
      });
    });
  }
  function revise(x, need, round) {
    var s4 = step(x, '修正 ' + round + '回目：バイヤーAI（監査AIの指示に従って直す）');
    var targets = need.map(function (c) {
      var v = current(c);
      return { candidate: v.data, why: c.why || '', fixes: v.audit ? v.audit.fixes : [], needResearch: v.audit ? v.audit.needResearch : '',
        codeNg: v.check ? v.check.checks.filter(function (k) { return k.ok === false; }).map(function (k) { return k.label + '：' + k.detail; }) : [] };
    });
    return call(x, s4, { action: 'revise', targets: targets, results: x.results }).then(function (d) {
      if (!d) return;
      var again = [];
      (d.revisions || []).forEach(function (rv) {
        var c = x.candidates.filter(function (y) { return y.id === rv.id; })[0];
        if (!c) return;
        c.revisions += 1;
        if (!rv.candidate) { c.status = 'hold'; c.why = '追加調査が必要（推測で補わない）：' + (rv.needResearch || ''); current(c).needResearch = rv.needResearch; return; }
        c.versions.push({ v: c.versions.length + 1, data: rv.candidate, replaced: !!rv.replaced, at: new Date().toISOString() });
        again.push(c.id);
      });
      endStep(x, s4, true, again.length + '件を修正');
      if (!again.length) return finish(x);
      return checkAndAudit(x, again, round);
    });
  }
  function finish(x) {
    x.candidates.forEach(function (c) { if (c.status === 'revise' || c.status === 'running') { c.status = 'hold'; c.why = (c.why ? c.why + '。' : '') + '修正' + MAX_REV + '回でも合格にならなかった（無理に合格にしない）'; } });
    x.status = 'done'; running = null; progress = '';
    A.save(x); paintFn();
  }

  // 社長の承認（合格した候補だけ）。採用の記録（PitchStore）を付けるのは、このボタンを押したときだけ
  function approve(x, c, yes) {
    var d = current(c).data;
    if (yes) {
      var P = window.PitchStore;
      var r = P && P.adoptFrom ? P.adoptFrom({ code: d.code, name: d.name, price: d.price, url: d.url, image: d.image, shop: d.shop }, 'AI社員（バイヤー×監査）の候補を承認：' + d.reason, { origin: 'agents', relation: d.reason }) : null;
      if (!r) { K.showToast('採用の記録を付けられませんでした'); return; }
      c.owner = { decision: 'adopt', at: new Date().toISOString() };
      K.showToast(r.already ? 'すでに採用済みの商品です' : '採用しました（「採用済み」に入りました）');
    } else {
      c.owner = { decision: 'skip', at: new Date().toISOString() };
      K.showToast('見送りました');
    }
    A.save(x); paintFn();
  }

  // ---- 書き出し ----
  function exportJson() {
    var data = JSON.stringify(A.exportAll(), null, 1);
    return data;
  }
  function download() {
    try {
      var blob = new Blob([exportJson()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ai-shain-log-' + A.today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { K.showToast('保存できませんでした。「コピー」をお使いください'); }
  }

  // ---- 表示 ----
  function scoreBlock(v) {
    var box = el('div', 'ag-audit');
    var au = v.audit;
    if (!au) { box.appendChild(el('p', 'hint', '監査AIの採点：まだ')); return box; }
    box.appendChild(el('p', 'field-label', '監査AIの採点：' + au.total + '点／100点' + (au.model ? '（' + au.model + '）' : '') + '｜監査AIの提案：' + ({ pass: '合格', revise: '修正', hold: '保留', reject: '却下' }[au.proposal] || au.proposal)));
    Object.keys(au.scores || {}).forEach(function (k) {
      var s = au.scores[k];
      box.appendChild(el('p', 'hint', s.label + '：' + s.score + '/' + s.max + (s.deductions ? '｜減点理由：' + s.deductions : '') + (s.evidence && s.evidence.length ? '｜根拠：' + s.evidence.join('・') : '')));
    });
    var fl = au.flags || {};
    var fls = [fl.fabrication && '根拠の捏造の疑い', fl.unverified && '未確認の断定', fl.policy && '規約・表現の疑い'].filter(Boolean);
    if (fls.length) box.appendChild(el('p', 'hint pitch-warn', '点数に関係なく不合格になる指摘：' + fls.join('、') + (fl.why ? '（' + fl.why + '）' : '')));
    if ((au.fixes || []).length) box.appendChild(el('p', 'hint', '修正指示：' + au.fixes.join('／')));
    if (au.needResearch) box.appendChild(el('p', 'hint', '追加調査が必要：' + au.needResearch));
    if (au.summary) box.appendChild(el('p', 'hint', 'まとめ：' + au.summary));
    box.appendChild(el('p', 'hint', '※AIの採点です。品質の保証ではありません（客観的な確認は上の「コードの確認」）'));
    return box;
  }
  function checkBlock(v) {
    var box = el('div', 'ag-check');
    if (!v.check) { box.appendChild(el('p', 'hint', 'コードの確認：まだ')); return box; }
    box.appendChild(el('p', 'field-label', 'コードの確認（客観的な事実・AIなし）' + (v.check.hardFail ? '：NGあり' : v.check.unknown ? '：未確認あり' : '：すべてOK')));
    v.check.checks.forEach(function (k) { box.appendChild(el('p', 'hint' + (k.ok === false ? ' pitch-warn' : ''), (k.ok === true ? 'OK ' : k.ok === false ? 'NG ' : '未確認 ') + k.label + '：' + k.detail)); });
    return box;
  }
  function versionBlock(v, label) {
    var d = v.data;
    var box = el('div', 'ag-version');
    box.appendChild(el('p', 'field-label', label + (v.replaced ? '（別の商品に替えた）' : '')));
    box.appendChild(el('p', 'thief-cand-name', d.name));
    box.appendChild(el('p', 'cand-meta', d.price.toLocaleString('ja-JP') + '円｜' + d.shop + '｜確認：' + stamp(d.checkedAt) + '｜情報源：' + d.source));
    var a = el('a', 'hint', d.url); a.href = d.url; a.target = '_blank'; a.rel = 'noopener'; box.appendChild(a);
    box.appendChild(el('p', 'hint', '根拠の引用：「' + (d.quotes || []).join('」「') + '」'));
    box.appendChild(el('p', 'hint', '推薦理由：' + d.reason));
    box.appendChild(el('p', 'hint', '誰に：' + d.target + '｜解決する不便：' + d.problem + '｜ROOMの価値：' + d.roomValue + '｜注意：' + d.cautions));
    box.appendChild(checkBlock(v));
    box.appendChild(scoreBlock(v));
    if (v.decision) box.appendChild(el('p', 'hint', '判定（コード）：' + (STATUS[v.decision.status] || v.decision.status) + '｜' + v.decision.why));
    return box;
  }
  function candidateCard(x, c) {
    var card = el('div', 'card ag-cand');
    var last = current(c);
    card.appendChild(el('p', 'field-label', c.id + '｜' + (STATUS[c.status] || c.status) + (c.revisions ? '｜修正' + c.revisions + '回' : '')));
    if (c.why) card.appendChild(el('p', 'hint' + (c.status === 'pass' ? '' : ' pitch-warn'), c.why));
    if (c.versions.length > 1) {
      card.appendChild(el('p', 'hint', '修正前後：' + c.versions.map(function (v) { return 'v' + v.v + ' ' + (v.audit ? v.audit.total + '点' : '採点なし') + (v.check ? (v.check.hardFail ? '・コードNG' : '・コードOK') : ''); }).join(' → ')));
      var det = el('details');
      det.appendChild(el('summary', null, '修正前の版を見る（' + (c.versions.length - 1) + '件）'));
      c.versions.slice(0, -1).forEach(function (v) { det.appendChild(versionBlock(v, '修正前 v' + v.v)); });
      card.appendChild(det);
    }
    card.appendChild(versionBlock(last, c.versions.length > 1 ? '修正後 v' + last.v : '提出物 v1'));
    if (c.owner) card.appendChild(el('p', 'hint', '社長の判断：' + (c.owner.decision === 'adopt' ? '採用（' : '見送り（') + stamp(c.owner.at) + '）'));
    else if (c.status === 'pass' && x.status === 'done') {
      var row = el('div', 'pitch-row');
      row.appendChild(btn('採用する（社長の承認）', 'btn btn-primary co-sbtn', function () { approve(x, c, true); }));
      row.appendChild(btn('見送る', 'status-btn', function () { approve(x, c, false); }));
      card.appendChild(row);
    } else if (x.status === 'done') card.appendChild(el('p', 'hint', '合格していないため、承認候補にしていません。'));
    return card;
  }
  function runsBlock(x) {
    var det = el('details');
    var co = costOf(x);
    det.appendChild(el('summary', null, 'AIの呼び出しの記録（' + co.calls + '回・実測 ' + yen(co.yen) + (co.failed ? '・失敗' + co.failed + '回' : '') + '｜楽天の検索 ' + x.rakutenCalls + '回・無料）'));
    (x.runs || []).forEach(function (r) {
      det.appendChild(el('p', 'hint' + (r.ok ? '' : ' pitch-warn'), (r.roleName || r.role || '') + '・' + (r.step || '') + '｜' + (r.ok ? '成功' : '失敗：' + r.error) + '｜' + r.model + '｜応答ID ' + (r.openaiId || 'なし') + '｜入力' + r.promptTokens + '・出力' + r.completionTokens + 'トークン｜' + yen(r.yen) + (r.priceKnown === false ? '（単価未確認のため高めに計算）' : '') + '｜' + (r.ms / 1000).toFixed(1) + '秒｜指示の識別 ' + (r.promptHash || '')));
    });
    det.appendChild(el('p', 'hint', '応答IDはOpenAIが呼び出しごとに付ける番号です。社員ごと・段階ごとに別の番号＝別々のAI呼び出しです。'));
    return det;
  }
  function sessionView(x) {
    var wrap = el('div', 'ag-session');
    var co = costOf(x);
    var head = el('div', 'card');
    head.appendChild(el('p', 'field-label', stamp(x.at) + '｜テーマ：' + x.theme + '｜' + ({ running: '実行中', done: '完了', failed: '失敗' }[x.status] || x.status)));
    if (x.status === 'failed') head.appendChild(el('p', 'hint pitch-warn', '失敗した段階：' + x.failedStep + '｜理由：' + x.error));
    if (x.note) head.appendChild(el('p', 'hint', x.note));
    head.appendChild(el('p', 'hint', '費用（実測）：' + yen(co.yen) + '（AI ' + co.calls + '回' + (co.failed ? '・うち失敗' + co.failed + '回' : '') + '）｜楽天の検索 ' + x.rakutenCalls + '回（無料）｜画像の生成・有料の検索：なし'));
    var steps = el('div');
    x.steps.forEach(function (s) { steps.appendChild(el('p', 'hint' + (s.status === 'failed' ? ' pitch-warn' : ''), (s.status === 'ok' ? '済 ' : s.status === 'failed' ? '失敗 ' : '実行中 ') + s.name + (s.note ? '（' + s.note + '）' : ''))); });
    head.appendChild(steps);
    if ((x.searched || []).length) head.appendChild(el('p', 'hint', '楽天で探した言葉：' + x.searched.map(function (s) { return s.keyword + '（' + s.found + '件' + (s.error ? '・エラー：' + s.error : '') + '）'; }).join('、')));
    head.appendChild(runsBlock(x));
    wrap.appendChild(head);
    x.candidates.forEach(function (c) { wrap.appendChild(candidateCard(x, c)); });
    return wrap;
  }

  function panel(repaint) {
    paintFn = repaint || paintFn;
    var box = el('div', 'card ag-panel');
    box.appendChild(el('h3', 'cand-name', 'AI社員（試験）：バイヤーAI×監査AI'));
    box.appendChild(el('p', 'hint', 'バイヤーAIが楽天の実際の検索結果から候補を最大3件出し、別のAI呼び出しの監査AIが100点満点で採点します。80点以上で監査AIも合格と判断し、コードの確認（掲載・価格・引用）もすべてOKの候補だけを、社長の承認候補にします。届かない候補は2回まで修正し、それでもだめなら保留にします。AIの採点は品質の保証ではありません。'));
    var used = A.usedToday();
    var input = el('input', 'input');
    input.placeholder = 'テーマ（例：フライパンまわりの便利グッズ）';
    try { input.value = localStorage.getItem('room-agents-theme') || ''; } catch (e) {}
    box.appendChild(input);
    var sel = el('select', 'input');
    [['', '監査AIのモデル：既定'], ['gpt-5.4-nano', 'gpt-5.4-nano'], ['gpt-5-nano', 'gpt-5-nano'], ['gpt-4o-mini', 'gpt-4o-mini']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; sel.appendChild(op); });
    try { sel.value = localStorage.getItem('room-agents-model') || ''; } catch (e) {}
    box.appendChild(sel);
    var go = btn(running ? '実行中：' + progress : '実行する（今日 ' + used + '/' + A.DAILY_LIMIT + '回）', 'btn btn-discover', function () {
      var t = input.value.trim();
      if (!t) { K.showToast('テーマを入れてください'); return; }
      try { localStorage.setItem('room-agents-theme', t); localStorage.setItem('room-agents-model', sel.value); } catch (e) {}
      if (!window.confirm('AI社員（バイヤー×監査）を実行しますか？\nAIを3〜7回使います（実測で計算。1回の実行は' + SESSION_CAP_YEN + '円まで）。楽天の検索は無料です。商品の採用は、あとで社長が承認したときだけです。')) return;
      run(t, sel.value);
    });
    if (running || used >= A.DAILY_LIMIT) go.disabled = true;
    box.appendChild(go);
    if (used >= A.DAILY_LIMIT) box.appendChild(el('p', 'hint', '今日は' + A.DAILY_LIMIT + '回まで実行しました。'));
    var ex = el('div', 'pitch-row');
    ex.appendChild(btn('実行履歴をコピー', 'status-btn', function () { K.copyText(exportJson()).then(function () { K.showToast('コピーしました（JSON）'); }, function () { K.showToast('コピーできませんでした'); }); }));
    ex.appendChild(btn('実行履歴をファイルに保存', 'status-btn', download));
    box.appendChild(ex);
    var list = A.sessions();
    if (list.length) {
      var tabs = el('div', 'xp-filter');
      list.slice(0, 8).forEach(function (s) { tabs.appendChild(btn(stamp(s.at) + ' ' + ({ running: '実行中', done: '完了', failed: '失敗' }[s.status] || ''), 'xp-chip' + ((openSession || list[0].id) === s.id ? ' active' : ''), function () { openSession = s.id; paintFn(); })); });
      box.appendChild(tabs);
      var cur = A.get(openSession) || list[0];
      // 前に開いていたときに途中で閉じた実行は、失敗として扱う（正常終了にしない）
      if (cur.status === 'running' && running !== cur.id) { cur.status = 'failed'; cur.failedStep = (cur.steps[cur.steps.length - 1] || {}).name || '不明'; cur.error = '途中でアプリが閉じられたため、止まりました'; A.save(cur); }
      box.appendChild(sessionView(cur));
    }
    return box;
  }

  window.AgentsView = { panel: panel, run: run };
})();
