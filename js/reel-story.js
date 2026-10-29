// Reel・Story の画像と動画を、カルーセルと同じ配色・固定のくまで作る（ブラウザのCanvas）。
// 文字（フック・テロップ・シーンの並び）はサーバー（/api/assets）で作り、ここでは固定のレイアウトで描くだけ。
//
// Story: 1080×1920 の3枚（興味を引く → 選び方を少し見せる → 投稿へ誘導）
// Reel : 1080×1920 のシーン（フック → 商品3〜5個 → 呼びかけ）。動きはフェード・スライド・軽いズームだけ
//        exportVideo で、ブラウザの録画機能（MediaRecorder）を使って動画（iPhoneはMP4）に書き出す
(function () {
  'use strict';

  var R = window.IgRender;
  var K = R.kit;
  var W = 1080;
  var H = 1920;
  var M = 90;
  // InstagramのUIと重なる上下端（ここには大事な文字を置かない）
  var SAFE_TOP = 260;
  var SAFE_BOTTOM = 400;
  var DEFAULT_PALETTE = { cardBg: '#ECE7E0', accent: '#9A8573', pill: '#7A7A7A' };
  var INK = '#1E1E1E';

  function f(size, weight) { return (weight || 400) + ' ' + Math.round(size) + 'px ' + K.FONT; }
  function paletteFor(style) { return (R.PALETTES && R.PALETTES[style]) || DEFAULT_PALETTE; }

  function newCanvas() {
    var c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  }

  // 中央そろえで、決めた行数に収まる大きさの文字を描く。戻り値は最後の行の下端
  function centerBlock(ctx, text, y, o) {
    var base = { size: o.size, minSize: o.minSize || 40, weight: o.weight || 800, maxWidth: o.maxWidth || W - M * 2 };
    // 大きな文字は、できるだけ2行に収める（3行に折ると「〜ばい／い？」のように切れやすい）
    var fit = K.fitText(ctx, text, Object.assign({}, base, { maxLines: Math.min(2, o.maxLines || 3), minSize: Math.max(base.minSize, Math.round(o.size * 0.62)) }));
    if (/…$/.test(fit.lines[fit.lines.length - 1]) && (o.maxLines || 3) > 2) fit = K.fitText(ctx, text, Object.assign({}, base, { maxLines: o.maxLines || 3 }));
    ctx.font = f(fit.size, o.weight || 800);
    ctx.fillStyle = o.color || INK;
    ctx.textAlign = 'center';
    var lh = fit.size * (o.lineHeight || 1.3);
    fit.lines.forEach(function (l, i) { ctx.fillText(l, W / 2, y + fit.size + i * lh); });
    ctx.textAlign = 'left';
    return y + fit.size + (fit.lines.length - 1) * lh + fit.size * 0.3;
  }

  function background(ctx, P) {
    ctx.fillStyle = P.cardBg;
    ctx.fillRect(0, 0, W, H);
  }

  function kicker(ctx, P, y) {
    ctx.font = f(40, 700);
    ctx.fillStyle = P.accent;
    ctx.textAlign = 'center';
    ctx.fillText(K.ACCOUNT.name + 'の', W / 2, y);
    ctx.textAlign = 'left';
    ctx.fillRect(W / 2 - 48, y + 26, 96, 6);
  }

  // 下の安全な範囲の上に、くま（右下）とアカウント名
  function bear(ctx, o, P) {
    var d = 200;
    var cx = W - M - d / 2;
    var cy = H - SAFE_BOTTOM - d / 2 - 10;
    K.drawBear(ctx, o.bear, cx, cy, d);
    ctx.font = f(32, 600);
    ctx.fillStyle = '#5F5F5F';
    ctx.fillText(K.ACCOUNT.handle, M, cy + 12);
  }

  // 商品画像を、白いカード（切り抜けた画像はそのまま）で横に並べる
  function productRow(ctx, imgs, box) {
    var list = (imgs || []).filter(Boolean).slice(0, box.max || 3);
    if (!list.length) return;
    var gap = 28;
    var cw = (box.w - gap * (list.length - 1)) / list.length;
    list.forEach(function (img, i) {
      var x = box.x + i * (cw + gap);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.14)';
      ctx.shadowBlur = 26;
      ctx.shadowOffsetY = 10;
      K.roundRect(ctx, x, box.y, cw, box.h, 24);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();
      K.drawContain(ctx, img, x + 18, box.y + 18, cw - 36, box.h - 36);
    });
  }

  // ---- Story（3枚） ----
  // story: { hook, hookSub, title, points[], text, sub }、o: { style, bear, images: [商品画像], count }
  function renderStory(story, o) {
    var P = paletteFor(o.style);
    var out = [];

    // 1枚目：興味を引く
    var c1 = newCanvas();
    var x1 = c1.getContext('2d');
    background(x1, P);
    kicker(x1, P, SAFE_TOP + 120);
    var y = centerBlock(x1, story.hook, SAFE_TOP + 260, { size: 110, minSize: 64, maxLines: 3 });
    if (story.hookSub) y = centerBlock(x1, story.hookSub, y + 40, { size: 48, minSize: 34, weight: 600, color: '#5F5F5F', maxLines: 2 });
    productRow(x1, o.images, { x: M, y: Math.min(y + 90, 1010), w: W - M * 2, h: 300 });
    bear(x1, o, P);
    out.push({ fileName: 'story_01.png', canvas: c1 });

    // 2枚目：選び方を少し見せる
    var c2 = newCanvas();
    var x2 = c2.getContext('2d');
    background(x2, P);
    kicker(x2, P, SAFE_TOP + 120);
    y = centerBlock(x2, story.title, SAFE_TOP + 230, { size: 76, minSize: 50, maxLines: 2 });
    var py = y + 70;
    story.points.forEach(function (p, i) {
      x2.save();
      K.roundRect(x2, M + 40, py, W - (M + 40) * 2, 150, 75);
      x2.fillStyle = '#FFFFFF';
      x2.fill();
      x2.restore();
      x2.beginPath();
      x2.arc(M + 40 + 75, py + 75, 46, 0, Math.PI * 2);
      x2.fillStyle = P.accent;
      x2.fill();
      x2.font = f(52, 800);
      x2.fillStyle = '#FFFFFF';
      x2.textAlign = 'center';
      x2.fillText(String(i + 1), M + 40 + 75, py + 94);
      x2.textAlign = 'left';
      var fit = K.fitText(x2, p, { size: 66, minSize: 40, weight: 800, maxWidth: W - (M + 40) * 2 - 200, maxLines: 1 });
      x2.font = f(fit.size, 800);
      x2.fillStyle = INK;
      x2.fillText(fit.lines[0], M + 40 + 170, py + 75 + fit.size * 0.36);
      py += 186;
    });
    bear(x2, o, P);
    out.push({ fileName: 'story_02.png', canvas: c2 });

    // 3枚目：投稿へ誘導（選んだ商品を小さく並べる）
    var c3 = newCanvas();
    var x3 = c3.getContext('2d');
    background(x3, P);
    kicker(x3, P, SAFE_TOP + 120);
    y = centerBlock(x3, story.text, SAFE_TOP + 240, { size: 104, minSize: 60, maxLines: 2 });
    var imgs = (o.images || []).filter(Boolean).slice(0, 6);
    var cols = imgs.length > 3 ? 3 : Math.max(1, imgs.length);
    var size = imgs.length > 3 ? 210 : 260;
    var gx = (W - cols * size - (cols - 1) * 24) / 2;
    imgs.forEach(function (img, i) {
      var cx = gx + (i % cols) * (size + 24);
      var cy = y + 50 + Math.floor(i / cols) * (size + 24);
      x3.save();
      K.roundRect(x3, cx, cy, size, size, 20);
      x3.fillStyle = '#FFFFFF';
      x3.fill();
      x3.restore();
      K.drawContain(x3, img, cx + 14, cy + 14, size - 28, size - 28);
    });
    var rows = Math.ceil(imgs.length / cols) || 0;
    var by = y + 50 + rows * (size + 24) + 30;
    // 「最新投稿へ」のボタン風の帯
    x3.font = f(52, 800);
    var sw = Math.min(W - M * 2, x3.measureText(story.sub).width + 120);
    K.roundRect(x3, (W - sw) / 2, by, sw, 120, 60);
    x3.fillStyle = INK;
    x3.fill();
    x3.fillStyle = '#FFFFFF';
    x3.textAlign = 'center';
    x3.fillText(story.sub, W / 2, by + 78);
    x3.textAlign = 'left';
    bear(x3, o, P);
    out.push({ fileName: 'story_03.png', canvas: c3 });
    return out;
  }

  // ---- Reel ----
  // 1シーンを、そのシーンの中の進み具合 p（0〜1）で描く。動きはフェード・スライド・軽いズームだけ
  function drawScene(ctx, scene, p, o) {
    var P = paletteFor(o.style);
    background(ctx, P);
    var appear = Math.min(1, p / 0.18); // 最初の少しでフェードイン
    var slide = (1 - easeOut(appear)) * 50;
    ctx.save();
    ctx.globalAlpha = appear;
    if (scene.type === 'item') {
      var img = o.images[scene.item];
      var zoom = 1 + 0.06 * p; // 軽いズーム
      if (img) {
        var bw = W - M * 2;
        var bh = 900;
        var bx = M;
        var by = SAFE_TOP + 120;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.14)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 12;
        K.roundRect(ctx, bx, by, bw, bh, 36);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.restore();
        ctx.save();
        K.roundRect(ctx, bx, by, bw, bh, 36);
        ctx.clip();
        var cw = (bw - 80) * zoom;
        var ch = (bh - 80) * zoom;
        K.drawContain(ctx, img, bx + (bw - cw) / 2, by + (bh - ch) / 2, cw, ch);
        ctx.restore();
      }
      var it = o.items[scene.item] || {};
      ctx.translate(0, slide);
      centerBlock(ctx, scene.text, SAFE_TOP + 1080, { size: 88, minSize: 56, maxLines: 2 });
      if (it.price) {
        ctx.font = f(48, 700);
        ctx.fillStyle = '#5F5F5F';
        ctx.textAlign = 'center';
        ctx.fillText((it.shortName ? it.shortName + '　' : '') + '¥' + K.priceText(it.price), W / 2, SAFE_TOP + 1280);
        ctx.textAlign = 'left';
      }
    } else {
      ctx.translate(0, slide);
      kicker(ctx, P, SAFE_TOP + 300);
      var y = centerBlock(ctx, scene.text, SAFE_TOP + 420, { size: scene.type === 'hook' ? 116 : 96, minSize: 60, maxLines: 3 });
      if (scene.type === 'cta') {
        ctx.font = f(44, 600);
        ctx.fillStyle = '#5F5F5F';
        ctx.textAlign = 'center';
        ctx.fillText('楽天ROOMはプロフィールから', W / 2, y + 90);
        ctx.textAlign = 'left';
      } else {
        productRow(ctx, o.images.filter(Boolean).slice(0, 3), { x: M, y: Math.min(y + 100, 1000), w: W - M * 2, h: 290 });
      }
    }
    ctx.restore();
    if (scene.type !== 'item') bear(ctx, o, P);
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // シーンごとの静止画（タイムラインの確認・ZIP用）
  function renderReelFrames(reel, o) {
    return reel.scenes.map(function (s, i) {
      var c = newCanvas();
      drawScene(c.getContext('2d'), s, 1, o);
      return { fileName: 'reel_' + (i < 9 ? '0' : '') + (i + 1) + '_' + s.type + '.png', canvas: c, scene: s };
    });
  }

  function videoType() {
    if (!window.MediaRecorder) return '';
    var types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    return '';
  }

  // Reelを動画に書き出す（画面に映さず、実際の長さで録画する）。iPhoneのSafariはMP4、ほかのブラウザはWebMになることがある
  function exportVideo(reel, o, onProgress) {
    var type = videoType();
    var canvas = newCanvas();
    if (!type || !canvas.captureStream) return Promise.reject(new Error('このブラウザでは動画を書き出せません'));
    var ctx = canvas.getContext('2d');
    var stream = canvas.captureStream(30);
    var rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6000000 });
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    return new Promise(function (resolve, reject) {
      rec.onstop = function () { resolve(new Blob(chunks, { type: type.split(';')[0] })); };
      rec.onerror = function (e) { reject(e.error || new Error('録画に失敗しました')); };
      var total = reel.seconds * 1000;
      var start = null;
      drawScene(ctx, reel.scenes[0], 0, o);
      rec.start(250);
      function frame(now) {
        if (start == null) start = now;
        var t = now - start;
        var sec = t / 1000;
        var scene = reel.scenes[reel.scenes.length - 1];
        for (var i = 0; i < reel.scenes.length; i++) {
          if (sec < reel.scenes[i].end) { scene = reel.scenes[i]; break; }
        }
        drawScene(ctx, scene, Math.min(1, (sec - scene.start) / scene.seconds), o);
        if (onProgress) onProgress(Math.min(1, t / total));
        if (t < total) requestAnimationFrame(frame);
        else setTimeout(function () { rec.stop(); stream.getTracks().forEach(function (tr) { tr.stop(); }); }, 200);
      }
      requestAnimationFrame(frame);
    });
  }

  window.ReelStory = {
    SIZE: { width: W, height: H },
    renderStory: renderStory,
    renderReelFrames: renderReelFrames,
    drawScene: drawScene,
    exportVideo: exportVideo,
    videoType: videoType
  };
})();
