// 「社長、これどうすか？」の納品画面：AI社員が自分で企画し、商品（3〜8点）・Instagram用の画像・キャプション・購入先までそろえた
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
  var altBusy = {};   // set.id → 差し替えの候補を探している／文章を作り直している
  var copyBusy = {};  // set.id → 表紙・キャプションの文章を作っている
  var slideCache = {}; // set.id + 版 → { urls, files }
  var container = null;

  function btn(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function linkBtn(text, url) { var a = el('a', 'link-btn', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function cleanName(n) { return String(n || '').replace(/[【\[].*?[】\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || n; }
  // 全商品がROOMに登録済みか（別の投稿セットで登録した同じ商品も、商品ごとの記録で数える）
  function allRoom(set) { return (set.items || []).every(function (it) { return it.room === 'registered' || (window.RoomTextStore && window.RoomTextStore.status(it, it) === 'registered'); }); }
  function styleOf(set) { return set.coverStyle || COVER_BY_PATTERN[set.pattern] || 'unique_pick'; }
  function stamp(iso) { try { return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  // ---- 社長が「いいじゃん！（採用）」した商品（PitchStore：room-pitch に残っている） ----
  function adoptedAll() { return window.PitchStore ? window.PitchStore.list('adopt') : []; }
  function codeOf(p) { return String(p.code || p.key || p.url || ''); }
  // 採用した商品が、どの投稿セット（却下以外）に使われているか
  function usageOf(p) {
    var c = codeOf(p);
    return D.all().filter(function (x) { return x.status !== 'rejected' && (x.items || []).some(function (it) { return it.code && it.code === c || it.adoptedKey === p.key; }); });
  }
  function adoptedUnused() { return adoptedAll().filter(function (p) { return !usageOf(p).length; }); }
  function slimAdopted(list) {
    return list.slice(0, 20).map(function (p) { return { key: p.key, code: p.code, name: p.name, price: p.price, postage: p.postage, url: p.url, image: p.image, shop: p.shop, brand: p.brand, category: p.category, caption: String(p.caption || '').slice(0, 300), pitch: String(p.pitch || '').slice(0, 200), fit: p.fit, reason: p.reason, fetchedAt: p.fetchedAt, decidedAt: p.decidedAt, path: p.path || '', relation: p.relation || '' }; });
  }
  // 掲載商品が、社長の採用か、AIの新規提案か（前の版で作ったセットは、採用リストの商品番号で判断する）
  function isAdopted(it) {
    if (it.source === 'adopted' || it.source === 'base') return true;
    if (it.source === 'ai' || it.source === 'buyer') return false;
    return adoptedAll().some(function (p) { return it.code && codeOf(p) === it.code; });
  }
  function sourceChip(it) { if (it.source === 'buyer') return el('span', 'tag src-ai', 'バイヤーAIの候補（監査AIが合格）'); if (it.source === 'base') return el('span', 'tag src-adopted', '起点の商品'); return isAdopted(it) ? el('span', 'tag src-adopted', '社長が採用') : el('span', 'tag src-ai', 'AIの新規提案'); }

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
    // 楽天の商品画像をInstagramの画像に使ってよいかは、まだ確認できていない（無断の転用にならないよう、投稿前に確認が必要）
    if (!set.imageRightsOk && !set.noPhoto) list.push('画像の権利：楽天の商品画像を使っています。Instagramでの利用条件が未確認のため、このまま投稿しないでください');
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
  // 社長が採用して、まだ投稿にしていない商品を必ず渡す（AIはそれを優先して企画の中心にする）
  function produce(note, replaceOf) {
    if (busy) return Promise.resolve();
    var adopted = adoptedUnused();
    busy = note ? '指示された方向で作り直しています' : adopted.length ? '社長が採用した商品（未使用' + adopted.length + '件）を中心に、投稿セットを作っています' : '投稿セットを作っています';
    lastError = '';
    paint();
    var payload = { action: 'set', history: D.history(), recentPatterns: D.recentPatterns(), exclude: D.exclude(), adopted: slimAdopted(adopted), note: note || '' };
    return K.jobCall('pitch', payload, { label: '投稿セットの制作', genre: '' }).then(function (r) {
      if (r.status !== 200 || !r.data.set) throw new Error((r.data && r.data.error) || '投稿セットを作れませんでした');
      if (replaceOf) r.data.set.replaces = replaceOf;
      D.save(r.data.set); // 先に保存（文章づくりに失敗しても、商品の選定は残す）
      return finishCopy(r.data.set);
    }).then(function (set) {
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
    // 社長が投稿セットを開いている間・差し替えの途中は、新しい制作を始めない（差し替えを先に進めるため）
    // サーバーの正本につながっているときは、投稿セットはサーバーの制作ラインが作る（この端末では自動で作らない＝同じ仕事に二重に費用をかけない）
    var ss = window.ServerSync && window.ServerSync.status();
    if (ss && ss.data && ss.data.ok) return;
    if (busy || fails >= 2 || !approved() || openId || !container || !container.isConnected || Object.keys(altBusy).length || location.hash.indexOf('#pitch') !== 0) return;
    if (D.pendingCount() < STOCK) produce();
  }

  // スライド（Instagram用の完成画像）を描く
  function slidesOf(set) {
    var key = set.id + ':' + (set.copyAt || '') + ':' + styleOf(set) + ':' + (set.titleEdit || '') + ':' + allRoom(set) + ':' + (set.noPhoto ? 'np' : '') + ':' + set.items.map(function (it) { return it.code || it.name; }).join(',');
    if (slideCache[key]) return Promise.resolve(slideCache[key]);
    // 商品写真を使わない版は、楽天の商品画像を読み込まない
    var images = set.noPhoto ? Promise.resolve(set.items.map(function () { return null; })) : Promise.all(set.items.map(function (it) { return K.loadProductImage(it.image); }));
    var bear = window.IgRender.loadImage(K.bearSrc).catch(function () { return null; });
    return Promise.all([images, bear]).then(function (r) {
      // C0：描いた画像の中で、どの商品の写真か分かるように印を付ける（客観確認で、商品写真の一致を確かめる）
      r[0].forEach(function (img, i) { if (img) img.__tag = 'item:' + i + ':' + (set.items[i].code || ''); });
      if (r[1]) r[1].__tag = 'bear';
      var copy = set.copy || {};
      var ci = copy.items || [];
      var style = styleOf(set);
      var cv = copy.cover || {};
      var post = {
        topic: copy.topic || set.title, category: set.patternLabel || '', subtitle: set.target || '',
        // 表紙の大見出しは、企画のタイトル（直したものがあればそれ）にそろえる（表紙と中身がずれないように）
        cover: style === 'serious_think' ? null : (function () { var t = set.titleEdit || set.title; return { style: style, title: t, accent: cv.accent && t.indexOf(cv.accent) !== -1 ? cv.accent : '', sub: set.target || cv.sub || '', badge: cv.badge || '', price: cv.price || '' }; })(),
        bear: r[1], ctaMessage: ctaOf(set), coverHero: true, noPhoto: !!set.noPhoto,
        // 制作ラインの投稿セット（factOnly）：補足・メモは楽天の商品説明にそのままある言葉だけ。AIが書いた特徴（feature）で埋めない（空欄のまま）
        items: set.items.map(function (it, i) { var c = ci[i] || {}; var fact = !!c.factOnly; return { image: r[0][i], shortName: c.shortName || cleanName(it.name), subline: c.subline, memo: fact ? (c.memo || '') : (c.memo || it.feature), price: it.price, role: it.role, brand: it.brand, point: fact ? (c.subline || '') : (it.feature || c.subline || '') }; })
      };
      var slides = window.IgRender.renderPost(post);
      // C0：客観的な品質確認（はみ出し・文字の大きさ・コントラスト・商品写真の一致・PR表記・権利）と、版の保存（修正前後の比較用）
      var check = null;
      if (window.CreativeCheck) {
        try {
          check = window.CreativeCheck.checkPost(slides, set, { missingPhoto: r[0].map(function (x) { return !x; }), bearLoaded: !!r[1] });
          window.CreativeCheck.saveVersion(set.id, key, slides, check, set.titleEdit || set.title);
        } catch (e) { check = { error: String(e && e.message || e), slides: [], post: [], ng: 0, warn: 0, ok: false }; }
      }
      return Promise.all(slides.map(function (s) { return K.canvasToBlob(s.canvas); })).then(function (blobs) {
        var folder = (set.createdAt || '').slice(0, 10) + '_' + set.id;
        var files = slides.map(function (s, i) { return { name: s.fileName, blob: blobs[i] }; });
        var out = { folder: folder, files: files, urls: blobs.map(function (b) { return URL.createObjectURL(b); }), missing: r[0].filter(function (x) { return !x; }).length, check: check };
        slideCache[key] = out;
        return out;
      });
    });
  }

  // ---- 差し替え：対象の商品 → 理由（任意）→ AIが候補を3〜4点 → 社長が選ぶ → 商品一覧を更新 → 表紙・商品カード・キャプションを作り直す ----
  // 候補はセットに保存する（画面を閉じても、再読み込みしても残る）
  function askAlternatives(set, i, reason) {
    if (altBusy[set.id]) return;
    altBusy[set.id] = '「' + cleanName(set.items[i].name).slice(0, 16) + '」の代わりの候補を探しています';
    D.save(Object.assign({}, D.get(set.id), { alt: { index: i, reason: reason, code: set.items[i].code || '', state: 'searching', at: Date.now() } }));
    paint();
    var cur = D.get(set.id);
    var slim = { title: cur.title, pattern: cur.pattern, target: cur.target, appeal: cur.appeal, slots: cur.slots, exclude: cur.replaced || [],
      items: cur.items.map(function (it) { return { role: it.role, name: it.name, code: it.code }; }) };
    var others = adoptedUnused();
    var info = busy ? '（今作っている投稿セットのあとに、順番に進みます）' : '';
    if (info) K.showToast('差し替えの候補探しは、今作っている投稿セットのあとに進みます');
    K.jobCall('pitch', { action: 'alternatives', set: slim, index: i, reason: reason || '', adopted: slimAdopted(others) }, { label: '投稿セットの差し替え候補', genre: '' }).then(function (r) {
      saveAlternatives(set.id, i, r);
    }).then(function () { delete altBusy[set.id]; paint(); ensureStock(); });
  }
  function saveAlternatives(id, i, r) {
    var cur = D.get(id);
    if (!cur) return;
    var alt = Object.assign({}, cur.alt || { index: i });
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.candidates)) { alt.state = 'error'; alt.error = (r.data && r.data.error) || '候補を出せませんでした'; }
    else { alt.state = 'ready'; alt.candidates = r.data.candidates; alt.keyword = r.data.keyword || ''; alt.error = ''; }
    D.save(Object.assign({}, cur, { alt: alt }));
  }
  function applyAlternative(id, cand) {
    var cur = D.get(id);
    if (!cur || !cur.alt) return;
    var i = cur.alt.index;
    var old = cur.items[i];
    var items = cur.items.slice();
    items[i] = Object.assign({}, cand, { role: old.role, room: 'unregistered' });
    var next = Object.assign({}, cur, { items: items, alt: null, copy: null, copyAt: '', captionEdit: '', replaced: (cur.replaced || []).concat(old.code || []), issues: [] });
    next.issues = localQuality(next);
    D.save(next);
    D.decide(id, null, '商品の差し替え：' + cleanName(old.name).slice(0, 24) + ' → ' + cleanName(cand.name).slice(0, 24) + (cur.alt.reason ? '（理由：' + cur.alt.reason + '）' : ''), 'revise');
    K.showToast('差し替えました。表紙・商品カード・キャプションを作り直しています');
    remakeCopy(id);
  }
  // 表紙・商品カードの文字とキャプションを、今の商品一覧で作り直す
  function remakeCopy(id) {
    var cur = D.get(id);
    if (!cur || copyBusy[id]) return;
    copyBusy[id] = true;
    paint();
    finishCopy(Object.assign({}, cur)).then(function (done) {
      var latest = D.get(id);
      // 作っている間に商品が変わっていたら使わない（商品と文章がずれないように）
      var same = latest && latest.items.map(function (x) { return x.code; }).join() === done.items.map(function (x) { return x.code; }).join();
      if (same) D.save(Object.assign({}, latest, { copy: done.copy, copyAt: done.copyAt || '', copyError: done.copy ? '' : done.copyError }));
    }).then(function () { delete copyBusy[id]; paint(); });
  }
  // 画面側で分かる品質確認（差し替えたあと、サーバーの確認をやり直す代わり）
  function localQuality(set) {
    var list = [];
    if (set.items.length < 3) list.push('商品が3点に届かない（' + set.items.length + '点）');
    set.items.forEach(function (it) {
      if (!(it.price > 0)) list.push('価格が取れていない：' + cleanName(it.name));
      if (!/^https:\/\/item\.rakuten\.co\.jp\//.test(it.url || '')) list.push('楽天の商品URLがない：' + cleanName(it.name));
      if (!it.image) list.push('商品画像がない：' + cleanName(it.name));
    });
    var codes = set.items.map(function (it) { return it.code || it.name; });
    if (codes.some(function (c, k) { return codes.indexOf(c) !== k; })) list.push('同じ商品が重複している');
    return list;
  }

  // 検索ジョブが、画面が待っていない間に終わったとき（再読み込み・別の画面）も、結果を保存する（app.js の Jobs.notify から呼ぶ）
  function onJobDone(job) {
    var b = (job.params && job.params.body) || {};
    var ok = job.status === 'completed' || job.status === 'partial';
    if (b.action === 'set' && ok && job.result && job.result.set && !D.get(job.result.set.id)) { D.save(job.result.set); paint(); return true; }
    if (b.action === 'alternatives') {
      var id = Object.keys(altBusy)[0];
      var match = D.all().filter(function (x) { return x.alt && x.alt.state === 'searching' && x.alt.index === b.index && x.title === (b.set || {}).title; })[0];
      if (match) { saveAlternatives(match.id, b.index, ok ? { status: 200, data: job.result } : { status: 500, data: { error: job.error || '候補を出せませんでした' } }); delete altBusy[match.id]; paint(); }
      return !!(match || id);
    }
    return b.action === 'set';
  }

  // ---- 一覧 ----
  function card(set) {
    var c = el('article', 'card delivery-card');
    var chips = el('div', 'chips');
    chips.appendChild(el('span', set.status === 'adopted' ? 'idea-edited' : 'role', set.supersededBy ? '改善版に置き換え済み' : D.STATUS[set.status] || set.status));
    if (set.improvedFrom) chips.appendChild(el('span', 'tag src-adopted', '改善版'));
    if (set.noPhoto) chips.appendChild(el('span', 'tag', '商品写真なし'));
    chips.appendChild(el('span', 'tag', set.patternLabel ? set.patternLabel.split('（')[0] : ''));
    var iss = issuesOf(set);
    if (iss.length) chips.appendChild(el('span', 'tag pitch-warn', '要確認 ' + iss.length));
    c.appendChild(chips);
    c.appendChild(el('h3', 'cand-name', set.titleEdit || set.title));
    c.appendChild(el('p', 'hint', set.target || ''));
    var strip = el('div', 'delivery-strip');
    set.items.forEach(function (it) {
      var f = el('div', 'delivery-thumbwrap' + (isAdopted(it) ? ' is-adopted' : ''));
      var im = el('img', 'delivery-thumb'); im.src = it.image; im.alt = ''; im.loading = 'lazy'; f.appendChild(im);
      if (isAdopted(it)) f.appendChild(el('span', 'thumb-badge', '採用'));
      strip.appendChild(f);
    });
    c.appendChild(strip);
    var nAd = set.items.filter(isAdopted).length;
    var nBy = set.items.filter(function (it) { return it.source === 'buyer'; }).length;
    c.appendChild(el('p', 'hint', set.items.length + '商品（社長が採用 ' + nAd + (nBy ? '・バイヤーAIの合格候補 ' + nBy : '') + '・AIの新規提案 ' + (set.items.length - nAd - nBy) + '）｜' + stamp(set.createdAt) + ' 作成'));
    if (set.auto) c.appendChild(el('p', 'hint', '自律運営で作成（企画担当AI→投稿セット制作AI→監査AI' + (set.auto.revisions ? '→制作担当AIが' + set.auto.revisions + '回修正' : '') + '）｜監査 ' + set.auto.score + '点・合格。採用・公開は社長が決めます'));
    c.addEventListener('click', function () { openId = set.id; paint(); window.scrollTo(0, 0); });
    return c;
  }

  // 差し替えの操作欄（理由 → 候補 → 選ぶ）
  function altPanel(set, i, alt) {
    var p = el('div', 'card alt-panel');
    p.appendChild(el('p', 'field-label', '「' + cleanName(set.items[i].name).slice(0, 24) + '」の差し替え'));
    var close = function () { var cur = D.get(set.id); cur.alt = null; D.save(cur); delete altBusy[set.id]; paint(); };
    if (alt.state === 'asking' || alt.state === 'error') {
      if (alt.error) p.appendChild(el('p', 'hint pitch-warn', '候補を出せませんでした：' + alt.error));
      var ta = el('textarea', 'input');
      ta.rows = 2;
      ta.placeholder = '直してほしい点（任意）例：もっと高級感のあるもの／5,000円以内／革以外で';
      ta.value = alt.reason || '';
      p.appendChild(ta);
      p.appendChild(el('p', 'hint', '社長が採用して、まだ投稿にしていない商品があれば、それも候補に入れます。'));
      var row = el('div', 'pitch-row');
      row.appendChild(btn('代わりの候補を出してもらう', 'btn btn-primary', function () { askAlternatives(set, i, ta.value.trim().slice(0, 100)); }));
      row.appendChild(btn('やめる', 'status-btn', close));
      p.appendChild(row);
      return p;
    }
    if (alt.state === 'searching') {
      p.appendChild(el('p', 'hint pitch-busy', (altBusy[set.id] ? '代わりの候補を探しています…（30〜60秒）' : '候補を探しています…（画面を開き直した場合は、検索ジョブが終わると自動でここに出ます）') + (alt.reason ? '　理由：' + alt.reason : '')));
      if (!altBusy[set.id]) p.appendChild(btn('探し直す', 'status-btn', function () { askAlternatives(set, i, alt.reason || ''); }));
      p.appendChild(btn('やめる', 'status-btn', close));
      return p;
    }
    // ready：候補を並べる
    p.appendChild(el('p', 'hint', '候補 ' + (alt.candidates || []).length + '点' + (alt.reason ? '｜理由：' + alt.reason : '') + (alt.keyword ? '｜楽天で「' + alt.keyword + '」を探しました' : '')));
    (alt.candidates || []).forEach(function (cand) {
      var r = el('div', 'delivery-item');
      var top = el('div', 'cand-top');
      var im = el('img', 'cand-thumb'); im.src = cand.image; im.alt = ''; im.loading = 'lazy'; top.appendChild(im);
      var info = el('div', 'cand-info');
      info.appendChild(sourceChip(cand));
      info.appendChild(el('p', 'thief-cand-name', cleanName(cand.name)));
      info.appendChild(el('p', 'cand-meta', K.formatPrice(cand.price) + '（税込' + (cand.postage ? '・' + cand.postage : '') + '）' + (cand.shop ? '｜' + cand.shop : '')));
      if (cand.feature) info.appendChild(el('p', 'hint', '特徴：' + cand.feature));
      if (cand.why) info.appendChild(el('p', 'hint', '入れる理由：' + cand.why));
      top.appendChild(info);
      r.appendChild(top);
      var acts = el('div', 'pitch-row');
      acts.appendChild(btn('これにする', 'btn btn-primary', function () { applyAlternative(set.id, cand); }));
      acts.appendChild(linkBtn('楽天の商品ページ', cand.url));
      r.appendChild(acts);
      p.appendChild(r);
    });
    var row2 = el('div', 'pitch-row');
    row2.appendChild(btn('理由を変えて探し直す', 'status-btn', function () { var cur = D.get(set.id); cur.alt = { index: i, code: alt.code, state: 'asking', reason: alt.reason || '' }; D.save(cur); paint(); }));
    row2.appendChild(btn('やめる', 'status-btn', close));
    p.appendChild(row2);
    return p;
  }

  // 社長が採用した商品の一覧（AIの新規提案と分けて、いつでも確認できる）
  var adoptedOpen = false;
  function adoptedSection() {
    var list = adoptedAll();
    var box = el('div', 'card');
    var unused = list.filter(function (p) { return !usageOf(p).length; }).length;
    box.appendChild(el('p', 'field-label', '社長が採用した商品（' + list.length + '件・まだ投稿にしていない ' + unused + '件）'));
    if (!list.length) {
      box.appendChild(el('p', 'hint', 'このiPhoneには、「いいじゃん！」で採用した商品の記録がありません。（記録はこのiPhoneのブラウザ内に残ります。ホーム画面のアイコンとSafariでは記録の場所が別です。前に採用したのと同じ開き方で開いてください）'));
      return box;
    }
    box.appendChild(el('p', 'hint', '投稿セットを作るとき、まだ投稿にしていない採用商品を優先して使います（企画として自然に並ぶものだけ。合わないものは無理に入れません）。'));
    box.appendChild(btn(adoptedOpen ? '一覧を閉じる' : '一覧を見る', 'status-btn', function () { adoptedOpen = !adoptedOpen; paint(); }));
    box.appendChild(btn('採用済みの画面で見る', 'link-btn', function () { if (window.PitchView && window.PitchView.show) window.PitchView.show('adopted'); }));
    if (adoptedOpen) {
      list.forEach(function (p) {
        var row = el('div', 'delivery-item');
        var top = el('div', 'cand-top');
        if (p.image) { var im = el('img', 'cand-thumb'); im.src = p.image; im.alt = ''; im.loading = 'lazy'; top.appendChild(im); }
        var info = el('div', 'cand-info');
        info.appendChild(el('span', 'tag src-adopted', '社長が採用' + (p.featured ? '（看板商品）' : '')));
        info.appendChild(el('p', 'thief-cand-name', cleanName(p.name)));
        info.appendChild(el('p', 'cand-meta', (p.price ? K.formatPrice(p.price) : '価格は未取得') + (p.decidedAt ? '｜' + stamp(new Date(p.decidedAt).toISOString()) + ' 採用' : '')));
        if (p.reason) info.appendChild(el('p', 'hint', '採用の理由：' + p.reason));
        var used = usageOf(p);
        info.appendChild(el('p', 'hint', used.length ? '投稿セットに使用中：' + used.map(function (x) { return '「' + (x.titleEdit || x.title) + '」（' + D.STATUS[x.status] + '）'; }).join('、') : 'まだ投稿セットに入っていません'));
        top.appendChild(info);
        row.appendChild(top);
        if (p.url) row.appendChild(linkBtn('楽天の商品ページ', p.url));
        box.appendChild(row);
      });
    }
    if (unused && approved()) box.appendChild(btn('採用した商品で投稿セットを作ってもらう', 'btn btn-discover', function () { if (busy) { K.showToast('今、投稿セットを作っています。終わってからもう一度押してください'); return; } fails = 0; produce(); }));
    return box;
  }

  // ---- 楽天ROOMへの登録（商品ごと） ----
  var R = window.RoomTextStore;
  var ROOM_STATUS = { none: '未登録', ready: '文章準備済み', registered: 'ROOM登録済み（社長の申告）' };
  var roomOpen = {};   // set.id:番号 → 開いている
  var addOpen = {};    // set.id → 「商品を追加する」を開いている
  var addTab = 'adopted';
  // 追加の候補：採用済みでどの投稿セットにも入っていない商品／広げるで見つけた商品（新しい順）
  function addCandidates(set) {
    var inSet = function (p) { return set.items.some(function (x) { return sameItem(x, p); }); };
    var adopted = adoptedUnused().filter(function (p) { return !inSet(p); });
    var found = [];
    var X = window.ExploreStore;
    if (X) X.roots().forEach(function (n) { [n].concat(X.children(n.id)).forEach(function (m) { var pool = X.pool(m.id); if (pool) pool.items.forEach(function (it) { if (!inSet(it) && !found.some(function (f) { return sameItem(f, it); })) found.push(Object.assign({ fromName: m.product.name }, it, { checkedAt: (pool.batches.filter(function (bt) { return bt.id === it.batch; })[0] || {}).at || '' })); }); }); });
    found.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    return { adopted: adopted, found: found.slice(0, 40) };
  }
  function addPanel(set) {
    var box = el('div', 'add-panel');
    var left = MAX_SET_ITEMS - set.items.length;
    box.appendChild(btn('商品を追加する（' + set.items.length + '/' + MAX_SET_ITEMS + '点）', 'btn btn-secondary add-toggle', function () { addOpen[set.id] = !addOpen[set.id]; paint(); }));
    if (!addOpen[set.id]) return box;
    if (left <= 0) { box.appendChild(el('p', 'hint pitch-warn', 'この投稿セットは' + MAX_SET_ITEMS + '点で上限です。入れ替えたいときは「この商品を差し替える」を使ってください。')); return box; }
    var c = addCandidates(set);
    var tabs = el('div', 'xp-filter');
    [['adopted', '採用済み（まだ使っていない）', c.adopted.length], ['found', '広げるで見つけた商品', c.found.length]].forEach(function (t) { tabs.appendChild(btn(t[1] + '（' + t[2] + '）', 'xp-chip' + (addTab === t[0] ? ' active' : ''), function () { addTab = t[0]; paint(); })); });
    box.appendChild(tabs);
    var list = addTab === 'adopted' ? c.adopted : c.found;
    if (!list.length) box.appendChild(el('p', 'hint', addTab === 'adopted' ? '追加できる採用済みの商品はありません（すべて投稿セットに入っています）。' : '広げるで見つけた商品はありません。「広げる」で探すと、ここから追加できます。'));
    list.forEach(function (p) {
      var r = el('div', 'cand-top add-row');
      var im = el('img', 'cand-thumb'); im.src = p.image || ''; im.alt = ''; im.loading = 'lazy'; r.appendChild(im);
      var info = el('div', 'cand-info');
      info.appendChild(el('p', 'thief-cand-name', cleanName(p.name)));
      info.appendChild(el('p', 'cand-meta', (p.price ? K.formatPrice(p.price) : '価格は未取得') + (addTab === 'found' && p.fromName ? '｜「' + cleanName(p.fromName).slice(0, 14) + '」から' : '') + (addTab === 'adopted' && p.reason ? '｜採用理由：' + p.reason : '')));
      if (p.relation || p.feature) info.appendChild(el('p', 'hint', p.relation || p.feature));
      info.appendChild(btn('この投稿セットに追加', 'btn btn-primary co-sbtn', function () {
        // 広げるで見つけた商品は、追加と同時に採用済みにする（ROOM紹介文・採用の記録に残す）
        if (addTab === 'found' && window.PitchStore && window.PitchStore.adoptFrom) window.PitchStore.adoptFrom(p, '', { origin: 'explore', relation: p.relation || '' });
        var r2 = addItems(set.id, [p], addTab === 'found' ? '広げる' : '採用済み');
        K.showToast(r2.added ? '追加しました。表紙・商品カード・キャプションを作り直しています' : r2.error);
        paint();
      }));
      r.appendChild(info);
      box.appendChild(r);
    });
    return box;
  }
  var roomBusy = {};   // 商品の key → 作っている
  var roomEdit = {};   // 商品の key → 編集中
  function tagsText(tags) { return (tags || []).map(function (t) { return t.charAt(0) === '#' ? t : '#' + t; }).join(' '); }
  function makeRoomText(set, it, again) {
    var k = R.keyOf(it);
    if (roomBusy[k]) return;
    roomBusy[k] = true;
    paint();
    K.postJson('api/pitch', { action: 'roomtext', set: { title: set.titleEdit || set.title, patternLabel: set.patternLabel || '', target: set.target || '' }, item: { name: it.name, price: it.price, role: it.role, brand: it.brand, feature: it.feature, why: it.why, caption: it.caption } }).then(function (r) {
      delete roomBusy[k];
      if (r.status !== 200 || !r.data.intro) { K.showToast((r.data && r.data.error) || '紹介文を作れませんでした'); paint(); return; }
      R.saveGenerated(it, r.data.intro, r.data.tags || [], set.titleEdit || set.title);
      if (r.data.notice) K.showToast(r.data.notice);
      else if (again) K.showToast('作り直しました（前の文章は履歴に残しています）');
      paint();
    });
  }
  // ハッシュタグだけ作る（紹介文は変えない）。ai=false：商品のデータから（AIなし・0円）／ai=true：AIで作り直す
  var tagBusy = {};
  var tagTried = {};
  function makeTags(set, it, ai, quiet) {
    var k = R.keyOf(it);
    if (tagBusy[k]) return Promise.resolve('busy');
    tagBusy[k] = true; tagTried[k] = true;
    var x0 = R.get(it) || {};
    return K.postJson('api/pitch', { action: ai ? 'tagsai' : 'tags', set: { title: set.titleEdit || set.title, patternLabel: set.patternLabel || '', target: set.target || '' }, item: { name: it.name, role: it.role, brand: it.brand, feature: it.feature, why: it.why, intro: x0.intro || '' } }).then(function (r) {
      delete tagBusy[k];
      var tags = r.status === 200 && r.data && Array.isArray(r.data.tags) ? r.data.tags : null;
      if (!tags) { if (ai && !quiet) K.showToast((r.data && r.data.error) || 'ハッシュタグを作れませんでした'); paint(); return 'fail'; }
      // 関係の高いタグが見つからなければ、今のタグを消さずにそのまま
      if (!tags.length) { if (ai && !quiet) K.showToast('関係の高いタグが見つからなかったため、今のタグのままにしました'); paint(); return 'none'; }
      R.saveTags(it, tags, r.data.from || '');
      if (ai && !quiet) K.showToast(r.data.notice || 'ハッシュタグを作り直しました（前のタグは履歴に残しています）');
      paint();
      return r.data.from === 'AI' ? 'ai' : 'local';
    });
  }
  // 投稿セットの商品のハッシュタグをまとめて作り直す（紹介文は変えない。前のタグは履歴に残す。1商品ずつ順番に、AIを1回ずつ）
  var regen = null; // { total, done, ai, local, none, fail, noIntro }
  function regenTargets(sets) {
    var seen = {}; var out = []; var noIntro = 0;
    sets.forEach(function (set) {
      (set.items || []).forEach(function (it) {
        var k = R.keyOf(it);
        if (seen[k]) return;
        seen[k] = true;
        var x = R.get(it);
        if (x && x.intro) out.push({ set: set, it: it }); else noIntro++;
      });
    });
    return { list: out, noIntro: noIntro };
  }
  function regenAll(sets, label) {
    if (regen) { K.showToast('今、ハッシュタグを作り直しています'); return; }
    var t = regenTargets(sets);
    if (!t.list.length) { K.showToast('作り直せる商品がありません（紹介文がまだの商品は、商品を開くと紹介文とハッシュタグを作ります）'); return; }
    var stop = window.AiUsage && window.AiUsage.blocked(t.list.length);
    if (stop) { K.showToast(stop); return; }
    if (!window.confirm(label + 'の ' + t.list.length + '商品のハッシュタグを作り直しますか？\n・AIを' + t.list.length + '回使います（推定 約' + Math.ceil(t.list.length * 0.5) + '円）\n・紹介文は変えません。今のタグ（手で直したタグも）は履歴に残します\n・AIが失敗した商品は、商品名・特徴から作ります' + (t.noIntro ? '\n・紹介文がまだの ' + t.noIntro + '商品は対象外です（開くと紹介文とタグを作ります）' : ''))) return;
    regen = { total: t.list.length, done: 0, ai: 0, local: 0, none: 0, fail: 0, noIntro: t.noIntro };
    paint();
    var i = 0;
    (function next() {
      if (i >= t.list.length) {
        var g = regen; regen = null;
        K.showToast('ハッシュタグを作り直しました：AI ' + g.ai + '件・商品のデータから ' + g.local + '件' + (g.none ? '・見つからず今のまま ' + g.none + '件' : '') + (g.fail ? '・失敗 ' + g.fail + '件（今のまま）' : ''));
        paint();
        return;
      }
      var x = t.list[i++];
      makeTags(x.set, x.it, true, true).then(function (res) {
        if (regen) { regen.done++; if (res === 'ai') regen.ai++; else if (res === 'local') regen.local++; else if (res === 'none') regen.none++; else regen.fail++; }
        paint();
        next();
      });
    })();
  }
  function regenBox(sets, label) {
    var box = el('div', 'card');
    if (regen) { box.appendChild(el('p', 'hint pitch-busy', 'ハッシュタグを作り直しています… ' + regen.done + '/' + regen.total + '商品（このまま開いておいてください）')); return box; }
    box.appendChild(btn(label + 'のハッシュタグをまとめて作り直す', 'btn btn-secondary regen-tags', function () { regenAll(sets, label); }));
    box.appendChild(el('p', 'hint', '楽天ROOMのハッシュタグだけを、新しい作り方で作り直します。紹介文は変えません。前のタグは履歴に残ります。AIを商品の数だけ使います（1商品 推定0.5円）。'));
    return box;
  }
  function copy(text, msg) { K.copyText(text).then(function () { K.showToast(msg); }, function () { K.showToast('コピーできませんでした'); }); }
  function roomPanel(set, i, it) {
    var k = R.keyOf(it);
    var x = R.get(it);
    var box = el('div', 'room-panel');
    if (!x || !x.intro) {
      if (!roomBusy[k]) setTimeout(function () { makeRoomText(set, it, false); }, 0); // 開いたときに、まだなければ作る（1商品ずつ）
      box.appendChild(el('p', 'hint pitch-busy', 'ROOMの紹介文とハッシュタグを作っています…（20〜40秒）'));
      return box;
    }
    if (roomBusy[k]) box.appendChild(el('p', 'hint pitch-busy', '作り直しています…'));
    var steps = el('p', 'hint room-steps', '① コピー → ② 楽天ROOMを開いて貼り付けて登録 → ③ アプリに戻って「ROOMに登録した」');
    box.appendChild(steps);
    // 紹介文はあるのにタグが空（前に作った紹介文を引き継いだ商品など）：商品のデータから作って補う（AIなし・0円）
    if (R.needsTags(it) && !tagTried[k] && !tagBusy[k]) setTimeout(function () { makeTags(set, it, false); }, 0);
    if (tagBusy[k]) box.appendChild(el('p', 'hint pitch-busy', 'ハッシュタグを作っています…'));
    // コピーは押したときの最新の内容で
    box.appendChild(btn('紹介文＋ハッシュタグをコピー', 'btn btn-primary room-copy', function () {
      var c = R.get(it) || x;
      var hasTags = (c.tags || []).length;
      copy(c.intro + (hasTags ? '\n\n' + tagsText(c.tags) : ''), hasTags ? 'コピーしました。楽天ROOMで貼り付けてください' : '紹介文をコピーしました（ハッシュタグはまだありません）');
    }));
    if (roomEdit[k]) {
      var ta = el('textarea', 'input room-text');
      ta.rows = 8; ta.value = x.intro;
      var tg = el('input', 'input');
      tg.value = tagsText(x.tags); tg.placeholder = '#タグ を空白区切りで';
      box.appendChild(ta); box.appendChild(tg);
      var er = el('div', 'pitch-row');
      er.appendChild(btn('保存する', 'btn btn-primary co-sbtn', function () { R.saveEdit(it, ta.value.trim(), tg.value.split(/[\s　]+/).filter(Boolean).map(function (t) { return t.charAt(0) === '#' ? t : '#' + t; })); delete roomEdit[k]; K.showToast('保存しました'); paint(); }));
      er.appendChild(btn('やめる', 'status-btn', function () { delete roomEdit[k]; paint(); }));
      box.appendChild(er);
    } else {
      box.appendChild(el('p', 'room-intro', x.intro));
      box.appendChild(el('p', 'room-tags', tagsText(x.tags) || (tagBusy[k] ? '（ハッシュタグを作っています）' : '（関係の高いハッシュタグが見つかりませんでした。無理に付けていません。「ハッシュタグを作り直す」でAIに考えてもらえます）')));
      if ((x.tags || []).length) box.appendChild(el('p', 'hint', 'ハッシュタグ ' + x.tags.length + '個' + (x.tagsFrom ? '｜' + (x.tagsFrom === 'AI' ? 'AIが作成' : x.tagsFrom === '商品のデータ' ? '商品名・特徴から作成' : x.tagsFrom) : '') + (x.editedAt && !x.tagsAt ? '｜社長が編集' : '')));
      box.appendChild(el('p', 'hint', x.intro.length + '字' + (x.editedAt ? '｜社長が編集（' + stamp(x.editedAt) + '）' : x.generatedAt ? '｜AIが作成（' + stamp(x.generatedAt) + '）' : '｜' + (x.from || '')) + ((x.history || []).length ? '｜前の文章 ' + x.history.length + '件を保存' : '')));
    }
    var r1 = el('div', 'room-grid');
    r1.appendChild(btn('紹介文だけコピー', 'status-btn', function () { copy(x.intro, '紹介文をコピーしました'); }));
    r1.appendChild(btn('ハッシュタグだけコピー', 'status-btn', function () { var c = R.get(it) || x; if (!(c.tags || []).length) { K.showToast('ハッシュタグがまだありません。「ハッシュタグを作り直す」で作れます'); return; } copy(tagsText(c.tags), 'ハッシュタグをコピーしました'); }));
    r1.appendChild(btn('文章を編集する', 'status-btn', function () { roomEdit[k] = true; paint(); }));
    r1.appendChild(btn('ハッシュタグを作り直す', 'status-btn', function () { if (window.confirm('ハッシュタグだけをAIで作り直しますか？（紹介文は変えません。今のタグは履歴に残ります。AIを1回使います）')) makeTags(set, it, true); }));
    r1.appendChild(btn('文章を作り直す', 'status-btn', function () { if (window.confirm('紹介文とハッシュタグを作り直しますか？（今の文章は履歴に残ります）')) makeRoomText(set, it, true); }));
    box.appendChild(r1);
    // ROOMを開く：商品番号を指定した楽天ROOMの登録（コレ！）画面のURL。開けない場合に備えて商品ページも置く
    if (it.code) {
      var a = linkBtn('楽天ROOMで登録する', K.roomUrl(it.code));
      a.className = 'btn btn-secondary room-open';
      box.appendChild(a);
      box.appendChild(el('p', 'hint', '楽天ROOMの、この商品の登録画面を開きます（ログインが必要です）。開かない場合は「楽天の商品ページ」から、ROOMに追加してください。'));
    } else box.appendChild(el('p', 'hint pitch-warn', '商品番号がないため、ROOMの登録画面を直接開けません。「楽天の商品ページ」からROOMに追加してください。'));
    var reg = R.status(it, it) === 'registered';
    box.appendChild(btn(reg ? 'ROOM登録を取り消す（記録だけ）' : 'ROOMに登録した', reg ? 'status-btn' : 'btn btn-discover room-done', function () {
      var cur = D.get(set.id);
      cur.items[i].room = reg ? 'unregistered' : 'registered';
      D.save(cur);
      R.setRegistered(it, !reg);
      K.showToast(reg ? '登録の記録を取り消しました' : '登録済みとして記録しました（社長の申告）');
      paint();
    }));
    box.appendChild(el('p', 'hint', '「ROOM登録済み」は社長が押した記録です。楽天ROOM側の登録をアプリが自動で確認したものではありません。'));
    return box;
  }

  // ---- C0：画像の客観的な品質確認（コードで測った事実。AIの評価ではない）と、修正前後の比較 ----
  function qualityBox(set, out) {
    var box = el('div', 'add-panel cq-box');
    var ck = out.check;
    var post = window.CreativeCheck.postChecks(D.get(set.id) || set);
    var slideIssues = [];
    (ck.slides || []).forEach(function (s, i) { s.issues.forEach(function (x) { slideIssues.push({ level: x.level, msg: (i + 1) + '枚目：' + x.msg }); }); });
    var all = post.concat(slideIssues);
    var ng = all.filter(function (x) { return x.level === 'ng'; });
    var warn = all.filter(function (x) { return x.level === 'warn'; });
    box.appendChild(el('p', 'field-label', '画像の品質確認（コードで測定・AIなし）：' + (ck.error ? '確認できなかった' : ng.length ? '不合格 ' + ng.length + '件' : '合格') + (warn.length ? '・注意 ' + warn.length + '件' : '')));
    if (ck.error) box.appendChild(el('p', 'hint pitch-warn', '確認の途中でエラー：' + ck.error));
    ng.concat(warn).slice(0, 12).forEach(function (x) { box.appendChild(el('p', 'hint' + (x.level === 'ng' ? ' pitch-warn' : ''), (x.level === 'ng' ? '不合格 ' : '注意 ') + x.msg)); });
    if (ng.length + warn.length > 12) box.appendChild(el('p', 'hint', 'ほか ' + (ng.length + warn.length - 12) + '件'));
    var minSize = (ck.slides || []).map(function (s) { return s.minSize; }).filter(Boolean);
    box.appendChild(el('p', 'hint', '測ったこと：文字のはみ出しと端の余白（' + window.CreativeCheck.SAFE + 'px）・文字の大きさ（最小 ' + (minSize.length ? Math.min.apply(null, minSize) + 'px' : '不明') + '）・文字と背景の濃さの差・途中で切れた文字・商品写真の一致・PR表記・素材の権利。見た目の良し悪しは、ここでは判断していません。'));
    var cmp = el('div');
    box.appendChild(btn('前の版と比べる', 'status-btn', function () {
      cmp.innerHTML = '';
      cmp.appendChild(el('p', 'hint', '読み込んでいます…'));
      window.CreativeCheck.versions(set.id).then(function (list) {
        cmp.innerHTML = '';
        if (list.length < 2) { cmp.appendChild(el('p', 'hint', list.length ? 'まだ1つの版しかありません（タイトル・デザイン・商品を変えると、新しい版として残ります）' : '保存された版がありません')); return; }
        list.slice(0, 4).forEach(function (v, vi) {
          cmp.appendChild(el('p', 'field-label', (vi === 0 ? '今の版' : '前の版 ' + vi) + '｜' + stamp(v.at) + '｜' + (v.label || '') + '｜不合格 ' + v.ng + '・注意 ' + v.warn));
          var row = el('div', 'cq-thumbs');
          v.thumbs.slice(0, 4).forEach(function (t) { var im = el('img'); im.src = t; im.alt = ''; row.appendChild(im); });
          cmp.appendChild(row);
        });
      });
    }));
    box.appendChild(cmp);
    return box;
  }

  // ---- 詳細 ----
  function detail(set) {
    var wrap = el('div');
    wrap.appendChild(btn('← 投稿セット一覧', 'status-btn', function () { openId = ''; paint(); ensureStock(); }));

    // A. 企画
    var a = el('div', 'card');
    a.appendChild(el('p', 'field-label', (set.patternLabel || '') + '｜' + (D.STATUS[set.status] || '')));
    a.appendChild(el('h3', 'cand-name', set.titleEdit || set.title));
    var dl = el('dl', 'radar-facts');
    [['誰向け', set.target], ['この企画を選んだ理由', set.reason], ['伝えたい魅力', set.appeal]].forEach(function (x) { if (x[1]) { dl.appendChild(el('dt', null, x[0])); dl.appendChild(el('dd', null, x[1])); } });
    a.appendChild(dl);
    if (set.improveNote) a.appendChild(el('p', 'hint', set.improveNote));
    if (altBusy[set.id]) a.appendChild(el('p', 'hint pitch-busy', altBusy[set.id] + '…'));
    if (copyBusy[set.id]) a.appendChild(el('p', 'hint pitch-busy', '今の商品一覧で、表紙・商品カード・キャプションを作り直しています…'));
    if (!set.copy && set.copyError && !copyBusy[set.id]) { a.appendChild(el('p', 'hint pitch-warn', '文章を作れませんでした：' + set.copyError)); a.appendChild(btn('文章を作り直す', 'status-btn', function () { remakeCopy(set.id); })); }
    var iss = issuesOf(set);
    a.appendChild(el('p', iss.length ? 'hint pitch-warn' : 'hint', iss.length ? '品質確認：' + iss.join('／') : '品質確認：問題なし（商品の実在・価格・楽天のURL・画像・表現を確認済み）'));
    wrap.appendChild(a);

    // B. 掲載商品一覧（画像付き）
    var b = el('div', 'card');
    b.appendChild(el('p', 'field-label', '掲載する商品（' + set.items.length + '点）'));
    var nAd = set.items.filter(isAdopted).length;
    var nBy = set.items.filter(function (it) { return it.source === 'buyer'; }).length;
    b.appendChild(el('p', 'hint', '社長が採用した商品 ' + nAd + '点' + (nBy ? '・バイヤーAIの合格候補 ' + nBy + '点' : '') + '・AIの新規提案 ' + (set.items.length - nAd - nBy) + '点' + (set.adoptedMissing && set.adoptedMissing.length ? '｜楽天で見つからず外した採用商品：' + set.adoptedMissing.map(cleanName).join('、') : '')));
    var missingBase = baseMissing(set);
    if (missingBase && targetSets().some(function (x) { return x.id === set.id; })) {
      var mb = el('div', 'add-panel');
      mb.appendChild(el('p', 'hint pitch-warn', 'この投稿は「' + cleanName(missingBase.name).slice(0, 30) + '」から広げた商品ですが、起点の商品が入っていません。'));
      mb.appendChild(btn(set.items.length >= MAX_SET_ITEMS ? '起点の商品を入れる（' + MAX_SET_ITEMS + '点で上限。先に1点減らしてください）' : '起点の商品を1枚目に入れる', 'btn btn-primary co-sbtn', function () {
        var r = addItems(set.id, [missingBase], '起点', { first: true });
        K.showToast(r.added ? '起点の商品を1枚目に入れました。表紙・キャプションを作り直しています' : r.error);
        paint();
      }));
      b.appendChild(mb);
    }
    set.items.forEach(function (it, i) {
      var row = el('div', 'delivery-item');
      var top = el('div', 'cand-top');
      var im = el('img', 'cand-thumb'); im.src = it.image; im.alt = ''; im.loading = 'lazy'; top.appendChild(im);
      var info = el('div', 'cand-info');
      var chips = el('div', 'chips');
      chips.appendChild(el('span', 'role', (i + 1) + '. ' + it.role));
      chips.appendChild(sourceChip(it));
      info.appendChild(chips);
      info.appendChild(el('p', 'thief-cand-name', cleanName(it.name)));
      info.appendChild(el('p', 'cand-meta', K.formatPrice(it.price) + '（税込' + (it.postage ? '・' + it.postage : '') + (it.priceCheckedAt ? '｜' + stamp(it.priceCheckedAt) + ' 確認' : '') + '）' + (it.brand ? '｜' + it.brand : '')));
      if (it.priceNote) info.appendChild(el('p', 'hint pitch-warn', it.priceNote));
      if (it.adoptedReason) info.appendChild(el('p', 'hint', '社長の採用理由：' + it.adoptedReason));
      if (it.feature) info.appendChild(el('p', 'hint', '特徴：' + it.feature));
      if (it.why) info.appendChild(el('p', 'hint', '入れた理由：' + it.why));
      info.appendChild(el('p', 'hint', '公式：' + (it.officialUrl ? it.officialNote : it.officialNote || '未取得') + '｜確認：楽天の商品データ（商品名・価格・画像）'));
      top.appendChild(info);
      row.appendChild(top);
      // 楽天ROOMへの登録（紹介文・ハッシュタグ・コピー・ROOMを開く・登録した）
      var rst = R ? R.status(it, it) : 'none';
      var rk = set.id + ':' + i;
      var rb = btn('楽天ROOMに登録する｜' + ROOM_STATUS[rst], 'room-toggle room-' + rst + (roomOpen[rk] ? ' open' : ''), function () { roomOpen[rk] = !roomOpen[rk]; paint(); });
      row.appendChild(rb);
      if (roomOpen[rk]) row.appendChild(roomPanel(set, i, it));
      var acts = el('div', 'pitch-row');
      acts.appendChild(linkBtn('楽天の商品ページ', it.url));
      var alt = set.alt && set.alt.index === i ? set.alt : null;
      if (window.ExploreView) acts.appendChild(btn('この商品から広げる', 'status-btn', function () { window.ExploreView.open(it, 'set'); }));
      if (!alt) acts.appendChild(btn('この商品を差し替える', 'status-btn', function () { D.save(Object.assign({}, D.get(set.id), { alt: { index: i, code: it.code || '', state: 'asking', reason: '' } })); paint(); }));
      row.appendChild(acts);
      if (alt) row.appendChild(altPanel(set, i, alt));
      b.appendChild(row);
    });
    // 商品を追加する（採用済みでまだ使っていない商品・広げるで見つけた商品から）
    if (targetSets().some(function (x) { return x.id === set.id; })) b.appendChild(addPanel(set));
    b.appendChild(regenBox([set], 'この投稿セット'));
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
      if (out.check && window.CreativeCheck) c.insertBefore(qualityBox(set, out), dlRow);
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
    (set.captionEditHistory || []).slice(-2).reverse().forEach(function (h) {
      var kp = el('details', 'co-more');
      kp.appendChild(el('summary', null, '前に直したキャプションの控え（' + stamp(h.at) + '・' + h.reason + '）'));
      kp.appendChild(el('p', 'room-intro', h.text));
      kp.appendChild(btn('控えをコピー', 'status-btn co-sbtn', function () { K.copyText(h.text).then(function () { K.showToast('コピーしました'); }, function () {}); }));
      d.appendChild(kp);
    });
    if (!allRoom(set)) d.appendChild(el('p', 'hint', '楽天ROOMに全商品を登録するまでは、「紹介したものは楽天ROOMにまとめています」とは書きません。登録したら、各商品の「ROOMに登録した」を押すと文面と最後のスライドが切り替わります。'));
    d.appendChild(btn('キャプションをコピー', 'btn btn-secondary', function () { K.copyText(ta.value).then(function () { K.showToast('コピーしました'); }, function () {}); }));
    wrap.appendChild(d);

    // F. Instagramに公開した記録（社長が投稿したら投稿URLを残す。経営会議の「公開の確認」に使う）
    var f = el('div', 'card');
    f.appendChild(el('p', 'field-label', 'Instagramへの公開'));
    if (set.igPost && set.igPost.url) {
      f.appendChild(el('p', 'hint', stamp(set.igPost.at) + ' に公開（社長の記録）'));
      f.appendChild(linkBtn('投稿を開く', set.igPost.url));
    } else {
      f.appendChild(el('p', 'hint', 'まだ公開の記録がありません。投稿したら、投稿URLを記録してください（AI社員が反応を確認し、改善に使います）。'));
      f.appendChild(btn('Instagramに投稿した（URLを記録）', 'status-btn', function () {
        var u = (window.prompt('Instagramの投稿URL（https://www.instagram.com/p/…）', '') || '').trim();
        if (!/^https:\/\/(www\.)?instagram\.com\//.test(u)) { if (u) K.showToast('InstagramのURLを入れてください'); return; }
        var cur = D.get(set.id);
        cur.igPost = { url: u, at: new Date().toISOString() };
        D.save(cur);
        if (window.CompanyStore) window.CompanyStore.addActivity({ type: 'post', label: 'Instagramに投稿「' + (set.titleEdit || set.title) + '」', url: u, status: 'sent', by: 'owner', setId: set.id });
        K.showToast('公開を記録しました');
        paint();
      }));
    }
    wrap.appendChild(f);

    // E. 判断（採用・差し替え・修正・却下）
    var e = el('div', 'card');
    e.appendChild(el('p', 'field-label', '判断'));
    var row1 = el('div', 'pitch-actions');
    row1.appendChild(btn(set.status === 'adopted' ? '採用済み' : '採用する', 'btn btn-primary', function () { D.decide(set.id, 'adopted', ''); K.showToast('採用しました。画像を保存して投稿できます'); paint(); }));
    row1.appendChild(btn('デザインを変える', 'status-btn', function () {
      // 商品画像を小さく並べるだけの表紙（初心者セット・用途で選ぶ・買っとけ）は使わない
      var styles = (window.IgRender.COVER_STYLES || []).map(function (s) { return s.id; }).filter(function (id) { return ['new_release', 'starter_set', 'use_case', 'buy_this_first'].indexOf(id) === -1; });
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
    if (!container || !container.isConnected) return;
    container.innerHTML = '';
    var set = openId && D.get(openId);
    // 文章（表紙・キャプション）がまだないセットは、作る（再読み込みで途中になった分・裏で終わった分）
    var noCopy = D.all().filter(function (x) { return x.status !== 'rejected' && !x.copy && !x.copyError && !copyBusy[x.id] && !(x.alt && x.alt.state === 'searching'); })[0];
    if (noCopy && !busy && !Object.keys(copyBusy).length) setTimeout(function () { remakeCopy(noCopy.id); }, 0);
    if (set) { container.appendChild(detail(set)); return; }
    container.appendChild(el('p', 'editor-note', 'AI社員が企画を考え、実在の商品（3〜8点）・Instagram用の画像・キャプション・購入先までそろえた投稿セットです。開いて「採用」「差し替え・修正」「却下」を選ぶだけで大丈夫です。確認待ちが3件より少なくなると、AI社員が次を作ります。'));
    var sp = syncProblems(); if (sp) container.appendChild(sp);
    container.appendChild(adoptedSection());
    var liveSets = D.all().filter(function (x) { return x.status !== 'rejected'; });
    if (liveSets.length) container.appendChild(regenBox(liveSets, '確認待ち・採用の投稿セット（' + liveSets.length + '件）'));
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
    // サーバーの正本の状態で分ける：公開待ち（最大3件・社長に見せる）／控え（最大6件・公開待ちが空けば自動で繰り上がる）／期限切れ（消さない）
    var sv = function (x) { return x._server ? x._server.state : ''; };
    var tabs = [['new', '確認待ち（公開待ち）', function (x) { return x.status === 'new' && (!sv(x) || sv(x) === 'ready'); }], ['shelf', '控え（公開待ちが空けば自動で繰り上がります）', function (x) { return x.status === 'new' && sv(x) === 'shelf'; }], ['adopted', '採用', function (x) { return x.status === 'adopted'; }], ['rejected', '却下', function (x) { return x.status === 'rejected'; }], ['expired', '期限切れ（14日たった・控えの上限を超えた。消していません）', function (x) { return x.status === 'new' && sv(x) === 'expired'; }]];
    tabs.forEach(function (t) {
      var xs = list.filter(t[2]);
      if (!xs.length && t[0] !== 'new') return;
      container.appendChild(el('p', 'field-label', t[1] + '（' + xs.length + '）'));
      if (!xs.length) container.appendChild(el('p', 'manage-empty', busy ? '最初の投稿セットを作っています。' : 'まだありません。'));
      if (t[0] === 'shelf' || t[0] === 'expired') { var det = el('details'); det.appendChild(el('summary', null, '開いて見る（' + xs.length + '件）')); xs.forEach(function (x) { det.appendChild(card(x)); }); container.appendChild(det); }
      else xs.forEach(function (x) { container.appendChild(card(x)); });
    });
  }

  // 同期の問題（2026-11-14）：競合・移行の差異で採用されなかった、この端末の中身と、送れなかった変更。消さずに残し、社長が選んで戻せる
  function syncProblems() {
    var cs = D.conflicts ? D.conflicts() : [];
    var blocked = (D.outbox ? D.outbox() : []).filter(function (o) { return o.blocked; });
    var waiting = (D.outbox ? D.outbox() : []).filter(function (o) { return !o.blocked; });
    if (!cs.length && !blocked.length && !(D.lastError) && !waiting.some(function (o) { return o.retry; })) return null;
    var box = el('div', 'card sync-problems');
    box.appendChild(el('p', 'field-label', '同期の問題（データは消していません）'));
    if (D.lastError) box.appendChild(el('p', 'hint pitch-warn', D.lastError));
    var retrying = waiting.filter(function (o) { return o.retry; });
    if (retrying.length) box.appendChild(el('p', 'hint', 'サーバーに送れていない変更：' + retrying.length + '件（通信などの一時的な失敗。次に自動で送ります）'));
    blocked.forEach(function (o) {
      var x = D.get(o.id) || {};
      var row = el('div', 'pitch-row');
      row.appendChild(el('p', 'hint pitch-warn', '送れなかった変更：「' + String(x.title || o.id).slice(0, 24) + '」の' + ({ put: '中身の修正', import: '取り込み', decide: '判断' }[o.op] || o.op) + '（' + (o.blocked.error || o.blocked.status) + '）'));
      row.appendChild(btn('もう一度送る', 'status-btn', function () { window.ServerSync.retryOp(o).then(function () { paint(); }); }));
      row.appendChild(btn('送らない（端末の中身は残る）', 'status-btn', function () { window.ServerSync.dropOp(o); paint(); }));
      box.appendChild(row);
    });
    cs.forEach(function (c) {
      var row = el('div', 'pitch-row');
      var what = c.kind === 'decide' ? 'この端末の判断（' + (c.decision === 'approve' ? '採用' : '却下') + '）' : c.kind === 'migration' || c.kind === 'import' ? 'この端末の中身（移行のときの差異：' + (c.why || '') + '）' : 'この端末の修正';
      row.appendChild(el('p', 'hint', '「' + String((c.local && (c.local.titleEdit || c.local.title)) || c.id).slice(0, 24) + '」：' + what + 'は、ほかの端末・サーバーの内容と競合したため採用されていません（' + stamp(c.at) + '）'));
      if (c.restoring) { row.appendChild(el('p', 'hint', 'この端末の中身をサーバーへ送っています（書き込みの成功を確かめるまで、この控えは残します）')); box.appendChild(row); return; }
      if (c.again) row.appendChild(el('p', 'hint pitch-warn', '前回の上書きは、ほかの端末がさらに変更していたため完了していません（' + c.again + '回目）'));
      if (c.kind !== 'decide') row.appendChild(btn('この端末の中身でサーバーを上書き', 'status-btn', function () { if (!window.confirm('この端末の中身で、サーバーの今の内容を上書きしますか？（サーバーの今の内容は、サーバーの控えに残ります）')) return; D.restoreConflict(c.at); window.ServerSync.syncData().then(function () { paint(); }); }));
      row.appendChild(btn('サーバーの内容のままにする', 'status-btn', function () { D.removeConflict(c.at); paint(); }));
      box.appendChild(row);
    });
    return box;
  }

  function render(target) {
    container = target;
    paint();
    ensureStock();
  }

  // 「広げる」で採用した商品から、投稿セットを作る（これで投稿する！）。採用の順に並べ、商品の情報（商品番号・名前・価格・URL・画像）を引き継ぐ。
  // 表紙・商品カードの文字とキャプションは既存の仕組み（api/instagram）で作り、ROOM紹介文は投稿セットの各商品から作れる。Instagramへの公開は社長が行う
  var MAX_SET_ITEMS = 8; // 表紙＋商品＋最後のスライドで10枚まで（Instagramのカルーセルの上限に収める）
  // 採用済み・広げるで見つけた商品を、投稿セットの商品の形にする（商品番号・名前・価格・URL・画像を引き継ぐ）
  var BASE_ROLE = '起点（ここから広げた）';
  function toSetItem(it, i, role, source) {
    return { role: role || it.role || it.themeTitle || it.axisLabel || '採用' + (i + 1), name: it.name, brand: it.brand || '', price: it.price, postage: it.postage || '', url: it.url, code: it.code || '', image: it.image || '', shop: it.shop || '', caption: it.caption || '',
      feature: it.feature || it.value || '', why: source === 'base' ? '広げる前の、もとの商品' : it.relation || it.value || it.reason || '', source: source || 'adopted', adoptedKey: it.key || it.code || '', adoptOrder: i + 1, priceCheckedAt: it.checkedAt || '', priceNote: it.checkedAt ? '' : '価格は見つけたときのもの（投稿前に楽天で確認してください）', room: 'unregistered',
      officialUrl: '', officialNote: 'メーカー公式の商品ページは未取得' };
  }
  function sameItem(a, b) { return a.code && a.code === b.code || a.url && a.url === b.url || cleanName(a.name) === cleanName(b.name); }
  // 商品を追加できる投稿セット（却下・改善版に置き換えた元・公開済みは除く）
  function targetSets() { return D.all().filter(function (x) { return x.status !== 'rejected' && !x.supersededBy && !(x.igPost && x.igPost.url); }); }
  // 今ある投稿セットに商品を足す（同じ商品は足さない・8点まで）。表紙・商品カードの文字とキャプションを、今の商品で作り直す
  // opts.first：先頭に入れる（広げるの起点の商品は1枚目に）
  function addItems(setId, items, from, opts) {
    var cur = D.get(setId);
    if (!cur) return { added: 0, error: '投稿セットが見つかりません' };
    var room = MAX_SET_ITEMS - cur.items.length;
    var fresh = (items || []).filter(function (it, i, arr) { return it && it.name && !cur.items.some(function (x) { return sameItem(x, it); }) && arr.findIndex(function (y) { return y && sameItem(y, it); }) === i; });
    var dup = (items || []).length - fresh.length;
    if (room <= 0) return { added: 0, dup: dup, error: 'この投稿セットは' + MAX_SET_ITEMS + '点で上限です（Instagramは1投稿10枚まで）' };
    var first = !!(opts && opts.first);
    var add = fresh.slice(0, room).map(function (it, i) { return first ? toSetItem(it, i, BASE_ROLE, 'base') : toSetItem(it, cur.items.length + i, it.themeTitle || '追加'); });
    if (!add.length) return { added: 0, dup: dup, error: dup ? 'すでにこの投稿セットに入っています' : '追加できる商品がありません' };
    // 社長が手で直したキャプションは消さずに控えに残す（新しい商品に合わせたキャプションは作り直す）
    var kept = (cur.captionEditHistory || []).concat(cur.captionEdit ? [{ text: cur.captionEdit, at: new Date().toISOString(), reason: '商品の追加の前' }] : []).slice(-5);
    var next = Object.assign({}, cur, { items: first ? add.concat(cur.items) : cur.items.concat(add), copy: null, copyAt: '', captionEdit: '', captionEditHistory: kept, alt: null });
    next.issues = localQuality(next);
    D.save(next);
    D.decide(setId, null, '商品の追加：' + add.map(function (x) { return cleanName(x.name).slice(0, 20); }).join('、') + (from ? '（' + from + 'から）' : ''), 'revise');
    remakeCopy(setId);
    return { added: add.length, dup: dup, over: fresh.length - add.length };
  }

  // 広げるから作った投稿セットで、起点の商品が入っていないとき、その商品を返す（前に作った投稿セットの直し用）
  function baseMissing(set) {
    if (set.from !== 'explore' && set.pattern !== 'discovery') return null;
    if (set.items.some(function (x) { return x.source === 'base'; })) return null;
    var X = window.ExploreStore;
    var cands = [];
    (set.base || []).forEach(function (b) { cands.push(b); });
    var m = String(set.reason || '').match(/^「(.+?)」から広げて/);
    if (X && m) X.roots().forEach(function (n) { [n].concat(X.children(n.id)).forEach(function (c) { if (cleanName(c.product.name).slice(0, 20) === m[1]) cands.push(c.product); }); });
    var hit = cands.filter(function (p) { return p && p.name && !set.items.some(function (x) { return sameItem(x, p); }); })[0];
    if (hit && !hit.url && X) { /* set.base に名前しかないときは、広げるの記録から商品を探す */
      X.roots().forEach(function (n) { [n].concat(X.children(n.id)).forEach(function (c) { if (!hit.url && sameItem(c.product, hit)) hit = c.product; }); });
    }
    return hit || null;
  }
  // opts.base：広げるの起点の商品（1枚目に入れる。起点がないと、何から広げた投稿か分からないため）
  function createFromItems(opts) {
    var bases = (opts.base || []).filter(function (b, i, arr) { return b && b.name && arr.findIndex(function (y) { return y && sameItem(y, b); }) === i; });
    var rest = (opts.items || []).filter(function (it) { return !bases.some(function (b) { return sameItem(b, it); }); });
    var list = bases.concat(rest).slice(0, MAX_SET_ITEMS);
    var now = new Date().toISOString();
    var set = {
      id: 'set-' + Date.now().toString(36), createdAt: now, status: 'new', from: 'explore',
      pattern: 'discovery', patternLabel: '広げた商品から（社長が採用）', title: String(opts.title || '').slice(0, 30) || '見つけた商品' + list.length + '選',
      target: opts.target || '', reason: opts.reason || '「この商品から広げる」で社長が採用した商品から作成', appeal: opts.appeal || '',
      slots: [], adoptedOffered: (opts.items || []).length,
      items: list.map(function (it, i) { return i < bases.length ? toSetItem(it, i, BASE_ROLE, 'base') : toSetItem(it, i); }),
      base: bases.map(function (b) { return { code: b.code || '', name: b.name }; })
    };
    set.issues = localQuality(set);
    D.save(set);
    openId = set.id;
    return finishCopy(Object.assign({}, set)).then(function (done) {
      D.save(Object.assign({}, D.get(set.id), { copy: done.copy, copyAt: done.copyAt || '', copyError: done.copy ? '' : done.copyError || '' }));
      paint();
      return D.get(set.id);
    });
  }
  function openSet(id) { openId = id; paint(); }

  // 改善案の比較用：投稿セットに見出し・表紙の型・写真の有無を当てた試作の画像（表紙と1枚目の商品）を描く（保存はしない）
  function previewVariant(set, v) {
    var trial = Object.assign({}, set, { id: set.id + '-trial-' + (v.key || v.title), titleEdit: v.title, coverStyle: v.coverStyle || set.coverStyle, noPhoto: v.photo === false });
    return slidesOf(trial).then(function (out) { return { urls: out.urls.slice(0, 2), files: out.files }; });
  }

  window.DeliveryView = { addItems: addItems, targetSets: targetSets, createFromItems: createFromItems, openSet: openSet, MAX_SET_ITEMS: MAX_SET_ITEMS, previewVariant: previewVariant, issuesOf: issuesOf, render: render, onJobDone: onJobDone, adopted: adoptedAll };
})();
