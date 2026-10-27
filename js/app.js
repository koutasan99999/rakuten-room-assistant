(function () {
  'use strict';

  var PASS_KEY = 'room-passcode';
  var STATS_KEY = 'room-genre-stats';
  var RECENT_KEY = 'room-recent-items';
  var MAX_RECENT = 20;
  var discoverBtn = document.getElementById('discover-btn');
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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderCard(p, genreId) {
    var card = el('article', 'card');

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

    card.appendChild(el('p', 'label', '選定理由'));
    card.appendChild(el('p', 'reason', p.reason));
    card.appendChild(el('p', 'label', 'ROOM紹介文'));
    card.appendChild(el('p', 'intro', p.intro));
    card.appendChild(el('p', 'count', p.intro.length + '字'));

    var actions = el('div', 'actions');
    var link = el('a', 'btn btn-primary', '楽天で商品を見る');
    link.href = p.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.addEventListener('click', function () { recordStat(genreId, 'clicked'); });
    actions.appendChild(link);

    var copyBtn = el('button', 'btn btn-secondary', '紹介文をコピー');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', function () {
      copyText(p.intro).then(function () {
        recordStat(genreId, 'copied');
        copyBtn.textContent = 'コピーしました';
        copyBtn.classList.add('done');
        showToast('紹介文をコピーしました');
        setTimeout(function () {
          copyBtn.textContent = '紹介文をコピー';
          copyBtn.classList.remove('done');
        }, 2000);
      }, function () {
        showToast('コピーできませんでした。紹介文を長押しして選択してください');
      });
    });
    actions.appendChild(copyBtn);
    card.appendChild(actions);
    return card;
  }

  function setLoading(on) {
    discoverBtn.disabled = on;
    discoverBtn.textContent = on ? '探しています…' : 'もう一度発掘する';
    loading.hidden = !on;
  }

  function discover() {
    message.hidden = true;
    genreEl.hidden = true;
    results.innerHTML = '';
    setLoading(true);

    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 70000);

    return fetch('api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Passcode': getPass() },
      body: JSON.stringify({ stats: loadStats(), recent: loadRecent() }),
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
            return discover();
          }
          showMessage('合言葉を入力すると使えるようになります。', true);
          return;
        }
        if (r.status !== 200) {
          showMessage(r.data.error || 'うまく取得できませんでした。もう一度お試しください。', true, r.data.detail);
          return;
        }
        var products = r.data.products || [];
        if (r.data.genre && products.length) {
          genreEl.innerHTML = '';
          genreEl.appendChild(document.createTextNode('今回のジャンル：'));
          genreEl.appendChild(el('strong', null, r.data.genre));
          genreEl.hidden = false;
        }
        if (r.data.notice) showMessage(r.data.notice, products.length === 0, r.data.detail);
        if (products.length) {
          recordStat(r.data.genreId, 'shown');
          rememberProducts(products);
        }
        products.forEach(function (p) { results.appendChild(renderCard(p, r.data.genreId)); });
      })
      .catch(function (e) {
        var timeout = e && e.name === 'AbortError';
        showMessage(timeout ? '時間がかかりすぎたため中断しました。もう一度お試しください。'
          : '通信できませんでした。電波の良い場所でもう一度お試しください。', true);
      })
      .then(function () {
        clearTimeout(timer);
        setLoading(false);
      });
  }

  discoverBtn.addEventListener('click', discover);
  resetBtn.hidden = !getPass();
  resetBtn.addEventListener('click', function () {
    setPass('');
    resetBtn.hidden = true;
    showToast('合言葉を消しました');
  });
})();
