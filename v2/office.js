// サングラスくま株式会社 2.0：見下ろし型のドット絵オフィス（2026-11-15）
// 社員の動きは、サーバーの「今の仕事」と「出来事の記録」だけで決める（app.js が update / handoff を呼ぶ）。
//   work＝自分の机でキーボードを打つ／wait＝机で砂時計（画像の予算待ちなど）／idle＝休憩スペースで待機（働いているふりはしない）
(function () {
  'use strict';
  var W = 192, H = 240;
  var OUTFIT = { buyer: '#2f6f9f', auditor: '#3d7a4f', planner: '#a0522d', writer: '#7b4fa0', editor: '#b5893a', designer: '#c0504d', pr: '#2b2b2b', appraiser: '#3b6e8f' };
  var DESK = { buyer: [34, 86], auditor: [158, 86], planner: [34, 128], writer: [158, 128], editor: [34, 170], designer: [158, 170], pr: [96, 196], appraiser: [150, 50] };
  var LOUNGE = { buyer: [130, 214], auditor: [146, 214], planner: [162, 214], writer: [178, 214], editor: [138, 230], designer: [154, 230], pr: [170, 230], appraiser: [186, 230] };
  var BEAR = [
    '.oo......oo.',
    'occo....occo',
    'occcooooccco',
    'occcccccccco',
    'oggggccggggo',
    'ogsggooggsgo',
    'occcllllccco',
    '.occlollocco',
    '..occccccco.',
    '.obbbbbbbbo.',
    'obbbbbbbbbbo',
    'ocbbbbbbbbco',
    '.obbbbbbbbo.',
    '..oo....oo..'
  ];
  var TYPE = BEAR.slice(); TYPE[10] = 'obcbbbbbbcbo'; TYPE[11] = 'obbbbbbbbbbo';
  var STEP = BEAR.slice(); STEP[13] = '..oo.....oo.';
  var PAL = { o: '#3b2a1e', c: '#c8955c', l: '#ecd0a3', g: '#111111', s: '#6b6b6b' };

  var ctx, labels, onTap, staff = [], pos = {}, papers = [], frame = 0, last = 0, built = false;

  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
  function sprite(map, x, y, outfit) {
    for (var r = 0; r < map.length; r++) for (var i = 0; i < map[r].length; i++) {
      var ch = map[r][i]; if (ch === '.') continue;
      px(x + i, y + r, 1, 1, ch === 'b' ? outfit : PAL[ch]);
    }
  }
  function room() {
    // 床（木の板）
    for (var y = 30; y < H; y += 6) for (var x = 0; x < W; x += 24) { var off = (y / 6) % 2 ? 12 : 0; px(x - off, y, 24, 6, ((x + y) / 6) % 3 ? '#c99c6b' : '#c39463'); px(x - off, y + 5, 24, 1, '#ab7f52'); px(x - off + 23, y, 1, 6, '#ab7f52'); }
    // 壁・窓・時計
    px(0, 0, W, 30, '#6d5c49'); px(0, 26, W, 4, '#4d4033');
    [[14, 6], [150, 6]].forEach(function (p) { px(p[0], p[1], 28, 16, '#3a3027'); px(p[0] + 2, p[1] + 2, 24, 12, '#9fd3e6'); px(p[0] + 13, p[1] + 2, 2, 12, '#3a3027'); px(p[0] + 2, p[1] + 7, 24, 1, '#3a3027'); });
    px(60, 5, 72, 15, '#2b2620'); px(61, 6, 70, 13, '#3a332b'); // 看板（文字は画面の文字で重ねる）
    // 社長の席（社長は本物の人なので、AIのくまは座らせない）
    px(80, 38, 32, 10, '#7a4f2c'); px(80, 47, 32, 2, '#5b3a20'); px(90, 50, 12, 8, '#8b1e1e'); px(92, 58, 8, 2, '#5a1212');
    px(84, 34, 6, 5, '#2e7d32'); px(85, 39, 4, 2, '#6d4c41'); // 小さな植物
    // 会議スペース
    px(76, 112, 40, 22, '#8a5a33'); px(76, 132, 40, 2, '#5b3a20');
    [[72, 116], [72, 126], [118, 116], [118, 126], [86, 106], [100, 106], [86, 136], [100, 136]].forEach(function (c) { px(c[0], c[1], 6, 6, '#4f6d7a'); });
    px(90, 118, 12, 8, '#f3efe6'); px(92, 120, 8, 1, '#999'); px(92, 122, 6, 1, '#999');
    // 休憩スペース（待機の場所）：ソファ・コーヒー・植物
    px(120, 196, 70, 44, '#b9a27f'); px(121, 197, 68, 42, '#c7b08b'); // ラグ
    px(122, 206, 66, 8, '#7d4b3a'); px(122, 204, 66, 3, '#5e382b'); // ソファ
    px(184, 222, 6, 6, '#6d4c41');
    px(4, 206, 12, 18, '#4a4a4a'); px(6, 208, 8, 5, '#222'); px(8, 216, 4, 3, '#eee');
    [[4, 34], [182, 34], [118, 200]].forEach(function (p) { px(p[0] + 1, p[1] + 8, 6, 6, '#8d5a3b'); px(p[0], p[1], 8, 9, '#2e7d32'); px(p[0] + 2, p[1] - 2, 4, 3, '#43a047'); });
    // 社員の机
    Object.keys(DESK).forEach(function (id) { var d = DESK[id]; px(d[0] - 13, d[1], 26, 9, '#8a5a33'); px(d[0] - 13, d[1] + 8, 26, 2, '#5b3a20'); px(d[0] - 6, d[1] + 12, 12, 6, '#4f6d7a'); });
  }
  function monitor(d, on) { px(d[0] - 5, d[1] - 2, 10, 7, '#222'); px(d[0] - 4, d[1] - 1, 8, 5, on ? '#7fd1ff' : '#333'); px(d[0] - 1, d[1] + 5, 2, 1, '#222'); }

  function targetOf(s) { return s.status === 'idle' ? LOUNGE[s.id] : [DESK[s.id][0], DESK[s.id][1] - 11]; }
  function draw(t) {
    frame = Math.floor(t / 280);
    ctx.clearRect(0, 0, W, H);
    room();
    staff.forEach(function (s) {
      var p = pos[s.id]; if (!p) return;
      var tg = targetOf(s);
      var moving = Math.abs(p.x - tg[0]) > 0.5 || Math.abs(p.y - tg[1]) > 0.5;
      if (moving) { p.x += (tg[0] - p.x) * 0.12; p.y += (tg[1] - p.y) * 0.12; }
      var atDesk = !moving && s.status !== 'idle';
      var d = DESK[s.id];
      monitor(d, atDesk && (s.status === 'work' || s.status === 'turn'));
      var map = moving ? (frame % 2 ? STEP : BEAR) : s.status === 'work' ? (frame % 2 ? TYPE : BEAR) : BEAR;
      var bob = !moving && s.status === 'idle' && Math.floor(t / 900) % 2 ? 1 : 0; // 待機中の呼吸（仕事のふりではない）
      sprite(map, p.x - 6, p.y - 7 + bob, OUTFIT[s.id] || '#555');
      if (atDesk) { px(d[0] - 13, d[1] + 4, 26, 5, '#8a5a33'); px(d[0] - 13, d[1] + 8, 26, 2, '#5b3a20'); monitor(d, s.status === 'work' || s.status === 'turn'); }
      if (atDesk && s.status === 'error') { px(p.x + 8, p.y - 14, 5, 8, '#c62828'); px(p.x + 10, p.y - 13, 1, 4, '#fff'); px(p.x + 10, p.y - 8, 1, 1, '#fff'); } // エラー（再試行待ち）
      if (atDesk && s.status === 'budget') { px(p.x + 7, p.y - 13, 7, 7, '#9e9e9e'); px(p.x + 9, p.y - 12, 3, 1, '#fff'); px(p.x + 10, p.y - 11, 1, 4, '#fff'); px(p.x + 9, p.y - 10, 3, 1, '#fff'); } // 予算待ち（¥）
      if (atDesk && s.status === 'handoff') { px(p.x + 8, p.y - 11, 6, 1, '#2f6f9f'); px(p.x + 12, p.y - 12, 1, 3, '#2f6f9f'); px(p.x + 13, p.y - 11, 1, 1, '#2f6f9f'); } // 引き継ぎ中（→）
      if (atDesk && s.status === 'turn') { px(d[0] + 6, d[1] + 1, 5, 6, '#fffdf5'); px(d[0] + 7, d[1] + 3, 3, 1, '#999'); } // 机の上に引き継がれた書類
      if (atDesk && s.status === 'work') { var k = frame % 3; px(p.x + 7, p.y - 12, 9, 6, '#fff'); px(p.x + 8 + k * 0, p.y - 10, 1, 1, '#333'); px(p.x + 10, p.y - 10, 1, 1, k > 0 ? '#333' : '#fff'); px(p.x + 12, p.y - 10, 1, 1, k > 1 ? '#333' : '#fff'); px(p.x + 7, p.y - 7, 2, 1, '#fff'); }
      if (atDesk && s.status === 'wait') { px(p.x + 7, p.y - 13, 5, 1, '#5b3a20'); px(p.x + 8, p.y - 12, 3, 2, '#f4c430'); px(p.x + 9, p.y - 10, 1, 1, '#f4c430'); px(p.x + 8, p.y - 9, 3, 2, (frame % 4 < 2) ? '#f4c430' : '#e0a800'); px(p.x + 7, p.y - 7, 5, 1, '#5b3a20'); }
    });
    // 引き継ぎの書類（実際の引き継ぎの記録が届いたときだけ飛ぶ）
    papers = papers.filter(function (pp) {
      var k = Math.min(1, (t - pp.t0) / 1600);
      var x = pp.a[0] + (pp.b[0] - pp.a[0]) * k, y = pp.a[1] + (pp.b[1] - pp.a[1]) * k - Math.sin(k * Math.PI) * 18;
      px(x - 2, y - 3, 5, 6, '#fffdf5'); px(x - 1, y - 1, 3, 1, '#999'); px(x - 1, y + 1, 2, 1, '#999');
      return k < 1;
    });
  }
  function loop(t) { if (t - last > 90) { last = t; draw(t); } requestAnimationFrame(loop); }

  function buildLabels() {
    labels.textContent = '';
    var sign = document.createElement('div'); sign.className = 'sign'; sign.textContent = 'サングラスくま株式会社'; sign.style.left = (96 / W * 100) + '%'; sign.style.top = (12.5 / H * 100) + '%'; labels.appendChild(sign);
    var ceo = document.createElement('div'); ceo.className = 'tag ceo'; ceo.textContent = '社長の席'; ceo.style.left = (96 / W * 100) + '%'; ceo.style.top = (62 / H * 100) + '%'; labels.appendChild(ceo);
    var lounge = document.createElement('div'); lounge.className = 'tag area'; lounge.id = 'lounge-tag'; lounge.textContent = '休憩スペース'; lounge.style.left = (155 / W * 100) + '%'; lounge.style.top = (188 / H * 100) + '%'; labels.appendChild(lounge);
    staff.forEach(function (s) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'who'; b.dataset.id = s.id;
      b.innerHTML = '<span class="nm"></span><span class="st"></span>';
      b.addEventListener('click', function () { onTap(s.id); });
      labels.appendChild(b);
    });
    built = true;
  }
  function placeLabels() {
    staff.forEach(function (s) {
      var b = labels.querySelector('.who[data-id="' + s.id + '"]'); if (!b) return;
      var tg = targetOf(s);
      // 名札は机の横（中央寄り）に置く（下の段のくまに重ならないように）。待機中は名札を出さず、タップできる場所だけ
      var side = s.status === 'idle' || s.id === 'pr' ? 0 : (tg[0] < W / 2 ? 27 : -27);
      b.style.left = ((tg[0] + side) / W * 100) + '%'; b.style.top = ((tg[1] + (s.status === 'idle' ? -8 : s.id === 'pr' ? 22 : -6)) / H * 100) + '%';
      b.querySelector('.nm').textContent = s.name;
      b.querySelector('.st').textContent = ({ work: '仕事中', turn: '担当中', handoff: '引き継ぎ中', error: 'エラー', budget: '予算待ち', wait: '画像待ち', idle: '待機' })[s.status] || '待機';
      b.className = 'who ' + s.status;
    });
    var lt = document.getElementById('lounge-tag'); var n = staff.filter(function (s) { return s.status === 'idle'; }).length; if (lt) lt.textContent = n ? '休憩スペース（待機 ' + n + '人）' : '休憩スペース';
  }

  window.Office = {
    init: function (canvas, labelsEl, tap) {
      ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; labels = labelsEl; onTap = tap;
      requestAnimationFrame(loop);
    },
    update: function (list) {
      var first = !staff.length;
      staff = list || [];
      staff.forEach(function (s) { if (!pos[s.id]) { var tg = targetOf(s); pos[s.id] = { x: tg[0], y: tg[1] }; } });
      if (first || !built) buildLabels();
      placeLabels();
    },
    handoff: function (from, to) {
      if (!DESK[from] || !DESK[to]) return;
      papers.push({ a: [DESK[from][0], DESK[from][1] - 4], b: [DESK[to][0], DESK[to][1] - 4], t0: performance.now() });
    }
  };
})();
