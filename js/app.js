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
    if (opts.curation) {
      addSection(card, 'こんな人に', p.forWho);
      addSection(card, 'この位置の理由', p.why);
      addSection(card, '価格差の中身', p.tradeoff);
      addSection(card, 'ブランド・贈り物として', p.brandNote);
    } else {
      addSection(card, '選定理由', p.reason);
    }
    if (p.memo) {
      var memoBox = el('div', 'memo-box');
      memoBox.appendChild(el('b', null, 'くまの一言メモ'));
      memoBox.appendChild(document.createTextNode(p.memo));
      card.appendChild(memoBox);
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
    if (opts.onAdopt) card.appendChild(adoptBox(p, card, opts.onAdopt));
    card.appendChild(statusBox(p));
    return card;
  }

  // 「採用」「今回は外す」：外した商品はInstagram投稿に使わない
  function adoptBox(p, card, onChange) {
    var box = el('div', 'adopt');
    var yes = el('button', null, '採用');
    var no = el('button', null, '今回は外す');
    yes.type = no.type = 'button';
    function show() {
      yes.className = p.excluded ? '' : 'on-yes';
      no.className = p.excluded ? 'on-no' : '';
      card.classList.toggle('excluded', !!p.excluded);
    }
    yes.addEventListener('click', function () { p.excluded = false; show(); onChange(); });
    no.addEventListener('click', function () { p.excluded = true; show(); onChange(); });
    box.appendChild(yes);
    box.appendChild(no);
    show();
    return box;
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
        var actions = el('div', 'plan-actions');
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
    var view = parts[0] === '#manage' ? 'manage' : parts[0] === '#compose' ? 'compose' : 'discover';
    if (view === 'manage' && parts[1] && (MANAGE_TABS.indexOf(parts[1]) !== -1 || parts[1] === 'history')) currentTab = parts[1];
    manageView.hidden = view !== 'manage';
    discoverView.hidden = view !== 'discover';
    composeView.hidden = view !== 'compose';
    Array.prototype.forEach.call(document.querySelectorAll('.view-tab'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === (view === 'compose' ? 'manage' : view));
    });
    if (view === 'manage') renderManage();
    if (view === 'compose') renderCompose();
    window.scrollTo(0, 0);
  }

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
  var draft = { theme: '', category: '', cta: 0, items: [], summary: emptySummary() };
  var lastOutput = null; // { files: [{ name, blob }], folder }

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
    draft.cta = Number(igCta.value) || 0;
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

  // 選び方まとめから、まとめの文章と商品をそのまま持って画像づくりへ
  function composeFromCuration(d) {
    loadDraft();
    var adopted = d.products.filter(function (p) { return !p.excluded; });
    if (!adopted.length) { showToast('採用した商品がありません'); return; }
    draft.items = adopted.map(function (p) {
      var reason = [p.pick, p.why || p.reason].filter(Boolean).join('。');
      return { id: p.code || p.url, code: p.code, name: p.name, price: p.price, image: p.image, url: p.url, reason: reason, intro: p.intro || '', role: p.role || '', memo: p.memo || '', brand: p.brand || '' };
    });
    draft.postId = currentPostId();
    if (d.idea) {
      draft.theme = d.idea.topic;
      draft.subtitle = d.idea.subtitle || '';
      draft.category = (d.idea.topic || '').length <= 8 ? d.idea.topic : d.idea.genre.split('・')[0];
    }
    draft.summary = { enabled: true, typeName: d.typeName || '', title: d.title || '', lead: d.lead || '', verdict: d.verdict || '' };
    draft.planId = d.plan ? d.plan.id : '';
    if (d.plan) {
      draft.theme = d.plan.topic;
      draft.subtitle = d.plan.subtitle || '';
      draft.category = d.plan.category || '';
    }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    // 投稿管理にも「Instagram投稿待ち」として入れておく
    Promise.all(adopted.map(function (p) { return Store.setStatus(p, 'ig_waiting'); })).then(updateManageCount);
    if (draft.postId) {
      window.PostHistory.update(draft.postId, {
        products: adopted.map(function (p) { return { name: p.name, brand: p.brand || '', price: p.price }; }),
        brands: adopted.map(function (p) { return p.brand; }).filter(Boolean)
      });
    }
    location.hash = '#compose';
  }

  function renderCompose() {
    loadDraft();
    igTheme.value = draft.theme || '';
    igCategory.value = draft.category || '';
    igSubtitle.value = draft.subtitle || '';
    igCta.value = String(draft.cta || 0);
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
        ctaMessage: window.IgRender.CTA_MESSAGES[draft.cta || 0],
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
        if (draft.postId) {
          History.update(draft.postId, {
            status: 'generated',
            topic: copy.topic,
            products: draft.items.map(function (it) { return { name: it.name, brand: it.brand || '', price: it.price }; })
          });
        }
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

  document.getElementById('ig-mark').addEventListener('click', function () {
    Promise.all(draft.items.map(function (it) { return Store.setStatus(it, 'ig_posted'); })).then(function () {
      updateManageCount();
      showToast(draft.items.length + '商品を「Instagram投稿済み」にしました');
      if (draft.planId) setPlanDone(draft.planId, true);
      if (draft.postId) History.update(draft.postId, { status: 'posted' });
    });
  });
  window.addEventListener('hashchange', showView);

  // まとめ全体を1つの文章にする（ROOMのコレクション説明やSNS投稿用）
  function curationText(d) {
    var marks = ['①', '②', '③', '④', '⑤'];
    var lines = [d.title, ''];
    if (d.axis) lines.push('比較軸：' + d.axis, '');
    if (d.lead) lines.push(d.lead, '');
    d.products.forEach(function (p, i) {
      lines.push(marks[i] + ' ' + p.role + (p.giftClass ? '（' + p.giftClass + '）' : '') + '：' + p.name.replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 40) + '（' + formatPrice(p.price) + '）');
      if (p.pick) lines.push('→ ' + p.pick);
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
    card.appendChild(el('p', 'type-chip', d.plan ? '企画' + d.plan.no + '｜' + d.plan.postType : d.idea ? '今日の企画｜' + d.idea.postType : d.typeName));
    card.appendChild(el('h2', 'curation-title', d.title));
    if (d.axis) {
      var axis = el('p', 'axis');
      axis.appendChild(document.createTextNode('比較軸：'));
      axis.appendChild(el('strong', null, d.axis));
      card.appendChild(axis);
    }
    if (d.lead) card.appendChild(el('p', 'reason', d.lead));
    if (d.verdict) card.appendChild(el('p', 'verdict', d.verdict));
    var actions = el('div', 'actions');
    actions.appendChild(copyButton('まとめ文をコピー', function () { return curationText(d); }));
    var toIg = el('button', 'btn btn-primary', '採用した商品でInstagram投稿を作る');
    toIg.type = 'button';
    toIg.addEventListener('click', function () { composeFromCuration(d); });
    actions.appendChild(toIg);
    card.appendChild(el('p', 'adopt-count'));
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
    var header = renderCurationHeader(data);
    results.appendChild(header);
    var count = header.querySelector('.adopt-count');
    function onAdopt() {
      var n = data.products.filter(function (p) { return !p.excluded; }).length;
      count.textContent = '採用 ' + n + ' / ' + data.products.length + '商品（Instagram投稿は5〜6商品が目安）';
      saveLast('curate', data);
    }
    data.products.forEach(function (p) { results.appendChild(renderCard(p, { curation: true, onAdopt: onAdopt })); });
    onAdopt();
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
    // 企画以外（条件指定・型だけ）で作ったまとめは、どの投稿にも結びつけない
    if (!conditions.idea && !conditions.planId) setCurrentPostId('');
    request('api/curate', conditions, searchBtn, function (data, products) {
      if (!products.length) return;
      if ((data.idea || data.plan) && currentPostId()) {
        History.update(currentPostId(), { brands: products.map(function (p) { return p.brand; }).filter(Boolean) });
      }
      saveLast('curate', data);
      renderCuration(data);
    });
  }

  // ---- 今日の企画（編集部） ----
  var CURRENT_POST_KEY = 'room-current-post';
  var History = window.PostHistory;
  var ideasBtn = document.getElementById('ideas-btn');
  var ideasEl = document.getElementById('ideas');
  var ideasLoading = document.getElementById('ideas-loading');
  var ideasMessage = document.getElementById('ideas-message');

  function currentPostId() {
    try { return localStorage.getItem(CURRENT_POST_KEY) || ''; } catch (e) { return ''; }
  }
  function setCurrentPostId(id) {
    try { localStorage.setItem(CURRENT_POST_KEY, id || ''); } catch (e) {}
  }

  function renderIdea(idea, i) {
    var card = el('article', 'idea-card');
    var head = el('div', 'idea-head');
    head.appendChild(el('span', 'idea-no', '案' + (i + 1)));
    head.appendChild(el('span', 'plan-type', idea.postType));
    card.appendChild(head);
    card.appendChild(el('h3', 'idea-title', idea.title));
    if (idea.subtitle) card.appendChild(el('p', 'idea-sub', idea.subtitle));
    var dl = el('dl', 'idea-facts');
    [['ターゲット', idea.target], ['価格帯', idea.priceBand], ['ジャンル', idea.genre], ['比較軸', idea.axis], ['ブランド', (idea.brands || []).join('・')]].forEach(function (f) {
      if (!f[1]) return;
      dl.appendChild(el('dt', null, f[0]));
      dl.appendChild(el('dd', null, f[1]));
    });
    card.appendChild(dl);
    if (idea.whyInteresting) card.appendChild(el('p', 'idea-why', idea.whyInteresting));
    var roles = el('div', 'idea-roles');
    idea.slots.forEach(function (sl) { roles.appendChild(el('span', null, sl.label)); });
    card.appendChild(roles);
    var go = el('button', 'btn btn-primary', 'この企画で作る');
    go.type = 'button';
    go.addEventListener('click', function () { startIdea(idea); });
    card.appendChild(go);
    return card;
  }

  function startIdea(idea) {
    History.add({
      title: idea.title, topic: idea.topic, subtitle: idea.subtitle, genre: idea.genre, postType: idea.postType,
      target: idea.target, priceBand: idea.priceBand, brands: idea.brands || []
    }).then(setCurrentPostId, function () {});
    curate({ idea: idea });
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function thinkIdeas() {
    ideasMessage.hidden = true;
    ideasEl.innerHTML = '';
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
      (r.data.ideas || []).forEach(function (idea, i) { ideasEl.appendChild(renderIdea(idea, i)); });
      try { localStorage.setItem('room-last-ideas', JSON.stringify(r.data.ideas || [])); } catch (e) {}
    }).catch(function () {
      ideasMessage.textContent = '通信できませんでした。電波の良い場所でもう一度お試しください。';
      ideasMessage.className = 'message error';
      ideasMessage.hidden = false;
    }).then(function () {
      ideasLoading.hidden = true;
      ideasBtn.disabled = false;
      ideasBtn.textContent = '別の3案を考える';
    });
  }
  ideasBtn.addEventListener('click', thinkIdeas);
  document.getElementById('quick-random').addEventListener('click', function () {
    discover(null, discoverBtn);
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('quick-cond').addEventListener('click', function () {
    var box = document.getElementById('cond-box');
    box.open = true;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // 前回考えた企画を残しておく（ほかのアプリから戻っても消えないように）
  try {
    (JSON.parse(localStorage.getItem('room-last-ideas')) || []).forEach(function (idea, i) { ideasEl.appendChild(renderIdea(idea, i)); });
    if (ideasEl.children.length) ideasBtn.textContent = '別の3案を考える';
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
        var make = el('button', 'btn btn-primary', 'この企画で作る');
        make.type = 'button';
        make.addEventListener('click', function () {
          document.getElementById('plans-box').open = false;
          History.add({ title: p.topic + 'について本気出して考えてみた', topic: p.topic, subtitle: p.subtitle, genre: p.category, postType: p.postType })
            .then(setCurrentPostId, function () {});
          curate({ planId: p.id });
        });
        actions.appendChild(make);
      }
      row.appendChild(actions);
      plansList.appendChild(row);
    });
  }

  fetch('api/plans').then(function (r) { return r.json(); }).then(function (d) {
    plans = d.plans || [];
    renderPlans();
  }).catch(function () {});

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
