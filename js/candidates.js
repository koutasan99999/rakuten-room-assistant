(function () {
  'use strict';

  var GENRES = ['収納', 'キッチン', '掃除', '車内', '防災'];
  var GENRE_CLASSES = {
    '収納': 'genre-storage',
    'キッチン': 'genre-kitchen',
    '掃除': 'genre-cleaning',
    '車内': 'genre-car',
    '防災': 'genre-disaster'
  };

  var list = document.getElementById('picks-list');
  var dateLabel = document.getElementById('picks-date');
  var form = document.getElementById('intro-form');
  var nameInput = document.getElementById('product-name');
  var featuresInput = document.getElementById('features');
  var cautionsInput = document.getElementById('cautions');
  var formError = document.getElementById('form-error');
  var prefillStatus = document.getElementById('prefill-status');
  var output = document.getElementById('output');
  var submitBtn = form.querySelector('button[type="submit"]');

  // 日付ごとに各ジャンルから1件ずつ選ぶ（候補が複数あれば日替わり）
  function getTodayCandidates(date) {
    var pool = window.CANDIDATE_POOL || {};
    var dayNumber = Math.floor(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
    );
    return GENRES
      .filter(function (genre) { return pool[genre] && pool[genre].length > 0; })
      .map(function (genre) {
        var items = pool[genre];
        var item = items[dayNumber % items.length];
        return {
          genre: genre,
          name: item.name,
          features: item.features,
          caution: item.caution || ''
        };
      });
  }

  function formatDate(date) {
    var week = ['日', '月', '火', '水', '木', '金', '土'];
    return (date.getMonth() + 1) + '月' + date.getDate() + '日（' + week[date.getDay()] + '）';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function renderCard(candidate) {
    var card = el('li', 'pick-card');

    card.appendChild(el('span', 'genre-badge ' + (GENRE_CLASSES[candidate.genre] || ''), candidate.genre));
    card.appendChild(el('h3', 'pick-name', candidate.name));

    var features = el('ul', 'pick-features');
    candidate.features.forEach(function (feature) {
      features.appendChild(el('li', '', feature));
    });
    card.appendChild(features);

    var button = el('button', 'btn btn-outline', 'この商品で紹介文を作る');
    button.type = 'button';
    button.addEventListener('click', function () {
      prefillForm(candidate);
    });
    card.appendChild(button);

    return card;
  }

  // 既存の紹介文フォームに商品情報を入力する
  function prefillForm(candidate) {
    nameInput.value = candidate.name;
    featuresInput.value = candidate.features.join('\n');
    cautionsInput.value = candidate.caution;
    formError.hidden = true;

    // 前の商品の紹介文が残らないよう出力欄を空にする（字数表示なども更新される）
    output.value = '';
    output.dispatchEvent(new Event('input'));

    prefillStatus.textContent = '「' + candidate.name + '」の情報を入力しました。内容を確認して「紹介文を作る」を押してください。';
    prefillStatus.hidden = false;

    form.classList.remove('is-prefilled');
    // アニメーションを再生し直すためにリフローさせる
    void form.offsetWidth;
    form.classList.add('is-prefilled');

    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // スマホでキーボードが開かないよう、入力欄ではなくボタンにフォーカスする
    submitBtn.focus({ preventScroll: true });
  }

  function render() {
    var today = new Date();
    dateLabel.textContent = formatDate(today);
    getTodayCandidates(today).forEach(function (candidate) {
      list.appendChild(renderCard(candidate));
    });
  }

  form.addEventListener('submit', function () {
    prefillStatus.hidden = true;
  });

  render();
})();
