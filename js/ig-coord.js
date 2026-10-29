// コーデのInstagram投稿（AIコーデスタジオから作る）。今までの投稿の作り方（商品スライド・ROOM誘導・最大20商品の配置）はそのまま使い、
// 表紙のあとにコーデのスライドを差し込む。
//   single : 1枚目 完成コーデ → 2枚目以降 使ったアイテム → 最後 ROOM誘導
//   compare: 1枚目 3コーデを並べた表紙 → 2〜4枚目 各コーデ → アイテム一覧 → 最後 ROOM誘導
//   release: 1枚目 起点の新商品（新商品の表紙） → 2枚目 完成コーデ → 3枚目以降 組み合わせた商品 → 最後 ROOM誘導
// 完成コーデの画像は、AI着用イメージ（画像に「AIによる着用イメージ」と入っている）か、実物商品コラージュ。
(function () {
  'use strict';

  var R = window.IgRender;
  var K = R.kit;
  var W = K.SIZE.width;
  var H = K.SIZE.height;
  var M = K.M;
  var MAX = 10; // Instagramのカルーセルの上限（js/carousel-layout.js と同じ）
  var INK = '#1A1A1A', SUB = '#6B6460', BG = '#F4F1EC', ACCENT = '#8C5A3C';

  function f(size, weight) { return (weight || 400) + ' ' + Math.round(size) + 'px ' + K.FONT; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 画像を枠に収める（はみ出さない・小さい画像は1.4倍まで）
  function fit(ctx, img, x, y, w, h, up) {
    if (!img) return null;
    var s = Math.min(w / img.width, h / img.height, up || 1.4);
    var r = { x: x + (w - img.width * s) / 2, y: y + (h - img.height * s) / 2, w: img.width * s, h: img.height * s };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.14)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    K.roundRect(ctx, r.x, r.y, r.w, r.h, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();
    ctx.save();
    K.roundRect(ctx, r.x, r.y, r.w, r.h, 16);
    ctx.clip();
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    ctx.restore();
    return r;
  }

  // ラベル（AI着用イメージか、実物の写真を並べたものか）
  function kindNote(look) {
    return look.ai ? 'AIによる着用イメージ（ロゴ・細部は実物と異なることがあります）' : '実物の商品写真を並べたコラージュ';
  }

  var T = R.TEMPLATES;

  // 完成コーデ1つ分：画像を大きく、下にコーデ名・スタイル・アイテム数・合計
  T.coordLook = function (ctx, d) {
    var look = d.look;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = INK;
    ctx.font = f(26, 700);
    ctx.fillText((d.letter ? 'COORDINATE ' + d.letter : 'COORDINATE').split('').join(' '), M - 20, 78);
    if (d.page) K.pageNumber(ctx, d.page, d.total, INK);
    fit(ctx, look.image, M - 20, 110, W - (M - 20) * 2, 930, 1.6);
    var t = K.fitText(ctx, look.name || '', { size: 60, minSize: 40, weight: 800, maxWidth: W - M * 2 - 160, maxLines: 1 });
    ctx.font = f(t.size, 800);
    ctx.fillStyle = INK;
    ctx.fillText(t.lines[0] || '', M - 20, 1120);
    ctx.font = f(30, 700);
    ctx.fillStyle = ACCENT;
    ctx.fillText([look.style, look.count ? look.count + 'アイテム' : '', look.total ? '合計 ¥' + K.priceText(look.total) : ''].filter(Boolean).join('　'), M - 20, 1172);
    ctx.font = f(24, 600);
    ctx.fillStyle = SUB;
    ctx.fillText(kindNote(look), M - 20, 1222);
    K.drawBear(ctx, d.bear, W - M - 40, H - 120, 120);
    ctx.font = f(26, 600);
    ctx.fillStyle = SUB;
    ctx.fillText(K.ACCOUNT.handle, M - 20, H - 52);
  };

  // 3コーデ比較の表紙：3つの完成コーデを横に並べる
  T.coordCompare = function (ctx, d) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = INK;
    ctx.font = f(26, 700);
    ctx.fillText('C O O R D I N A T E   × ' + d.looks.length, M - 20, 84);
    var t = K.fitText(ctx, d.title || '', { size: 72, minSize: 44, weight: 800, maxWidth: W - (M - 20) * 2, maxLines: 2 });
    ctx.font = f(t.size, 800);
    t.lines.forEach(function (l, i) { ctx.fillText(l, M - 20, 170 + i * t.size * 1.2); });
    var top = 170 + t.lines.length * t.size * 1.2 + 10;
    var n = d.looks.length;
    var gap = 20;
    var cw = (W - (M - 20) * 2 - gap * (n - 1)) / n;
    var ch = H - top - 230;
    // 画像の高さをそろえ、画像と名前をひとかたまりにして上下のまん中に置く
    var hMax = Math.max.apply(null, d.looks.map(function (l) { return l.image ? Math.min(cw / l.image.width, ch / l.image.height, 1.6) * l.image.height : 0; }).concat([200]));
    var y0 = top + Math.max(0, (ch - hMax - 90) / 2);
    d.looks.forEach(function (look, i) {
      var x = M - 20 + i * (cw + gap);
      fit(ctx, look.image, x, y0, cw, hMax, 1.6);
      ctx.fillStyle = INK;
      ctx.font = f(40, 800);
      ctx.fillText(String.fromCharCode(65 + i), x, y0 + hMax + 54);
      var nm = K.fitText(ctx, look.name || '', { size: 28, minSize: 20, weight: 700, maxWidth: cw - 44, maxLines: 2 });
      ctx.font = f(nm.size, 700);
      nm.lines.forEach(function (l, k) { ctx.fillText(l, x + 40, y0 + hMax + 50 + k * nm.size * 1.3); });
    });
    ctx.font = f(24, 600);
    ctx.fillStyle = SUB;
    ctx.fillText(d.looks.some(function (l) { return l.ai; }) ? 'AIによる着用イメージを含みます（実物と異なることがあります）' : '実物の商品写真を並べたコラージュです', M - 20, H - 56);
    K.drawBear(ctx, d.bear, W - M - 40, H - 110, 110);
  };

  function render(name, data) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    T[name](ctx, data);
    return c;
  }

  // post.coord: { format, title, looks: [{ name, style, image, ai, count, total }] }
  R.renderCoordPost = function (post) {
    var co = post.coord;
    var looks = co.looks || [];
    // 表紙のあとに差し込む枚数（1コーデ紹介は表紙そのものを完成コーデにするので0）
    var extra = co.format === 'compare' ? looks.length : co.format === 'release' ? 1 : 0;
    var base = Object.assign({}, post, { coordInner: true, summary: null, extraSlides: extra, maxSlides: MAX - extra });
    // 新商品のコーデでは、主役（起点の新商品）は表紙で大きく紹介するので、3枚目以降は組み合わせた商品から
    var heroOnCover = co.format === 'release' && post.items.length > 1;
    if (heroOnCover) base.items = post.items.slice(1);
    var slides = R.renderPost(base);
    var total = slides.length + extra;
    var inserts = [];
    if (co.format === 'compare') {
      slides[0] = { fileName: '01_cover.png', canvas: render('coordCompare', { title: co.title, looks: looks, bear: post.bear }) };
      looks.forEach(function (look, i) {
        inserts.push({ fileName: pad(i + 2) + '_coord_' + String.fromCharCode(97 + i) + '.png', canvas: render('coordLook', { look: look, letter: String.fromCharCode(65 + i), page: i + 2, total: total, bear: post.bear }) });
      });
    } else if (co.format === 'release') {
      // 1枚目は新商品の表紙（主役を大きく）。表紙の写真は主役を必ず使う
      if (heroOnCover) {
        var cover = R.renderPost(Object.assign({}, base, { items: post.items, extraSlides: 0, maxSlides: MAX }))[0];
        slides[0] = cover;
      }
      inserts.push({ fileName: '02_coord.png', canvas: render('coordLook', { look: looks[0], page: 2, total: total, bear: post.bear }) });
    } else {
      slides[0] = { fileName: '01_coord.png', canvas: render('coordLook', { look: Object.assign({}, looks[0], { name: co.title || looks[0].name }), bear: post.bear }) };
    }
    var out = [slides[0]].concat(inserts, slides.slice(1));
    // 「スライド構成」の表示用：差し込んだスライドを計画にも入れる
    var plan = slides.plan;
    if (plan) {
      plan.slides = [plan.slides[0]].concat(inserts.map(function () { return { kind: 'coord' }; }), plan.slides.slice(1));
      plan.total += inserts.length;
      plan.maxSlides = MAX;
      plan.overLimit = plan.total > MAX;
      if (heroOnCover) plan.itemOffset = 1;
    }
    out.plan = plan;
    return out;
  };
})();
