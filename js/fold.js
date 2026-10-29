// 畳めるようにする：画面の大きなまとまり（企画・候補・コーデ・商品カードなど）の右上に「畳む」を付ける。
// 畳むと、見出し（タイトル・商品名）だけ残す。画面を作り直しても自動で付く（MutationObserver）。
(function () {
  'use strict';

  var SELECTORS = [
    '#results > .card', '#results > section', '#results > article', '.cand-card', '.coord-look', '.coord-search', '.coord-post',
    '.plan-search', '.furusato-compare', '.furusato-plan', '.furusato-rules', '.trend-brand', '.job-card', '.radar-card',
    '.room-item', '.manage-card', '.history-card', '#radar-dash'
  ].join(',');
  var TITLE_SEL = '.curation-title, .plan-title-input, .idea-title, .coord-look-name, .plan-section-title, .cand-name, .card-title, h2, h3, .type-chip, .list-count';

  function titleOf(node) {
    var t = node.querySelector(TITLE_SEL);
    if (!t) return node.getAttribute('data-fold-title') || 'このまとまり';
    var text = t.value != null && t.tagName !== 'H3' && t.tagName !== 'H2' ? t.value : t.textContent;
    return String(text || '').trim().slice(0, 40) || 'このまとまり';
  }
  function setFolded(node, on) {
    node.classList.toggle('folded', on);
    var title = node.querySelector(':scope > .fold-title');
    if (on) {
      if (!title) {
        title = document.createElement('p');
        title.className = 'fold-title';
        title.addEventListener('click', function () { setFolded(node, false); }); // 畳んだ見出しを押しても開く
        node.insertBefore(title, node.firstChild);
      }
      title.textContent = titleOf(node);
    }
    var btn = node.querySelector(':scope > .fold-toggle');
    if (btn) { btn.textContent = on ? '開く' : '畳む'; btn.setAttribute('aria-expanded', on ? 'false' : 'true'); }
  }
  function attach(node) {
    if (node.classList.contains('foldable') || node.closest('.fold-skip')) return;
    node.classList.add('foldable');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fold-toggle';
    btn.textContent = '畳む';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setFolded(node, !node.classList.contains('folded'));
    });
    node.appendChild(btn);
  }
  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(SELECTORS)) attach(root);
    Array.prototype.forEach.call(root.querySelectorAll(SELECTORS), attach);
  }

  // まとめて畳む／開く（area の中のまとまり）
  function all(area, on) {
    Array.prototype.forEach.call((area || document).querySelectorAll('.foldable'), function (n) {
      if (n.offsetParent !== null || n.classList.contains('folded')) setFolded(n, on);
    });
  }

  var timer = null;
  var pending = [];
  new MutationObserver(function (list) {
    list.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) pending.push(n); }); });
    clearTimeout(timer);
    timer = setTimeout(function () { var p = pending; pending = []; p.forEach(scan); }, 30);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  window.Fold = { all: all, set: setFolded, scan: scan };
})();
