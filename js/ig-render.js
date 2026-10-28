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

  // 投稿全体で統一する色（暖かいベージュ〜グレージュ）
  var C = {
    coverBg: '#EDE6DC',
    cardBg: '#F7F4EF',
    panel: '#FFFFFF',
    text: '#2A2724',
    sub: '#6F665D',
    accent: '#9A8573',
    line: '#E2D9CD',
    memoBg: '#EFE8DF'
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
    try { data = x.getImageData(0, 0, w, h).data; } catch (e) { return c; }

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
    if (maxX < 0) return c;
    var cw = maxX - minX + 1;
    var ch = maxY - minY + 1;
    if (cw > w * 0.96 && ch > h * 0.96) return c; // ほぼ余白なし
    var pad = Math.round(Math.max(cw, ch) * 0.03);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    cw = Math.min(w - minX, cw + pad * 2); ch = Math.min(h - minY, ch + pad * 2);
    var out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
    return out;
  }

  // 枠の中に、はみ出さず最大の大きさで中央に置く（小さい画像は拡大する）
  function drawContain(ctx, src, x, y, w, h) {
    var s = Math.min(w / src.width, h / src.height);
    var dw = src.width * s;
    var dh = src.height * s;
    ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function priceText(n) {
    return Number(n || 0).toLocaleString('ja-JP');
  }

  function label(ctx, text, x, y) {
    ctx.font = font(30, 700);
    var w = ctx.measureText(text).width + 44;
    roundRect(ctx, x, y, w, 56, 28);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = C.accent;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 22, y + 29);
    ctx.textBaseline = 'alphabetic';
  }

  function pageNumber(ctx, page, total) {
    ctx.font = font(30, 500);
    ctx.fillStyle = C.sub;
    ctx.textAlign = 'right';
    ctx.fillText(page + '/' + total, SIZE.width - M, M + 40);
    ctx.textAlign = 'left';
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

    // 2枚目以降：商品カード
    item: function (ctx, d) {
      ctx.fillStyle = C.cardBg;
      ctx.fillRect(0, 0, SIZE.width, SIZE.height);
      label(ctx, d.category, M, M);
      pageNumber(ctx, d.page, d.total);

      // 商品画像（主役なので大きく）
      var px = M, py = 172, pw = SIZE.width - M * 2, ph = 640;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.05)';
      ctx.shadowBlur = 24;
      roundRect(ctx, px, py, pw, ph, 36);
      ctx.fillStyle = C.panel;
      ctx.fill();
      ctx.restore();
      if (d.image) {
        ctx.save();
        roundRect(ctx, px, py, pw, ph, 36);
        ctx.clip();
        drawContain(ctx, d.image, px + 44, py + 44, pw - 88, ph - 88);
        ctx.restore();
      }

      var y = py + ph + 64;
      var maxW = SIZE.width - M * 2;
      if (d.role) {
        ctx.fillStyle = C.accent;
        ctx.font = font(32, 700);
        ctx.fillText(d.role, M, y);
        y += 62;
      } else {
        y += 18;
      }
      ctx.fillStyle = C.text;
      var name = fitText(ctx, d.shortName, { size: 54, minSize: 40, weight: 800, maxWidth: maxW, maxLines: 1 });
      ctx.font = font(name.size, 800);
      ctx.fillText(name.lines[0], M, y);
      y += 52;
      if (d.subline) {
        ctx.fillStyle = C.sub;
        var sub = fitText(ctx, d.subline, { size: 32, minSize: 26, weight: 500, maxWidth: maxW, maxLines: 1 });
        ctx.font = font(sub.size, 500);
        ctx.fillText(sub.lines[0], M, y);
      }
      y += 92;

      // 価格（大きく）
      ctx.fillStyle = C.text;
      ctx.font = font(68, 800);
      var p = priceText(d.price);
      ctx.fillText(p, M, y);
      var pw2 = ctx.measureText(p).width;
      ctx.font = font(32, 700);
      ctx.fillText('円', M + pw2 + 6, y);
      ctx.fillStyle = C.sub;
      ctx.font = font(24, 500);
      ctx.fillText('（税込）', M + pw2 + 44, y);

      // くまの一言メモ
      var by = SIZE.height - M - 150;
      var bx = M + 150;
      roundRect(ctx, bx, by, SIZE.width - M - bx, 150, 28);
      ctx.fillStyle = C.memoBg;
      ctx.fill();
      ctx.fillStyle = C.accent;
      ctx.font = font(24, 700);
      ctx.fillText('くまの一言メモ', bx + 32, by + 44);
      ctx.fillStyle = C.text;
      var memo = fitText(ctx, d.memo || '', { size: 32, minSize: 24, weight: 600, maxWidth: SIZE.width - M - bx - 64, maxLines: 2 });
      ctx.font = font(memo.size, 600);
      drawLines(ctx, memo.lines, bx + 32, by + 44 + memo.size + 14, memo.size * 1.35);
      drawBear(ctx, d.bear, M + 62, by + 75, 124);
    },

    // 最後：ROOMへの誘導
    cta: function (ctx, d) {
      ctx.fillStyle = C.coverBg;
      ctx.fillRect(0, 0, SIZE.width, SIZE.height);
      label(ctx, '楽天ROOM', M, M);
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
  // post: { topic, category, subtitle, bear, items: [{ image, shortName, subline, memo, price, role, slug }], ctaMessage }
  function renderPost(post) {
    var total = post.items.length + 2;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var slides = [{ fileName: '01_cover.png', canvas: render('cover', { topic: post.topic, subtitle: post.subtitle, bear: post.bear }) }];
    post.items.forEach(function (it, i) {
      slides.push({
        fileName: pad(i + 2) + '_item_' + (it.slug || 'item' + (i + 1)) + '.png',
        canvas: render('item', {
          category: post.category, page: i + 2, total: total, image: it.image, shortName: it.shortName,
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
