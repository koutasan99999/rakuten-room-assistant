// 1スライドに2〜4商品をのせるテンプレート（商品が多い投稿用）。
// 通販チラシではなく、雑誌の特集ページのように：余白をとり、商品画像は白いカードに、文字は小さくしすぎない。
// 色は表紙のシリーズに合わせる（d.palette）。どのスライドにも番号を付け、ROOMで探すときの手がかりにする。
//   duo  : 比較（2商品を左右に）
//   trio : 雑誌（1商品を大きく＋2商品）
//   grid4: 一覧（2×2）
(function () {
  'use strict';

  var R = window.IgRender;
  var K = R.kit;
  var W = K.SIZE.width;
  var H = K.SIZE.height;
  var M = K.M;
  var TOP = 170; // ラベル・ページ番号の下
  var FOOT = H - 110; // くまとアカウント名の上

  function f(size, weight) { return (weight || 400) + ' ' + Math.round(size) + 'px ' + K.FONT; }

  function frame(ctx, d) {
    var P = K.paletteOf(d);
    ctx.fillStyle = P.cardBg;
    ctx.fillRect(0, 0, W, H);
    K.label(ctx, d.category, M - 20, M - 12, P.pill);
    K.pageNumber(ctx, d.page, d.total, P.pill);
    // 下：くま（小さく）とアカウント名、何商品目かの目印
    K.drawBear(ctx, d.bear, W - M - 40, H - 62, 84);
    ctx.font = f(28, 600);
    ctx.fillStyle = K.C.sub;
    ctx.fillText(K.ACCOUNT.handle, M - 20, H - 52);
    var nos = d.items.map(function (it) { return it.no; });
    var range = 'No.' + nos[0] + '–' + nos[nos.length - 1] + (d.totalItems ? ' / ' + d.totalItems : '');
    ctx.textAlign = 'right';
    ctx.fillText(range, W - M - 110, H - 52);
    ctx.textAlign = 'left';
    return P;
  }

  // 商品画像を白いカードに入れる（背景を抜けた画像は影だけ）。左上に番号
  function imageCard(ctx, it, x, y, w, h, P) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.10)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    K.roundRect(ctx, x, y, w, h, 24);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();
    if (it.image) {
      ctx.save();
      K.roundRect(ctx, x, y, w, h, 24);
      ctx.clip();
      K.drawContain(ctx, it.image, x + 22, y + 22, w - 44, h - 44);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(x + 34, y + 34, 24, 0, Math.PI * 2);
    ctx.fillStyle = P.pill;
    ctx.fill();
    ctx.font = f(26, 800);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(String(it.no), x + 34, y + 43);
    ctx.textAlign = 'left';
  }

  // 役割・商品名・価格・ひとことを、下端（bottom）を超えない範囲で上から順に描く
  function textBlock(ctx, it, x, y, w, bottom, s, P) {
    var cy = y;
    if (it.role) {
      ctx.font = f(s.role, 700);
      ctx.fillStyle = P.accent;
      ctx.fillText(it.role.slice(0, 12), x, cy + s.role);
      cy += s.role + 10;
    }
    var name = K.fitText(ctx, it.shortName || '', { size: s.name, minSize: Math.max(28, s.name - 10), weight: 800, maxWidth: w, maxLines: s.nameLines || 2 });
    ctx.font = f(name.size, 800);
    ctx.fillStyle = K.C.text;
    name.lines.forEach(function (l, i) { ctx.fillText(l, x, cy + name.size + i * name.size * 1.28); });
    cy += name.size + (name.lines.length - 1) * name.size * 1.28 + 14;
    ctx.font = f(s.price, 800);
    var p = '¥' + K.priceText(it.price);
    ctx.fillText(p, x, cy + s.price);
    var pw = ctx.measureText(p).width;
    ctx.font = f(Math.round(s.price * 0.48), 600);
    ctx.fillStyle = K.C.sub;
    ctx.fillText('税込', x + pw + 8, cy + s.price);
    cy += s.price + 14;
    var memo = it.memo || it.subline || '';
    if (memo) {
      var lh = s.memo * 1.42;
      var lines = Math.max(0, Math.min(s.memoLines, Math.floor((bottom - cy) / lh)));
      if (lines) {
        var m = K.fitText(ctx, memo, { size: s.memo, minSize: Math.max(24, s.memo - 4), weight: 500, maxWidth: w, maxLines: lines });
        ctx.font = f(m.size, 500);
        ctx.fillStyle = K.C.sub;
        m.lines.forEach(function (l, i) { ctx.fillText(l, x, cy + m.size + i * lh); });
      }
    }
  }

  var T = R.TEMPLATES;

  // 比較：2商品を左右に（間に細い線）
  T.duo = function (ctx, d) {
    var P = frame(ctx, d);
    var gap = 56;
    var cw = (W - (M - 20) * 2 - gap) / 2;
    d.items.forEach(function (it, i) {
      var x = M - 20 + i * (cw + gap);
      imageCard(ctx, it, x, TOP, cw, 600, P);
      textBlock(ctx, it, x + 4, TOP + 630, cw - 8, FOOT - 20, { role: 30, name: 48, price: 58, memo: 32, memoLines: 4 }, P);
    });
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(W / 2 - 1, TOP + 630, 2, FOOT - TOP - 660);
  };

  // 雑誌：1商品を大きく（画像左・文字右）＋下に2商品
  T.trio = function (ctx, d) {
    var P = frame(ctx, d);
    var a = d.items[0];
    var left = M - 20;
    var full = W - left * 2;
    imageCard(ctx, a, left, TOP, 470, 470, P);
    textBlock(ctx, a, left + 500, TOP + 10, full - 500, TOP + 470, { role: 30, name: 50, nameLines: 3, price: 56, memo: 32, memoLines: 4 }, P);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(left, TOP + 500, full, 2);
    var gap = 56;
    var cw = (full - gap) / 2;
    d.items.slice(1).forEach(function (it, i) {
      var x = left + i * (cw + gap);
      imageCard(ctx, it, x, TOP + 530, 200, 200, P);
      textBlock(ctx, it, x + 220, TOP + 540, cw - 220, TOP + 740, { role: 24, name: 34, nameLines: 3, price: 40, memo: 26, memoLines: 0 }, P);
      // ひとことは画像の下に広く
      var memo = it.memo || it.subline || '';
      if (memo) {
        var m = K.fitText(ctx, memo, { size: 28, minSize: 24, weight: 500, maxWidth: cw, maxLines: 3 });
        ctx.font = f(m.size, 500);
        ctx.fillStyle = K.C.sub;
        m.lines.forEach(function (l, j) { ctx.fillText(l, x, TOP + 780 + m.size + j * m.size * 1.42); });
      }
    });
  };

  // 一覧：2×2でコンパクトに（それでも文字は26px以上）
  T.grid4 = function (ctx, d) {
    var P = frame(ctx, d);
    var gap = 48;
    var left = M - 20;
    var cw = (W - left * 2 - gap) / 2;
    var rowH = (FOOT - TOP - 30) / 2;
    d.items.forEach(function (it, i) {
      var x = left + (i % 2) * (cw + gap);
      var y = TOP + Math.floor(i / 2) * (rowH + 30);
      imageCard(ctx, it, x, y, cw, 270, P);
      textBlock(ctx, it, x + 4, y + 290, cw - 8, y + rowH, { role: 24, name: 36, price: 42, memo: 26, memoLines: 2 }, P);
    });
  };
})();
