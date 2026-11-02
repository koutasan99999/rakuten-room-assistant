// 「商品ドロボー」の画面：社長が参考にしているInstagramアカウントをURLだけで登録し、
// AI社員の調査（data/reference-accounts.json）と、その視聴者に届く投稿の切り口を見せる。
// 任意で、紹介されていた商品を楽天で探して「社長、これどうすか？」につなぐ・手でコメントするときの一言を作る。
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

  // AI社員が調べた参考アカウントの記録（data/reference-accounts.json。Claude Code のAI社員が調べて更新する）
  var research = null;
  function loadResearch() {
    if (research) return;
    research = { accounts: {} };
    fetch('data/reference-accounts.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && d.accounts) { research = d; if (location.hash.indexOf('#thief') === 0) render(); }
    }, function () {});
  }
  // 自動調査の結果（この端末）を優先し、無ければAI社員が調べた記録（data/reference-accounts.json）を使う
  function researchOf(a) {
    if (a.research && (a.research.status === 'done' || a.research.status === 'insufficient')) return a.research;
    var r = a.handle && research && research.accounts ? research.accounts[a.handle] : null;
    return r ? Object.assign({ status: 'done' }, r) : null;
  }
  var STATUS = { pending: '調査待ち', running: '調査中', done: '調査済み', insufficient: '情報不足', error: 'エラー', off: '自動調査はオフ', budget: '今月の上限で停止' };
  function statusOf(a) {
    var r = researchOf(a);
    if (r) return r.status === 'insufficient' ? '情報不足' : '調査済み';
    return STATUS[(a.research && a.research.status) || 'pending'];
  }
  // 調査の結果と料金を記録する（検索ジョブが画面の外で終わったときも app.js から呼ばれる）
  function saveResearch(handle, httpStatus, d) {
    if (d.cost) T.addCost(handle, d.cost, d.status || 'error');
    if (httpStatus !== 200 || d.status === 'error') T.setResearch(handle, { status: 'error', error: d.error || '調査できませんでした' });
    else if (d.status === 'off' || d.status === 'budget') T.setResearch(handle, { status: d.status, notice: d.notice });
    else T.setResearch(handle, d);
  }
  // 登録したら、すぐに自動調査を始める（検索ジョブなので、画面を閉じても続く）
  function startResearch(a) {
    if (!a.handle) return;
    T.setResearch(a.handle, { status: 'running' });
    var mc = T.monthCost();
    K.jobCall('thief', { action: 'research', handle: a.handle, budget: { month: mc.month, spentYenCap: mc.yenCap } }, { label: '参考アカウントの調査：@' + a.handle, genre: '' }).then(function (r) {
      saveResearch(a.handle, r.status, r.data || {});
      render();
    });
  }

  // ---- アカウント一覧 ----
  function renderAccounts() {
    body.appendChild(el('p', 'editor-note', '参考にしているInstagramアカウントのURLを貼るだけで登録できます。AI社員がそのアカウントのテーマ・視聴者・使っている言葉を調べ、「その視聴者に眼科医くまの投稿が届く切り口」を考えて、投稿づくりに使います。Instagramの投稿はこのアプリからは読み込みません（ログインが必要なため）。'));
    var box = el('div', 'card thief-add');
    box.appendChild(el('p', 'field-label', '参考アカウントのURL（またはID）'));
    var inp = input('例：https://www.instagram.com/kose_wear/');
    var memo = input('メモ（任意）例：服の選び方が参考になる');
    var msg = el('p', 'hint', '');
    box.appendChild(inp); box.appendChild(memo);
    box.appendChild(btn('登録する', 'btn btn-primary', function () {
      var r = T.parseInput(inp.value);
      if (!r) { msg.textContent = 'URLかIDの形が読み取れませんでした（例：https://www.instagram.com/kose_wear/）'; return; }
      var added = T.addAccount(r.handle, memo.value.trim());
      K.showToast(r.handle ? '@' + r.handle + ' を登録しました' : '登録しました');
      // 有料の自動調査は停止中（2026-11-02 社長の指示）。登録したURLは保存だけする
      inp.value = ''; memo.value = '';
      render();
    }));
    box.appendChild(msg);
    body.appendChild(box);
    var list = T.accounts();
    if (!list.length) { body.appendChild(el('p', 'manage-empty', 'まだ登録したアカウントはありません。')); return; }
    var mc = T.monthCost();
    body.appendChild(el('p', 'hint', '今月の自動調査：' + mc.runs + '件・検索' + mc.searches + '回・約' + mc.yen + '円（上限管理用の高めの計算では' + mc.yenCap + '円／上限500円）。料金は応答の使用量からの計算で、実際の請求はOpenAIの管理画面の額です。'));
    var off = list.filter(function (a) { return a.handle && !researchOf(a) && a.research && (a.research.status === 'off' || a.research.status === 'budget'); });
    if (off.length) {
      var ask = el('div', 'card');
      ask.appendChild(el('p', 'hint', '自動調査が止まっているため（今月の上限、またはオフ）、' + off.length + ' 件が調査待ちです。上限で止まった分は、来月に自動では再開しません。「もう一度調べる」で再開できます。'));
      body.appendChild(ask);
    }
    list.forEach(function (a) {
      var r = researchOf(a);
      var card = el('article', 'card thief-account');
      card.appendChild(el('h3', 'cand-name', a.handle ? '@' + a.handle : 'IDなし（投稿URLから登録）'));
      card.appendChild(el('p', 'hint', [a.memo, statusOf(a) + (r && r.checkedAt ? '（' + r.checkedAt + '）' : ''), a.count ? '商品 ' + a.count + '件' : ''].filter(Boolean).join('｜')));
      card.addEventListener('click', function () { current = a.id; render(); });
      body.appendChild(card);
    });
  }

  function facts(dl, rows) { rows.forEach(function (x) { if (x[1] && (!Array.isArray(x[1]) || x[1].length)) { dl.appendChild(el('dt', null, x[0])); dl.appendChild(el('dd', null, Array.isArray(x[1]) ? x[1].join('／') : x[1])); } }); }

  // ---- 参考アカウントの詳細 ----
  function renderAccount(a) {
    var head = el('div', 'pitch-row');
    head.appendChild(btn('← 参考アカウント一覧', 'status-btn', function () { current = ''; extracted = null; render(); }));
    if (a.url) head.appendChild(linkBtn('Instagramで開く', a.url));
    body.appendChild(head);
    body.appendChild(el('h3', 'curation-title', a.handle ? '@' + a.handle : 'IDなし（投稿URLから登録）'));
    if (a.memo) body.appendChild(el('p', 'hint', a.memo));

    // 1. AI社員の調査
    var r = researchOf(a);
    var rc = el('div', 'card');
    rc.appendChild(el('p', 'field-label', 'AI社員の調査'));
    rc.appendChild(el('p', 'hint', '状態：' + statusOf(a) + (a.research && a.research.error ? '（' + a.research.error + '）' : '')));
    if (!r) {
      if (a.research && (a.research.status === 'off' || a.research.status === 'budget')) rc.appendChild(el('p', 'hint', a.research.notice || '自動調査は止まっています。'));
      if (a.handle && (!a.research || a.research.status !== 'running')) rc.appendChild(btn('もう一度調べる', 'status-btn', function () { startResearch(a); render(); }));
    } else {
      var dl = el('dl', 'radar-facts');
      facts(dl, [['調べた日', r.checkedAt], ['どんなアカウントか', r.summary], ['よく扱うテーマ', r.themes], ['使っている言葉・タグ', r.keywords], ['見ていそうな人（推測）', r.audience], ['眼科医くまが学べる点', r.learn], ['確認できなかったこと', r.unknown]]);
      rc.appendChild(dl);
      if ((r.sources || []).length) { var src = el('div', 'buyer-links'); r.sources.forEach(function (u) { src.appendChild(linkBtn(u.replace(/^https:\/\/(www\.)?/, '').slice(0, 40), u)); }); rc.appendChild(src); }
      if (a.handle) rc.appendChild(btn('調べ直す', 'link-btn', function () { startResearch(a); render(); }));
    }
    body.appendChild(rc);

    // 2. その視聴者に届く投稿の切り口（まねではなく、同じ人が興味を持つ別の角度）
    if (r && (r.angles || []).length) {
      var ac = el('div', 'card');
      ac.appendChild(el('p', 'field-label', 'この視聴者に届ける、眼科医くまの投稿の切り口'));
      ac.appendChild(el('p', 'hint', 'Instagramのおすすめは、似た投稿に反応した人に届きやすいとされます。同じ人が興味を持つテーマで、まねではない投稿を作ります（AI社員が投稿づくりに使います）。'));
      var ul = el('ul', 'angle-list');
      r.angles.forEach(function (x) { ul.appendChild(el('li', null, x)); });
      ac.appendChild(ul);
      body.appendChild(ac);
    }

    // 3. コメントするとき（任意・手で）：投稿の文章を貼ると、自然なコメント案を2つ作る
    var cm = el('details', 'card');
    cm.appendChild(el('summary', null, 'コメントするなら（任意・手で）'));
    cm.appendChild(el('p', 'hint', 'AIが代わりにコメントすることはできません（公式の仕組みがなく、自動操作は規約で禁止されているため）。コメントしたい投稿があれば、その投稿の文章を貼ると、宣伝にならない自然な一言を2つ作ります。'));
    var ta = el('textarea', 'input');
    ta.rows = 3; ta.placeholder = 'コメントしたい投稿の文章（キャプション）を貼る';
    cm.appendChild(ta);
    var out = el('div');
    cm.appendChild(btn('コメント案を作る', 'status-btn', function () {
      if (ta.value.trim().length < 5) { K.showToast('投稿の文章を貼ってください'); return; }
      out.textContent = '作っています…';
      K.postJson('api/thief', { action: 'comment', caption: ta.value.trim(), handle: a.handle }).then(function (res) {
        out.innerHTML = '';
        if (res.status !== 200) { out.textContent = (res.data && res.data.error) || '作れませんでした'; return; }
        (res.data.comments || []).forEach(function (c) {
          var row = el('div', 'pitch-row');
          row.appendChild(el('span', 'thief-cand-name', c));
          row.appendChild(btn('コピー', 'status-btn', function () { K.copyText(c).then(function () { K.showToast('コピーしました'); }, function () {}); }));
          out.appendChild(row);
        });
      });
    }));
    cm.appendChild(out);
    body.appendChild(cm);

    // 4. 紹介されていた商品の登録（任意）
    var pd = el('details', 'card');
    var ps = T.products(a.id);
    pd.open = ps.length > 0 || !!extracted;
    pd.appendChild(el('summary', null, '紹介されていた商品を楽天で探す（任意）' + (ps.length ? '：' + ps.length + '件' : '')));
    var box = el('div', 'thief-add');
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
    box.appendChild(el('p', 'hint', '画像に文字で書かれている商品名だけを読み取ります。画像は保存しません。'));
    box.appendChild(msg);
    if (busy.extract) box.appendChild(el('p', 'hint pitch-busy', 'スクリーンショットを読み取っています…'));
    pd.appendChild(box);
    if (extracted) pd.appendChild(extractedBox(a));
    ps.forEach(function (p) { pd.appendChild(productCard(p, a)); });
    body.appendChild(pd);
    body.appendChild(btn('このアカウントを削除', 'link-btn', function () { if (window.confirm('このアカウントと登録した商品を削除しますか？（社長、これどうすか？に送った商品は残ります）')) { T.removeAccount(a.id); current = ''; render(); } }));
  }
  var pendingPost = '';

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
    loadResearch();
    body.innerHTML = '';
    var a = current && T.account(current);
    if (a) renderAccount(a); else renderAccounts();
  }

  // 「社長、これどうすか？」の商品探しに渡す、参考アカウントのまとめ（調査済みのものだけ）
  function insights() {
    loadResearch();
    return T.accounts().map(function (a) { var r = researchOf(a); return r && r.status === 'done' ? { handle: a.handle, memo: a.memo || '', themes: r.themes || [], angles: r.angles || [], learn: r.learn || [] } : null; }).filter(Boolean).slice(0, 8);
  }

  window.ThiefView = { render: render, insights: insights, saveResearch: saveResearch };
  if (location.hash.indexOf('#thief') === 0) render();
})();
