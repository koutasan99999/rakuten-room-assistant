(function () {
  'use strict';

  var TARGET_MIN = 150;
  var TARGET_MAX = 200;
  var TARGET_MID = 175;
  var MAX_FEATURES = 3;

  // 文章テンプレート。
  // 実際に使用したと受け取れる表現（「使っています」「愛用」など）や
  // 大げさな広告表現は入れない。
  var OPENINGS = [
    '{name}を紹介します。',
    '{name}が良さそうだったので紹介します。',
    '今回は{name}を取り上げます。',
    '前から気になっていた{name}を紹介します。'
  ];

  var FEATURE_ONE = [
    '{f1}というところが魅力です。',
    'ポイントは、{f1}というところ。'
  ];

  var FEATURE_TWO = [
    '{f1}という点に加えて、{f2}というのもうれしいところです。',
    'ポイントは、{f1}というところ。{f2}という点も良いなと思いました。'
  ];

  var FEATURE_THIRD = [
    'さらに、{f3}という点も見ておきたいポイントです。',
    'ほかにも、{f3}という特徴があります。'
  ];

  var FILLERS = [
    '',
    '毎日使うものだからこそ、こうした細かい部分が選ぶ決め手になりそうです。',
    'シンプルながら、必要なところをきちんと押さえている印象です。',
    '毎日使うものだからこそ、こうした細かい部分が選ぶ決め手になりそうです。派手さはないものの、必要なところをきちんと押さえている印象です。'
  ];

  var CAUTIONS = [
    'ただ、{c}とのことなので、購入前に確認しておくと安心です。',
    'なお、{c}という点は事前に確認しておきたいところです。'
  ];

  var CLOSINGS = [
    '気になる方はチェックしてみてください。',
    '選ぶときの参考になればうれしいです。',
    '似たものを探している方の候補にどうぞ。',
    '商品ページで詳しい仕様も確認しつつ、選ぶときの参考にしてみてください。'
  ];

  // 入力内容に含まれていたら注意を促す表現
  var NG_PATTERNS = [
    { re: /愛用/, label: '「愛用」' },
    { re: /使って(い|み|ま)/, label: '「使っています」などの使用体験の表現' },
    { re: /リピ/, label: '「リピート」などの使用体験の表現' },
    { re: /最高|最強|絶対|間違いな|神アイテム|必見|今すぐ|激安|大人気|爆売れ/, label: '大げさな広告表現' }
  ];
  var EMOJI_RE = /\p{Extended_Pictographic}/u;

  var form = document.getElementById('intro-form');
  var nameInput = document.getElementById('product-name');
  var featuresInput = document.getElementById('features');
  var cautionsInput = document.getElementById('cautions');
  var formError = document.getElementById('form-error');
  var output = document.getElementById('output');
  var charCount = document.getElementById('char-count');
  var warning = document.getElementById('warning');
  var copyBtn = document.getElementById('copy-btn');
  var regenerateBtn = document.getElementById('regenerate-btn');
  var copyStatus = document.getElementById('copy-status');

  var lastText = '';

  function countChars(text) {
    return Array.from(text).length;
  }

  // 行頭の箇条書き記号と行末の句読点を取り除く
  function cleanPhrase(text) {
    return text
      .trim()
      .replace(/^[・\-*●○■□◆◇>＞\s]+/, '')
      .replace(/[。．.！!、,，\s]+$/, '')
      .trim();
  }

  function splitLines(text) {
    return text
      .split(/\r?\n/)
      .map(cleanPhrase)
      .filter(function (line) { return line.length > 0; });
  }

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (_, key) {
      return values[key] || '';
    });
  }

  function buildCandidates(name, features, caution) {
    var values = { name: name, f1: features[0], f2: features[1], f3: features[2], c: caution };
    var featureBlocks = [];

    if (features.length === 1) {
      FEATURE_ONE.forEach(function (t) { featureBlocks.push(fill(t, values)); });
    } else {
      FEATURE_TWO.forEach(function (t) {
        var base = fill(t, values);
        featureBlocks.push(base);
        if (features.length >= 3) {
          FEATURE_THIRD.forEach(function (t3) { featureBlocks.push(base + fill(t3, values)); });
        }
      });
    }

    var cautionBlocks = caution ? CAUTIONS.map(function (t) { return fill(t, values); }) : [''];
    var candidates = [];

    OPENINGS.forEach(function (opening) {
      var open = fill(opening, values);
      featureBlocks.forEach(function (feature) {
        FILLERS.forEach(function (filler) {
          cautionBlocks.forEach(function (cautionText) {
            CLOSINGS.forEach(function (closing) {
              candidates.push(open + feature + filler + cautionText + closing);
            });
          });
        });
      });
    });

    return candidates;
  }

  function pickText(candidates) {
    var inRange = candidates.filter(function (text) {
      var len = countChars(text);
      return len >= TARGET_MIN && len <= TARGET_MAX;
    });

    if (inRange.length > 0) {
      var pool = inRange.length > 1
        ? inRange.filter(function (text) { return text !== lastText; })
        : inRange;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // 範囲内に収まる組み合わせがなければ、目標字数に最も近いものを使う
    return candidates.reduce(function (best, text) {
      var diff = Math.abs(countChars(text) - TARGET_MID);
      var bestDiff = Math.abs(countChars(best) - TARGET_MID);
      return diff < bestDiff ? text : best;
    });
  }

  function findIssues(text) {
    var issues = NG_PATTERNS
      .filter(function (p) { return p.re.test(text); })
      .map(function (p) { return p.label; });
    if (EMOJI_RE.test(text)) {
      issues.push('絵文字');
    }
    return issues;
  }

  function updateMeta() {
    var text = output.value;
    var len = countChars(text);
    charCount.textContent = len + '字（目安 ' + TARGET_MIN + '〜' + TARGET_MAX + '字）';
    charCount.classList.toggle('is-out', len > 0 && (len < TARGET_MIN || len > TARGET_MAX));

    var issues = findIssues(text);
    if (issues.length > 0) {
      warning.textContent = issues.join('、') + 'が含まれています。実際の使用状況や表現を確認してください。';
      warning.hidden = false;
    } else {
      warning.hidden = true;
    }

    copyBtn.disabled = text.trim().length === 0;
    copyStatus.textContent = '';
  }

  function generate() {
    var name = cleanPhrase(nameInput.value);
    var features = splitLines(featuresInput.value).slice(0, MAX_FEATURES);
    var caution = splitLines(cautionsInput.value).join('、');

    var missing = [];
    if (!name) missing.push('商品名');
    if (features.length === 0) missing.push('商品の特徴');
    if (missing.length > 0) {
      formError.textContent = missing.join('と') + 'を入力してください。';
      formError.hidden = false;
      (name ? featuresInput : nameInput).focus();
      return;
    }
    formError.hidden = true;

    var text = pickText(buildCandidates(name, features, caution));
    lastText = text;
    output.value = text;
    regenerateBtn.disabled = false;
    updateMeta();
  }

  function fallbackCopy(text) {
    output.focus();
    output.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    output.setSelectionRange(text.length, text.length);
    return ok;
  }

  function copy() {
    var text = output.value;
    if (!text) return;

    var done = function (ok) {
      copyStatus.textContent = ok ? 'コピーしました' : 'コピーできませんでした。長押しで選択してコピーしてください。';
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        function () { done(true); },
        function () { done(fallbackCopy(text)); }
      );
    } else {
      done(fallbackCopy(text));
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    generate();
  });
  regenerateBtn.addEventListener('click', generate);
  copyBtn.addEventListener('click', copy);
  output.addEventListener('input', updateMeta);

  updateMeta();
})();
