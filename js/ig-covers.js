// Instagram 1枚目（表紙）のシリーズ別テンプレート。
// 選び方の型ごとに、配色・書体・レイアウトを固定する（毎回AIに自由に作らせない）。
// 中身は「固定テンプレート + 実際の商品画像 + 固定フォント + 固定配色 + 差し替える文字」だけ。
// 「○○について本気出して考えてみた」の表紙（serious_think）は js/ig-render.js の cover のまま変えない。
//
// 表紙の文字 d.cover: { style, title（改行で2行）, accent（目立たせる言葉）, sub, badge, price }
// 商品画像 d.images: 表紙に使う商品画像（白背景で切り抜けたものを優先して最大3枚）
// d.items: [{ image, shortName, price, role, brand }]（比較・チェックリストなどで使う）
(function () {
  'use strict';

  var R = window.IgRender;
  var K = R.kit;
  var W = K.SIZE.width;
  var H = K.SIZE.height;
  var M = K.M;
  var GOTHIC = K.FONT;
  var SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "IPAMincho", serif';
  var LATIN = '"Didot", "Bodoni 72", "Georgia", "Times New Roman", serif';

  function f(size, weight, family) { return (weight || 400) + ' ' + Math.round(size) + 'px ' + (family || GOTHIC); }

  // シリーズの選択肢（画面の「表紙のデザイン」に並べる順番・名前）
  var STYLES = [
    ['serious_think', '本気出して考えてみた（グレージュ）'],
    ['must_buy', 'まずコレ（アイボリー × マスタード）'],
    ['premium_vs_alternative', '本命と代替（左右で比較）'],
    ['budget_compare', '予算で比較（クリーム × グリーン）'],
    ['gift_select', 'プレゼント（ベージュ × ブラウン）'],
    ['starter_set', '初心者セット（ネイビー × ステップ）'],
    ['use_case', '用途で選ぶ（タグで分類）'],
    ['brand_pick', 'ブランドから選ぶ（雑誌風）'],
    ['value_pick', 'コスパ重視（ダーク × ゴールド）'],
    ['trend_pick', 'トレンド（文字主体）'],
    ['unique_pick', '変わり種（ちょいズラし）'],
    ['buy_this_first', '買っとけ（カーキ × チェックリスト）'],
    ['new_release', '新商品（新作特集）']
  ];

  // 2枚目以降（商品カード・ROOM誘導）も、表紙と色味をそろえる
  var PALETTES = {
    must_buy: { cardBg: '#F3EFE7', accent: '#B8861B', pill: '#2B2B2B' },
    premium_vs_alternative: { cardBg: '#ECEAE6', accent: '#7A6352', pill: '#3A3734' },
    budget_compare: { cardBg: '#EFEEE8', accent: '#5F6B57', pill: '#6B7563' },
    gift_select: { cardBg: '#F1EAE1', accent: '#8B5A3C', pill: '#B26A4E' },
    starter_set: { cardBg: '#EDF1F4', accent: '#2F5B7C', pill: '#1F3550' },
    use_case: { cardBg: '#EEEEEB', accent: '#3F6B78', pill: '#3F6B78' },
    brand_pick: { cardBg: '#EFEDE9', accent: '#8C7B66', pill: '#1E1E1E' },
    value_pick: { cardBg: '#E9E6E1', accent: '#A57F35', pill: '#2A2724' },
    trend_pick: { cardBg: '#EFEEEB', accent: '#C4553A', pill: '#151515' },
    unique_pick: { cardBg: '#F0ECE3', accent: '#2F7F7A', pill: '#2F7F7A' },
    buy_this_first: { cardBg: '#ECE8DA', accent: '#5E6B3C', pill: '#5E6B3C' },
    new_release: { cardBg: '#F2F0EC', accent: '#B4475A', pill: '#1A1A1A' }
  };

  // ---- 共通の部品 ----

  // 大見出し：行ごとに描き、強調する言葉（accent）だけ色・書体を変える。
  // 一番長い行が maxWidth に収まるまで文字を小さくする。戻り値は最後の行のベースライン
  function drawTitle(ctx, text, accent, o) {
    var lines = String(text || '').split('\n').filter(Boolean).slice(0, 2);
    var size = o.size;
    var accentScale = o.accentScale || 1;
    function pieces(line) {
      var i = accent ? line.indexOf(accent) : -1;
      if (i === -1) return [{ t: line, a: false }];
      return [{ t: line.slice(0, i), a: false }, { t: accent, a: true }, { t: line.slice(i + accent.length), a: false }].filter(function (p) { return p.t; });
    }
    function widthOf(line, s) {
      return pieces(line).reduce(function (w, p) {
        ctx.font = p.a && o.accentFamily ? f(s * accentScale, o.accentWeight || o.weight, o.accentFamily) : f(p.a ? s * accentScale : s, o.weight, o.family);
        return w + ctx.measureText(p.t).width;
      }, 0);
    }
    while (size > o.minSize && lines.some(function (l) { return widthOf(l, size) > o.maxWidth; })) size -= 4;
    var lh = size * (o.lineHeight || 1.2);
    var y = o.y;
    lines.forEach(function (line, li) {
      var y0 = y + li * lh;
      var lw = widthOf(line, size);
      var x = o.align === 'center' ? (W - lw) / 2 : o.x;
      ctx.save();
      if (o.rotateLine && o.rotateLine[li]) {
        ctx.translate(x + lw / 2, y0 - size * 0.35);
        ctx.rotate(o.rotateLine[li]);
        ctx.translate(-(x + lw / 2), -(y0 - size * 0.35));
      }
      if (o.marker && li === (o.marker.line || 0)) {
        // 蛍光ペンの線（行の下半分に、少しだけ斜めに）
        ctx.fillStyle = o.marker.color;
        ctx.beginPath();
        ctx.moveTo(x - 14, y0 - size * 0.08);
        ctx.lineTo(x + lw * (o.marker.ratio || 0.62), y0 - size * 0.16);
        ctx.lineTo(x + lw * (o.marker.ratio || 0.62) + 6, y0 + size * 0.06);
        ctx.lineTo(x - 10, y0 + size * 0.12);
        ctx.closePath();
        ctx.fill();
      }
      pieces(line).forEach(function (p) {
        var s = p.a ? size * accentScale : size;
        ctx.font = p.a && o.accentFamily ? f(s, o.accentWeight || o.weight, o.accentFamily) : f(s, o.weight, o.family);
        var pw = ctx.measureText(p.t).width;
        if (p.a && o.accentBox) {
          ctx.fillStyle = o.accentBox;
          ctx.fillRect(x - 8, y0 - size * 0.86, pw + 16, size * 1.02);
        }
        if (p.a && o.accentUnderline) {
          ctx.strokeStyle = o.accentUnderline;
          ctx.lineWidth = Math.max(6, size * 0.06);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x - pw * 0.25, y0 + size * 0.2);
          ctx.quadraticCurveTo(x + pw * 0.4, y0 + size * 0.12, x + pw + 12, y0 + size * 0.08);
          ctx.stroke();
        }
        ctx.fillStyle = p.a ? o.accentColor || o.color : o.color;
        ctx.fillText(p.t, x, y0);
        x += pw;
      });
      ctx.restore();
    });
    return { bottom: y + (lines.length - 1) * lh, size: size };
  }

  function centerText(ctx, text, y, font, color) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, y);
    ctx.textAlign = 'left';
  }

  // 文字の左右に細い線（「— 眼科医くまの —」のような見出し）
  function linedText(ctx, text, y, font, color, lineColor, gap, lineLen) {
    ctx.font = font;
    var tw = ctx.measureText(text).width;
    centerText(ctx, text, y, font, color);
    ctx.strokeStyle = lineColor || color;
    ctx.lineWidth = 2;
    var mid = y - parseInt(font.match(/(\d+)px/)[1], 10) * 0.32;
    var g = gap || 36;
    var len = lineLen || 160;
    ctx.beginPath();
    ctx.moveTo(W / 2 - tw / 2 - g - len, mid); ctx.lineTo(W / 2 - tw / 2 - g, mid);
    ctx.moveTo(W / 2 + tw / 2 + g, mid); ctx.lineTo(W / 2 + tw / 2 + g + len, mid);
    ctx.stroke();
  }

  // 右下に固定のくま（小さめ）と、その下にアカウント名
  function bearCorner(ctx, d, color, d0) {
    var dd = d0 || 200;
    var cx = W - M - dd / 2 + 24;
    var cy = H - 70 - dd / 2 - 34;
    K.drawBear(ctx, d.bear, cx, cy, dd);
    ctx.font = f(28, 600, LATIN);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(K.ACCOUNT.handle, cx, H - 48);
    ctx.textAlign = 'left';
  }

  // 商品画像を横に並べる。白背景を抜けた画像は影をつけてそのまま、抜けない写真は白いカードに入れる
  function drawProducts(ctx, imgs, box, o) {
    o = o || {};
    var list = (imgs || []).filter(Boolean).slice(0, o.max || 3);
    if (!list.length) return;
    var n = list.length;
    var gap = o.gap == null ? 24 : o.gap;
    var cw = (box.w - gap * (n - 1)) / n;
    list.forEach(function (img, i) {
      var x = box.x + i * (cw + gap);
      var y = box.y + (o.stagger && i % 2 ? o.stagger : 0);
      var h = box.h - (o.stagger ? o.stagger : 0);
      ctx.save();
      if (o.tilt) {
        var a = o.tilt[i % o.tilt.length];
        ctx.translate(x + cw / 2, y + h / 2);
        ctx.rotate(a);
        ctx.translate(-(x + cw / 2), -(y + h / 2));
      }
      if (o.podium) {
        ctx.fillStyle = o.podium;
        ctx.beginPath();
        ctx.ellipse(x + cw / 2, y + h - 18, cw * 0.48, 30, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (o.glow) {
        var g = ctx.createRadialGradient(x + cw / 2, y + h - 30, 10, x + cw / 2, y + h - 30, cw * 0.6);
        g.addColorStop(0, o.glow);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 40, y + h * 0.4, cw + 80, h * 0.7);
      }
      if (img.cutout && !o.card) {
        ctx.shadowColor = o.shadow || 'rgba(0,0,0,0.18)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 14;
        var r = K.containRect(img, x, y, cw, h - (o.podium ? 34 : 0));
        // 下にそろえて置く（棚やテーブルに並んでいるように）
        ctx.drawImage(img, r.x, y + (h - (o.podium ? 34 : 0)) - r.h, r.w, r.h);
      } else {
        var pad = 14;
        var rc = K.containRect(img, x + pad, y + pad, cw - pad * 2, h - pad * 2);
        ctx.shadowColor = o.shadow || 'rgba(0,0,0,0.14)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 10;
        K.roundRect(ctx, rc.x - pad, rc.y - pad, rc.w + pad * 2, rc.h + pad * 2, 18);
        ctx.fillStyle = o.cardColor || '#FFFFFF';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.drawImage(img, rc.x, rc.y, rc.w, rc.h);
      }
      ctx.restore();
    });
  }

  function pillText(ctx, text, x, y, o) {
    ctx.font = o.font;
    var w = ctx.measureText(text).width + (o.padX || 28) * 2;
    var h = o.h || 60;
    var left = o.center ? x - w / 2 : x;
    K.roundRect(ctx, left, y, w, h, o.r == null ? h / 2 : o.r);
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = o.color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + (o.padX || 28), y + h / 2 + 2);
    ctx.textBaseline = 'alphabetic';
    return w;
  }

  function spaced(text) { return String(text).split('').join(' '); }

  // ---- テンプレート ----
  // 新商品の表紙の雰囲気（商品のジャンルで変える）
  var RELEASE_MOODS = {
    fashion: { bg: '#F4EFE9', glow: '#E9D9D3', ink: '#1A1A1A', sub: '#5A5250', accent: '#B4475A', family: SERIF, label: '#1A1A1A', labelText: '#FFFFFF' },
    gadget: { bg: '#14171C', glow: '#22303F', ink: '#F5F7FA', sub: '#AEB8C4', accent: '#4FA3FF', family: GOTHIC, label: '#4FA3FF', labelText: '#0B1220' },
    living: { bg: '#F3F1EA', glow: '#E2E8DF', ink: '#1E1E1E', sub: '#55595A', accent: '#3E7C6B', family: GOTHIC, label: '#3E7C6B', labelText: '#FFFFFF' }
  };

  // ---- 新商品の表紙：商品写真から色を取る ----
  var MAX_UPSCALE = 1.35; // これ以上拡大すると画質が目立って落ちるので、大きくしない

  function luma(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  function mixRgb(a, b, t) { return [0, 1, 2].map(function (k) { return Math.round(a[k] * (1 - t) + b[k] * t); }); }
  function rgb(c) { return 'rgb(' + c.join(',') + ')'; }

  // 写真の代表色（main：色のある部分を重く）、平均、下の端の色
  function imageTone(img) {
    if (!img) return null;
    var s = 40;
    var c = document.createElement('canvas');
    c.width = s; c.height = s;
    var x = c.getContext('2d');
    var data;
    try { x.drawImage(img, 0, 0, s, s); data = x.getImageData(0, 0, s, s).data; } catch (e) { return null; }
    var main = [0, 0, 0], mw = 0, avg = [0, 0, 0], n = 0, bottom = [0, 0, 0], bn = 0;
    for (var i = 0; i < s * s; i++) {
      var p = i * 4;
      if (data[p + 3] < 128) continue;
      var px = [data[p], data[p + 1], data[p + 2]];
      var sat = Math.max(px[0], px[1], px[2]) - Math.min(px[0], px[1], px[2]);
      for (var k = 0; k < 3; k++) avg[k] += px[k];
      n++;
      if (Math.min(px[0], px[1], px[2]) < 236) { var w = 6 + sat; for (k = 0; k < 3; k++) main[k] += px[k] * w; mw += w; }
      if (i >= s * (s - 3)) { for (k = 0; k < 3; k++) bottom[k] += px[k]; bn++; }
    }
    if (!n) return null;
    avg = avg.map(function (v) { return v / n; });
    return {
      avg: avg,
      main: mw ? main.map(function (v) { return Math.round(v / mw); }) : avg.map(Math.round),
      bottom: bn ? bottom.map(function (v) { return Math.round(v / bn); }) : avg.map(Math.round)
    };
  }

  // 写真に合わせた配色。白っぽい商品は濃い背景、色のある商品はその色を薄くした背景
  function releasePalette(tone, S, hero) {
    var main = tone ? tone.main : [176, 150, 140];
    var sat = Math.max.apply(null, main) - Math.min.apply(null, main);
    var dark;
    var photoBg, textBg;
    if (hero && !hero.cutout && tone) {
      // 写真の下の色をそのまま文字の背景へつなぐ
      dark = luma(tone.bottom) < 120;
      textBg = dark ? mixRgb(tone.bottom, [12, 12, 12], 0.45) : mixRgb(tone.bottom, [250, 248, 244], 0.7);
      photoBg = mixRgb(tone.avg.map(Math.round), [0, 0, 0], 0.2);
    } else {
      dark = luma(main) > 200 && sat < 40; // 白・生成りの商品は、濃い背景で形を見せる
      photoBg = dark ? mixRgb(main, [34, 32, 30], 0.86) : mixRgb(main, [252, 250, 247], 0.8);
      textBg = dark ? mixRgb(main, [22, 21, 20], 0.92) : mixRgb(main, [252, 250, 247], 0.93);
    }
    var ink = dark ? [250, 248, 244] : mixRgb(main, [18, 18, 18], 0.88);
    var accent = sat < 40 ? null : dark ? mixRgb(main, [255, 255, 255], 0.3) : mixRgb(main, [0, 0, 0], 0.3);
    return {
      photoBg: rgb(photoBg), textBg: rgb(textBg), ink: rgb(ink),
      sub: dark ? 'rgba(250,248,244,0.72)' : rgb(mixRgb(main, [70, 70, 70], 0.8)),
      accent: accent ? rgb(accent) : S.accent,
      label: dark ? rgb([250, 248, 244]) : rgb(ink), labelText: rgb(dark ? textBg : [255, 255, 255]),
      floor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'
    };
  }

  // 主役の商品を枠の中に。小さい画像は MAX_UPSCALE 倍までしか大きくしない
  function placeHero(ctx, img, box, framed) {
    var s = Math.min(box.w / img.width, box.h / img.height, MAX_UPSCALE);
    var w = img.width * s, h = img.height * s;
    var x = box.x + (box.w - w) / 2, y = box.y + box.h - h; // 下にそろえる
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,' + (framed ? 0.3 : 0.2) + ')';
    ctx.shadowBlur = framed ? 40 : 34;
    ctx.shadowOffsetY = framed ? 18 : 16;
    if (framed) {
      K.roundRect(ctx, x, y, w, h, 12);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.shadowColor = 'transparent';
    }
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  // 同じ写真をとても小さくしてから引き伸ばす＝ぼかし（どのブラウザでも動く）
  function softBackdrop(ctx, img, ph) {
    var c = document.createElement('canvas');
    c.width = 18; c.height = Math.max(1, Math.round(18 * ph / W));
    var x = c.getContext('2d');
    var s = Math.max(c.width / img.width, c.height / img.height);
    x.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0, W, ph);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, ph);
  }

  var COVERS = {
    // まずコレ：白〜アイボリー、黒の太いゴシック、マスタードのアクセント。「まずコレ」を一番大きく
    must_buy: function (ctx, d) {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#FBF8F2'); g.addColorStop(1, '#F1EADF');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; // 斜めの光
      ctx.beginPath(); ctx.moveTo(W * 0.35, 0); ctx.lineTo(W * 0.62, 0); ctx.lineTo(W * 0.1, H * 0.62); ctx.lineTo(0, H * 0.62); ctx.lineTo(0, H * 0.4); ctx.closePath(); ctx.fill();

      ctx.fillStyle = '#C9921A'; ctx.fillRect(M, 108, 10, 56);
      ctx.font = f(46, 800); ctx.fillStyle = '#222';
      ctx.fillText(K.ACCOUNT.name + 'の', M + 32, 154);
      var kw = ctx.measureText(K.ACCOUNT.name + 'の').width;
      ctx.fillStyle = '#333'; ctx.fillRect(M + 32 + kw + 36, 136, W - M - (M + 32 + kw + 36), 2);

      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        x: M, y: 360, size: 170, minSize: 96, maxWidth: W - M * 2, weight: 900, color: '#1C1C1C', accentColor: '#C9921A',
        lineHeight: 1.2, marker: { color: 'rgba(242,201,76,0.85)', line: 0, ratio: 0.56 }
      });
      ctx.fillStyle = '#C9921A'; ctx.fillRect(M, t.bottom + 82, 10, 56);
      ctx.font = f(50, 700); ctx.fillStyle = '#222';
      ctx.fillText(d.cover.sub || '', M + 32, t.bottom + 128);

      ctx.fillStyle = '#E6D8C1'; ctx.fillRect(0, 1150, W, H - 1150); // テーブル
      ctx.fillStyle = 'rgba(0,0,0,0.05)'; ctx.fillRect(0, 1150, W, 6);
      drawProducts(ctx, d.images, { x: M - 20, y: Math.max(t.bottom + 190, 720), w: W - M * 2 - 100, h: 1230 - Math.max(t.bottom + 190, 720) });
      bearCorner(ctx, d, '#333');
    },

    // 本命と代替：上に見出し、下を左右に分けて、左＝本命（チャコール）・右＝代替（アイボリー）、中央にVS
    premium_vs_alternative: function (ctx, d) {
      var g = ctx.createLinearGradient(0, 0, 0, 640);
      g.addColorStop(0, '#EEEBE7'); g.addColorStop(1, '#E2DED8');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, 640);
      linedText(ctx, K.ACCOUNT.name + 'の', 118, f(44, 600, SERIF), '#333', '#555', 40, 170);
      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        align: 'center', y: 290, size: 132, minSize: 80, maxWidth: W - M * 2, weight: 800, family: SERIF,
        color: '#1E1E1E', accentColor: '#1E1E1E', accentBox: 'rgba(255,255,255,0.75)', lineHeight: 1.22
      });
      linedText(ctx, d.cover.sub || '高い本命と、安いけどアリ', Math.min(t.bottom + 110, 600), f(46, 600, SERIF), '#333', '#777', 34, 110);

      // 下半分：左右に分ける
      var top = 650;
      var lg = ctx.createLinearGradient(0, top, 0, H);
      lg.addColorStop(0, '#3A3735'); lg.addColorStop(1, '#262423');
      ctx.fillStyle = lg; ctx.fillRect(0, top, W / 2, H - top);
      var rg = ctx.createLinearGradient(0, top, 0, H);
      rg.addColorStop(0, '#F3F0EB'); rg.addColorStop(1, '#E4E0DA');
      ctx.fillStyle = rg; ctx.fillRect(W / 2, top, W / 2, H - top);

      pillText(ctx, '高い', W / 4, top + 46, { font: f(46, 700, SERIF), fill: '#7A6352', color: '#FFF', center: true, r: 4, h: 70 });
      centerTextAt(ctx, '本命', W / 4, top + 170, f(40, 600, SERIF), '#EFE9E1');
      pillText(ctx, '安い', W * 3 / 4, top + 46, { font: f(46, 700, SERIF), fill: '#8C8C8C', color: '#FFF', center: true, r: 4, h: 70 });
      centerTextAt(ctx, '代替品', W * 3 / 4, top + 170, f(40, 600, SERIF), '#333');

      // 左に一番高い商品、右に一番安い商品
      var items = (d.items || []).filter(function (it) { return it.image; });
      if (items.length) {
        var sorted = items.slice().sort(function (a, b) { return b.price - a.price; });
        var hi = sorted[0];
        var lo = sorted.length > 1 ? sorted[sorted.length - 1] : null;
        drawProducts(ctx, [hi.image], { x: 50, y: top + 210, w: W / 2 - 110, h: 360 }, { shadow: 'rgba(0,0,0,0.45)' });
        centerTextAt(ctx, '¥' + K.priceText(hi.price), W / 4, H - 60, f(40, 700, LATIN), '#EFE9E1');
        if (lo) {
          drawProducts(ctx, [lo.image], { x: W / 2 + 60, y: top + 210, w: W / 2 - 280, h: 330 });
          ctx.font = f(40, 700, LATIN); ctx.fillStyle = '#333';
          ctx.fillText('¥' + K.priceText(lo.price), W / 2 + 60, H - 60);
        }
      }
      ctx.beginPath(); ctx.arc(W / 2, top + 330, 54, 0, Math.PI * 2);
      ctx.fillStyle = '#F6F3EE'; ctx.fill();
      ctx.strokeStyle = '#B9B1A6'; ctx.lineWidth = 2; ctx.stroke();
      centerTextAt(ctx, 'VS', W / 2, top + 345, f(40, 700, LATIN), '#2F2D2B');
      bearCorner(ctx, d, '#333', 180);
    },

    // 予算で比較：クリーム地、金額を大きく（数字は特徴のある書体）、落ち着いたグリーン
    budget_compare: function (ctx, d) {
      ctx.fillStyle = '#F3F0EA'; ctx.fillRect(0, 0, W, H);
      linedText(ctx, K.ACCOUNT.name + 'の', 112, f(44, 600, SERIF), '#333', '#555', 40, 190);
      var accent = d.cover.price && d.cover.title.indexOf(d.cover.price) !== -1 ? d.cover.price : d.cover.accent;
      var t = drawTitle(ctx, d.cover.title, accent, {
        x: M - 10, y: 330, size: 124, minSize: 76, maxWidth: W - M * 2 + 20, weight: 800, family: SERIF, color: '#222',
        accentColor: '#66705F', accentFamily: LATIN, accentWeight: 700, accentScale: d.cover.price ? 1.35 : 1, lineHeight: 1.3
      });
      // 小見出しは深いグリーンの帯に白文字
      ctx.font = f(46, 600, SERIF);
      var sw = ctx.measureText(d.cover.sub || '').width + 80;
      ctx.fillStyle = '#6B7563'; ctx.fillRect(M - 10, t.bottom + 60, sw, 92);
      ctx.fillStyle = '#FFF'; ctx.fillText(d.cover.sub || '', M + 30, t.bottom + 122);
      if (d.cover.price) {
        // 値札（落ち着いた生成りのタグ）
        ctx.save();
        ctx.translate(W - 250, t.bottom + 150);
        ctx.rotate(-0.12);
        ctx.fillStyle = '#EFE8DC';
        ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
        ctx.beginPath();
        ctx.moveTo(-150, -56); ctx.lineTo(110, -56); ctx.lineTo(160, 0); ctx.lineTo(110, 56); ctx.lineTo(-150, 56); ctx.closePath(); ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#B8A88F'; ctx.beginPath(); ctx.arc(118, 0, 9, 0, Math.PI * 2); ctx.fill();
        ctx.font = f(50, 600, LATIN); ctx.fillStyle = '#7A6B5A'; ctx.textAlign = 'center';
        ctx.fillText('¥' + d.cover.price, -20, 18);
        ctx.restore();
        ctx.textAlign = 'left';
      }
      drawProducts(ctx, d.images, { x: M - 20, y: Math.max(t.bottom + 230, 720), w: W - M * 2 - 100, h: 1250 - Math.max(t.bottom + 230, 720) }, { podium: 'rgba(107,117,99,0.12)' });
      bearCorner(ctx, d, '#555');
    },

    // プレゼント：ベージュ・ブラウン・淡いゴールド。大人向けの雑誌のように、ギフト感は控えめに
    gift_select: function (ctx, d) {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#F6EFE6'); g.addColorStop(1, '#EADFD0');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; // 奥のアーチ
      ctx.beginPath(); ctx.moveTo(W - 420, H); ctx.lineTo(W - 420, 360); ctx.arc(W - 230, 360, 190, Math.PI, 0); ctx.lineTo(W - 40, H); ctx.closePath(); ctx.fill();

      var badge = d.cover.badge || 'プレゼント';
      ctx.strokeStyle = '#C9A48F'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(M + 20, 112); ctx.lineTo(W - M - 20, 112); ctx.stroke();
      pillText(ctx, badge, W / 2, 76, { font: f(40, 600, SERIF), fill: '#B26A4E', color: '#FFF', center: true, h: 72, padX: 48 });
      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        align: 'center', y: 330, size: 136, minSize: 80, maxWidth: W - M * 2, weight: 800, family: SERIF, color: '#2A2421', accentColor: '#8B5A3C', lineHeight: 1.26
      });
      linedText(ctx, d.cover.sub || '', t.bottom + 120, f(46, 500, SERIF), '#3A3330', '#C9A48F', 30, 70);
      drawProducts(ctx, d.images, { x: M - 30, y: Math.max(t.bottom + 210, 720), w: W - M * 2 - 100, h: 1250 - Math.max(t.bottom + 210, 720) }, { podium: '#E3D6C5', shadow: 'rgba(92,58,32,0.22)' });
      bearCorner(ctx, d, '#5A4A40');
    },

    // 初心者セット：入門・ステップ感。1個目 → 2個目 → 遊び枠 を番号つきで
    starter_set: function (ctx, d) {
      ctx.fillStyle = '#F2F5F7'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#DCE7EE'; ctx.fillRect(0, 0, W, 16);
      ctx.font = f(30, 700, LATIN); ctx.fillStyle = '#6C8CA8';
      ctx.fillText(spaced('FOR BEGINNERS'), M, 120);
      ctx.font = f(42, 800); ctx.fillStyle = '#1F3550';
      ctx.fillText(K.ACCOUNT.name + 'の', M, 196);
      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        x: M, y: 350, size: 136, minSize: 80, maxWidth: W - M * 2, weight: 900, color: '#1F3550', accentColor: '#3E7C6B', lineHeight: 1.2
      });
      ctx.font = f(46, 600); ctx.fillStyle = '#44566A';
      ctx.fillText(d.cover.sub || '1個目・2個目・遊び枠', M, t.bottom + 100);

      // ステップ（商品カード → 番号 → ラベル）
      var labels = ['1個目', '2個目', '遊び枠'];
      var imgs = (d.images || []).slice(0, 3);
      var top = Math.max(t.bottom + 170, 800);
      var cw = 220;
      var xs = [M + cw / 2 - 10, M + cw * 1.5 + 30, M + cw * 2.5 + 70];
      ctx.strokeStyle = '#9DB4C6'; ctx.lineWidth = 4; ctx.setLineDash([12, 12]);
      ctx.beginPath(); ctx.moveTo(xs[0], top + cw + 70); ctx.lineTo(xs[2], top + cw + 70); ctx.stroke();
      ctx.setLineDash([]);
      xs.forEach(function (cx, i) {
        if (imgs[i]) drawProducts(ctx, [imgs[i]], { x: cx - cw / 2, y: top, w: cw, h: cw }, { card: true });
        ctx.beginPath(); ctx.arc(cx, top + cw + 70, 38, 0, Math.PI * 2);
        ctx.fillStyle = i === 2 ? '#3E7C6B' : '#1F3550'; ctx.fill();
        centerTextAt(ctx, String(i + 1), cx, top + cw + 86, f(40, 800, LATIN), '#FFF');
        centerTextAt(ctx, labels[i], cx, top + cw + 170, f(38, 800), '#1F3550');
      });
      bearCorner(ctx, d, '#1F3550', 180);
    },

    // 用途で選ぶ：分類感。タグ（役割）を並べ、商品は区切ったマスに
    use_case: function (ctx, d) {
      ctx.fillStyle = '#F6F6F3'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#3F6B78'; ctx.fillRect(M, 104, 64, 8);
      ctx.font = f(42, 800); ctx.fillStyle = '#1E1E1E';
      ctx.fillText(K.ACCOUNT.name + 'の', M, 186);
      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        x: M, y: 340, size: 128, minSize: 76, maxWidth: W - M * 2, weight: 900, color: '#1E1E1E', accentColor: '#3F6B78', lineHeight: 1.2
      });
      ctx.font = f(44, 600); ctx.fillStyle = '#4A4A4A';
      ctx.fillText(d.cover.sub || '', M, t.bottom + 92);
      // タグ：商品の役割（仕事用・家用など）。無ければ代表的な用途
      var tags = [];
      (d.items || []).forEach(function (it) { if (it.role && tags.indexOf(it.role) === -1 && tags.length < 4) tags.push(it.role); });
      if (tags.length < 2) tags = ['家用', '外用', '仕事用'];
      var x = M;
      var ty = t.bottom + 140;
      tags.forEach(function (tg, i) {
        x += pillText(ctx, '#' + tg, x, ty, { font: f(34, 700), fill: i === 0 ? '#3F6B78' : null, stroke: i === 0 ? null : '#3F6B78', color: i === 0 ? '#FFF' : '#3F6B78', h: 62, r: 8 }) + 14;
      });
      // 商品は罫線で区切ったマスに（左上に用途のラベル）
      // 白背景で切り抜けた画像（販促の文字が入っていないことが多い）を優先
      var withImg = (d.items || []).filter(function (it) { return it.image; });
      var imgsItems = withImg.filter(function (it) { return it.image.cutout; }).concat(withImg.filter(function (it) { return !it.image.cutout; })).slice(0, 3);
      var top = Math.max(ty + 110, 860);
      var bw = (W - M - 300 - 24 * 2) / 3;
      imgsItems.forEach(function (it, i) {
        var bx = M - 10 + i * (bw + 24);
        ctx.fillStyle = '#FFF'; ctx.strokeStyle = '#D6D6D0'; ctx.lineWidth = 2;
        ctx.fillRect(bx, top, bw, 1250 - top); ctx.strokeRect(bx, top, bw, 1250 - top);
        drawProducts(ctx, [it.image], { x: bx + 12, y: top + 64, w: bw - 24, h: 1250 - top - 80 }, { card: false, shadow: 'rgba(0,0,0,0.1)' });
        if (it.role) pillText(ctx, it.role.slice(0, 6), bx + 10, top + 10, { font: f(26, 700), fill: '#3F6B78', color: '#FFF', h: 44, r: 6, padX: 14 });
      });
      bearCorner(ctx, d, '#3F6B78', 180);
    },

    // ブランドから選ぶ：雑誌のような上質さ。黒・白・ベージュ・グレー。文字は詰め込まない
    brand_pick: function (ctx, d) {
      ctx.fillStyle = '#F3F1ED'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#1E1E1E'; ctx.lineWidth = 2; ctx.strokeRect(36, 36, W - 72, H - 72);
      centerText(ctx, spaced(d.cover.badge && /^[A-Z ]+$/.test(d.cover.badge) ? d.cover.badge : 'BRAND SELECTION'), 128, f(30, 600, LATIN), '#1E1E1E');
      ctx.fillStyle = '#1E1E1E'; ctx.fillRect(W / 2 - 60, 156, 120, 2);
      centerText(ctx, K.ACCOUNT.name + 'の', 236, f(40, 600, SERIF), '#555');
      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        align: 'center', y: 390, size: 124, minSize: 76, maxWidth: W - M * 2 - 20, weight: 800, family: SERIF, color: '#1C1C1C', accentColor: '#8C7B66', lineHeight: 1.26
      });
      centerText(ctx, d.cover.sub || '', t.bottom + 100, f(42, 500, SERIF), '#444');
      var brands = [];
      (d.items || []).forEach(function (it) { if (it.brand && brands.indexOf(it.brand) === -1 && brands.length < 4) brands.push(it.brand); });
      if (brands.length) centerText(ctx, brands.join('  /  ').toUpperCase(), t.bottom + 170, f(32, 600, LATIN), '#8C7B66');
      drawProducts(ctx, d.images, { x: M, y: Math.max(t.bottom + 230, 720), w: W - M * 2 - 100, h: 1240 - Math.max(t.bottom + 230, 720) }, { shadow: 'rgba(0,0,0,0.15)' });
      bearCorner(ctx, d, '#1E1E1E', 180);
    },

    // コスパ重視：ダーク地に白い文字、ゴールドのアクセント。通販広告っぽくしない
    value_pick: function (ctx, d) {
      var g = ctx.createRadialGradient(W * 0.45, H * 0.4, 100, W * 0.5, H * 0.5, W);
      g.addColorStop(0, '#2E2C29'); g.addColorStop(1, '#171615');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // 吹き出しの枠に「眼科医くまの」
      ctx.font = f(44, 800);
      var kw = ctx.measureText(K.ACCOUNT.name + 'の').width + 64;
      ctx.strokeStyle = '#FFF'; ctx.lineWidth = 3;
      ctx.strokeRect(M, 150, kw, 92);
      ctx.beginPath(); ctx.moveTo(M + 150, 242); ctx.lineTo(M + 170, 268); ctx.lineTo(M + 190, 242); ctx.stroke();
      ctx.fillStyle = '#171615'; ctx.fillRect(M + 152, 239, 36, 6);
      ctx.fillStyle = '#FFF'; ctx.fillText(K.ACCOUNT.name + 'の', M + 32, 212);
      // スタンプ
      ctx.save();
      ctx.translate(W - 200, 210); ctx.rotate(-0.18);
      ctx.strokeStyle = '#D9B36C'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 92, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 78, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#D9B36C'; ctx.textAlign = 'center';
      ctx.font = f(30, 700, LATIN); ctx.fillText('GOOD', 0, -6);
      ctx.font = f(30, 700, LATIN); ctx.fillText('VALUE', 0, 30);
      ctx.restore(); ctx.textAlign = 'left';

      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        x: M, y: 450, size: 168, minSize: 96, maxWidth: W - M * 2, weight: 900, color: '#F5F2EC', accentColor: '#D9B36C',
        accentUnderline: 'rgba(217,179,108,0.9)', lineHeight: 1.2
      });
      var sy = t.bottom + 90;
      ctx.fillStyle = '#B8964F'; ctx.fillRect(M, sy, W - M * 2, 2); ctx.fillRect(M, sy + 104, W - M * 2, 2);
      centerText(ctx, d.cover.sub || '', sy + 70, f(48, 700), '#F5F2EC');
      drawProducts(ctx, d.images, { x: M - 20, y: Math.max(sy + 150, 720), w: W - M * 2 - 100, h: 1250 - Math.max(sy + 150, 720) }, { glow: 'rgba(217,179,108,0.18)', shadow: 'rgba(0,0,0,0.6)', cardColor: '#F5F2EC' });
      bearCorner(ctx, d, '#D9B36C');
    },

    // トレンド：今っぽいが軽すぎない、文字主体。背景に大きな薄い英字
    trend_pick: function (ctx, d) {
      ctx.fillStyle = '#F4F3F0'; ctx.fillRect(0, 0, W, H);
      ctx.font = f(300, 700, LATIN); ctx.fillStyle = 'rgba(0,0,0,0.045)';
      ctx.fillText('TREND', M - 40, 330);
      pillText(ctx, d.cover.badge && d.cover.badge.length <= 8 ? d.cover.badge : 'NOW', M, 110, { font: f(32, 700, LATIN), fill: '#151515', color: '#FFF', h: 60, r: 4 });
      ctx.font = f(40, 800); ctx.fillStyle = '#151515';
      ctx.fillText(K.ACCOUNT.name + 'の', M, 260);
      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        x: M, y: 420, size: 140, minSize: 80, maxWidth: W - M * 2, weight: 900, color: '#151515', accentColor: '#C4553A', lineHeight: 1.2
      });
      ctx.fillStyle = '#C4553A'; ctx.fillRect(M, t.bottom + 50, 80, 8);
      ctx.font = f(46, 600); ctx.fillStyle = '#555';
      ctx.fillText(d.cover.sub || '', M, t.bottom + 140);
      drawProducts(ctx, d.images, { x: M - 10, y: Math.max(t.bottom + 210, 720), w: W - M * 2 - 100, h: 1250 - Math.max(t.bottom + 210, 720) }, { card: true, stagger: 40 });
      bearCorner(ctx, d, '#151515', 180);
    },

    // 変わり種：少し遊び心。色の面と2行目を少しずらす。ただし安っぽくしない
    unique_pick: function (ctx, d) {
      ctx.fillStyle = '#F2EEE6'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#2F7F7A'; ctx.beginPath(); ctx.arc(W - 40, 120, 220, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(M - 30, 300); ctx.rotate(-0.05);
      ctx.fillStyle = 'rgba(226,181,74,0.85)'; ctx.fillRect(0, 0, 640, 140); ctx.restore();
      ctx.font = f(42, 800); ctx.fillStyle = '#1E1E1E';
      ctx.fillText(K.ACCOUNT.name + 'の', M, 190);
      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        x: M, y: 410, size: 132, minSize: 76, maxWidth: W - M * 2, weight: 900, color: '#1E1E1E', accentColor: '#2F7F7A',
        lineHeight: 1.26, rotateLine: [0, -0.035]
      });
      ctx.font = f(46, 600); ctx.fillStyle = '#4A4A4A';
      ctx.fillText(d.cover.sub || '', M, t.bottom + 110);
      drawProducts(ctx, d.images, { x: M - 10, y: Math.max(t.bottom + 190, 720), w: W - M * 2 - 100, h: 1250 - Math.max(t.bottom + 190, 720) }, { tilt: [-0.07, 0.05, -0.03], card: true });
      bearCorner(ctx, d, '#1E1E1E', 180);
    },

    // 新商品（新作特集）：起点の商品（主役）の写真を大きく使う、ファッション誌・ブランド広告のような表紙。
    // 文字中心の「本気出して考えてみた」とははっきり分ける。色は商品写真から取り、写真は無理に拡大しない
    new_release: function (ctx, d) {
      var rel = d.release || {};
      var S = RELEASE_MOODS[rel.mood] || RELEASE_MOODS.living;
      var hero = (d.images || []).filter(Boolean)[0] || null;
      var tone = imageTone(hero);
      var P = releasePalette(tone, S, hero);
      var PH = 880; // 写真の部分（全体の約65％）
      var full = hero && !hero.cutout && Math.max(W / hero.width, PH / hero.height) <= MAX_UPSCALE;

      ctx.fillStyle = P.textBg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = P.photoBg;
      ctx.fillRect(0, 0, W, PH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, PH);
      ctx.clip();
      if (hero && full) {
        // 背景つきの写真：枠いっぱいに（切り抜きは中央）
        var s = Math.max(W / hero.width, PH / hero.height);
        ctx.drawImage(hero, (W - hero.width * s) / 2, (PH - hero.height * s) / 2, hero.width * s, hero.height * s);
      } else if (hero && !hero.cutout) {
        // 小さめの写真：ぼかした同じ写真を背景にして、写真は拡大しすぎず中央に
        softBackdrop(ctx, hero, PH);
        placeHero(ctx, hero, { x: M, y: 190, w: W - M * 2, h: PH - 190 - 120 }, true);
      } else if (hero) {
        // 白背景を抜けた商品：商品の色を薄くした背景に、影をつけて置く
        var floor = ctx.createRadialGradient(W / 2, PH - 130, 20, W / 2, PH - 130, 420);
        floor.addColorStop(0, P.floor);
        floor.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = floor;
        ctx.fillRect(0, 0, W, PH);
        placeHero(ctx, hero, { x: M, y: 200, w: W - M * 2, h: PH - 200 - 110 }, false);
      }
      // 上の文字が写真に埋もれないよう、写真のときだけ上をうっすら暗く
      var onPhoto = hero && !hero.cutout;
      if (onPhoto) {
        var g = ctx.createLinearGradient(0, 0, 0, 240);
        g.addColorStop(0, 'rgba(0,0,0,0.42)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, 240);
      }
      ctx.restore();

      // 上：NEW ARRIVAL とブランド名（雑誌の見出しのように）
      var topInk = onPhoto ? '#FFFFFF' : P.ink;
      ctx.font = f(24, 700, LATIN);
      ctx.fillStyle = topInk;
      ctx.fillText(spaced('NEW ARRIVAL'), M, 84);
      ctx.textAlign = 'right';
      ctx.font = f(24, 700, GOTHIC);
      ctx.fillText(K.ACCOUNT.name + 'の新作チェック', W - M, 84);
      ctx.textAlign = 'left';
      if (rel.brand) {
        var bfit = K.fitText(ctx, rel.brand, { size: 46, minSize: 30, weight: 800, maxWidth: W - M * 2, maxLines: 1 });
        ctx.font = f(bfit.size, 800, /^[\x20-\x7E・]+$/.test(rel.brand) ? LATIN : S.family);
        ctx.fillStyle = topInk;
        ctx.fillText(bfit.lines[0], M, 148);
      }

      // 写真の下端に、確認できた情報のラベル
      var x = M;
      (rel.labels ? rel.labels : ['NEW']).slice(0, 3).forEach(function (t) {
        x += pillText(ctx, t, x, PH - 34 - 58, { font: f(30, 800, GOTHIC), fill: P.label, color: P.labelText, h: 58, r: 4, padX: 20 }) + 10;
      });

      // タイトル（短いキャッチコピー）。右下のくまと重ならない幅
      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        x: M, y: PH + 128, size: 92, minSize: 60, maxWidth: W - M * 2 - 150, weight: 800, family: S.family, color: P.ink, accentColor: P.accent, lineHeight: 1.2
      });
      // 商品名と、発売日・予約の情報
      var heroItem = (d.items || []).filter(function (it) { return it.hero; })[0] || (d.items || [])[0];
      var more = (d.items || []).length - 1;
      var lines = [
        heroItem && heroItem.shortName ? heroItem.shortName : '',
        [rel.dateText, more > 0 ? 'ほか' + more + '点も紹介' : ''].filter(Boolean).join('　')
      ].filter(Boolean);
      var y = Math.min(t.bottom + 84, H - 40 - lines.length * 46);
      lines.forEach(function (l, i) {
        var fit = K.fitText(ctx, l, { size: 32, minSize: 24, weight: i ? 600 : 800, maxWidth: W - M * 2 - 200, maxLines: 1 });
        ctx.font = f(fit.size, i ? 600 : 800, GOTHIC);
        ctx.fillStyle = i ? P.sub : P.ink;
        ctx.fillText(fit.lines[0], M, y + i * 46);
      });
      bearCorner(ctx, d, P.sub, 140);
    },

    // 買っとけ：カーキ・オリーブ・生成り。実用品カタログのようなチェックリスト。断定は強め、派手にはしない
    buy_this_first: function (ctx, d) {
      ctx.fillStyle = '#5E6B3C'; ctx.fillRect(0, 0, W, 640);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      for (var i = 0; i < W; i += 24) ctx.fillRect(i, 0, 2, 640); // 生地のような細い縦線
      ctx.fillStyle = '#E8D9A8'; ctx.fillRect(M, 110, 10, 52);
      ctx.font = f(44, 800); ctx.fillStyle = '#EFEADB';
      ctx.fillText(K.ACCOUNT.name + 'の', M + 32, 152);
      var t = drawTitle(ctx, d.cover.title, d.cover.accent, {
        x: M, y: 320, size: 140, minSize: 80, maxWidth: W - M * 2, weight: 900, color: '#FFFFFF', accentColor: '#E8D9A8', lineHeight: 1.2
      });
      ctx.font = f(44, 700); ctx.fillStyle = '#EFEADB';
      ctx.fillText(d.cover.sub || '', M, Math.min(t.bottom + 100, 600));

      ctx.fillStyle = '#EFEADB'; ctx.fillRect(0, 640, W, H - 640);
      // チェックリスト（選んだ商品の短い名前）
      var names = (d.items || []).map(function (it) { return it.shortName; }).filter(Boolean).slice(0, 5);
      ctx.font = f(28, 700, LATIN); ctx.fillStyle = '#5E6B3C';
      ctx.fillText(spaced('CHECK LIST'), M, 720);
      names.forEach(function (n, i) {
        var y = 790 + i * 92;
        ctx.strokeStyle = '#5E6B3C'; ctx.lineWidth = 4;
        ctx.strokeRect(M, y, 46, 46);
        ctx.beginPath(); ctx.moveTo(M + 10, y + 24); ctx.lineTo(M + 21, y + 36); ctx.lineTo(M + 40, y + 10); ctx.stroke();
        var fit = K.fitText(ctx, n, { size: 40, minSize: 28, weight: 700, maxWidth: 470, maxLines: 1 });
        ctx.font = f(fit.size, 700); ctx.fillStyle = '#2E3320';
        ctx.fillText(fit.lines[0], M + 70, y + 38);
        ctx.fillStyle = 'rgba(94,107,60,0.25)'; ctx.fillRect(M, y + 66, 540, 2);
      });
      drawProducts(ctx, (d.images || []).slice(0, 2), { x: 680, y: 690, w: W - 680 - 50, h: 380 }, { max: 2, gap: 10 });
      bearCorner(ctx, d, '#2E3320', 180);
    }
  };

  function centerTextAt(ctx, text, cx, y, font, color) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, y);
    ctx.textAlign = 'left';
  }

  R.COVERS = COVERS;
  R.COVER_STYLES = STYLES.map(function (s) { return { id: s[0], name: s[1] }; });
  R.PALETTES = PALETTES;
})();
