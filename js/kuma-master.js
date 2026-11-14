// サングラスくまのマスター画像（2026-11-14）：表紙画像の生成で参考に渡す画像の状態を見る欄（広報の中に表示）。
// 社長が選定した正式マスターは、毎回の承認を求めない（整合性はプログラムが自動で確認）。追加・差し替えのときだけ、社長が確認する。AIは呼ばない（費用0円）。
(function () {
  'use strict';

  var K = window.AppKit;
  var data = null;      // サーバーの一覧（未取得なら null）
  var error = '';
  var busy = '';
  var loading = false;
  var repaint = function () {};
  var STATE = { approved: '正式マスター（生成に使う）', pending: '追加の確認待ち（社長が確認するまで使わない）', changed: '画像が差し替えられた（社長が確認するまで使わない）', invalid: '条件を満たさない（使えない）' };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }

  function load() {
    loading = true;
    K.postJson('api/kuma-master', { action: 'list' }).then(function (r) {
      loading = false;
      if (r.status === 200 && r.data && r.data.masters) { data = r.data; error = ''; } else error = (r.data && r.data.error) || '一覧を読めませんでした';
      repaint();
    }, function () { loading = false; error = 'サーバーにつながりませんでした'; repaint(); });
  }
  function act(action, m) {
    if (action === 'approve' && !window.confirm('この画像（' + m.kindLabel + '）を、表紙画像の生成に使うマスターにしますか？')) return;
    busy = m.id;
    repaint();
    K.postJson('api/kuma-master', { action: action, id: m.id, sha256: m.sha256 }).then(function (r) {
      busy = '';
      if (r.status === 200 && r.data && r.data.masters && !r.data.error) { data.masters = r.data.masters; K.showToast(action === 'approve' ? 'マスターにしました（記録はサーバー）' : '取り消しました（画像は消していません）'); load(); return; }
      K.showToast((r.data && r.data.error) || '記録できませんでした');
      repaint();
    }, function () { busy = ''; K.showToast('サーバーにつながりませんでした'); repaint(); });
  }

  function panel(paint) {
    repaint = paint || repaint;
    var box = el('section', 'search-box kuma-master');
    box.appendChild(el('h3', '', 'サングラスくまのマスター画像（表紙画像の生成用）'));
    box.appendChild(el('p', 'hint', '表紙画像を作るときに、毎回同じくまにするための参考画像です。社長が選定した2枚を正式マスターとして使います。画像の中身（指紋・大きさ）はプログラムが毎回確かめ、差し替えられていたら使いません。確認が要るのは、マスターを追加・差し替えるときだけです。衣装はマスターに固定せず、場面に合わせて変えます。'));
    if (!data && !loading && !error) load();
    if (loading && !data) { box.appendChild(el('p', 'hint', '読み込み中…')); return box; }
    if (error) { box.appendChild(el('p', 'hint', error)); box.appendChild(btn('もう一度読む', 'secondary', load)); return box; }
    if (!data) return box;
    box.appendChild(el('p', 'hint', '生成に使えるか：' + (data.usable.ok ? '使える（承認済み ' + data.usable.count + '枚）' : data.usable.reason)));
    if (data.traits) box.appendChild(el('p', 'hint', '変えない要素：' + data.traits.join('／')));
    if (!data.configured) box.appendChild(el('p', 'hint', 'サーバーの保存場所が未接続のため、承認は記録できません。'));
    if (!data.masters.length) box.appendChild(el('p', 'hint', 'マスター画像はまだ登録されていません。'));
    data.masters.forEach(function (m) {
      var card = el('div', 'kuma-master-card');
      var img = el('img');
      img.src = m.url; img.alt = 'マスター画像（' + m.kindLabel + '）'; img.loading = 'lazy';
      img.style.maxWidth = '160px'; img.style.borderRadius = '12px';
      card.appendChild(img);
      card.appendChild(el('p', '', m.kindLabel + '：' + (STATE[m.state] || m.state)));
      card.appendChild(el('p', 'hint', m.width + '×' + m.height + '・登録 ' + (m.addedAt || '') + (m.approvedAt ? '・' + (m.approvedBy || '承認') + ' ' + m.approvedAt.slice(0, 10) : '') + '・指紋 ' + m.sha256.slice(0, 8)));
      if (m.note) card.appendChild(el('p', 'hint', m.note));
      if (m.problems && m.problems.length) card.appendChild(el('p', 'hint', '理由：' + m.problems.join('／')));
      if (data.configured && busy !== m.id) {
        if (m.state === 'pending' || m.state === 'changed') card.appendChild(btn('この画像をマスターにする', 'primary', function () { act('approve', m); }));
      }
      if (busy === m.id) card.appendChild(el('p', 'hint', '記録しています…'));
      box.appendChild(card);
    });
    return box;
  }

  window.KumaMasterView = { panel: panel, reload: load };
})();
