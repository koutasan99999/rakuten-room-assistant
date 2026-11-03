// 「社長、これどうすか？」の納品画面：AI社員が自分で企画し、商品（3〜6点）・Instagram用の画像・キャプション・購入先までそろえた
// 投稿セットを並べる。社長は「採用」「差し替え・修正」「却下」を選ぶだけ。確認待ちが3件より少なければ、AI社員が自動で次を作る。
// 画像は既存の仕組み（api/instagram で表紙・商品カードの文字とキャプション、IgRender で描画）で、開いたときに描き直す。
(function () {
  'use strict';

  var K = window.AppKit;
  var D = window.DeliveryStore;
  if (!K || !D) return;
  var el = K.el;
  var STOCK = 3;
  var COVER_BY_PATTERN = { new_arrival: 'trend_pick', first_pick: 'must_buy', hero_alt: 'premium_vs_alternative', brand: 'brand_pick', gift: 'gift_select', discovery: 'unique_pick', budget_use: 'budget_compare' };
  var busy = '';
  var fails = 0;
  var lastError = '';
  var openId = '';
  var slideCache = {}; // set.id + 版 → { urls, files }
  var container = null;

  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function linkBtn(text, url) { var a = el('a', 'link-btn', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function cleanName(n) { return String(n || '').replace(/[【\[].*?[】\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || n; }
  function allRoom(set) { return (set.items || []).every(function (it) { return it.room === 'registered'; }); }
  function styleOf(set) { return set.coverStyle || COVER_BY_PATTERN[set.pattern] || 'unique_pick'; }
  function stamp(iso) { try { return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  // 楽天ROOMに全部登録するまでは「紹介したものは楽天ROOMにまとめています」と書かない（事実と違うため）
  function captionOf(set) {
    var c = set.captionEdit || (set.copy && set.copy.caption) || '';
    if (!allRoom(set)) c = c.replace(/紹介したものは楽天ROOM(の「[^」]*」)?にまとめています。/, '眼科医くまの楽天ROOMは、');
    return c;
  }
  function ctaOf(set) { return allRoom(set) ? window.IgRender.CTA_MESSAGES[0] : '眼科医くまの\n楽天ROOMは\nプロフィールのリンクから'; }

  // 品質確認（画面側）：サーバーの確認に、文章とROOMの確認を足す
  function issuesOf(set) {
    var list = (set.issues || []).slice();
    if (!set.copy) list.push('表紙・キャプションの文章をまだ作れていない');
    var cap = captionOf(set);
    if (set.copy && !/アフィリエイト|PR/.test(cap)) list.push('キャプションに広告・アフィリエイトの表示がない');
    return list;
  }

  // 表紙・商品カードの文字とキャプション（既存の api/instagram）
  function finishCopy(set) {
    return K.postJson('api/instagram', {
      theme: set.title, category: set.patternLabel || '', needCaption: true, collection: set.title,
      coverStyle: styleOf(set), postType: set.patternLabel || '', genre: '',
      items: set.items.map(function (it) { return { name: it.name, price: it.price, role: it.role, reason: [it.feature, it.why].filter(Boolean).join('。') }; })
    }).then(function (r) {
      if (r.status === 200) { set.copy = r.data; set.copyAt = new Date().toISOString(); }
      else { set.copy = null; set.copyError = (r.data && r.data.error) || '文章を作れませんでした'; }
      return set;
    });
  }

  // 投稿セットを1件作る（時間がかかるので検索ジョブで。別のアプリを開いても続く）
  function produce(note, replaceOf) {
    if (busy) return Promise.resolve();
    busy = note ? '指示された方向で作り直しています' : '投稿セットを作っています';
    lastError = '';
    paint();
    var payload = { action: 'set', history: D.history(), recentPatterns: D.recentPatterns(), exclude: D.exclude(), note: note || '' };
    return K.jobCall('pitch', payload, { label: '投稿セットの制作', genre: '' }).then(function (r) {
      if (r.status !== 200 || !r.data.set) throw new Error((r.data && r.data.error) || '投稿セットを作れませんでした');
      return finishCopy(r.data.set);
    }).then(function (set) {
      if (replaceOf) set.replaces = replaceOf;
      D.save(set);
      fails = 0;
    }).catch(function (e) {
      fails++;
      lastError = e.message;
    }).then(function () {
      busy = '';
      paint();
      ensureStock();
    });
  }

  // 確認待ちが3件より少なければ、次を作る（失敗が2回続いたら止めて、理由を出す）
  // 自動制作には既存のOpenAIの利用料がかかるので、最初の1回だけ社長の了承を取る（了承の記録はこの端末に残す）
  var OK_KEY = 'room-delivery-ok';
  function approved() { try { return localStorage.getItem(OK_KEY) === '1'; } catch (e) { return false; } }
  function ensureStock() {
    if (busy || fails >= 2 || !approved() || location.hash.indexOf('#pitch') !== 0) return;
    if (D.pendingCount() < STOCK) produce();
  }

  // スライド（Instagram用の完成画像）を描く
  function slidesOf(set) {
    var key = set.id + ':' + (set.copyAt || '') + ':' + styleOf(set) + ':' + (set.titleEdit || '') + ':' + allRoom(set);
    if (slideCache[key]) return Promise.resolve(slideCache[key]);
    var images = Promise.all(set.items.map(function (it) { return K.loadProductImage(it.image); }));
    var bear = window.IgRender.loadImage(K.bearSrc).catch(function () { return null; });
    return Promise.all([images, bear]).then(function (r) {
      var copy = set.copy || {};
      var ci = copy.items || [];
      var style = styleOf(set);
      var cv = copy.cover || {};
      var post = {
        topic: copy.topic || set.title, category: set.patternLabel || '', subtitle: set.target || '',
        // 表紙の大見出しは、企画のタイトル（直したものがあればそれ）にそろえる（表紙と中身がずれないように）
        cover: style === 'serious_think' ? null : (function () { var t = set.titleEdit || set.title; return { style: style, title: t, accent: cv.accent && t.indexOf(cv.accent) !== -1 ? cv.accent : '', sub: set.target || cv.sub || '', badge: cv.badge || '', price: cv.price || '' }; })(),
        bear: r[1], ctaMessage: ctaOf(set),
        items: set.items.map(function (it, i) { var c = ci[i] || {}; return { image: r[0][i], shortName: c.shortName || cleanName(it.name), subline: c.subline, memo: c.memo || it.feature, price: it.price, role: it.role, brand: it.brand }; })
      };
      var slides = window.IgRender.renderPost(post);
      return Promise.all(slides.map(function (s) { return K.canvasToBlob(s.canvas); })).then(function (blobs) {
        var folder = (set.createdAt || '').slice(0, 10) + '_' + set.id;
        var files = slides.map(function (s, i) { return { name: s.fileName, blob: blobs[i] }; });
        var out = { folder: folder, files: files, urls: blobs.map(function (b) { return URL.createObjectURL(b); }), missing: r[0].filter(function (x) { return !x; }).length };
        slideCache[key] = out;
        return out;
      });
    });
  }

  function replaceItem(set, i) {
    if (busy) return;
    busy = '「' + cleanName(set.items[i].name).slice(0, 16) + '」を差し替えています';
    paint();
    var slim = { title: set.title, pattern: set.pattern, target: set.target, appeal: set.appeal, slots: set.slots, items: set.items, exclude: set.replaced || [] };
    K.jobCall('pitch', { action: 'replace', set: slim, index: i }, { label: '投稿セットの差し替え', genre: '' }).then(function (r) {
      if (r.status !== 200 || !r.data.set) throw new Error((r.data && r.data.error) || '差し替えできませんでした');
      var next = Object.assign({}, set, { items: r.data.set.items, issues: r.data.set.issues, replaced: (set.replaced || []).concat(set.items[i].code || []) });
      return finishCopy(next).then(function (n) {
        D.save(n);
        D.decide(set.id, null, '商品の差し替え：' + cleanName(set.items[i].name).slice(0, 30), 'revise');
      });
    }).catch(function (e) { K.showToast(e.message); }).then(function () { busy = ''; paint(); });
  }

  // ---- 一覧 ----
  function card(set) {
    var c = el('article', 'card delivery-card');
    var chips = el('div', 'chips');
    chips.appendChild(el('span', set.status === 'adopted' ? 'idea-edited' : 'role', D.STATUS[set.status] || set.status));
    chips.appendChild(el('span', 'tag', set.patternLabel ? set.patternLabel.split('（')[0] : ''));
    var iss = issuesOf(set);
    if (iss.length) chips.appendChild(el('span', 'tag pitch-warn', '要確認 ' + iss.length));
    c.appendChild(chips);
    c.appendChild(el('h3', 'cand-name', set.titleEdit || set.title));
    c.appendChild(el('p', 'hint', set.target || ''));
    var strip = el('div', 'delivery-strip');
    set.items.forEach(function (it) { var im = el('img', 'delivery-thumb'); im.src = it.image; im.alt = ''; im.loading = 'lazy'; strip.appendChild(im); });
    c.appendChild(strip);
    c.appendChild(el('p', 'hint', set.items.length + '商品｜' + stamp(set.createdAt) + ' 作成'));
    c.addEventListener('click', function () { openId = set.id; paint(); window.scrollTo(0, 0); });
    return c;
  }

  // ---- 詳細 ----
  function detail(set) {
    var wrap = el('div');
    wrap.appendChild(btn('← 投稿セット一覧', 'status-btn', function () { openId = ''; paint(); }));

    // A. 企画
    var a = el('div', 'card');
    a.appendChild(el('p', 'field-label', (set.patternLabel || '') + '｜' + (D.STATUS[set.status] || '')));
    a.appendChild(el('h3', 'cand-name', set.titleEdit || set.title));
    var dl = el('dl', 'radar-facts');
    [['誰向け', set.target], ['この企画を選んだ理由', set.reason], ['伝えたい魅力', set.appeal]].forEach(function (x) { if (x[1]) { dl.appendChild(el('dt', null, x[0])); dl.appendChild(el('dd', null, x[1])); } });
    a.appendChild(dl);
    var iss = issuesOf(set);
    a.appendChild(el('p', iss.length ? 'hint pitch-warn' : 'hint', iss.length ? '品質確認：' + iss.join('／') : '品質確認：問題なし（商品の実在・価格・楽天のURL・画像・表現を確認済み）'));
    wrap.appendChild(a);

    // B. 掲載商品一覧（画像付き）
    var b = el('div', 'card');
    b.appendChild(el('p', 'field-label', '掲載する商品（' + set.items.length + '点）'));
    set.items.forEach(function (it, i) {
      var row = el('div', 'delivery-item');
      var top = el('div', 'cand-top');
      var im = el('img', 'cand-thumb'); im.src = it.image; im.alt = ''; im.loading = 'lazy'; top.appendChild(im);
      var info = el('div', 'cand-info');
      info.appendChild(el('span', 'role', (i + 1) + '. ' + it.role));
      info.appendChild(el('p', 'thief-cand-name', cleanName(it.name)));
      info.appendChild(el('p', 'cand-meta', K.formatPrice(it.price) + '（税込' + (it.postage ? '・' + it.postage : '') + '｜' + stamp(it.priceCheckedAt) + ' 確認）' + (it.brand ? '｜' + it.brand : '')));
      if (it.feature) info.appendChild(el('p', 'hint', '特徴：' + it.feature));
      if (it.why) info.appendChild(el('p', 'hint', '入れた理由：' + it.why));
      info.appendChild(el('p', 'hint', '公式：' + (it.officialUrl ? it.officialNote : it.officialNote || '未取得') + '｜楽天ROOM：' + (it.room === 'registered' ? '登録済み' : '未登録') + '｜確認：楽天の商品データ（商品名・価格・画像）'));
      top.appendChild(info);
      row.appendChild(top);
      var acts = el('div', 'pitch-row');
      acts.appendChild(linkBtn('楽天の商品ページ', it.url));
      if (it.code) acts.appendChild(linkBtn('ROOMで投稿画面を開く', K.roomUrl(it.code)));
      acts.appendChild(btn(it.room === 'registered' ? 'ROOM登録を取り消す' : 'ROOMに登録した', 'status-btn', function () { it.room = it.room === 'registered' ? 'unregistered' : 'registered'; D.save(set); paint(); }));
      acts.appendChild(btn('この商品を差し替える', 'status-btn', function () { replaceItem(set, i); }));
      row.appendChild(acts);
      b.appendChild(row);
    });
    wrap.appendChild(b);

    // C. Instagram用の完成画像
    var c = el('div', 'card');
    c.appendChild(el('p', 'field-label', 'Instagram用の画像（投稿順）'));
    var prev = el('div', 'delivery-slides');
    prev.appendChild(el('p', 'hint', '画像を描いています…'));
    c.appendChild(prev);
    var dlRow = el('div', 'pitch-row');
    c.appendChild(dlRow);
    wrap.appendChild(c);
    slidesOf(set).then(function (out) {
      prev.innerHTML = '';
      out.urls.forEach(function (u, i) { var f = el('figure'); var im = el('img'); im.src = u; im.alt = out.files[i].name; f.appendChild(im); f.appendChild(el('figcaption', null, (i + 1) + '. ' + out.files[i].name)); prev.appendChild(f); });
      if (out.missing) prev.appendChild(el('p', 'hint pitch-warn', out.missing + '件の商品画像を読み込めませんでした。'));
      dlRow.appendChild(btn('画像をまとめて保存（写真へ）', 'btn btn-primary', function () { K.saveFiles(out.files); }));
      dlRow.appendChild(btn('ZIPで保存（画像＋キャプション）', 'status-btn', function () {
        Promise.all(out.files.map(function (f) { return f.blob.arrayBuffer(); })).then(function (bufs) {
          var entries = out.files.map(function (f, i) { return { path: out.folder + '/' + f.name, data: new Uint8Array(bufs[i]) }; });
          entries.push({ path: out.folder + '/caption.txt', data: new TextEncoder().encode(captionOf(set)) });
          entries.push({ path: out.folder + '/products.txt', data: new TextEncoder().encode(set.items.map(function (it, i) { return (i + 1) + '. ' + it.role + '｜' + it.name + '｜' + it.price + '円｜' + it.url; }).join('\n')) });
          K.downloadBlob(new Blob([window.MiniZip.buildZip(entries)], { type: 'application/zip' }), out.folder + '.zip');
        });
      }));
    }, function () { prev.innerHTML = ''; prev.appendChild(el('p', 'hint pitch-warn', '画像を描けませんでした。')); });

    // D. キャプション
    var d = el('div', 'card');
    d.appendChild(el('p', 'field-label', 'キャプション（直せます）'));
    var ta = el('textarea', 'input pitch-intro');
    ta.rows = 10;
    ta.value = captionOf(set);
    ta.addEventListener('change', function () { set.captionEdit = ta.value; D.save(set); });
    d.appendChild(ta);
    if (!allRoom(set)) d.appendChild(el('p', 'hint', '楽天ROOMに全商品を登録するまでは、「紹介したものは楽天ROOMにまとめています」とは書きません。登録したら、各商品の「ROOMに登録した」を押すと文面と最後のスライドが切り替わります。'));
    d.appendChild(btn('キャプションをコピー', 'btn btn-secondary', function () { K.copyText(ta.value).then(function () { K.showToast('コピーしました'); }, function () {}); }));
    wrap.appendChild(d);

    // E. 判断（採用・差し替え・修正・却下）
    var e = el('div', 'card');
    e.appendChild(el('p', 'field-label', '判断'));
    var row1 = el('div', 'pitch-actions');
    row1.appendChild(btn(set.status === 'adopted' ? '採用済み' : '採用する', 'btn btn-primary', function () { D.decide(set.id, 'adopted', ''); K.showToast('採用しました。画像を保存して投稿できます'); paint(); }));
    row1.appendChild(btn('デザインを変える', 'status-btn', function () {
      var styles = (window.IgRender.COVER_STYLES || []).map(function (s) { return s.id; }).filter(function (id) { return id !== 'new_release'; });
      var idx = styles.indexOf(styleOf(set));
      set.coverStyle = styles[(idx + 1) % styles.length];
      D.save(set);
      D.decide(set.id, null, 'デザインの変更', 'revise');
      paint();
    }));
    row1.appendChild(btn('タイトルを直す', 'status-btn', function () {
      var t = window.prompt('表紙のタイトル（24字以内）', set.titleEdit || set.title);
      if (t == null || !t.trim()) return;
      set.titleEdit = t.trim().slice(0, 30);
      D.save(set);
      D.decide(set.id, null, 'タイトルの修正', 'revise');
      paint();
    }));
    row1.appendChild(btn('方向を変えて作り直す', 'status-btn', function () {
      var n = window.prompt('どんな方向にしますか（例：もっと高級感、香りの企画に）');
      if (n == null || !n.trim()) return;
      D.decide(set.id, 'rejected', '方向の変更：' + n.trim(), 'revise');
      openId = '';
      produce(n.trim(), set.id);
    }));
    row1.appendChild(btn('却下', 'status-btn', function () {
      var r = window.prompt('却下の理由（任意。次の企画に反映します）', '');
      if (r == null) return;
      D.decide(set.id, 'rejected', r.trim());
      openId = '';
      paint();
      ensureStock();
    }));
    e.appendChild(row1);
    wrap.appendChild(e);
    return wrap;
  }

  function paint() {
    if (!container) return;
    container.innerHTML = '';
    var set = openId && D.get(openId);
    if (set) { container.appendChild(detail(set)); return; }
    container.appendChild(el('p', 'editor-note', 'AI社員が企画を考え、実在の商品（3〜6点）・Instagram用の画像・キャプション・購入先までそろえた投稿セットです。開いて「採用」「差し替え・修正」「却下」を選ぶだけで大丈夫です。確認待ちが3件より少なくなると、AI社員が次を作ります。'));
    if (!approved()) {
      var ok = el('div', 'card');
      ok.appendChild(el('p', 'hint', '投稿セットの自動制作には、今使っているOpenAIのキーの利用料がかかります（1件あたりAIの呼び出し約3〜4回、約1円の見込み。画像はアプリで描くので画像生成の料金はかかりません。新しいサービスの契約はありません）。確認待ちが3件より少なくなると自動で作ります。'));
      ok.appendChild(btn('了承して、投稿セットを作ってもらう', 'btn btn-discover', function () { try { localStorage.setItem(OK_KEY, '1'); } catch (e) {} paint(); ensureStock(); }));
      container.appendChild(ok);
    }
    if (busy) container.appendChild(el('p', 'hint pitch-busy', busy + '…（1件1〜2分。別のアプリを開いても続きます）'));
    if (lastError) container.appendChild(el('p', 'hint pitch-warn', '直近の制作に失敗しました：' + lastError + (fails >= 2 ? '（2回続いたので止めています）' : '')));
    if (fails >= 2 && !busy) container.appendChild(btn('もう一度作ってもらう', 'btn btn-discover', function () { fails = 0; produce(); }));
    var list = D.all();
    var tabs = [['new', '確認待ち'], ['adopted', '採用'], ['rejected', '却下']];
    tabs.forEach(function (t) {
      var xs = list.filter(function (x) { return x.status === t[0]; });
      if (!xs.length && t[0] !== 'new') return;
      container.appendChild(el('p', 'field-label', t[1] + '（' + xs.length + '）'));
      if (!xs.length) container.appendChild(el('p', 'manage-empty', busy ? '最初の投稿セットを作っています。' : 'まだありません。'));
      xs.forEach(function (x) { container.appendChild(card(x)); });
    });
    var legacy = el('p', 'hint');
    legacy.appendChild(btn('（旧）1商品ずつの提案を見る', 'link-btn', function () { if (window.PitchView) window.PitchView.render(true); }));
    container.appendChild(legacy);
  }

  function render(target) {
    container = target;
    paint();
    ensureStock();
  }

  window.DeliveryView = { render: render };
})();
