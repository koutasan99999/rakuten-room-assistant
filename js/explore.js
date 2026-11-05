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
    ['omakase', 'テーマで広げる\n（おまかせ）'],
    ['cheaper', '似たデザインで\nもっと安い'],
    ['brand', '同じブランドの\n別商品'],
    ['same_price', '同じ価格帯の\n他ブランド'],
    ['coord', 'コーディネート・\n組み合わせ'],
    ['accessory', '小物・\n周辺アイテム'],
  ];
  var LABEL = {};
  MODES.forEach(function (m) { LABEL[m[0]] = m[1].replace('\n', ''); });
  var TIER = { high: '高価格帯', mid: '中価格帯', low: '低価格帯' };
  var busy = {}; // nodeId → { mode, kind }（1つの商品で同時に動く探索は1つ）
  var filterFor = {}; // nodeId → 表示する探索カテゴリー（'' はすべて）
  var NEW_WANT = { omakase: 9 };   // 最初の探索で選ぶ点数（おまかせは9件前後のミックス。ほかは8）
  var MORE_WANT = 3;               // 今の結果に追加するときの点数
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
  function adoptedState(p) { var f = S.find(p); return f && f.status === 'adopt'; }

  // 採用：探索経路と関係を残して、既存の採用の記録（PitchStore）に入れる。同じ商品は二重に登録しない
  function adopt(p, node, mode) {
    mode = mode || p.mode || '';
    var path = X.pathText(node.id, LABEL) + (mode ? ' →（' + LABEL[mode] + '）' + cleanName(p.name).slice(0, 24) : '');
    var r = S.adoptFrom(X.slim(p), '', { origin: 'explore', path: mode ? path : X.pathText(node.id, LABEL), relation: p.relation || node.product.relation || '', exploreNode: node.id });
    if (!r) { K.showToast('採用を保存できませんでした'); return; }
    K.showToast(r.already ? 'すでに採用済みです（二重には登録しません）' : '採用しました。投稿セットの制作に使います');
    if (!r.already && window.PitchView && window.PitchView.makeIntro) window.PitchView.makeIntro(S.get(r.key));
    // 上のタブの「採用済み（件数）」も更新する（画面全体を描き直す。探索結果は保存済みなので消えない）
    var y = window.scrollY;
    if (window.PitchView && window.PitchView.render) { window.PitchView.render(); window.scrollTo(0, y); } else paint();
  }

  // 探す。kind：new＝最初の探索（またはリセット後）／append＝今の結果に追加（前の結果は消さない・同じ商品は足さない）
  function search(node, mode, kind) {
    if (busy[node.id]) { K.showToast('この商品では、いま探しています。終わってから押してください'); return; }
    var pool = X.pool(node.id);
    kind = kind || (pool && pool.items.length ? 'append' : 'new');
    var want = kind === 'append' ? MORE_WANT : NEW_WANT[mode] || 8;
    var batchId = 'b' + Date.now().toString(36);
    busy[node.id] = { mode: mode, kind: kind };
    paint();
    var path = X.path(node.id).map(function (n) { return { name: n.product.name, code: n.product.code, mode: n.mode }; });
    // 今の結果の商品はサーバーでも外す（同じ商品を重複させない）
    var payload = { action: 'expand', nodeId: node.id, batchId: batchId, kind: kind, want: want, base: node.product, mode: mode, path: path, exclude: { codes: X.shownCodes(node.id), names: X.shownNames(node.id) } };
    K.jobCall('pitch', payload, { label: '広げる：' + cleanName(node.product.name).slice(0, 16) + '（' + LABEL[mode] + (kind === 'append' ? '・追加' : '') + '）', genre: '' }).then(function (r) {
      var res = save(node.id, batchId, mode, kind, r.status, r.data);
      if (res) K.showToast(res.added ? res.added + '件を追加しました（合計' + X.pool(node.id).items.length + '件）' : '新しい商品は見つかりませんでした（今の結果はそのままです）');
    }).then(function () { delete busy[node.id]; paint(); });
  }
  function save(id, batchId, mode, kind, status, data) {
    if (status === 200 && data && Array.isArray(data.items)) return X.addBatch(id, batchId, mode, kind, data);
    X.addError(id, batchId, mode, (data && data.error) || '探せませんでした');
    K.showToast((data && data.error) || '探せませんでした（今の結果はそのままです）');
    return null;
  }
  // 再読み込みなどで画面が待っていない間に終わった探索も、今の結果に足す（app.js の Jobs.notify から呼ぶ。同じ探索は二度足さない）
  function onJobDone(job) {
    var b = (job.params && job.params.body) || {};
    if (b.action !== 'expand' || !b.nodeId) return false;
    var ok = job.status === 'completed' || job.status === 'partial';
    var batchId = b.batchId || ('job' + job.id);
    if (ok) X.addBatch(b.nodeId, batchId, b.mode, b.kind || 'append', job.result || {});
    else X.addError(b.nodeId, batchId, b.mode, job.error || '探せませんでした');
    delete busy[b.nodeId];
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

  // ---- 1つの商品カード（探索結果）：一覧で比べやすいよう短く。似ている点・違う点・レビュー・特徴は「くわしく」に畳む ----
  function resultCard(p, node, latestNo) {
    var c = el('article', 'card xp-mini');
    c.appendChild(photo(p, 'xp-thumb'));
    var chips = el('div', 'chips');
    chips.appendChild(el('span', 'tag xp-axis', p.axisLabel || LABEL[p.mode] || ''));
    if (p.batchNo > 1 && p.batchNo === latestNo) chips.appendChild(el('span', 'tag xp-new', '追加'));
    if (adoptedState(p)) chips.appendChild(el('span', 'tag src-adopted', '採用済み'));
    c.appendChild(chips);
    c.appendChild(el('p', 'xp-name', cleanName(p.name)));
    if (p.brand) c.appendChild(el('p', 'xp-brand', p.brand));
    c.appendChild(el('p', 'xp-price', p.price ? K.formatPrice(p.price) : '価格は未取得'));
    if (p.relation) c.appendChild(el('p', 'xp-rel', p.relation));
    if (p.value) c.appendChild(el('p', 'xp-value', '紹介する価値：' + p.value));
    var d = el('details', 'xp-more');
    d.appendChild(el('summary', null, 'くわしく'));
    var dl = el('dl', 'radar-facts');
    var rows = [['投稿企画', p.themeTitle ? p.themeTitle + (p.themeAngle ? '（' + p.themeAngle + '）' : '') : ''], ['似ている点', p.similar], ['違う点', p.differ], ['特徴', p.feature], ['価格帯', TIER[p.tier]], ['コーデ案', p.lookName ? p.lookName + (p.lookConcept ? '（' + p.lookConcept + '）' : '') : ''],
      ['レビュー', p.reviewCount ? '楽天のレビュー ' + p.reviewCount.toLocaleString('ja-JP') + '件（平均' + (p.reviewAverage || '-') + '）' + (p.byReviews ? '｜レビューの多い順で確認' : '') : '楽天のレビュー：なし・未確認'], ['ランキング', '未確認（この探索では楽天のランキングを確認していません）'],
      ['価格の詳細', priceLine(p) + (p.shop ? '｜' + p.shop : '')], ['探索元', LABEL[p.mode] ? '「' + cleanName(node.product.name).slice(0, 20) + '」から「' + LABEL[p.mode] + '」で（' + p.batchNo + '回目の探索）' : '']];
    rows.forEach(function (x) { if (x[1]) { dl.appendChild(el('dt', null, x[0])); dl.appendChild(el('dd', null, x[1])); } });
    d.appendChild(dl);
    if (p.url) d.appendChild(linkBtn('楽天で見る', p.url));
    c.appendChild(d);
    var acts = el('div', 'xp-mini-acts');
    acts.appendChild(btn(adoptedState(p) ? '採用済み' : 'いいじゃん！', 'btn btn-primary xp-sbtn', function () { adopt(p, node, p.mode); }));
    // 枝葉の商品からは広げない（広げるのは起点の商品だけ）。詳細の確認と、楽天の商品ページ
    acts.appendChild(btn('詳細確認', 'btn btn-secondary xp-sbtn', function () { d.open = !d.open; if (d.open) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }));
    c.appendChild(acts);
    return c;
  }

  // 探索結果（この商品で探した分の蓄積）。新しい探索は下に消さずに足していく
  function resultsBlock(node) {
    var box = el('div', 'xp-results');
    var pool = X.pool(node.id);
    var items = pool ? pool.items : [];
    var b = busy[node.id];
    var busyNote = b ? el('p', 'hint pitch-busy xp-loading', '「' + LABEL[b.mode] + '」で' + (b.kind === 'append' ? 'もう' + MORE_WANT + '件、今の結果の下に追加する商品' : '楽天の実在の商品') + 'を探しています…（30〜60秒。別のアプリを開いても続きます）') : null;
    if (!items.length) {
      if (busyNote) box.appendChild(busyNote);
      var last = pool && pool.batches.length ? pool.batches[pool.batches.length - 1] : null;
      if (last && last.error) box.appendChild(el('p', 'hint pitch-warn', '前回の探索に失敗しました：' + last.error));
      if (!b) box.appendChild(btn('テーマで広げる（おまかせ・9件前後）', 'btn btn-discover xp-go', function () { search(node, 'omakase', 'new'); }));
      box.appendChild(el('p', 'hint', 'テーマで広げるは、この商品の用途・利用シーン・関連ジャンルから、投稿企画（例：キャンプ初心者セット）を考えて、関連用品・別ジャンル・意外な商品を探します。同じ種類の比較候補は3件まで。似た商品と比べたいときは、下の「同じブランドの別商品」「同じ価格帯の他ブランド」を使ってください。'));
      return box;
    }
    var latest = pool.batches.filter(function (x) { return !x.error; }).slice(-1)[0] || {};
    box.appendChild(el('p', 'field-label', '探索結果 ' + items.length + '件（' + pool.batches.filter(function (x) { return !x.error; }).length + '回の探索を蓄積）'));
    if (latest.no > 1) box.appendChild(el('p', 'hint', '最新：「' + LABEL[latest.mode] + '」で ' + latest.added + '件を追加' + (latest.dup ? '（重複' + latest.dup + '件は除外）' : '') + '。「追加」の印が付いた商品です。'));
    var errs = pool.batches.filter(function (x) { return x.error; });
    if (errs.length && errs[errs.length - 1] === pool.batches[pool.batches.length - 1]) box.appendChild(el('p', 'hint pitch-warn', '直近の探索に失敗しました：' + errs[errs.length - 1].error + '（今の結果はそのままです）'));
    if (latest.notice) box.appendChild(el('p', 'hint pitch-warn', latest.notice));
    // 投稿企画の提案（テーマで広げたときにAIが考えた企画）。押すとその企画の商品だけを表示
    var themes = {};
    pool.batches.forEach(function (bt) { (bt.themes || []).forEach(function (t) { if (!themes[t.title]) themes[t.title] = { angle: t.angle, n: 0 }; }); });
    items.forEach(function (it) { if (it.themeTitle && themes[it.themeTitle]) themes[it.themeTitle].n++; });
    if (Object.keys(themes).length) {
      var tb = el('div', 'xp-themes');
      tb.appendChild(el('p', 'field-label', '投稿企画の提案'));
      Object.keys(themes).forEach(function (t) {
        var card = btn('', 'xp-theme' + (filterFor[node.id] === 'theme:' + t ? ' active' : ''), function () { filterFor[node.id] = filterFor[node.id] === 'theme:' + t ? '' : 'theme:' + t; paint(); });
        card.appendChild(el('span', 'xp-theme-title', t + '（' + themes[t].n + '件）'));
        if (themes[t].angle) card.appendChild(el('span', 'xp-theme-angle', themes[t].angle));
        tb.appendChild(card);
      });
      box.appendChild(tb);
    }
    // 探索カテゴリーで絞る
    var cats = {};
    items.forEach(function (it) { var a = it.axisLabel || LABEL[it.mode] || 'その他'; cats[a] = (cats[a] || 0) + 1; });
    var f = filterFor[node.id] || '';
    if (f && !cats[f] && f.indexOf('theme:') !== 0) f = '';
    var fr = el('div', 'xp-filter');
    fr.appendChild(btn('すべて（' + items.length + '）', 'xp-chip' + (!f ? ' active' : ''), function () { filterFor[node.id] = ''; paint(); }));
    Object.keys(cats).forEach(function (a) { fr.appendChild(btn(a + '（' + cats[a] + '）', 'xp-chip' + (f === a ? ' active' : ''), function () { filterFor[node.id] = a; paint(); })); });
    box.appendChild(fr);
    // 見つけた順に並べ、新しく足した分は一覧の下に続ける（前の並びと採用の状態はそのまま）
    var list = items.filter(function (it) { return !f || (f.indexOf('theme:') === 0 ? it.themeTitle === f.slice(6) : (it.axisLabel || LABEL[it.mode] || 'その他') === f); });
    var grid = el('div', 'xp-grid');
    list.forEach(function (it) { grid.appendChild(resultCard(it, node, latest.no)); });
    box.appendChild(grid);
    if (busyNote) box.appendChild(busyNote); // 追加の探索中も、今の一覧はそのまま。読み込みは一覧の下に出す
    // 追加の操作（今の結果は消さない）
    var more = el('div', 'xp-actions');
    more.appendChild(btn('さらに' + MORE_WANT + '件探す（テーマで・一覧の下に追加）', 'btn btn-discover xp-go', function () { search(node, 'omakase', 'append'); }));
    more.appendChild(btn('別の方向でも探す（下の探し方から）', 'btn btn-secondary', function () { var g = container.querySelector('.xp-modes'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
    box.appendChild(more);
    box.appendChild(btn('この商品の探索結果を最初からやり直す', 'link-btn xp-reset', function () {
      if (!window.confirm('この商品の探索結果（' + items.length + '件）を空にして、最初から探し直しますか？\n採用した商品と、ほかの商品の探索結果・枝分かれ先は消えません。')) return;
      X.reset(node.id);
      K.showToast('この商品の探索結果を空にしました（採用した商品は残っています）');
      paint();
    }));
    return box;
  }

  // この探索で採用した商品（起点の商品と、探索結果のうち「いいじゃん！」したもの）を、採用した順に
  function adoptedHere(node) {
    var pool = X.pool(node.id);
    var list = [node.product].concat(pool ? pool.items : []);
    var seen = {};
    return list.map(function (p) { var f = S.find(p); return f && f.status === 'adopt' ? { p: p, f: f } : null; })
      .filter(function (x) { if (!x) return false; var k = x.f.key; if (seen[k]) return false; seen[k] = true; return true; })
      .sort(function (a, b) { return (a.f.decidedAt || 0) - (b.f.decidedAt || 0); })
      .map(function (x) { return Object.assign({}, x.f, x.p, { key: x.f.key, decidedAt: x.f.decidedAt, checkedAt: (x.p.batch && (X.pool(node.id).batches.filter(function (b) { return b.id === x.p.batch; })[0] || {}).at) || x.f.fetchedAt || '' }); });
  }
  // これで投稿する！：採用した商品で投稿セットを作り、投稿セットの画面で表紙・スライド・キャプション・ROOM紹介文を仕上げる
  var posting = false;
  function postBar(node) {
    var list = adoptedHere(node);
    var bar = el('div', 'xp-postbar');
    var max = window.DeliveryView && window.DeliveryView.MAX_SET_ITEMS || 8;
    var b = btn(posting ? '投稿セットを作っています…' : 'これで投稿する！（採用 ' + list.length + '件）', 'btn btn-primary xp-post', function () {
      if (!list.length || posting || !window.DeliveryView) return;
      var themes = {};
      list.forEach(function (p) { if (p.themeTitle) themes[p.themeTitle] = (themes[p.themeTitle] || 0) + 1; });
      var top = Object.keys(themes).sort(function (a, c) { return themes[c] - themes[a]; })[0];
      var title = window.prompt('投稿のタイトル（表紙の見出し。あとで直せます）', top || ('「' + cleanName(node.product.name).slice(0, 12) + '」から見つけた' + Math.min(list.length, max) + '選'));
      if (title == null) return;
      posting = true;
      paint();
      if (list.length > max) K.showToast('Instagramの枚数の上限のため、採用した順に' + max + '件で作ります');
      window.DeliveryView.createFromItems({ title: title.trim(), items: list, reason: '「' + cleanName(node.product.name).slice(0, 20) + '」から広げて、社長が採用した商品' }).then(function (set) {
        posting = false;
        K.showToast('投稿セットを作りました。画像・キャプション・ROOM紹介文を確認してください');
        if (window.PitchView && window.PitchView.show) window.PitchView.show('sets');
        if (set && window.DeliveryView.openSet) window.DeliveryView.openSet(set.id);
        window.scrollTo(0, 0);
      }, function () { posting = false; K.showToast('投稿セットを作れませんでした'); paint(); });
    });
    if (!list.length) { b.disabled = true; b.textContent = 'これで投稿する！（採用 0件）'; }
    bar.appendChild(b);
    bar.appendChild(el('p', 'hint', list.length ? '採用した順：' + list.slice(0, max).map(function (p, i) { return (i + 1) + '. ' + cleanName(p.name).slice(0, 14); }).join('／') + (list.length > max ? '（' + max + '件まで使います）' : '') : '商品の「いいじゃん！」で採用すると、その商品で投稿を作れます。'));
    return bar;
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

    // 探索結果（蓄積）
    wrap.appendChild(resultsBlock(node));
    wrap.appendChild(postBar(node));

    // 個別の探し方（1つの方向を深掘り）。結果があるときは、今の結果に追加する
    var pool = X.pool(node.id);
    var has = pool && pool.items.length;
    wrap.appendChild(el('p', 'field-label', has ? '別の方向でもっと探す（今の結果に' + MORE_WANT + '件ずつ追加）' : 'この商品から、どう広げますか？'));
    var grid = el('div', 'xp-modes');
    var counts = {};
    (pool ? pool.items : []).forEach(function (it) { counts[it.mode] = (counts[it.mode] || 0) + 1; });
    MODES.forEach(function (m) {
      var label = has ? '＋' + m[1] : m[1];
      var b = btn(label + (counts[m[0]] ? '\n（' + counts[m[0]] + '件）' : ''), 'xp-mode' + (busy[node.id] && busy[node.id].mode === m[0] ? ' active' : ''), function () { search(node, m[0]); });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    if (X.lastWriteOk === false) wrap.appendChild(el('p', 'hint pitch-warn', 'このiPhoneの保存できる量の上限に近づいています。最後の探索結果を保存できなかった可能性があります。'));
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
      info.appendChild(el('p', 'hint', priceLine(n.product) + '｜この商品の探索結果 ' + ((X.pool(n.id) || { items: [] }).items.length) + '件・広げた先 ' + X.countUnder(n.id) + '件'));
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
