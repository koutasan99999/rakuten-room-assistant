// P0（2026-11-13）：投稿ごとの実績の画面（広報の中に表示）。
// 実績＝Instagramの公式APIの数字か、社長の手入力だけ。空欄は「未取得」（推測で埋めない）。AIの事前の採点とは分けて表示する。
(function () {
  'use strict';

  var K = window.AppKit;
  var P = window.PerfStore;
  var repaint = function () {};
  var igReady = null;   // 公式APIが使えるか（null＝まだ確認していない）
  var busy = '';
  var openForm = {};    // 投稿ID → 入力欄を開いている
  var adding = false;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function stamp(iso) { try { var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; } }
  function fmt(v) { return v == null ? '未取得' : Number(v).toLocaleString('ja-JP'); }

  function checkIg() {
    K.postJson('api/ig', { action: 'status' }).then(function (r) { igReady = !!(r.status === 200 && r.data && r.data.ready); repaint(); }, function () { igReady = false; repaint(); });
  }
  function importApi() {
    busy = 'Instagramから数字を取り込んでいます…';
    repaint();
    K.postJson('api/ig', { action: 'media', limit: 12 }).then(function (r) {
      busy = '';
      if (r.status !== 200 || !r.data || !r.data.ready) { K.showToast((r.data && (r.data.error || r.data.notice)) || '取り込めませんでした'); repaint(); return; }
      var res = P.importApi(r.data);
      K.showToast('取り込みました：投稿 ' + (r.data.media || []).length + '件（新しく ' + res.added + '件）' + (res.errors ? '・数字を取れなかった投稿 ' + res.errors + '件' : ''));
      repaint();
    }, function () { busy = ''; K.showToast('通信できませんでした'); repaint(); });
  }
  function download(name, text, type) {
    try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { K.showToast('保存できませんでした。コピーをお使いください'); }
  }

  // 手入力の欄（空欄は未取得のまま）
  function inputForm(p) {
    var box = el('div', 'add-panel');
    box.appendChild(el('p', 'hint', 'Instagramアプリの「インサイト」に出ている数字を入れてください。分からない欄は空欄のまま（未取得として記録します）。'));
    var when = el('input', 'input'); when.type = 'datetime-local';
    var d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); when.value = d.toISOString().slice(0, 16);
    box.appendChild(el('p', 'field-label', '数字を見た日時')); box.appendChild(when);
    var inputs = {};
    P.METRICS.forEach(function (m) {
      box.appendChild(el('p', 'field-label', m.label + (m.note ? '（' + m.note + '）' : '')));
      var i = el('input', 'input'); i.inputMode = 'decimal'; i.placeholder = '未取得'; inputs[m.key] = i; box.appendChild(i);
    });
    box.appendChild(btn('記録する', 'btn btn-primary co-sbtn', function () {
      var vals = {}; var any = false;
      Object.keys(inputs).forEach(function (k) { vals[k] = inputs[k].value; if (inputs[k].value.trim() !== '') any = true; });
      if (!any) { K.showToast('数字が1つも入っていません'); return; }
      var at = when.value ? new Date(when.value).toISOString() : new Date().toISOString();
      var snap = P.addSnapshot(p.id, vals, 'manual', at);
      openForm[p.id] = false;
      K.showToast('記録しました（' + snap.timing + '・手入力）');
      repaint();
    }));
    return box;
  }

  function postCard(p) {
    var card = el('div', 'card perf-post');
    card.appendChild(el('p', 'field-label', (P.FORMATS[p.format] || p.format) + '｜' + (p.postedAt ? stamp(p.postedAt) + ' 公開' : '公開日時：未入力') + (p.setId ? '｜投稿セットから' : '')));
    card.appendChild(el('p', 'thief-cand-name', p.theme || '（テーマ未入力）'));
    if (p.url) { var a = el('a', 'link-btn', '投稿を開く'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; card.appendChild(a); }
    card.appendChild(el('p', 'hint', '投稿前のAI評価：' + (p.preScore && p.preScore.score != null ? p.preScore.score + '点（' + (p.preScore.by || '') + '）' : '未評価') + '｜※AIの評価は実績ではありません'));
    var last = P.latest(p);
    var lines = P.METRICS.map(function (m) { var v = last[m.key]; return m.label + '：' + (v ? fmt(v.value) + (m.key === 'nonFollowerPct' ? '%' : '') + '（' + (v.source === 'api' ? 'API' : '手入力') + '・' + v.timing + '）' : '未取得'); });
    var ul = el('ul', 'co-facts'); lines.forEach(function (l) { ul.appendChild(el('li', null, l)); }); card.appendChild(ul);
    var hyp = el('input', 'input'); hyp.placeholder = 'この投稿の狙い（例：表紙に悩みの言葉を入れて、フォロワー以外の閲覧を増やす）'; hyp.value = p.hypothesis || '';
    hyp.addEventListener('change', function () { P.update(p.id, { hypothesis: hyp.value.slice(0, 200) }); });
    card.appendChild(hyp);
    if ((p.snapshots || []).length) {
      var det = el('details'); det.appendChild(el('summary', null, '記録の履歴（' + p.snapshots.length + '件）'));
      p.snapshots.slice().reverse().forEach(function (x) { det.appendChild(el('p', 'hint', stamp(x.at) + '｜' + x.timing + (x.hours != null ? '（公開から' + x.hours + '時間）' : '') + '｜' + (x.source === 'api' ? 'API' : '手入力') + '｜' + P.METRICS.filter(function (m) { return x.metrics[m.key] != null; }).map(function (m) { return m.label + ' ' + fmt(x.metrics[m.key]); }).join('・'))); });
      card.appendChild(det);
    }
    card.appendChild(btn(openForm[p.id] ? '入力をやめる' : '数字を手で入れる', 'status-btn', function () { openForm[p.id] = !openForm[p.id]; repaint(); }));
    if (openForm[p.id]) card.appendChild(inputForm(p));
    return card;
  }

  // 比べる：投稿ごとの閲覧の多い順（取れている投稿だけ。平均は取れた数字だけで計算）
  function compareBox(list) {
    var box = el('div', 'card');
    box.appendChild(el('p', 'co-h', '投稿の比較（閲覧の多い順・最新の記録）'));
    var rows = list.map(function (p) { var l = P.latest(p); return { p: p, views: l.views ? l.views.value : null, nf: l.nonFollowerPct ? l.nonFollowerPct.value : null, follows: l.follows ? l.follows.value : null, saves: l.saves ? l.saves.value : null }; });
    var got = rows.filter(function (r) { return r.views != null; }).sort(function (a, b) { return b.views - a.views; });
    if (!got.length) { box.appendChild(el('p', 'hint', '閲覧の数字がまだありません（未取得）。')); return box; }
    var avg = Math.round(got.reduce(function (a, r) { return a + r.views; }, 0) / got.length * 10) / 10;
    box.appendChild(el('p', 'hint', '閲覧の平均：' + avg + '回（数字のある ' + got.length + '件・未取得 ' + (rows.length - got.length) + '件）' + (got.length < 5 ? '｜件数が少ないので、差は偶然の可能性があります' : '')));
    var ul = el('ul', 'co-facts');
    got.slice(0, 10).forEach(function (r, i) { ul.appendChild(el('li', null, (i + 1) + '. ' + (r.p.theme || '（テーマなし）').slice(0, 24) + '｜閲覧 ' + fmt(r.views) + '｜フォロワー以外 ' + (r.nf == null ? '未取得' : r.nf + '%') + '｜フォロー ' + fmt(r.follows) + '｜保存 ' + fmt(r.saves))); });
    box.appendChild(ul);
    return box;
  }

  function panel(rp) {
    repaint = rp || repaint;
    if (igReady === null) { igReady = false; checkIg(); }
    var synced = P.syncFromSets();
    var wrap = el('div');
    var head = el('div', 'card perf-panel');
    head.appendChild(el('h3', 'cand-name', '投稿の成績（実績）'));
    head.appendChild(el('p', 'hint', 'Instagramの公式APIで取れた数字か、社長が入れた数字だけを記録します。分からない数字は「未取得」のまま（推測しません）。AIの採点とは別に扱います。'));
    head.appendChild(el('p', 'hint', igReady ? 'Instagramの公式API：接続済み' : 'Instagramの公式API：未接続（鍵 IG_ACCESS_TOKEN が未設定）。今は手入力で記録できます。'));
    if (synced) head.appendChild(el('p', 'hint', '投稿セットで「Instagramに投稿した」を記録した投稿を ' + synced + '件、成績の記録に入れました。'));
    if (busy) head.appendChild(el('p', 'hint pitch-busy', busy));
    if (igReady) head.appendChild(btn('Instagramから取り込む（最近12件）', 'btn btn-discover', function () { if (!busy) importApi(); }));
    var acc = P.accountLog().slice(-1)[0];
    if (acc) head.appendChild(el('p', 'hint', 'アカウント（' + stamp(acc.at) + '・API）：フォロワー ' + fmt(acc.followers) + '｜直近' + (acc.days || 7) + '日の閲覧 ' + (acc.views ? fmt(acc.views.total) + '（フォロワー以外 ' + fmt(acc.views.nonFollower) + '）' : '未取得') + '｜リーチ ' + (acc.reach ? fmt(acc.reach.total) + '（フォロワー以外 ' + fmt(acc.reach.nonFollower) + '）' : '未取得') + (acc.error ? '｜取れなかった：' + acc.error : '')));
    // 投稿を手で登録
    head.appendChild(btn(adding ? '登録をやめる' : '投稿を登録する（URLを貼る）', 'status-btn', function () { adding = !adding; repaint(); }));
    if (adding) {
      var f = el('div', 'add-panel');
      var u = el('input', 'input'); u.placeholder = 'InstagramのURL（https://www.instagram.com/p/…）'; f.appendChild(u);
      var t = el('input', 'input'); t.placeholder = 'テーマ（例：フライパンまわりの便利グッズ）'; f.appendChild(t);
      var w = el('input', 'input'); w.type = 'datetime-local'; f.appendChild(el('p', 'field-label', '公開した日時')); f.appendChild(w);
      var s = el('select', 'input'); Object.keys(P.FORMATS).forEach(function (k) { var o = el('option', null, P.FORMATS[k]); o.value = k; s.appendChild(o); }); f.appendChild(s);
      f.appendChild(btn('登録する', 'btn btn-primary co-sbtn', function () {
        if (!/instagram\.com\//.test(u.value)) { K.showToast('InstagramのURLを貼ってください'); return; }
        var r = P.add({ url: u.value.trim(), theme: t.value.trim(), postedAt: w.value ? new Date(w.value).toISOString() : '', format: s.value });
        adding = false;
        K.showToast(r.dup ? 'この投稿はもう登録されています' : '登録しました。数字を入れてください');
        repaint();
      }));
      head.appendChild(f);
    }
    var ex = el('div', 'pitch-row');
    ex.appendChild(btn('成績をコピー（JSON）', 'status-btn', function () { K.copyText(JSON.stringify(P.exportJson(), null, 1)).then(function () { K.showToast('コピーしました'); }, function () { K.showToast('コピーできませんでした'); }); }));
    ex.appendChild(btn('表計算用に保存（CSV）', 'status-btn', function () { download('ig-perf-' + new Date().toISOString().slice(0, 10) + '.csv', '﻿' + P.exportCsv(), 'text/csv'); }));
    head.appendChild(ex);
    wrap.appendChild(head);
    var list = P.all();
    if (!list.length) { var e = el('p', 'hint', 'まだ投稿の記録がありません。投稿セットで「Instagramに投稿した」を記録するか、上の「投稿を登録する」からURLを貼ってください。'); wrap.appendChild(e); return wrap; }
    wrap.appendChild(compareBox(list));
    list.slice(0, 20).forEach(function (p) { wrap.appendChild(postCard(p)); });
    return wrap;
  }

  window.PerfView = { panel: panel };
})();
