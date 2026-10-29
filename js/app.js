(function () {
  'use strict';

  // 更新の直後、古い画面（index.html）と新しいプログラムが混ざると、ボタンや一覧が出なくなる。
  // 画面の版（meta app-version）とこのファイルの版が違うときは、最新の画面を1回だけ読み直す
  var APP_VERSION = '2026-10-29.7';
  var pageVersion = (document.querySelector('meta[name="app-version"]') || {}).content || '';
  if (pageVersion !== APP_VERSION) {
    var triedFor = '';
    try { triedFor = sessionStorage.getItem('room-reload-for') || ''; } catch (e) {}
    if (triedFor !== APP_VERSION) {
      try { sessionStorage.setItem('room-reload-for', APP_VERSION); } catch (e) {}
      location.replace(location.pathname + '?v=' + encodeURIComponent(APP_VERSION) + location.hash);
      return;
    }
  } else if (/[?&]v=/.test(location.search) && window.history && history.replaceState) {
    history.replaceState(null, '', location.pathname + location.hash); // 読み直し用の ?v= はアドレスから消す
  }

  var PASS_KEY = 'room-passcode';
  var STATS_KEY = 'room-genre-stats';
  var RECENT_KEY = 'room-recent-items';
  var LAST_KEY = 'room-last-result';
  var MAX_RECENT = 20;
  var MAX_POST_ITEMS = 20; // 1投稿にまとめられる商品数（js/carousel-layout.js と同じ）
  var discoverBtn = document.getElementById('discover-btn');
  var searchBtn = document.getElementById('search-btn');
  var genreSelect = document.getElementById('genre-select');
  var freeText = document.getElementById('free-text');
  var COND_KEY = 'room-conditions';
  var PLACEHOLDERS = ['例：30代男性へのプレゼント、1万円以下', '例：北欧っぽい白い食器', '例：仕事でも使いやすい香水', '例：旅行が楽になるもの', '例：最近流行ってる安いもの'];
  var loading = document.getElementById('loading');
  var loadingText = document.getElementById('loading-text');
  var ideasBtn = document.getElementById('ideas-btn');
  var message = document.getElementById('message');
  var genreEl = document.getElementById('genre');
  var results = document.getElementById('results');
  var toast = document.getElementById('toast');
  var resetBtn = document.getElementById('reset-passcode');
  var toastTimer = null;

  function getPass() {
    try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; }
  }
  function setPass(v) {
    try { if (v) localStorage.setItem(PASS_KEY, v); else localStorage.removeItem(PASS_KEY); } catch (e) {}
  }

  // ジャンルごとの反応（表示・クリック・コピー）をこの端末に記録し、
  // 次回以降、反応の良いジャンルを少し優先して選んでもらう
  function loadStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch (e) { return {}; }
  }
  function recordStat(genreId, action) {
    if (!genreId) return;
    var stats = loadStats();
    var s = stats[genreId] || (stats[genreId] = {});
    s[action] = (s[action] || 0) + 1;
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  // 最近表示した商品名を覚えておき、似た商品ばかりにならないようにする
  function loadRecent() {
    try {
      var list = JSON.parse(localStorage.getItem(RECENT_KEY));
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function rememberProducts(products) {
    var names = products.map(function (p) { return String(p.name).slice(0, 60); });
    var list = names.concat(loadRecent()).slice(0, MAX_RECENT);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function showMessage(text, isError, detail) {
    message.textContent = text;
    message.className = 'message' + (isError ? ' error' : '');
    if (detail) {
      var d = document.createElement('span');
      d.className = 'detail';
      d.textContent = detail;
      message.appendChild(d);
    }
    message.hidden = false;
  }

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 1800);
  }

  function formatPrice(n) {
    return Number(n).toLocaleString('ja-JP') + '円';
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  // 楽天ROOMの「この商品を投稿する」画面のURL（itemCode は「ショップ:商品番号」の形）
  function roomUrl(code) {
    return 'https://room.rakuten.co.jp/mix?itemcode=' + encodeURIComponent(code).replace(/%3A/gi, ':') + '&scid=we_room_upc60';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function copyButton(label, getText, onCopied, toastText) {
    var btn = el('button', 'btn btn-secondary', label);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      copyText(getText()).then(function () {
        if (onCopied) onCopied();
        btn.textContent = 'コピーしました';
        btn.classList.add('done');
        showToast(toastText || label.replace('をコピー', '') + 'をコピーしました');
        setTimeout(function () {
          btn.textContent = label;
          btn.classList.remove('done');
        }, 2000);
      }, function () {
        showToast('コピーできませんでした。文章を長押しして選択してください');
      });
    });
    return btn;
  }

  // 文字を入れる欄に「クリア」を付ける（前の内容は残しておき、全部消したいときは1回で消せる）
  function addClear(input) {
    var label = input.parentNode && input.parentNode.querySelector('.field-label');
    if (!label || label.querySelector('.clear-btn')) return;
    var btn = el('button', 'clear-btn', 'クリア');
    btn.type = 'button';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      input.value = '';
      // 保存や画面の更新は、ふだんの入力と同じ仕組みで動かす
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    });
    label.appendChild(btn);
  }

  function addSection(card, label, text, className) {
    if (!text) return;
    card.appendChild(el('p', 'label', label));
    card.appendChild(el('p', className || 'reason', text));
  }

  // opts.genreId: 発掘モードのジャンル記録用
  function renderCard(p, opts) {
    opts = opts || {};
    var card = el('article', 'card');
    if (p.role || p.giftClass || p.basis || p.side || p.brand) {
      var chips = el('div', 'chips');
      if (p.brand) chips.appendChild(el('span', 'brand-chip', p.brand));
      if (p.side) chips.appendChild(el('span', 'side ' + (p.side === '本命' ? 'side-main' : 'side-alt'), p.side));
      if (p.role) chips.appendChild(el('span', 'role', p.role));
      if (p.giftClass) chips.appendChild(el('span', 'gift-class', p.giftClass));
      if (p.basis) chips.appendChild(el('span', 'basis' + (p.basis === 'トレンド枠' ? ' trend' : ''), p.basis));
      card.appendChild(chips);
    }

    var top = el('div', 'card-top');
    if (p.image) {
      var img = el('img', 'thumb');
      img.src = p.image;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () { img.remove(); };
      top.appendChild(img);
    }
    var info = el('div');
    info.appendChild(el('h2', 'card-title', p.name));
    info.appendChild(el('p', 'price', formatPrice(p.price)));
    top.appendChild(info);
    card.appendChild(top);

    if (p.pick) card.appendChild(el('p', 'pick-line', p.pick));
    addSection(card, '選定理由', p.reason);
    if (p.memo) {
      var memoBox = el('div', 'memo-box');
      memoBox.appendChild(el('b', null, 'くまの一言メモ'));
      memoBox.appendChild(document.createTextNode(p.memo));
      card.appendChild(memoBox);
    }
    addSection(card, 'ROOM紹介文', p.intro, 'intro');
    card.appendChild(el('p', 'count', p.intro.length + '字'));

    var actions = el('div', 'actions');
    // 「これ良いかも」と思った商品を起点に、Instagram企画を考える
    if (opts.onSeed) {
      var seedBtn = el('button', 'btn btn-seed', 'この商品から企画を考える');
      seedBtn.type = 'button';
      seedBtn.addEventListener('click', function () { opts.onSeed(p); });
      actions.appendChild(seedBtn);
      if (isFashion(p.name)) actions.appendChild(coordButton(function () { return p; }));
    }
    // ROOMの投稿画面を直接開く（ROOMアプリが入っていればアプリで開くことがある）。
    // 押した瞬間に紹介文もコピーしておくので、投稿画面で貼り付けるだけで済む
    if (p.code) {
      var room = el('a', 'btn btn-primary', '紹介文をコピーしてROOMに投稿');
      room.href = roomUrl(p.code);
      room.target = '_blank';
      room.rel = 'noopener';
      room.addEventListener('click', function () {
        // 画面を移る前に確実にコピーするため、同期的にコピーできる方法を使う
        legacyCopy(p.intro).then(function () { showToast('紹介文をコピーしました。ROOMで貼り付けてください'); }, function () {});
        recordStat(opts.genreId, 'copied');
      });
      actions.appendChild(room);
    }

    var link = el('a', 'btn btn-secondary', '楽天で商品を見る');
    link.href = p.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.addEventListener('click', function () { recordStat(opts.genreId, 'clicked'); });
    actions.appendChild(link);
    actions.appendChild(copyButton('紹介文をコピー', function () { return p.intro; }, function () {
      recordStat(opts.genreId, 'copied');
    }));
    card.appendChild(actions);
    card.appendChild(statusBox(p));
    return card;
  }

  // ---- 投稿状態（ROOM・Instagram）の管理 ----
  var Store = window.ProductStore;
  var STATUS_BUTTONS = [
    { id: 'room_candidate', label: 'ROOM候補にする' },
    { id: 'room_posted', label: 'ROOMに入れた' },
    { id: 'ig_waiting', label: 'Instagram投稿待ち' },
    { id: 'ig_posted', label: 'Instagram投稿済み' }
  ];

  // 状態ボタン一式。押すとその状態に、もう一度押すと「未選択」に戻る
  function statusBox(p, onChange) {
    var box = el('div', 'status-box');
    var now = el('p', 'status-now');
    var grid = el('div', 'status-buttons');
    var buttons = {};
    box.appendChild(now);
    box.appendChild(grid);

    function show(status) {
      now.innerHTML = '';
      now.appendChild(document.createTextNode('投稿管理：'));
      now.appendChild(el('strong', null, Store.statusLabel(status)));
      STATUS_BUTTONS.forEach(function (b) {
        var on = b.id === status;
        buttons[b.id].classList.toggle('active', on);
        buttons[b.id].setAttribute('aria-pressed', on ? 'true' : 'false');
        buttons[b.id].textContent = (on ? '✓ ' : '') + b.label;
      });
    }

    STATUS_BUTTONS.forEach(function (b) {
      var btn = el('button', 'status-btn', b.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var next = btn.classList.contains('active') ? 'none' : b.id;
        Store.setStatus(p, next).then(function (status) {
          show(status);
          updateManageCount();
          showToast(status === 'none' ? '未選択に戻しました' : '「' + Store.statusLabel(status) + '」にしました');
          if (onChange) onChange(status);
        }, function () {
          showToast('保存できませんでした');
        });
      });
      buttons[b.id] = btn;
      grid.appendChild(btn);
    });

    show('none');
    Store.getStatus(p).then(show);
    return box;
  }

  // 投稿管理の画面
  var manageView = document.getElementById('view-manage');
  var discoverView = document.getElementById('view-discover');
  var manageList = document.getElementById('manage-list');
  var manageEmpty = document.getElementById('manage-empty');
  var statusTabs = document.getElementById('status-tabs');
  var manageCount = document.getElementById('manage-count');
  var igBar = document.getElementById('ig-bar');
  var igSelectedText = document.getElementById('ig-selected');
  var igCopy = document.getElementById('ig-copy');
  var igDone = document.getElementById('ig-done');
  var igCreate = document.getElementById('ig-create');
  var MANAGE_TABS = ['room_candidate', 'room_posted', 'ig_waiting', 'ig_posted'];
  var TAB_LABELS = { history: '投稿履歴' };
  var currentTab = 'room_candidate';
  var igSelected = {}; // Instagram用にチェックした商品（id → 商品）
  var PICK_TABS = ['ig_waiting', 'room_posted']; // チェックして選べるタブ

  function updateManageCount() {
    Store.counts().then(function (c) {
      var total = MANAGE_TABS.reduce(function (sum, s) { return sum + (c[s] || 0); }, 0);
      manageCount.textContent = total ? '(' + total + ')' : '';
    });
  }

  function renderStatusTabs(counts) {
    statusTabs.innerHTML = '';
    MANAGE_TABS.concat(['history']).forEach(function (s) {
      var text = s === 'history' ? TAB_LABELS.history : Store.statusLabel(s) + '（' + (counts[s] || 0) + '）';
      var tab = el('button', 'status-tab' + (s === currentTab ? ' active' : ''), text);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', s === currentTab ? 'true' : 'false');
      tab.addEventListener('click', function () {
        currentTab = s;
        renderManage();
      });
      statusTabs.appendChild(tab);
    });
  }

  function selectedList() {
    return Object.keys(igSelected).map(function (k) { return igSelected[k]; });
  }

  function updateIgBar() {
    var n = selectedList().length;
    igSelectedText.textContent = n + '件選択中' + (n ? '' : '（Instagramにまとめたい商品にチェック）');
    igCopy.disabled = n === 0;
    igDone.disabled = n === 0;
    igCreate.disabled = n === 0;
  }

  function manageCard(item) {
    var card = el('article', 'card manage-card');
    if (PICK_TABS.indexOf(currentTab) !== -1) {
      var pick = el('label', 'pick');
      var box = el('input');
      box.type = 'checkbox';
      box.checked = !!igSelected[item.id];
      card.classList.toggle('selected', box.checked);
      box.addEventListener('change', function () {
        if (box.checked) igSelected[item.id] = item; else delete igSelected[item.id];
        card.classList.toggle('selected', box.checked);
        updateIgBar();
      });
      pick.appendChild(box);
      pick.appendChild(document.createTextNode('Instagram投稿に使う'));
      card.appendChild(pick);
    }

    var top = el('div', 'card-top');
    if (item.image) {
      var img = el('img', 'thumb');
      img.src = item.image;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () { img.remove(); };
      top.appendChild(img);
    }
    var info = el('div');
    info.appendChild(el('h2', 'card-title', item.name));
    info.appendChild(el('p', 'price', formatPrice(item.price)));
    top.appendChild(info);
    card.appendChild(top);

    var actions = el('div', 'actions');
    if (item.code && item.intro) {
      var room = el('a', 'btn btn-primary', '紹介文をコピーしてROOMに投稿');
      room.href = roomUrl(item.code);
      room.target = '_blank';
      room.rel = 'noopener';
      room.addEventListener('click', function () {
        legacyCopy(item.intro).then(function () { showToast('紹介文をコピーしました。ROOMで貼り付けてください'); }, function () {});
      });
      actions.appendChild(room);
    }
    var link = el('a', 'btn btn-secondary', '楽天で商品を見る');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    actions.appendChild(link);
    card.appendChild(actions);

    // 状態を変えたら、その商品は別のタブへ移るので一覧を描き直す
    card.appendChild(statusBox(item, function (status) {
      if (PICK_TABS.indexOf(status) === -1) delete igSelected[item.id];
      renderManage();
    }));
    return card;
  }

  function historyDate(t) {
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function renderHistory() {
    History.list().then(function (posts) {
      manageList.innerHTML = '';
      posts.forEach(function (h) {
        var card = el('article', 'history-card');
        card.appendChild(el('p', 'history-status', History.STATUS_LABELS[h.status] || h.status));
        card.appendChild(el('p', 'history-title', h.title || h.topic));
        card.appendChild(el('p', 'history-meta', [historyDate(h.createdAt), h.postType, h.genre, h.target, h.priceBand].filter(Boolean).join('｜')));
        card.appendChild(el('p', 'history-assets', statusLine(h)));
        if (h.brands && h.brands.length) card.appendChild(el('p', 'history-meta', 'ブランド：' + h.brands.join('・')));
        if (h.products && h.products.length) card.appendChild(el('p', 'history-meta', '商品：' + h.products.map(function (x) { return x.name.slice(0, 18); }).join(' / ')));
        if (h.products && h.products.length && h.products[0].url) {
          var roomDoneCount = h.products.filter(function (x) { return (h.roomDone || {})[x.id]; }).length;
          card.appendChild(el('p', 'history-meta', 'ROOM登録 ' + progressBar(roomDoneCount, h.products.length) + ' ' + roomDoneCount + '/' + h.products.length +
            (h.collectionName ? '｜コレクション「' + h.collectionName + '」' + (h.collectionDone ? '登録済み' : '未登録') : '')));
        }
        var actions = el('div', 'plan-actions');
        if (h.products && h.products.length && h.products[0].url) {
          var assetsLink = el('a', 'link-btn', h.reelDone && h.storyDone ? 'Reel・Storyを見る' : 'Reel・Storyを作る');
          assetsLink.href = '#assets:' + h.id;
          actions.appendChild(assetsLink);
          var roomLink = el('a', 'link-btn', 'ROOM登録準備を開く');
          roomLink.href = '#room:' + h.id;
          actions.appendChild(roomLink);
        }
        if (h.status !== 'posted') {
          var done = el('button', 'link-btn', 'Instagram投稿済みにする');
          done.type = 'button';
          done.addEventListener('click', function () { History.update(h.id, { status: 'posted' }).then(renderHistory); });
          actions.appendChild(done);
        }
        var del = el('button', 'link-btn', '履歴から消す');
        del.type = 'button';
        del.addEventListener('click', function () {
          if (window.confirm('この履歴を消しますか？')) History.remove(h.id).then(renderHistory);
        });
        actions.appendChild(del);
        card.appendChild(actions);
        manageList.appendChild(card);
      });
      manageEmpty.hidden = posts.length > 0;
      manageEmpty.textContent = 'まだ投稿履歴はありません。「今日の企画を考える」で企画を選ぶと記録されます。';
    });
  }

  function renderManage() {
    Store.counts().then(renderStatusTabs);
    igBar.hidden = PICK_TABS.indexOf(currentTab) === -1;
    if (currentTab === 'history') { renderHistory(); return; }
    Store.list(currentTab).then(function (items) {
      manageList.innerHTML = '';
      // 他のタブへ移った商品は選択から外す
      Object.keys(igSelected).forEach(function (id) {
        if (PICK_TABS.indexOf(igSelected[id].status) === -1) delete igSelected[id];
      });
      items.forEach(function (item) { manageList.appendChild(manageCard(item)); });
      manageEmpty.hidden = items.length > 0;
      manageEmpty.textContent = '「' + Store.statusLabel(currentTab) + '」の商品はまだありません。商品発掘の画面で、各商品の下のボタンから追加できます。';
      updateIgBar();
    });
  }

  // 選んだ商品の一覧文（今はコピー用。次の段階でInstagram投稿の自動生成に使う）
  function igListText(list) {
    var marks = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
    return list.map(function (p, i) {
      var head = (marks[i] || '・') + ' ' + (p.role ? p.role + '：' : '') + p.name.replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 40) + '（' + formatPrice(p.price) + '）';
      var why = p.reason || p.why;
      return why ? head + '\n・' + why : head;
    }).join('\n\n');
  }

  igCopy.addEventListener('click', function () {
    copyText(igListText(selectedList())).then(function () { showToast(selectedList().length + '商品分をコピーしました'); }, function () {
      showToast('コピーできませんでした');
    });
  });
  igDone.addEventListener('click', function () {
    var list = selectedList();
    Promise.all(list.map(function (item) { return Store.setStatus(item, 'ig_posted'); })).then(function () {
      igSelected = {};
      showToast(list.length + '商品を「Instagram投稿済み」にしました');
      updateManageCount();
      renderManage();
    });
  });

  // 画面の切り替え（#manage で投稿管理）
  function showView() {
    // #manage:ig_waiting のように、開くタブも指定できる
    var parts = location.hash.split(':');
    var view = parts[0] === '#manage' ? 'manage' : parts[0] === '#compose' ? 'compose' : parts[0] === '#room' ? 'room' : parts[0] === '#assets' ? 'assets' : 'discover';
    roomView.hidden = view !== 'room';
    if (view === 'room') renderRoom(parts[1] || draft.postId);
    assetsView.hidden = view !== 'assets';
    if (view === 'assets') renderAssetsView(parts[1] || draft.postId);
    if (view === 'manage' && parts[1] && (MANAGE_TABS.indexOf(parts[1]) !== -1 || parts[1] === 'history')) currentTab = parts[1];
    manageView.hidden = view !== 'manage';
    discoverView.hidden = view !== 'discover';
    composeView.hidden = view !== 'compose';
    Array.prototype.forEach.call(document.querySelectorAll('.view-tab'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === (view === 'compose' || view === 'room' || view === 'assets' ? 'manage' : view));
    });
    if (view === 'manage') renderManage();
    if (view === 'compose') renderCompose();
    window.scrollTo(0, 0);
  }

  // ---- Reel・Story（同じ企画・同じ商品から、役割を変えて展開する） ----
  var assetsView = document.getElementById('view-assets');
  var assetsTitle = document.getElementById('assets-title');
  var assetsStatus = document.getElementById('assets-status');
  var assetsBody = document.getElementById('assets-body');

  function canvasImg(canvas, alt) {
    var img = el('img');
    img.src = canvas.toDataURL('image/png');
    img.alt = alt || '';
    return img;
  }

  // 何枚かのファイルを、iPhoneでは共有シート（写真に保存）、それ以外はダウンロードで保存する
  function saveFiles(files) {
    var list = files.map(function (f) { return new File([f.blob], f.name, { type: f.blob.type || 'image/png' }); });
    if (navigator.canShare && navigator.canShare({ files: list })) {
      navigator.share({ files: list }).catch(function () {});
    } else {
      files.forEach(function (f) { downloadBlob(f.blob, f.name); });
    }
  }

  function canvasesToFiles(slides) {
    return Promise.all(slides.map(function (s) { return canvasToBlob(s.canvas); })).then(function (blobs) {
      return slides.map(function (s, i) { return { name: s.fileName, blob: blobs[i] }; });
    });
  }

  function reelScriptText(reel, items) {
    var lines = ['タイトル：' + reel.title, '冒頭フック：' + reel.hook, '長さ：約' + reel.seconds + '秒', ''];
    reel.scenes.forEach(function (s) {
      var it = s.type === 'item' ? items[s.item] : null;
      lines.push(s.start + '〜' + s.end + '秒' + (it ? '　商品：' + (it.shortName || it.name) : ''));
      lines.push('テロップ：「' + s.text + '」');
      if (s.narration) lines.push('ナレーション：' + s.narration);
      lines.push('');
    });
    lines.push('最後の呼びかけ：' + reel.cta);
    return lines.join('\n');
  }

  // o: { style, items: [{ shortName, name, price }], images: [商品画像（itemsと同じ順）], bear }
  function reelSection(reel, o) {
    var box = el('section', 'asset-box');
    box.appendChild(el('h4', 'asset-head', 'Reel（約' + reel.seconds + '秒）'));
    var dl = el('dl', 'idea-facts');
    [['タイトル', reel.title], ['冒頭フック', reel.hook], ['最後の呼びかけ', reel.cta]].forEach(function (f) {
      dl.appendChild(el('dt', null, f[0]));
      dl.appendChild(el('dd', null, f[1]));
    });
    box.appendChild(dl);
    // タイムライン（秒・テロップ・商品）
    var table = el('table', 'timeline');
    var head = el('tr');
    ['秒', 'テロップ', '商品'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    table.appendChild(head);
    reel.scenes.forEach(function (s) {
      var tr = el('tr');
      tr.appendChild(el('td', 'tl-sec', s.start + '〜' + s.end));
      tr.appendChild(el('td', null, s.text));
      var it = s.type === 'item' ? o.items[s.item] : null;
      tr.appendChild(el('td', 'tl-item', it ? (it.shortName || it.name).slice(0, 16) : s.type === 'hook' ? 'フック' : '呼びかけ'));
      table.appendChild(tr);
    });
    box.appendChild(table);
    // シーンの静止画
    var frames = window.ReelStory.renderReelFrames(reel, o);
    var strip = el('div', 'asset-strip');
    frames.forEach(function (fr) { strip.appendChild(canvasImg(fr.canvas, fr.fileName)); });
    box.appendChild(strip);
    box.appendChild(el('p', 'label', 'ナレーション文'));
    var narr = el('textarea', 'textarea');
    narr.rows = 5;
    narr.value = reel.narration;
    box.appendChild(narr);
    var actions = el('div', 'actions');
    actions.appendChild(copyButton('ナレーション文をコピー', function () { return narr.value; }));
    actions.appendChild(copyButton('台本をまとめてコピー', function () { return reelScriptText(reel, o.items); }));
    var video = el('button', 'btn btn-primary', '動画を書き出す（約' + reel.seconds + '秒かかります）');
    video.type = 'button';
    var out = el('div', 'asset-video');
    video.addEventListener('click', function () {
      video.disabled = true;
      window.ReelStory.exportVideo(reel, o, function (p) { video.textContent = '書き出し中… ' + Math.round(p * 100) + '%'; }).then(function (blob) {
        var ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
        out.innerHTML = '';
        var v = el('video');
        v.src = URL.createObjectURL(blob);
        v.controls = true;
        v.playsInline = true;
        v.muted = true;
        out.appendChild(v);
        var save = el('button', 'btn btn-secondary', '動画を保存（' + ext.toUpperCase() + '）');
        save.type = 'button';
        save.addEventListener('click', function () { saveFiles([{ name: 'reel.' + ext, blob: blob }]); });
        out.appendChild(save);
        if (ext !== 'mp4') out.appendChild(el('p', 'hint', 'このブラウザではWebM形式になりました。iPhoneのSafariで書き出すとMP4になります。'));
      }, function (e) {
        out.innerHTML = '';
        out.appendChild(el('p', 'hint', (e && e.message) || '動画を書き出せませんでした。シーン画像を保存して、編集アプリでつなげてください。'));
      }).then(function () {
        video.disabled = false;
        video.textContent = '動画を書き出す（約' + reel.seconds + '秒かかります）';
      });
    });
    actions.appendChild(video);
    var stills = el('button', 'btn btn-secondary', 'シーン画像を保存');
    stills.type = 'button';
    stills.addEventListener('click', function () { canvasesToFiles(frames).then(saveFiles); });
    actions.appendChild(stills);
    box.appendChild(actions);
    box.appendChild(out);
    box.appendChild(el('p', 'hint', 'ナレーションは文字だけです。読み上げるか、テロップだけで使ってください。動きはフェード・スライド・軽いズームだけにしています。'));
    return box;
  }

  function storySection(story, o) {
    var box = el('section', 'asset-box');
    box.appendChild(el('h4', 'asset-head', 'Story（3枚）'));
    var slides = window.ReelStory.renderStory(story, o);
    var strip = el('div', 'asset-strip');
    slides.forEach(function (s) { strip.appendChild(canvasImg(s.canvas, s.fileName)); });
    box.appendChild(strip);
    var actions = el('div', 'actions');
    var save = el('button', 'btn btn-primary', 'Storyを写真に保存（3枚）');
    save.type = 'button';
    save.addEventListener('click', function () { canvasesToFiles(slides).then(saveFiles); });
    actions.appendChild(save);
    box.appendChild(actions);
    box.appendChild(el('p', 'hint', '1枚目で興味を引く → 2枚目で選び方を少し見せる → 3枚目で最新投稿へ。上下の端はInstagramのボタンと重なるので、大事な文字は中央に置いています。'));
    return box;
  }

  // Reel・Story の文字を作って履歴に保存する。only: 'reel' / 'story' を指定すると、まだ作っていない方だけ保存する
  function requestAssets(rec, only) {
    return postJson('api/assets', {
      theme: rec.topic, title: rec.title, criteria: rec.criteria || [],
      items: (rec.products || []).map(function (p) { return { name: p.name, shortName: p.shortName, price: p.price, role: p.role }; })
    }).then(function (r) {
      if (r.status !== 200) throw new Error(r.data.error || 'Reel・Storyを作れませんでした');
      var patch = {};
      if (only !== 'story') { patch.reel = r.data.reel; patch.reelDone = true; }
      if (only !== 'reel') { patch.story = r.data.story; patch.storyDone = true; }
      return History.update(rec.id, patch).then(function () { return { patch: patch, notice: r.data.notice }; });
    });
  }

  // 投稿の商品画像とくまを読み込んで、Reel・Story を描くための材料をそろえる
  function assetMaterials(rec) {
    var products = rec.products || [];
    return Promise.all([
      Promise.all(products.map(function (p) { return loadProductImage(p.image); })),
      window.IgRender.loadImage(BEAR_SRC).catch(function () { return null; })
    ]).then(function (r) {
      return { style: rec.series || 'serious_think', items: products, images: r[0], bear: r[1] };
    });
  }

  function statusLine(rec) {
    var mark = function (on) { return on ? '✓' : '未生成'; };
    return 'カルーセル ' + mark(rec.carouselDone || rec.status === 'generated' || rec.status === 'posted') + '　Reel ' + mark(rec.reelDone) + '　Story ' + mark(rec.storyDone) +
      '　Instagram ' + (rec.status === 'posted' ? '投稿済み' : '未投稿');
  }

  // 画像づくりのあと、同じ投稿のReel・Storyを続けて作って表示する
  function buildAssetsAfterCarousel(postId, mats) {
    var box = document.getElementById('ig-assets');
    box.innerHTML = '';
    var wait = el('div', 'loading');
    wait.appendChild(el('div', 'spinner'));
    var t = el('p');
    t.innerHTML = 'Reel・Storyを作っています…<br><span class="sub">10〜30秒ほどかかります</span>';
    wait.appendChild(t);
    box.appendChild(wait);
    History.get(postId).then(function (rec) {
      return requestAssets(rec).then(function (res) {
        box.innerHTML = '';
        if (res.notice) box.appendChild(el('p', 'hint', res.notice));
        box.appendChild(reelSection(res.patch.reel, mats));
        box.appendChild(storySection(res.patch.story, mats));
      });
    }).catch(function (e) {
      box.innerHTML = '';
      box.appendChild(el('p', 'message error', (e && e.message) || 'Reel・Storyを作れませんでした。'));
      var link = el('a', 'link-btn', '投稿履歴からもう一度作る');
      link.href = '#assets:' + postId;
      box.appendChild(link);
    });
  }

  // 投稿履歴から開く画面：作ったものは表示し、まだ作っていないものだけ作れる
  function renderAssetsView(id) {
    assetsBody.innerHTML = '';
    assetsStatus.textContent = '';
    History.get(id).then(function (rec) {
      if (!rec) { assetsTitle.textContent = 'この投稿は見つかりませんでした。'; return; }
      assetsTitle.textContent = rec.title || rec.topic;
      assetsStatus.textContent = statusLine(rec);
      if (!(rec.products || []).length || !rec.products[0].url) {
        assetsBody.appendChild(el('p', 'hint', 'まだ商品が決まっていません。商品を選んで「投稿素材をまとめて作る」を押すと、カルーセル・Reel・Storyをまとめて作れます。'));
        return;
      }
      assetMaterials(rec).then(function (mats) {
        function draw(r) {
          assetsBody.innerHTML = '';
          assetsStatus.textContent = statusLine(r);
          if (r.reel) assetsBody.appendChild(reelSection(r.reel, mats));
          if (r.story) assetsBody.appendChild(storySection(r.story, mats));
          var missing = !r.reel && !r.story ? 'both' : !r.reel ? 'reel' : !r.story ? 'story' : '';
          if (!missing) return;
          var btn = el('button', 'btn btn-discover', missing === 'both' ? 'Reel・Storyを作る' : missing === 'reel' ? 'Reelを作る（未生成）' : 'Storyを作る（未生成）');
          btn.type = 'button';
          var note = el('p', 'hint', '');
          btn.addEventListener('click', function () {
            btn.disabled = true;
            btn.textContent = '作っています…（10〜30秒）';
            requestAssets(r, missing === 'both' ? null : missing).then(function (res) {
              return History.get(id).then(function (latest) {
                draw(latest);
                if (res.notice) showToast(res.notice);
              });
            }, function (e) {
              btn.disabled = false;
              btn.textContent = 'もう一度作る';
              note.textContent = (e && e.message) || '作れませんでした。もう一度お試しください。';
            });
          });
          assetsBody.appendChild(btn);
          assetsBody.appendChild(note);
        }
        draw(rec);
      });
    });
  }

  // ---- ROOM登録準備（投稿の確定は、ユーザーがROOMで行う） ----
  var roomView = document.getElementById('view-room');
  var roomItems = document.getElementById('room-items');
  var roomColName = document.getElementById('room-col-name');
  var roomColDone = document.getElementById('room-col-done');
  var roomPostId = '';

  function progressBar(done, total) {
    var bar = '';
    for (var i = 0; i < total; i++) bar += i < done ? '■' : '□';
    return bar;
  }

  function renderRoom(id) {
    roomPostId = id || '';
    roomItems.innerHTML = '';
    if (!id) {
      document.getElementById('room-title').textContent = '対象の投稿がありません。Instagram画像を作ってから開いてください。';
      return;
    }
    History.get(id).then(function (rec) {
      if (!rec) { document.getElementById('room-title').textContent = 'この投稿の記録が見つかりませんでした。'; return; }
      var products = rec.products || [];
      var doneMap = rec.roomDone || {};
      var doneCount = products.filter(function (p) { return doneMap[p.id]; }).length;
      document.getElementById('room-title').textContent = rec.title || rec.topic;
      document.getElementById('room-bar').textContent = progressBar(doneCount, products.length);
      document.getElementById('room-count').textContent = doneCount + ' / ' + products.length;
      document.getElementById('room-complete').hidden = !(products.length && doneCount === products.length);
      roomColName.value = rec.collectionName || History.collectionNameFor(rec.topic);
      roomColDone.checked = !!rec.collectionDone;
      roomTagsCommon.textContent = (rec.roomTagsCommon || []).join(' ') || 'まだ作っていません';
      roomTagsBtn.textContent = (rec.roomTagsCommon || []).length ? 'ハッシュタグを作り直す' : 'ハッシュタグを作る';
      // まだ作っていなければ、開いたときに一度だけ作る
      if (!rec.roomTagsCommon && products.length && products.some(function (x) { return x.intro; }) && !roomTagsAuto[id]) {
        roomTagsAuto[id] = true;
        makeRoomTags(id);
      }

      products.forEach(function (p, i) {
        var done = !!doneMap[p.id];
        var card = el('article', 'card room-item' + (done ? ' done' : ''));
        var chips = el('div', 'chips');
        chips.appendChild(el('span', 'side side-main', String(i + 1)));
        if (p.role) chips.appendChild(el('span', 'role', p.role));
        chips.appendChild(el('span', 'room-state' + (done ? ' done' : ''), done ? '✓ ROOM投稿済み' : '未投稿'));
        card.appendChild(chips);
        var top = el('div', 'card-top');
        if (p.image) {
          var img = el('img', 'thumb');
          img.src = p.image;
          img.alt = '';
          img.onerror = function () { img.remove(); };
          top.appendChild(img);
        }
        var info = el('div');
        info.appendChild(el('h2', 'card-title', p.shortName || p.name));
        info.appendChild(el('p', 'price', formatPrice(p.price)));
        top.appendChild(info);
        card.appendChild(top);
        if (p.intro) addSection(card, 'ROOM紹介文', p.intro, 'intro');
        if ((p.roomTags || []).length) addSection(card, 'ハッシュタグ（' + p.roomTags.length + '個）', p.roomTags.join(' '), 'room-tags');

        var actions = el('div', 'actions');
        if (p.code && p.intro) {
          var room = el('a', 'btn btn-primary', 'コピーしてROOMで投稿');
          room.href = roomUrl(p.code);
          room.target = '_blank';
          room.rel = 'noopener';
          room.addEventListener('click', function () {
            legacyCopy(roomPostText(p)).then(function () { showToast((p.roomTags || []).length ? '紹介文とハッシュタグをコピーしました。ROOMで貼り付けて投稿してください' : '紹介文をコピーしました。ROOMで貼り付けて投稿してください'); }, function () {});
          });
          actions.appendChild(room);
        }
        var page = el('a', 'btn btn-secondary', '楽天の商品ページを開く');
        page.href = p.url;
        page.target = '_blank';
        page.rel = 'noopener';
        actions.appendChild(page);
        if (p.intro) actions.appendChild(copyButton('ROOM紹介文をコピー', function () { return p.intro; }));
        if ((p.roomTags || []).length) actions.appendChild(copyButton('ハッシュタグだけコピー', function () { return p.roomTags.join(' '); }));
        var mark = el('button', 'btn ' + (done ? 'btn-secondary' : 'btn-primary'), done ? 'ROOM投稿済みを取り消す' : 'ROOM投稿済みにする');
        mark.type = 'button';
        mark.addEventListener('click', function () {
          mark.disabled = true;
          // 続けて押しても前の記録を消さないよう、押した時点の最新の記録から更新する
          History.get(id).then(function (latest) {
            var map = Object.assign({}, (latest && latest.roomDone) || {});
            if (done) delete map[p.id]; else map[p.id] = true;
            return History.update(id, { roomDone: map });
          }).then(function () {
            // 投稿管理の状態にも反映（Instagram投稿済みのものはそのまま）
            return Store.getStatus(p).then(function (st) {
              if (!done && st !== 'ig_posted') return Store.setStatus(p, 'room_posted');
              if (done && st === 'room_posted') return Store.setStatus(p, 'ig_waiting');
            });
          }).then(function () {
            updateManageCount();
            return History.get(id).then(function (latest) {
              var n = products.filter(function (x) { return ((latest && latest.roomDone) || {})[x.id]; }).length;
              if (!done && n === products.length) showToast('ROOM登録完了。コレクションにまとめましょう');
              renderRoom(id);
            });
          });
        });
        actions.appendChild(mark);
        card.appendChild(actions);
        roomItems.appendChild(card);
      });
    });
  }

  // ---- 楽天ROOM用ハッシュタグ（企画のテーマ → 購入目的 → 商品の用途 の順で決める） ----
  var roomTagsCommon = document.getElementById('room-tags-common');
  var roomTagsBtn = document.getElementById('room-tags-btn');
  var roomTagsNote = document.getElementById('room-tags-note');
  var roomTagsAuto = {};

  function roomPostText(p) {
    return (p.roomTags || []).length ? p.intro + '\n\n' + p.roomTags.join(' ') : p.intro;
  }

  function makeRoomTags(id) {
    roomTagsBtn.disabled = true;
    roomTagsBtn.textContent = 'ハッシュタグを作っています…（10〜30秒）';
    roomTagsNote.textContent = '';
    return History.get(id).then(function (rec) {
      if (!rec) return;
      var products = rec.products || [];
      return postJson('api/room-hashtags', {
        campaignTheme: rec.title || rec.topic,
        campaignType: rec.postType || '',
        targetAudience: rec.target || '',
        priceRange: rec.priceBand || '',
        items: products.map(function (p) {
          return { productName: p.name, productCategory: rec.genre || '', productUseCase: p.role || '', roomDescription: p.intro || '', brand: p.brand || '' };
        })
      }).then(function (r) {
        if (r.status !== 200) throw new Error(r.data.error || 'ハッシュタグを作れませんでした');
        var next = products.map(function (p, i) { return Object.assign({}, p, { roomTags: ((r.data.products || [])[i] || {}).tags || [] }); });
        return History.update(id, { products: next, roomTagsCommon: r.data.common || [] }).then(function () {
          if (r.data.notice) showToast(r.data.notice);
          if (roomPostId === id) renderRoom(id);
        });
      });
    }).catch(function (e) {
      roomTagsNote.textContent = (e && e.message) || 'ハッシュタグを作れませんでした。もう一度お試しください。';
    }).then(function () {
      roomTagsBtn.disabled = false;
    });
  }
  roomTagsBtn.addEventListener('click', function () { if (roomPostId) makeRoomTags(roomPostId); });

  roomColName.addEventListener('change', function () {
    if (roomPostId) History.update(roomPostId, { collectionName: roomColName.value.trim() });
  });
  roomColDone.addEventListener('change', function () {
    if (roomPostId) History.update(roomPostId, { collectionDone: roomColDone.checked });
  });
  document.getElementById('room-col-copy').addEventListener('click', function () {
    copyText(roomColName.value.trim()).then(function () { showToast('コレクション名をコピーしました'); }, function () {});
  });

  // ---- Instagram画像づくり ----
  var composeView = document.getElementById('view-compose');
  var igTheme = document.getElementById('ig-theme');
  var igCategory = document.getElementById('ig-category');
  var igSubtitle = document.getElementById('ig-subtitle');
  var igCta = document.getElementById('ig-cta');
  var igItemsEl = document.getElementById('ig-items');
  var igCount = document.getElementById('ig-count');
  var igGenerate = document.getElementById('ig-generate');
  var igLoading = document.getElementById('ig-loading');
  var igMessage = document.getElementById('ig-message');
  var igResult = document.getElementById('ig-result');
  var igPreview = document.getElementById('ig-preview');
  var DRAFT_KEY = 'room-ig-draft';
  var igCaption = document.getElementById('ig-caption');
  var igCoverStyle = document.getElementById('ig-cover-style');
  var igCoverFields = document.getElementById('ig-cover-fields');
  var igCoverTitle = document.getElementById('ig-cover-title');
  var igCoverAccent = document.getElementById('ig-cover-accent');
  // 表紙のデザイン（シリーズ）の選択肢。おまかせはAIが内容に合うシリーズを選ぶ
  [{ id: 'auto', name: 'おまかせ（AIが内容に合うシリーズを選ぶ）' }].concat(window.IgRender.COVER_STYLES).forEach(function (s) {
    var o = el('option', null, s.name);
    o.value = s.id;
    igCoverStyle.appendChild(o);
  });
  document.getElementById('ig-caption-copy').addEventListener('click', function () {
    copyText(igCaption.value).then(function () { showToast('キャプションをコピーしました'); }, function () { showToast('コピーできませんでした'); });
  });
  var BEAR_SRC = 'assets/kuma.png';
  var igSumOn = document.getElementById('ig-sum-on');
  var igSumFields = document.getElementById('ig-sum-fields');
  var igSumTitle = document.getElementById('ig-sum-title');
  var igSumLead = document.getElementById('ig-sum-lead');
  var igSumVerdict = document.getElementById('ig-sum-verdict');
  function emptySummary() { return { enabled: true, typeName: '', title: '', lead: '', verdict: '' }; }
  var draft = { theme: '', category: '', cta: 'collection', items: [], summary: emptySummary() };
  var lastOutput = null; // { files: [{ name, blob }], folder }

  // 最後のROOM誘導カード：既定は「ROOMの『○○』コレクションにまとめています」（商品の場所が分かるように）
  var colOpt = el('option', null, 'ROOMの「テーマ名」コレクションにまとめています（おすすめ）');
  colOpt.value = 'collection';
  igCta.appendChild(colOpt);
  function collectionCtaMessage(topic) {
    return topic.length <= 10
      ? '今回紹介したものは\nROOMの「' + topic + '」\nコレクションにまとめています'
      : '今回紹介したものは\n楽天ROOMの\n「' + topic + '」\nにまとめています';
  }
  window.IgRender.CTA_MESSAGES.forEach(function (m, i) {
    var o = el('option', null, m.replace(/\n/g, ''));
    o.value = String(i);
    igCta.appendChild(o);
  });

  function loadDraft() {
    try { draft = Object.assign(draft, JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}); } catch (e) {}
  }
  function saveDraft() {
    draft.theme = igTheme.value.trim();
    draft.category = igCategory.value.trim();
    draft.subtitle = igSubtitle.value.trim();
    draft.cta = igCta.value === 'collection' ? 'collection' : Number(igCta.value) || 0;
    draft.coverStyle = igCoverStyle.value || 'serious_think';
    draft.coverTitle = igCoverTitle.value.trim();
    draft.coverAccent = igCoverAccent.value.trim();
    igCoverFields.hidden = draft.coverStyle === 'serious_think';
    draft.summary = Object.assign(draft.summary || emptySummary(), {
      enabled: igSumOn.checked,
      title: igSumTitle.value.trim(),
      lead: igSumLead.value.trim(),
      verdict: igSumVerdict.value.trim()
    });
    igSumFields.hidden = !igSumOn.checked;
    showPlanNote();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
  }

  igCreate.addEventListener('click', function () {
    loadDraft();
    draft.items = selectedList().map(function (x) {
      return { id: x.id, code: x.code, name: x.name, price: x.price, image: x.image, url: x.url, reason: x.reason || x.why || '', intro: x.intro || '', role: x.role || '' };
    });
    draft.summary = emptySummary(); // 商品が変わったので2枚目はAIに作ってもらう
    draft.planId = '';
    draft.coverStyle = 'serious_think'; // 投稿管理から作るときは今までの表紙
    draft.release = null;
    draft.heroProduct = null;
    draft.coord = null;
    draft.layoutSizes = null;
    draft.coverTitle = '';
    draft.coverAccent = '';
    draft.postId = '';
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    location.hash = '#compose';
  });

  function renderCompose() {
    loadDraft();
    igTheme.value = draft.theme || '';
    igCategory.value = draft.category || '';
    igSubtitle.value = draft.subtitle || '';
    igCta.value = draft.cta === 'collection' || draft.cta == null ? 'collection' : String(draft.cta);
    igCoverStyle.value = draft.coverStyle || 'serious_think';
    igCoverTitle.value = draft.coverTitle || '';
    igCoverAccent.value = draft.coverAccent || '';
    igCoverFields.hidden = igCoverStyle.value === 'serious_think';
    var sum = draft.summary || emptySummary();
    igSumOn.checked = sum.enabled !== false;
    igSumFields.hidden = !igSumOn.checked;
    igSumTitle.value = sum.title || '';
    igSumLead.value = sum.lead || '';
    igSumVerdict.value = sum.verdict || '';
    renderComposeItems();
  }

  function renderComposeItems() {
    igItemsEl.innerHTML = '';
    igCount.textContent = '（' + draft.items.length + '件）';
    showPlanNote();
    if (!draft.items.length) {
      igItemsEl.appendChild(el('p', 'manage-empty', '商品が選ばれていません。投稿管理の「ROOM投稿済み」か「Instagram投稿待ち」で商品にチェックを入れて「Instagram画像を作る」を押してください。'));
    }
    draft.items.forEach(function (it, i) {
      var row = el('div', 'ig-item');
      row.appendChild(el('span', 'ig-num', String(i + 1)));
      var img = el('img');
      img.src = it.image || '';
      img.alt = '';
      row.appendChild(img);
      var mid = el('div');
      if (it.hero) mid.appendChild(el('p', 'hero-badge', '表紙の主役（起点の商品）'));
      mid.appendChild(el('p', 'ig-item-name', it.name));
      if (!it.hero && draft.release) {
        var makeHero = el('button', 'link-btn', 'この商品を表紙の主役にする');
        makeHero.type = 'button';
        makeHero.addEventListener('click', function () {
          if (!window.confirm('表紙の主役をこの商品に変えますか？（最初に紹介する商品も変わります）')) return;
          setHero(i);
          draft.layoutSizes = null;
          saveDraft();
          renderComposeItems();
        });
        mid.appendChild(makeHero);
      }
      var role = el('input', 'input');
      role.type = 'text';
      role.maxLength = 14;
      role.placeholder = '役割（任意）例：迷ったらこれ';
      role.value = it.role || '';
      role.addEventListener('input', function () { it.role = role.value; saveDraft(); });
      mid.appendChild(role);
      row.appendChild(mid);
      var move = el('div', 'ig-move');
      [['▲', -1], ['▼', 1], ['×', 0]].forEach(function (b) {
        var btn = el('button', null, b[0]);
        btn.type = 'button';
        btn.setAttribute('aria-label', b[1] < 0 ? '上へ' : b[1] > 0 ? '下へ' : '外す');
        if ((b[1] < 0 && i === 0) || (b[1] > 0 && i === draft.items.length - 1)) btn.disabled = true;
        // 主役は先頭から動かさない（ほかの商品も主役の上には行けない）
        if (b[1] !== 0 && (it.hero || (b[1] < 0 && i === 1 && draft.items[0].hero))) btn.disabled = true;
        btn.addEventListener('click', function () {
          if (b[1] === 0 && it.hero) {
            if (!window.confirm('この商品は表紙の主役（起点の商品）です。外すと表紙は次の商品になります。外しますか？')) return;
            draft.heroProduct = null;
          }
          if (b[1] === 0) draft.items.splice(i, 1);
          else draft.items.splice(i + b[1], 0, draft.items.splice(i, 1)[0]);
          draft.layoutSizes = null; // 商品が変わったので、スライドの配置は自動に戻す
          saveDraft();
          renderComposeItems();
        });
        move.appendChild(btn);
      });
      row.appendChild(move);
      igItemsEl.appendChild(row);
    });
  }
  [igTheme, igCategory, igSubtitle, igCta, igSumOn, igSumTitle, igSumLead, igSumVerdict, igCoverStyle, igCoverTitle, igCoverAccent].forEach(function (x) { x.addEventListener('change', saveDraft); });

  // 表紙の文字：自分で書いた大見出し・目立たせる言葉・小見出しを優先し、空欄はAIの文字を使う。
  // AIの文字は欄に入れておくので、気に入らなければ直して「画像を作る」をもう一度押せばよい
  function coverFor(ai) {
    if (!ai || ai.style === 'serious_think' || draft.coverStyle === 'serious_think') return null;
    var title = draft.coverTitle || ai.title || '';
    var flat = title.replace(/\n/g, '');
    var accent = draft.coverAccent || (ai.accent && flat.indexOf(ai.accent) !== -1 ? ai.accent : '');
    if (!draft.coverTitle && ai.title) {
      igCoverTitle.value = ai.title;
      igCoverAccent.value = accent;
    }
    if (draft.coverStyle === 'auto' && ai.style) igCoverStyle.value = ai.style;
    saveDraft();
    return { style: ai.style, title: title, accent: accent, sub: draft.subtitle || ai.sub || '', badge: ai.badge || '', price: ai.price || '' };
  }

  function showIgMessage(text, isError, detail) {
    igMessage.textContent = text;
    igMessage.className = 'message' + (isError ? ' error' : '');
    if (detail) igMessage.appendChild(el('span', 'detail', detail));
    igMessage.hidden = false;
  }

  // 合言葉つきでAPIを呼ぶ（合言葉が違えば1回だけ入れ直してもらう）
  function postJson(path, body, retried) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Passcode': getPass() },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && data.needPasscode && !retried) {
          var input = window.prompt('合言葉を入力してください');
          if (input) { setPass(input.trim()); resetBtn.hidden = false; return postJson(path, body, true); }
        }
        return { status: res.status, data: data };
      });
    });
  }

  // 楽天の商品画像は、このアプリのサーバー経由で読み込む（余白の切り取りに必要）
  function loadProductImage(url) {
    if (!url) return Promise.resolve(null);
    // 公式サイトのURLから登録した商品（楽天にない新商品）の画像は、src=official で中継してもらう
    var official = !/^https:\/\/[^/]*(rakuten\.co\.jp|r10s\.jp|rakuten\.ne\.jp)\//.test(url);
    return fetch('api/image?url=' + encodeURIComponent(url) + (official ? '&src=official' : ''), { headers: { 'X-App-Passcode': getPass() } })
      .then(function (res) { if (!res.ok) throw new Error('image'); return res.blob(); })
      .then(function (blob) { return window.IgRender.loadImage(URL.createObjectURL(blob)); })
      .then(function (img) { return window.IgRender.trimImage(img); })
      .catch(function () { return null; });
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
  }

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  igGenerate.addEventListener('click', function () {
    saveDraft();
    igMessage.hidden = true;
    if (!draft.theme) { showIgMessage('投稿テーマを入れてください（例：出産祝い）', true); return; }
    if (!draft.items.length) { showIgMessage('商品が選ばれていません', true); return; }
    igGenerate.disabled = true;
    igLoading.hidden = false;
    igResult.hidden = true;

    var sum = draft.summary || emptySummary();
    var needSummary = sum.enabled && !(sum.title && sum.verdict);
    var copyReq = postJson('api/instagram', {
      theme: draft.theme,
      category: draft.category,
      needSummary: needSummary,
      needCaption: true,
      collection: History.collectionNameFor(draft.theme),
      genre: draft.genre || '',
      postType: draft.postType || '',
      coverStyle: draft.coverStyle || 'serious_think',
      priceBand: draft.priceBand || '',
      items: draft.items.map(function (it) { return { name: it.name, price: it.price, role: it.role, reason: it.reason, intro: it.intro, memo: it.memo }; })
    });
    var images = Promise.all(draft.items.map(function (it) { return loadProductImage(it.image); }));
    var bear = window.IgRender.loadImage(BEAR_SRC).catch(function () { return null; });

    Promise.all([copyReq, images, bear]).then(function (r) {
      var res = r[0];
      if (res.status !== 200) {
        showIgMessage(res.data.error || '画像を作れませんでした。もう一度お試しください。', true, res.data.detail);
        return;
      }
      var copy = res.data;
      var cover = coverFor(copy.cover);
      var coverStyleUsed = cover ? cover.style : 'serious_think';
      // 配置を変えて描き直せるよう、画像づくりの材料を残しておく
      lastPost = {
        topic: copy.topic,
        category: draft.category || copy.category,
        subtitle: draft.subtitle || '迷ったので整理しました',
        cover: cover,
        bear: r[2],
        ctaMessage: draft.cta === 'collection' ? collectionCtaMessage(copy.topic) : window.IgRender.CTA_MESSAGES[draft.cta || 0],
        summary: !sum.enabled ? null : needSummary
          ? (copy.summary ? Object.assign({ typeName: sum.typeName || 'まず結論' }, copy.summary) : null)
          : { typeName: sum.typeName || 'まず結論', title: sum.title, lead: sum.lead, verdict: sum.verdict },
        items: draft.items.map(function (it, i) {
          var c = copy.items[i] || {};
          return { image: r[1][i], shortName: c.shortName || it.name, subline: c.subline, memo: c.memo, price: it.price, role: it.role, brand: it.brand, slug: c.slug, hero: !!it.hero };
        }),
        folder: 'generated_posts/' + today() + '_' + (copy.topicSlug || 'post'),
        release: draft.release && (cover || {}).style === 'new_release' ? draft.release : null
      };
      // コーデの投稿：完成コーデのスライドを差し込む（js/ig-coord.js）
      if (draft.coord) {
        lastPost.summary = null;
        if (draft.coord.format !== 'release') lastPost.cover = null;
      }
      var notes = [];
      if (copy.notice) notes.push(copy.notice);
      if (!r[2]) notes.push('くまのアイコン画像（assets/kuma.png）がまだ無いため、仮のクマで作りました。');
      var missing = r[1].filter(function (x) { return !x; }).length;
      if (missing) notes.push(missing + '件の商品画像を読み込めませんでした。');
      if (notes.length) showIgMessage(notes.join(' '), false, copy.detail);
      igCaption.value = copy.caption || '';

      return (draft.coord ? coordSlidesData(draft.coord, draft.items, r[1]).then(function (co) { lastPost.coord = co; }) : Promise.resolve()).then(function () { return showCarousel(lastPost); }).then(function () {
        // 投稿履歴に、ROOM登録準備で使う商品情報（投稿順）とコレクション名を残す
        var productsFull = draft.items.map(function (it, i) {
          var c = copy.items[i] || {};
          return {
            id: it.code || it.url || it.id, code: it.code, name: it.name, shortName: c.shortName || '', brand: it.brand || '',
            price: it.price, url: it.url, image: it.image, intro: it.intro || '', role: it.role || ''
          };
        });
        var ensurePost = draft.postId ? Promise.resolve(draft.postId) : History.add({
          title: draft.coord ? draft.coord.title : copy.topic + 'について本気出して考えてみた', topic: copy.topic, subtitle: draft.subtitle, genre: draft.category,
          postType: draft.coord ? 'コーデ' : undefined
        });
        ensurePost.then(function (id) {
          draft.postId = id;
          // コーデの記録にも投稿の記録を結びつける（ROOM登録の状況をコーデの画面から見られるように）
          if (draft.coord && window.CoordStore) {
            var cv = window.CoordStore.get(draft.coord.coordId);
            if (cv && cv.postId !== id) { cv.postId = id; window.CoordStore.save(cv); }
          }
          try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
          return History.get(id).then(function (rec) {
            return History.update(id, {
              status: rec && rec.status === 'posted' ? 'posted' : 'generated',
              topic: copy.topic,
              products: productsFull,
              collectionName: (rec && rec.collectionName) || History.collectionNameFor(copy.topic),
              series: coverStyleUsed,
              criteria: (copy.summary && copy.summary.points) || [],
              carouselDone: true,
              // 商品を選び直したので、前に作ったReel・Storyは作り直す
              reel: null, story: null, reelDone: false, storyDone: false,
              roomTagsCommon: null // ROOM用ハッシュタグも、選んだ商品で作り直す
            });
          }).then(function () {
            buildAssetsAfterCarousel(id, { style: coverStyleUsed, items: productsFull, images: r[1], bear: r[2] });
          });
        });
        igResult.hidden = false;
        igResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }).catch(function () {
      showIgMessage('通信できませんでした。電波の良い場所でもう一度お試しください。', true);
    }).then(function () {
      igGenerate.disabled = false;
      igLoading.hidden = true;
    });
  });

  // ---- カルーセルの描画と「スライド構成」（何枚目に何商品をのせるか。あとから変えられる） ----
  var lastPost = null;
  var igLayout = document.getElementById('ig-layout');
  var igPlanNote = document.getElementById('ig-plan-note');

  function showCarousel(post) {
    post.layoutSizes = draft.layoutSizes || null;
    var slides = window.IgRender.renderPost(post);
    renderLayoutPanel(slides, post);
    return Promise.all(slides.map(function (s) { return canvasToBlob(s.canvas); })).then(function (blobs) {
      lastOutput = {
        folder: post.folder,
        files: slides.map(function (s, i) { return { name: s.fileName, blob: blobs[i] }; }),
        caption: igCaption.value
      };
      igPreview.innerHTML = '';
      lastOutput.files.forEach(function (f) {
        var fig = el('figure');
        var img = el('img');
        img.src = URL.createObjectURL(f.blob);
        img.alt = f.name;
        fig.appendChild(img);
        fig.appendChild(el('figcaption', null, f.name));
        igPreview.appendChild(fig);
      });
    });
  }

  var LAYOUT_LABELS = { 1: '特集（1商品）', 2: '比較（2商品）', 3: '雑誌（3商品）', 4: '一覧（4商品）' };

  // 総商品数・総スライド数・各スライドの商品配置。商品スライドの配置は選び直せる（変えるとすぐ描き直す）
  function renderLayoutPanel(slides, post) {
    var plan = slides.plan;
    igLayout.innerHTML = '';
    if (!plan) return;
    igLayout.appendChild(el('p', 'ig-layout-sum', '総商品数 ' + post.items.length + '　／　総スライド数 ' + plan.total + '（Instagramの自動投稿は' + plan.maxSlides + '枚まで）'));
    if (plan.overLimit) {
      var warn = el('div', 'message error');
      warn.appendChild(el('p', null, plan.reason + ' 商品は減らしていません。'));
      var ul = el('ul');
      plan.suggestions.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      warn.appendChild(ul);
      igLayout.appendChild(warn);
    }
    var table = el('div', 'ig-layout-list');
    var k = 0;
    plan.slides.forEach(function (sl, n) {
      var row = el('div', 'ig-layout-row');
      row.appendChild(el('span', 'ig-layout-no', (n + 1) + '枚目'));
      if (sl.kind !== 'items') {
        row.appendChild(el('span', 'ig-layout-kind', { cover: '表紙', summary: 'まとめ', cta: '楽天ROOMへの誘導', coord: 'コーデ紹介' }[sl.kind]));
      } else {
        var idx = k++;
        var sel = el('select', 'select');
        [1, 2, 3, 4].forEach(function (v) {
          var o = el('option', null, LAYOUT_LABELS[v]);
          o.value = String(v);
          sel.appendChild(o);
        });
        sel.value = String(sl.size);
        sel.addEventListener('change', function () {
          var sizes = plan.sizes.slice();
          sizes[idx] = Number(sel.value);
          draft.layoutSizes = sizes;
          saveDraft();
          showCarousel(lastPost);
        });
        row.appendChild(sel);
        row.appendChild(el('span', 'ig-layout-items', sl.items.map(function (i) { var j = i + (plan.itemOffset || 0); return 'No.' + (j + 1) + ' ' + ((post.items[j] || {}).shortName || '').slice(0, 10); }).join(' / ')));
      }
      table.appendChild(row);
    });
    igLayout.appendChild(table);
    if (!plan.auto) {
      var reset = el('button', 'btn btn-secondary', '自動の配置に戻す');
      reset.type = 'button';
      reset.addEventListener('click', function () {
        draft.layoutSizes = null;
        saveDraft();
        showCarousel(lastPost);
      });
      igLayout.appendChild(reset);
    }
  }

  // 商品を選んだ段階で、何枚の投稿になるかを見せる
  function showPlanNote() {
    if (!igPlanNote || !window.CarouselLayout) return;
    var n = draft.items.length;
    if (!n) { igPlanNote.textContent = ''; return; }
    var sum = draft.summary || emptySummary();
    var plan = window.CarouselLayout.plan(n, { summary: !!sum.enabled, sizes: draft.layoutSizes || null });
    var counts = {};
    plan.sizes.forEach(function (x) { counts[x] = (counts[x] || 0) + 1; });
    igPlanNote.textContent = n + '商品 → ' + plan.total + '枚の投稿（' + Object.keys(counts).map(function (x) { return LAYOUT_LABELS[x].replace(/（.*）/, '') + '×' + counts[x]; }).join('・') + '）' +
      (n > MAX_POST_ITEMS ? '。' + MAX_POST_ITEMS + '商品を超えています（商品は減らしません。並び順を見直すか、2つの投稿に分けてください）' : '');
  }

  function downloadBlob(blob, name) {
    var a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // iPhoneでは共有シートの「画像を保存」で、全部まとめて写真アプリに入る
  document.getElementById('ig-share').addEventListener('click', function () {
    if (!lastOutput) return;
    var files = lastOutput.files.map(function (f) { return new File([f.blob], f.name, { type: 'image/png' }); });
    if (navigator.canShare && navigator.canShare({ files: files })) {
      navigator.share({ files: files }).catch(function () {});
    } else {
      lastOutput.files.forEach(function (f) { downloadBlob(f.blob, f.name); });
    }
  });

  // 投稿ごとのフォルダ（generated_posts/日付_テーマ/）に入れたZIPにする
  document.getElementById('ig-zip').addEventListener('click', function () {
    if (!lastOutput) return;
    Promise.all(lastOutput.files.map(function (f) { return f.blob.arrayBuffer(); })).then(function (bufs) {
      var entries = lastOutput.files.map(function (f, i) {
        return { path: lastOutput.folder + '/' + f.name, data: new Uint8Array(bufs[i]) };
      });
      if (igCaption.value.trim()) entries.push({ path: lastOutput.folder + '/caption.txt', data: new TextEncoder().encode(igCaption.value) });
      var zip = window.MiniZip.buildZip(entries);
      downloadBlob(new Blob([zip], { type: 'application/zip' }), lastOutput.folder.split('/').pop() + '.zip');
    });
  });

  document.getElementById('ig-room').addEventListener('click', function () {
    if (draft.postId) location.hash = '#room:' + draft.postId;
  });

  document.getElementById('ig-mark').addEventListener('click', function () {
    Promise.all(draft.items.map(function (it) { return Store.setStatus(it, 'ig_posted'); })).then(function () {
      updateManageCount();
      showToast(draft.items.length + '商品を「Instagram投稿済み」にしました');
      if (draft.planId) setPlanDone(draft.planId, true);
      if (draft.postId) History.update(draft.postId, { status: 'posted' });
      if (draft.coord && window.CoordStore) {
        var cv = window.CoordStore.get(draft.coord.coordId);
        if (cv) { cv.igStatus = 'posted'; window.CoordStore.save(cv); renderCoordSaved(); }
      }
    });
  });
  window.addEventListener('hashchange', showView);

  var buttonLabels = {};
  var LOADING_DISCOVER = '商品を探しています…<br><span class="sub">AIが選ぶまで10〜50秒ほどかかります</span>';
  var LOADING_EXPLORE = '商品を探しています…<br><span class="sub">いくつかの方向から探すので、30〜60秒ほどかかります</span>';
  function setLoading(on, activeBtn, text) {
    [searchBtn, discoverBtn, ideasBtn].forEach(function (b) {
      if (!buttonLabels[b.id]) buttonLabels[b.id] = b.textContent;
      b.disabled = on;
      if (b === activeBtn) b.textContent = on ? '探しています…' : buttonLabels[b.id];
    });
    if (text) loadingText.innerHTML = text;
    loading.hidden = !on;
  }

  // APIを呼ぶ共通処理（合言葉の入力・エラー表示・時間切れを含む）
  function request(path, body, btn, onSuccess, loadingHtml) {
    message.hidden = true;
    genreEl.hidden = true;
    results.innerHTML = '';
    setLoading(true, btn, loadingHtml || LOADING_DISCOVER);
    loading.scrollIntoView({ behavior: 'smooth', block: 'center' });

    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 75000);

    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Passcode': getPass() },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (r) {
        if (r.status === 401 && r.data.needPasscode) {
          var hadPass = !!getPass();
          var input = window.prompt(hadPass ? '合言葉が違うようです。もう一度入力してください' : '合言葉を入力してください');
          if (input) {
            setPass(input.trim());
            resetBtn.hidden = false;
            return request(path, body, btn, onSuccess, loadingHtml);
          }
          showMessage('合言葉を入力すると使えるようになります。', true);
          return;
        }
        if (r.status !== 200) {
          showMessage(r.data.error || 'うまく取得できませんでした。もう一度お試しください。', true, r.data.detail);
          return;
        }
        var products = r.data.products || r.data.candidates || [];
        if (r.data.notice) showMessage(r.data.notice, products.length === 0, r.data.detail);
        onSuccess(r.data, products);
      })
      .catch(function (e) {
        var timeout = e && e.name === 'AbortError';
        showMessage(timeout ? '時間がかかりすぎたため中断しました。もう一度お試しください。'
          : '通信できませんでした。電波の良い場所でもう一度お試しください。', true);
      })
      .then(function () {
        clearTimeout(timer);
        setLoading(false, btn);
      });
  }

  // 楽天やROOMに移って戻ったとき、iPhoneがページを読み込み直しても結果が消えないよう保存しておく
  function saveLast(mode, data) {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ mode: mode, data: data, at: Date.now() })); } catch (e) {}
  }
  function restoreLast() {
    var last;
    try { last = JSON.parse(localStorage.getItem(LAST_KEY)); } catch (e) { return; }
    if (!last || !last.data) return;
    if (Date.now() - last.at > 24 * 60 * 60 * 1000) return; // 1日以上前の結果は出さない
    if (last.mode === 'explore' && (last.data.candidates || []).length) renderExplore(last.data);
    else if (last.mode === 'discover' && (last.data.products || []).length) renderDiscover(last.data);
    else if (last.mode === 'seed' && last.data.product && (last.data.ideas || []).length) renderSeed(last.data, false);
    else if (last.mode === 'release' && last.data.item && (last.data.ideas || []).length) renderRelease(last.data, false);
    else if (last.mode === 'coord' && last.data.heroProduct) {
      // 投稿づくりの画面で記録が進んでいれば（Instagram・ROOMの状況）、保存したコーデの方を使う
      var saved = window.CoordStore && window.CoordStore.get(last.data.id);
      renderCoord(saved && (saved.updatedAt || 0) >= (last.data.updatedAt || 0) ? saved : last.data);
    }
  }

  // 発掘結果をInstagramの投稿文に使える1つの文章にする
  function discoverText(data) {
    var marks = ['①', '②', '③', '④', '⑤', '⑥'];
    var lines = [(data.condition || data.genre || '今回見つけたもの'), ''];
    data.products.forEach(function (p, i) {
      lines.push(marks[i] + ' ' + (p.role ? p.role + '：' : '') + p.name.replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 40) + '（' + formatPrice(p.price) + '）');
      if (p.reason) lines.push('・' + p.reason);
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  function renderDiscoverHeader(data) {
    var card = el('article', 'card list-head');
    card.appendChild(el('p', 'list-count', data.products.length + '商品'));
    var actions = el('div', 'actions');
    actions.appendChild(copyButton('Instagram用にまとめてコピー', function () { return discoverText(data); }, null, data.products.length + '商品分をまとめてコピーしました'));
    card.appendChild(actions);
    return card;
  }

  function renderDiscover(data) {
    var products = data.products || [];
    var shown = data.condition || data.genre;
    if (shown && products.length) {
      genreEl.innerHTML = '';
      genreEl.appendChild(document.createTextNode(data.condition ? '今回の条件：' : '今回のジャンル：'));
      genreEl.appendChild(el('strong', null, shown));
      genreEl.hidden = false;
    }
    if (products.length >= 2) results.appendChild(renderDiscoverHeader(data));
    products.forEach(function (p) {
      results.appendChild(renderCard(p, { genreId: data.genreId, onSeed: function (prod) { startSeed(prod, data); } }));
    });
  }

  // ---- この商品から企画を考える（偶然見つけた1商品を、次の投稿企画に育てる） ----
  // back: 戻るときに表示し直すランダム発掘の結果
  function startSeed(product, back) {
    message.hidden = true;
    genreEl.hidden = true;
    results.innerHTML = '';
    var seed = {
      name: product.name, code: product.code, price: product.price, url: product.url, image: product.image,
      shop: product.shop, brand: product.brand || '', reason: product.reason || '', caption: product.caption || ''
    };
    var view = { product: seed, ideas: [], analysis: '', back: back };
    renderSeed(view, true);
    window.scrollTo({ top: results.offsetTop - 8, behavior: 'smooth' });
    postJson('api/seed-ideas', { product: seed }).then(function (r) {
      if (r.status !== 200) {
        results.innerHTML = '';
        renderSeed(view, false);
        showMessage(r.data.error || '企画を考えられませんでした。もう一度お試しください。', true, r.data.detail);
        return;
      }
      view.ideas = r.data.ideas || [];
      view.analysis = r.data.analysis || '';
      saveLast('seed', view);
      results.innerHTML = '';
      renderSeed(view, false);
      if (r.data.notice) showMessage(r.data.notice, false, r.data.detail);
    }, function () {
      results.innerHTML = '';
      renderSeed(view, false);
      showMessage('通信できませんでした。電波の良い場所でもう一度お試しください。', true);
    });
  }

  function renderSeed(view, thinking) {
    var p = view.product;
    if (view.back) {
      var backBtn = el('button', 'link-btn seed-back', '← ランダム発掘の結果に戻る');
      backBtn.type = 'button';
      backBtn.addEventListener('click', function () {
        results.innerHTML = '';
        message.hidden = true;
        saveLast('discover', view.back);
        renderDiscover(view.back);
      });
      results.appendChild(backBtn);
    }
    var head = el('article', 'card seed-head');
    head.appendChild(el('p', 'type-chip', 'この商品から企画を考える'));
    var top = el('div', 'cand-top');
    if (p.image) {
      var img = el('img', 'cand-thumb');
      img.src = p.image;
      img.alt = '';
      img.onerror = function () { img.remove(); };
      top.appendChild(img);
    }
    var info = el('div', 'cand-info');
    info.appendChild(el('p', 'seed-label', '起点の商品'));
    info.appendChild(el('h3', 'cand-name', p.name.replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 50)));
    info.appendChild(el('p', 'cand-meta', formatPrice(p.price)));
    top.appendChild(info);
    head.appendChild(top);
    if (view.analysis) head.appendChild(el('p', 'cand-reason', view.analysis));
    results.appendChild(head);
    if (thinking) {
      var wait = el('div', 'loading');
      wait.appendChild(el('div', 'spinner'));
      var t = el('p');
      t.innerHTML = 'この商品を活かせる企画を考えています…<br><span class="sub">20〜40秒ほどかかります</span>';
      wait.appendChild(t);
      results.appendChild(wait);
      return;
    }
    if (!view.ideas.length) return;
    results.appendChild(el('p', 'hint seed-hint', '同じ商品から、切り口の違う企画を考えました。「この企画で広げる」を押すと、この商品を必ず採用にしたまま、企画に合う商品を15〜20件探します。'));
    view.ideas.forEach(function (idea, i) { results.appendChild(seedIdeaCard(idea, i, p)); });
  }

  function seedIdeaCard(idea, i, product) {
    var card = el('article', 'idea-card seed-idea');
    var head = el('div', 'idea-head');
    head.appendChild(el('span', 'idea-no', '案' + (i + 1)));
    head.appendChild(el('span', 'plan-type', idea.postType));
    head.appendChild(el('span', 'seed-role ' + idea.seedRole, idea.seedRole === 'trigger' ? 'きっかけ型' : '主役型'));
    card.appendChild(head);
    card.appendChild(el('h3', 'idea-title', idea.title));
    var dl = el('dl', 'idea-facts');
    [['起点商品', product.name.replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 30)], ['この商品の使い方', idea.howUsed], ['ターゲット', idea.target], ['価格帯', idea.priceBand], ['比較軸', idea.axis], ['想定候補数', '約' + idea.expectedCount + '件']].forEach(function (f) {
      if (!f[1]) return;
      dl.appendChild(el('dt', null, f[0]));
      dl.appendChild(el('dd', null, f[1]));
    });
    card.appendChild(dl);
    var more = el('div', 'seed-more');
    more.appendChild(el('p', 'angles-label', '追加で探す'));
    var ul = el('ul', 'angle-list');
    idea.searchGenres.forEach(function (g) { ul.appendChild(el('li', null, g)); });
    more.appendChild(ul);
    card.appendChild(more);
    if (idea.whyInteresting) card.appendChild(el('p', 'idea-why', 'なぜ成立するか：' + idea.whyInteresting));
    var go = el('button', 'btn btn-primary', 'この企画で広げる');
    go.type = 'button';
    go.addEventListener('click', function () {
      History.add({
        title: idea.title, topic: idea.topic, genre: idea.genre, postType: idea.postType,
        target: idea.target, priceBand: idea.priceBand, brands: product.brand ? [product.brand] : []
      }).then(setCurrentPostId, function () {});
      exploreProducts({ idea: idea, seed: product });
    });
    card.appendChild(go);
    return card;
  }

  // 完全ランダムの発掘（5商品前後、紹介文つき）
  function discover() {
    var body = { stats: loadStats(), recent: loadRecent() };
    request('api/discover', body, discoverBtn, function (data, products) {
      if (products.length) {
        recordStat(data.genreId, 'shown');
        rememberProducts(products);
        saveLast('discover', data);
      }
      renderDiscover(data);
    });
  }

  // ---- 過去に出した・使った商品（新しく探すとき、同じものばかり出ないように） ----
  var SEEN_KEY = 'room-seen-products';
  function loadSeen() {
    try {
      var list = JSON.parse(localStorage.getItem(SEEN_KEY));
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  // src: 'shown'（候補に出た）/ 'ig'（Instagram投稿に使った）
  function markSeen(products, src) {
    var add = products.map(function (p) { return { code: p.code || '', name: String(p.name || '').slice(0, 60), src: src, at: Date.now() }; });
    var codes = add.map(function (x) { return x.code; });
    var list = add.concat(loadSeen().filter(function (x) { return codes.indexOf(x.code) === -1; })).slice(0, 200);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(list)); } catch (e) {}
  }
  // 直近50商品：Instagramに使った・ROOM候補にした商品を先に、そのあと候補に出た商品
  function seenForSearch() {
    return Store.list().then(function (saved) {
      var used = saved.map(function (x) { return { code: x.code || x.id || '', name: x.name || '' }; });
      var seen = loadSeen();
      var first = seen.filter(function (x) { return x.src === 'ig'; }).concat(used);
      var rest = seen.filter(function (x) { return x.src !== 'ig'; });
      var out = [];
      var codes = {};
      first.concat(rest).forEach(function (x) {
        var key = x.code || x.name;
        if (!key || codes[key] || out.length >= 50) return;
        codes[key] = true;
        out.push({ code: x.code, name: String(x.name).slice(0, 60) });
      });
      return out;
    }, function () { return []; });
  }

  // ---- 商品を探す（企画・条件指定・最初の10投稿）：AIが広く候補を集め、ユーザーが選ぶ ----
  // body: { idea } / { planId } / { genre, type, free, details }
  function exploreProducts(body, btn) {
    if (!body.idea && !body.planId) setCurrentPostId('');
    seenForSearch().then(function (seen) {
      body.seen = seen;
      request('api/explore', body, btn || null, function (data, candidates) {
        if (!candidates.length) return;
        markSeen(candidates, 'shown');
        var d = {
          brief: data.brief, title: data.title, typeName: data.typeName, idea: data.idea, plan: data.plan, coverStyle: data.coverStyle,
          release: body.release || null,
          angles: data.angles || [], candidates: candidates, view: 'recommend'
        };
        saveLast('explore', d);
        renderExplore(d);
      }, LOADING_EXPLORE);
    });
  }

  var VIEWS = [
    ['recommend', 'おすすめ順'], ['price_asc', '価格が安い順'], ['price_desc', '価格が高い順'],
    ['main', '本命だけ'], ['alt', '代替だけ'], ['trend', 'トレンドだけ'], ['unusual', '変わり種だけ'], ['brand', 'ブランドだけ'], ['gift', 'プレゼント向きだけ']
  ];
  var ROLE_GROUPS = {
    main: ['本命', '2番手', '王道', '少し奮発'],
    alt: ['安い代替', 'コスパ', '失敗しても許せる価格'],
    trend: ['トレンド枠'],
    unusual: ['変わり種', '個人的に気になる'],
    brand: ['ブランド枠', '王道', '知っておきたい'],
    gift: ['プレゼント向き']
  };
  function viewCandidates(list, view) {
    if (view === 'price_asc') return list.slice().sort(function (a, b) { return a.price - b.price; });
    if (view === 'price_desc') return list.slice().sort(function (a, b) { return b.price - a.price; });
    var group = ROLE_GROUPS[view];
    if (!group) return list;
    return list.filter(function (c) {
      if (view === 'brand' && c.brand) return true;
      return [c.role].concat(c.tags || []).some(function (r) { return group.indexOf(r) !== -1; });
    });
  }

  function candidateCard(c, onToggle) {
    var card = el('article', 'cand-card' + (c.picked ? ' picked' : '') + (c.role === '起点商品' ? ' seed-cand' : ''));
    var top = el('div', 'cand-top');
    if (c.image) {
      var img = el('img', 'cand-thumb');
      img.src = c.image;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () { img.remove(); };
      top.appendChild(img);
    }
    var info = el('div', 'cand-info');
    var chips = el('div', 'chips');
    if (c.role) chips.appendChild(el('span', 'role', c.role));
    else if (c.angle) chips.appendChild(el('span', 'role', c.angle));
    (c.tags || []).forEach(function (t) { chips.appendChild(el('span', 'tag', t)); });
    if (c.seenBefore) chips.appendChild(el('span', 'seen', '以前も候補に出た商品'));
    info.appendChild(chips);
    var name = el('h3', 'cand-name', c.shortName || c.name);
    name.title = c.name;
    info.appendChild(name);
    var meta = el('p', 'cand-meta');
    meta.appendChild(el('strong', null, formatPrice(c.price)));
    if (c.brand) meta.appendChild(el('span', 'cand-brand', c.brand));
    info.appendChild(meta);
    top.appendChild(info);
    card.appendChild(top);
    if (c.reason) card.appendChild(el('p', 'cand-reason', c.reason));
    if (c.memo) {
      var memo = el('p', 'cand-memo');
      memo.appendChild(el('b', null, 'くま '));
      memo.appendChild(document.createTextNode(c.memo));
      card.appendChild(memo);
    }
    // 起点の商品は「必ず採用」で固定（解除もできる）
    if (c.role === '起点商品') {
      var pinRow = el('div', 'pin-row' + (c.pinned ? ' on' : ''));
      pinRow.appendChild(el('span', null, c.pinned ? 'この商品は必ず採用（固定中）' : '固定を解除しています'));
      var pinBtn = el('button', 'link-btn', c.pinned ? '固定を解除' : 'もう一度固定する');
      pinBtn.type = 'button';
      pinBtn.addEventListener('click', function () {
        c.pinned = !c.pinned;
        if (c.pinned) c.picked = true;
        card.parentNode.replaceChild(candidateCard(c, onToggle), card);
        onToggle();
      });
      pinRow.appendChild(pinBtn);
      card.appendChild(pinRow);
    }
    var actions = el('div', 'cand-actions');
    var pick = el('label', 'cand-pick');
    var box = el('input');
    box.type = 'checkbox';
    box.checked = !!c.picked;
    box.disabled = !!c.pinned;
    box.addEventListener('change', function () {
      // 1投稿にまとめられるのは最大20商品
      if (box.checked && onToggle.count && onToggle.count() >= MAX_POST_ITEMS) {
        box.checked = false;
        showToast('1投稿にまとめられるのは' + MAX_POST_ITEMS + '商品までです');
        return;
      }
      c.picked = box.checked;
      card.classList.toggle('picked', c.picked);
      onToggle();
    });
    pick.appendChild(box);
    pick.appendChild(document.createTextNode(c.pinned ? ' 必ず採用' : ' Instagramに採用'));
    actions.appendChild(pick);
    var link = el('a', 'btn btn-secondary cand-link', '楽天で見る');
    link.href = c.url;
    link.target = '_blank';
    link.rel = 'noopener';
    actions.appendChild(link);
    card.appendChild(actions);
    if (isFashion(c.name)) {
      var co = el('button', 'link-btn cand-coord', 'この商品でコーデを作る');
      co.type = 'button';
      co.addEventListener('click', function () { startCoord(c); });
      card.appendChild(co);
    }
    return card;
  }

  // ---- 企画の編集（下書き）：AIの企画はたたき台。タイトル・テーマ・商品・並び順・紹介文を自由に直せて、自動で保存する ----
  // d.edit: { title, subtitle, theme, direction, genre, coverStyle, catchCopy, edited: {手で直した項目: true}, heroProduct }
  // d.order: 企画に入れた商品の並び順（候補のキー）、d.search: 「商品を検索して追加」の状態
  var SERIES_SUFFIX = 'について本気出して考えてみた';
  var SERIES_RE = /(について)?本気出して考えてみた$/;
  var PLAN_DRAFTS_KEY = 'room-plan-drafts';
  var AXIS_BUTTONS = [
    ['same_brand', '同ブランドから探す'], ['other_brand', '他ブランドから探す'], ['other_collab', '他のコラボを探す'],
    ['similar', '似たデザインを探す'], ['same_price', '同価格帯から探す'], ['new_arrival', '新作から探す']
  ];
  var AXIS_SHORT = { search: '自分で検索', same_brand: '同ブランド', other_brand: '他ブランド', other_collab: '他のコラボ', similar: '似たデザイン', same_price: '同価格帯', new_arrival: '新作' };

  function candKey(c) { return c.code || c.url || c.name; }
  function sameItem(a, b) { return !!(a && b && ((a.code && a.code === b.code) || (a.url && a.url === b.url))); }
  function byKey(d, k) {
    for (var i = 0; i < d.candidates.length; i++) if (candKey(d.candidates[i]) === k) return d.candidates[i];
    return null;
  }
  function heroOf(c) { return { code: c.code || '', url: c.url || '', name: c.name, brand: c.brand || '', price: c.price || 0, image: c.image || '' }; }

  function initEdit(d) {
    if (d.edit) { d.edit.edited = d.edit.edited || {}; return d.edit; }
    var title = (d.idea && d.idea.title) || d.title || '';
    var seed = (d.candidates || []).filter(function (c) { return c.role === '起点商品'; })[0];
    var hero = d.release && d.release.hero ? Object.assign({}, d.release.hero) : seed ? heroOf(seed) : null;
    if (hero && !hero.image && seed) hero.image = seed.image;
    d.edit = {
      title: title,
      subtitle: (d.idea && d.idea.subtitle) || (d.plan && d.plan.subtitle) || '',
      theme: (d.idea && d.idea.topic) || (d.plan && d.plan.topic) || String(title).replace(SERIES_RE, '').slice(0, 30),
      direction: (d.brief && (d.brief.free || d.brief.axis)) || '',
      genre: (d.idea && d.idea.genre) || (d.brief && d.brief.genre) || '',
      coverStyle: d.coverStyle || 'serious_think',
      catchCopy: d.release ? title : '',
      edited: {},
      heroProduct: hero
    };
    d.order = (d.candidates || []).filter(function (c) { return c.picked; }).map(candKey);
    return d.edit;
  }

  // 企画に入れた商品を、決めた並び順で（新商品の企画では、表紙の主役を先頭に）
  function syncOrder(d) {
    var keys = d.candidates.filter(function (c) { return c.picked; }).map(candKey);
    var order = (d.order || []).filter(function (k, i, a) { return keys.indexOf(k) !== -1 && a.indexOf(k) === i; });
    keys.forEach(function (k) { if (order.indexOf(k) === -1) order.push(k); });
    var h = d.edit && d.edit.heroProduct;
    if (d.release && h) {
      var at = -1;
      order.forEach(function (k, i) { if (at === -1 && sameItem(byKey(d, k), h)) at = i; });
      if (at > 0) order.unshift(order.splice(at, 1)[0]);
    }
    d.order = order;
    return order.map(function (k) { return byKey(d, k); }).filter(Boolean);
  }

  function planSeries(d) {
    return d.release ? 'release' : (d.edit.coverStyle || 'serious_think') === 'serious_think' ? 'serious' : 'other';
  }

  // 企画の下書き：ページを移っても、1日以上たっても消えないように、直近8件をこのiPhoneに残す
  function loadPlanDrafts() {
    try {
      var list = JSON.parse(localStorage.getItem(PLAN_DRAFTS_KEY));
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function writePlanDrafts(list) {
    for (var n = list.length; n >= 1; n--) {
      try { localStorage.setItem(PLAN_DRAFTS_KEY, JSON.stringify(list.slice(0, n))); return true; } catch (e) {}
    }
    return false;
  }
  function savePlanDraft(d) {
    if (!d.draftId) d.draftId = 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    d.updatedAt = Date.now();
    var copy = Object.assign({}, d);
    if (copy.search) copy.search = Object.assign({}, copy.search, { items: (copy.search.items || []).slice(-40) });
    writePlanDrafts([copy].concat(loadPlanDrafts().filter(function (x) { return x.draftId !== d.draftId; })).slice(0, 8));
  }

  var planDraftsEl = document.getElementById('plan-drafts');
  function renderPlanDrafts() {
    if (!planDraftsEl) return;
    var list = loadPlanDrafts();
    planDraftsEl.innerHTML = '';
    planDraftsEl.hidden = !list.length;
    if (!list.length) return;
    var box = el('details', 'plan-drafts-box');
    box.appendChild(el('summary', null, '編集中の企画（' + list.length + '）'));
    list.forEach(function (x) {
      var row = el('div', 'plan-draft-row');
      var info = el('div', 'plan-draft-info');
      info.appendChild(el('b', null, (x.edit && x.edit.title) || x.title || '無題の企画'));
      var n = (x.candidates || []).filter(function (c) { return c.picked; }).length;
      var when = new Date(x.updatedAt || 0);
      info.appendChild(el('small', null, n + '商品・' + (when.getMonth() + 1) + '/' + when.getDate() + ' ' + when.getHours() + ':' + ('0' + when.getMinutes()).slice(-2) + ' 保存'));
      row.appendChild(info);
      var open = el('button', 'btn btn-secondary', '開く');
      open.type = 'button';
      open.addEventListener('click', function () {
        message.hidden = true;
        genreEl.hidden = true;
        results.innerHTML = '';
        renderExplore(x);
        saveLast('explore', x);
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      row.appendChild(open);
      var del = el('button', 'link-btn', '削除');
      del.type = 'button';
      del.addEventListener('click', function () {
        if (!window.confirm('「' + ((x.edit && x.edit.title) || x.title || '無題の企画') + '」の下書きを削除しますか？')) return;
        writePlanDrafts(loadPlanDrafts().filter(function (y) { return y.draftId !== x.draftId; }));
        renderPlanDrafts();
      });
      row.appendChild(del);
      box.appendChild(row);
    });
    planDraftsEl.appendChild(box);
  }

  function planField(label, value, opts) {
    opts = opts || {};
    var field = el('label', 'field');
    field.appendChild(el('span', 'field-label', label));
    var input = el(opts.multi ? 'textarea' : 'input', opts.multi ? 'textarea' : 'input');
    if (!opts.multi) input.type = 'text';
    else input.rows = opts.rows || 2;
    input.maxLength = opts.max || 60;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.value = value || '';
    field.appendChild(input);
    if (opts.hint) field.appendChild(el('span', 'hint', opts.hint));
    return { field: field, input: input };
  }

  function renderExplore(d) {
    var edit = initEdit(d);
    var saveTimer = null;
    function persist() {
      clearTimeout(saveTimer);
      d.title = edit.title || d.title;
      saveLast('explore', d);
      savePlanDraft(d);
    }
    function persistSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); }
    function isHero(c) { return !!(edit.heroProduct && sameItem(c, edit.heroProduct)); }

    // ---- 見出し：タイトルはその場で直せる。AIの再提案は、押した案だけに置き換える ----
    var head = el('article', 'card curation-head');
    head.appendChild(el('p', 'type-chip', d.plan ? '企画' + d.plan.no + '｜' + d.plan.postType : d.release ? '新商品の企画（新作特集）' : d.idea ? '今日の企画｜' + d.idea.postType : '選び方：' + d.typeName));
    var t = planField('企画タイトル', edit.title, { multi: true, max: 60 });
    t.input.classList.add('plan-title-input');
    var editedMark = el('span', 'idea-edited', '手で直しました');
    editedMark.hidden = !edit.edited.title;
    t.field.querySelector('.field-label').appendChild(editedMark);
    head.appendChild(t.field);
    addClear(t.input);
    var suggestBtn = el('button', 'btn btn-secondary plan-suggest-btn', 'AIでタイトルを再提案');
    suggestBtn.type = 'button';
    head.appendChild(suggestBtn);
    var suggestNote = el('p', 'hint', '');
    suggestNote.hidden = true;
    head.appendChild(suggestNote);
    var suggestList = el('div', 'plan-suggest-list');
    head.appendChild(suggestList);

    var anglesBox = el('div', 'angles');
    function drawAngles() {
      anglesBox.innerHTML = '';
      if (!d.angles.length) return;
      anglesBox.appendChild(el('p', 'angles-label', '今回こんな方向から探しました：'));
      var ul = el('ul', 'angle-list');
      d.angles.forEach(function (a) {
        var li = el('li', a.count ? null : 'empty', a.label);
        li.title = a.keyword + (a.count ? '' : '（見つからず）');
        ul.appendChild(li);
      });
      anglesBox.appendChild(ul);
    }
    drawAngles();
    head.appendChild(anglesBox);

    // 企画の内容（サブタイトル・テーマ・方向性・ジャンル・表紙・キャッチコピー）
    var details = el('details', 'plan-details');
    details.open = !d.detailsClosed;
    details.appendChild(el('summary', null, '企画の内容を編集'));
    var fSub = planField('サブタイトル', edit.subtitle, { max: 40, placeholder: '例：迷ったので整理しました' });
    var fTheme = planField('企画テーマ', edit.theme, { max: 30, hint: '表紙・コレクション名に使います（「本気出して考えてみた」の表紙では ○○ の部分）' });
    var fDir = planField('企画の方向性', edit.direction, { multi: true, max: 200, placeholder: '例：大人が普段使いしやすい、落ち着いた色のものだけ', hint: '「さらに10件探す」でも、この方向性で探します' });
    var fGenre = planField('対象ジャンル', edit.genre, { max: 30, placeholder: '例：スニーカー' });
    var styleField = el('label', 'field');
    styleField.appendChild(el('span', 'field-label', '投稿シリーズ・表紙テンプレート'));
    var styleSel = el('select', 'select');
    window.IgRender.COVER_STYLES.forEach(function (s) {
      var o = el('option', null, s.name);
      o.value = s.id;
      styleSel.appendChild(o);
    });
    styleSel.value = edit.coverStyle;
    styleField.appendChild(styleSel);
    var fCatch = planField('キャッチコピー（表紙の大見出し）', edit.catchCopy, { max: 40, placeholder: '空欄なら画像を作るときにAIが考えます', hint: '「本気出して考えてみた」の表紙では使いません' });
    [fSub, fTheme, fDir, fGenre].forEach(function (f) { details.appendChild(f.field); addClear(f.input); });
    details.appendChild(styleField);
    details.appendChild(fCatch.field);
    addClear(fCatch.input);
    head.appendChild(details);
    details.addEventListener('toggle', function () { d.detailsClosed = !details.open; persistSoon(); });
    results.appendChild(head);

    function bind(input, key, after) {
      input.addEventListener('input', function () {
        edit[key] = input.value.trim();
        edit.edited[key] = true;
        if (after) after();
        persistSoon();
      });
      input.addEventListener('change', persist);
    }
    bind(t.input, 'title', function () {
      editedMark.hidden = false;
      // テーマを自分で直していなければ、タイトルに合わせる（本気出して考えてみた の ○○ の部分）
      if (!edit.edited.theme && planSeries(d) === 'serious') { edit.theme = edit.title.replace(SERIES_RE, '').slice(0, 30); fTheme.input.value = edit.theme; }
      if (!edit.edited.catchCopy && d.release) { edit.catchCopy = edit.title.slice(0, 40); fCatch.input.value = edit.catchCopy; }
    });
    bind(fSub.input, 'subtitle');
    bind(fTheme.input, 'theme');
    bind(fDir.input, 'direction');
    bind(fGenre.input, 'genre');
    bind(fCatch.input, 'catchCopy');
    styleSel.addEventListener('change', function () { edit.coverStyle = styleSel.value; edit.edited.coverStyle = true; persist(); });

    function applyTitle(x) {
      if (planSeries(d) === 'serious') {
        edit.title = x.replace(SERIES_RE, '') + SERIES_SUFFIX;
        if (!edit.edited.theme) { edit.theme = x.replace(SERIES_RE, '').slice(0, 30); fTheme.input.value = edit.theme; }
      } else {
        edit.title = x;
        if (d.release && !edit.edited.catchCopy) { edit.catchCopy = x; fCatch.input.value = x; }
      }
      edit.edited.title = true;
      t.input.value = edit.title;
      editedMark.hidden = false;
      persist();
      showToast('タイトルを置き換えました');
    }
    function drawSuggestions() {
      suggestList.innerHTML = '';
      (d.titleSuggestions || []).forEach(function (s) {
        var b = el('button', 'plan-suggest-chip');
        b.type = 'button';
        b.appendChild(el('b', null, planSeries(d) === 'serious' ? s.title + SERIES_SUFFIX : s.title));
        if (s.why) b.appendChild(el('small', null, s.why));
        b.addEventListener('click', function () { applyTitle(s.title); });
        suggestList.appendChild(b);
      });
    }
    drawSuggestions();
    suggestBtn.addEventListener('click', function () {
      suggestBtn.disabled = true;
      suggestBtn.textContent = 'タイトルを考えています…';
      var picks = syncOrder(d);
      var rh = d.release && d.release.hero && edit.heroProduct && sameItem(d.release.hero, edit.heroProduct) ? d.release.hero : null;
      postJson('api/plan-titles', {
        plan: {
          series: planSeries(d), title: edit.title, subtitle: edit.subtitle, theme: edit.theme, direction: edit.direction, genre: edit.genre, catchCopy: edit.catchCopy,
          avoid: (d.titleSuggestions || []).map(function (s) { return s.title; }),
          products: picks.map(function (c) { return { name: c.shortName || c.name, brand: c.brand || '', price: c.price }; }),
          hero: edit.heroProduct ? Object.assign({}, edit.heroProduct, rh ? { status: rh.status || [], releaseDate: rh.releaseDate, releaseMonth: rh.releaseMonth } : {}) : null
        }
      }).then(function (r) {
        if (r.status !== 200) { suggestNote.textContent = (r.data && r.data.error) || 'タイトルを考えられませんでした。'; suggestNote.hidden = false; return; }
        d.titleSuggestions = r.data.titles || [];
        suggestNote.textContent = (r.data.notice ? r.data.notice + ' ' : '') + '使いたい案を押すと置き換えます（押さなければ今のタイトルのまま）。';
        suggestNote.hidden = false;
        drawSuggestions();
        persist();
      }, function () {
        suggestNote.textContent = '通信できませんでした。電波の良い場所でもう一度お試しください。';
        suggestNote.hidden = false;
      }).then(function () {
        suggestBtn.disabled = false;
        suggestBtn.textContent = 'AIでタイトルを再提案';
      });
    });

    // ---- 起点の商品（heroProduct）：編集や商品の追加では変わらない。変える・外すのはユーザーの操作だけ ----
    var heroBox = el('article', 'card plan-hero');
    results.appendChild(heroBox);
    function drawHero() {
      heroBox.innerHTML = '';
      heroBox.appendChild(el('p', 'type-chip', d.release ? '表紙の主役（起点の商品）' : '起点の商品'));
      var h = edit.heroProduct;
      if (!h) {
        heroBox.appendChild(el('p', 'hint', '起点の商品は外しています。「企画に入っている商品」の「起点にする」で選び直せます。関連商品は、企画の先頭の商品を基準に探します。'));
        return;
      }
      var top = el('div', 'cand-top');
      if (h.image) {
        var img = el('img', 'cand-thumb');
        img.src = h.image;
        img.alt = '';
        img.onerror = function () { img.remove(); };
        top.appendChild(img);
      }
      var info = el('div', 'cand-info');
      info.appendChild(el('h3', 'cand-name', String(h.name).replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 60)));
      info.appendChild(el('p', 'cand-meta', [h.brand, h.price ? formatPrice(h.price) : ''].filter(Boolean).join('｜')));
      top.appendChild(info);
      heroBox.appendChild(top);
      heroBox.appendChild(el('p', 'hint', '企画の編集や商品の追加では変わりません。変えるときは「企画に入っている商品」の「起点にする」を押してください。'));
      var off = el('button', 'link-btn', '起点を外す');
      off.type = 'button';
      off.addEventListener('click', function () {
        if (!window.confirm('起点の商品を外しますか？（商品は企画に残ります' + (d.release ? '。表紙の主役は先頭の商品になります' : '') + '）')) return;
        d.candidates.forEach(function (c) { if (isHero(c)) c.pinned = false; });
        edit.heroProduct = null;
        refreshAll();
      });
      heroBox.appendChild(off);
    }

    // ---- 選択バー ----
    var bar = el('div', 'pick-bar');
    var count = el('p', 'pick-count');
    var toPost = el('button', 'btn btn-primary', 'この商品で投稿を作る');
    toPost.type = 'button';
    bar.appendChild(count);
    bar.appendChild(toPost);
    results.appendChild(bar);

    // ---- 企画に入っている商品：並び順・削除・紹介文 ----
    var planBox = el('section', 'card plan-items');
    results.appendChild(planBox);
    function drawPlanItems() {
      planBox.innerHTML = '';
      var items = syncOrder(d);
      planBox.appendChild(el('h3', 'plan-section-title', '企画に入っている商品（' + items.length + '）'));
      if (!items.length) {
        planBox.appendChild(el('p', 'hint', '下の「商品を検索して追加」か「AIが集めた候補」から、企画に入れる商品を選んでください。'));
        return;
      }
      planBox.appendChild(el('p', 'hint', '上の商品ほど大きく紹介します。紹介文を書いた商品は、その文章をそのまま使います（空欄ならAIが作ります）。'));
      items.forEach(function (c, i) {
        var hero = isHero(c);
        var row = el('div', 'plan-item' + (hero ? ' hero' : ''));
        row.appendChild(el('span', 'ig-num', String(i + 1)));
        var img = el('img');
        img.src = c.image || '';
        img.alt = '';
        img.onerror = function () { img.style.visibility = 'hidden'; };
        row.appendChild(img);
        var mid = el('div', 'plan-item-mid');
        if (hero) mid.appendChild(el('p', 'hero-badge', d.release ? '表紙の主役（起点の商品）' : '起点の商品'));
        mid.appendChild(el('p', 'ig-item-name', c.shortName || c.name));
        mid.appendChild(el('p', 'plan-item-meta', [formatPrice(c.price), c.shop].filter(Boolean).join('｜')));
        if (!hero) {
          var mk = el('button', 'link-btn', '起点にする');
          mk.type = 'button';
          mk.addEventListener('click', function () {
            d.candidates.forEach(function (x) { if (isHero(x)) x.pinned = false; });
            edit.heroProduct = heroOf(c);
            showToast('起点の商品を変えました');
            refreshAll();
          });
          mid.appendChild(mk);
        }
        var intro = el('details', 'plan-intro');
        var sum = el('summary', null, c.intro ? '紹介文（' + c.intro.length + '字）' : '紹介文（空欄ならAIが作ります）');
        intro.appendChild(sum);
        var ta = el('textarea', 'textarea');
        ta.rows = 4;
        ta.maxLength = 400;
        ta.value = c.intro || '';
        ta.placeholder = 'ROOM・Instagramで使う紹介文';
        ta.addEventListener('input', function () {
          c.intro = ta.value.trim();
          c.introEdited = !!c.intro;
          sum.textContent = c.intro ? '紹介文（' + c.intro.length + '字）' : '紹介文（空欄ならAIが作ります）';
          persistSoon();
        });
        intro.appendChild(ta);
        mid.appendChild(intro);
        row.appendChild(mid);
        var move = el('div', 'ig-move');
        [['▲', -1], ['▼', 1], ['×', 0]].forEach(function (b) {
          var btn = el('button', null, b[0]);
          btn.type = 'button';
          btn.setAttribute('aria-label', b[1] < 0 ? '上へ' : b[1] > 0 ? '下へ' : '企画から外す');
          if ((b[1] < 0 && i === 0) || (b[1] > 0 && i === items.length - 1)) btn.disabled = true;
          // 新商品の企画では、表紙の主役は先頭から動かさない
          if (d.release && b[1] !== 0 && (hero || (b[1] < 0 && i === 1 && isHero(items[0])))) btn.disabled = true;
          btn.addEventListener('click', function () {
            if (b[1] === 0) {
              if (hero && !window.confirm('この商品は起点の商品です。企画から外すと、起点も外れます。外しますか？')) return;
              if (hero) edit.heroProduct = null;
              c.picked = false;
              c.pinned = false;
            } else {
              var k = d.order.indexOf(candKey(c));
              d.order.splice(k + b[1], 0, d.order.splice(k, 1)[0]);
            }
            refreshAll();
          });
          move.appendChild(btn);
        });
        row.appendChild(move);
        planBox.appendChild(row);
      });
    }

    // ---- 商品を検索して追加（常設）：自分で検索／起点の商品から検索軸を変えて探す ----
    d.search = d.search || { axis: '', keyword: '', items: [], cursor: null, notice: '', analysis: null, minPrice: '', maxPrice: '', sort: '' };
    var S = d.search;
    var searchBox = el('section', 'card plan-search');
    results.appendChild(searchBox);
    searchBox.appendChild(el('h3', 'plan-section-title', '商品を検索して追加'));
    var form = el('form', 'plan-search-form');
    var kwInput = el('input', 'input');
    kwInput.type = 'search';
    kwInput.maxLength = 60;
    kwInput.placeholder = '商品名・ブランド名・型番・キーワード・カテゴリ';
    kwInput.value = S.axis === 'search' ? S.keyword : '';
    kwInput.setAttribute('enterkeyhint', 'search');
    var kwBtn = el('button', 'btn btn-primary', '検索');
    kwBtn.type = 'submit';
    form.appendChild(kwInput);
    form.appendChild(kwBtn);
    searchBox.appendChild(form);
    var opt = el('details', 'plan-search-opt');
    opt.appendChild(el('summary', null, '価格・並び順'));
    var optRow = el('div', 'plan-search-opt-row');
    var minIn = el('input', 'input');
    minIn.type = 'number'; minIn.inputMode = 'numeric'; minIn.placeholder = '下限（円）'; minIn.value = S.minPrice || '';
    var maxIn = el('input', 'input');
    maxIn.type = 'number'; maxIn.inputMode = 'numeric'; maxIn.placeholder = '上限（円）'; maxIn.value = S.maxPrice || '';
    var sortSel = el('select', 'select');
    [['', '関連度順'], ['-updateTimestamp', '新しい順'], ['+itemPrice', '安い順'], ['-itemPrice', '高い順']].forEach(function (o) {
      var x = el('option', null, o[1]);
      x.value = o[0];
      sortSel.appendChild(x);
    });
    sortSel.value = S.sort || '';
    optRow.appendChild(minIn);
    optRow.appendChild(maxIn);
    optRow.appendChild(sortSel);
    opt.appendChild(optRow);
    searchBox.appendChild(opt);

    var refLabel = el('p', 'angles-label', '');
    searchBox.appendChild(refLabel);
    var axisRow = el('div', 'plan-axes');
    var axisBtns = {};
    AXIS_BUTTONS.forEach(function (a) {
      var b = el('button', 'plan-axis', a[1]);
      b.type = 'button';
      b.addEventListener('click', function () { runSearch(a[0], false); });
      axisBtns[a[0]] = b;
      axisRow.appendChild(b);
    });
    searchBox.appendChild(axisRow);
    var searchNote = el('p', 'hint plan-search-note', '');
    searchBox.appendChild(searchNote);
    var resultList = el('div', 'cand-list plan-search-results');
    searchBox.appendChild(resultList);
    var searchMore = el('button', 'btn btn-secondary', 'さらに10件探す');
    searchMore.type = 'button';
    searchBox.appendChild(searchMore);

    function reference() {
      return edit.heroProduct || syncOrder(d)[0] || null;
    }
    function drawRefLabel() {
      var ref = reference();
      refLabel.textContent = ref
        ? '起点の商品から探す（基準：' + String(ref.shortName || ref.name).replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 24) + (edit.heroProduct ? '' : '・企画の先頭の商品') + '）'
        : '起点の商品から探す（企画に商品を入れると使えます）';
      AXIS_BUTTONS.forEach(function (a) {
        axisBtns[a[0]].disabled = !ref;
        axisBtns[a[0]].classList.toggle('active', S.axis === a[0]);
      });
    }

    function resultCard(it) {
      var inPlan = d.candidates.some(function (c) { return c.picked && sameItem(c, it); });
      var card = el('article', 'cand-card search-card' + (inPlan ? ' picked' : ''));
      var top = el('div', 'cand-top');
      if (it.image) {
        var img = el('img', 'cand-thumb');
        img.src = it.image;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function () { img.remove(); };
        top.appendChild(img);
      }
      var info = el('div', 'cand-info');
      var chips = el('div', 'chips');
      if (AXIS_SHORT[it.axis]) chips.appendChild(el('span', 'role', AXIS_SHORT[it.axis]));
      if (it.brand) chips.appendChild(el('span', 'tag', it.brand));
      info.appendChild(chips);
      var nm = el('h3', 'cand-name search-name', it.name);
      info.appendChild(nm);
      var meta = el('p', 'cand-meta');
      meta.appendChild(el('strong', null, formatPrice(it.price)));
      if (it.shop) meta.appendChild(el('span', 'cand-brand', it.shop));
      info.appendChild(meta);
      top.appendChild(info);
      card.appendChild(top);
      var actions = el('div', 'cand-actions');
      var add = el('button', 'btn ' + (inPlan ? 'btn-secondary' : 'btn-primary'), inPlan ? '企画に追加済み' : '企画に追加');
      add.type = 'button';
      add.disabled = inPlan;
      add.addEventListener('click', function () { addToPlan(it, 'search'); });
      actions.appendChild(add);
      var link = el('a', 'btn btn-secondary cand-link', '楽天で見る');
      link.href = it.url;
      link.target = '_blank';
      link.rel = 'noopener';
      actions.appendChild(link);
      card.appendChild(actions);
      return card;
    }
    function drawResults() {
      resultList.innerHTML = '';
      S.items.forEach(function (it) { resultList.appendChild(resultCard(it)); });
      searchMore.hidden = !S.axis || !S.items.length;
      var a = S.analysis;
      var parts = a && S.axis !== 'search' ? [a.brand && 'ブランド ' + a.brand, a.partner && 'コラボ相手 ' + a.partner, a.category && '種類 ' + a.category, a.color && '色 ' + a.color].filter(Boolean) : [];
      searchNote.textContent = [S.notice, parts.length ? '起点の分析：' + parts.join('／') : ''].filter(Boolean).join('　');
      searchNote.hidden = !searchNote.textContent;
      drawRefLabel();
    }

    function setSearching(on) {
      [kwBtn, searchMore].concat(AXIS_BUTTONS.map(function (a) { return axisBtns[a[0]]; })).forEach(function (b) { b.disabled = on; });
      if (on) { searchNote.textContent = '楽天市場で探しています…（5〜15秒）'; searchNote.hidden = false; }
      if (!on) drawRefLabel();
    }

    function runSearch(axis, more) {
      var ref = reference();
      if (axis !== 'search' && !ref) { searchNote.textContent = '基準にする商品がありません。先に企画へ商品を1つ入れてください。'; searchNote.hidden = false; return; }
      if (!more) {
        S.axis = axis;
        S.keyword = axis === 'search' ? kwInput.value.trim() : '';
        S.items = [];
        S.cursor = null;
        S.analysis = null;
      }
      S.minPrice = minIn.value;
      S.maxPrice = maxIn.value;
      S.sort = sortSel.value;
      var refBody = ref ? {
        name: ref.name, code: ref.code || '', url: ref.url || '', price: ref.price || 0, brand: ref.brand || '',
        categoryLabel: d.release && d.release.hero && sameItem(ref, d.release.hero) ? d.release.hero.categoryLabel || '' : ''
      } : null;
      var picks = syncOrder(d);
      var shown = S.items.concat(d.candidates).slice(-280).map(function (x) { return { code: x.code || '', name: String(x.name).slice(0, 80), url: x.url || '' }; });
      setSearching(true);
      postJson('api/search', {
        axis: S.axis, keyword: S.keyword, reference: refBody, cursor: more ? S.cursor : null,
        minPrice: S.axis === 'search' ? S.minPrice : '', maxPrice: S.axis === 'search' ? S.maxPrice : '', sort: S.axis === 'search' ? S.sort : '',
        exclude: picks.map(function (c) { return { code: c.code || '', name: String(c.name).slice(0, 100), url: c.url || '' }; }),
        shown: shown
      }).then(function (r) {
        if (r.status !== 200) {
          S.notice = (r.data && r.data.error) || '検索できませんでした。もう一度お試しください。';
        } else {
          S.items = S.items.concat(r.data.items || []);
          S.cursor = r.data.cursor || null;
          S.axis = r.data.axis || S.axis;
          S.analysis = r.data.analysis || S.analysis;
          S.notice = r.data.notice || ((r.data.items || []).length + '件見つかりました');
        }
        setSearching(false);
        drawResults();
        persist();
      }, function () {
        S.notice = '通信できませんでした。電波の良い場所でもう一度お試しください。';
        setSearching(false);
        drawResults();
      });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (kwInput.value.trim().replace(/\s/g, '').length < 2) { searchNote.textContent = '2文字以上入れてください（商品名・ブランド名・型番・カテゴリなど）'; searchNote.hidden = false; return; }
      kwInput.blur();
      runSearch('search', false);
    });
    searchMore.addEventListener('click', function () { runSearch(S.axis, true); });

    // 楽天にない新商品：公式サイトの商品URLから登録（読めない項目は手入力）
    var official = el('details', 'plan-official');
    official.appendChild(el('summary', null, '楽天にない新商品を公式URLから登録'));
    var oUrl = planField('公式サイトの商品ページURL', '', { max: 500, placeholder: 'https://' });
    oUrl.input.type = 'url';
    official.appendChild(oUrl.field);
    var oLoad = el('button', 'btn btn-secondary', 'ページから読み込む');
    oLoad.type = 'button';
    official.appendChild(oLoad);
    var oNote = el('p', 'hint', '商品名・画像・価格を読み取ります。読めなかった項目は手で入れてください。ROOMに登録できるのは楽天の商品だけです。');
    official.appendChild(oNote);
    var oName = planField('商品名', '', { max: 120 });
    var oPrice = planField('価格（円）', '', { max: 9 });
    oPrice.input.inputMode = 'numeric';
    var oImage = planField('画像URL', '', { max: 500, placeholder: 'https://' });
    var oShop = planField('販売元・ブランド', '', { max: 60 });
    [oName, oPrice, oImage, oShop].forEach(function (f) { official.appendChild(f.field); });
    var oAdd = el('button', 'btn btn-primary', 'この内容で企画に追加');
    oAdd.type = 'button';
    official.appendChild(oAdd);
    searchBox.appendChild(official);
    oLoad.addEventListener('click', function () {
      var u = oUrl.input.value.trim();
      if (!/^https:\/\//.test(u)) { oNote.textContent = 'https:// で始まるURLを入れてください'; return; }
      oLoad.disabled = true;
      oNote.textContent = '読み込んでいます…';
      postJson('api/product-url', { url: u }).then(function (r) {
        if (r.status !== 200) { oNote.textContent = ((r.data && r.data.error) || '読み込めませんでした') + '。手で入れて追加できます。'; return; }
        var p = r.data.product || {};
        oName.input.value = p.name || '';
        oPrice.input.value = p.price || '';
        oImage.input.value = p.image || '';
        oShop.input.value = p.brand || p.shop || '';
        oNote.textContent = r.data.notice || '読み込みました。内容を確認して追加してください。';
      }, function () { oNote.textContent = '通信できませんでした。'; }).then(function () { oLoad.disabled = false; });
    });
    oAdd.addEventListener('click', function () {
      var u = oUrl.input.value.trim();
      var name = oName.input.value.trim();
      if (!/^https:\/\//.test(u) || !name) { oNote.textContent = 'URL（https://）と商品名は必ず入れてください'; return; }
      var image = oImage.input.value.trim();
      addToPlan({ code: '', url: u, name: name, price: Math.round(Number(String(oPrice.input.value).replace(/[^\d]/g, ''))) || 0, image: /^https:\/\//.test(image) ? image : '', shop: oShop.input.value.trim(), brand: oShop.input.value.trim(), axis: '' }, 'official');
      [oUrl, oName, oPrice, oImage, oShop].forEach(function (f) { f.input.value = ''; });
      oNote.textContent = '追加しました。';
    });

    // 検索結果・公式URLの商品を企画に入れる（タイトル・ほかの商品・起点の商品はそのまま）
    function addToPlan(it, source) {
      var c = d.candidates.filter(function (x) { return sameItem(x, it); })[0];
      if (c && c.picked) { showToast('すでに企画に入っています'); return; }
      if (syncOrder(d).length >= MAX_POST_ITEMS) { showToast('1投稿にまとめられるのは' + MAX_POST_ITEMS + '商品までです'); return; }
      if (!c) {
        c = {
          code: it.code || '', name: it.name, price: it.price || 0, url: it.url, image: it.image || '', shop: it.shop || '',
          shortName: '', brand: it.brand || '', role: source === 'official' ? '公式サイト' : '自分で追加', tags: [], kind: '',
          reason: '', memo: '', angle: AXIS_SHORT[it.axis] || '', seenBefore: false, caption: it.caption || '', added: true, source: source
        };
        d.candidates.push(c);
      }
      c.picked = true;
      showToast('企画に追加しました');
      refreshAll();
      drawResults();
    }

    // ---- AIが集めた候補 ----
    results.appendChild(el('h3', 'plan-section-title plan-cands-title', 'AIが集めた候補'));
    var controls = el('label', 'cand-view');
    controls.appendChild(el('span', null, '並び替え・絞り込み'));
    var select = el('select', 'select');
    VIEWS.forEach(function (v) {
      var o = el('option', null, v[1]);
      o.value = v[0];
      select.appendChild(o);
    });
    select.value = d.view || 'recommend';
    controls.appendChild(select);
    results.appendChild(controls);

    var list = el('div', 'cand-list');
    results.appendChild(list);

    var moreBox = el('div', 'more-box');
    var moreBtn = el('button', 'btn btn-secondary', 'さらに10件探す');
    moreBtn.type = 'button';
    var moreNote = el('p', 'hint', 'すでに出た商品を避けて、別の方向から探します');
    moreBox.appendChild(moreBtn);
    moreBox.appendChild(moreNote);
    results.appendChild(moreBox);

    function picked() { return syncOrder(d); }
    update.count = function () { return picked().length; };
    function update() {
      var n = picked().length;
      count.textContent = '選択中 ' + n + ' / ' + MAX_POST_ITEMS;
      bar.classList.toggle('ok', n >= 4 && n <= MAX_POST_ITEMS);
      bar.classList.toggle('over', n > MAX_POST_ITEMS);
      toPost.disabled = n === 0;
      toPost.textContent = n > 6 ? '1投稿にまとめる（' + n + '商品）' : 'この商品で投稿を作る';
      drawPlanItems();
      drawRefLabel();
      persist();
    }
    function draw() {
      list.innerHTML = '';
      var view = viewCandidates(d.candidates, d.view || 'recommend');
      if (!view.length) list.appendChild(el('p', 'manage-empty', 'この絞り込みに当てはまる候補はありません。'));
      view.forEach(function (c) { list.appendChild(candidateCard(c, update)); });
    }
    function refreshAll() {
      drawHero();
      draw();
      update();
    }
    select.addEventListener('change', function () { d.view = select.value; draw(); persist(); });

    moreBtn.addEventListener('click', function () {
      moreBtn.disabled = true;
      moreBtn.textContent = '探しています…（30〜60秒）';
      moreNote.textContent = '';
      // 直したタイトル・ジャンル・方向性で探す
      var brief = Object.assign({}, d.brief, {
        title: edit.title || d.brief.title,
        genre: edit.genre,
        note: [d.brief.note, edit.direction && '企画の方向性（最優先）: ' + edit.direction].filter(Boolean).join('\n').slice(-400)
      });
      seenForSearch().then(function (seen) {
        return postJson('api/explore', {
          more: { brief: brief, angles: d.angles },
          exclude: { codes: d.candidates.map(function (c) { return c.code; }).filter(Boolean), names: d.candidates.map(function (c) { return c.name; }) },
          seen: seen
        });
      }).then(function (r) {
        var added = (r.data && r.data.candidates) || [];
        if (r.status !== 200 || !added.length) {
          moreNote.textContent = (r.data && (r.data.error || r.data.notice)) || '新しい候補が見つかりませんでした。';
          return;
        }
        markSeen(added, 'shown');
        d.candidates = d.candidates.concat(added);
        d.angles = d.angles.concat(r.data.angles || []);
        drawAngles();
        draw();
        update();
        showToast(added.length + '件追加しました');
        moreNote.textContent = r.data.notice || 'すでに出た商品を避けて、別の方向から探します';
      }, function () {
        moreNote.textContent = '通信できませんでした。電波の良い場所でもう一度お試しください。';
      }).then(function () {
        moreBtn.disabled = false;
        moreBtn.textContent = 'さらに10件探す';
      });
    });

    toPost.addEventListener('click', function () {
      var items = picked();
      if (!items.length) return;
      persist();
      // 紹介文：自分で書いた・前に作った紹介文はそのまま使い、無い商品の分だけAIで作る（料金を抑える）
      var need = items.filter(function (c) { return !c.intro; });
      toPost.disabled = true;
      toPost.textContent = need.length ? 'ROOM紹介文を作っています…（' + need.length + '商品）' : '投稿の準備をしています…';
      var chunks = [];
      for (var i = 0; i < need.length; i += 8) chunks.push(need.slice(i, i + 8));
      Promise.all(chunks.map(function (chunk) {
        return postJson('api/intros', {
          title: edit.title || d.title,
          items: chunk.map(function (c) { return { name: c.name, price: c.price, role: c.role, brand: c.brand, reason: c.reason, caption: c.caption }; })
        });
      })).then(function (rs) {
        var simple = false;
        rs.forEach(function (r, k) {
          var got = (r.data && r.data.intros) || [];
          chunks[k].forEach(function (c, j) { if (got[j]) c.intro = got[j]; });
          if (r.status !== 200 || (r.data && r.data.notice)) simple = true;
        });
        if (simple) showToast('一部の紹介文は作れなかった・簡易的に作ったので、ROOM登録準備の画面で確認してください');
        persist();
        composeFromExplore(d, items, items.map(function (c) { return c.intro || ''; }));
      }, function () {
        showToast('通信できませんでした。電波の良い場所でもう一度お試しください。');
      }).then(function () {
        toPost.disabled = false;
        toPost.textContent = 'この商品で投稿を作る';
      });
    });

    drawHero();
    drawResults();
    draw();
    update();
    renderPlanDrafts();
  }

  function findHero(items, hero) {
    for (var i = 0; i < items.length; i++) {
      if ((hero.code && items[i].code === hero.code) || (hero.url && items[i].url === hero.url)) return i;
    }
    return -1;
  }
  // i番目の商品を主役にして先頭へ
  function setHero(i) {
    var it = draft.items.splice(i, 1)[0];
    draft.items.forEach(function (x) { x.hero = false; });
    it.hero = true;
    draft.items.unshift(it);
    draft.heroProduct = { code: it.code, url: it.url, name: it.name, brand: it.brand, price: it.price, image: it.image };
  }

  // 長いタイトルを表紙用に2行に分ける（読点・句点のあと）
  function splitCoverTitle(t) {
    var s = String(t || '').slice(0, 30);
    var m = s.match(/^(.{4,16}?[、。！？!?])(.+)$/);
    return m ? m[1] + '\n' + m[2] : s;
  }

  // 選んだ商品と企画の情報を持って、Instagram画像づくりへ
  function composeFromExplore(d, items, intros) {
    loadDraft();
    var edit = initEdit(d);
    draft.coord = null;
    draft.items = items.map(function (c, i) {
      return { id: c.code || c.url, code: c.code, name: c.name, price: c.price, image: c.image, url: c.url, reason: c.reason || '', intro: intros[i] || '', role: c.postRole || (c.role === '自分で追加' || c.role === '公式サイト' ? '' : c.role) || c.angle || '', memo: c.memo || '', brand: c.brand || '' };
    });
    draft.postId = d.idea || d.plan ? currentPostId() : '';
    // 企画の編集画面で直した内容（タイトル・テーマ・サブタイトル・ジャンル・表紙・キャッチコピー）をそのまま使う
    draft.genre = edit.genre || (d.idea ? d.idea.genre || '' : '');
    draft.postType = d.idea ? d.idea.postType : d.plan ? d.plan.postType : '';
    draft.planId = d.plan ? d.plan.id : '';
    draft.theme = (edit.theme || String(edit.title || d.title || '').replace(/(について)?本気出して考えてみた$/, '')).slice(0, 30);
    draft.subtitle = edit.subtitle || '';
    draft.category = d.plan && !edit.edited.genre ? d.plan.category || ''
      : !d.idea && !d.plan && !edit.edited.genre && !edit.edited.theme ? '' // 条件指定で探したときは今までどおり空欄
        : draft.theme.length <= 8 ? draft.theme : (edit.genre || '').split('・')[0];
    draft.layoutSizes = null;
    // 表紙：企画で選んだシリーズ（表紙テンプレート）。文字は画像を作るときにAIが作る（キャッチコピーを書いたときはそれを使う）
    draft.coverStyle = edit.coverStyle || d.coverStyle || 'serious_think';
    draft.coverTitle = edit.catchCopy ? (d.release ? splitCoverTitle(edit.catchCopy) : edit.catchCopy) : '';
    // 新商品の企画：表紙に、確認できた情報（ラベル・ブランド・発売日）と、選んだタイトルをそのまま使う
    draft.release = d.release || null;
    if (d.release && !draft.coverTitle) draft.coverTitle = splitCoverTitle(edit.title || d.title);
    // 新商品の企画：起点の商品（heroProduct）を表紙の主役にし、本文でも最初に紹介する。
    // ユーザーが起点を外したときだけ、主役なし（先頭の商品が表紙）
    draft.heroProduct = null;
    var heroAt = d.release && edit.heroProduct ? findHero(draft.items, edit.heroProduct) : -1;
    if (heroAt !== -1) setHero(heroAt);
    draft.coverAccent = '';
    var b = d.brief || {};
    draft.priceBand = b.priceBand || (b.minPrice || b.maxPrice ? (b.minPrice || '') + '〜' + (b.maxPrice || '') + '円' : '');
    // 2枚目の「まとめ」は、選んだ商品に合わせてAIに作ってもらう
    draft.summary = { enabled: true, typeName: d.typeName || '', title: '', lead: '', verdict: '' };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    // 投稿管理にも「Instagram投稿待ち」として入れておく
    Promise.all(draft.items.map(function (p) { return Store.setStatus(p, 'ig_waiting'); })).then(updateManageCount, function () {});
    if (draft.postId) {
      History.update(draft.postId, {
        title: edit.title || d.title, topic: draft.theme, subtitle: draft.subtitle,
        products: draft.items.map(function (p) { return { name: p.name, brand: p.brand, price: p.price }; }),
        brands: draft.items.map(function (p) { return p.brand; }).filter(Boolean)
      });
    }
    markSeen(items, 'ig');
    location.hash = '#compose';
  }

  // ---- AIコーデスタジオ（フェーズ1）：起点のファッションアイテムから、実在の商品で全身コーデを3パターン ----
  // AIはコーデの方向性と検索語だけを考え、商品は楽天の検索結果から入る。起点のアイテムは heroProduct として保持する。
  var FASHION_RE = /スニーカー|シューズ|ブーツ|ローファー|サンダル|パンプス|スリッポン|革靴|バッグ|リュック|バックパック|トート|サコッシュ|ジャケット|コート|ダウン|ブルゾン|パーカー|フリース|Tシャツ|ロンT|シャツ|ブラウス|ニット|カーディガン|スウェット|トレーナー|パンツ|ジーンズ|デニム|スラックス|チノ|スカート|ワンピース|キャップ|帽子|ハット|ビーニー|ネックレス|ピアス|イヤリング|リング|ブレスレット|腕時計|サングラス|マフラー|ストール/;
  var FASHION_CATS = ['mens', 'ladies', 'sneaker', 'shoes', 'bag', 'wallet', 'accessory', 'watch', 'sunglasses'];
  function isFashion(name, category) {
    return FASHION_CATS.indexOf(category || '') !== -1 || FASHION_RE.test(String(name || ''));
  }
  var COORD_STYLES = ['おまかせ', 'きれいめ', '大人カジュアル', 'ストリート', 'シンプル', '韓国系', 'モード', 'アメカジ', 'アウトドア'];
  var COORD_SEASONS = ['おまかせ', '春', '夏', '秋', '冬', 'オールシーズン'];
  var COORD_BUDGETS = [['none', '指定なし'], ['10000', '1万円以内'], ['30000', '3万円以内'], ['50000', '5万円以内'], ['100000', '10万円以内']];

  // product: { name, code, price, url, image, shop, brand, categoryLabel }
  function startCoord(product) {
    message.hidden = true;
    genreEl.hidden = true;
    results.innerHTML = '';
    var view = {
      id: 'co' + Date.now().toString(36),
      heroProduct: {
        name: product.name, code: product.code || '', price: product.price || 0, url: product.url || '', image: product.image || '',
        shop: product.shop || '', brand: product.brand || '', categoryLabel: product.categoryLabel || '', caption: String(product.caption || '').slice(0, 200),
        labels: product.labels || [], dateText: product.dateText || ''
      },
      conditions: { gender: '', style: 'おまかせ', season: 'おまかせ', budget: 'none', age: '', scene: '', likeBrands: '', avoidBrands: '', colors: '' },
      looks: [], notice: '', createdAt: Date.now()
    };
    saveLast('coord', view);
    renderCoord(view);
    window.scrollTo({ top: results.offsetTop - 8, behavior: 'smooth' });
  }

  function coordProductRow(p, label, opts) {
    opts = opts || {};
    var row = el('div', 'coord-item' + (opts.hero ? ' hero' : ''));
    var img = el('img', 'coord-thumb');
    img.src = p.image || '';
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = function () { img.style.visibility = 'hidden'; };
    row.appendChild(img);
    var mid = el('div', 'coord-item-mid');
    var chips = el('div', 'chips');
    chips.appendChild(el('span', opts.hero ? 'hero-badge' : 'role', label));
    if (p.brand) chips.appendChild(el('span', 'tag', p.brand));
    mid.appendChild(chips);
    var nm = el('p', 'coord-name', p.name);
    mid.appendChild(nm);
    var meta = el('p', 'coord-meta');
    meta.appendChild(el('strong', null, formatPrice(p.price)));
    if (p.shop) meta.appendChild(el('span', null, p.shop));
    mid.appendChild(meta);
    if (p.url) {
      var a = el('a', 'link-btn coord-link', '商品ページを見る');
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noopener';
      mid.appendChild(a);
    }
    row.appendChild(mid);
    return row;
  }

  // 種類（パンツ・バッグ…）から枠を決める（サーバーの lib/coord.js の slotOf と同じ考え方）
  var COORD_SLOT_RULES = [
    ['shoes', '靴', /スニーカー|シューズ|ブーツ|ローファー|サンダル|パンプス|スリッポン|革靴|靴(?!下)/],
    ['bag', 'バッグ', /バッグ|リュック|バックパック|トート|ショルダー|サコッシュ|ポーチ|ボストン/],
    ['onepiece', 'ワンピース', /ワンピース|オールインワン|サロペット/],
    ['outer', 'アウター', /ジャケット|コート|ダウン|ブルゾン|マウンテンパーカー|フリース|アウター/],
    ['bottoms', 'ボトムス', /パンツ|ジーンズ|デニム|スラックス?|チノ|スカート|ショーツ/],
    ['tops', 'トップス', /Tシャツ|ロンT|パーカー|スウェット|トレーナー|ニット|カーディガン|シャツ|ブラウス|ベスト|トップス|カットソー/],
    ['hat', '帽子', /キャップ|ニット帽|ビーニー|ハット|帽子/],
    ['accessory', 'アクセサリー', /ネックレス|ピアス|イヤリング|リング|ブレスレット|腕時計|時計|サングラス|メガネ|眼鏡|マフラー|ストール|手袋|ソックス|靴下|ベルト|財布/]
  ];
  function coordSlotOf(name) {
    var s = String(name || '').normalize('NFKC');
    for (var i = 0; i < COORD_SLOT_RULES.length; i++) {
      var m = s.match(COORD_SLOT_RULES[i][2]);
      if (m) return { slot: COORD_SLOT_RULES[i][0], slotLabel: COORD_SLOT_RULES[i][1], kind: m[0] };
    }
    return { slot: 'accessory', slotLabel: 'アイテム', kind: 'アイテム' };
  }
  function coordTotal(view, look) {
    return (view.heroProduct.price || 0) + look.items.reduce(function (s, it) { return s + (it.product ? it.product.price || 0 : 0); }, 0);
  }
  function coordTitleOf(view) {
    var h = view.heroProduct;
    return view.title || ((h.brand ? h.brand + 'の' : '') + coordSlotOf(h.name).kind + 'で作るコーデ');
  }

  // 保存したコーデの一覧（商品発掘の画面の上）。開くと、続きから編集できる
  var coordSavedEl = document.getElementById('coord-saved');
  function renderCoordSaved() {
    if (!coordSavedEl || !window.CoordStore) return;
    var list = window.CoordStore.list();
    coordSavedEl.innerHTML = '';
    coordSavedEl.hidden = !list.length;
    if (!list.length) return;
    var box = el('details', 'plan-drafts-box');
    box.appendChild(el('summary', null, '保存したコーデ（' + list.length + '）'));
    list.forEach(function (v) {
      var row = el('div', 'plan-draft-row');
      var open = el('button', 'plan-draft-open');
      open.type = 'button';
      open.appendChild(el('b', null, coordTitleOf(v)));
      open.appendChild(el('small', null, (v.looks || []).length + 'パターン｜' + new Date(v.updatedAt || v.createdAt).toLocaleDateString('ja-JP') + (v.igStatus === 'posted' ? '｜Instagram投稿済み' : '')));
      open.addEventListener('click', function () {
        var x = window.CoordStore.get(v.id);
        if (!x) return;
        message.hidden = true;
        genreEl.hidden = true;
        results.innerHTML = '';
        saveLast('coord', x);
        renderCoord(x);
        window.scrollTo({ top: results.offsetTop - 8, behavior: 'smooth' });
      });
      var del = el('button', 'link-btn', '削除');
      del.type = 'button';
      del.addEventListener('click', function () {
        if (!window.confirm('「' + coordTitleOf(v) + '」を削除しますか？')) return;
        window.CoordStore.remove(v.id);
        renderCoordSaved();
      });
      row.appendChild(open);
      row.appendChild(del);
      box.appendChild(row);
    });
    coordSavedEl.appendChild(box);
  }

  function renderCoord(view) {
    var c = view.conditions;
    var h = view.heroProduct;
    view.title = view.title || '';
    view.igStatus = view.igStatus || 'none';
    // 編集の保存：画面の続き（再読み込み用）と、保存したコーデの両方に入れる（3パターンを作ったあとは自動で保存）
    function persist() {
      view.updatedAt = Date.now();
      if (typeof drawPostBox === 'function' && postBox) drawPostBox();
      saveLast('coord', view);
      if (view.looks.length || view.title) { window.CoordStore.save(view); renderCoordSaved(); }
    }
    function markEdited(look) { look.edited = true; }

    var head = el('article', 'card curation-head');
    head.appendChild(el('p', 'type-chip', 'AIコーデスタジオ'));
    var tf = el('label', 'field');
    tf.appendChild(el('span', 'field-label', 'コーデ名（企画タイトル）'));
    var titleIn = el('input', 'input plan-title-input');
    titleIn.type = 'text';
    titleIn.maxLength = 40;
    titleIn.placeholder = coordTitleOf({ heroProduct: h });
    titleIn.value = view.title;
    titleIn.addEventListener('input', function () { view.title = titleIn.value.trim(); persist(); });
    tf.appendChild(titleIn);
    head.appendChild(tf);
    addClear(titleIn);
    head.appendChild(coordProductRow(h, '起点のアイテム', { hero: true }));
    head.appendChild(el('p', 'hint', 'AIが考えるのはコーデの方向性と探す言葉だけです。商品はすべて楽天市場で実際に売られているものから探します。入れた商品は、あなたが変えない限りAIが勝手に変えることはありません。'));
    results.appendChild(head);

    // 条件（すべて空欄でも、AIがおまかせで提案する）
    var form = el('details', 'card coord-cond');
    form.open = !view.looks.length;
    form.appendChild(el('summary', null, 'コーデの条件（空欄ならおまかせ）'));
    var grid = el('div', 'coord-cond-grid');
    function sel(label, key, options) {
      var f = el('label', 'field');
      f.appendChild(el('span', 'field-label', label));
      var s = el('select', 'select');
      options.forEach(function (o) {
        var opt = el('option', null, Array.isArray(o) ? o[1] : o);
        opt.value = Array.isArray(o) ? o[0] : o;
        s.appendChild(opt);
      });
      s.value = c[key];
      s.addEventListener('change', function () { c[key] = s.value; persist(); });
      f.appendChild(s);
      grid.appendChild(f);
    }
    function txt(label, key, placeholder) {
      var f = el('label', 'field');
      f.appendChild(el('span', 'field-label', label));
      var i = el('input', 'input');
      i.type = 'text';
      i.maxLength = 60;
      i.placeholder = placeholder;
      i.value = c[key] || '';
      i.addEventListener('input', function () { c[key] = i.value.trim(); persist(); });
      f.appendChild(i);
      grid.appendChild(f);
    }
    sel('メンズ・レディース', 'gender', [['', 'おまかせ（商品から判断）'], ['mens', 'メンズ'], ['ladies', 'レディース']]);
    sel('スタイル', 'style', COORD_STYLES);
    sel('季節', 'season', COORD_SEASONS);
    sel('予算（全身）', 'budget', COORD_BUDGETS);
    txt('年齢層', 'age', '例：30代');
    txt('着用シーン', 'scene', '例：休日の買い物、オフィスカジュアル');
    txt('好きなブランド', 'likeBrands', '例：BEAMS、URBAN RESEARCH');
    txt('避けたいブランド', 'avoidBrands', '例：ロゴが大きいブランド名');
    txt('色の好み', 'colors', '例：黒・グレー中心、差し色なし');
    form.appendChild(grid);
    var go = el('button', 'btn btn-primary', '');
    go.type = 'button';
    form.appendChild(go);
    var goNote = el('p', 'hint', '');
    form.appendChild(goNote);
    function drawGo() {
      var kept = view.looks.filter(function (l) { return l.edited; }).length;
      go.textContent = !view.looks.length ? 'コーデを3パターン提案してもらう' : kept >= view.looks.length ? '手で編集していないコーデがありません' : 'この条件で作り直す（編集したコーデは残す）';
      go.disabled = view.looks.length > 0 && kept >= view.looks.length;
      goNote.textContent = view.looks.length ? '作り直すのは、まだ手で編集していないコーデだけです。自分で入れ替え・追加・削除をしたコーデはそのまま残ります。' : '';
    }
    drawGo();
    results.appendChild(form);

    var body = el('div', 'coord-looks');
    results.appendChild(body);

    // ---- 商品を検索して、入れ替える・追加する（常設） ----
    var S = view.search = view.search || { keyword: '', maxPrice: '', items: [], target: null, lookId: '' };
    var sbox = el('section', 'card plan-search coord-search');
    sbox.appendChild(el('h3', 'plan-section-title', '商品を検索して入れ替える・追加する'));
    var targetLine = el('div', 'coord-target');
    sbox.appendChild(targetLine);
    var sform = el('form', 'plan-search-form');
    var kw = el('input', 'input');
    kw.type = 'search';
    kw.maxLength = 60;
    kw.placeholder = '商品名・ブランド名・キーワード（例：メンズ ワイドスラックス 黒）';
    kw.value = S.keyword;
    kw.setAttribute('enterkeyhint', 'search');
    var kwBtn = el('button', 'btn btn-primary', '検索');
    kwBtn.type = 'submit';
    sform.appendChild(kw);
    sform.appendChild(kwBtn);
    sbox.appendChild(sform);
    var capRow = el('div', 'coord-cap-row');
    var capIn = el('input', 'input');
    capIn.type = 'number';
    capIn.inputMode = 'numeric';
    capIn.placeholder = '上限の価格（円・空欄なら指定なし）';
    capIn.value = S.maxPrice || '';
    capIn.addEventListener('input', function () { S.maxPrice = capIn.value; });
    capRow.appendChild(capIn);
    sbox.appendChild(capRow);
    var snote = el('p', 'hint', '');
    sbox.appendChild(snote);
    var sres = el('div', 'cand-list plan-search-results');
    sbox.appendChild(sres);
    var smore = el('button', 'btn btn-secondary', 'さらに10件探す');
    smore.type = 'button';
    sbox.appendChild(smore);

    function lookById(id) { return view.looks.filter(function (l) { return l.id === id; })[0] || view.looks[0] || null; }
    function drawTarget() {
      targetLine.innerHTML = '';
      if (!view.looks.length) { targetLine.appendChild(el('p', 'hint', '先にコーデを提案してもらうか、「空のコーデを追加」で自分で作り始めてください。')); return; }
      var t = S.target && lookById(S.target.lookId);
      var item = t && t.items[S.target.index];
      if (item) {
        var p = el('p', 'coord-target-text');
        p.appendChild(document.createTextNode('入れ替え先：コーデ' + String.fromCharCode(65 + view.looks.indexOf(t)) + ' の '));
        p.appendChild(el('b', null, item.slotLabel + '（' + item.kind + '）'));
        var cancel = el('button', 'link-btn', '入れ替えをやめる');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { S.target = null; drawTarget(); drawResults(); persist(); });
        p.appendChild(cancel);
        targetLine.appendChild(p);
      }
      var f = el('label', 'field coord-add-to');
      f.appendChild(el('span', 'field-label', '「コーデに追加」の追加先'));
      var s = el('select', 'select');
      view.looks.forEach(function (l, i) {
        var o = el('option', null, 'コーデ' + String.fromCharCode(65 + i) + '：' + (l.name || '').slice(0, 20));
        o.value = l.id;
        s.appendChild(o);
      });
      s.value = (lookById(S.lookId) || {}).id || '';
      s.addEventListener('change', function () { S.lookId = s.value; persist(); });
      f.appendChild(s);
      targetLine.appendChild(f);
    }

    function inLook(look, p) {
      return look && (sameItem(h, p) || look.items.some(function (it) { return it.product && sameItem(it.product, p); }));
    }
    function toCoordProduct(it) {
      return { code: it.code || '', name: it.name, brand: it.brand || '', price: it.price || 0, image: it.image || '', url: it.url || '', shop: it.shop || '', caption: String(it.caption || '').slice(0, 200), fetchedAt: new Date().toISOString() };
    }
    function drawResults() {
      sres.innerHTML = '';
      smore.hidden = !S.items.length;
      var t = S.target && lookById(S.target.lookId);
      var targetItem = t && t.items[S.target.index];
      var addLook = lookById(S.lookId);
      S.items.forEach(function (it) {
        var card = el('article', 'cand-card');
        var top = el('div', 'cand-top');
        var img = el('img', 'cand-thumb');
        img.src = it.image || '';
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function () { img.style.visibility = 'hidden'; };
        top.appendChild(img);
        var info = el('div', 'cand-info');
        info.appendChild(el('h3', 'cand-name', it.name.replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 60)));
        var meta = el('p', 'cand-meta');
        meta.appendChild(el('strong', 'cand-price', formatPrice(it.price)));
        meta.appendChild(el('span', 'cand-shop', it.shop || ''));
        info.appendChild(meta);
        top.appendChild(info);
        card.appendChild(top);
        var acts = el('div', 'actions');
        var rep = el('button', 'btn btn-primary', targetItem ? 'このアイテムと入れ替える' : '入れ替え先を選んでください');
        rep.type = 'button';
        rep.disabled = !targetItem || inLook(t, it);
        rep.addEventListener('click', function () {
          var s = coordSlotOf(it.name);
          targetItem.product = toCoordProduct(it);
          targetItem.source = 'user';
          // 違う種類の商品で入れ替えたときは、枠の名前も商品に合わせる（例：バッグの枠にパンツ → ボトムス）
          if (s.slotLabel !== 'アイテム' && s.slot !== targetItem.slot) { targetItem.slot = s.slot; targetItem.slotLabel = s.slotLabel; targetItem.kind = s.kind; }
          markEdited(t);
          S.target = null;
          persist();
          drawLooks();
          drawTarget();
          drawResults();
          showToast('入れ替えました（ほかのアイテムはそのまま）');
        });
        var add = el('button', 'btn btn-secondary', inLook(addLook, it) ? 'コーデに追加済み' : 'コーデに追加');
        add.type = 'button';
        add.disabled = !addLook || inLook(addLook, it);
        add.addEventListener('click', function () {
          var s = coordSlotOf(it.name);
          addLook.items.push({ slot: s.slot, slotLabel: s.slotLabel, kind: s.kind, keyword: S.keyword, color: '', cap: null, product: toCoordProduct(it), options: [], source: 'user' });
          markEdited(addLook);
          persist();
          drawLooks();
          drawResults();
          showToast('コーデ' + String.fromCharCode(65 + view.looks.indexOf(addLook)) + 'に追加しました');
        });
        acts.appendChild(rep);
        acts.appendChild(add);
        if (it.url) {
          var a = el('a', 'link-btn', '商品ページを見る');
          a.href = it.url;
          a.target = '_blank';
          a.rel = 'noopener';
          acts.appendChild(a);
        }
        card.appendChild(acts);
        sres.appendChild(card);
      });
    }
    function runSearch(more) {
      var q = kw.value.trim();
      if (q.replace(/\s/g, '').length < 2) { snote.textContent = '2文字以上入れてください（商品名・ブランド名・キーワード）'; return; }
      S.keyword = q;
      if (!more) S.items = [];
      kwBtn.disabled = smore.disabled = true;
      snote.textContent = '楽天市場で探しています…';
      var exclude = [h];
      view.looks.forEach(function (l) { l.items.forEach(function (it) { if (it.product) exclude.push(it.product); }); });
      postJson('api/search', {
        axis: 'search', keyword: q, maxPrice: S.maxPrice || undefined,
        exclude: exclude.slice(0, 40).map(function (p) { return { code: p.code, name: p.name, url: p.url }; }),
        shown: S.items.map(function (p) { return { code: p.code, name: p.name, url: p.url }; })
      }).then(function (r) {
        if (r.status !== 200) { snote.textContent = (r.data && r.data.error) || '検索できませんでした。'; return; }
        var got = r.data.items || [];
        S.items = S.items.concat(got);
        snote.textContent = got.length ? got.length + '件見つかりました' + (more ? '（表示済みの商品は除いています）' : '') : (r.data.notice || '見つかりませんでした。言葉を変えてみてください。');
        persist();
        drawResults();
      }, function () {
        snote.textContent = '通信できませんでした。電波の良い場所でもう一度お試しください。';
      }).then(function () { kwBtn.disabled = smore.disabled = false; });
    }
    sform.addEventListener('submit', function (e) { e.preventDefault(); runSearch(false); });
    smore.addEventListener('click', function () { runSearch(true); });
    addClear(kw);

    // 入れ替えを始める：その枠の種類・色・性別の言葉を検索欄に入れて、検索欄へ移る（言葉は自由に直せる）
    function startReplace(look, index) {
      var it = look.items[index];
      S.target = { lookId: look.id, index: index };
      S.lookId = look.id;
      var g = view.gender === 'mens' ? 'メンズ' : view.gender === 'ladies' ? 'レディース' : '';
      kw.value = [g, it.color, it.kind].filter(Boolean).join(' ');
      drawTarget();
      drawResults();
      sbox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      kw.focus();
    }

    // AI着用イメージの欄（コーデ1つ分）
    var tryOnMeta = null;
    var tryOnBusy = false;
    function tryOnSection(look) {
      var box = el('details', 'coord-tryon');
      box.open = !!(view.images || []).some(function (x) { return x.lookId === look.id; });
      box.appendChild(el('summary', null, 'AI着用イメージ（完成コーデの予想）'));
      box.appendChild(el('p', 'hint', '選んだ実在の商品の写真を参考に、AIが全身の着用イメージを作ります。ロゴ・柄・細部・色味は実物と違うことがあります。実際の商品写真ではありません。'));
      var T = look.tryon = look.tryon || { background: 'studio', pose: 'front', quality: 'low', variant: 1 };
      var grid = el('div', 'coord-cond-grid');
      function pick(label, key, options) {
        var f = el('label', 'field');
        f.appendChild(el('span', 'field-label', label));
        var s = el('select', 'select');
        options.forEach(function (o) { var x = el('option', null, o[1]); x.value = o[0]; s.appendChild(x); });
        s.value = T[key];
        s.addEventListener('change', function () { T[key] = s.value; T.variant = 1; persist(); drawCost(); });
        f.appendChild(s);
        grid.appendChild(f);
      }
      pick('背景', 'background', [['studio', 'スタジオ（無地）'], ['street', '街並み'], ['cafe', 'カフェの前'], ['park', '公園'], ['indoor', '室内']]);
      pick('ポーズ', 'pose', [['front', '正面で立つ'], ['walk', '歩く'], ['angle', '少し斜め'], ['lean', '壁にもたれる']]);
      pick('画質', 'quality', [['low', '標準（安い）'], ['medium', 'きれい（少し高い）']]);
      box.appendChild(grid);
      var cost = el('p', 'coord-cost');
      box.appendChild(cost);
      var limitRow = el('label', 'field coord-limit');
      limitRow.appendChild(el('span', 'field-label', '1か月に作れる枚数の上限'));
      var limitIn = el('input', 'input');
      limitIn.type = 'number';
      limitIn.inputMode = 'numeric';
      limitIn.value = window.ImageStore.usage().limit;
      limitIn.addEventListener('change', function () { window.ImageStore.setLimit(limitIn.value); drawCost(); });
      limitRow.appendChild(limitIn);
      box.appendChild(limitRow);
      var gen = el('button', 'btn btn-primary', '完成コーデを生成');
      gen.type = 'button';
      box.appendChild(gen);
      var again = el('button', 'btn btn-secondary', '同じコーデで別パターンを作る');
      again.type = 'button';
      box.appendChild(again);
      var note = el('p', 'hint', '');
      box.appendChild(note);
      var gallery = el('div', 'coord-tryon-gallery');
      box.appendChild(gallery);

      function parts() {
        var items = [{ name: h.name, kind: coordSlotOf(h.name).kind, brand: h.brand, image: h.image, hero: true }].concat(
          look.items.filter(function (x) { return x.product; }).map(function (x) { return { name: x.product.name, kind: x.kind, brand: x.product.brand, image: x.product.image }; }));
        return {
          items: items, gender: c.gender || view.gender || '', background: T.background, pose: T.pose, quality: T.quality, variant: T.variant,
          style: look.style || '', age: c.age || ''
        };
      }
      function keyFor(p) { return window.ImageStore.keyOf([p.items.map(function (x) { return x.image; }), p.gender, p.background, p.pose, p.quality, p.variant]); }
      function yen() { return tryOnMeta ? tryOnMeta.cost[T.quality] : null; }
      function drawCost() {
        var u = window.ImageStore.usage();
        var key = keyFor(parts());
        var made = (view.images || []).some(function (x) { return x.key === key; });
        cost.textContent = (made ? 'この条件の画像は作成済みです（保存したものを表示します。料金はかかりません）。' : '1枚あたりの目安：約' + (yen() == null ? '…' : yen()) + '円（為替や参考画像の数で前後します）。') +
          '　今月：' + u.count + '／' + u.limit + '枚（約' + u.yen + '円）';
        gen.textContent = made ? '作成済みの画像を表示' : '完成コーデを生成';
        gen.disabled = again.disabled = tryOnBusy;
      }
      if (!tryOnMeta) {
        fetch('api/coord-image').then(function (r) { return r.json(); }).then(function (d) { tryOnMeta = d; drawCost(); }, function () {});
      }
      drawCost();

      // 生成した画像の右上に「AIによる着用イメージ」を入れる（実物の写真と間違えないように）
      function labelImage(dataUrl) {
        return window.IgRender.loadImage(dataUrl).then(function (img) {
          var cv = document.createElement('canvas');
          cv.width = img.width; cv.height = img.height;
          var x = cv.getContext('2d');
          x.drawImage(img, 0, 0);
          var fs = Math.round(img.width * 0.034);
          x.font = '700 ' + fs + 'px ' + window.IgRender.kit.FONT;
          var text = 'AIによる着用イメージ';
          var w = x.measureText(text).width + fs * 1.2;
          x.fillStyle = 'rgba(0,0,0,0.62)';
          window.IgRender.kit.roundRect(x, img.width - w - fs * 0.6, fs * 0.6, w, fs * 1.8, fs * 0.4);
          x.fill();
          x.fillStyle = '#FFFFFF';
          x.fillText(text, img.width - w - fs * 0.6 + fs * 0.6, fs * 0.6 + fs * 1.25);
          return cv.toDataURL('image/jpeg', 0.9);
        }, function () { return dataUrl; });
      }
      function drawGallery() {
        gallery.innerHTML = '';
        (view.images || []).filter(function (x) { return x.lookId === look.id; }).forEach(function (meta) {
          var fig = el('figure', 'coord-tryon-fig');
          var im = el('img', 'coord-collage-img');
          im.alt = 'AIによる着用イメージ';
          fig.appendChild(im);
          window.ImageStore.get(meta.key).then(function (src) {
            if (src) im.src = src; else fig.appendChild(el('p', 'hint', 'この画像はこのiPhoneに残っていません（別の端末で作ったか、ブラウザのデータが消えました）。'));
          });
          var cap = el('figcaption', 'hint', 'AIによる着用イメージ｜' + ({ studio: 'スタジオ', street: '街並み', cafe: 'カフェ', park: '公園', indoor: '室内' }[meta.background] || '') + '・' + ({ front: '正面', walk: '歩く', angle: '斜め', lean: 'もたれる' }[meta.pose] || '') + '・パターン' + meta.variant + '　ロゴや細部は実物と違うことがあります');
          fig.appendChild(cap);
          var del = el('button', 'link-btn', 'この画像を削除');
          del.type = 'button';
          del.addEventListener('click', function () {
            if (!window.confirm('この着用イメージを削除しますか？（もう一度作ると料金がかかります）')) return;
            view.images = view.images.filter(function (x) { return x.key !== meta.key; });
            window.ImageStore.remove(meta.key);
            persist();
            drawGallery();
            drawCost();
          });
          fig.appendChild(del);
          gallery.appendChild(fig);
        });
      }
      drawGallery();

      function generate() {
        var p = parts();
        var key = keyFor(p);
        if ((view.images || []).some(function (x) { return x.key === key; })) {
          window.ImageStore.get(key).then(function (src) {
            if (src) { note.textContent = '作成済みの画像を表示しています（料金はかかっていません）。'; drawGallery(); return; }
            view.images = view.images.filter(function (x) { return x.key !== key; });
            generate(); // 端末に残っていなければ作り直す
          });
          return;
        }
        if (p.items.length < 2) { note.textContent = '起点のほかに、商品を1つ以上入れてください。'; return; }
        var u = window.ImageStore.usage();
        if (u.count >= u.limit) { note.textContent = '今月の上限（' + u.limit + '枚）に達しました。上限を変えるか、来月までお待ちください。'; return; }
        if (!window.confirm('AIで着用イメージを1枚作ります。料金の目安は約' + (yen() == null ? '数' : yen()) + '円です（今月 ' + u.count + '／' + u.limit + '枚）。作りますか？')) return;
        tryOnBusy = true;
        gen.textContent = '生成しています…（20〜50秒）';
        drawCost();
        gen.textContent = '生成しています…（20〜50秒）';
        note.textContent = '';
        postJson('api/coord-image', p).then(function (r) {
          if (r.status !== 200) throw new Error((r.data && r.data.error) || '画像を作れませんでした');
          window.ImageStore.record(r.data.costYen, r.data.model);
          return labelImage(r.data.image).then(function (labeled) {
            return window.ImageStore.put(key, labeled).then(function () {
              view.images = (view.images || []).concat([{ key: key, lookId: look.id, background: p.background, pose: p.pose, quality: p.quality, variant: p.variant, model: r.data.model, costYen: r.data.costYen, createdAt: Date.now() }]);
              persist();
              note.textContent = '作りました（' + r.data.model + '・約' + r.data.costYen + '円）。';
              drawGallery();
            });
          });
        }).catch(function (e) {
          // 失敗したときは、実物商品コラージュを出す（料金はかかっていない）
          note.textContent = (e && e.message ? e.message : '通信できませんでした') + '。かわりに実物商品コラージュを表示します。';
          var col = box.parentNode && box.parentNode.querySelector('.coord-look-collage-btn');
          if (col) col.click();
        }).then(function () {
          tryOnBusy = false;
          drawCost();
        });
      }
      gen.addEventListener('click', generate);
      again.addEventListener('click', function () {
        T.variant = 1 + Math.max(T.variant, Math.max.apply(null, [0].concat((view.images || []).filter(function (x) { return x.lookId === look.id; }).map(function (x) { return x.variant; }))));
        persist();
        drawCost();
        generate();
      });
      return box;
    }

    // ---- 3パターンのコーデ（編集できる） ----
    var collageCache = {};
    function drawLooks() {
      body.innerHTML = '';
      if (view.notice) body.appendChild(el('p', 'hint coord-notice', view.notice));
      view.looks.forEach(function (look, li) {
        var card = el('article', 'card coord-look');
        var lh = el('div', 'idea-head');
        lh.appendChild(el('span', 'idea-no', String.fromCharCode(65 + li)));
        var styleSel = el('select', 'select coord-style-sel');
        COORD_STYLES.slice(1).concat(look.style && COORD_STYLES.indexOf(look.style) === -1 ? [look.style] : []).forEach(function (s) {
          var o = el('option', null, s);
          o.value = s;
          styleSel.appendChild(o);
        });
        styleSel.value = look.style || '大人カジュアル';
        styleSel.addEventListener('change', function () { look.style = styleSel.value; markEdited(look); persist(); drawGo(); });
        lh.appendChild(styleSel);
        if (look.edited) lh.appendChild(el('span', 'idea-edited', '手で編集'));
        card.appendChild(lh);
        var nameIn = el('input', 'input coord-look-name');
        nameIn.type = 'text';
        nameIn.maxLength = 30;
        nameIn.value = look.name || '';
        nameIn.placeholder = 'コーデの名前';
        nameIn.addEventListener('input', function () { look.name = nameIn.value.trim(); markEdited(look); persist(); drawGo(); });
        card.appendChild(nameIn);
        if (look.concept) card.appendChild(el('p', 'idea-sub', look.concept));

        var items = el('div', 'coord-items');
        items.appendChild(coordProductRow(h, '起点', { hero: true }));
        look.items.forEach(function (it, i) {
          var row;
          if (!it.product) {
            row = el('div', 'coord-item empty');
            row.appendChild(el('span', 'role', it.slotLabel));
            row.appendChild(el('p', 'hint', it.kind + '：まだ商品が入っていません' + (it.keyword ? '（AIが探した言葉：' + it.keyword + '）' : '')));
          } else {
            row = coordProductRow(it.product, it.slotLabel + '｜' + it.kind);
            if (it.source === 'user') row.querySelector('.chips').appendChild(el('span', 'idea-edited', '自分で選択'));
            // AIが見つけたほかの候補（そのアイテムだけ入れ替わる）
            var others = (it.options || []).filter(function (o) { return !sameItem(o, it.product); });
            if (others.length) {
              var alt = el('details', 'coord-alt');
              alt.appendChild(el('summary', null, 'AIが見つけたほかの候補（' + others.length + '）'));
              others.forEach(function (o) {
                var b = el('button', 'coord-alt-btn');
                b.type = 'button';
                b.appendChild(el('span', null, String(o.name).slice(0, 40)));
                b.appendChild(el('b', null, formatPrice(o.price)));
                b.addEventListener('click', function () {
                  it.product = o;
                  it.source = 'user';
                  markEdited(look);
                  persist();
                  drawLooks();
                  showToast(it.slotLabel + 'を入れ替えました（ほかのアイテムはそのまま）');
                });
                alt.appendChild(b);
              });
              row.querySelector('.coord-item-mid').appendChild(alt);
            }
          }
          var tools = el('div', 'coord-tools');
          [['▲', -1, '上へ'], ['▼', 1, '下へ']].forEach(function (m) {
            var b = el('button', 'coord-tool', m[0]);
            b.type = 'button';
            b.setAttribute('aria-label', m[2]);
            b.disabled = (m[1] < 0 && i === 0) || (m[1] > 0 && i === look.items.length - 1);
            b.addEventListener('click', function () {
              look.items.splice(i + m[1], 0, look.items.splice(i, 1)[0]);
              if (S.target && S.target.lookId === look.id) S.target = null;
              markEdited(look);
              persist();
              drawLooks();
              drawTarget();
            });
            tools.appendChild(b);
          });
          var rep = el('button', 'coord-tool wide', it.product ? '入れ替える' : '探して入れる');
          rep.type = 'button';
          rep.addEventListener('click', function () { startReplace(look, i); });
          tools.appendChild(rep);
          var del = el('button', 'coord-tool', '削除');
          del.type = 'button';
          del.addEventListener('click', function () {
            if (!window.confirm((it.product ? '「' + String(it.product.name).slice(0, 24) + '」' : 'この枠') + 'をコーデから外しますか？')) return;
            look.items.splice(i, 1);
            if (S.target && S.target.lookId === look.id) S.target = null;
            markEdited(look);
            persist();
            drawLooks();
            drawTarget();
            drawResults();
          });
          tools.appendChild(del);
          row.appendChild(tools);
          items.appendChild(row);
        });
        card.appendChild(items);

        var addBtn = el('button', 'btn btn-secondary', 'アイテムを探して追加');
        addBtn.type = 'button';
        addBtn.addEventListener('click', function () {
          S.target = null;
          S.lookId = look.id;
          drawTarget();
          drawResults();
          sbox.scrollIntoView({ behavior: 'smooth', block: 'start' });
          kw.focus();
        });
        card.appendChild(addBtn);

        var sum = el('p', 'coord-total');
        sum.appendChild(document.createTextNode('合計 '));
        sum.appendChild(el('strong', null, formatPrice(coordTotal(view, look))));
        sum.appendChild(document.createTextNode('（起点のアイテム込み・' + (look.items.filter(function (x) { return x.product; }).length + 1) + '点）'));
        card.appendChild(sum);

        // 実物商品コラージュ（画像生成AIは使わず、選んだ商品の写真を並べる）
        var colBtn = el('button', 'btn btn-secondary coord-look-collage-btn', '実物商品コラージュを見る');
        colBtn.type = 'button';
        var colBox = el('div', 'coord-collage');
        var sig = function () { return [h.url].concat(look.items.map(function (x) { return x.product ? x.product.url : ''; })).join('|') + look.name; };
        if (collageCache[look.id] && collageCache[look.id].sig === sig()) colBox.appendChild(collageCache[look.id].img);
        colBtn.addEventListener('click', function () {
          colBtn.disabled = true;
          colBtn.textContent = '商品写真を読み込んでいます…';
          var list = [{ p: h, label: '起点', hero: true }].concat(look.items.filter(function (x) { return x.product; }).map(function (x) { return { p: x.product, label: x.kind }; }));
          Promise.all(list.map(function (x) { return loadProductImage(x.p.image); })).then(function (imgs) {
            var canvas = window.CoordCollage.render(list.map(function (x, k) { return { image: imgs[k], label: x.label, price: x.p.price, hero: x.hero }; }), { title: look.name || coordTitleOf(view), total: coordTotal(view, look) });
            var img = el('img', 'coord-collage-img');
            img.alt = 'コーデ' + String.fromCharCode(65 + li) + 'の実物商品コラージュ';
            img.src = canvas.toDataURL('image/jpeg', 0.9);
            collageCache[look.id] = { sig: sig(), img: img };
            colBox.innerHTML = '';
            colBox.appendChild(img);
            var miss = imgs.filter(function (x) { return !x; }).length;
            if (miss) colBox.appendChild(el('p', 'hint', miss + '件の商品写真を読み込めませんでした。'));
          }).then(function () {
            colBtn.disabled = false;
            colBtn.textContent = '実物商品コラージュを作り直す';
          });
        });
        card.appendChild(colBtn);
        card.appendChild(colBox);
        // ---- AI着用イメージ：押したときだけ生成（料金がかかる）。同じ条件の画像は保存したものを使う ----
        card.appendChild(tryOnSection(look));
        body.appendChild(card);
      });
      var blank = el('button', 'btn btn-secondary', '空のコーデを追加（自分で組む）');
      blank.type = 'button';
      blank.addEventListener('click', function () {
        var look = { id: 'look' + Date.now().toString(36), name: '自分で組んだコーデ', style: c.style !== 'おまかせ' ? c.style : '大人カジュアル', concept: '', items: [], edited: true };
        view.looks.push(look);
        S.lookId = look.id;
        persist();
        drawLooks();
        drawTarget();
        drawGo();
      });
      body.appendChild(blank);
    }

    go.addEventListener('click', function () {
      var keep = view.looks.filter(function (l) { return l.edited; });
      if (view.looks.length && !window.confirm('手で編集していないコーデを、新しい提案に置き換えますか？' + (keep.length ? '（編集したコーデ' + keep.length + 'つはそのまま残します）' : ''))) return;
      go.disabled = true;
      go.textContent = 'コーデを考えて、商品を探しています…';
      var wait = el('div', 'loading');
      wait.appendChild(el('div', 'spinner'));
      var t = el('p');
      t.innerHTML = 'コーデを考えて、楽天で実在の商品を探しています…<br><span class="sub">30〜60秒ほどかかります</span>';
      wait.appendChild(t);
      body.insertBefore(wait, body.firstChild);
      postJson('api/coord', { hero: h, conditions: c }).then(function (r) {
        if (r.status !== 200) {
          view.notice = (r.data && r.data.error) || 'コーデを作れませんでした。もう一度お試しください。';
        } else {
          var fresh = r.data.looks || [];
          // 手で編集したコーデは残し、編集していない枠だけを新しい提案で埋める（最大3つ。編集したものが多ければそれ以上も残す）
          var out = view.looks.map(function (l) { return l.edited ? l : null; });
          var k = 0;
          for (var i = 0; i < out.length; i++) if (!out[i] && fresh[k]) out[i] = fresh[k++];
          while (out.filter(Boolean).length < 3 && fresh[k]) out.push(fresh[k++]);
          view.looks = out.filter(Boolean).map(function (l, n) { if (!l.edited) l.id = 'look' + Date.now().toString(36) + n; return l; });
          view.heroSlot = r.data.heroSlot;
          view.gender = r.data.gender;
          view.aiLooks = JSON.parse(JSON.stringify(fresh)); // AIの提案内容（手で変えた内容と見比べられるように残す）
          view.notice = r.data.notice || '';
          form.open = false;
        }
        persist();
        drawLooks();
        drawTarget();
      }, function () {
        view.notice = '通信できませんでした。電波の良い場所でもう一度お試しください。';
        drawLooks();
      }).then(function () { drawGo(); });
    });

    drawLooks();
    results.appendChild(sbox);
    drawTarget();
    drawResults();
    // ---- Instagram投稿・楽天ROOM・商品リンク一覧 ----
    var postBox = el('section', 'card coord-post');
    postBox.appendChild(el('h3', 'plan-section-title', 'Instagram投稿・ROOM登録・商品リンク'));
    var fmtField = el('label', 'field');
    fmtField.appendChild(el('span', 'field-label', '投稿の形'));
    var fmtSel = el('select', 'select');
    [['single', '1コーデ紹介（完成コーデ → アイテム → 誘導）'], ['compare', '3コーデ比較（並べた表紙 → 各コーデ → アイテム一覧 → 誘導）'], ['release', '新商品を使ったコーデ（新商品 → 完成コーデ → 組み合わせた商品 → 誘導）']].forEach(function (o) {
      var x = el('option', null, o[1]); x.value = o[0]; fmtSel.appendChild(x);
    });
    view.post = view.post || { format: 'single', lookId: '' };
    fmtSel.value = view.post.format;
    fmtField.appendChild(fmtSel);
    postBox.appendChild(fmtField);
    var lookField = el('label', 'field');
    lookField.appendChild(el('span', 'field-label', '使うコーデ'));
    var lookSel = el('select', 'select');
    lookField.appendChild(lookSel);
    postBox.appendChild(lookField);
    var postNote = el('p', 'hint', '');
    postBox.appendChild(postNote);
    var toIg = el('button', 'btn btn-primary', 'この内容でInstagram投稿を作る');
    toIg.type = 'button';
    postBox.appendChild(toIg);
    var status = el('p', 'coord-status', '');
    postBox.appendChild(status);
    var roomLink = el('a', 'btn btn-secondary', 'ROOM登録準備を開く（紹介文・ハッシュタグ・登録済みチェック）');
    postBox.appendChild(roomLink);
    var links = el('details', 'coord-links');
    links.appendChild(el('summary', null, '商品リンク一覧'));
    links.appendChild(el('p', 'hint', 'Instagramの通常の投稿画像からは、リンクに移動できません。プロフィールのリンク（楽天ROOMなど）やストーリーズのリンクスタンプから案内してください。'));
    var copyLinks = el('button', 'btn btn-secondary', '商品名とURLの一覧をコピー');
    copyLinks.type = 'button';
    var saveLinks = el('button', 'btn btn-secondary', 'リンク一覧ページ（HTML）を保存');
    saveLinks.type = 'button';
    links.appendChild(copyLinks);
    links.appendChild(saveLinks);
    postBox.appendChild(links);

    function postLooks() {
      if (view.post.format === 'compare') return view.looks.slice(0, 3);
      return [lookById(view.post.lookId) || view.looks[0]].filter(Boolean);
    }
    // 投稿に使う商品：起点のアイテムを先頭に、選んだコーデのアイテム（同じ商品は1つに。最大20）
    function postProducts() {
      var out = [h];
      postLooks().forEach(function (l) {
        l.items.forEach(function (it) {
          if (it.product && !out.some(function (p) { return sameItem(p, it.product); })) out.push(Object.assign({ kind: it.kind }, it.product));
        });
      });
      return out.slice(0, MAX_POST_ITEMS);
    }
    function drawPostBox() {
      // 投稿づくりの画面で進んだ記録（投稿の記録・Instagram投稿済み）を取り込む
      var fresh = window.CoordStore.get(view.id);
      if (fresh) { view.postId = fresh.postId || view.postId; view.igStatus = fresh.igStatus || view.igStatus; }
      lookSel.innerHTML = '';
      view.looks.forEach(function (l, i) {
        var o = el('option', null, 'コーデ' + String.fromCharCode(65 + i) + '：' + (l.name || '').slice(0, 20));
        o.value = l.id;
        lookSel.appendChild(o);
      });
      lookSel.value = (lookById(view.post.lookId) || {}).id || '';
      lookField.hidden = view.post.format === 'compare';
      postBox.hidden = !view.looks.length;
      var ps = postProducts();
      var ai = postLooks().filter(function (l) { return (view.images || []).some(function (x) { return x.lookId === l.id; }); }).length;
      postNote.textContent = ps.length + '商品を使います。' + (view.post.format === 'compare' && view.looks.length < 3 ? 'コーデが3つないので、ある分だけ並べます。' : '') +
        '完成コーデの画像は、AI着用イメージがあればそれを、なければ実物商品コラージュを使います（' + ai + '/' + postLooks().length + 'コーデにAI画像あり）。';
      status.textContent = 'Instagram：' + (view.igStatus === 'posted' ? '投稿済み' : view.postId ? '画像を作成済み・未投稿' : '未作成');
      roomLink.hidden = !view.postId;
      roomLink.href = view.postId ? '#room:' + view.postId : '#';
      if (view.postId) {
        History.get(view.postId).then(function (rec) {
          if (!rec) return;
          var n = (rec.products || []).filter(function (p) { return (rec.roomDone || {})[p.id]; }).length;
          view.roomStatus = { done: n, total: (rec.products || []).length };
          status.textContent += '｜ROOM登録 ' + n + '/' + (rec.products || []).length;
        });
      }
    }
    fmtSel.addEventListener('change', function () { view.post.format = fmtSel.value; persist(); drawPostBox(); });
    lookSel.addEventListener('change', function () { view.post.lookId = lookSel.value; persist(); drawPostBox(); });

    function linkList() {
      return postProducts().filter(function (p) { return p.url; });
    }
    copyLinks.addEventListener('click', function () {
      var text = coordTitleOf(view) + '\n\n' + linkList().map(function (p, i) { return (i + 1) + '. ' + String(p.name).replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 50) + '（' + formatPrice(p.price) + '）\n' + p.url; }).join('\n\n');
      legacyCopy(text).then(function () { showToast('商品リンクの一覧をコピーしました'); }, function () {});
    });
    saveLinks.addEventListener('click', function () {
      var esc = function (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
      var rows = linkList().map(function (p) {
        return '<a class="i" href="' + esc(p.url) + '" target="_blank" rel="noopener"><img src="' + esc(p.image) + '" alt=""><span><b>' + esc(String(p.name).replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 60)) + '</b><small>' + esc(formatPrice(p.price)) + (p.shop ? '・' + esc(p.shop) : '') + '</small></span></a>';
      }).join('\n');
      var html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(coordTitleOf(view)) + '</title>' +
        '<style>body{font-family:-apple-system,sans-serif;margin:0;padding:16px;background:#f4f1ec;color:#1a1a1a}h1{font-size:20px}.i{display:flex;gap:12px;align-items:center;background:#fff;border-radius:12px;padding:10px;margin:10px 0;color:inherit;text-decoration:none}.i img{width:72px;height:72px;object-fit:contain}.i span{display:grid;gap:4px}.i small{color:#6b6460}p{font-size:12px;color:#6b6460}</style></head><body>' +
        '<h1>' + esc(coordTitleOf(view)) + '</h1>' + rows + '<p>価格・在庫は変わることがあります。購入前に商品ページで確認してください。' + ' ' + esc(window.IgRender.kit.ACCOUNT.handle) + '</p></body></html>';
      downloadBlob(new Blob([html], { type: 'text/html' }), 'coord-links.html');
    });

    // Instagram投稿を作る：紹介文が無い商品の分だけAIで作り、投稿づくりの画面へ（画像は投稿づくりの画面で作る）
    toIg.addEventListener('click', function () {
      var ps = postProducts();
      if (ps.length < 2) { showToast('起点のほかに商品を1つ以上入れてください'); return; }
      view.intros = view.intros || {};
      var need = ps.filter(function (p) { return !view.intros[p.url || p.name]; });
      toIg.disabled = true;
      toIg.textContent = need.length ? 'ROOM紹介文を作っています…（' + need.length + '商品）' : '投稿の準備をしています…';
      var chunks = [];
      for (var i = 0; i < need.length; i += 8) chunks.push(need.slice(i, i + 8));
      Promise.all(chunks.map(function (chunk) {
        return postJson('api/intros', {
          title: coordTitleOf(view),
          items: chunk.map(function (p) { return { name: p.name, price: p.price, role: p === h ? '主役のアイテム' : p.kind, brand: p.brand, reason: 'コーデ「' + coordTitleOf(view) + '」で使うアイテム', caption: p.caption }; })
        });
      })).then(function (rs) {
        rs.forEach(function (r, k) {
          var got = (r.data && r.data.intros) || [];
          chunks[k].forEach(function (p, j) { if (got[j]) view.intros[p.url || p.name] = got[j]; });
        });
        persist();
        composeFromCoord(view, ps, postLooks());
      }, function () {
        showToast('通信できませんでした。電波の良い場所でもう一度お試しください。');
      }).then(function () {
        toIg.disabled = false;
        toIg.textContent = 'この内容でInstagram投稿を作る';
      });
    });
    results.appendChild(postBox);
    drawPostBox();
    // 投稿づくり・ROOM登録の画面から戻ってきたときに、状況を新しくする
    window.addEventListener('hashchange', function onBack() {
      if (!postBox.isConnected) { window.removeEventListener('hashchange', onBack); return; }
      if (!location.hash || location.hash === '#discover') drawPostBox();
    });

  }

  // コーデから投稿づくりへ：商品・テーマ・表紙・差し込むコーデのスライドを下書きにする
  function composeFromCoord(view, products, looks) {
    loadDraft();
    var h = view.heroProduct;
    draft.items = products.map(function (p, i) {
      return {
        id: p.code || p.url, code: p.code, name: p.name, price: p.price, image: p.image, url: p.url, brand: p.brand || '',
        reason: i ? 'コーデで使うアイテム' : 'このコーデの主役のアイテム', intro: (view.intros || {})[p.url || p.name] || '',
        role: i ? p.kind || '' : '主役', memo: '', hero: i === 0
      };
    });
    draft.heroProduct = { code: h.code, url: h.url, name: h.name, brand: h.brand, price: h.price, image: h.image };
    draft.postId = view.postId || '';
    draft.planId = '';
    draft.genre = 'ファッション';
    draft.postType = 'コーデ';
    draft.theme = coordTitleOf(view).slice(0, 30);
    draft.subtitle = '';
    draft.category = 'コーデ';
    draft.layoutSizes = null;
    draft.coverAccent = '';
    draft.summary = { enabled: false, typeName: '', title: '', lead: '', verdict: '' };
    draft.priceBand = '';
    var fmt = view.post.format;
    // 新商品を使ったコーデ：1枚目は新商品の表紙（主役の写真を大きく）。ラベルは確認できた情報があるときだけ
    draft.coverStyle = fmt === 'release' ? 'new_release' : 'serious_think';
    draft.release = fmt === 'release' ? { labels: h.labels || [], brand: h.brand || '', dateText: h.dateText || '', mood: 'fashion', hero: { code: h.code, url: h.url, name: h.name, brand: h.brand } } : null;
    draft.coverTitle = fmt === 'release' ? splitCoverTitle(coordTitleOf(view)) : '';
    draft.coord = {
      coordId: view.id, format: fmt, title: coordTitleOf(view),
      looks: looks.map(function (l) {
        var img = (view.images || []).filter(function (x) { return x.lookId === l.id; }).slice(-1)[0];
        return {
          id: l.id, name: l.name, style: l.style, imageKey: img ? img.key : '',
          urls: [h.url].concat(l.items.filter(function (x) { return x.product; }).map(function (x) { return x.product.url; })),
          count: l.items.filter(function (x) { return x.product; }).length + 1, total: coordTotal(view, l)
        };
      })
    };
    draft.cta = 0;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    Promise.all(draft.items.map(function (p) { return Store.setStatus(p, 'ig_waiting'); })).then(updateManageCount, function () {});
    location.hash = '#compose';
  }

  // 投稿の画像を作る直前に、各コーデの完成画像を用意する（AI着用イメージがあればそれ、なければ実物商品コラージュ）
  function coordSlidesData(co, items, images) {
    return Promise.all(co.looks.map(function (l) {
      var pick = l.urls.map(function (u) { return items.findIndex(function (it) { return it.url === u; }); }).filter(function (i) { return i !== -1; });
      var collage = function () {
        return window.CoordCollage.render(pick.map(function (i, k) { return { image: images[i], label: k ? items[i].role : '起点', price: items[i].price, hero: k === 0 }; }), { title: l.name, total: l.total });
      };
      var base = { name: l.name, style: l.style, count: l.count, total: l.total };
      if (!l.imageKey) return Object.assign(base, { image: collage(), ai: false });
      return window.ImageStore.get(l.imageKey).then(function (src) {
        if (!src) return Object.assign(base, { image: collage(), ai: false });
        return window.IgRender.loadImage(src).then(function (img) { return Object.assign(base, { image: img, ai: true }); }, function () { return Object.assign(base, { image: collage(), ai: false }); });
      });
    })).then(function (looks) { return { format: co.format, title: co.title, looks: looks }; });
  }

  renderCoordSaved();

  function coordButton(getProduct) {
    var b = el('button', 'btn btn-coord', 'この商品でコーデを作る');
    b.type = 'button';
    b.addEventListener('click', function () { startCoord(getProduct()); });
    return b;
  }

  // ---- 探し方の切り替え（企画から／条件を指定して／完全ランダム。1つずつ開く） ----
  var MODE_KEY = 'room-search-mode';
  var modeTabs = document.querySelectorAll('.mode-tab');
  function showMode(mode) {
    Array.prototype.forEach.call(modeTabs, function (t) { t.classList.toggle('active', t.getAttribute('data-mode') === mode); });
    ['idea', 'cond', 'random', 'radar'].forEach(function (m) { document.getElementById('mode-' + m).hidden = m !== mode; });
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  }
  Array.prototype.forEach.call(modeTabs, function (t) {
    t.addEventListener('click', function () { showMode(t.getAttribute('data-mode')); });
  });

  // ---- 今日の企画（編集部） ----
  var CURRENT_POST_KEY = 'room-current-post';
  var IDEAS_KEY = 'room-last-ideas';
  var CHOSEN_KEY = 'room-chosen-idea';
  var History = window.PostHistory;
  var ideasEl = document.getElementById('ideas');
  var ideasPanel = document.getElementById('ideas-panel');
  var ideasToggle = document.getElementById('ideas-toggle');
  var ideasArrow = document.getElementById('ideas-arrow');
  var ideasChosen = document.getElementById('ideas-chosen');
  var ideasLoading = document.getElementById('ideas-loading');
  var ideasMessage = document.getElementById('ideas-message');
  var lastIdeas = [];
  var meta = { types: [{ id: 'omakase', name: 'おまかせ', desc: 'AIに選び方も任せる' }], genres: [] };

  function currentPostId() {
    try { return localStorage.getItem(CURRENT_POST_KEY) || ''; } catch (e) { return ''; }
  }
  function setCurrentPostId(id) {
    try { localStorage.setItem(CURRENT_POST_KEY, id || ''); } catch (e) {}
  }

  // 企画候補は、折りたたんだり再表示したりできる（選んだあとは自動で折りたたむ）
  function setIdeasOpen(open) {
    ideasEl.hidden = !open;
    ideasToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    ideasArrow.textContent = open ? '▲ 折りたたむ' : '▼ 再表示';
  }
  ideasToggle.addEventListener('click', function () { setIdeasOpen(ideasEl.hidden); });
  function showChosen() {
    var t = '';
    try { t = localStorage.getItem(CHOSEN_KEY) || ''; } catch (e) {}
    ideasChosen.textContent = t ? '選んだ企画：' + t : '';
  }
  function saveIdeas() {
    try { localStorage.setItem(IDEAS_KEY, JSON.stringify(lastIdeas)); } catch (e) {}
  }
  function drawIdeas() {
    ideasEl.innerHTML = '';
    lastIdeas.forEach(function (idea, i) { ideasEl.appendChild(renderIdea(idea, i)); });
    ideasPanel.hidden = !lastIdeas.length;
  }

  function renderIdea(idea, i) {
    var card = el('article', 'idea-card');
    var head = el('div', 'idea-head');
    head.appendChild(el('span', 'idea-no', '案' + (i + 1)));
    head.appendChild(el('span', 'plan-type', idea.postType));
    if (idea.edited) head.appendChild(el('span', 'idea-edited', '編集済み'));
    card.appendChild(head);
    card.appendChild(el('h3', 'idea-title', idea.title));
    if (idea.subtitle) card.appendChild(el('p', 'idea-sub', idea.subtitle));
    var dl = el('dl', 'idea-facts');
    [['ターゲット', idea.target], ['価格帯', idea.priceBand], ['ジャンル', idea.genre], ['比較軸', idea.axis], ['自由条件', idea.free], ['ブランド', (idea.brands || []).join('・')]].forEach(function (f) {
      if (!f[1]) return;
      dl.appendChild(el('dt', null, f[0]));
      dl.appendChild(el('dd', null, f[1]));
    });
    card.appendChild(dl);
    if (idea.whyInteresting) card.appendChild(el('p', 'idea-why', idea.whyInteresting));
    if (idea.shareWith) card.appendChild(el('p', 'idea-share', '送りたくなる相手：' + idea.shareWith));
    if ((idea.slots || []).length) {
      var roles = el('div', 'idea-roles');
      idea.slots.forEach(function (sl) { roles.appendChild(el('span', null, sl.label)); });
      card.appendChild(roles);
    }
    var actions = el('div', 'idea-actions');
    var go = el('button', 'btn btn-primary', 'この企画で作る');
    go.type = 'button';
    go.addEventListener('click', function () { startIdea(idea); });
    var edit = el('button', 'btn btn-secondary', '編集する');
    edit.type = 'button';
    edit.addEventListener('click', function () { card.parentNode.replaceChild(ideaEditor(idea, i), card); });
    actions.appendChild(go);
    actions.appendChild(edit);
    card.appendChild(actions);
    // 使わない企画は閉じて候補から外す（全部閉じたら企画候補ごと消える）
    var close = el('button', 'link-btn idea-close', 'この企画を閉じる');
    close.type = 'button';
    close.addEventListener('click', function () {
      lastIdeas.splice(lastIdeas.indexOf(idea), 1);
      saveIdeas();
      drawIdeas();
    });
    card.appendChild(close);
    return card;
  }

  function textField(label, value, multi) {
    var wrap = el('label', 'field');
    wrap.appendChild(el('span', 'field-label', label));
    var input = el(multi ? 'textarea' : 'input', multi ? 'textarea' : 'input');
    if (multi) input.rows = 2; else input.type = 'text';
    input.value = value || '';
    wrap.appendChild(input);
    addClear(input);
    return { wrap: wrap, input: input };
  }

  // AIの企画はたたき台：タイトル・型・ターゲット・価格帯・ジャンル・比較軸・自由条件を直して探せる
  function ideaEditor(idea, i) {
    var card = el('article', 'idea-card idea-edit');
    card.appendChild(el('p', 'idea-no', '案' + (i + 1) + 'を編集'));
    var title = textField('投稿タイトル', idea.title, true);
    title.input.maxLength = 60;
    var typeWrap = el('label', 'field');
    typeWrap.appendChild(el('span', 'field-label', '企画タイプ（選び方の型）'));
    var type = el('select', 'select');
    meta.types.forEach(function (t) {
      var o = el('option', null, t.name + '｜' + t.desc);
      o.value = t.id;
      type.appendChild(o);
    });
    type.value = idea.curationType && meta.types.some(function (t) { return t.id === idea.curationType; }) ? idea.curationType : 'omakase';
    typeWrap.appendChild(type);
    var target = textField('ターゲット', idea.target);
    var price = textField('価格帯', idea.priceBand);
    price.input.placeholder = '例：4,000〜6,000円、1万円以下';
    var genre = textField('ジャンル', idea.genre);
    genre.input.setAttribute('list', 'genre-list');
    var axis = textField('比較軸', idea.axis);
    axis.input.placeholder = '例：所有満足感 vs 実用性';
    var free = textField('自由条件', idea.free, true);
    free.input.placeholder = '例：名入れはしない、男女どちらにも贈れるもの';
    [title.wrap, typeWrap, target.wrap, price.wrap, genre.wrap, axis.wrap, free.wrap].forEach(function (x) { card.appendChild(x); });
    var actions = el('div', 'idea-actions');
    var go = el('button', 'btn btn-primary', 'この内容で商品を探す');
    go.type = 'button';
    var cancel = el('button', 'btn btn-secondary', 'キャンセル');
    cancel.type = 'button';
    actions.appendChild(go);
    actions.appendChild(cancel);
    card.appendChild(actions);
    cancel.addEventListener('click', function () { card.parentNode.replaceChild(renderIdea(idea, i), card); });
    go.addEventListener('click', function () {
      if (!title.input.value.trim()) { showToast('投稿タイトルを入れてください'); return; }
      var typeName = (meta.types.filter(function (t) { return t.id === type.value; })[0] || {}).name;
      var edited = Object.assign({}, idea, {
        edited: true,
        title: title.input.value.trim(),
        curationType: type.value,
        postType: type.value === idea.curationType ? idea.postType : typeName,
        target: target.input.value.trim(),
        priceBand: price.input.value.trim(),
        genre: genre.input.value.trim(),
        axis: axis.input.value.trim(),
        free: free.input.value.trim()
      });
      lastIdeas[i] = edited;
      saveIdeas();
      drawIdeas();
      startIdea(edited);
    });
    return card;
  }

  function startIdea(idea) {
    History.add({
      title: idea.title, topic: idea.topic || String(idea.title).replace(/(について)?本気出して考えてみた$/, ''), subtitle: idea.subtitle, genre: idea.genre, postType: idea.postType,
      target: idea.target, priceBand: idea.priceBand, brands: idea.brands || []
    }).then(setCurrentPostId, function () {});
    try { localStorage.setItem(CHOSEN_KEY, idea.title); } catch (e) {}
    showChosen();
    setIdeasOpen(false);
    exploreProducts({ idea: idea });
  }

  function thinkIdeas() {
    ideasMessage.hidden = true;
    ideasLoading.hidden = false;
    ideasBtn.disabled = true;
    History.recentForIdeas().then(function (history) {
      return postJson('api/ideas', { history: history });
    }).then(function (r) {
      if (r.status !== 200) {
        ideasMessage.textContent = r.data.error || '企画を考えられませんでした。もう一度お試しください。';
        ideasMessage.className = 'message error';
        ideasMessage.hidden = false;
        return;
      }
      if (r.data.notice) {
        ideasMessage.textContent = r.data.notice;
        ideasMessage.className = 'message';
        if (r.data.detail) ideasMessage.appendChild(el('span', 'detail', r.data.detail));
        ideasMessage.hidden = false;
      }
      lastIdeas = r.data.ideas || [];
      saveIdeas();
      try { localStorage.removeItem(CHOSEN_KEY); } catch (e) {}
      showChosen();
      drawIdeas();
      setIdeasOpen(true);
    }).catch(function () {
      ideasMessage.textContent = '通信できませんでした。電波の良い場所でもう一度お試しください。';
      ideasMessage.className = 'message error';
      ideasMessage.hidden = false;
    }).then(function () {
      ideasLoading.hidden = true;
      ideasBtn.disabled = false;
      ideasBtn.textContent = buttonLabels[ideasBtn.id] = '別の3案を考える';
    });
  }
  ideasBtn.addEventListener('click', thinkIdeas);
  // 前回考えた企画を残しておく（ほかのアプリから戻っても消えないように）
  try {
    lastIdeas = JSON.parse(localStorage.getItem(IDEAS_KEY)) || [];
    drawIdeas();
    showChosen();
    // すでに企画を選んでいたら、候補は折りたたんだ状態から
    setIdeasOpen(!ideasChosen.textContent);
    if (lastIdeas.length) ideasBtn.textContent = '別の3案を考える';
  } catch (e) {}

  // ---- 企画（最初の10投稿） ----
  var PLANS_DONE_KEY = 'room-plans-done';
  var plansList = document.getElementById('plans-list');
  var plansProgress = document.getElementById('plans-progress');
  var plans = [];

  function plansDone() {
    try { return JSON.parse(localStorage.getItem(PLANS_DONE_KEY)) || {}; } catch (e) { return {}; }
  }
  function setPlanDone(id, done) {
    var d = plansDone();
    if (done) d[id] = Date.now(); else delete d[id];
    try { localStorage.setItem(PLANS_DONE_KEY, JSON.stringify(d)); } catch (e) {}
    renderPlans();
  }

  function renderPlans() {
    if (!plans.length) return;
    var done = plansDone();
    var next = plans.filter(function (p) { return !done[p.id]; })[0];
    plansProgress.textContent = Object.keys(done).filter(function (id) { return plans.some(function (p) { return p.id === id; }); }).length + '/' + plans.length;
    plansList.innerHTML = '';
    plans.forEach(function (p) {
      var row = el('div', 'plan-row' + (done[p.id] ? ' done' : '') + (next && next.id === p.id ? ' next' : ''));
      var head = el('div', 'plan-head');
      head.appendChild(el('span', 'plan-no', String(p.no)));
      head.appendChild(el('span', 'plan-type', p.postType));
      if (next && next.id === p.id) head.appendChild(el('span', 'plan-next', '次はこれ'));
      row.appendChild(head);
      row.appendChild(el('p', 'plan-title', p.topic + 'について本気出して考えてみた' + (p.subtitle ? ' ' + p.subtitle : '')));
      row.appendChild(el('p', 'plan-roles', p.purpose + '｜' + p.roles.join('・')));
      var actions = el('div', 'plan-actions');
      if (done[p.id]) {
        actions.appendChild(el('span', 'plan-done', '✓ 投稿済み'));
        var undo = el('button', 'link-btn', '取り消す');
        undo.type = 'button';
        undo.addEventListener('click', function () { setPlanDone(p.id, false); });
        actions.appendChild(undo);
      } else {
        var make = el('button', 'btn btn-primary', 'この企画で探す');
        make.type = 'button';
        make.addEventListener('click', function () {
          document.getElementById('plans-box').open = false;
          History.add({ title: p.topic + 'について本気出して考えてみた', topic: p.topic, subtitle: p.subtitle, genre: p.category, postType: p.postType })
            .then(setCurrentPostId, function () {});
          exploreProducts({ planId: p.id });
        });
        actions.appendChild(make);
      }
      row.appendChild(actions);
      plansList.appendChild(row);
    });
  }

  // ---- 条件を指定して探す ----
  var typeChoices = document.getElementById('type-choices');
  var detailBox = document.getElementById('detail-box');
  var dMin = document.getElementById('d-min');
  var dMax = document.getElementById('d-max');
  var dTarget = document.getElementById('d-target');
  var dAge = document.getElementById('d-age');
  var dBrand = document.getElementById('d-brand');
  var dTrend = document.getElementById('d-trend');
  var selectedType = 'omakase';

  // 選び方の型ごとの表紙の見本（小さな画像）。押すとこの系統の表紙になる、が見て分かるように
  var thumbCache = {};
  var thumbBear = null;
  window.IgRender.loadImage('assets/kuma.png').then(function (img) { thumbBear = img; thumbCache = {}; renderTypeChoices(); }, function () {});
  function coverThumb(cover) {
    if (!cover || !cover.style) return null;
    var key = cover.style + (thumbBear ? '+bear' : '');
    if (!thumbCache[key]) {
      try {
        var big = window.IgRender.renderPost({
          topic: 'テーマ', subtitle: '迷ったので整理しました', bear: thumbBear, items: [],
          cover: cover.style === 'serious_think' ? null : { style: cover.style, title: cover.title, accent: cover.accent, sub: '' }
        })[0].canvas;
        var small = document.createElement('canvas');
        small.width = 144;
        small.height = 180;
        small.getContext('2d').drawImage(big, 0, 0, 144, 180);
        thumbCache[key] = small.toDataURL('image/png');
      } catch (e) { return null; }
    }
    var img = el('img', 'type-thumb');
    img.src = thumbCache[key];
    img.alt = '';
    return img;
  }

  // 選び方の型：名前だけで意味が分かるよう、短い説明を添えて並べる
  function renderTypeChoices() {
    typeChoices.innerHTML = '';
    meta.types.forEach(function (t) {
      var b = el('button', 'type-choice' + (t.id === selectedType ? ' active' : ''));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', t.id === selectedType ? 'true' : 'false');
      var thumb = coverThumb(t.cover);
      if (thumb) b.appendChild(thumb);
      var text = el('span', 'type-text');
      text.appendChild(el('strong', null, t.name));
      text.appendChild(el('span', null, t.desc));
      b.appendChild(text);
      b.addEventListener('click', function () {
        selectedType = t.id;
        renderTypeChoices();
        saveConditions();
      });
      typeChoices.appendChild(b);
    });
  }

  function readDetails() {
    var purpose = document.querySelector('input[name="d-purpose"]:checked');
    return {
      minPrice: Number(dMin.value) || null,
      maxPrice: Number(dMax.value) || null,
      target: dTarget.value.trim(),
      age: dAge.value,
      purpose: purpose ? purpose.value : '',
      brandFocus: dBrand.checked,
      trendFocus: dTrend.checked
    };
  }
  function readConditions() {
    return { genre: genreSelect.value, type: selectedType, free: freeText.value.trim(), details: readDetails() };
  }
  function saveConditions() {
    try { localStorage.setItem(COND_KEY, JSON.stringify(readConditions())); } catch (e) {}
  }
  function restoreConditions() {
    var c;
    try { c = JSON.parse(localStorage.getItem(COND_KEY)); } catch (e) { return; }
    if (!c) return;
    genreSelect.value = c.genre || '';
    selectedType = c.type || 'omakase';
    freeText.value = c.free || '';
    var d = c.details || {};
    dMin.value = d.minPrice || '';
    dMax.value = d.maxPrice || '';
    dTarget.value = d.target || '';
    dAge.value = d.age || '';
    var radio = document.querySelector('input[name="d-purpose"][value="' + (d.purpose || '') + '"]');
    if (radio) radio.checked = true;
    dBrand.checked = !!d.brandFocus;
    dTrend.checked = !!d.trendFocus;
    // 詳細条件を使っていたときだけ開いておく
    detailBox.open = !!(d.minPrice || d.maxPrice || d.target || d.age || d.purpose || d.brandFocus || d.trendFocus);
  }
  [genreSelect, freeText, dMin, dMax, dTarget, dAge, dBrand, dTrend].forEach(function (x) { x.addEventListener('change', saveConditions); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="d-purpose"]'), function (x) { x.addEventListener('change', saveConditions); });

  // 条件をすべて最初の状態に戻す
  function clearConditions() {
    genreSelect.value = '';
    selectedType = 'omakase';
    freeText.value = '';
    dMin.value = '';
    dMax.value = '';
    dTarget.value = '';
    dAge.value = '';
    document.querySelector('input[name="d-purpose"][value=""]').checked = true;
    dBrand.checked = false;
    dTrend.checked = false;
    detailBox.open = false;
    renderTypeChoices();
    saveConditions();
    showToast('条件をクリアしました');
  }
  document.getElementById('cond-clear').addEventListener('click', clearConditions);
  [freeText, dTarget, dMin, dMax, igTheme, igSubtitle, igCategory, roomColName].forEach(addClear);

  function searchWithConditions() {
    var c = readConditions();
    saveConditions();
    exploreProducts(c, searchBtn);
  }

  // 企画の一覧・選び方の型・ジャンル名
  fetch('api/plans').then(function (r) { return r.json(); }).then(function (d) {
    plans = d.plans || [];
    if ((d.types || []).length) meta.types = d.types;
    meta.genres = d.genres || [];
    var dl = document.getElementById('genre-list') || document.body.appendChild(el('datalist'));
    dl.id = 'genre-list';
    dl.innerHTML = '';
    meta.genres.forEach(function (g) { var o = el('option'); o.value = g; dl.appendChild(o); });
    renderPlans();
    renderTypeChoices();
  }).catch(function () { renderTypeChoices(); });

  // ---- 新作・予約・再販レーダー ----
  var Radar = window.RadarStore;
  var radarScanBtn = document.getElementById('radar-scan');
  var radarLast = document.getElementById('radar-last');
  var radarLoading = document.getElementById('radar-loading');
  var radarMessage = document.getElementById('radar-message');
  var radarDash = document.getElementById('radar-dash');
  var radarGenresEl = document.getElementById('radar-genres');
  var radarBrandInput = document.getElementById('radar-brand-input');
  var radarListEl = document.getElementById('radar-list');
  var radarCountEl = document.getElementById('radar-count');
  var radarMoreBtn = document.getElementById('radar-more');
  var radarFilterBox = document.getElementById('radar-filter-box');
  var radarFilterNote = document.getElementById('radar-filter-note');
  var rf = {
    sort: document.getElementById('rf-sort'), status: document.getElementById('rf-status'), period: document.getElementById('rf-period'),
    genre: document.getElementById('rf-genre'), brand: document.getElementById('rf-brand'), price: document.getElementById('rf-price'),
    source: document.getElementById('rf-source'), fav: document.getElementById('rf-fav')
  };
  var RADAR_STATUS_LABELS = { NEW: 'NEW', COMING_SOON: 'COMING SOON', PRE_ORDER: 'PRE-ORDER', RESTOCK: 'RESTOCK', LIMITED: 'LIMITED', COLLAB: 'COLLAB', NEW_COLOR: 'NEW COLOR', SPECIAL: 'SALE / SPECIAL' };
  var RADAR_STATUS_JA = { NEW: '新発売', COMING_SOON: '発売予定', PRE_ORDER: '予約受付中', RESTOCK: '再販・再入荷', LIMITED: '限定', COLLAB: 'コラボ', NEW_COLOR: '新色', SPECIAL: '特別販売' };
  // はじめて開いたときに見るジャンル（あとで自由に変えられる）
  var RADAR_DEFAULT_GENRES = ['sneaker', 'bag', 'charger', 'earphone', 'cooking', 'seasonal', 'kitchen', 'tableware', 'useful', 'outdoor', 'cosme', 'perfume'];
  var radarMeta = { groups: [], genres: [], sources: [] };
  var radarShown = 40;

  function radarSettings() {
    var s = Radar.settings();
    if (!s.genres) s.genres = RADAR_DEFAULT_GENRES.slice();
    return s;
  }

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  // 今週（月曜〜日曜）の範囲
  function weekRange() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var mon = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86400000);
    var sun = new Date(mon.getTime() + 6 * 86400000);
    return [ymd(mon), ymd(sun)];
  }
  function monthKey(offset) {
    var d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + (offset || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function inPeriod(it, period) {
    var today = ymd(new Date());
    var month = it.releaseMonth || (it.releaseDate ? it.releaseDate.slice(0, 7) : '');
    if (period === 'today') return it.releaseDate === today;
    if (period === 'week') { var w = weekRange(); return !!it.releaseDate && it.releaseDate >= w[0] && it.releaseDate <= w[1]; }
    if (period === 'month') return month === monthKey(0);
    if (period === 'next') return month === monthKey(1);
    if (period === 'unknown') return !it.releaseDate && !it.releaseMonth;
    if (period === 'new_today') return it.createdAt >= dayStart(Date.now());
    return true;
  }

  function hasStatus(it, st) {
    if (st === 'LIMITED_COLLAB') return it.status.indexOf('LIMITED') !== -1 || it.status.indexOf('COLLAB') !== -1;
    return it.status.indexOf(st) !== -1;
  }

  // 自分の好みに近い順：気になる・企画に使った商品のブランドとジャンル、フォロー中のブランドを重みにする。
  // 同じジャンルばかりにならないよう、ジャンルの重みには上限を付ける
  function preferenceOf(all, settings) {
    var brand = {};
    var genre = {};
    all.forEach(function (it) {
      var w = (it.favorite ? 2 : 0) + (it.usedForPost ? 3 : 0);
      if (!w) return;
      if (it.brand) brand[it.brand] = (brand[it.brand] || 0) + w;
      genre[it.category] = Math.min(4, (genre[it.category] || 0) + w);
    });
    followedBrands().forEach(function (b) { brand[b] = (brand[b] || 0) + 1; });
    return function (it) { return (brand[it.brand] || 0) + (genre[it.category] || 0) + (it.score || 0) * 0.5; };
  }

  // ジャンルに混ざった別の商品（アクセサリーのカー用品など）。以前に貯まった分も一覧に出さない
  function offGenre(it) {
    var g = radarMeta.genres.filter(function (x) { return x.id === it.category; })[0];
    return !!(g && g.ng && !it.followedBrand && g.ng.some(function (w) { return String(it.name || '').indexOf(w) !== -1; }));
  }

  function radarFiltered(all, settings) {
    var price = rf.price.value ? rf.price.value.split('-').map(Number) : null;
    var list = all.filter(function (it) {
      if (it.hidden || offGenre(it)) return false;
      if (rf.fav.checked && !it.favorite) return false;
      if (rf.status.value && !hasStatus(it, rf.status.value)) return false;
      if (rf.period.value && !inPeriod(it, rf.period.value)) return false;
      if (rf.genre.value && it.category !== rf.genre.value) return false;
      if (rf.brand.value && it.brand !== rf.brand.value) return false;
      if (rf.source.value && it.source !== rf.source.value) return false;
      if (price && (it.price < price[0] || (price[1] && it.price >= price[1]))) return false;
      return true;
    });
    var far = '9999-99-99';
    var today = ymd(new Date());
    var sorters = {
      new: function (a, b) { return b.createdAt - a.createdAt || (b.score || 0) - (a.score || 0); },
      release: function (a, b) {
        var x = a.releaseDate && a.releaseDate >= today ? a.releaseDate : far;
        var y = b.releaseDate && b.releaseDate >= today ? b.releaseDate : far;
        return x < y ? -1 : x > y ? 1 : 0;
      },
      preorder_end: function (a, b) {
        var x = a.preorderEnd && a.preorderEnd >= today ? a.preorderEnd : far;
        var y = b.preorderEnd && b.preorderEnd >= today ? b.preorderEnd : far;
        return x < y ? -1 : x > y ? 1 : 0;
      },
      price_asc: function (a, b) { return a.price - b.price; },
      price_desc: function (a, b) { return b.price - a.price; },
      score: function (a, b) { return (b.score || 0) - (a.score || 0); }
    };
    if (rf.sort.value === 'mine') {
      var pref = preferenceOf(all, settings);
      return list.sort(function (a, b) { return pref(b) - pref(a); });
    }
    return list.sort(sorters[rf.sort.value] || sorters.new);
  }

  function dateText(d) {
    if (!d) return '';
    var p = d.split('-');
    return Number(p[1]) + '月' + Number(p[2]) + '日' + (p[0] !== String(new Date().getFullYear()) ? '（' + p[0] + '年）' : '');
  }

  function radarCard(it, settings) {
    var card = el('article', 'cand-card radar-card' + (it.favorite ? ' picked' : ''));
    var top = el('div', 'cand-top');
    if (it.imageUrl) {
      var img = el('img', 'cand-thumb');
      img.src = it.imageUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () { img.remove(); };
      top.appendChild(img);
    }
    var info = el('div', 'cand-info');
    var chips = el('div', 'chips');
    it.status.forEach(function (s) {
      var c = el('span', 'radar-status st-' + s.toLowerCase(), RADAR_STATUS_LABELS[s] || s);
      c.title = RADAR_STATUS_JA[s] || '';
      chips.appendChild(c);
    });
    if (it.createdAt >= dayStart(Date.now())) chips.appendChild(el('span', 'seen', '今日の新着'));
    info.appendChild(chips);
    var name = el('h3', 'cand-name radar-name', it.name.replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 60) || it.name.slice(0, 60));
    name.title = it.name;
    info.appendChild(name);
    var meta = el('p', 'cand-meta');
    meta.appendChild(el('strong', null, formatPrice(it.price)));
    if (it.brand) meta.appendChild(el('span', 'cand-brand', it.brand));
    meta.appendChild(el('span', 'cand-brand', it.categoryLabel));
    info.appendChild(meta);
    top.appendChild(info);
    card.appendChild(top);

    var dl = el('dl', 'idea-facts radar-dates');
    var release = it.releaseDate ? dateText(it.releaseDate) + (it.releaseDate > ymd(new Date()) ? '（予定）' : '') : it.releaseText || '記載なし';
    [['発売日', release], ['予約開始', it.preorderStart ? dateText(it.preorderStart) : (it.status.indexOf('PRE_ORDER') !== -1 ? '受付中（開始日の記載なし）' : '')],
      ['予約締切', it.preorderEnd ? dateText(it.preorderEnd) : ''], ['再販日', it.restockDate ? dateText(it.restockDate) : ''],
      ['販売サイト', it.sourceLabel + (it.shops && it.shops.length > 1 ? '（' + it.shops.length + '店舗）' : '')]].forEach(function (f) {
      if (!f[1]) return;
      dl.appendChild(el('dt', null, f[0]));
      dl.appendChild(el('dd', null, f[1]));
    });
    card.appendChild(dl);
    if ((it.changes || []).length) {
      var ch = el('p', 'radar-change', '変化：' + it.changes[it.changes.length - 1].text);
      card.appendChild(ch);
    }
    if (it.shops && it.shops.length > 1) {
      var shops = el('details', 'radar-shops');
      shops.appendChild(el('summary', null, '販売先を見る'));
      it.shops.forEach(function (s) {
        var a = el('a', null, s.name + '（' + formatPrice(s.price) + '）');
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener';
        shops.appendChild(a);
      });
      card.appendChild(shops);
    }
    if (it.rakutenUrl) card.appendChild(el('p', 'radar-rakuten', '楽天にもある'));

    var actions = el('div', 'radar-actions');
    var fav = el('button', 'btn ' + (it.favorite ? 'btn-primary' : 'btn-secondary'), it.favorite ? '★ 気になる' : '☆ 気になる');
    fav.type = 'button';
    fav.addEventListener('click', function () {
      it.favorite = !it.favorite;
      Radar.set(it.productId, { favorite: it.favorite }).then(function () {
        card.parentNode.replaceChild(radarCard(it, settings), card);
        showToast(it.favorite ? 'ウォッチリストに入れました' : 'ウォッチリストから外しました');
        renderRadarDash();
      });
    });
    actions.appendChild(fav);
    var plan = el('button', 'btn btn-seed', '企画にする');
    plan.type = 'button';
    plan.addEventListener('click', function () {
      Radar.set(it.productId, { usedForPost: true });
      // 新商品は「本気出して考えてみた」ではなく、新商品専用の企画（new_release）にする
      startRelease(it);
    });
    actions.appendChild(plan);
    if (isFashion(it.name, it.category)) {
      actions.appendChild(coordButton(function () {
        // 新作レーダーの商品は、確認できた情報（予約受付中・発売日など）も持っていく（新商品を使ったコーデの表紙に使う）
        var info = releaseInfo(it);
        return { name: it.name, code: it.code, price: it.price, url: it.rakutenUrl || it.sourceUrl, image: it.imageUrl, shop: (it.shops[0] || {}).name || '', brand: it.brand, categoryLabel: it.categoryLabel, labels: info.labels, dateText: info.dateText };
      }));
    }
    var link = el('a', 'btn btn-secondary', '商品ページを見る');
    link.href = it.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    actions.appendChild(link);
    if (it.rakutenUrl && it.code) {
      var room = el('button', 'btn btn-secondary', 'ROOM候補に追加');
      room.type = 'button';
      room.addEventListener('click', function () {
        Store.setStatus({ id: it.code, code: it.code, name: it.name, price: it.price, url: it.rakutenUrl, image: it.imageUrl, intro: '', brand: it.brand }, 'room_candidate').then(function () {
          updateManageCount();
          room.textContent = 'ROOM候補に入れました';
          room.disabled = true;
        });
      });
      actions.appendChild(room);
    }
    card.appendChild(actions);
    return card;
  }

  // ダッシュボード：保存してある商品の数（押すとその一覧へ）
  function renderRadarDash() {
    return Radar.list().then(function (all) {
      var list = all.filter(function (it) { return !it.hidden && !offGenre(it); });
      var cards = [
        ['今日の新着', 'new_today', '', function (it) { return inPeriod(it, 'new_today'); }],
        ['予約受付中', '', 'PRE_ORDER', function (it) { return hasStatus(it, 'PRE_ORDER'); }],
        ['今週発売', 'week', '', function (it) { return inPeriod(it, 'week'); }],
        ['今月発売', 'month', '', function (it) { return inPeriod(it, 'month'); }],
        ['再販・再入荷', '', 'RESTOCK', function (it) { return hasStatus(it, 'RESTOCK'); }],
        ['限定・コラボ', '', 'LIMITED_COLLAB', function (it) { return hasStatus(it, 'LIMITED_COLLAB'); }],
        ['発売予定', '', 'COMING_SOON', function (it) { return hasStatus(it, 'COMING_SOON'); }],
        ['気になる', 'fav', '', function (it) { return it.favorite; }]
      ];
      radarDash.innerHTML = '';
      cards.forEach(function (c) {
        var n = list.filter(c[3]).length;
        var b = el('button', 'radar-tile');
        b.type = 'button';
        b.appendChild(el('span', 'radar-tile-label', c[0]));
        b.appendChild(el('strong', null, String(n)));
        b.appendChild(el('span', 'radar-tile-unit', '件'));
        b.addEventListener('click', function () {
          clearRadarFilters();
          if (c[1] === 'fav') rf.fav.checked = true;
          else if (c[1]) rf.period.value = c[1];
          if (c[2]) rf.status.value = c[2];
          if (c[1] === 'week' || c[1] === 'month') rf.sort.value = 'release';
          renderRadarList();
          radarCountEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        radarDash.appendChild(b);
      });
    });
  }

  function clearRadarFilters() {
    ['status', 'period', 'genre', 'brand', 'price', 'source'].forEach(function (k) { rf[k].value = ''; });
    rf.sort.value = 'new';
    rf.fav.checked = false;
  }

  function fillSelect(sel, options, allLabel) {
    var cur = sel.value;
    sel.innerHTML = '';
    var all = el('option', null, allLabel || 'すべて');
    all.value = '';
    sel.appendChild(all);
    options.forEach(function (o) {
      if (o.group) {
        var g = el('optgroup');
        g.label = o.group;
        o.items.forEach(function (x) { var op = el('option', null, x[1]); op.value = x[0]; g.appendChild(op); });
        sel.appendChild(g);
      } else {
        var op = el('option', null, o[1]);
        op.value = o[0];
        sel.appendChild(op);
      }
    });
    sel.value = cur;
    if (sel.value !== cur) sel.value = '';
  }

  function renderRadarList() {
    var settings = radarSettings();
    return Radar.list().then(function (all) {
      // ブランドの選択肢は、見つけた商品のブランドとフォロー中のブランド
      var brands = {};
      all.forEach(function (it) { if (it.brand) brands[it.brand] = true; });
      fillSelect(rf.brand, Object.keys(brands).sort().map(function (b) { return [b, b]; }));
      var list = radarFiltered(all, settings);
      var active = ['status', 'period', 'genre', 'brand', 'price', 'source'].filter(function (k) { return rf[k].value; }).length + (rf.fav.checked ? 1 : 0);
      radarFilterNote.textContent = active ? '（' + active + '件の条件）' : '';
      radarCountEl.textContent = all.length ? list.length + '件' + (active ? '（絞り込み中）' : '') : '';
      radarListEl.innerHTML = '';
      if (!all.length) {
        radarListEl.appendChild(el('p', 'manage-empty', 'まだ商品がありません。「レーダーを更新」を押すと、新作・予約の商品を集めます。'));
      } else if (!list.length) {
        radarListEl.appendChild(el('p', 'manage-empty', 'この条件に当てはまる商品はありません。'));
      }
      list.slice(0, radarShown).forEach(function (it) { radarListEl.appendChild(radarCard(it, settings)); });
      radarMoreBtn.hidden = list.length <= radarShown;
    });
  }

  // ジャンルをまとめて選ぶ・外す（ids に入っているものだけ）
  function setRadarGenres(ids, on) {
    var s = radarSettings();
    s.genres = s.genres.filter(function (id) { return ids.indexOf(id) === -1; });
    if (on) s.genres = s.genres.concat(ids);
    Radar.saveSettings(s);
    renderRadarSettings();
  }

  function renderRadarSettings() {
    var settings = radarSettings();
    radarGenresEl.innerHTML = '';
    var known = radarMeta.genres.map(function (x) { return x.id; });
    var rgCount = document.getElementById('rg-count');
    if (rgCount) rgCount.textContent = '選択中 ' + settings.genres.filter(function (id) { return known.indexOf(id) !== -1; }).length + ' / ' + known.length;
    radarMeta.groups.forEach(function (g) {
      var row = el('div', 'radar-group');
      var list = radarMeta.genres.filter(function (x) { return x.group === g.id; });
      var ids = list.map(function (x) { return x.id; });
      var head = el('div', 'radar-group-head');
      head.appendChild(el('span', 'radar-group-label', g.label + '（' + ids.filter(function (id) { return settings.genres.indexOf(id) !== -1; }).length + '/' + ids.length + '）'));
      [['全選択', true], ['クリア', false]].forEach(function (a) {
        var btn = el('button', 'link-btn', a[0]);
        btn.type = 'button';
        btn.addEventListener('click', function () { setRadarGenres(ids, a[1]); });
        head.appendChild(btn);
      });
      row.appendChild(head);
      var chips = el('div', 'radar-chips');
      list.forEach(function (x) {
        var on = settings.genres.indexOf(x.id) !== -1;
        var b = el('button', 'radar-chip' + (on ? ' on' : ''), x.label);
        b.type = 'button';
        b.addEventListener('click', function () {
          var s = radarSettings();
          s.genres = on ? s.genres.filter(function (id) { return id !== x.id; }) : s.genres.concat([x.id]);
          Radar.saveSettings(s);
          renderRadarSettings();
        });
        chips.appendChild(b);
      });
      row.appendChild(chips);
      radarGenresEl.appendChild(row);
    });
    renderBrandManager();
  }

  [['rg-all', true], ['rg-none', false]].forEach(function (b) {
    var btn = document.getElementById(b[0]);
    if (btn) btn.addEventListener('click', function () { setRadarGenres(radarMeta.genres.map(function (x) { return x.id; }), b[1]); });
  });
  // 「畳む」：その欄を閉じて、見出しが見える位置に戻す
  Array.prototype.forEach.call(document.querySelectorAll('.fold-btn'), function (b) {
    b.addEventListener('click', function () {
      var box = document.getElementById(b.getAttribute('data-fold'));
      if (!box) return;
      box.open = false;
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  function showRadarLast() {
    var s = radarSettings();
    if (s.lastScanAt) {
      var d = new Date(s.lastScanAt);
      radarLast.textContent = '最後に更新：' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') + '。見つけた商品はこのiPhoneに貯まっていきます。';
    }
  }

  // 巡回：選んだジャンルから6つずつ順番に（毎回同じジャンルにならないように）
  function scanRadar() {
    var s = radarSettings();
    if (!s.genres.length) { showToast('見るジャンルを選んでください'); document.getElementById('radar-settings').open = true; var gb = document.getElementById('radar-genre-box'); if (gb) gb.open = true; return; }
    var n = s.genres.length;
    var genres = [];
    for (var i = 0; i < Math.min(6, n); i++) genres.push(s.genres[(s.cursor + i) % n]);
    radarScanBtn.disabled = true;
    radarLoading.hidden = false;
    radarMessage.hidden = true;
    // フォロー中のブランドのうち、しばらく確認していないものだけを数個（全部を毎回は探さない）
    var bs = brandState();
    var scanBrands = window.BrandFollow.pickForScan(radarMeta.genres, bs);
    postJson('api/radar', { genres: genres, brands: scanBrands, round: s.round }).then(function (r) {
      if (r.status !== 200) {
        radarMessage.textContent = r.data.error || 'うまく取得できませんでした。もう一度お試しください。';
        radarMessage.className = 'message error';
        radarMessage.hidden = false;
        return;
      }
      window.BrandFollow.markChecked(bs, scanBrands);
      return Radar.merge(r.data.items || []).then(function (res) {
        var next = radarSettings();
        next.cursor = (s.cursor + genres.length) % Math.max(1, n);
        next.round = s.round + 1;
        next.lastScanAt = Date.now();
        Radar.saveSettings(next);
        showRadarLast();
        var labels = genres.map(function (id) { var g = radarMeta.genres.filter(function (x) { return x.id === id; })[0]; return g ? g.label : id; });
        radarMessage.textContent = (r.data.notice || (r.data.items.length + '件見つかりました（新しく見つけた商品 ' + res.added + '件）')) +
          (res.changed ? '。気になる商品のうち' + res.changed + '件に変化があります' : '') + '。今回見たジャンル：' + labels.join('・');
        radarMessage.className = 'message';
        radarMessage.hidden = false;
        renderRadarDash();
        renderRadarList();
      });
    }, function () {
      radarMessage.textContent = '通信できませんでした。電波の良い場所でもう一度お試しください。';
      radarMessage.className = 'message error';
      radarMessage.hidden = false;
    }).then(function () {
      radarScanBtn.disabled = false;
      radarLoading.hidden = true;
    });
  }

  // ---- ブランドのフォロー（原則すべて選択。要らないものだけ外す。設定は js/brand-follow.js） ----
  var bfSearch = document.getElementById('bf-search');
  var bfGenre = document.getElementById('bf-genre');
  var bfList = document.getElementById('bf-list');
  var bfCount = document.getElementById('bf-count');
  var bfGenreNote = document.getElementById('bf-genre-note');
  var brandStateCache = null;

  function brandState() {
    if (!brandStateCache) brandStateCache = window.BrandFollow.load(radarMeta.genres, Radar.settings());
    return brandStateCache;
  }
  function followedBrands() {
    return radarMeta.genres.length ? window.BrandFollow.followed(radarMeta.genres, brandState()) : [];
  }
  function genreLabel(id) {
    var g = radarMeta.genres.filter(function (x) { return x.id === id; })[0];
    return g ? g.label : '';
  }
  function agoText(t) {
    if (!t) return 'まだ確認していません';
    var min = Math.round((Date.now() - t) / 60000);
    if (min < 60) return min + '分前に確認';
    if (min < 60 * 24) return Math.round(min / 60) + '時間前に確認';
    return Math.round(min / 60 / 24) + '日前に確認' + (min > 60 * 24 * 3 ? '（情報が古い可能性があります）' : '');
  }

  // 検索・ジャンルで絞った一覧（「全選択／クリア」はこの一覧が対象）
  function bfVisible() {
    var q = bfSearch.value.trim().toLowerCase();
    var g = bfGenre.value;
    return window.BrandFollow.catalog(radarMeta.genres, brandState()).filter(function (b) {
      if (g && b.genres.indexOf(g) === -1) return false;
      return !q || b.name.toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderBrandManager() {
    if (!radarMeta.genres.length) return;
    var s = brandState();
    var all = window.BrandFollow.catalog(radarMeta.genres, s);
    var on = all.filter(function (b) { return window.BrandFollow.isFollowed(b, s); }).length;
    bfCount.textContent = '自動で探す ' + on + ' / ' + all.length;
    var g = bfGenre.value;
    bfGenreNote.textContent = g && s.excludedGenres.indexOf(g) !== -1
      ? '「' + genreLabel(g) + '」はジャンルごと外しています（あとから追加されるブランドも対象外）。「全選択」で戻せます。'
      : '';
    bfList.innerHTML = '';
    var list = bfVisible();
    if (!list.length) bfList.appendChild(el('p', 'hint', '当てはまるブランドがありません。'));
    list.forEach(function (b) {
      var row = el('div', 'bf-row');
      var label = el('label', 'bf-check');
      var box = el('input');
      box.type = 'checkbox';
      box.checked = window.BrandFollow.isFollowed(b, s);
      box.addEventListener('change', function () {
        window.BrandFollow.setSelected(s, [b.name], box.checked);
        // ジャンルごと外しているジャンルのブランドを選び直したら、そのジャンルは戻す
        if (box.checked) b.genres.forEach(function (gid) { if (s.excludedGenres.indexOf(gid) !== -1) window.BrandFollow.setGenreExcluded(s, gid, false); });
        renderBrandManager();
      });
      label.appendChild(box);
      label.appendChild(el('span', 'bf-name', b.name));
      label.appendChild(el('span', 'bf-genre', b.genres.map(genreLabel).join('・') + (b.custom ? '（追加）' : '')));
      row.appendChild(label);
      var more = el('button', 'btn btn-secondary bf-go', '新作を探す');
      more.type = 'button';
      more.addEventListener('click', function () { showBrandDetail(b.name, true); });
      row.appendChild(more);
      bfList.appendChild(row);
    });
  }

  function bfSelectAll(on) {
    var s = brandState();
    window.BrandFollow.setSelected(s, bfVisible().map(function (b) { return b.name; }), on);
    // ジャンルで絞っているときは、ジャンルごと外す／戻す（あとから追加されたブランドにも効く）
    if (bfGenre.value && !bfSearch.value.trim()) window.BrandFollow.setGenreExcluded(s, bfGenre.value, !on);
    renderBrandManager();
  }
  document.getElementById('bf-all').addEventListener('click', function () { bfSelectAll(true); });
  document.getElementById('bf-none').addEventListener('click', function () { bfSelectAll(false); });
  bfSearch.addEventListener('input', renderBrandManager);
  bfGenre.addEventListener('change', renderBrandManager);
  addClear(bfSearch);

  // ---- ブランドの詳細：そのブランドの新作・予約・再販。個別の検索はフォローの設定を変えない ----
  var brandDetail = document.getElementById('brand-detail');
  var bdName = document.getElementById('bd-name');
  var bdMeta = document.getElementById('bd-meta');
  var bdList = document.getElementById('bd-list');
  var bdNote = document.getElementById('bd-note');
  var bdSearchBtn = document.getElementById('bd-search');
  var bdFollowBtn = document.getElementById('bd-follow');
  var bdCurrent = '';

  // search: true なら、しばらく探していないときはすぐ探す（12時間以内に探した結果があれば、それを見せて検索を節約）
  function showBrandDetail(name, search) {
    bdCurrent = name;
    brandDetail.hidden = false;
    document.getElementById('radar-settings').open = false;
    bdNote.textContent = '';
    drawBrandDetail();
    brandDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var last = window.BrandFollow.lastChecked(brandState(), name);
    if (search && (!last || Date.now() - last >= window.BrandFollow.CACHE_MS)) bdSearchBtn.click();
    else if (search) bdNote.textContent = agoText(last).replace('に確認', 'に探した結果です') + '。最新にするには「もう一度探す」を押してください。';
  }

  function drawBrandDetail() {
    var s = brandState();
    var b = window.BrandFollow.catalog(radarMeta.genres, s).filter(function (x) { return x.name.toLowerCase() === bdCurrent.toLowerCase(); })[0] || { name: bdCurrent, genres: [] };
    var followed = window.BrandFollow.isFollowed(b, s);
    bdName.textContent = b.name + 'の新作探し';
    bdMeta.textContent = (b.genres.map(genreLabel).join('・') || 'ジャンル未設定') + '｜' + (followed ? 'レーダーでも自動で探す' : 'レーダーでは探さない') + '｜' + agoText(window.BrandFollow.lastChecked(s, b.name));
    bdFollowBtn.textContent = followed ? '自動で探すのをやめる' : 'レーダーでも自動で探す';
    Radar.list().then(function (all) {
      var mine = all.filter(function (it) { return !it.hidden && it.brand && it.brand.toLowerCase() === b.name.toLowerCase(); });
      bdList.innerHTML = '';
      if (!mine.length) { bdList.appendChild(el('p', 'manage-empty', bdSearchBtn.disabled ? '探しています…' : 'まだこのブランドの新作は見つかっていません。「もう一度探す」で探せます。')); return; }
      var groups = [
        ['予約受付中', function (it) { return hasStatus(it, 'PRE_ORDER'); }],
        ['新作・発売予定', function (it) { return hasStatus(it, 'NEW') || hasStatus(it, 'COMING_SOON') || hasStatus(it, 'NEW_COLOR'); }],
        ['再販・再入荷', function (it) { return hasStatus(it, 'RESTOCK'); }],
        ['限定・コラボ・その他', function () { return true; }]
      ];
      var used = {};
      var settings = radarSettings();
      groups.forEach(function (g) {
        var list = mine.filter(function (it) { return !used[it.productId] && g[1](it); });
        if (!list.length) return;
        bdList.appendChild(el('p', 'label', g[0] + '（' + list.length + '）'));
        list.forEach(function (it) { used[it.productId] = true; bdList.appendChild(radarCard(it, settings)); });
      });
    });
  }

  bdSearchBtn.addEventListener('click', function () {
    var name = bdCurrent;
    bdSearchBtn.disabled = true;
    bdSearchBtn.textContent = '探しています…（10〜20秒）';
    postJson('api/radar', { mode: 'brand', brand: name }).then(function (r) {
      if (r.status !== 200) { bdNote.textContent = r.data.error || '探せませんでした。'; return; }
      // 確認した日時は残す（キャッシュ）。フォローの設定は変えない
      window.BrandFollow.markChecked(brandState(), [name]);
      return Radar.merge(r.data.items || []).then(function (res) {
        bdNote.textContent = (r.data.items || []).length + '件見つかりました（新しく見つけた商品 ' + res.added + '件）';
        drawBrandDetail();
        renderRadarDash();
        renderRadarList();
      });
    }, function () {
      bdNote.textContent = '通信できませんでした。電波の良い場所でもう一度お試しください。';
    }).then(function () {
      bdSearchBtn.disabled = false;
      bdSearchBtn.textContent = 'もう一度探す';
    });
  });
  bdFollowBtn.addEventListener('click', function () {
    var s = brandState();
    var b = window.BrandFollow.catalog(radarMeta.genres, s).filter(function (x) { return x.name.toLowerCase() === bdCurrent.toLowerCase(); })[0];
    if (!b) { window.BrandFollow.addCustom(s, bdCurrent, ''); } else {
      var on = !window.BrandFollow.isFollowed(b, s);
      window.BrandFollow.setSelected(s, [b.name], on);
      if (on) b.genres.forEach(function (gid) { window.BrandFollow.setGenreExcluded(s, gid, false); });
    }
    drawBrandDetail();
    renderBrandManager();
  });
  document.getElementById('bd-back').addEventListener('click', function () { brandDetail.hidden = true; });

  // ---- 新商品専用の企画（new_release）：「本気出して考えてみた」は使わず、新作向けのタイトルを3〜5案 ----
  var RELEASE_LABELS = { NEW: 'NEW', PRE_ORDER: '予約受付中', COMING_SOON: '発売予定', RESTOCK: '再販', LIMITED: '限定', COLLAB: 'コラボ', NEW_COLOR: '新色', SPECIAL: '期間限定' };

  // 表紙に出す情報（確認できたものだけ）
  function releaseInfo(it) {
    var labels = [];
    if (inPeriod(it, 'week') && it.releaseDate >= ymd(new Date())) labels.push('今週発売');
    ['NEW', 'PRE_ORDER', 'COMING_SOON', 'RESTOCK', 'COLLAB', 'LIMITED', 'NEW_COLOR', 'SPECIAL'].forEach(function (s) {
      if (it.status.indexOf(s) !== -1 && labels.length < 3) labels.push(RELEASE_LABELS[s]);
    });
    var dateText = it.releaseDate ? dateText0(it.releaseDate) + (it.releaseDate > ymd(new Date()) ? '発売予定' : '発売')
      : it.releaseText || (it.preorderEnd ? '予約締切 ' + dateText0(it.preorderEnd) : '');
    return { labels: labels, brand: it.brand || '', dateText: dateText };
  }
  function dateText0(d) {
    var p = d.split('-');
    return Number(p[1]) + '月' + Number(p[2]) + '日';
  }

  function startRelease(it) {
    message.hidden = true;
    genreEl.hidden = true;
    results.innerHTML = '';
    var view = { item: it, ideas: [], mood: 'living', info: releaseInfo(it) };
    renderRelease(view, true);
    window.scrollTo({ top: results.offsetTop - 8, behavior: 'smooth' });
    postJson('api/release-ideas', {
      product: {
        name: it.name, brand: it.brand, price: it.price, code: it.code, shop: (it.shops[0] || {}).name || '', url: it.rakutenUrl || it.sourceUrl, image: it.imageUrl,
        category: it.category, categoryLabel: it.categoryLabel, status: it.status, releaseDate: it.releaseDate, releaseMonth: it.releaseMonth,
        releaseText: it.releaseText, preorderStart: it.preorderStart, preorderEnd: it.preorderEnd
      }
    }).then(function (r) {
      results.innerHTML = '';
      if (r.status !== 200) {
        renderRelease(view, false);
        showMessage(r.data.error || 'タイトルを考えられませんでした。もう一度お試しください。', true, r.data.detail);
        return;
      }
      view.ideas = r.data.ideas || [];
      view.mood = r.data.mood || 'living';
      view.product = r.data.product;
      saveLast('release', view);
      renderRelease(view, false);
      if (r.data.notice) showMessage(r.data.notice, false, r.data.detail);
    }, function () {
      results.innerHTML = '';
      renderRelease(view, false);
      showMessage('通信できませんでした。電波の良い場所でもう一度お試しください。', true);
    });
  }

  function renderRelease(view, thinking) {
    var it = view.item;
    var head = el('article', 'card seed-head');
    head.appendChild(el('p', 'type-chip', '新商品の企画（新作特集）'));
    var top = el('div', 'cand-top');
    if (it.imageUrl) {
      var img = el('img', 'cand-thumb');
      img.src = it.imageUrl;
      img.alt = '';
      img.onerror = function () { img.remove(); };
      top.appendChild(img);
    }
    var info = el('div', 'cand-info');
    var chips = el('div', 'chips');
    view.info.labels.forEach(function (l) { chips.appendChild(el('span', 'radar-status st-new', l)); });
    info.appendChild(chips);
    info.appendChild(el('h3', 'cand-name', it.name.replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 50)));
    info.appendChild(el('p', 'cand-meta', [it.brand, formatPrice(it.price), view.info.dateText].filter(Boolean).join('｜')));
    top.appendChild(info);
    head.appendChild(top);
    results.appendChild(head);
    if (thinking) {
      var wait = el('div', 'loading');
      wait.appendChild(el('div', 'spinner'));
      var t = el('p');
      t.innerHTML = '新作のタイトルを考えています…<br><span class="sub">10〜30秒ほどかかります</span>';
      wait.appendChild(t);
      results.appendChild(wait);
      return;
    }
    results.appendChild(el('p', 'hint seed-hint', 'タイトルは自由に直せます。「この企画で作る」で、この商品を必ず採用にしたまま、新作を中心に15〜20件探します。'));
    view.ideas.forEach(function (x, i) {
      var card = el('article', 'idea-card seed-idea');
      var h = el('div', 'idea-head');
      h.appendChild(el('span', 'idea-no', '案' + (i + 1)));
      if (x.angle) h.appendChild(el('span', 'plan-type', x.angle));
      card.appendChild(h);
      var field = el('label', 'field');
      field.appendChild(el('span', 'field-label', 'タイトル'));
      var input = el('textarea', 'textarea release-title');
      input.rows = 2;
      input.maxLength = 40;
      input.value = x.title;
      input.addEventListener('change', function () { x.title = input.value.trim(); saveLast('release', view); });
      field.appendChild(input);
      card.appendChild(field);
      addClear(input);
      if (x.why) card.appendChild(el('p', 'idea-why', x.why));
      if ((x.searchGenres || []).length) {
        var ul = el('ul', 'angle-list');
        x.searchGenres.forEach(function (g) { ul.appendChild(el('li', null, g)); });
        card.appendChild(ul);
      }
      var go = el('button', 'btn btn-primary', 'この企画で作る');
      go.type = 'button';
      go.addEventListener('click', function () {
        var title = input.value.trim() || x.title;
        var idea = Object.assign({}, x.idea, { title: title });
        History.add({ title: title, topic: title, genre: it.categoryLabel, postType: '新商品', brands: it.brand ? [it.brand] : [] }).then(setCurrentPostId, function () {});
        exploreProducts({
          idea: idea,
          seed: { name: it.name, code: it.code, price: it.price, url: it.rakutenUrl || it.sourceUrl, image: it.imageUrl, shop: (it.shops[0] || {}).name || '', brand: it.brand, reason: idea.howUsed, caption: it.releaseText || '' },
          release: Object.assign({ mood: view.mood, hero: {
            code: it.code, url: it.rakutenUrl || it.sourceUrl, name: it.name, brand: it.brand, price: it.price, image: it.imageUrl,
            categoryLabel: it.categoryLabel || '', status: it.status || [], releaseDate: it.releaseDate || null, releaseMonth: it.releaseMonth || null
          } }, view.info)
        });
      });
      card.appendChild(go);
      results.appendChild(card);
    });
  }

  radarScanBtn.addEventListener('click', scanRadar);
  radarMoreBtn.addEventListener('click', function () { radarShown += 40; renderRadarList(); });
  document.getElementById('rf-clear').addEventListener('click', function () { clearRadarFilters(); renderRadarList(); });
  Object.keys(rf).forEach(function (k) { rf[k].addEventListener('change', function () { radarShown = 40; renderRadarList(); }); });
  document.getElementById('radar-brand-add').addEventListener('click', function () {
    var b = radarBrandInput.value.trim();
    if (!b) return;
    // 一覧に足して（自動で探す対象にも入る）、すぐにそのブランドの新作を探す
    window.BrandFollow.addCustom(brandState(), b, bfGenre.value);
    radarBrandInput.value = '';
    renderBrandManager();
    showBrandDetail(b, true);
  });
  addClear(radarBrandInput);

  fetch('api/radar').then(function (r) { return r.json(); }).then(function (d) {
    radarMeta = d;
    fillSelect(rf.genre, (d.groups || []).map(function (g) {
      return { group: g.label, items: d.genres.filter(function (x) { return x.group === g.id; }).map(function (x) { return [x.id, x.label]; }) };
    }));
    fillSelect(rf.source, (d.sources || []).map(function (s) { return [s.id, s.label]; }));
    fillSelect(bfGenre, (d.groups || []).map(function (g) {
      return { group: g.label, items: d.genres.filter(function (x) { return x.group === g.id; }).map(function (x) { return [x.id, x.label]; }) };
    }), 'すべてのジャンル');
    renderRadarSettings();
  }).catch(function () {});
  showRadarLast();
  renderRadarDash();
  renderRadarList();

  var savedMode = 'idea';
  try { savedMode = localStorage.getItem(MODE_KEY) || 'idea'; } catch (e) {}
  showMode(savedMode);
  restoreLast();
  renderPlanDrafts();
  showView();
  updateManageCount();
  freeText.placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
  restoreConditions();
  renderTypeChoices();
  searchBtn.addEventListener('click', searchWithConditions);
  discoverBtn.addEventListener('click', discover);
  resetBtn.hidden = !getPass();
  resetBtn.addEventListener('click', function () {
    setPass('');
    resetBtn.hidden = true;
    showToast('合言葉を消しました');
  });
})();
