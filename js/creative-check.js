// C0（2026-11-13）：投稿画像の客観的な品質確認（AIなし・費用0円）と、修正前後の版の保存（このiPhoneのブラウザ内・IndexedDB）。
// 描画エンジン（js/ig-render.js）が記録した「どこに・どの大きさで・どの色で文字や画像を描いたか」（canvas.__ops）と、描いた画像の画素から確かめる。
//   はみ出し・端の余白／文字の大きさ／文字と背景の濃さの差（コントラスト）／途中で切れた文字（…）／商品写真が投稿の商品と一致するか／PR表記／素材の権利の状態
// ここでの結果は「コードで測った事実」。AIの見た目の評価（C1）とは別に記録・表示する。
(function () {
  'use strict';

  var SAFE = 40;          // 端から40px（1080pxの約4%）は文字を置かない
  var MIN_NG = 22;        // これより小さい文字は不合格（スマホで読めない）
  var MIN_WARN = 28;      // これより小さい文字は注意
  var THUMB = 270;        // 保存する縮小画像の幅

  // ---- 色 ----
  function parseColor(s) {
    s = String(s || '').trim();
    var m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) { var h = m[1].length === 3 ? m[1].split('').map(function (c) { return c + c; }).join('') : m[1]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) { var p = m[1].split(',').map(function (x) { return parseFloat(x); }); if (p.length >= 4 && p[3] < 0.5) return null; return [p[0], p[1], p[2]]; }
    return null;
  }
  function lum(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function dist(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); }

  // 文字の外枠（textAlign と基準線から計算する）
  function boxOf(op) {
    var left = op.align === 'center' ? op.x - op.width / 2 : (op.align === 'right' || op.align === 'end') ? op.x - op.width : op.x;
    var top = op.baseline === 'top' ? op.y : op.baseline === 'middle' ? op.y - op.size * 0.5 : op.y - op.size * 0.85;
    return { x: left, y: top, w: op.width, h: op.size * 1.05 };
  }

  // 文字の背景の色：文字の外枠の中で、文字の色から遠い画素の中央値
  function backgroundOf(ctx, box, textColor, W, H) {
    var x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
    var w = Math.min(W - x, Math.ceil(box.w)), h = Math.min(H - y, Math.ceil(box.h));
    if (w < 2 || h < 2) return null;
    var d;
    try { d = ctx.getImageData(x, y, w, h).data; } catch (e) { return null; }
    var step = Math.max(1, Math.floor((w * h) / 4000));
    var rs = [], gs = [], bs = [];
    for (var i = 0; i < w * h; i += step) {
      var c = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
      if (dist(c, textColor) < 90) continue; // 文字そのものの画素は除く
      rs.push(c[0]); gs.push(c[1]); bs.push(c[2]);
    }
    if (rs.length < 10) return null;
    var med = function (a) { a.sort(function (p, q) { return p - q; }); return a[Math.floor(a.length / 2)]; };
    return [med(rs), med(gs), med(bs)];
  }

  // 1枚の確認
  function checkCanvas(canvas, opts) {
    var W = canvas.width, H = canvas.height;
    var ops = canvas.__ops || [];
    var ctx = canvas.getContext('2d');
    var issues = [];
    var add = function (level, key, msg) { issues.push({ level: level, key: key, msg: msg }); };
    var texts = ops.filter(function (o) { return o.t === 'text' && String(o.text).trim(); });
    var minSize = Infinity;
    texts.forEach(function (o) {
      var b = boxOf(o);
      var short = String(o.text).slice(0, 14);
      if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) add('ng', 'overflow', '文字が画像の外にはみ出している：「' + short + '」');
      else if (b.x < SAFE || b.x + b.w > W - SAFE || b.y < SAFE * 0.5 || b.y + b.h > H - SAFE * 0.5) add('warn', 'margin', '文字が端に近すぎる（余白' + SAFE + 'px未満）：「' + short + '」');
      if (o.size && o.size < minSize) minSize = o.size;
      if (o.size && o.size < MIN_NG) add('ng', 'size', '文字が小さすぎる（' + o.size + 'px）：「' + short + '」');
      else if (o.size && o.size < MIN_WARN) add('warn', 'size', '文字が小さめ（' + o.size + 'px）：「' + short + '」');
      if (/…$/.test(o.text)) add('warn', 'cut', '文字が途中で切れている（…）：「' + short + '」');
      var tc = parseColor(o.fill);
      if (tc) {
        var bg = backgroundOf(ctx, b, tc, W, H);
        if (bg) {
          var r = contrast(tc, bg);
          var large = o.size >= 48 || (o.size >= 37 && o.weight >= 700);
          var need = large ? 3 : 4.5;
          o.contrast = Math.round(r * 10) / 10;
          if (r < 3) add('ng', 'contrast', '文字と背景の濃さの差が小さく読みにくい（' + o.contrast + '：1）：「' + short + '」');
          else if (r < need) add('warn', 'contrast', '文字と背景の濃さの差がやや小さい（' + o.contrast + '：1、目安' + need + '：1以上）：「' + short + '」');
        }
      }
    });
    // 商品写真：この画像に載るはずの商品の写真が、描かれているか（ほかの商品の写真になっていないか）
    var imgs = ops.filter(function (o) { return o.t === 'img'; });
    var itemTags = imgs.map(function (o) { return o.tag; }).filter(function (t) { return /^item:/.test(t); });
    (opts.expectItems || []).forEach(function (i) {
      if (opts.noPhoto) return;
      var want = 'item:' + i + ':';
      if (!itemTags.some(function (t) { return t.indexOf(want) === 0; })) add(opts.missingPhoto && opts.missingPhoto[i] ? 'warn' : 'ng', 'photo', (i + 1) + '番目の商品の写真が描かれていない' + (opts.missingPhoto && opts.missingPhoto[i] ? '（写真を読み込めなかった）' : ''));
    });
    itemTags.forEach(function (t) {
      var i = Number(t.split(':')[1]);
      if ((opts.expectItems || []).length && opts.expectItems.indexOf(i) === -1 && !opts.cover) add('ng', 'photo_mismatch', 'この画像の商品ではない写真（' + (i + 1) + '番目の商品）が描かれている');
    });
    imgs.forEach(function (o) { if (o.x + o.w < 0 || o.y + o.h < 0 || o.x > W || o.y > H) add('warn', 'image_out', '画像が画面の外に置かれている'); });
    if (opts.bearExpected && !imgs.some(function (o) { return o.tag === 'bear'; })) add('warn', 'bear', 'サングラスくまの画像が描かれていない（読み込めなかった可能性）');
    return { issues: issues, texts: texts.length, minSize: minSize === Infinity ? null : minSize };
  }

  // 投稿1つ分の確認。slides: renderPost の結果（canvas と items）。set: 投稿セット
  function checkPost(slides, set, extra) {
    extra = extra || {};
    var out = [];
    slides.forEach(function (s, i) {
      var r = checkCanvas(s.canvas, { expectItems: s.items || [], noPhoto: !!set.noPhoto, missingPhoto: extra.missingPhoto, cover: i === 0, bearExpected: extra.bearLoaded });
      out.push({ file: s.fileName, issues: r.issues, minSize: r.minSize });
    });
    var post = postChecks(set);
    var ng = post.filter(function (x) { return x.level === 'ng'; }).length + out.reduce(function (a, s) { return a + s.issues.filter(function (x) { return x.level === 'ng'; }).length; }, 0);
    var warn = post.filter(function (x) { return x.level === 'warn'; }).length + out.reduce(function (a, s) { return a + s.issues.filter(function (x) { return x.level === 'warn'; }).length; }, 0);
    return { at: new Date().toISOString(), slides: out, post: post, ng: ng, warn: warn, ok: ng === 0 };
  }

  // 投稿全体の確認（キャプションのPR表記・素材の権利）。キャプションは画面で直せるので、表示のたびに確かめ直す
  function postChecks(set) {
    var post = [];
    var caption = String(set.captionEdit || (set.copy && set.copy.caption) || '');
    var first = caption.split('\n')[0];
    if (!caption) post.push({ level: 'warn', key: 'caption', msg: 'キャプションがまだない（PR表記を確認できない）' });
    else if (!/【PR】|楽天アフィリエイトを利用/.test(caption)) post.push({ level: 'ng', key: 'pr', msg: 'キャプションにPR表記（【PR】楽天アフィリエイトを利用しています）がない' });
    else if (!/【PR】/.test(first)) post.push({ level: 'warn', key: 'pr_first', msg: 'PR表記がキャプションの1行目にない' });
    if (!set.noPhoto && !set.imageRightsOk) post.push({ level: 'ng', key: 'rights', msg: '楽天の商品画像を使っている（Instagramでの利用条件が未確認）。このまま投稿しない／商品写真なしの版にする' });
    return post;
  }

  // 縮小画像（修正前後の比較用）
  function thumb(canvas) {
    var c = document.createElement('canvas');
    c.width = THUMB; c.height = Math.round(canvas.height * THUMB / canvas.width);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    try { return c.toDataURL('image/jpeg', 0.72); } catch (e) { return ''; }
  }

  // ---- 版の保存（IndexedDB：room-creative。投稿セットごとに最新8版まで。既存のデータには触れない） ----
  var DB = 'room-creative', STORE = 'versions', KEEP = 8;
  function open() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(null);
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { var db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('setId', 'setId'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
  }
  function versions(setId) {
    return open().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        var out = [];
        var req = db.transaction(STORE).objectStore(STORE).index('setId').openCursor(IDBKeyRange.only(setId));
        req.onsuccess = function () { var c = req.result; if (c) { out.push(c.value); c.continue(); } else resolve(out.sort(function (a, b) { return b.at < a.at ? -1 : 1; })); };
        req.onerror = function () { resolve(out); };
      });
    });
  }
  // 同じ描き方（key）の版がすでにあれば保存しない
  function saveVersion(setId, key, slides, check, label) {
    return versions(setId).then(function (list) {
      if (list.some(function (v) { return v.key === key; })) return null;
      return open().then(function (db) {
        if (!db) return null;
        var v = { id: setId + ':' + Date.now().toString(36), setId: setId, key: key, at: new Date().toISOString(), label: label || '', thumbs: slides.map(function (s) { return thumb(s.canvas); }), ng: check.ng, warn: check.warn, check: check };
        return new Promise(function (resolve) {
          var tx = db.transaction(STORE, 'readwrite');
          var st = tx.objectStore(STORE);
          st.put(v);
          list.slice(KEEP - 1).forEach(function (old) { st.delete(old.id); }); // 古い版から消す（この新しい保存先の中だけ）
          tx.oncomplete = function () { resolve(v); };
          tx.onerror = function () { resolve(null); };
        });
      });
    });
  }

  window.CreativeCheck = { checkCanvas: checkCanvas, checkPost: checkPost, postChecks: postChecks, contrast: contrast, parseColor: parseColor, thumb: thumb, versions: versions, saveVersion: saveVersion, SAFE: SAFE, MIN_NG: MIN_NG, MIN_WARN: MIN_WARN };
})();
