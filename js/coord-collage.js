// 実物商品コラージュ：コーデに選んだ実在の商品写真を並べて、組み合わせを確認する画像（画像生成AIは使わない）。
// 起点のアイテムを大きく（2×2）、ほかのアイテムを3列のマスに並べる。写真は加工せず、余白の切り抜きだけ。
(function () {
  'use strict';

  var W = 1080, H = 1350;

  // items: [{ image(読み込んだ画像), label, price, hero }]、o: { title, total, handle }
  function render(items, o) {
    o = o || {};
    var R = window.IgRender;
    var K = R.kit;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#F4F1EC';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1A1A1A';
    ctx.font = '700 26px ' + K.FONT;
    ctx.fillText('C O O R D I N A T E', 60, 78);
    var t = K.fitText(ctx, o.title || '', { size: 46, minSize: 30, weight: 800, maxWidth: W - 120, maxLines: 1 });
    ctx.font = '800 ' + t.size + 'px ' + K.FONT;
    ctx.fillText(t.lines[0] || '', 60, 138);

    var cell = 290, gap = 20, cols = 3;
    var x0 = (W - (cell * cols + gap * (cols - 1))) / 2;
    // 使う行数に合わせて、上下のまん中に置く（アイテムが少なくても間延びしない）
    var n = Math.min(items.length, 9);
    var hasHero = items.slice(0, 9).some(function (it) { return it.hero; });
    var rows = hasHero ? Math.max(2, 2 + Math.ceil(Math.max(0, n - 1 - 2) / cols)) : Math.ceil(n / cols);
    var gridH = rows * cell + (rows - 1) * gap;
    var y0 = Math.max(176, Math.round(176 + (H - 110 - 176 - gridH) / 2));
    var taken = {};
    function take(r, col) { taken[r + ':' + col] = true; }
    function tile(img, x, y, w, h, label, price) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.10)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      K.roundRect(ctx, x, y, w, h, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();
      if (img) {
        ctx.save();
        K.roundRect(ctx, x, y, w, h, 18);
        ctx.clip();
        // 小さい写真は無理に拡大しない（1.4倍まで）
        var s = Math.min((w - 36) / img.width, (h - 76) / img.height, 1.4);
        ctx.drawImage(img, x + (w - img.width * s) / 2, y + 18 + (h - 76 - img.height * s) / 2, img.width * s, img.height * s);
        ctx.restore();
      }
      ctx.font = '700 22px ' + K.FONT;
      ctx.fillStyle = '#6B6460';
      var lab = K.fitText(ctx, label || '', { size: 22, minSize: 18, weight: 700, maxWidth: w - 140, maxLines: 1 });
      ctx.font = '700 ' + lab.size + 'px ' + K.FONT;
      ctx.fillText(lab.lines[0] || '', x + 16, y + h - 20);
      if (price) {
        ctx.textAlign = 'right';
        ctx.font = '800 24px ' + K.FONT;
        ctx.fillStyle = '#1A1A1A';
        ctx.fillText('¥' + K.priceText(price), x + w - 16, y + h - 20);
        ctx.textAlign = 'left';
      }
    }
    var list = items.slice(0, 9);
    var hero = list.filter(function (it) { return it.hero; })[0];
    var rest = list.filter(function (it) { return it !== hero; });
    if (hero) {
      tile(hero.image, x0, y0, cell * 2 + gap, cell * 2 + gap, hero.label, hero.price);
      take(0, 0); take(0, 1); take(1, 0); take(1, 1);
    }
    var r = 0, col = 0;
    rest.forEach(function (it) {
      while (taken[r + ':' + col]) { col++; if (col >= cols) { col = 0; r++; } }
      take(r, col);
      tile(it.image, x0 + col * (cell + gap), y0 + r * (cell + gap), cell, cell, it.label, it.price);
    });
    ctx.fillStyle = '#1A1A1A';
    ctx.font = '700 28px ' + K.FONT;
    if (o.total) ctx.fillText('合計 ¥' + K.priceText(o.total) + '（' + list.length + '点）', 60, H - 50);
    ctx.textAlign = 'right';
    ctx.font = '600 22px ' + K.FONT;
    ctx.fillStyle = '#6B6460';
    ctx.fillText('実物の商品写真を並べたものです', W - 60, H - 52);
    ctx.textAlign = 'left';
    return c;
  }

  window.CoordCollage = { render: render, SIZE: { width: W, height: H } };
})();
