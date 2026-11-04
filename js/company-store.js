// 眼科医くま株式会社の自律経営の記録（このiPhoneのブラウザ内。再読み込みしても残る。既存の保存データとは別のキー）。
// meetings：毎日の経営会議（集めた事実・社員の発言・問題・計画）／proposals：社員から社長への提言（社長の判断と返信）
// tasks：業務（発注内容・担当・優先・期限・完了条件・進捗・成果物・社長の確認）／room：会議室の会話
// ownerNotes：次の会議に引き継ぐ社長の返信・判断／improvements：改善の記録／igActivity：Instagramでの活動の記録（実際に行ったものだけ）
(function () {
  'use strict';

  var KEY = 'room-company';
  var TASK_DONE = { done: true, rejected: true };

  function read() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    s = s && typeof s === 'object' ? s : {};
    ['meetings', 'room', 'ownerNotes', 'improvements', 'igActivity'].forEach(function (k) { s[k] = Array.isArray(s[k]) ? s[k] : []; });
    ['proposals', 'tasks'].forEach(function (k) { s[k] = s[k] && typeof s[k] === 'object' ? s[k] : {}; });
    s.seq = Number(s.seq) || 0;
    return s;
  }
  function write(s) {
    // 会議の記録が増えすぎたら、古い会議の「集めた事実」だけ省く（要点・発言・計画は残す）
    for (var i = 0; i < 4; i++) {
      try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) {}
      s.meetings.slice(30 * (3 - i)).forEach(function (m) { m.facts = []; });
    }
    return false;
  }
  function id(s, p) { s.seq += 1; return p + Date.now().toString(36) + s.seq; }
  function now() { return new Date().toISOString(); }
  // 日付は日本時間で数える
  function today() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

  var api = {
    KEY: KEY,
    today: today,
    consented: function () { return !!read().consent; },
    setConsent: function () { var s = read(); s.consent = true; s.consentAt = now(); write(s); },
    // ---- 会議 ----
    meetings: function () { return read().meetings; },
    lastMeeting: function () { return read().meetings[0] || null; },
    todayMeeting: function () { return read().meetings.filter(function (m) { return m.date === today(); })[0] || null; },
    addMeeting: function (m) {
      var s = read();
      m.id = m.id || id(s, 'm');
      m.at = m.at || now();
      m.date = m.date || today();
      s.meetings.unshift(m);
      // 会議に渡した社長の返信は「引き継ぎ済み」にする（次の会議に二重に渡さない）
      s.ownerNotes.forEach(function (n) { if (!n.usedIn) n.usedIn = m.id; });
      write(s);
      return m;
    },
    pendingNotes: function () { return read().ownerNotes.filter(function (n) { return !n.usedIn; }); },
    // ---- 提言（同じ規則から出た未対応の提言は、新しく作らずに更新する） ----
    upsertProposal: function (p) {
      var s = read();
      var same = p.ruleKey && Object.keys(s.proposals).map(function (k) { return s.proposals[k]; }).filter(function (x) { return x.ruleKey === p.ruleKey && x.status === 'open'; })[0];
      if (same) { Object.assign(same, { title: p.title, facts: p.facts, impact: p.impact, request: p.request, lastSeen: p.date, meetingId: p.meetingId, times: (same.times || 1) + 1 }); write(s); return same; }
      var x = Object.assign({ id: id(s, 'p'), status: 'open', createdAt: now(), replies: [], times: 1 }, p);
      s.proposals[x.id] = x;
      write(s);
      return x;
    },
    proposals: function (status) { var s = read(); return Object.keys(s.proposals).map(function (k) { return s.proposals[k]; }).filter(function (x) { return !status || x.status === status; }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }); },
    decideProposal: function (pid, status, text) {
      var s = read();
      var x = s.proposals[pid];
      if (!x) return null;
      x.status = status;
      x.decidedAt = now();
      if (text) x.replies.push({ at: now(), who: 'owner', text: text });
      s.ownerNotes.push({ at: now(), about: x.title.slice(0, 60), decision: { approved: '承認', rejected: '却下', hold: '保留', open: '返信' }[status] || status, text: text || '' });
      write(s);
      return x;
    },
    replyProposal: function (pid, who, text) { var s = read(); var x = s.proposals[pid]; if (!x) return; x.replies.push({ at: now(), who: who, text: text }); write(s); },
    // ---- 業務 ----
    addTask: function (t) {
      var s = read();
      var x = Object.assign({ id: id(s, 't'), status: 'todo', createdAt: now(), progress: [], deliverables: [], ownerCheck: '未確認' }, t);
      s.tasks[x.id] = x;
      write(s);
      return x;
    },
    task: function (tid) { return read().tasks[tid] || null; },
    tasks: function (open) { var s = read(); return Object.keys(s.tasks).map(function (k) { return s.tasks[k]; }).filter(function (t) { return !open || !TASK_DONE[t.status]; }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }); },
    progress: function (tid, text, by, status) {
      var s = read(); var t = s.tasks[tid]; if (!t) return null;
      t.progress.push({ at: now(), text: text, by: by || 'ceo' });
      if (status) t.status = status;
      t.updatedAt = now();
      write(s); return t;
    },
    addDeliverable: function (tid, d, by) {
      var s = read(); var t = s.tasks[tid]; if (!t) return null;
      t.deliverables.push(Object.assign({ at: now(), by: by }, d));
      t.status = 'review'; t.ownerCheck = '確認待ち'; t.updatedAt = now();
      t.progress.push({ at: now(), text: '成果物を提出（社長の確認待ち）', by: by });
      write(s); return t;
    },
    updateDeliverable: function (tid, i, patch) { var s = read(); var t = s.tasks[tid]; if (!t || !t.deliverables[i]) return; Object.assign(t.deliverables[i], patch); write(s); },
    // 社長の確認：approve＝完了／revise＝差し戻し（追加指示）／reject＝やめる
    checkTask: function (tid, kind, note) {
      var s = read(); var t = s.tasks[tid]; if (!t) return null;
      t.ownerCheck = { approve: '承認', revise: '差し戻し', reject: '却下' }[kind];
      t.updatedAt = now();
      t.status = kind === 'approve' ? 'done' : kind === 'reject' ? 'rejected' : 'doing';
      if (note) t.ownerNote = note;
      t.progress.push({ at: now(), text: '社長の確認：' + t.ownerCheck + (note ? '（' + note + '）' : ''), by: 'owner' });
      s.ownerNotes.push({ at: now(), about: '業務「' + t.title.slice(0, 40) + '」', decision: t.ownerCheck, text: note || '' });
      write(s); return t;
    },
    // ---- 会議室 ----
    say: function (who, text, about, noNote) { var s = read(); var m = { id: id(s, 'r'), at: now(), who: who, text: text, about: about || null }; s.room.push(m); if (who === 'owner' && !noNote) s.ownerNotes.push({ at: m.at, about: about ? about.title || '' : '会議室', text: text }); write(s); return m; },
    room: function () { return read().room; },
    // ---- 改善の記録 ----
    addImprovement: function (m) { var s = read(); var dup = s.improvements.filter(function (x) { return x.problem === m.problem && x.idea === m.idea; })[0]; if (dup) return dup; var x = Object.assign({ id: id(s, 'i'), at: now(), status: 'proposed', result: '' }, m); s.improvements.unshift(x); write(s); return x; },
    setImprovement: function (iid, patch) { var s = read(); var x = s.improvements.filter(function (m) { return m.id === iid; })[0]; if (x) { Object.assign(x, patch, { updatedAt: now() }); write(s); } return x; },
    improvements: function () { return read().improvements; },
    // ---- Instagramでの活動（実際に行ったもの・社長が記録したものだけ。案は status: draft） ----
    addActivity: function (a) { var s = read(); var x = Object.assign({ id: id(s, 'a'), at: now() }, a); s.igActivity.unshift(x); write(s); return x; },
    activity: function () { return read().igActivity; }
  };
  window.CompanyStore = api;
})();
