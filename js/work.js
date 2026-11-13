// 第1段階（2026-11-14）：AI社員の出勤状況・業務日報（経営報告のいちばん上。会社のトップ画面からも開ける）。
// 表示するのは、実際に動いた記録だけ（AIの呼び出し・コードの処理・保存された成果物）。架空の日報・活動は作らない。常に働いているような演出もしない。
// 稼働状況：仕事中（この画面で実際に処理が動いている）／途中（自律運営の仕事を定期実行で続けている）／今は仕事していません（今日は出勤済み）／今は仕事していません／エラー（最後の仕事が失敗）／状態未確認（途中で通信が切れた・アプリが閉じられた等で、完了を確かめられない）
// 出勤＝その日に最初の仕事を始めた時刻、退勤＝その日の最後の仕事が終わった時刻（仕事中なら退勤なし）。
// 2026-11-16：「社長確認待ち」（過去の成果物が社長の判断を待っている数）は、出勤・業務実績と完全に分けて別欄に出す。
//   出勤の欄には、その日に実際にAIを呼び出して仕事をした社員だけを出す。承認待ちがあるだけでは出勤にしない。
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
    return out.concat(prodItems('auditor')).sort(function (a, b) { return a.start < b.start ? 1 : -1; });
  }
  // 自律運営の制作ライン（企画担当AI→投稿セット制作AI→監査AI→制作担当AI）の記録：このiPhoneに取り込んだものと、サーバーにあるもの
  function productionRecords() {
    var out = []; var seen = {};
    var D = window.DeliveryStore;
    var sv = window.ServerSync && window.ServerSync.status();
    ((sv && sv.production) || []).concat(D && D.autoRuns ? D.autoRuns() : []).forEach(function (r) { if (r && r.id && !seen[r.id]) { seen[r.id] = true; out.push(r); } });
    return out.sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 30);
  }
  var RESULT = { pass: '監査に合格 → 社長の確認待ちに提出', hold: '保留（社長には出さない）', reject: '不合格（社長には出さない）', failed: '失敗' };
  function prodItems(role) {
    return productionRecords().map(function (rec) {
      var runs = (rec.runs || []).filter(function (r) { return r.role === role; });
      var steps = (rec.steps || []).filter(function (x) { return x.role === role; });
      if (!runs.length && !steps.length) return null;
      var t = rec.title ? '「' + rec.title + '」' : '';
      var what = { planner: '合格候補' + (rec.sourceCount || (rec.source || []).length) + '件から投稿企画を作り、商品をそろえる' + t, producer: '投稿セットの文章（Instagramの表紙・商品カード・キャプション、楽天ROOMの紹介文）を作る' + t, auditor: '投稿セットを採点（コードの確認と別のAI呼び出し）' + t, editor: '監査AIの指示で投稿セットを修正（' + (rec.revisions || 0) + '回）' + t }[role];
      var dl = role === 'planner' ? (rec.items || []).map(function (it) { return String(it.name).slice(0, 28) + '（' + it.price + '円）' + (it.source === 'buyer' ? '・バイヤーAIの合格候補' : '・企画担当AIが楽天で選定'); })
        : role === 'auditor' ? (rec.audits || []).map(function (a, i) { return (i + 1) + '回目：' + (a.audit ? a.audit.total + '点' : '採点なし') + '・' + ({ pass: '合格', revise: '修正', hold: '保留', reject: '不合格' }[a.decision && a.decision.status] || '') + (a.check && a.check.hardFail ? '・コードの確認でNG' : '・コードの確認OK'); })
        : steps.map(function (x) { return x.name.replace(/^[^：]+：/, '') + '：' + (x.status === 'ok' ? (x.note || '完了') : '失敗 ' + (x.note || '')); });
      if (role === 'auditor' || (role === 'planner' && rec.result === 'hold' && !(rec.audits || []).length) || role === 'editor') dl = dl.concat(['結果：' + (RESULT[rec.result] || rec.result || '') + (rec.result !== 'pass' && rec.why ? '：' + rec.why : '')]);
      var failed = steps.some(function (x) { return x.status === 'failed'; }) && rec.result === 'failed';
      var extra = [];
      var FLAG = { fabrication: '根拠のない記述（捏造の疑い）', unverified: '確認できない断定', policy: '規約・表現' };
      if (role === 'auditor') (rec.audits || []).forEach(function (a, i) {
        var au = a.audit || {};
        var lines = ['合計 ' + (au.total == null ? '採点なし' : au.total + '点') + '｜判定：' + ({ pass: '合格', revise: '修正', hold: '保留', reject: '不合格' }[a.decision && a.decision.status] || '') + '｜理由：' + ((a.decision && a.decision.why) || '')];
        Object.keys(au.scores || {}).forEach(function (k) { var sc = au.scores[k]; lines.push(sc.label + ' ' + sc.score + '/' + sc.max + (sc.deductions ? '：' + sc.deductions : '')); });
        var fl = Object.keys(FLAG).filter(function (k) { return au.flags && au.flags[k]; });
        if (fl.length) lines.push('flag（点数に関係なく不合格）：' + fl.map(function (k) { return FLAG[k]; }).join('・') + (au.flags.why ? '：' + au.flags.why : ''));
        (au.fixes || []).forEach(function (f, j) { var fc = (a.fixCheck || [])[j]; lines.push('修正指示［' + (f.target || 'caption') + '］' + f.text + (fc ? (fc.changed ? '（制作担当AIが直した）' : '（直されていない）') : '')); });
        if (au.needResearch) lines.push('追加調査が必要：' + au.needResearch);
        if (au.summary) lines.push('まとめ：' + au.summary);
        ((a.check && a.check.checks) || []).forEach(function (k) { lines.push((k.ok === false ? 'NG ' : k.ok === true ? 'OK ' : '未確認 ') + k.label + '：' + k.detail); });
        extra.push({ title: (i + 1) + '回目の採点の全文', lines: lines });
      });
      var textLines = function (t) { var out = ['キャプション本文：' + (t.caption || '（なし）')]; (t.cards || []).forEach(function (c, j) { out.push('商品カード' + (j + 1) + '：' + c.subline + '／' + c.memo); }); (t.room || []).forEach(function (r, j) { out.push('ROOM紹介文' + (j + 1) + '：' + r); }); return out; };
      if (role === 'editor' || role === 'producer') (rec.versions || []).forEach(function (v) { if ((role === 'editor') === (v.round > 0)) extra.push({ title: (v.round ? v.round + '回目の修正後の全文（直した場所：' + ((v.changed || []).join('・') || 'なし') + '）' : '最初に作った全文'), lines: (v.giveUp ? ['直せない点：' + v.giveUp] : []).concat(textLines(v.texts || {})) }); });
      if (role === 'producer' && rec.draft) extra.push({ title: '最終の下書き（' + (RESULT[rec.result] || rec.result) + '。社長の確認待ちには入れていない）', lines: rec.draft.items.map(function (it) { return it.name.slice(0, 40) + '（' + it.price + '円）'; }).concat(textLines(rec.draft.texts || {})) });
      return { start: startOf(runs, (steps[0] || {}).startedAt || rec.at), end: endOf(runs, (steps[steps.length - 1] || {}).endedAt || rec.endedAt), state: failed ? 'failed' : 'ok', what: what, error: failed ? (rec.failedStep || '') + '：' + (rec.error || '') : '',
        calls: runs, cost: sum(runs, 'yen'), tokens: tokens(runs), rakuten: role === 'planner' ? rec.rakutenCalls || 0 : 0, deliverables: dl, extra: extra, open: rec.result === 'pass' ? function () { go('#pitch', function () { if (window.PitchView && window.PitchView.show) window.PitchView.show('sets'); }); } : function () { go('#company'); } };
    }).filter(Boolean);
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

  // 社員の一覧（名前・役職・担当業務・仕事の記録の出どころ・自律運営できるか）
  // board：サーバーの仕事探しの記録のどれを見るか／jobKeys：サーバーで今進んでいる仕事のどれが、この社員の担当か
  function staff() {
    return [
      { key: 'buyer', name: 'バイヤーAI', title: '商品部', duty: '楽天の実際の検索結果から、紹介する商品の候補を最大3件（監査AIが合格にした候補は、社長の確認なしで企画担当AIへ渡す）', items: buyerItems(), board: 'buyer',
        auto: { can: true, how: 'テーマ（採用した商品・投稿セットから）で楽天を探す。投稿セットにまだ使っていない合格候補が4件以上あれば、制作が進むのを待つ' } },
      { key: 'auditor', name: '監査AI', title: '品質管理', duty: '商品の候補・コメント案・投稿セットを、別のAI呼び出しで採点し、修正指示を出す（合格・不合格はコードが決める）', items: auditorItems(), board: 'auditor',
        auto: { can: true, how: 'バイヤーAI・営業・交流担当AI・投稿セット制作AIの成果物が届いたら採点する' } },
      { key: 'planner', name: '企画担当AI', title: '企画部', duty: '監査AIが合格にした商品候補を中心に、Instagramの1投稿分の企画を作り、足りない商品を楽天で探して選ぶ', items: prodItems('planner'), board: 'production',
        auto: { can: true, how: '投稿セットにまだ使っていない合格候補があれば始める。社長の確認待ちの投稿セットが6件以上なら待つ' } },
      { key: 'set', name: '投稿セット制作AI', title: '制作部', duty: '企画と商品から、Instagramの表紙・商品カードの文字・キャプションと、楽天ROOMの紹介文・ハッシュタグを作る（画像はアプリで開いたときに描く）', items: aiLogItems(['pitch:set', 'pitch:roomtext', 'pitch:tags', 'pitch:intro'], function (t) { return /roomtext|tags|intro/.test(t) ? 'ROOM紹介文・ハッシュタグを作る（画面から）' : '投稿セットを作る（画面から）'; }, function () { go('#pitch', function () { if (window.PitchView && window.PitchView.show) window.PitchView.show('sets'); }); }).concat(prodItems('producer')), board: 'production', jobTypes: [],
        auto: { can: true, how: '企画担当AIの企画が届いたら作る。画像（スライド）はサーバーでは描かず、アプリで投稿セットを開いたときに描く' } },
      { key: 'editor', name: '制作担当AI（修正）', title: '制作部', duty: '監査AIの修正指示に従って、投稿セットのキャプションとROOM紹介文を直す（最大2回。直せなければ推測せず保留）', items: prodItems('editor'), board: 'production',
        auto: { can: true, how: '監査AIが「修正」と判定したら直す' } },
      { key: 'outreach', name: '営業・交流担当AI', title: '営業部', duty: '他の人の投稿（文章を確認できたもの）へのコメント案とフォロー候補の評価。送信・フォローは社長', items: outreachItems(), board: 'outreach',
        auto: { can: true, how: '文章を確認できた交流候補（社長が追加・公式APIで集めたもの）があれば作る。候補を自分で探すには、Instagram公式API（Facebookログイン方式）の鍵が必要' } },
      { key: 'pitch', name: '商品の提案（プレゼン）', title: '商品部', duty: '「次の商品を探してもらう」「広げる」で、楽天の商品を探してプレゼンを書く', jobTypes: ['pitch', 'explore', 'explore_more'], items: aiLogItems(['pitch:scout', 'pitch:more', 'pitch:seed', 'pitch:expand', 'explore'], function (t) { return /expand|explore/.test(t) ? '「広げる」で関連商品を探す' : '商品を探してプレゼンを書く'; }, function () { go('#pitch'); }),
        auto: { can: false, kind: '担当外', why: 'バイヤーAIと同じ「商品を探す」仕事のため、自律運営はバイヤーAIに一本化（同じ仕事に二重に費用をかけない）。画面のボタンは今までどおり使えます' } },
      { key: 'meeting', name: '経営会議（旧方式）', title: '経営', duty: '毎日1回、事実を集めて会議の文章を作る（1回のAI呼び出しで複数の役。新方式に置き換え予定）', jobTypes: ['company'], items: meetingItems(),
        auto: { can: false, kind: 'データ不足', why: '会議の材料（事実）は、社長のiPhoneの中の記録からコードが集めるため、サーバーではまだ集められない。今はアプリを開いたときに1日1回' } },
      { key: 'perf', name: '実績の取り込み（コード）', title: '分析', duty: 'Instagramの数字を公式APIから取り込む（AIなし）', items: perfItems(),
        auto: { can: false, kind: 'API未設定', why: 'Instagram公式APIの鍵が未設定のため動けない（鍵を設定すれば、1日1回の定期実行で取り込める）' } }
    ];
  }

  // 社長確認待ち（AI社員の過去の成果物が、社長の判断を待っている数）。出勤・業務実績には含めない
  function pendingList() {
    var A = window.AgentsStore, D = window.DeliveryStore, R = window.PrStore, P = window.PitchStore, C = window.CompanyStore;
    var sets = function () { go('#pitch', function () { if (window.PitchView && window.PitchView.show) window.PitchView.show('sets'); }); };
    return [
      { label: '投稿セット（確認待ち。自律運営の分は監査AIに合格したもの）', n: D ? D.pendingCount() : 0, open: sets, note: '採用・公開（Instagram・楽天ROOM）は社長が決めます' },
      { label: '商品の候補（監査に合格・投稿セットにまだ使っていない）', n: A ? (function () { var inSet = {}; if (D) D.exclude().codes.forEach(function (c) { inSet[c] = true; }); return A.sessions().filter(function (x) { return x.status === 'done'; }).reduce(function (a, x) { return a + (x.candidates || []).filter(function (c) { var v = c.versions[c.versions.length - 1]; return c.status === 'pass' && !c.owner && !c.usedIn && !(v && v.data && inSet[v.data.code]); }).length; }, 0); })() : 0, open: function () { go('#company'); }, note: '正式な採用は社長が決めます' },
      { label: 'コメント案（監査に合格・まだ送っていない）', n: R ? R.posts().filter(function (p) { return p.status === 'todo' && p.outreach && p.outreach.status === 'pass'; }).length : 0, open: function () { go('#pr'); }, note: 'コメントの送信・フォローは社長がInstagramで行います' },
      { label: 'プレゼン（判断待ち）', n: P && P.queue ? P.queue().length : 0, open: function () { go('#pitch'); } },
      { label: '提言・業務（判断待ち）', n: C ? C.proposals().filter(function (p) { return p.status === 'open'; }).length + C.tasks(true).filter(function (t) { return t.status === 'review'; }).length : 0, open: function () { go('#company'); } }
    ];
  }

  // サーバーで今進んでいる仕事は、どの社員の担当か
  var ROLE_KEY = { planner: 'planner', producer: 'set', auditor: 'auditor', editor: 'editor' };
  function jobOwner(j) {
    if (!j) return '';
    if (j.type === 'production') return ROLE_KEY[j.role] || 'planner';
    if (j.step === 'audit') return 'auditor';
    if (j.type === 'buyer' && j.step === 'check') return 'buyer';
    return j.type;
  }
  // 稼働状況（実際の記録から。常に働いているようには見せない。社長確認待ちの数では決めない）
  function stateOf(s) {
    var items = (s.items || []).slice().sort(function (a, b) { return (a.start || '') < (b.start || '') ? 1 : -1; });
    var last = items[0];
    var job = (s.jobTypes || []).map(function (t) { return liveJobs[t]; }).filter(Boolean)[0];
    if (items.some(function (x) { return x.state === 'running'; }) || job) return { key: 'working', label: '仕事中', job: job };
    // 自律運営（サーバー）：仕事の途中（定期実行のたびに1段階ずつ進む。今この瞬間に動いているとは限らないので「仕事中」とは書かない）
    var sv = window.ServerSync && window.ServerSync.status();
    if (sv && sv.configured && sv.job && jobOwner(sv.job) === s.key) return { key: 'inprogress', label: '途中（定期実行で続き）', server: sv.job };
    if (last && last.state === 'unknown') return { key: 'unknown', label: '状態未確認' };
    if (last && last.state === 'failed' && Date.now() - new Date(last.end || last.start).getTime() < DAY) return { key: 'error', label: 'エラー' };
    if (workedToday(s)) return { key: 'today', label: '今は仕事していません（今日は出勤済み）' };
    return { key: 'off', label: '今は仕事していません' };
  }
  // 今日、実際にAIを呼び出して仕事をしたか（社長確認待ちの数は関係ない）
  function workedToday(s) { var t = today(); return (s.items || []).some(function (x) { return x.start && jst(x.start) === t && x.calls && x.calls.length; }); }
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
    // 監査の全文・修正前後の全文など（記録にあるものだけ）
    (x.extra || []).forEach(function (sec) {
      var d = el('details', 'wk-extra');
      d.appendChild(el('summary', null, sec.title));
      sec.lines.forEach(function (l) { d.appendChild(el('p', 'hint wk-pre' + (/^NG|不合格|flag|直されていない/.test(l) ? ' pitch-warn' : ''), l)); });
      box.appendChild(d);
    });
    if (x.open) box.appendChild(btn('成果物の画面を開く', 'status-btn', x.open));
    return box;
  }

  // 社員の個別の画面：出勤・退勤と、今日の業務日報（なければ最近の仕事）
  function detailView(s, st) {
    var box = el('div', 'wk-detail');
    box.appendChild(el('p', 'hint', s.title + '｜担当：' + s.duty));
    if (st.job) box.appendChild(el('p', 'hint', '仕事中：' + st.job.label + '（' + hm(st.job.at) + ' 開始・検索ジョブ）'));
    box.appendChild(el('p', 'hint', s.auto ? (s.auto.can ? '自律運営：できる（' + s.auto.how + '）' : '自律運営：まだできない（' + s.auto.why + '）') : ''));
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

  // 自律運営（アプリを閉じていても、定期実行でサーバーが仕事を進める）の状態。サーバーから受け取った事実だけ
  var AGENT = { buyer: 'バイヤーAI', outreach: '営業・交流担当AI', production: '制作ライン' };
  var ROLE_NAME = { planner: '企画担当AI', producer: '投稿セット制作AI', auditor: '監査AI', editor: '制作担当AI' };
  var BOARD = { work: '仕事あり', wait: '待ち', none: '仕事なし' };
  var TRIG = { qstash: 'QStashの定期実行（15分ごと）', schedule: 'GitHubの定期実行（15分ごと）', workflow_dispatch: '手動', 'vercel-cron': 'Vercelの予備（1日1回）', unknown: '不明' };
  var KIND = { nodata: 'データ不足', waiting: '処理待ち', budget: '予算不足', quota: '今日の上限', backlog: '確認待ちが多い', nokey: 'API未設定', error: 'エラー', paused: '停止中' };
  function boardOf(key) {
    var sv = window.ServerSync && window.ServerSync.status();
    var b = sv && sv.board;
    if (!b || !key) return null;
    var items = b.items || [];
    var hit = key === 'auditor' ? (items.filter(function (x) { return x.status === 'work'; })[0] || items[0]) : items.filter(function (x) { return x.agent === key; })[0];
    return hit ? { at: b.at, status: hit.status, kind: hit.kind, reason: key === 'auditor' ? (hit.status === 'work' ? (AGENT[hit.agent] || hit.agent) + 'の成果物を採点する予定' : '採点する成果物がまだない') : hit.reason } : null;
  }
  function autonomyBox() {
    var box = el('div', 'wk-auto');
    var sv = window.ServerSync && window.ServerSync.status();
    if (!sv) { box.appendChild(el('p', 'hint', '自律運営：サーバーの状態を確認しています…')); return box; }
    if (!sv.configured) { box.appendChild(el('p', 'hint', '自律運営：未接続（' + (sv.error || 'サーバーの保存場所が未設定') + '）。今は、アプリを開いたときに社長が押した仕事だけが動きます。')); return box; }
    var h = sv.health || {};
    var b = sv.budget || { spent: {}, limits: {} };
    box.appendChild(el('p', 'field-label', '自律運営（アプリを閉じていても、定期実行で仕事を進めます）'));
    var lines = [
      '最後の実行：' + (h.lastTickAt ? stamp(h.lastTickAt) : 'まだ') + (h.lastTrigger ? '（' + (TRIG[h.lastTrigger] || h.lastTrigger) + '）' : ''),
      'きっかけ別の最後の実行：' + ['qstash', 'schedule', 'workflow_dispatch', 'vercel-cron'].map(function (k) { return TRIG[k] + ' ' + (h.triggers && h.triggers[k] ? stamp(h.triggers[k]) : 'まだ記録なし'); }).join('／'),
      '今の仕事：' + (sv.job ? (AGENT[sv.job.type] || sv.job.type) + (sv.job.role ? '（' + ROLE_NAME[sv.job.role] + '）' : '') + '・段階「' + sv.job.step + '」（' + stamp(sv.job.startedAt) + ' 開始' + (sv.job.attempts ? '・やり直し' + sv.job.attempts + '回目' : '') + '）' : 'なし'),
      '今月のAIの費用（サーバーで実測・画面と自律運営の合計）：' + yen(b.spent.month) + ' ／ 上限 ' + (b.limits.month || 1000) + '円',
      '今日の自律運営の費用：' + yen(b.spent.dayAuto) + ' ／ 上限 ' + (b.limits.dayAuto || 25) + '円'
    ];
    if (sv.paused) lines.unshift('停止中：' + stamp(sv.paused.at) + ' に止めました（' + sv.paused.reason + '）。定期実行はAIを呼びません。途中の仕事と成果物は残っています');
    if (h.pausedUntil && new Date(h.pausedUntil).getTime() > Date.now()) lines.push('休止中：' + stamp(h.pausedUntil) + ' まで（連続して失敗したため）：' + (h.lastError || ''));
    else if (h.lastSkip) lines.push('最近止まった理由：' + h.lastSkip);
    if (!sv.snapshotAt) lines.push('アプリの情報がまだサーバーに届いていません');
    if (sv.board) lines.push('仕事探し（' + stamp(sv.board.at) + '）：' + (sv.board.items || []).map(function (x) { return (AGENT[x.agent] || x.agent) + '＝' + BOARD[x.status] + '（' + x.reason + '）'; }).join('／'));
    lines.push('投稿セットにまだ使っていない合格候補：' + (sv.backlog || 0) + '件');
    var ul = el('ul', 'co-facts'); lines.forEach(function (l) { ul.appendChild(el('li', null, l)); }); box.appendChild(ul);
    // 停止スイッチ（本番で問題があれば、ここで追加の自律実行を止める）
    box.appendChild(btn(sv.paused ? '自律運営を再開する' : '自律運営を止める', sv.paused ? 'btn btn-primary wk-pause' : 'btn btn-secondary wk-pause', function () {
      var on = !sv.paused;
      if (on && !window.confirm('自律運営を止めますか？（定期実行がAIを呼ばなくなります。途中の仕事・成果物・記録は消えません）')) return;
      K.postJson('api/worker', { action: on ? 'pause' : 'resume', reason: on ? '社長がアプリから停止' : '' }).then(function (r) {
        if (r.status === 200 && r.data && r.data.ok) { K.showToast(on ? '自律運営を止めました' : '自律運営を再開しました'); window.ServerSync.refresh(); } else K.showToast('切り替えられませんでした：' + ((r.data && r.data.error) || r.status));
      });
    }));
    if ((sv.log || []).length) {
      var det = el('details');
      det.appendChild(el('summary', null, '定期実行の記録（最近 ' + Math.min(10, sv.log.length) + '件）'));
      sv.log.slice(0, 10).forEach(function (x) { det.appendChild(el('p', 'hint' + (x.ok ? '' : ' pitch-warn'), stamp(x.at) + '｜' + (x.trigger ? (TRIG[x.trigger] || x.trigger) + '｜' : '') + (AGENT[x.agent] || x.agent) + (x.role ? '（' + ROLE_NAME[x.role] + '）' : '') + '｜段階「' + x.step + '」｜' + (x.ok ? '成功' : '失敗：' + x.error) + (x.final ? '｜仕事を' + (x.final === 'done' ? '完了' : '打ち切り') : '') + '｜AI ' + x.calls + '回・' + yen(x.yen) + (x.openaiIds && x.openaiIds.length ? '｜応答ID ' + x.openaiIds.join('・') : ''))); });
      box.appendChild(det);
    }
    if (sv.merged && (sv.merged.buyer || sv.merged.outreach || sv.merged.production)) box.appendChild(el('p', 'hint', '今回受け取った成果物：商品の候補 ' + sv.merged.buyer + '件・コメント案 ' + sv.merged.outreach + '件・制作ラインの記録 ' + (sv.merged.production || 0) + '件（うち社長の確認待ちの投稿セット ' + (sv.merged.sets || 0) + '件）'));
    return box;
  }

  if (window.ServerSync) window.ServerSync.on(function () { repaint(); });

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
    wrap.appendChild(autonomyBox());
    var all = staff();
    var rows = all.map(function (s) { return { s: s, st: stateOf(s) }; });
    var counts = { working: 0, inprogress: 0, error: 0, unknown: 0 };
    rows.forEach(function (x) { if (counts[x.st.key] != null) counts[x.st.key]++; });
    var present = rows.filter(function (x) { return workedToday(x.s); });
    var pend = pendingList();
    var pendTotal = pend.reduce(function (a, x) { return a + x.n; }, 0);
    wrap.appendChild(el('p', 'hint wk-summary', '今日の出勤 ' + present.length + '人' + (counts.working ? '｜仕事中 ' + counts.working + '人' : '') + (counts.inprogress ? '｜途中 ' + counts.inprogress + '人' : '') + '｜エラー ' + counts.error + '人' + (counts.unknown ? '｜状態未確認 ' + counts.unknown + '人' : '') + '｜社長確認待ち ' + pendTotal + '件（下の別欄。出勤には含めません）'));

    // 1. 今日の出勤（実際にAIを呼び出して仕事をした社員だけ）
    var att = el('div', 'wk-section wk-attend');
    att.appendChild(el('p', 'field-label', '今日の出勤（' + today().slice(5).replace('-', '/') + '・実際にAIを呼び出して仕事をした社員だけ）'));
    if (!present.length) att.appendChild(el('p', 'hint', '今日はまだ、AIを呼び出して仕事をした社員はいません。'));
    present.forEach(function (x) {
      var s = x.s, st = x.st;
      var at = attendance(s, st);
      var its = at.items;
      var calls = its.reduce(function (a, y) { return a + (y.calls ? y.calls.length : 0); }, 0);
      var cost = its.reduce(function (a, y) { return a + (y.cost || 0); }, 0);
      var made = its.reduce(function (a, y) { return a + (y.deliverables || []).length; }, 0);
      var row = el('div', 'wk-row wk-' + st.key);
      var top = btn('', 'wk-toggle', function () { open['a:' + s.key] = !open['a:' + s.key]; repaint(); });
      top.appendChild(el('span', 'wk-name', s.name));
      top.appendChild(el('span', 'wk-title', s.title));
      top.appendChild(el('span', 'wk-state wk-state-' + st.key, st.label));
      top.appendChild(el('span', 'wk-last', '出勤 ' + hm(at.in) + '｜退勤 ' + (at.out ? hm(at.out) : st.key === 'working' ? '（仕事中）' : st.key === 'inprogress' ? '（定期実行で続き）' : '（確認できない）') + '｜仕事 ' + its.length + '件｜AIの呼び出し ' + calls + '回｜成果物 ' + made + '件｜費用（実測）' + yen(cost)));
      row.appendChild(top);
      if (open['a:' + s.key]) { var d = el('div', 'wk-detail'); its.forEach(function (y) { d.appendChild(itemView(y)); }); row.appendChild(d); }
      att.appendChild(row);
    });
    wrap.appendChild(att);

    // 2. 社長確認待ち（過去の成果物。出勤・業務実績とは別）
    var pb = el('div', 'wk-section wk-pending');
    pb.appendChild(el('p', 'field-label', '社長確認待ち ' + pendTotal + '件（AI社員がこれまでに作った成果物。今日の出勤・業務実績には含めません）'));
    var ul = el('ul', 'co-facts');
    pend.forEach(function (x) { var li = el('li', null, x.label + '：' + x.n + '件' + (x.n && x.note ? '（' + x.note + '）' : '')); if (x.n) li.appendChild(btn('開く', 'status-btn wk-open', x.open)); ul.appendChild(li); });
    pb.appendChild(ul);
    wrap.appendChild(pb);

    // 3. 社員の一覧と自律運営（できる／まだ）・仕事探しの結果
    var sb = el('div', 'wk-section wk-staff');
    sb.appendChild(el('p', 'field-label', '社員の一覧と自律運営（自律運営できる ' + all.filter(function (s) { return s.auto && s.auto.can; }).length + '人／まだ ' + all.filter(function (s) { return !(s.auto && s.auto.can); }).length + '人）'));
    rows.forEach(function (x) {
      var s = x.s, st = x.st;
      var row = el('div', 'wk-row wk-' + st.key);
      var top = btn('', 'wk-toggle', function () { open[s.key] = !open[s.key]; repaint(); });
      top.appendChild(el('span', 'wk-name', s.name));
      top.appendChild(el('span', 'wk-title', s.title + '｜自律運営' + (s.auto && s.auto.can ? 'できる' : 'まだ')));
      top.appendChild(el('span', 'wk-state wk-state-' + st.key, st.label));
      var items = (s.items || []).slice().sort(function (a, b) { return (a.start || '') < (b.start || '') ? 1 : -1; });
      var last = items[0];
      var bd = s.auto && s.auto.can ? boardOf(s.board) : null;
      top.appendChild(el('span', 'wk-last', (bd ? '仕事探し：' + BOARD[bd.status] + (bd.kind && KIND[bd.kind] ? '・' + KIND[bd.kind] : '') + '（' + bd.reason + '）｜' : s.auto && !s.auto.can ? '自律運営まだ（' + (s.auto.kind || '') + '）：' + s.auto.why.slice(0, 40) + '…｜' : '') + (last ? '最後の仕事：' + stamp(last.end || last.start) + '・' + last.what.slice(0, 20) : '記録された仕事はまだありません')));
      row.appendChild(top);
      if (open[s.key]) row.appendChild(detailView(s, st));
      sb.appendChild(row);
    });
    wrap.appendChild(sb);
    return wrap;
  }

  window.WorkView = { panel: panel, staff: staff, stateOf: stateOf, attendance: attendance, pendingList: pendingList, workedToday: workedToday };
})();
