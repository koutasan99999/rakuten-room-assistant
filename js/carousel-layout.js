// Instagramカルーセルの「どのスライドに、どの商品を何個のせるか」を決める部品。
// 商品が少なければ今までどおり1商品1枚、多ければ 1（特集）・2（比較）・3（雑誌）・4（一覧）商品のスライドを組み合わせて、
// Instagram公式APIのカルーセル上限（MAX_SLIDES）に収める。商品は勝手に減らさない。
// （ブラウザでは window.CarouselLayout、テストでは globalThis.CarouselLayout として使う）
(function () {
  'use strict';

  // Instagram公式API（コンテンツ公開）のカルーセルは最大10枚（2026年時点の仕様）。変わったらここだけ直す
  var MAX_SLIDES = 10;
  var MAX_ITEMS = 20;
  var LAYOUTS = {
    1: { id: 'feature', name: '特集（1商品を大きく）' },
    2: { id: 'duo', name: '比較（2商品）' },
    3: { id: 'trio', name: '雑誌（3商品）' },
    4: { id: 'grid4', name: '一覧（4商品）' }
  };

  // 残りの商品を、決めた枚数のスライドに2〜4個ずつ、なるべく均等に分ける（前のスライドを多めに）
  function spread(count, slides) {
    var base = Math.floor(count / slides);
    var extra = count % slides;
    var out = [];
    for (var i = 0; i < slides; i++) out.push(base + (i < extra ? 1 : 0));
    return out;
  }

  // 自動の配置：商品スライドに使える枚数に収まるよう、1スライドの商品数（sizes）を決める
  function autoSizes(n, budget) {
    if (n <= 0) return [];
    if (n <= budget) return Array(n).fill(1); // 今までどおり1商品1枚
    // 1枚目は特集（一番見てほしい商品を大きく）。残りは2〜3個ずつを基本に、入りきらなければ4個まで
    var rest = n - 1;
    var room = budget - 1;
    // 少しだけ多いときは枠を全部使って1〜2個ずつ（大きく見せる）。多いときは2〜3個ずつ
    var slides = rest <= room * 2 ? room : Math.min(room, Math.ceil(rest / 2.5));
    if (rest / slides > 4) return null; // 4個ずつでも入りきらない
    return [1].concat(spread(rest, slides));
  }

  function slideNames(sizes) {
    return sizes.map(function (s) { return LAYOUTS[s].id; });
  }

  // 商品スライドの組み立て。sizes を渡せば（ユーザーが変えた配置）、それに合わせて商品を順番に詰める。
  // 合計が商品数に足りなければ3個ずつのスライドを足し、多ければ最後を減らす（商品は消さない）
  function fitSizes(n, sizes) {
    var out = [];
    var left = n;
    (sizes || []).forEach(function (s) {
      if (left <= 0) return;
      var c = Math.max(1, Math.min(4, Number(s) || 1, left));
      out.push(c);
      left -= c;
    });
    while (left > 0) {
      var c = Math.min(3, left);
      out.push(c);
      left -= c;
    }
    return out;
  }

  // n: 商品数、opts: { summary: 2枚目のまとめを入れるか, sizes: ユーザーが決めた配置（任意）, maxSlides }
  // 戻り値: { slides: [{ kind: 'cover' | 'summary' | 'items' | 'cta', layout, items: [商品の番号] }], total, itemSlides,
  //          overLimit, reason, suggestions, auto }
  function plan(n, opts) {
    opts = opts || {};
    var max = opts.maxSlides || MAX_SLIDES;
    var fixed = 2 + (opts.summary ? 1 : 0); // 表紙・ROOM誘導（・まとめ）
    var budget = max - fixed;
    var auto = !opts.sizes;
    var sizes = auto ? autoSizes(n, budget) : fitSizes(n, opts.sizes);
    if (!sizes) sizes = fitSizes(n, Array(Math.ceil(n / 4)).fill(4));
    var slides = [{ kind: 'cover' }];
    if (opts.summary) slides.push({ kind: 'summary' });
    var at = 0;
    sizes.forEach(function (s) {
      var items = [];
      for (var i = 0; i < s; i++) items.push(at + i);
      at += s;
      slides.push({ kind: 'items', layout: LAYOUTS[s].id, size: s, items: items });
    });
    slides.push({ kind: 'cta' });
    var total = slides.length;
    var result = { slides: slides, total: total, itemSlides: sizes.length, sizes: sizes, auto: auto, overLimit: total > max, maxSlides: max, reason: '', suggestions: [] };
    if (result.overLimit) {
      // 自動投稿できない構成：商品は消さず、理由と調整案を出す
      result.reason = 'Instagram公式APIで自動投稿できるカルーセルは' + max + '枚までですが、この構成は' + total + '枚になります。';
      var over = total - max;
      if (opts.summary) result.suggestions.push('2枚目の「まとめ」を外すと1枚減ります');
      var smaller = sizes.filter(function (s) { return s < 4; }).length;
      if (smaller) result.suggestions.push('商品の多いスライド（雑誌3商品・一覧4商品）を増やすと、あと' + over + '枚減らせます');
      result.suggestions.push('「自動の配置に戻す」で、' + max + '枚に収まる配置にできます');
      if (n > MAX_ITEMS) result.suggestions.push('1投稿は' + MAX_ITEMS + '商品までにすると、きれいに収まります');
    }
    return result;
  }

  globalThis.CarouselLayout = {
    MAX_SLIDES: MAX_SLIDES,
    MAX_ITEMS: MAX_ITEMS,
    LAYOUTS: LAYOUTS,
    plan: plan,
    autoSizes: autoSizes,
    slideNames: slideNames
  };
})();
