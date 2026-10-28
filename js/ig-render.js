// Instagramカルーセル画像をテンプレートから作る部品（ブラウザのCanvasで描画）。
//
// 毎回の見た目を安定させるため、AIに画像を作らせず「決まったレイアウト + 商品画像 + 文字」で描く。
// テンプレートは TEMPLATES に並んでおり、増やすときはここに関数を足す。
// 大きさは SIZE で決まるので、将来の正方形対応は SIZE と各テンプレートの座標を調整する。
(function () {
  'use strict';

  var SIZE = { width: 1080, height: 1350 };
  var M = 84; // 外側の余白

  var ACCOUNT = {
    name: '眼科医くま',
    handle: '@ganka_kuma_'
  };

  // 投稿全体で統一する色（表紙・誘導はグレージュ、商品カードは薄いグレーで商品を主役に）
  var C = {
    coverBg: '#ECE7E0',
    cardBg: '#ECECEC',
    panel: '#FFFFFF',
    text: '#2B2B2B',
    sub: '#5F5F5F',
    accent: '#9A8573',
    pill: '#7A7A7A',
    line: '#D6D6D6',
    memoBg: '#FFFFFF',
    // 2枚目「まとめ」だけ少しポップに（派手にしすぎない落ち着いた色）
    popBg: '#FBF1E1',
    popDot: 'rgba(229,142,109,0.10)',
    popCoral: '#E58E6D',
    popMarker: '#F7DC8A',
    popInk: '#2B2B2B'
  };

  var FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "IPAGothic", sans-serif';
  function font(size, weight) { return (weight || 400) + ' ' + size + 'px ' + FONT; }

  // ---- 文字の折り返し（日本語は1文字ずつ。句読点や閉じかっこが行頭に来ないようにする） ----
  var NO_LINE_START = '、。，．・ー」』）)！？!?ぁぃぅぇぉっゃゅょァィゥェォッャュョ';
  function wrap(ctx, text, maxWidth) {
    var lines = [];
    String(text).split('\n').forEach(function (para) {
      var line = '';
      // 英数字の単語（ROOM・UGREEN・65W など）は途中で切らない
      (para.match(/[A-Za-z0-9@_.%\-\/]+|./gu) || []).forEach(function (ch) {
        var test = line + ch;
        if (ctx.measureText(test).width > maxWidth && line) {
          if (ch.length === 1 && NO_LINE_START.indexOf(ch) !== -1) {
            // 行頭禁則：前の行の最後の1文字と一緒に次の行へ送る
            var last = line.slice(-1);
            lines.push(line.slice(0, -1));
            line = last + ch;
          } else {
            lines.push(line);
            line = ch;
          }
        } else {
          line = test;
        }
      });
      lines.push(line);
    });
    return lines;
  }

  // 決めた行数に収まるまで文字を小さくする
  function fitText(ctx, text, opts) {
    var size = opts.size;
    var lines;
    do {
      ctx.font = font(size, opts.weight);
      lines = wrap(ctx, text, opts.maxWidth);
      if (lines.length <= opts.maxLines) break;
      size -= 2;
    } while (size > opts.minSize);
    if (lines.length > opts.maxLines) {
      lines = lines.slice(0, opts.maxLines);
      lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…';
    }
    return { lines: lines, size: size };
  }

  function drawLines(ctx, lines, x, y, lineHeight) {
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lineHeight); });
    return y + lines.length * lineHeight;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- 固定のクマ（丸いアイコン。画像が無いときは仮のクマを描く） ----
  function drawBear(ctx, bear, cx, cy, d) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2 + 6, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.clip();
    if (bear) {
      // アイコン画像は中央を正方形に切り出して円に収める
      var s = Math.min(bear.width, bear.height);
      ctx.drawImage(bear, (bear.width - s) / 2, (bear.height - s) / 2, s, s, cx - d / 2, cy - d / 2, d, d);
    } else {
      drawPlaceholderBear(ctx, cx, cy, d);
    }
    ctx.restore();
  }

  function drawPlaceholderBear(ctx, cx, cy, d) {
    var r = d / 2;
    ctx.fillStyle = '#E8DED2';
    ctx.fillRect(cx - r, cy - r, d, d);
    ctx.fillStyle = '#8B5E3C';
    [[-0.42, -0.38], [0.42, -0.38]].forEach(function (p) {
      ctx.beginPath(); ctx.arc(cx + p[0] * r, cy + p[1] * r, r * 0.22, 0, Math.PI * 2); ctx.fill();
    });
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.05, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2A2724';
    ctx.fillRect(cx - r * 0.4, cy - r * 0.08, r * 0.34, r * 0.16);
    ctx.fillRect(cx + r * 0.06, cy - r * 0.08, r * 0.34, r * 0.16);
    ctx.fillStyle = '#D9B99A';
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.25, r * 0.2, r * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  }

  // ---- 商品画像の整形：周りの無地の余白を切り取る ----
  function trimImage(img) {
    var maxSide = 900;
    var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    var w = Math.max(1, Math.round(img.width * scale));
    var h = Math.max(1, Math.round(img.height * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0, w, h);
    var data;
    try { data = x.getImageData(0, 0, w, h).data; } catch (e) { c.cutout = false; return c; }

    // 四隅の色を背景色とみなす
    function px(i) { return [data[i], data[i + 1], data[i + 2], data[i + 3]]; }
    var corners = [px(0), px((w - 1) * 4), px((h - 1) * w * 4), px(((h - 1) * w + w - 1) * 4)];
    var bg = [0, 1, 2, 3].map(function (k) { return corners.reduce(function (s, p) { return s + p[k]; }, 0) / 4; });
    function isBg(i) {
      if (data[i + 3] < 16) return true;
      return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 36;
    }
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var yy = 0; yy < h; yy += 2) {
      for (var xx = 0; xx < w; xx += 2) {
        if (!isBg((yy * w + xx) * 4)) {
          if (xx < minX) minX = xx;
          if (xx > maxX) maxX = xx;
          if (yy < minY) minY = yy;
          if (yy > maxY) maxY = yy;
        }
      }
    }
    if (maxX < 0) return cutoutWhite(c);
    var cw = maxX - minX + 1;
    var ch = maxY - minY + 1;
    if (cw > w * 0.96 && ch > h * 0.96) return cutoutWhite(c); // ほぼ余白なし
    var pad = Math.round(Math.max(cw, ch) * 0.03);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    cw = Math.min(w - minX, cw + pad * 2); ch = Math.min(h - minY, ch + pad * 2);
    var out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
    return cutoutWhite(out);
  }

  // ---- 白い背景を透明にする（周りから続いている白だけを抜く。白い商品を消しすぎたら抜かない） ----
  function cutoutWhite(src) {
    var w = src.width, h = src.height;
    var x = src.getContext('2d');
    var img;
    try { img = x.getImageData(0, 0, w, h); } catch (e) { src.cutout = false; return src; }
    var d = img.data;
    var n = w * h;
    function white(i) {
      var p = i * 4;
      if (d[p + 3] < 16) return true;
      var mx = Math.max(d[p], d[p + 1], d[p + 2]);
      var mn = Math.min(d[p], d[p + 1], d[p + 2]);
      return mn >= 238 && mx - mn <= 14;
    }
    var removed = new Uint8Array(n);
    var stack = [];
    var borderWhite = 0, borderTotal = 0;
    function seed(i) {
      borderTotal++;
      if (white(i)) { borderWhite++; if (!removed[i]) { removed[i] = 1; stack.push(i); } }
    }
    for (var i = 0; i < w; i++) { seed(i); seed((h - 1) * w + i); }
    for (var j = 0; j < h; j++) { seed(j * w); seed(j * w + w - 1); }
    // 周りがほとんど白でなければ（写真の背景など）抜かない
    if (borderWhite < borderTotal * 0.7) { src.cutout = false; return src; }
    var count = stack.length;
    while (stack.length) {
      var k = stack.pop();
      var kx = k % w, ky = (k - kx) / w;
      var nb = [kx > 0 ? k - 1 : -1, kx < w - 1 ? k + 1 : -1, ky > 0 ? k - w : -1, ky < h - 1 ? k + w : -1];
      for (var q = 0; q < 4; q++) {
        var m = nb[q];
        if (m >= 0 && !removed[m] && white(m)) { removed[m] = 1; count++; stack.push(m); }
      }
    }
    // 抜いた部分が多すぎる＝白い商品まで消えている → 抜かない
    if (count > n * 0.85 || count < n * 0.03) { src.cutout = false; return src; }
    for (var t = 0; t < n; t++) {
      if (removed[t]) { d[t * 4 + 3] = 0; continue; }
      // 境目をなめらかに：抜いた所に接する明るい画素は半透明に
      var tx = t % w;
      var edge = (tx > 0 && removed[t - 1]) || (tx < w - 1 && removed[t + 1]) || (t >= w && removed[t - w]) || (t < n - w && removed[t + w]);
      if (edge && Math.min(d[t * 4], d[t * 4 + 1], d[t * 4 + 2]) >= 215) d[t * 4 + 3] = 120;
    }
    x.putImageData(img, 0, 0);
    src.cutout = true;
    return src;
  }

  // 枠の中に、はみ出さず最大の大きさで中央に置く（小さい画像は拡大する）
  function containRect(src, x, y, w, h) {
    var s = Math.min(w / src.width, h / src.height);
    var dw = src.width * s;
    var dh = src.height * s;
    return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
  }

  function drawContain(ctx, src, x, y, w, h) {
    var r = containRect(src, x, y, w, h);
    ctx.drawImage(src, r.x, r.y, r.w, r.h);
  }

  function priceText(n) {
    return Number(n || 0).toLocaleString('ja-JP');
  }

  // 塗りつぶしの丸いラベル（左上のカテゴリ・右上のページ番号）
  function pill(ctx, text, x, y, alignRight) {
    ctx.font = font(32, 600);
    var w = ctx.measureText(text).width + 56;
    var left = alignRight ? x - w : x;
    roundRect(ctx, left, y, w, 64, 32);
    ctx.fillStyle = C.pill;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 28, y + 34);
    ctx.textBaseline = 'alphabetic';
  }

  function label(ctx, text, x, y) { pill(ctx, text, x, y, false); }

  function pageNumber(ctx, page, total) {
    pill(ctx, page + '/' + total, SIZE.width - M + 20, M - 12, true);
  }

  function centerText(ctx, text, y) {
    ctx.textAlign = 'center';
    ctx.fillText(text, SIZE.width / 2, y);
    ctx.textAlign = 'left';
  }

  // 2枚目「まとめ」の本文。draw が false のときは描かずに、下端の位置だけ返す
  function summaryBody(ctx, d, k, draw) {
    var W = SIZE.width;
    var maxW = W - M * 2;
    var y = 250;
    ctx.fillStyle = C.popInk;
    var title = fitText(ctx, d.title, { size: Math.round(70 * k), minSize: 40, weight: 800, maxWidth: maxW, maxLines: 3 });
    ctx.font = font(title.size, 800);
    if (draw) drawLines(ctx, title.lines, M, y, title.size * 1.3);
    y += title.lines.length * title.size * 1.3;

    if (d.lead) {
      var pad = Math.round(44 * k);
      var lead = fitText(ctx, d.lead, { size: Math.round(36 * k), minSize: 22, weight: 500, maxWidth: maxW - pad * 2, maxLines: 8 });
      var lh = lead.size * 1.62;
      var cardY = y + 10;
      var cardH = pad * 2 + lead.lines.length * lh - (lh - lead.size) + 8;
      if (draw) {
        roundRect(ctx, M + 12, cardY + 12, maxW, cardH, 32);
        ctx.fillStyle = C.popInk;
        ctx.fill();
        roundRect(ctx, M, cardY, maxW, cardH, 32);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = C.popInk;
        ctx.stroke();
        ctx.fillStyle = C.popInk;
        ctx.font = font(lead.size, 500);
        drawLines(ctx, lead.lines, M + pad, cardY + pad + lead.size, lh);
      }
      y = cardY + cardH + 12;
    }

    if (d.verdict) {
      var by = y + Math.round(64 * k);
      var bd = Math.round(120 * Math.max(k, 0.8));
      var vx = M + bd + 32;
      var vw = W - M - vx;
      var v = fitText(ctx, d.verdict, { size: Math.round(44 * k), minSize: 26, weight: 800, maxWidth: vw, maxLines: 4 });
      var vlh = v.size * 1.5;
      if (draw) {
        ctx.beginPath();
        ctx.arc(M + bd / 2, by + bd / 2, bd / 2, 0, Math.PI * 2);
        ctx.fillStyle = C.popCoral;
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = font(Math.round(bd * 0.3), 800);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('結論', M + bd / 2, by + bd / 2 + 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = font(v.size, 800);
        v.lines.forEach(function (line, i) {
          var ly = by + v.size + 8 + i * vlh;
          var lw = ctx.measureText(line).width;
          ctx.fillStyle = C.popMarker;
          ctx.fillRect(vx - 6, ly - v.size * 0.36, lw + 12, v.size * 0.46);
          ctx.fillStyle = C.popInk;
          ctx.fillText(line, vx, ly);
        });
      }
      y = Math.max(by + bd, by + 8 + v.lines.length * vlh);
    }
    return y;
  }

  // ---- テンプレート ----
  var TEMPLATES = {
    // 1枚目：表紙
    cover: function (ctx, d) {
      ctx.fillStyle = C.coverBg;
      ctx.fillRect(0, 0, SIZE.width, SIZE.height);
      var maxW = SIZE.width - M * 2;

      ctx.fillStyle = C.accent;
      ctx.font = font(40, 700);
      ctx.fillText(ACCOUNT.name + 'の', M, 400);

      ctx.fillStyle = C.text;
      var t1 = fitText(ctx, d.topic + 'について', { size: 112, minSize: 72, weight: 800, maxWidth: maxW, maxLines: 3 });
      ctx.font = font(t1.size, 800);
      var y = drawLines(ctx, t1.lines, M, 400 + 40 + t1.size, t1.size * 1.28);
      var t2 = fitText(ctx, '本気出して考えてみた', { size: t1.size, minSize: 64, weight: 800, maxWidth: maxW, maxLines: 1 });
      ctx.font = font(t2.size, 800);
      y = drawLines(ctx, t2.lines, M, y + 4, t2.size * 1.28);

      ctx.fillStyle = C.accent;
      ctx.fillRect(M, y + 36, 96, 6);
      if (d.subtitle) {
        ctx.fillStyle = C.sub;
        ctx.font = font(40, 500);
        ctx.fillText(d.subtitle, M, y + 120);
      }

      ctx.fillStyle = C.sub;
      ctx.font = font(34, 500);
      ctx.fillText(ACCOUNT.handle, M, SIZE.height - M - 20);
      drawBear(ctx, d.bear, SIZE.width - M - 115, SIZE.height - M - 115, 230);
    },

    // 2枚目以降：商品カード（薄いグレーの背景に商品を大きく、文字は中央、下にくまの一言メモ）
    item: function (ctx, d) {
      ctx.fillStyle = C.cardBg;
      ctx.fillRect(0, 0, SIZE.width, SIZE.height);
      label(ctx, d.category, M - 20, M - 12);
      pageNumber(ctx, d.page, d.total);

      // 商品画像：背景を抜けた画像はそのまま置き、抜けない写真は角丸で置く
      var ax = 110, ay = 170, aw = SIZE.width - 220, ah = d.role ? 570 : 600;
      if (d.image) {
        ctx.save();
        if (d.image.cutout) {
          ctx.shadowColor = 'rgba(0,0,0,0.16)';
          ctx.shadowBlur = 40;
          ctx.shadowOffsetY = 18;
          drawContain(ctx, d.image, ax, ay, aw, ah);
        } else {
          var r = containRect(d.image, ax, ay, aw, ah);
          roundRect(ctx, r.x, r.y, r.w, r.h, 28);
          ctx.clip();
          ctx.drawImage(d.image, r.x, r.y, r.w, r.h);
        }
        ctx.restore();
      }

      var y = ay + ah + 46;
      var maxW = SIZE.width - M * 2;
      if (d.role) {
        ctx.fillStyle = C.accent;
        ctx.font = font(32, 700);
        centerText(ctx, d.role, y + 8);
        y += 34;
      }
      ctx.fillStyle = C.text;
      var name = fitText(ctx, d.shortName, { size: 84, minSize: 54, weight: 800, maxWidth: maxW, maxLines: 1 });
      ctx.font = font(name.size, 800);
      centerText(ctx, name.lines[0], y + name.size * 0.9);
      y += name.size * 0.9 + 64;
      if (d.subline) {
        ctx.fillStyle = C.sub;
        var sub = fitText(ctx, d.subline, { size: 40, minSize: 28, weight: 500, maxWidth: maxW, maxLines: 1 });
        ctx.font = font(sub.size, 500);
        centerText(ctx, sub.lines[0], y);
        y += 96;
      } else {
        y += 40;
      }

      // 価格（大きく、税込）
      ctx.fillStyle = C.text;
      ctx.font = font(78, 800);
      var p = '¥' + priceText(d.price);
      var pw = ctx.measureText(p).width;
      ctx.font = font(26, 600);
      var tw = ctx.measureText('税込').width;
      var px = (SIZE.width - pw - tw - 12) / 2;
      ctx.font = font(78, 800);
      ctx.fillText(p, px, y);
      ctx.fillStyle = C.sub;
      ctx.font = font(26, 600);
      ctx.fillText('税込', px + pw + 12, y);

      // くまの一言メモ（左下に大きめのクマ、右に吹き出し）
      var bd = 232;
      var bcx = M - 4 + bd / 2;
      var bcy = SIZE.height - 56 - bd / 2;
      var bx = bcx + bd / 2 + 34;
      var bh = 196;
      var by = bcy - bh / 2 + 6;
      var bw = SIZE.width - 60 - bx;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.08)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
      roundRect(ctx, bx, by, bw, bh, 44);
      ctx.fillStyle = C.memoBg;
      ctx.fill();
      // 吹き出しのしっぽ（クマの方へ）
      ctx.beginPath();
      ctx.moveTo(bx + 2, by + bh / 2 - 22);
      ctx.lineTo(bx - 26, by + bh / 2);
      ctx.lineTo(bx + 2, by + bh / 2 + 22);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = C.sub;
      ctx.font = font(28, 600);
      ctx.fillText('くまの一言メモ', bx + 44, by + 54);
      var lw = ctx.measureText('くまの一言メモ').width;
      ctx.fillStyle = C.line;
      ctx.fillRect(bx + 44 + lw + 18, by + 44, bw - 44 - lw - 18 - 44, 2);
      ctx.fillStyle = C.text;
      var memo = fitText(ctx, d.memo || '', { size: 38, minSize: 28, weight: 600, maxWidth: bw - 88, maxLines: 2 });
      ctx.font = font(memo.size, 600);
      drawLines(ctx, memo.lines, bx + 44, by + 54 + memo.size + 22, memo.size * 1.42);
      drawBear(ctx, d.bear, bcx, bcy, bd);
    },

    // 2枚目：まとめ（どれから見ればいいか・結論）をポップに
    summary: function (ctx, d) {
      var W = SIZE.width, H = SIZE.height;
      ctx.fillStyle = C.popBg;
      ctx.fillRect(0, 0, W, H);
      // 水玉
      ctx.fillStyle = C.popDot;
      for (var yy = 40; yy < H; yy += 64) {
        for (var xx = (yy / 64) % 2 ? 40 : 72; xx < W; xx += 64) {
          ctx.beginPath(); ctx.arc(xx, yy, 6, 0, Math.PI * 2); ctx.fill();
        }
      }
      // 左上：少し傾けた型のラベル
      ctx.save();
      ctx.translate(M - 10, M + 8);
      ctx.rotate(-0.05);
      ctx.font = font(34, 800);
      var cw = ctx.measureText(d.typeName).width + 60;
      roundRect(ctx, 0, -6, cw, 70, 35);
      ctx.fillStyle = C.popCoral;
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.typeName, 30, 30);
      ctx.restore();
      ctx.textBaseline = 'alphabetic';
      pageNumber(ctx, d.page, d.total);

      // 文章が長いときは、クマと下の一文にかからない大きさになるまで全体を少しずつ小さくする
      var limitY = H - M - 200;
      var scale = 1;
      while (scale > 0.62 && summaryBody(ctx, d, scale, false) > limitY) scale -= 0.04;
      summaryBody(ctx, d, scale, true);

      ctx.fillStyle = C.sub;
      ctx.font = font(30, 600);
      ctx.fillText('次のページから1つずつ紹介 →', M, H - M - 10);
      drawBear(ctx, d.bear, W - M - 85, H - M - 85, 170);
    },

    // 最後：ROOMへの誘導
    cta: function (ctx, d) {
      ctx.fillStyle = C.coverBg;
      ctx.fillRect(0, 0, SIZE.width, SIZE.height);
      label(ctx, '楽天ROOM', M - 20, M - 12);
      pageNumber(ctx, d.page, d.total);
      var maxW = SIZE.width - M * 2;

      ctx.fillStyle = C.text;
      // 改行した位置を保ったまま、各行が1行に収まる大きさにする
      var main = fitText(ctx, d.message, { size: 84, minSize: 56, weight: 800, maxWidth: maxW, maxLines: d.message.split('\n').length });
      ctx.font = font(main.size, 800);
      var y = drawLines(ctx, main.lines, M, 470, main.size * 1.32);

      ctx.fillStyle = C.accent;
      ctx.fillRect(M, y + 20, 96, 6);
      ctx.fillStyle = C.sub;
      ctx.font = font(38, 600);
      ctx.fillText(ACCOUNT.handle + ' のプロフィールから', M, y + 110);
      ctx.font = font(32, 500);
      ctx.fillText('保存しておくと、あとで見返せます', M, y + 170);

      drawBear(ctx, d.bear, SIZE.width - M - 115, SIZE.height - M - 115, 230);
    }
  };

  var CTA_MESSAGES = [
    '紹介したものは\nプロフィールの楽天ROOMに\nまとめています',
    '気になったものは\nプロフィールの\n楽天ROOMへ',
    '今回のまとめは\nプロフィールの\nROOMに載せています'
  ];

  function render(templateName, data) {
    var canvas = document.createElement('canvas');
    canvas.width = SIZE.width;
    canvas.height = SIZE.height;
    var ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    TEMPLATES[templateName](ctx, data);
    return canvas;
  }

  // 投稿1つ分（表紙 + 商品カード + ROOM誘導）を作る
  // post: { topic, category, subtitle, bear, summary?: { typeName, title, lead, verdict }, items: [{ image, shortName, subline, memo, price, role, slug }], ctaMessage }
  function renderPost(post) {
    var hasSummary = !!(post.summary && post.summary.title && post.summary.verdict);
    var offset = hasSummary ? 1 : 0;
    var total = post.items.length + 2 + offset;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var slides = [{ fileName: '01_cover.png', canvas: render('cover', { topic: post.topic, subtitle: post.subtitle, bear: post.bear }) }];
    if (hasSummary) {
      slides.push({
        fileName: '02_summary.png',
        canvas: render('summary', {
          typeName: post.summary.typeName || 'まず結論', title: post.summary.title, lead: post.summary.lead,
          verdict: post.summary.verdict, page: 2, total: total, bear: post.bear
        })
      });
    }
    post.items.forEach(function (it, i) {
      var page = i + 2 + offset;
      slides.push({
        fileName: pad(page) + '_item_' + (it.slug || 'item' + (i + 1)) + '.png',
        canvas: render('item', {
          category: post.category, page: page, total: total, image: it.image, shortName: it.shortName,
          subline: it.subline, memo: it.memo, price: it.price, role: it.role, bear: post.bear
        })
      });
    });
    slides.push({
      fileName: pad(total) + '_room_cta.png',
      canvas: render('cta', { page: total, total: total, message: post.ctaMessage || CTA_MESSAGES[0], bear: post.bear })
    });
    return slides;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('画像を読み込めませんでした')); };
      img.src = src;
    });
  }

  window.IgRender = {
    SIZE: SIZE,
    TEMPLATES: TEMPLATES,
    CTA_MESSAGES: CTA_MESSAGES,
    renderPost: renderPost,
    trimImage: trimImage,
    loadImage: loadImage
  };
})();
