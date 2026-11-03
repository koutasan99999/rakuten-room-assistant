// 「この商品から広げる」の画面：起点の商品 → 探し方（6種類）→ 楽天の実在の商品（5〜8点）→ その商品からさらに広げる…を何段階でも。
// 探索の経路と結果は ExploreStore（このiPhone）に残り、再読み込みしても消えない。採用は PitchStore（既存の採用の記録）に入り、投稿セットの制作に引き継がれる。
(function () {
  'use strict';

  var K = window.AppKit;
  var X = window.ExploreStore;
  var S = window.PitchStore;
  if (!K || !X || !S) return;
  var el = K.el;
  var MODES = [
    ['cheaper', '似たデザインで\nもっと安い'],
    ['brand', '同じブランドの\n別商品'],
    ['same_price', '同じ価格帯の\n他ブランド'],
    ['coord', 'コーディネート・\n組み合わせ'],
    ['accessory', '小物・\n周辺アイテム'],
    ['omakase', 'AIにおまかせで\n広げる']
  ];
  var LABEL = {};
  MODES.forEach(function (m) { LABEL[m[0]] = m[1].replace('\n', ''); });
  var TIER = { high: '高価格帯', mid: '中価格帯', low: '低価格帯' };
  var MODE_KEY = 'room-explore-mode';
  var modeFor = {};
  try { modeFor = JSON.parse(localStorage.getItem(MODE_KEY)) || {}; } catch (e) {}
  var busy = {}; // nodeId:mode → true
  var container = null;

  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function linkBtn(text, url) { var a = el('a', 'link-btn', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function cleanName(n) { return String(n || '').replace(/[【\[].*?[】\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70) || n; }
  function photo(p, cls) {
    if (!p.image) return el('div', cls + ' pitch-noimg', '写真なし');
    var img = el('img', cls);
    img.src = p.image; img.alt = cleanName(p.name); img.loading = 'lazy';
    img.onerror = function () { img.replaceWith(el('div', cls + ' pitch-noimg', '写真なし')); };
    return img;
  }
  function priceLine(p) { return (p.price ? K.formatPrice(p.price) : '価格は未取得') + (p.price ? '（税込' + (p.postage ? '・' + p.postage : '') + '）' : ''); }
  function saveMode() { try { localStorage.setItem(MODE_KEY, JSON.stringify(modeFor)); } catch (e) {} }
  function adoptedState(p) { var f = S.find(p); return f && f.status === 'adopt'; }

  // 採用：探索経路と関係を残して、既存の採用の記録（PitchStore）に入れる。同じ商品は二重に登録しない
  function adopt(p, node, mode) {
    var path = X.pathText(node.id, LABEL) + (mode ? ' →（' + LABEL[mode] + '）' + cleanName(p.name).slice(0, 24) : '');
    var r = S.adoptFrom(X.slim(p), '', { origin: 'explore', path: mode ? path : X.pathText(node.id, LABEL), relation: p.relation || node.product.relation || '', exploreNode: node.id });
    if (!r) { K.showToast('採用を保存できませんでした'); return; }
    K.showToast(r.already ? 'すでに採用済みです（二重には登録しません）' : '採用しました。投稿セットの制作に使います');
    if (!r.already && window.PitchView && window.PitchView.makeIntro) window.PitchView.makeIntro(S.get(r.key));
    paint();
  }

  function search(node, mode, again) {
    var k = node.id + ':' + mode;
    if (busy[k]) return;
    busy[k] = true;
    modeFor[node.id] = mode; saveMode();
    paint();
    var path = X.path(node.id).map(function (n) { return { name: n.product.name, code: n.product.code, mode: n.mode }; });
    var payload = { action: 'expand', nodeId: node.id, base: node.product, mode: mode, path: path, exclude: { codes: again ? X.shownCodes(node.id) : [], names: [] } };
    K.jobCall('pitch', payload, { label: '広げる：' + cleanName(node.product.name).slice(0, 16) + '（' + LABEL[mode] + '）', genre: '' }).then(function (r) {
      save(node.id, mode, r.status, r.data);
    }).then(function () { delete busy[k]; paint(); });
  }
  function save(id, mode, status, data) {
    if (status === 200 && data && Array.isArray(data.items)) X.setResult(id, mode, data);
    else X.setResult(id, mode, { error: (data && data.error) || '探せませんでした', items: [] });
  }
  // 再読み込みなどで画面が待っていない間に終わった探索も、保存する（app.js の Jobs.notify から呼ぶ）
  function onJobDone(job) {
    var b = (job.params && job.params.body) || {};
    if (b.action !== 'expand' || !b.nodeId) return false;
    var ok = job.status === 'completed' || job.status === 'partial';
    save(b.nodeId, b.mode, ok ? 200 : 500, ok ? job.result : { error: job.error || '探せませんでした' });
    paint();
    return true;
  }

  function open(product, from) {
    var n = X.start(product, from);
    if (window.PitchView && window.PitchView.show) window.PitchView.show('explore');
    else { location.hash = '#pitch'; }
    window.scrollTo(0, 0);
    return n;
  }

  // ---- 1つの商品カード（探索結果）----
  function resultCard(p, node, mode) {
    var c = el('article', 'card xp-card');
    c.appendChild(photo(p, 'xp-photo'));
    var chips = el('div', 'chips');
    if (p.tier) chips.appendChild(el('span', 'tag xp-tier xp-' + p.tier, TIER[p.tier]));
    if (p.group) chips.appendChild(el('span', 'tag', p.group));
    if (adoptedState(p)) chips.appendChild(el('span', 'tag src-adopted', '採用済み'));
    c.appendChild(chips);
    c.appendChild(el('h3', 'cand-name', cleanName(p.name)));
    var meta = el('p', 'cand-meta');
    meta.appendChild(el('strong', 'cand-price', priceLine(p)));
    meta.appendChild(el('span', 'cand-shop', (p.brand ? p.brand + '｜' : '') + (p.shop || '')));
    c.appendChild(meta);
    var dl = el('dl', 'radar-facts');
    [['元の商品との関係', p.relation], ['似ている点', p.similar], ['違う点', p.differ], ['特徴', p.feature]].forEach(function (x) { if (x[1]) { dl.appendChild(el('dt', null, x[0])); dl.appendChild(el('dd', null, x[1])); } });
    if (p.reviewCount) { dl.appendChild(el('dt', null, '確認できる数字')); dl.appendChild(el('dd', null, '楽天のレビュー ' + p.reviewCount.toLocaleString('ja-JP') + '件（平均' + (p.reviewAverage || '-') + '）' + (p.byReviews ? '｜レビューの多い順で確認' : ''))); }
    c.appendChild(dl);
    var acts = el('div', 'xp-actions');
    acts.appendChild(btn('この商品から広げる', 'btn btn-discover xp-go', function () { X.branch(node.id, p, mode); window.scrollTo(0, 0); paint(); }));
    var row = el('div', 'pitch-row');
    row.appendChild(btn(adoptedState(p) ? '採用済み' : 'いいじゃん！（採用）', 'btn btn-primary', function () { adopt(p, node, mode); }));
    if (p.url) row.appendChild(linkBtn('楽天で見る', p.url));
    acts.appendChild(row);
    c.appendChild(acts);
    return c;
  }

  function resultsBlock(node, mode) {
    var box = el('div', 'xp-results');
    var k = node.id + ':' + mode;
    var r = X.result(node.id, mode);
    if (busy[k]) { box.appendChild(el('p', 'hint pitch-busy', '「' + LABEL[mode] + '」で、楽天の実在の商品を探しています…（30〜60秒。別のアプリを開いても続きます）')); return box; }
    if (!r) { box.appendChild(btn('「' + LABEL[mode] + '」で探す', 'btn btn-discover', function () { search(node, mode); })); return box; }
    if (r.error) {
      box.appendChild(el('p', 'hint pitch-warn', r.error));
      box.appendChild(btn('もう一度探す', 'status-btn', function () { search(node, mode); }));
      return box;
    }
    var head = (r.searched || []).map(function (s) { return '「' + s.keyword + '」' + s.found + '件'; }).join('、');
    box.appendChild(el('p', 'hint', LABEL[mode] + '：' + r.items.length + '件｜楽天で ' + head + ' を確認' + (r.at ? '（' + new Date(r.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '）' : '')));
    if (r.notice) box.appendChild(el('p', 'hint pitch-warn', r.notice));
    if (mode === 'coord' && (r.looks || []).length) {
      r.looks.forEach(function (l, i) {
        var items = r.items.filter(function (it) { return it.look === i; });
        if (!items.length) return;
        box.appendChild(el('p', 'field-label xp-look', 'コーデ案' + 'ABC'[i] + '：' + l.name));
        if (l.concept) box.appendChild(el('p', 'hint', l.concept));
        items.forEach(function (it) { box.appendChild(resultCard(it, node, mode)); });
      });
      var rest = r.items.filter(function (it) { return it.look == null || !r.looks[it.look]; });
      if (rest.length) { box.appendChild(el('p', 'field-label xp-look', 'ほかに合わせられる物')); rest.forEach(function (it) { box.appendChild(resultCard(it, node, mode)); }); }
    } else r.items.forEach(function (it) { box.appendChild(resultCard(it, node, mode)); });
    box.appendChild(btn('別の候補を探す（今の候補は外す）', 'status-btn', function () { search(node, mode, true); }));
    return box;
  }

  function nodeView(node) {
    var wrap = el('div');
    var path = X.path(node.id);
    // 経路（起点 → … → 今）。押すとその商品に戻る
    var crumbs = el('div', 'xp-crumbs');
    path.forEach(function (n, i) {
      if (i) crumbs.appendChild(el('span', 'xp-arrow', '→' + (n.mode ? '（' + LABEL[n.mode] + '）' : '')));
      var b = btn((i + 1) + '. ' + cleanName(n.product.name).slice(0, 18), 'xp-crumb' + (n.id === node.id ? ' active' : ''), function () { X.setCurrent(n.id); paint(); });
      crumbs.appendChild(b);
    });
    wrap.appendChild(crumbs);
    var nav = el('div', 'pitch-row');
    if (node.parent) nav.appendChild(btn('← 前の商品に戻る', 'status-btn', function () { X.setCurrent(node.parent); paint(); window.scrollTo(0, 0); }));
    if (path.length > 1) nav.appendChild(btn('最初の商品に戻る', 'status-btn', function () { X.setCurrent(path[0].id); paint(); window.scrollTo(0, 0); }));
    nav.appendChild(btn('起点の一覧', 'status-btn', function () { X.setCurrent(''); paint(); }));
    wrap.appendChild(nav);
    var kids = X.children(node.id);
    if (kids.length) {
      var kb = el('div', 'xp-crumbs');
      kb.appendChild(el('span', 'xp-arrow', 'この商品から広げた先：'));
      kids.slice(0, 8).forEach(function (k) { kb.appendChild(btn('→ ' + cleanName(k.product.name).slice(0, 16), 'xp-crumb', function () { X.setCurrent(k.id); paint(); window.scrollTo(0, 0); })); });
      wrap.appendChild(kb);
    }

    // 今の商品
    var p = node.product;
    var c = el('article', 'card xp-card xp-current');
    c.appendChild(photo(p, 'xp-photo'));
    var chips = el('div', 'chips');
    chips.appendChild(el('span', 'role', path.length === 1 ? '起点の商品' : path.length + '段目'));
    if (adoptedState(p)) chips.appendChild(el('span', 'tag src-adopted', '採用済み'));
    if (p.tier) chips.appendChild(el('span', 'tag xp-tier xp-' + p.tier, TIER[p.tier]));
    c.appendChild(chips);
    c.appendChild(el('h3', 'cand-name', cleanName(p.name)));
    var meta = el('p', 'cand-meta');
    meta.appendChild(el('strong', 'cand-price', priceLine(p)));
    meta.appendChild(el('span', 'cand-shop', (p.brand ? p.brand + '｜' : '') + (p.shop || '')));
    c.appendChild(meta);
    if (node.parent && p.relation) c.appendChild(el('p', 'hint', '「' + cleanName(X.get(node.parent).product.name).slice(0, 20) + '」から（' + LABEL[node.mode] + '）：' + p.relation));
    var row = el('div', 'pitch-row');
    row.appendChild(btn(adoptedState(p) ? '採用済み' : 'いいじゃん！（採用）', 'btn btn-primary', function () { adopt(p, node, ''); }));
    if (p.url) row.appendChild(linkBtn('楽天で見る', p.url));
    c.appendChild(row);
    c.appendChild(el('p', 'hint', '公式ページ：未取得（楽天の商品ページで確認してください）'));
    wrap.appendChild(c);

    // 探し方
    wrap.appendChild(el('p', 'field-label', 'この商品から、どう広げますか？'));
    var grid = el('div', 'xp-modes');
    var cur = modeFor[node.id] || '';
    MODES.forEach(function (m) {
      var has = X.result(node.id, m[0]);
      var b = btn(m[1] + (has && !has.error ? '\n（' + has.items.length + '件）' : ''), 'xp-mode' + (cur === m[0] ? ' active' : ''), function () {
        modeFor[node.id] = m[0]; saveMode();
        if (!X.result(node.id, m[0]) && !busy[node.id + ':' + m[0]]) search(node, m[0]);
        else paint();
      });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    if (cur) wrap.appendChild(resultsBlock(node, cur));
    return wrap;
  }

  function rootsView() {
    var wrap = el('div');
    wrap.appendChild(el('p', 'editor-note', '商品カードの「この商品から広げる」を押すと、ここで関連する実在の商品を探せます。見つけた商品から、さらに何段階でも広げられます。'));
    var roots = X.roots();
    if (!roots.length) { wrap.appendChild(el('p', 'manage-empty', 'まだ広げた商品はありません。「プレゼン」か「採用済み」の商品から始めてください。')); return wrap; }
    wrap.appendChild(el('p', 'field-label', '前に広げた商品（' + roots.length + '）'));
    roots.slice(0, 30).forEach(function (n) {
      var c = el('article', 'card');
      var top = el('div', 'cand-top');
      top.appendChild(photo(n.product, 'cand-thumb'));
      var info = el('div', 'cand-info');
      info.appendChild(el('p', 'thief-cand-name', cleanName(n.product.name)));
      info.appendChild(el('p', 'hint', priceLine(n.product) + '｜探索した商品 ' + X.countUnder(n.id) + '件'));
      top.appendChild(info);
      c.appendChild(top);
      c.appendChild(btn('続きから開く', 'btn btn-secondary', function () { X.setCurrent(n.id); paint(); }));
      wrap.appendChild(c);
    });
    return wrap;
  }

  function paint() {
    if (!container || !container.isConnected) return;
    container.innerHTML = '';
    var n = X.current();
    container.appendChild(n ? nodeView(n) : rootsView());
  }
  function render(target) { container = target; paint(); }

  window.ExploreView = { render: render, open: open, onJobDone: onJobDone, LABEL: LABEL };
})();
