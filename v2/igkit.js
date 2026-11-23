// サングラスくま株式会社 2.0：Instagramに貼る画像と、楽天ROOMの登録（2026-11-16 社長の依頼「1.0の時みたいに」）
// 画像は1.0と同じ部品（../js/ig-render.js・ig-covers.js・ig-multi.js・carousel-layout.js）で、この端末の中で描く（AIは呼ばない・費用0円）
//   1枚目：サングラスくまの表紙画像（AI生成イメージ）にタイトルを重ねる／商品カード（楽天の商品写真・価格・短い名前）／最後：ROOMへの案内
(function () {
  'use strict';
  var PASS_KEY = 'room-passcode';
  function pass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  // 楽天の商品画像は、このアプリのサーバー経由で読み込む（余白の切り取りに必要。1.0と同じ）
  function loadProductImage(url) {
    if (!url) return Promise.resolve(null);
    return fetch('../api/image?url=' + encodeURIComponent(url), { headers: { 'X-App-Passcode': pass() } })
      .then(function (res) { if (!res.ok) throw new Error('image'); return res.blob(); })
      .then(function (blob) { return window.IgRender.loadImage(URL.createObjectURL(blob)); })
      .then(function (img) { return window.IgRender.trimImage(img); })
      .catch(function () { return null; });
  }
  function canvasToBlob(canvas) { return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); }); }
  // 完成品（/api/v2 の set）から、1.0と同じ型の投稿画像を作る
  function buildSlides(s) {
    if (!window.IgRender) return Promise.reject(new Error('画像の部品を読み込めませんでした'));
    var images = Promise.all(s.products.map(function (p) { return loadProductImage(p.image); }));
    var bear = window.IgRender.loadImage('../assets/kuma.png').catch(function () { return null; });
    var photo = s.image && s.image.url ? window.IgRender.loadImage('..' + s.image.url).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([images, bear, photo]).then(function (r) {
      var sl = s.slides || {};
      var post = {
        topic: sl.topic || s.title, category: sl.category || '', subtitle: sl.sub || '',
        cover: r[2] ? { style: 'kuma_scene', title: s.title, accent: '', sub: sl.sub || '', badge: '', price: '' } : null,
        bear: r[1], coverPhoto: r[2] || null, coverHero: true,
        items: s.products.map(function (p, i) { return { no: p.no || '', image: r[0][i], shortName: p.shortName || p.short, subline: p.subline || '', memo: p.memo || '', price: p.price, role: p.role, point: p.subline || '' }; })
      };
      var slides = window.IgRender.renderPost(post);
      return Promise.all(slides.map(function (x) { return canvasToBlob(x.canvas); })).then(function (blobs) {
        return { files: slides.map(function (x, i) { return { name: x.fileName, blob: blobs[i] }; }), urls: blobs.map(function (b) { return URL.createObjectURL(b); }), missing: r[0].filter(function (x) { return !x; }).length, cover: !!r[2] };
      });
    });
  }
  // iPhoneでは共有シート（「画像を保存」で写真に入る）、それ以外はダウンロード
  function saveFiles(files) {
    var list = files.map(function (f) { return new File([f.blob], f.name, { type: 'image/png' }); });
    if (navigator.canShare && navigator.canShare({ files: list })) return navigator.share({ files: list }).catch(function () {});
    files.forEach(function (f) { var a = document.createElement('a'); a.href = URL.createObjectURL(f.blob); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); });
    return Promise.resolve();
  }
  // 楽天ROOMの登録（コレ！）画面：商品番号を指定して開く（1.0と同じURL）
  // その場で（ボタンを押したその瞬間に）コピーする。iPhoneでは別の画面を開いたあとのコピーは断られるため、ROOMを開く前に必ず済ませる（2026-11-16 社長の報告で修正）
  function copyNow(text) {
    var ok = false;
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.fontSize = '16px';
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
    // その場のコピーができなかったときだけ、もう1つの方法も試す（結果はあとで分かるので、成功とは扱わない）
    if (!ok && navigator.clipboard && window.isSecureContext) { try { navigator.clipboard.writeText(text).catch(function () {}); } catch (e) {} }
    return ok;
  }
  function roomUrl(code) { return 'https://room.rakuten.co.jp/mix?itemcode=' + encodeURIComponent(code).replace(/%3A/gi, ':') + '&scid=we_room_upc60'; }
  window.V2Ig = { buildSlides: buildSlides, saveFiles: saveFiles, roomUrl: roomUrl, copyNow: copyNow, loadImage: loadProductImage };
})();
