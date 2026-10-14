(function () {
  'use strict';

  var TARGET_MIN = 150;
  var TARGET_MAX = 200;
  var TARGET_MID = 175;
  var MAX_FEATURES = 3;

  // 文章テンプレート。
  // 実際に使用したと受け取れる表現（「使っています」「愛用」など）や
  // 大げさな広告表現は入れない。
  // 商品ジャンルを問わず使える文だけを置き、「毎日使うもの」のように
  // 用途やジャンルを決めつける一般文は入れない。
  var OPENINGS = [
    '{name}を紹介します。',
    '{name}が良さそうだったので紹介します。',
    '{name}を見つけました。',
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

  // 入力された特徴から用途を推測した一言。
  // 根拠のない断定を避けるため、「〜そう」「〜かも」などの推測の形にする。
  // 上から順に判定し、当てはまったものを最大2つまで使う。
  var USAGE_RULES = [
    {
      re: /防災|非常|緊急|停電|災害|備蓄|避難|長期保存/,
      hints: [
        '家にひとつ置いておくと安心できそうです。',
        'いざという時の備えとして用意しておくのも良さそうです。',
        '家だけでなく、車に積んでおく用としても良さそうです。'
      ]
    },
    {
      re: /車載|車内|車用|カー用品|ドライブ|シガーソケット/,
      hints: [
        '車で出かけることが多い人には便利そうです。',
        'ドライブのお供としても使いやすそうです。'
      ]
    },
    {
      re: /キャンプ|アウトドア|登山|レジャー|ピクニック/,
      hints: [
        'キャンプなど外で過ごすときにも役立ちそうです。',
        'アウトドア用にひとつ持っておくのも良さそうです。'
      ]
    },
    {
      re: /旅行|トラベル|出張|帰省/,
      hints: [
        '旅行や出張に持っていく用としても良さそうです。'
      ]
    },
    {
      re: /持ち運|持ち歩|携帯|ポケットサイズ|コンパクト|軽量/,
      hints: [
        'かばんに入れておく用としても良さそうです。',
        '外出先に持っていきたい人には使いやすそうです。'
      ]
    },
    {
      re: /セット|個入|枚入|本入|袋入|まとめ買い|大容量|詰め替え|\d+(個|枚|本|袋|組)/,
      hints: [
        'まとめて揃えたい人には使いやすそうです。',
        'ストック用に用意しておきたい人にも向いていそうです。'
      ]
    },
    {
      re: /ギフト|プレゼント|贈り物|贈答|ラッピング|のし/,
      hints: [
        'ちょっとした贈り物の候補にもなりそうです。'
      ]
    },
    {
      re: /食洗機|丸洗い|洗える|お手入れ|手入れ|汚れが落ち/,
      hints: [
        'お手入れの手間を減らしたい人には選びやすそうです。'
      ]
    },
    {
      re: /収納|省スペース|スリム|薄型|スタッキング|積み重ね|折りたたみ|折り畳み|たためる/,
      hints: [
        '置き場所が限られている家でも取り入れやすそうです。'
      ]
    },
    {
      re: /デスク|在宅|テレワーク|オフィス|仕事用/,
      hints: [
        'デスクまわりに置く用としても良さそうです。'
      ]
    },
    {
      re: /キッズ|子ども|子供|ベビー|赤ちゃん|ファミリー/,
      hints: [
        '子どもがいる家庭でも取り入れやすそうです。'
      ]
    },
    {
      re: /防水|撥水|はっ水|晴雨兼用/,
      hints: [
        '天気を気にせず使えそうなのも良いところです。'
      ]
    }
  ];

  // 字数が足りないときだけ使う補足。どのジャンルにも矛盾しないよう、
  // 「商品ページを見た感想」にとどめる。
  var FILLERS = [
    '',
    '商品ページを見た限りでは、特徴がわかりやすくまとまっている印象です。',
    '特徴がはっきりしているので、似た商品と比べるときにも選びやすそうです。',
    '特徴がはっきりしているので、似た商品と比べるときにも選びやすそうです。商品ページを見た限りでは、説明もわかりやすくまとまっている印象です。'
  ];

  var CAUTIONS = [
    'ただ、{c}とのことなので、購入前に確認しておくと安心です。',
    'なお、{c}という点は事前に確認しておきたいところです。'
  ];

  // 締めの一言。毎回「おすすめです」のように締めず、
  // 締めの文を置かずに用途の一言や注意点で終わるパターンも含める。
  var CLOSINGS = [
    '',
    '気になる方はチェックしてみてください。',
    '似たものを探している方の候補にどうぞ。',
    '詳しい仕様は商品ページで確認してみてください。',
    'しばらく候補に入れておこうと思います。',
    '個人的には、ちょっと気になっている商品です。'
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

  function findUsageHints(text) {
    return USAGE_RULES
      .filter(function (rule) { return rule.re.test(text); })
      .slice(0, 2)
      .map(function (rule) { return rule.hints; });
  }

  // 用途の一言の組み合わせ。当てはまるルールがあれば必ず1つは入れる。
  function buildHintBlocks(hintGroups) {
    if (hintGroups.length === 0) return [''];
    var blocks = hintGroups[0].slice();
    if (hintGroups.length > 1) {
      hintGroups[0].forEach(function (h1) {
        hintGroups[1].forEach(function (h2) { blocks.push(h1 + h2); });
      });
    }
    return blocks;
  }

  function buildCandidates(name, features, caution, hintGroups) {
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

    var hintBlocks = buildHintBlocks(hintGroups);
    var cautionBlocks = caution ? CAUTIONS.map(function (t) { return fill(t, values); }) : [''];
    var candidates = [];

    OPENINGS.forEach(function (opening) {
      var open = fill(opening, values);
      featureBlocks.forEach(function (feature) {
        hintBlocks.forEach(function (hint) {
          FILLERS.forEach(function (fillerTemplate) {
            var filler = fill(fillerTemplate, values);
            cautionBlocks.forEach(function (cautionText) {
              CLOSINGS.forEach(function (closing) {
                candidates.push({
                  text: open + feature + hint + filler + cautionText + closing,
                  fillerLength: countChars(filler)
                });
              });
              // 注意点のあとに用途の一言を置き、その一言で締めるパターン
              if (hint && cautionText) {
                candidates.push({
                  text: open + feature + filler + cautionText + hint,
                  fillerLength: countChars(filler)
                });
              }
            });
          });
        });
      });
    });

    return candidates;
  }

  function pickText(candidates) {
    var inRange = candidates.filter(function (c) {
      var len = countChars(c.text);
      return len >= TARGET_MIN && len <= TARGET_MAX;
    });

    if (inRange.length > 0) {
      // 汎用的な補足文はできるだけ少ない候補を優先する
      var minFiller = Math.min.apply(null, inRange.map(function (c) { return c.fillerLength; }));
      var best = inRange.filter(function (c) { return c.fillerLength === minFiller; });
      var pool = best.length > 1
        ? best.filter(function (c) { return c.text !== lastText; })
        : best;
      return pool[Math.floor(Math.random() * pool.length)].text;
    }

    // 範囲内に収まる組み合わせがなければ、目標字数に近いものから選ぶ
    var distance = function (c) {
      var len = countChars(c.text);
      return len < TARGET_MIN ? TARGET_MIN - len : len - TARGET_MAX;
    };
    var minDistance = Math.min.apply(null, candidates.map(distance));
    var near = candidates.filter(function (c) { return distance(c) <= minDistance + 10; });
    var nearPool = near.length > 1
      ? near.filter(function (c) { return c.text !== lastText; })
      : near;
    return nearPool[Math.floor(Math.random() * nearPool.length)].text;
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

    var hintGroups = findUsageHints([name].concat(features).join('\n'));
    var text = pickText(buildCandidates(name, features, caution, hintGroups));
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
