(function () {
  'use strict';

  var PASS_KEY = 'room-passcode';
  var STATS_KEY = 'room-genre-stats';
  var RECENT_KEY = 'room-recent-items';
  var LAST_KEY = 'room-last-result';
  var MAX_RECENT = 20;
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
        if (h.brands && h.brands.length) card.appendChild(el('p', 'history-meta', 'ブランド：' + h.brands.join('・')));
        if (h.products && h.products.length) card.appendChild(el('p', 'history-meta', '商品：' + h.products.map(function (x) { return x.name.slice(0, 18); }).join(' / ')));
        if (h.products && h.products.length && h.products[0].url) {
          var roomDoneCount = h.products.filter(function (x) { return (h.roomDone || {})[x.id]; }).length;
          card.appendChild(el('p', 'history-meta', 'ROOM登録 ' + progressBar(roomDoneCount, h.products.length) + ' ' + roomDoneCount + '/' + h.products.length +
            (h.collectionName ? '｜コレクション「' + h.collectionName + '」' + (h.collectionDone ? '登録済み' : '未登録') : '')));
        }
        var actions = el('div', 'plan-actions');
        if (h.products && h.products.length && h.products[0].url) {
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
    var view = parts[0] === '#manage' ? 'manage' : parts[0] === '#compose' ? 'compose' : parts[0] === '#room' ? 'room' : 'discover';
    roomView.hidden = view !== 'room';
    if (view === 'room') renderRoom(parts[1] || draft.postId);
    if (view === 'manage' && parts[1] && (MANAGE_TABS.indexOf(parts[1]) !== -1 || parts[1] === 'history')) currentTab = parts[1];
    manageView.hidden = view !== 'manage';
    discoverView.hidden = view !== 'discover';
    composeView.hidden = view !== 'compose';
    Array.prototype.forEach.call(document.querySelectorAll('.view-tab'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === (view === 'compose' || view === 'room' ? 'manage' : view));
    });
    if (view === 'manage') renderManage();
    if (view === 'compose') renderCompose();
    window.scrollTo(0, 0);
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

        var actions = el('div', 'actions');
        if (p.code && p.intro) {
          var room = el('a', 'btn btn-primary', 'コピーしてROOMで投稿');
          room.href = roomUrl(p.code);
          room.target = '_blank';
          room.rel = 'noopener';
          room.addEventListener('click', function () {
            legacyCopy(p.intro).then(function () { showToast('紹介文をコピーしました。ROOMで貼り付けて投稿してください'); }, function () {});
          });
          actions.appendChild(room);
        }
        var page = el('a', 'btn btn-secondary', '楽天の商品ページを開く');
        page.href = p.url;
        page.target = '_blank';
        page.rel = 'noopener';
        actions.appendChild(page);
        if (p.intro) actions.appendChild(copyButton('ROOM紹介文をコピー', function () { return p.intro; }));
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
    draft.summary = Object.assign(draft.summary || emptySummary(), {
      enabled: igSumOn.checked,
      title: igSumTitle.value.trim(),
      lead: igSumLead.value.trim(),
      verdict: igSumVerdict.value.trim()
    });
    igSumFields.hidden = !igSumOn.checked;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
  }

  igCreate.addEventListener('click', function () {
    loadDraft();
    draft.items = selectedList().map(function (x) {
      return { id: x.id, code: x.code, name: x.name, price: x.price, image: x.image, url: x.url, reason: x.reason || x.why || '', intro: x.intro || '', role: x.role || '' };
    });
    draft.summary = emptySummary(); // 商品が変わったので2枚目はAIに作ってもらう
    draft.planId = '';
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
      mid.appendChild(el('p', 'ig-item-name', it.name));
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
        btn.addEventListener('click', function () {
          if (b[1] === 0) draft.items.splice(i, 1);
          else draft.items.splice(i + b[1], 0, draft.items.splice(i, 1)[0]);
          saveDraft();
          renderComposeItems();
        });
        move.appendChild(btn);
      });
      row.appendChild(move);
      igItemsEl.appendChild(row);
    });
  }
  [igTheme, igCategory, igSubtitle, igCta, igSumOn, igSumTitle, igSumLead, igSumVerdict].forEach(function (x) { x.addEventListener('change', saveDraft); });

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
    return fetch('api/image?url=' + encodeURIComponent(url), { headers: { 'X-App-Passcode': getPass() } })
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
      var slides = window.IgRender.renderPost({
        topic: copy.topic,
        category: draft.category || copy.category,
        subtitle: draft.subtitle || '迷ったので整理しました',
        bear: r[2],
        ctaMessage: draft.cta === 'collection' ? collectionCtaMessage(copy.topic) : window.IgRender.CTA_MESSAGES[draft.cta || 0],
        summary: !sum.enabled ? null : needSummary
          ? (copy.summary ? Object.assign({ typeName: sum.typeName || 'まず結論' }, copy.summary) : null)
          : { typeName: sum.typeName || 'まず結論', title: sum.title, lead: sum.lead, verdict: sum.verdict },
        items: draft.items.map(function (it, i) {
          var c = copy.items[i] || {};
          return { image: r[1][i], shortName: c.shortName || it.name, subline: c.subline, memo: c.memo, price: it.price, role: it.role, slug: c.slug };
        })
      });
      var notes = [];
      if (copy.notice) notes.push(copy.notice);
      if (!r[2]) notes.push('くまのアイコン画像（assets/kuma.png）がまだ無いため、仮のクマで作りました。');
      var missing = r[1].filter(function (x) { return !x; }).length;
      if (missing) notes.push(missing + '件の商品画像を読み込めませんでした。');
      if (notes.length) showIgMessage(notes.join(' '), false, copy.detail);

      return Promise.all(slides.map(function (s) { return canvasToBlob(s.canvas); })).then(function (blobs) {
        lastOutput = {
          folder: 'generated_posts/' + today() + '_' + (copy.topicSlug || 'post'),
          files: slides.map(function (s, i) { return { name: s.fileName, blob: blobs[i] }; }),
          caption: copy.caption || ''
        };
        igCaption.value = lastOutput.caption;
        // 投稿履歴に、ROOM登録準備で使う商品情報（投稿順）とコレクション名を残す
        var productsFull = draft.items.map(function (it, i) {
          var c = copy.items[i] || {};
          return {
            id: it.code || it.url || it.id, code: it.code, name: it.name, shortName: c.shortName || '', brand: it.brand || '',
            price: it.price, url: it.url, image: it.image, intro: it.intro || '', role: it.role || ''
          };
        });
        var ensurePost = draft.postId ? Promise.resolve(draft.postId) : History.add({
          title: copy.topic + 'について本気出して考えてみた', topic: copy.topic, subtitle: draft.subtitle, genre: draft.category
        });
        ensurePost.then(function (id) {
          draft.postId = id;
          try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
          return History.get(id).then(function (rec) {
            return History.update(id, {
              status: rec && rec.status === 'posted' ? 'posted' : 'generated',
              topic: copy.topic,
              products: productsFull,
              collectionName: (rec && rec.collectionName) || History.collectionNameFor(copy.topic)
            });
          });
        });
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
          brief: data.brief, title: data.title, typeName: data.typeName, idea: data.idea, plan: data.plan,
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
    return card;
  }

  function renderExplore(d) {
    var head = el('article', 'card curation-head');
    head.appendChild(el('p', 'type-chip', d.plan ? '企画' + d.plan.no + '｜' + d.plan.postType : d.idea ? '今日の企画｜' + d.idea.postType : '選び方：' + d.typeName));
    head.appendChild(el('h2', 'curation-title', d.title));
    var anglesBox = el('div', 'angles');
    function drawAngles() {
      anglesBox.innerHTML = '';
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
    head.appendChild(el('p', 'hint', 'この中から、Instagram投稿に使う5〜6商品を選んでください。'));
    results.appendChild(head);

    var bar = el('div', 'pick-bar');
    var count = el('p', 'pick-count');
    var toPost = el('button', 'btn btn-primary', 'この商品で投稿を作る');
    toPost.type = 'button';
    bar.appendChild(count);
    bar.appendChild(toPost);
    results.appendChild(bar);

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

    function picked() { return d.candidates.filter(function (c) { return c.picked; }); }
    function update() {
      var n = picked().length;
      count.textContent = '選択中 ' + n + ' / 6';
      bar.classList.toggle('ok', n >= 5 && n <= 6);
      bar.classList.toggle('over', n > 6);
      toPost.disabled = n === 0;
      saveLast('explore', d);
    }
    function draw() {
      list.innerHTML = '';
      var view = viewCandidates(d.candidates, d.view || 'recommend');
      if (!view.length) list.appendChild(el('p', 'manage-empty', 'この絞り込みに当てはまる候補はありません。'));
      view.forEach(function (c) { list.appendChild(candidateCard(c, update)); });
    }
    select.addEventListener('change', function () { d.view = select.value; draw(); saveLast('explore', d); });

    moreBtn.addEventListener('click', function () {
      moreBtn.disabled = true;
      moreBtn.textContent = '探しています…（30〜60秒）';
      moreNote.textContent = '';
      seenForSearch().then(function (seen) {
        return postJson('api/explore', {
          more: { brief: d.brief, angles: d.angles },
          exclude: { codes: d.candidates.map(function (c) { return c.code; }), names: d.candidates.map(function (c) { return c.name; }) },
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
      if ((items.length < 5 || items.length > 6) &&
        !window.confirm(items.length + '商品を選んでいます。Instagram投稿は5〜6商品が目安です。このまま作りますか？')) return;
      toPost.disabled = true;
      toPost.textContent = 'ROOM紹介文を作っています…';
      postJson('api/intros', {
        title: d.title,
        items: items.map(function (c) { return { name: c.name, price: c.price, role: c.role, brand: c.brand, reason: c.reason, caption: c.caption }; })
      }).then(function (r) {
        if (r.status !== 200) showToast('紹介文を作れなかったので、あとでROOM登録準備の画面で確認してください');
        if (r.data && r.data.notice) showToast(r.data.notice);
        composeFromExplore(d, items, (r.data && r.data.intros) || []);
      }, function () {
        showToast('通信できませんでした。電波の良い場所でもう一度お試しください。');
      }).then(function () {
        toPost.disabled = false;
        toPost.textContent = 'この商品で投稿を作る';
      });
    });

    draw();
    update();
  }

  // 選んだ商品と企画の情報を持って、Instagram画像づくりへ
  function composeFromExplore(d, items, intros) {
    loadDraft();
    draft.items = items.map(function (c, i) {
      return { id: c.code || c.url, code: c.code, name: c.name, price: c.price, image: c.image, url: c.url, reason: c.reason || '', intro: intros[i] || '', role: c.postRole || c.role || c.angle || '', memo: c.memo || '', brand: c.brand || '' };
    });
    draft.postId = d.idea || d.plan ? currentPostId() : '';
    draft.genre = d.idea ? d.idea.genre || '' : '';
    draft.postType = d.idea ? d.idea.postType : d.plan ? d.plan.postType : '';
    draft.planId = d.plan ? d.plan.id : '';
    if (d.idea) {
      draft.theme = d.idea.topic;
      draft.subtitle = d.idea.subtitle || '';
      draft.category = (d.idea.topic || '').length <= 8 ? d.idea.topic : (d.idea.genre || '').split('・')[0];
    } else if (d.plan) {
      draft.theme = d.plan.topic;
      draft.subtitle = d.plan.subtitle || '';
      draft.category = d.plan.category || '';
    } else {
      draft.theme = String(d.title || '').replace(/(について)?本気出して考えてみた$/, '').slice(0, 30);
      draft.subtitle = '';
      draft.category = '';
    }
    // 2枚目の「まとめ」は、選んだ商品に合わせてAIに作ってもらう
    draft.summary = { enabled: true, typeName: d.typeName || '', title: '', lead: '', verdict: '' };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    // 投稿管理にも「Instagram投稿待ち」として入れておく
    Promise.all(draft.items.map(function (p) { return Store.setStatus(p, 'ig_waiting'); })).then(updateManageCount, function () {});
    if (draft.postId) {
      History.update(draft.postId, {
        products: draft.items.map(function (p) { return { name: p.name, brand: p.brand, price: p.price }; }),
        brands: draft.items.map(function (p) { return p.brand; }).filter(Boolean)
      });
    }
    markSeen(items, 'ig');
    location.hash = '#compose';
  }

  // ---- 探し方の切り替え（企画から／条件を指定して／完全ランダム。1つずつ開く） ----
  var MODE_KEY = 'room-search-mode';
  var modeTabs = document.querySelectorAll('.mode-tab');
  function showMode(mode) {
    Array.prototype.forEach.call(modeTabs, function (t) { t.classList.toggle('active', t.getAttribute('data-mode') === mode); });
    ['idea', 'cond', 'random'].forEach(function (m) { document.getElementById('mode-' + m).hidden = m !== mode; });
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
    if ((idea.slots || []).length) {
      var roles = el('div', 'idea-roles');
      idea.slots.forEach(function (sl) { roles.appendChild(el('span', null, sl.label)); });
      card.appendChild(roles);
    }
    var actions = el('div', 'idea-actions');
    var go = el('button', 'btn btn-primary', 'この企画で探す');
    go.type = 'button';
    go.addEventListener('click', function () { startIdea(idea); });
    var edit = el('button', 'btn btn-secondary', '編集');
    edit.type = 'button';
    edit.addEventListener('click', function () { card.parentNode.replaceChild(ideaEditor(idea, i), card); });
    actions.appendChild(go);
    actions.appendChild(edit);
    card.appendChild(actions);
    return card;
  }

  function textField(label, value, multi) {
    var wrap = el('label', 'field');
    wrap.appendChild(el('span', 'field-label', label));
    var input = el(multi ? 'textarea' : 'input', multi ? 'textarea' : 'input');
    if (multi) input.rows = 2; else input.type = 'text';
    input.value = value || '';
    wrap.appendChild(input);
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

  // 選び方の型：名前だけで意味が分かるよう、短い説明を添えて並べる
  function renderTypeChoices() {
    typeChoices.innerHTML = '';
    meta.types.forEach(function (t) {
      var b = el('button', 'type-choice' + (t.id === selectedType ? ' active' : ''));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', t.id === selectedType ? 'true' : 'false');
      b.appendChild(el('strong', null, t.name));
      b.appendChild(el('span', null, t.desc));
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

  var savedMode = 'idea';
  try { savedMode = localStorage.getItem(MODE_KEY) || 'idea'; } catch (e) {}
  showMode(savedMode);
  restoreLast();
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
