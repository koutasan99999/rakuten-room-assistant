// 「社長、これどうすか？」の画面：バイヤー（AI）が見つけた商品を1つずつプレゼンし、社長が判断する。
// 判断は PitchStore（このiPhone）に残り、次の発掘に渡す。いいじゃん！はROOM登録待ちになり、紹介文を作る。
// 楽天ROOMへの投稿は自動では行わない（ROOMは機械的な投稿を禁止している）。投稿画面を開くリンクと、コピーできる紹介文を用意する。
(function () {
  'use strict';

  var K = window.AppKit;
  var S = window.PitchStore;
  var body = document.getElementById('pitch-body');
  if (!K || !S || !body) return;
  var el = K.el;
  var TAB_KEY = 'room-pitch-tab';
  var tab = 'deck';
  try { tab = localStorage.getItem(TAB_KEY) || 'deck'; } catch (e) {}
  var busy = '';
  var lastNotice = '';

  function cleanName(n) { return String(n || '').replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 80) || n; }
  function priceLine(p) { return (p.price ? K.formatPrice(p.price) : '価格は未取得') + (p.postage ? '（' + p.postage + '）' : '（送料は商品ページで確認）'); }
  function linkBtn(text, url) { var a = el('a', 'link-btn', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function photo(p, cls) {
    if (!p.image) return el('div', cls + ' pitch-noimg', '写真なし');
    var img = el('img', cls);
    img.src = p.image; img.alt = cleanName(p.name); img.loading = 'lazy';
    img.onerror = function () { img.replaceWith(el('div', cls + ' pitch-noimg', '写真なし')); };
    return img;
  }

  // 探す（初期候補・新しく探す・もっと見せて）。時間がかかるので検索ジョブで呼ぶ（別のアプリを開いても続きから進む）
  function fetchItems(action, extra, label, after) {
    busy = action;
    render();
    // 社長が登録した参考アカウントの調査（テーマ・視聴者に届く切り口）も、商品探しに使う
    var refs = window.ThiefView && window.ThiefView.insights ? window.ThiefView.insights() : [];
    // 通常のプレゼン（scout）は、直近のプレゼンの分類を渡して、同じジャンルが続かないように探してもらう
    var payload = Object.assign({ action: action, exclude: S.exclude(), taste: S.taste(), refs: refs }, action === 'scout' ? { recent: S.recent(30) } : {}, extra || {});
    return K.jobCall('pitch', payload, { label: '社長、これどうすか？：' + label, genre: '' }).then(function (r) {
      busy = '';
      if (r.status !== 200) { lastNotice = (r.data && r.data.error) || '探せませんでした'; render(); return; }
      var d = r.data || {};
      if (action === 'seed') S.markSeeded();
      if (d.taste) S.setTasteNote(d.taste);
      var n = S.addMany(d.items || [], after);
      lastNotice = [n ? n + '件の商品が届きました' : '新しい商品はありませんでした', d.notice || '', (d.missing || []).length ? '楽天で見つからなかった商品：' + d.missing.join('、') : ''].filter(Boolean).join('。');
      render();
    });
  }

  function makeIntro(p) {
    return K.postJson('api/pitch', { action: 'intro', product: p }).then(function (r) {
      if (r.status !== 200 || !r.data.intro) { K.showToast('紹介文を作れませんでした。採用リストで作り直せます'); return; }
      S.update(p.key, { intro: r.data.intro, introNotice: r.data.notice || '' });
      if (main === 'adopted') render();
    });
  }
  function makeFeature(p) {
    S.update(p.key, { featureBusy: true });
    render();
    return K.postJson('api/pitch', { action: 'feature', product: p }).then(function (r) {
      if (r.status !== 200) { S.update(p.key, { featureBusy: false }); K.showToast((r.data && r.data.error) || '特集の原稿を作れませんでした'); render(); return; }
      S.update(p.key, { feature: r.data, featureBusy: false });
      render();
    });
  }
  function ask(q) {
    var a = window.prompt(q + '（任意。空のままOKでも大丈夫です）', '');
    return a == null ? null : a.trim();
  }

  function adopt(p, featured) {
    var reason = ask('どこが良かった？');
    if (reason === null) return;
    S.decide(p.key, 'adopt', reason);
    if (featured) S.update(p.key, { featured: true });
    K.showToast(featured ? '看板商品にしました。紹介文と特集の原稿を作ります' : '採用しました。ROOM紹介文を作ります（ROOM登録待ちに入りました）');
    makeIntro(S.get(p.key));
    if (featured) makeFeature(S.get(p.key));
    render();
  }

  // ---- プレゼン（1商品ずつ） ----
  function widen(p) { if (window.ExploreView) window.ExploreView.open(p, 'pitch'); }
  function deckCard(p, rest) {
    var card = el('article', 'card pitch-card');
    card.appendChild(el('p', 'pitch-count', 'あと ' + rest + ' 件' + (p.angle ? '｜' + p.angle : '')));
    card.appendChild(photo(p, 'pitch-photo'));
    var chips = el('div', 'chips');
    if (p.category) chips.appendChild(el('span', 'tag', p.category));
    if (p.brand) chips.appendChild(el('span', 'role', p.brand));
    card.appendChild(chips);
    card.appendChild(el('h3', 'cand-name', cleanName(p.name)));
    var meta = el('p', 'cand-meta');
    meta.appendChild(el('strong', 'cand-price', priceLine(p)));
    meta.appendChild(el('span', 'cand-shop', (p.brand ? 'ブランド：' + p.brand + '｜' : 'ブランド：商品名から不明｜') + (p.shop || '')));
    card.appendChild(meta);
    var dl = el('dl', 'radar-facts');
    var feat = p.feature || (p.caption ? String(p.caption).replace(/\s+/g, ' ').slice(0, 90) + '…（楽天の商品説明より）' : '');
    [['商品の特徴', feat], ['AI社員が発掘した理由', p.pitch], ['眼科医くまに合う理由', p.fit], ['買う前の弱点・注意点', p.caution]].forEach(function (x) { if (x[1]) { dl.appendChild(el('dt', null, x[0])); dl.appendChild(el('dd', null, x[1])); } });
    card.appendChild(dl);
    if (p.sourcePost || p.sourceHandle) card.appendChild(el('p', 'hint', '商品ドロボー：@' + (p.sourceHandle || '不明') + (p.matchNote ? '｜' + p.matchNote : '')));
    var links = el('div', 'pitch-row');
    if (p.url) links.appendChild(linkBtn('楽天の購入ページ', p.url));
    if (p.sourcePost) links.appendChild(linkBtn('参照元の投稿', p.sourcePost));
    card.appendChild(links);
    card.appendChild(el('p', 'hint', '公式ページ：未取得（メーカーの公式ページは、まだ自動で確かめられません）'));
    var main = el('div', 'xp-actions');
    main.appendChild(btn('いいじゃん！（採用）', 'btn btn-primary', function () { adopt(p, false); }));
    main.appendChild(btn('この商品から広げる', 'btn btn-discover xp-go', function () { widen(p); }));
    card.appendChild(main);
    var acts = el('div', 'pitch-row');
    acts.appendChild(btn('保留', 'status-btn', function () { S.decide(p.key, 'hold', ''); K.showToast('保留にしました'); render(); }));
    acts.appendChild(btn('違うな', 'status-btn', function () {
      var reason = ask('どこが違った？（次の発掘に反映します）');
      if (reason === null) return;
      S.decide(p.key, 'reject', reason);
      K.showToast('「違うな」を記録しました');
      render();
    }));
    card.appendChild(acts);
    return card;
  }

  function renderDeck(list) {
    var q = S.queue();
    if (busy) list.appendChild(el('p', 'hint pitch-busy', busy === 'seed' ? 'これまでに発掘した商品を、楽天で探し直しています…（30〜60秒）' : busy === 'more' ? '似た商品・上のブランド・価格違いを探しています…（30〜60秒）' : 'バイヤーが探しています…（30〜60秒。別のアプリを開いても大丈夫です）'));
    if (q.length) { list.appendChild(deckCard(q[0], q.length - 1)); return; }
    if (busy) return;
    if (!S.seeded()) {
      list.appendChild(el('p', 'manage-empty', 'まず、これまでにAI社員が発掘した商品から10件をプレゼンします。'));
      list.appendChild(btn('初期候補（10商品）を見る', 'btn btn-discover', function () { fetchItems('seed', {}, '初期候補'); }));
      return;
    }
    list.appendChild(el('p', 'manage-empty', '今あるプレゼンは全部見ました。'));
    list.appendChild(btn('次の商品を探してもらう', 'btn btn-discover', function () { fetchItems('scout', {}, '新しく探す'); }));
  }

  // ---- 採用（ROOM登録待ち） ----
  function adoptCard(p) {
    var card = el('article', 'card pitch-adopt');
    var top = el('div', 'cand-top');
    top.appendChild(photo(p, 'cand-thumb'));
    var info = el('div', 'cand-info');
    var chips = el('div', 'chips');
    chips.appendChild(el('span', p.room === 'done' ? 'idea-edited' : 'role', p.room === 'done' ? 'ROOM登録済み' : 'ROOM登録待ち'));
    if (p.featured) chips.appendChild(el('span', 'role buyer-score', '看板商品'));
    if (p.category) chips.appendChild(el('span', 'tag', p.category));
    info.appendChild(chips);
    info.appendChild(el('h3', 'cand-name', cleanName(p.name)));
    var meta = el('p', 'cand-meta');
    meta.appendChild(el('strong', 'cand-price', priceLine(p)));
    if (p.brand) meta.appendChild(el('span', 'cand-shop', p.brand));
    info.appendChild(meta);
    if (p.reason) info.appendChild(el('p', 'hint', '採用の理由：' + p.reason));
    if (p.path) info.appendChild(el('p', 'hint', '見つけた経路：' + p.path));
    if (p.relation) info.appendChild(el('p', 'hint', '関係：' + p.relation));
    info.appendChild(el('p', 'hint', usedIn(p)));
    top.appendChild(info);
    card.appendChild(top);
    card.appendChild(btn('この商品から広げる', 'btn btn-discover xp-go', function () { widen(p); }));

    // 登録前の確認：URL・価格・仕様・重複
    var check = el('div', 'pitch-check');
    var vmsg = p.verify ? p.verify.message + '（' + new Date(p.verify.at).toLocaleString('ja-JP') + '）' : 'まだ確認していません';
    check.appendChild(el('p', 'hint', '登録前の確認：' + vmsg));
    var dups = S.duplicates(p.key);
    if (dups.length) check.appendChild(el('p', 'hint pitch-warn', '重複の可能性：' + dups.map(function (d) { return cleanName(d.name).slice(0, 30); }).join('、')));
    if (p.verify && p.verify.introduced) check.appendChild(el('p', 'hint pitch-warn', '投稿管理・投稿履歴に、同じ名前の商品があります（紹介済みの可能性）'));
    check.appendChild(btn('URL・価格・重複を確認する', 'status-btn', function () { verify(p); }));
    card.appendChild(check);

    var links = el('div', 'buyer-links');
    if (p.url) links.appendChild(linkBtn('楽天の商品ページ', p.url));
    if (p.code) links.appendChild(linkBtn('楽天ROOMで投稿画面を開く', K.roomUrl(p.code)));
    if (p.sourcePost) links.appendChild(linkBtn('参照元の投稿', p.sourcePost));
    card.appendChild(links);

    card.appendChild(el('p', 'field-label', 'ROOM紹介文（直せます）'));
    var ta = el('textarea', 'input pitch-intro');
    ta.rows = 5;
    ta.value = p.intro || '';
    ta.placeholder = p.intro ? '' : '紹介文を作っています…（作れなかったときは「作り直す」）';
    ta.addEventListener('change', function () { S.update(p.key, { intro: ta.value }); });
    card.appendChild(ta);
    if (p.introNotice) card.appendChild(el('p', 'hint', p.introNotice));
    var row = el('div', 'pitch-row');
    row.appendChild(btn('紹介文をコピー', 'btn btn-primary', function () {
      S.update(p.key, { intro: ta.value });
      K.copyText(ta.value).then(function () { K.showToast('コピーしました。ROOMの投稿画面に貼り付けてください'); }, function () { K.showToast('コピーできませんでした'); });
    }));
    row.appendChild(btn('作り直す', 'status-btn', function () { ta.value = ''; ta.placeholder = '作っています…'; makeIntro(p); }));
    row.appendChild(btn(p.room === 'done' ? '登録待ちに戻す' : 'ROOMに登録した', 'status-btn', function () { S.update(p.key, { room: p.room === 'done' ? 'waiting' : 'done' }); render(); }));
    card.appendChild(row);

    // 看板商品：Instagramの特集企画とカルーセル原稿
    if (p.feature) {
      var f = p.feature;
      var d = el('details', 'buyer-plan');
      d.open = true;
      d.appendChild(el('summary', null, '特集企画：' + (f.title || '')));
      if (f.target) d.appendChild(el('p', 'hint', '誰に向けて：' + f.target));
      var ul = el('ul', 'angle-list');
      (f.slides || []).forEach(function (s) { ul.appendChild(el('li', null, s)); });
      d.appendChild(ul);
      var text = f.caption + ((f.hashtags || []).length ? '\n' + f.hashtags.join(' ') : '');
      d.appendChild(el('p', 'buyer-intro pitch-caption', text));
      d.appendChild(btn('キャプションをコピー', 'status-btn', function () { K.copyText(text).then(function () { K.showToast('コピーしました（投稿の公開は社長が行います）'); }, function () {}); }));
      card.appendChild(d);
    } else {
      card.appendChild(btn(p.featureBusy ? '特集の原稿を作っています…' : '看板商品にする（特集の原稿を作る）', 'btn btn-secondary', function () {
        if (p.featureBusy) return;
        S.update(p.key, { featured: true });
        makeFeature(S.get(p.key));
      }));
    }
    var mv = el('div', 'pitch-row');
    mv.appendChild(btn('保留に移す', 'status-btn', function () { S.decide(p.key, 'hold', p.reason); render(); }));
    mv.appendChild(btn('違うなに移す', 'status-btn', function () { var r = ask('どこが違った？'); if (r === null) return; S.decide(p.key, 'reject', r); render(); }));
    card.appendChild(mv);
    return card;
  }

  function verify(p) {
    K.showToast('確認しています…');
    var introducedP = K.introduced().then(function (names) {
      var k = S.nameKey(p.name);
      return names.some(function (n) { return S.nameKey(n) === k; });
    }, function () { return false; });
    K.postJson('api/pitch', { action: 'verify', product: p }).then(function (r) {
      return introducedP.then(function (introduced) {
        if (r.status !== 200) { K.showToast((r.data && r.data.error) || '確認できませんでした'); return; }
        var d = r.data;
        var patch = { verify: { at: Date.now(), message: d.message, found: d.found, introduced: introduced } };
        if (d.found) { patch.price = d.price; if (d.postage) patch.postage = d.postage; if (d.url) patch.url = d.url; if (d.caption) patch.caption = d.caption; }
        S.update(p.key, patch);
        K.showToast(d.message);
        render();
      });
    });
  }

  // ---- 保留・違うな ----
  function smallCard(p, actions) {
    var card = el('article', 'card');
    var top = el('div', 'cand-top');
    top.appendChild(photo(p, 'cand-thumb'));
    var info = el('div', 'cand-info');
    info.appendChild(el('h3', 'cand-name', cleanName(p.name)));
    var meta = el('p', 'cand-meta');
    meta.appendChild(el('strong', 'cand-price', priceLine(p)));
    if (p.category) meta.appendChild(el('span', 'cand-shop', p.category));
    info.appendChild(meta);
    if (p.reason) info.appendChild(el('p', 'hint', '理由：' + p.reason));
    top.appendChild(info);
    card.appendChild(top);
    if (p.pitch) { var dd = el('details'); dd.appendChild(el('summary', null, 'プレゼンを見る')); dd.appendChild(el('p', 'pitch-bubble', p.pitch)); if (p.caution) dd.appendChild(el('p', 'hint', '注意点：' + p.caution)); card.appendChild(dd); }
    var row = el('div', 'pitch-row');
    if (p.url) row.appendChild(linkBtn('楽天の商品ページ', p.url));
    actions.forEach(function (a) { row.appendChild(a); });
    card.appendChild(row);
    return card;
  }

  function renderTaste(list) {
    list.appendChild(el('p', 'editor-note', 'バイヤーの今の読み取り：' + (S.tasteNote() || 'まだありません（判断が増えると更新されます）')));
    list.appendChild(el('p', 'hint', '「黒が好き」「高級品が好き」のように決めつけず、採用・不採用の理由から読み取ります。理由を一言でも書くと、次の発掘の精度が上がります。'));
    var gs = S.genreStats();
    if (gs.recent.length) {
      list.appendChild(el('p', 'field-label', '直近のプレゼンのジャンル（出した順）'));
      list.appendChild(el('p', 'hint', gs.recent.join(' → ')));
      list.appendChild(el('p', 'field-label', 'ジャンルごとの採用率（商品の選び方の改善に使います。採用の多いジャンルばかり出すことはしません）'));
      var ug = el('ul', 'angle-list');
      Object.keys(gs.byMajor).forEach(function (g) { var b = gs.byMajor[g]; ug.appendChild(el('li', null, g + '：出した' + b.shown + '件・判断' + b.decided + '件・採用' + b.adopt + '件' + (b.decided ? '（' + Math.round(b.adopt * 100 / b.decided) + '%）' : ''))); });
      list.appendChild(ug);
    }
    var t = S.taste().history;
    if (!t.length) { list.appendChild(el('p', 'manage-empty', 'まだ判断した商品はありません。')); return; }
    var ul = el('ul', 'angle-list');
    t.slice(0, 20).forEach(function (h) { ul.appendChild(el('li', null, S.STATUS[h.status] + '：' + cleanName(h.name).slice(0, 30) + (h.reason ? '（' + h.reason + '）' : ''))); });
    list.appendChild(ul);
  }

  // どの投稿セットに使われているか（採用した商品が投稿制作に引き継がれているかを見えるように）
  function usedIn(p) {
    if (!window.DeliveryStore) return '';
    var sets = window.DeliveryStore.all().filter(function (x) { return x.status !== 'rejected' && (x.items || []).some(function (it) { return it.code && it.code === p.code || it.adoptedKey === p.key; }); });
    return sets.length ? '投稿セットに使用中：' + sets.map(function (x) { return '「' + (x.titleEdit || x.title) + '」'; }).join('、') : 'まだ投稿セットに入っていません（次の制作で優先して使います）';
  }

  // 画面は4つ：プレゼン（AI社員の商品プレゼン）／広げる（この商品から広げる）／採用済み／投稿セット（完成品の納品）
  var MAIN_KEY = 'room-pitch-main';
  var main = 'present';
  try { main = localStorage.getItem(MAIN_KEY) || 'present'; } catch (e) {}
  if (main === 'adopt') main = 'adopted';
  function show(m) { main = m; try { localStorage.setItem(MAIN_KEY, m); } catch (e) {} if (location.hash.indexOf('#pitch') !== 0) location.hash = '#pitch'; else render(); }

  function render(showLegacy) {
    if (showLegacy === true) { main = 'present'; tab = 'deck'; }
    body.innerHTML = '';
    var counts = { adopt: S.list('adopt').length, hold: S.list('hold').length, reject: S.list('reject').length };
    var nav = el('div', 'pitch-main-tabs');
    [['present', 'プレゼン'], ['explore', '広げる'], ['adopted', '採用済み（' + counts.adopt + '）'], ['sets', '投稿セット']].forEach(function (t) {
      nav.appendChild(btn(t[1], 'pitch-main-tab' + (main === t[0] ? ' active' : ''), function () { show(t[0]); }));
    });
    body.appendChild(nav);
    var area = el('div');
    body.appendChild(area);
    if (main === 'explore' && window.ExploreView) { window.ExploreView.render(area); return; }
    if (main === 'sets' && window.DeliveryView) { window.DeliveryView.render(area); return; }
    if (main === 'adopted') {
      area.appendChild(el('p', 'editor-note', '「いいじゃん！」で採用した商品です（このiPhoneに保存）。投稿セットを作るとき、まだ使っていない採用商品を優先して使います。ROOMへの登録は社長が投稿画面で行います。'));
      var items = S.list('adopt');
      if (!items.length) { area.appendChild(el('p', 'manage-empty', 'まだ採用した商品はありません。')); return; }
      items.forEach(function (p) { area.appendChild(adoptCard(p)); });
      return;
    }
    // プレゼン：1商品ずつ。保留・違うな・好みメモは下の小さな切り替えで
    if (tab === 'adopt') tab = 'deck';
    var sub = el('div', 'pitch-row pitch-sub');
    [['deck', 'プレゼン（' + S.queue().length + '）'], ['hold', '保留（' + counts.hold + '）'], ['reject', '違うな（' + counts.reject + '）'], ['taste', '好みメモ']].forEach(function (t) {
      sub.appendChild(btn(t[1], 'link-btn' + (tab === t[0] ? ' active' : ''), function () { tab = t[0]; try { localStorage.setItem(TAB_KEY, tab); } catch (e) {} render(); }));
    });
    area.appendChild(sub);
    if (lastNotice) area.appendChild(el('p', 'hint', lastNotice));
    var list = el('div', 'buyer-list');
    area.appendChild(list);
    if (tab === 'deck') return renderDeck(list);
    if (tab === 'taste') return renderTaste(list);
    var xs = S.list(tab);
    if (!xs.length) { list.appendChild(el('p', 'manage-empty', 'まだありません。')); return; }
    xs.forEach(function (p) {
      if (tab === 'hold') list.appendChild(smallCard(p, [btn('いいじゃん！', 'btn btn-primary', function () { adopt(p, false); }), btn('この商品から広げる', 'status-btn', function () { widen(p); }), btn('違うな', 'status-btn', function () { var r = ask('どこが違った？'); if (r === null) return; S.decide(p.key, 'reject', r); render(); })]));
      else list.appendChild(smallCard(p, [btn('やっぱり保留', 'status-btn', function () { S.decide(p.key, 'hold', p.reason); render(); })]));
    });
  }

  // ほかの画面（商品ドロボー）から商品を受け取る。status があれば判断も記録し、いいじゃん！なら紹介文を作る
  function addExternal(item, status) {
    if (!S.addMany([item])) return '';
    var key = item.key || item.code;
    if (status) {
      S.decide(key, status, '');
      if (status === 'adopt') makeIntro(S.get(key));
    }
    return key;
  }

  window.PitchView = { render: render, addExternal: addExternal, show: show, makeIntro: makeIntro };
  if (!document.getElementById('view-pitch').hidden) render(); // 最初の画面（#pitch か、何も指定がないとき）
})();
