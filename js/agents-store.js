// AI社員（段階1・試験）の記録（このiPhoneのブラウザ内。キー room-agents。既存の room-company には触れない）
// sessions：1回の実行（社長がボタンを押した1回）。段階ごとの成否・候補の版（修正前後）・コードの確認・監査AIの採点・AIの呼び出しの記録・社長の判断
// daily：日ごとの実行回数（1日5回まで）
(function () {
  'use strict';

  var KEY = 'room-agents';
  var MAX_SESSIONS = 30;
  function read() { var s; try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {} s = s && typeof s === 'object' ? s : {}; s.sessions = Array.isArray(s.sessions) ? s.sessions : []; s.daily = s.daily && typeof s.daily === 'object' ? s.daily : {}; return s; }
  function write(s) {
    for (var i = 0; i < 4; i++) {
      try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) {}
      // 容量が足りないときは、古い実行の検索結果（大きい）から外す（判断の記録は残す）
      s.sessions.slice(5 + (3 - i) * 5).forEach(function (x) { x.results = []; });
    }
    return false;
  }
  function today() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

  var api = {
    KEY: KEY,
    DAILY_LIMIT: 5,
    today: today,
    sessions: function () { return read().sessions; },
    get: function (id) { return read().sessions.filter(function (x) { return x.id === id; })[0] || null; },
    usedToday: function () { return read().daily[today()] || 0; },
    // 新しい実行を始める（1日の回数を数える）
    start: function (theme, model) {
      var s = read();
      var x = { id: 'a' + Date.now().toString(36), at: new Date().toISOString(), date: today(), theme: theme, auditModel: model || '', status: 'running', steps: [], candidates: [], results: [], searched: [], runs: [], rakutenCalls: 0, notes: '' };
      s.sessions.unshift(x);
      s.sessions = s.sessions.slice(0, MAX_SESSIONS);
      s.daily[today()] = (s.daily[today()] || 0) + 1;
      Object.keys(s.daily).sort().slice(0, -30).forEach(function (d) { delete s.daily[d]; });
      write(s);
      return x;
    },
    save: function (x) {
      var s = read();
      var i = s.sessions.findIndex(function (y) { return y.id === x.id; });
      if (i === -1) s.sessions.unshift(x); else s.sessions[i] = x;
      write(s);
      return x;
    },
    // 書き出し用（実行の記録すべて）
    exportAll: function () { var s = read(); return { exportedAt: new Date().toISOString(), key: KEY, sessions: s.sessions, aiLog: window.AiUsage && window.AiUsage.log ? window.AiUsage.log() : [] }; }
  };
  window.AgentsStore = api;
})();
