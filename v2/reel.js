// サングラスくま株式会社 2.0：リール（縦型動画・10〜20秒）を、この端末の中で作る（2026-11-18 社長の依頼：集客を制作と同じくらい重要に）
//   完成品の商品写真・価格・短い名前・特徴を使う。AIは呼ばない（費用0円）。画像の作り話をしない（文字は商品データと完成品の文章だけ）
//   3つの形式：reveal（用途を途中で明かす）／compare（高価格帯と低価格帯：同じ用途の2点があるときだけ）／top3（3選）
//   作り：canvas に描いて MediaRecorder で録る（iPhone の Safari は mp4、ほかは対応する形式）。保存は共有シート（「ビデオを保存」）
(function () {
  'use strict';
  var W = 720, H = 1280, FPS = 30;
  var C = { bg: '#f6f1e7', ink: '#2b2620', sub: '#6d6255', accent: '#b5432c', gold: '#c49a00', white: '#fffdf8' };
  var FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
  function font(px, w) { return (w || 800) + ' ' + px + 'px ' + FONT; }
  function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }
  function ease(t) { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); }
  function wrap(ctx, text, maxW) {
    var out = [], line = '';
    String(text || '').split('').forEach(function (ch) { if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch; });
    if (line) out.push(line);
    return out;
  }
  function textBlock(ctx, text, x, y, maxW, px, color, align, maxLines) {
    ctx.font = font(px); ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'top';
    var lines = wrap(ctx, text, maxW).slice(0, maxLines || 3);
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * px * 1.3); });
    return y + lines.length * px * 1.3;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  // 商品写真を枠に収めて描く（scale：寄り、pixel：モザイクの粗さ。用途を隠すとき）
  var tmp = document.createElement('canvas');
  function drawImg(ctx, img, x, y, w, h, scale, pixel) {
    if (!img) { ctx.fillStyle = '#e7dfd2'; roundRect(ctx, x, y, w, h, 28); ctx.fill(); return; }
    ctx.save(); roundRect(ctx, x, y, w, h, 28); ctx.clip(); ctx.fillStyle = C.white; ctx.fillRect(x, y, w, h);
    var k = Math.min(w / img.width, h / img.height) * (scale || 1);
    var dw = img.width * k, dh = img.height * k, dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
    if (pixel && pixel > 1) {
      var sw = Math.max(4, Math.round(dw / pixel)), sh = Math.max(4, Math.round(dh / pixel));
      tmp.width = sw; tmp.height = sh; var t = tmp.getContext('2d'); t.imageSmoothingEnabled = true; t.drawImage(img, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(tmp, dx, dy, dw, dh); ctx.imageSmoothingEnabled = true;
    } else ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }
  function priceTag(ctx, price, x, y, p) {
    var s = ease(p); ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-0.06);
    ctx.font = font(54); var label = yen(price); var w = ctx.measureText(label).width + 56;
    ctx.fillStyle = C.accent; roundRect(ctx, -w / 2, -44, w, 88, 44); ctx.fill();
    ctx.fillStyle = C.white; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, 2);
    ctx.font = font(20, 600); ctx.fillStyle = C.sub; ctx.fillText('税込・確認した時点の価格', 0, 70);
    ctx.restore();
  }
  // 共通：上の進み具合のバー（最後まで見たくなる）・右上のPR表記・下のアカウント名
  function frame(ctx, t, total) {
    ctx.fillStyle = 'rgba(43,38,32,0.15)'; ctx.fillRect(40, 40, W - 80, 8);
    ctx.fillStyle = C.accent; ctx.fillRect(40, 40, (W - 80) * Math.min(1, t / total), 8);
    ctx.font = font(22, 700); ctx.fillStyle = C.sub; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('PR', W - 40, 64);
    ctx.textAlign = 'left'; ctx.fillText('@gla_san_kuma_', 40, 64);
  }
  function cta(ctx, p, bear) {
    ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
    var y = 380 + (1 - ease(p)) * 60;
    textBlock(ctx, '紹介した商品は', W / 2, y, W - 120, 52, C.white);
    textBlock(ctx, 'プロフィールの楽天ROOMに', W / 2, y + 80, W - 120, 52, C.white);
    textBlock(ctx, 'まとめています', W / 2, y + 160, W - 120, 52, C.white);
    textBlock(ctx, '保存しておくと、あとで見返せます', W / 2, y + 280, W - 120, 30, '#d9cbb3');
    if (bear) { var s = 260; ctx.save(); ctx.beginPath(); ctx.arc(W / 2, 1010, s / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(bear, W / 2 - s / 2, 1010 - s / 2, s, s); ctx.restore(); }
  }
  // ---- 形式ごとの場面（dur：秒、draw(ctx, p 0〜1)）----
  function scenesReveal(s, img, hooks) {
    var it = s.products[0];
    var hook = (hooks && hooks.reveal) || 'これ、何に使うと思う？';
    return [
      { dur: 3, draw: function (ctx, p) { bg(ctx); textBlock(ctx, hook, W / 2, 160, W - 100, 66, C.ink, 'center', 2); drawImg(ctx, img, 90, 420, W - 180, W - 180, 2.2 - p * 0.3, 18 - p * 4); } },
      { dur: 3, draw: function (ctx, p) { bg(ctx); textBlock(ctx, 'ヒント', W / 2, 160, W - 100, 44, C.accent); textBlock(ctx, it.subline || it.memo || '毎日の小さな手間に', W / 2, 230, W - 120, 46, C.ink, 'center', 2); drawImg(ctx, img, 90, 420, W - 180, W - 180, 1.9 - p * 0.8, 12 - p * 10); } },
      { dur: 4, draw: function (ctx, p) { bg(ctx); textBlock(ctx, '答えは…', W / 2, 140, W - 100, 44, C.accent); textBlock(ctx, it.shortName || it.short || it.name, W / 2, 210, W - 100, 60, C.ink, 'center', 2); drawImg(ctx, img, 90, 420, W - 180, W - 180, 1.1 - ease(p) * 0.1, 0); } },
      { dur: 3.5, draw: function (ctx, p) { bg(ctx); drawImg(ctx, img, 90, 220, W - 180, W - 180, 1, 0); priceTag(ctx, it.price, W / 2, 870, p * 2); if (it.memo) textBlock(ctx, it.memo, W / 2, 990, W - 120, 36, C.ink, 'center', 2); } }
    ];
  }
  function comparePair(s) {
    var ps = s.products || [];
    var hi = ps.find(function (p) { return /高価格帯/.test(p.curatedRole || p.role || ''); }), lo = ps.find(function (p) { return /低価格帯/.test(p.curatedRole || p.role || ''); });
    if (hi && lo && hi.use && hi.use === lo.use) return { hi: hi, lo: lo };
    return null; // 同じ用途の2点が無いときは、価格だけで違う物を比べない
  }
  function scenesCompare(s, imgs, hooks) {
    var pr = comparePair(s); var ps = s.products;
    var hi = pr.hi, lo = pr.lo, ih = imgs[ps.indexOf(hi)], il = imgs[ps.indexOf(lo)];
    var hook = (hooks && hooks.compare) || (yen(hi.price) + ' と ' + yen(lo.price) + '　違いはどこ？');
    function side(ctx, img, p, x, label, it) { drawImg(ctx, img, x, 360, 300, 300, 1, 0); textBlock(ctx, label, x + 150, 690, 300, 30, C.accent); textBlock(ctx, yen(it.price), x + 150, 735, 300, 44, C.ink); }
    return [
      { dur: 3, draw: function (ctx, p) { bg(ctx); textBlock(ctx, hook, W / 2, 160, W - 100, 56, C.ink, 'center', 2); ctx.globalAlpha = ease(p * 1.5); side(ctx, ih, p, 45, '高い方', hi); side(ctx, il, p, 375, '安い方', lo); ctx.globalAlpha = 1; textBlock(ctx, 'VS', W / 2, 480, 120, 56, C.accent); } },
      { dur: 4, draw: function (ctx, p) { bg(ctx); textBlock(ctx, '高い方：' + yen(hi.price), W / 2, 150, W - 100, 46, C.accent); drawImg(ctx, ih, 110, 250, W - 220, W - 220, 1 + p * 0.05, 0); textBlock(ctx, hi.shortName || hi.short, W / 2, 790, W - 100, 44, C.ink, 'center', 2); textBlock(ctx, hi.diff || hi.subline || '', W / 2, 900, W - 120, 34, C.sub, 'center', 3); } },
      { dur: 4, draw: function (ctx, p) { bg(ctx); textBlock(ctx, '安い方：' + yen(lo.price), W / 2, 150, W - 100, 46, C.accent); drawImg(ctx, il, 110, 250, W - 220, W - 220, 1 + p * 0.05, 0); textBlock(ctx, lo.shortName || lo.short, W / 2, 790, W - 100, 44, C.ink, 'center', 2); textBlock(ctx, lo.diff || lo.subline || '', W / 2, 900, W - 120, 34, C.sub, 'center', 3); } },
      { dur: 3, draw: function (ctx, p) { bg(ctx); textBlock(ctx, 'あなたならどっち？', W / 2, 300, W - 100, 60, C.ink); textBlock(ctx, '違いは各商品ページで確かめてから選んでください', W / 2, 460, W - 140, 32, C.sub, 'center', 3); } }
    ];
  }
  function scenesTop3(s, imgs, hooks) {
    var ps = s.products.slice(0, 3);
    var topic = (s.slides && s.slides.topic) || s.title;
    var hook = (hooks && hooks.top3) || (String(topic).slice(0, 18) + '　迷ったらこの3つ');
    var list = [{ dur: 2.5, draw: function (ctx, p) { bg(ctx); textBlock(ctx, hook, W / 2, 380 - ease(p) * 40, W - 100, 64, C.ink, 'center', 3); textBlock(ctx, '最後に一番の推しを紹介', W / 2, 700, W - 100, 32, C.accent); } }];
    // 3位→2位→1位（最後まで見たくなる順）
    [2, 1, 0].forEach(function (i) {
      var it = ps[i]; if (!it) return;
      list.push({ dur: 3.5, draw: function (ctx, p) { bg(ctx); ctx.font = font(120); ctx.fillStyle = C.gold; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(String(i + 1), 50, 110); drawImg(ctx, imgs[i], 90 + (1 - ease(p * 2)) * 300, 300, W - 180, W - 180, 1, 0); textBlock(ctx, it.shortName || it.short, W / 2, 870, W - 100, 46, C.ink, 'center', 2); priceTag(ctx, it.price, W / 2, 1050, p * 2); } });
    });
    return list;
  }
  function bg(ctx) { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); }
  function formats(s) {
    var out = [{ id: 'reveal', label: '用途を途中で明かす', ok: (s.products || []).length >= 1 }, { id: 'top3', label: '3選', ok: (s.products || []).length >= 3 }];
    var pr = comparePair(s);
    out.splice(1, 0, { id: 'compare', label: '高価格帯と低価格帯の比較', ok: !!pr, why: pr ? '' : '同じ用途の高い物と安い物の組が無い（違う物を価格だけで比べない）' });
    return out;
  }
  function pickMime() {
    var c = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    for (var i = 0; i < c.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i];
    return '';
  }
  // 作る：完成品（/api/v2 の set）と形式 → { blob, url, name, mime, seconds }
  function make(s, formatId, loadImage, onProgress) {
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!canvas.captureStream || !window.MediaRecorder) return Promise.reject(new Error('この端末のブラウザでは動画を作れません（iPhoneはiOS 15以降のSafariで作れます）'));
    var mime = pickMime(); if (!mime) return Promise.reject(new Error('この端末のブラウザで使える動画の形式がありません'));
    return Promise.all([Promise.all((s.products || []).map(function (p) { return loadImage(p.image); })), loadImage('../assets/kuma.png')]).then(function (r) {
      var imgs = r[0], bear = r[1], hooks = s.hooks || null;
      var sc = formatId === 'compare' ? scenesCompare(s, imgs, hooks) : formatId === 'top3' ? scenesTop3(s, imgs, hooks) : scenesReveal(s, imgs[0], hooks);
      sc.push({ dur: 3, draw: function (c, p) { cta(c, p, bear); } });
      var total = sc.reduce(function (a, x) { return a + x.dur; }, 0);
      var stream = canvas.captureStream(FPS);
      var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 });
      var chunks = []; rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      return new Promise(function (resolve, reject) {
        rec.onstop = function () { var blob = new Blob(chunks, { type: mime.split(';')[0] }); resolve({ blob: blob, url: URL.createObjectURL(blob), mime: mime.split(';')[0], name: 'reel_' + formatId + (mime.indexOf('mp4') >= 0 ? '.mp4' : '.webm'), seconds: total }); };
        rec.onerror = function (e) { reject(e.error || new Error('録画に失敗しました')); };
        var t0 = null;
        function tick(now) {
          if (t0 == null) t0 = now;
          var t = (now - t0) / 1000;
          if (t >= total) { rec.stop(); return; }
          var acc = 0; for (var i = 0; i < sc.length; i++) { if (t < acc + sc[i].dur) { sc[i].draw(ctx, (t - acc) / sc[i].dur); break; } acc += sc[i].dur; }
          if (t < total - 3) frame(ctx, t, total - 3);
          if (onProgress) onProgress(Math.min(1, t / total));
          requestAnimationFrame(tick);
        }
        rec.start(250); requestAnimationFrame(tick);
      });
    });
  }
  // リール用のキャプション（冒頭の一言＋完成品のキャプション（PR表記・ハッシュタグ入り））
  function caption(s, formatId) {
    var h = (s.hooks && (s.hooks.caption || s.hooks[formatId])) || '';
    return (h ? h + '\n\n' : '') + (s.caption || '');
  }
  window.V2Reel = { make: make, formats: formats, caption: caption, comparePair: comparePair, SIZE: { W: W, H: H } };
})();
