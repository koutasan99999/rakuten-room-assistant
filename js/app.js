(function () {
  'use strict';

  var PASS_KEY = 'room-passcode';
  var STATS_KEY = 'room-genre-stats';
  var RECENT_KEY = 'room-recent-items';
  var LAST_KEY = 'room-last-result';
  var MAX_RECENT = 20;
  var discoverBtn = document.getElementById('discover-btn');
  var searchBtn = document.getElementById('search-btn');
  var curateType = document.getElementById('curate-type');
  var genreSelect = document.getElementById('genre-select');
  var freeText = document.getElementById('free-text');
  var COND_KEY = 'room-conditions';
  var PLACEHOLDERS = ['例：30代男性へのプレゼント、1万円以下', '例：北欧っぽい白い食器', '例：仕事でも使いやすい香水', '例：旅行が楽になるもの', '例：最近流行ってる安いもの'];
  var loading = document.getElementById('loading');
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

  // opts.genreId: 発掘モードのジャンル記録用 / opts.curation: まとめモードの表示
  function renderCard(p, opts) {
    opts = opts || {};
    var card = el('article', 'card');
    if (p.role || p.giftClass || p.basis) {
      var chips = el('div', 'chips');
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

    if (opts.curation) {
      addSection(card, 'こんな人に', p.forWho);
      addSection(card, 'この位置の理由', p.why);
      addSection(card, '価格差の中身', p.tradeoff);
      addSection(card, 'ブランド・贈り物として', p.brandNote);
    } else {
      addSection(card, '選定理由', p.reason);
    }
    addSection(card, 'ROOM紹介文', p.intro, 'intro');
    card.appendChild(el('p', 'count', p.intro.length + '字'));

    var actions = el('div', 'actions');
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
  var currentTab = 'room_candidate';
  var igSelected = {}; // Instagram投稿待ちでチェックした商品（id → 商品）

  function updateManageCount() {
    Store.counts().then(function (c) {
      var total = MANAGE_TABS.reduce(function (sum, s) { return sum + (c[s] || 0); }, 0);
      manageCount.textContent = total ? '(' + total + ')' : '';
    });
  }

  function renderStatusTabs(counts) {
    statusTabs.innerHTML = '';
    MANAGE_TABS.forEach(function (s) {
      var tab = el('button', 'status-tab' + (s === currentTab ? ' active' : ''), Store.statusLabel(s) + '（' + (counts[s] || 0) + '）');
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
    igCreate.disabled = true; // 次の段階で、カルーセル投稿の構成・文章の自動生成につなげる
  }

  function manageCard(item) {
    var card = el('article', 'card manage-card');
    if (currentTab === 'ig_waiting') {
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
      if (status !== 'ig_waiting') delete igSelected[item.id];
      renderManage();
    }));
    return card;
  }

  function renderManage() {
    Store.counts().then(renderStatusTabs);
    igBar.hidden = currentTab !== 'ig_waiting';
    Store.list(currentTab).then(function (items) {
      manageList.innerHTML = '';
      // 他のタブへ移った商品は選択から外す
      var ids = items.map(function (x) { return x.id; });
      Object.keys(igSelected).forEach(function (id) { if (ids.indexOf(id) === -1) delete igSelected[id]; });
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
    var manage = location.hash === '#manage';
    manageView.hidden = !manage;
    discoverView.hidden = manage;
    Array.prototype.forEach.call(document.querySelectorAll('.view-tab'), function (t) {
      t.classList.toggle('active', (t.getAttribute('data-view') === 'manage') === manage);
    });
    if (manage) renderManage();
  }
  window.addEventListener('hashchange', showView);

  // まとめ全体を1つの文章にする（ROOMのコレクション説明やSNS投稿用）
  function curationText(d) {
    var marks = ['①', '②', '③', '④', '⑤'];
    var lines = [d.title, ''];
    if (d.lead) lines.push(d.lead, '');
    d.products.forEach(function (p, i) {
      lines.push(marks[i] + ' ' + p.role + (p.giftClass ? '（' + p.giftClass + '）' : '') + '：' + p.name.replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 40) + '（' + formatPrice(p.price) + '）');
      if (p.forWho) lines.push('・' + p.forWho);
      if (p.why) lines.push('・' + p.why);
      if (p.tradeoff) lines.push('・' + p.tradeoff);
      if (p.brandNote) lines.push('・' + p.brandNote);
      lines.push('');
    });
    if (d.verdict) lines.push(d.verdict);
    return lines.join('\n').trim();
  }

  function renderCurationHeader(d) {
    var card = el('article', 'card curation-head');
    card.appendChild(el('p', 'type-chip', d.typeName));
    card.appendChild(el('h2', 'curation-title', d.title));
    if (d.lead) card.appendChild(el('p', 'reason', d.lead));
    if (d.verdict) card.appendChild(el('p', 'verdict', d.verdict));
    var actions = el('div', 'actions');
    actions.appendChild(copyButton('まとめ文をコピー', function () { return curationText(d); }));
    card.appendChild(actions);
    return card;
  }

  var buttonLabels = {};
  function setLoading(on, activeBtn) {
    [searchBtn, discoverBtn].forEach(function (b) {
      if (!buttonLabels[b.id]) buttonLabels[b.id] = b.textContent;
      b.disabled = on;
      if (b === activeBtn) b.textContent = on ? '作っています…' : buttonLabels[b.id];
    });
    loading.hidden = !on;
  }

  // APIを呼ぶ共通処理（合言葉の入力・エラー表示・時間切れを含む）
  function request(path, body, btn, onSuccess) {
    message.hidden = true;
    genreEl.hidden = true;
    results.innerHTML = '';
    setLoading(true, btn);

    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 70000);

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
            return request(path, body, btn, onSuccess);
          }
          showMessage('合言葉を入力すると使えるようになります。', true);
          return;
        }
        if (r.status !== 200) {
          showMessage(r.data.error || 'うまく取得できませんでした。もう一度お試しください。', true, r.data.detail);
          return;
        }
        var products = r.data.products || [];
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
    if (!last || !last.data || !(last.data.products || []).length) return;
    if (Date.now() - last.at > 24 * 60 * 60 * 1000) return; // 1日以上前の結果は出さない
    if (last.mode === 'curate') renderCuration(last.data);
    else renderDiscover(last.data);
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
    actions.appendChild(copyButton('Instagram用にまとめてコピー', function () { return discoverText(data); }, null, '6商品分をまとめてコピーしました'.replace('6', String(data.products.length))));
    card.appendChild(actions);
    return card;
  }

  function renderDiscover(data) {
    var products = data.products || [];
    // 条件を指定したときは読み取った条件を、ランダムのときはジャンルを表示
    var shown = data.condition || data.genre;
    if (shown && products.length) {
      genreEl.innerHTML = '';
      genreEl.appendChild(document.createTextNode(data.condition ? '今回の条件：' : '今回のジャンル：'));
      genreEl.appendChild(el('strong', null, shown));
      genreEl.hidden = false;
    }
    if (products.length >= 2) results.appendChild(renderDiscoverHeader(data));
    products.forEach(function (p) { results.appendChild(renderCard(p, { genreId: data.genreId })); });
  }

  function renderCuration(data) {
    results.appendChild(renderCurationHeader(data));
    data.products.forEach(function (p) { results.appendChild(renderCard(p, { curation: true })); });
  }

  // 単品の発掘。conditions を渡さなければ完全ランダム
  function discover(conditions, btn) {
    var body = { stats: loadStats(), recent: loadRecent() };
    if (conditions) { body.genre = conditions.genre; body.free = conditions.free; }
    request('api/discover', body, btn || discoverBtn, function (data, products) {
      if (products.length) {
        recordStat(data.genreId, 'shown');
        rememberProducts(products);
        saveLast('discover', data);
      }
      renderDiscover(data);
    });
  }

  function curate(conditions) {
    request('api/curate', conditions, searchBtn, function (data, products) {
      if (!products.length) return;
      saveLast('curate', data);
      renderCuration(data);
    });
  }

  function readConditions() {
    return { genre: genreSelect.value, type: curateType.value, free: freeText.value.trim() };
  }
  function saveConditions() {
    try { localStorage.setItem(COND_KEY, JSON.stringify(readConditions())); } catch (e) {}
  }
  function restoreConditions() {
    var c;
    try { c = JSON.parse(localStorage.getItem(COND_KEY)); } catch (e) { return; }
    if (!c) return;
    genreSelect.value = c.genre || '';
    curateType.value = c.type || '';
    freeText.value = c.free || '';
  }

  // 「この条件で発掘する」：型があれば選び方まとめ、なければ単品の発掘（ジャンル・自由入力つき）
  function searchWithConditions() {
    var c = readConditions();
    saveConditions();
    if (c.type) curate(c);
    else discover({ genre: c.genre, free: c.free }, searchBtn);
  }

  restoreLast();
  showView();
  updateManageCount();
  freeText.placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
  restoreConditions();
  searchBtn.addEventListener('click', searchWithConditions);
  discoverBtn.addEventListener('click', function () { discover(null, discoverBtn); });
  resetBtn.hidden = !getPass();
  resetBtn.addEventListener('click', function () {
    setPass('');
    resetBtn.hidden = true;
    showToast('合言葉を消しました');
  });
})();
