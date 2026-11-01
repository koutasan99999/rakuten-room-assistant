// 「商品ドロボー」の画面：Instagramで見つけた商品紹介アカウントを登録し、紹介されていた商品を楽天で探して、
// 「社長、これどうすか？」（採用・保留・違うな・ROOM紹介文）につなぐ。
// Instagramの投稿は取りに行かない。商品は社長の入力か、社長のスクリーンショットに文字で書かれているものだけ（AIの推測で商品を足さない）。
(function () {
  'use strict';

  var K = window.AppKit;
  var T = window.ThiefStore;
  var P = window.PitchStore;
  var body = document.getElementById('thief-body');
  if (!K || !T || !P || !body) return;
  var el = K.el;
  var current = ''; // 開いているアカウント
  var busy = {};
  var extracted = null; // スクリーンショットから読み取った候補（保存前）
  var LABEL = { same: '同一商品（型番一致）', similar: '類似商品', unknown: '未確認' };

  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function linkBtn(text, url) { var a = el('a', 'link-btn', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function input(ph, val) { var i = el('input', 'input'); i.type = 'text'; i.placeholder = ph; i.value = val || ''; return i; }
  function cleanName(n) { return String(n || '').replace(/[【\[].*?[】\]]/g, '').trim().slice(0, 70) || n; }

  // ---- アカウント一覧 ----
  function renderAccounts() {
    body.appendChild(el('p', 'editor-note', 'Instagramで見つけた商品紹介アカウントを登録して、紹介されていた商品を楽天で探します。Instagramの投稿はこのアプリからは読み込みません（ログインが必要で、自動で集めることは規約で禁止されているため）。商品は、名前を入力するか、自分で撮ったスクリーンショットに書かれている商品名を読み取って登録します。スクリーンショットは読み取りに使うだけで、保存しません。'));
    var box = el('div', 'card thief-add');
    box.appendChild(el('p', 'field-label', 'InstagramのID または 投稿URL'));
    var inp = input('例：@ken_good_item または https://www.instagram.com/p/…');
    var memo = input('メモ（任意）例：ガジェット紹介');
    var msg = el('p', 'hint', '');
    box.appendChild(inp); box.appendChild(memo);
    box.appendChild(btn('登録する', 'btn btn-primary', function () {
      var r = T.parseInput(inp.value);
      if (!r) { msg.textContent = 'IDか投稿URLの形が読み取れませんでした（例：@ken_good_item）'; return; }
      var a = T.addAccount(r.handle, memo.value.trim());
      current = a.id;
      if (r.postUrl) pendingPost = r.postUrl;
      render();
    }));
    box.appendChild(msg);
    body.appendChild(box);
    var list = T.accounts();
    if (!list.length) { body.appendChild(el('p', 'manage-empty', 'まだ登録したアカウントはありません。')); return; }
    list.forEach(function (a) {
      var card = el('article', 'card thief-account');
      card.appendChild(el('h3', 'cand-name', a.handle ? '@' + a.handle : 'IDなし（投稿URLから登録）'));
      card.appendChild(el('p', 'hint', (a.memo ? a.memo + '｜' : '') + '登録した商品 ' + a.count + '件'));
      card.addEventListener('click', function () { current = a.id; render(); });
      body.appendChild(card);
    });
  }
  var pendingPost = '';

  // ---- アカウントの商品一覧 ----
  function renderAccount(a) {
    var head = el('div', 'pitch-row');
    head.appendChild(btn('← アカウント一覧', 'status-btn', function () { current = ''; extracted = null; render(); }));
    if (a.url) head.appendChild(linkBtn('Instagramで開く', a.url));
    body.appendChild(head);
    body.appendChild(el('h3', 'curation-title', a.handle ? '@' + a.handle : 'IDなし（投稿URLから登録）'));
    if (a.memo) body.appendChild(el('p', 'hint', a.memo));

    // 商品の登録：入力とスクリーンショット
    var box = el('div', 'card thief-add');
    box.appendChild(el('p', 'field-label', '紹介されていた商品を登録'));
    var post = input('投稿URL（任意）https://www.instagram.com/p/…', pendingPost);
    pendingPost = '';
    var name = input('商品名（必須）');
    var brand = input('ブランド（分かれば）');
    var model = input('型番（分かれば）');
    [post, name, brand, model].forEach(function (x) { box.appendChild(x); });
    var msg = el('p', 'hint', '');
    box.appendChild(btn('この商品を登録する', 'btn btn-primary', function () {
      var pu = post.value.trim() ? T.parseInput(post.value) : { postUrl: '' };
      if (post.value.trim() && (!pu || !pu.postUrl)) { msg.textContent = '投稿URLの形が読み取れませんでした（https://www.instagram.com/p/… の形）'; return; }
      if (name.value.trim().length < 2) { msg.textContent = '商品名を入れてください'; return; }
      var p = T.addProduct(a.id, { postUrl: pu.postUrl, name: name.value.trim(), brand: brand.value.trim(), model: model.value.trim(), source: 'manual' });
      search(p);
      render();
    }));
    box.appendChild(el('p', 'field-label', 'またはスクリーンショットから読み取る'));
    var file = el('input');
    file.type = 'file'; file.accept = 'image/*';
    file.addEventListener('change', function () { if (file.files[0]) readShot(file.files[0], post.value.trim(), a); });
    box.appendChild(file);
    box.appendChild(el('p', 'hint', '投稿の画面のスクリーンショットを選ぶと、画像に文字で書かれている商品名だけを読み取ります（写っているだけの商品は読み取りません）。画像は保存しません。'));
    box.appendChild(msg);
    if (busy.extract) box.appendChild(el('p', 'hint pitch-busy', 'スクリーンショットを読み取っています…'));
    body.appendChild(box);
    if (extracted) body.appendChild(extractedBox(a));

    var ps = T.products(a.id);
    if (!ps.length) { body.appendChild(el('p', 'manage-empty', 'まだ商品は登録されていません。')); return; }
    ps.forEach(function (p) { body.appendChild(productCard(p, a)); });
    body.appendChild(btn('このアカウントを削除', 'link-btn', function () { if (window.confirm('このアカウントと登録した商品を削除しますか？（社長、これどうすか？に送った商品は残ります）')) { T.removeAccount(a.id); current = ''; render(); } }));
  }

  // スクリーンショットを縮小して送る（画像は送ったあと捨てる）
  function readShot(f, postUrl, a) {
    busy.extract = true; render();
    var img = new Image();
    var url = URL.createObjectURL(f);
    img.onload = function () {
      var c = document.createElement('canvas');
      var scale = Math.min(1, 1100 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      var q = 0.75, data = c.toDataURL('image/jpeg', q);
      while (data.length > 180000 && q > 0.3) { q -= 0.15; data = c.toDataURL('image/jpeg', q); }
      K.postJson('api/thief', { action: 'extract', image: data }).then(function (r) {
        busy.extract = false;
        if (r.status !== 200) { K.showToast((r.data && r.data.error) || '読み取れませんでした'); render(); return; }
        extracted = { products: r.data.products || [], handle: r.data.handle || '', postUrl: postUrl, notice: r.data.notice || '' };
        render();
      });
    };
    img.onerror = function () { busy.extract = false; K.showToast('画像を開けませんでした'); render(); };
    img.src = url;
  }

  function extractedBox(a) {
    var box = el('div', 'card thief-extract');
    box.appendChild(el('p', 'field-label', 'スクリーンショットから読み取った商品（未確認。登録する商品を選んでください）'));
    if (extracted.handle && a.handle && extracted.handle !== a.handle) box.appendChild(el('p', 'hint pitch-warn', '画像のID（@' + extracted.handle + '）が、このアカウントと違います'));
    if (extracted.notice) box.appendChild(el('p', 'hint', extracted.notice));
    var checks = extracted.products.map(function (p) {
      var row = el('label', 'thief-check');
      var cb = el('input'); cb.type = 'checkbox'; cb.checked = true;
      row.appendChild(cb);
      row.appendChild(el('span', null, p.name + (p.brand ? '／' + p.brand : '') + (p.model ? '／' + p.model : '') + (p.evidence ? '（' + p.evidence + '）' : '')));
      box.appendChild(row);
      return cb;
    });
    var row = el('div', 'pitch-row');
    if (extracted.products.length) row.appendChild(btn('選んだ商品を登録する', 'btn btn-primary', function () {
      extracted.products.forEach(function (p, i) {
        if (!checks[i].checked) return;
        search(T.addProduct(a.id, { postUrl: extracted.postUrl, name: p.name, brand: p.brand, model: p.model, aliases: p.aliases, evidence: p.evidence, source: 'screenshot' }));
      });
      extracted = null; render();
    }));
    row.appendChild(btn('やめる', 'status-btn', function () { extracted = null; render(); }));
    box.appendChild(row);
    return box;
  }

  // 楽天で段階的に探して、同一・類似・未確認に分ける
  function search(p) {
    busy[p.id] = true; render();
    K.jobCall('thief', { action: 'search', pid: p.id, target: { name: p.name, brand: p.brand, model: p.model, aliases: p.aliases } }, { label: '商品ドロボー：' + p.name.slice(0, 20), genre: '' }).then(function (r) {
      busy[p.id] = false;
      if (r.status !== 200) { T.update(p.id, { searchError: (r.data && r.data.error) || '探せませんでした' }); render(); return; }
      T.update(p.id, { candidates: r.data.items || [], tried: r.data.tried || [], searchedAt: Date.now(), searchError: '' });
      render();
    });
  }

  // 楽天の候補を「社長、これどうすか？」に送る。status があれば、そのまま判断も記録する
  function sendToPitch(p, c, status, a) {
    busy[p.id + c.code] = true; render();
    K.postJson('api/thief', { action: 'pitch', candidate: c, source: { handle: a.handle } }).then(function (r) {
      busy[p.id + c.code] = false;
      var item = r.status === 200 && r.data.item ? r.data.item : { key: c.code, code: c.code, name: c.name, price: c.price, postage: c.postage || '', url: c.url, image: c.image, shop: c.shop, caption: c.caption || '', pitch: '', fit: '', caution: '楽天の商品ページで、投稿の商品と同じかを確認してください', angle: '商品ドロボー：@' + (a.handle || '不明'), origin: 'thief' };
      item.sourcePost = p.postUrl || '';
      item.sourceHandle = a.handle || '';
      item.matchNote = c.note || '';
      var key = window.PitchView.addExternal(item, status);
      T.update(p.id, { pitchKey: key || '' });
      K.showToast(!key ? 'この商品は「社長、これどうすか？」に、すでに入っています' : status ? '「' + P.STATUS[status] + '」を記録しました' + (status === 'adopt' ? '。ROOM紹介文を作ります' : '') : '「社長、これどうすか？」のプレゼンに入れました');
      render();
    });
  }

  function productCard(p, a) {
    var card = el('article', 'card thief-product');
    var best = (p.candidates || [])[0];
    var top = el('div', 'cand-top');
    // 写真は楽天の候補の商品画像だけ（Instagramの画像は使わない）
    if (best && best.image) { var img = el('img', 'cand-thumb'); img.src = best.image; img.alt = ''; img.loading = 'lazy'; top.appendChild(img); }
    else top.appendChild(el('div', 'cand-thumb pitch-noimg', '写真なし'));
    var info = el('div', 'cand-info');
    var chips = el('div', 'chips');
    chips.appendChild(el('span', 'tag', p.source === 'screenshot' ? 'スクショから読み取り' : '入力'));
    var pitched = p.pitchKey && P.get(p.pitchKey);
    if (pitched) chips.appendChild(el('span', 'idea-edited', '社長、これどうすか？：' + P.STATUS[pitched.status]));
    info.appendChild(chips);
    info.appendChild(el('h3', 'cand-name', p.name));
    var meta = el('p', 'cand-meta');
    if (p.brand) meta.appendChild(el('span', 'cand-shop', p.brand));
    if (p.model) meta.appendChild(el('span', 'cand-shop', '型番 ' + p.model));
    info.appendChild(meta);
    if (p.postUrl) info.appendChild(linkBtn('参照元の投稿', p.postUrl));
    else info.appendChild(el('p', 'hint', '参照元の投稿URL：未登録'));
    if (p.evidence) info.appendChild(el('p', 'hint', '読み取り：' + p.evidence));
    top.appendChild(info);
    card.appendChild(top);

    if (busy[p.id]) card.appendChild(el('p', 'hint pitch-busy', '楽天で探しています…（型番→ブランド→言葉を減らして、の順に試します）'));
    else if (p.searchError) card.appendChild(el('p', 'hint pitch-warn', p.searchError));
    if (p.candidates) {
      if ((p.tried || []).length) card.appendChild(el('p', 'hint', '試した検索：' + p.tried.map(function (t) { return t.keyword + '（' + t.count + '件）'; }).join('／')));
      if (!p.candidates.length) card.appendChild(el('p', 'manage-empty', '楽天では見つかりませんでした。商品名・ブランド・型番を直して探し直してください。'));
      var d = el('details', 'buyer-plan');
      d.open = !pitched;
      d.appendChild(el('summary', null, '楽天の候補 ' + p.candidates.length + '件（同一 ' + p.candidates.filter(function (c) { return c.match === 'same'; }).length + '件）'));
      var more = null;
      p.candidates.forEach(function (c, ci) {
        // 上位4件を見せて、残りは畳む（iPhoneで長くなりすぎないように）
        if (ci === 4) { more = el('details'); more.appendChild(el('summary', null, 'ほかの候補 ' + (p.candidates.length - 4) + '件')); d.appendChild(more); }
        var row = el('div', 'thief-cand');
        var t = el('div', 'cand-top');
        if (c.image) { var im = el('img', 'cand-thumb'); im.src = c.image; im.alt = ''; im.loading = 'lazy'; t.appendChild(im); }
        var i2 = el('div', 'cand-info');
        i2.appendChild(el('span', 'thief-match ' + c.match, LABEL[c.match] || c.match));
        i2.appendChild(el('p', 'thief-cand-name', cleanName(c.name)));
        i2.appendChild(el('p', 'cand-meta', K.formatPrice(c.price) + (c.postage ? '（' + c.postage + '）' : '') + '｜' + c.shop));
        i2.appendChild(el('p', 'hint', c.note));
        t.appendChild(i2);
        row.appendChild(t);
        var acts = el('div', 'pitch-row');
        acts.appendChild(linkBtn('楽天で見る', c.url));
        if (busy[p.id + c.code]) acts.appendChild(el('span', 'hint', '送っています…'));
        else {
          acts.appendChild(btn('いいじゃん！', 'btn btn-primary', function () { sendToPitch(p, c, 'adopt', a); }));
          acts.appendChild(btn('保留', 'status-btn', function () { sendToPitch(p, c, 'hold', a); }));
          acts.appendChild(btn('却下', 'status-btn', function () { sendToPitch(p, c, 'reject', a); }));
          acts.appendChild(btn('プレゼンに入れる', 'status-btn', function () { sendToPitch(p, c, '', a); }));
        }
        row.appendChild(acts);
        (more || d).appendChild(row);
      });
      card.appendChild(d);
    }
    var row = el('div', 'pitch-row');
    row.appendChild(btn(p.candidates ? '楽天で探し直す' : '楽天で探す', 'status-btn', function () { search(p); }));
    row.appendChild(btn('削除', 'link-btn', function () { T.removeProduct(p.id); render(); }));
    card.appendChild(row);
    return card;
  }

  function render() {
    body.innerHTML = '';
    var a = current && T.account(current);
    if (a) renderAccount(a); else renderAccounts();
  }

  window.ThiefView = { render: render };
  if (location.hash.indexOf('#thief') === 0) render();
})();
