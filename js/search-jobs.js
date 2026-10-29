// 検索ジョブ：検索を「画面」から切り離して、このiPhoneに記録しながら進める仕組み。
//
// なぜ必要か：今までの検索は「iPhoneとサーバーの1回の長い通信（30〜60秒）」で、結果は画面にしか届かなかった。
// 別のアプリを開く・画面をロックするとiPhoneが通信を止めるため、サーバーが探し終えても結果を受け取れず失敗していた。
// サーバー側に保存場所（データベース）を置かない方針なので、検索の続きはこのiPhoneが担当する：
//   - 検索を始めたら、ジョブ（何をどこまで探したか）をすぐ IndexedDB に保存する
//   - 検索を小さな単位（タスク）に分け、1つ終わるたびに結果を保存する
//   - 途中で別のアプリを開いて通信が切れたタスクは、アプリに戻ったときに自動でやり直す（回数は数えない）
//   - ページを再読み込み・閉じて開き直したときも、終わっていないジョブは続きから再開する
//   - 一時的なエラーは回数を決めて（最大3回・待ち時間を倍に）やり直す。無限にはやり直さない
//   - いくつかのタスクが失敗しても、取れた分は使えるようにし（一部成功）、失敗した部分だけやり直せる
// ブラウザを閉じている間に検索を終わらせることはできない（サーバーに保存場所がないため）。開き直すと続きから進む。
//
// 使い方：SearchJobs.register(type, { label, tasks(params) → [{ path, body }], merge(results, params) → 結果 })
//         SearchJobs.start(type, params, info) → ジョブ。SearchJobs.on(fn) で状態の変化を受け取る
(function () {
  'use strict';

  var DB = 'room-search-jobs';
  var STORE = 'jobs';
  var MAX_JOBS = 40;          // 残しておくジョブの数
  var MAX_ACTIVE = 3;         // 同時に待っている・動いているジョブの数
  var MAX_ATTEMPTS = 3;       // 1つのタスクをやり直す回数（通信が切れた分は数えない）
  var TASK_TIMEOUT = 80000;   // 1つのタスク（1回の通信）の制限時間
  var JOB_TIMEOUT = 30 * 60 * 1000; // ジョブ全体の制限時間（これを過ぎた未完了のタスクは失敗にする）
  var DEDUPE_MS = 90 * 1000;  // 同じ内容の検索をこの時間内にもう一度始めたら、前のジョブを使う
  var DAILY_LIMIT = 400;      // 1日に呼ぶ検索の回数の上限（API使用量の管理）
  var USAGE_KEY = 'room-search-usage';

  var types = {};
  var jobs = [];              // メモリ上の写し（IndexedDB と同じ内容）
  var listeners = [];
  var loaded = null;
  var running = false;
  var hiddenDuringTask = false;
  var waiters = {};           // この画面のあいだだけ使う「終わったら知らせて」（ページを閉じると消える）

  // ---- 保存（IndexedDB。使えなければメモリだけ） ----
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function persist(job) {
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        try {
          var t = d.transaction(STORE, 'readwrite');
          t.objectStore(STORE).put(JSON.parse(JSON.stringify(job)));
          t.oncomplete = t.onerror = t.onabort = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }
  function removeStored(id) {
    return db().then(function (d) {
      if (!d) return;
      try { d.transaction(STORE, 'readwrite').objectStore(STORE).delete(id); } catch (e) {}
    });
  }
  function load() {
    if (loaded) return loaded;
    loaded = db().then(function (d) {
      if (!d) return [];
      return new Promise(function (resolve) {
        try {
          var req = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
      });
    }).then(function (list) {
      jobs = list.sort(function (a, b) { return b.createdAt - a.createdAt; });
      // 前に開いていたときに「通信中」だったタスクは、途中で切れたので待ちに戻す
      jobs.forEach(function (j) {
        (j.tasks || []).forEach(function (t) { if (t.state === 'running') t.state = 'pending'; });
        if (j.status === 'running') j.status = 'queued';
      });
      return jobs;
    });
    return loaded;
  }

  function emit(job) {
    listeners.forEach(function (fn) { try { fn(job); } catch (e) {} });
  }
  function save(job) {
    job.updatedAt = Date.now();
    emit(job);
    return persist(job);
  }

  // ---- 使用量（1日に呼ぶ回数） ----
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function usage() {
    var u;
    try { u = JSON.parse(localStorage.getItem(USAGE_KEY)); } catch (e) {}
    return u && u.day === today() ? u : { day: today(), calls: 0 };
  }
  function countCall() {
    var u = usage();
    u.calls += 1;
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch (e) {}
  }

  // ---- 状態 ----
  function summarize(job) {
    var t = job.tasks;
    var done = t.filter(function (x) { return x.state === 'done'; }).length;
    var failed = t.filter(function (x) { return x.state === 'failed'; }).length;
    var open = t.length - done - failed;
    if (job.status === 'cancelled') return 'cancelled';
    if (open) return t.some(function (x) { return x.state === 'running'; }) || done || failed ? 'running' : 'queued';
    if (!failed) return 'completed';
    return done ? 'partial' : 'failed';
  }
  function finish(job) {
    var type = types[job.type];
    var ok = job.tasks.filter(function (x) { return x.state === 'done'; }).map(function (x) { return x.result; });
    try {
      job.result = ok.length ? (type && type.merge ? type.merge(ok, job.params) : ok[ok.length - 1]) : null;
    } catch (e) { job.result = null; job.error = '結果をまとめられませんでした'; }
    job.count = type && type.count && job.result ? type.count(job.result) : null;
    var failed = job.tasks.filter(function (x) { return x.state === 'failed'; });
    if (failed.length) job.error = failed.map(function (x) { return x.error; }).filter(Boolean).slice(0, 2).join(' / ');
    else job.error = '';
    job.finishedAt = Date.now();
    job.seen = false;
  }

  // ---- 実行（1度に1つのタスクだけ。楽天APIは1秒1回までなので並べて呼ばない） ----
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nextTask() {
    // 古いジョブから順に
    var list = jobs.slice().reverse();
    for (var i = 0; i < list.length; i++) {
      var j = list[i];
      if (j.status === 'cancelled' || j.status === 'completed' || j.status === 'partial' || j.status === 'failed') continue;
      if (Date.now() - j.createdAt > JOB_TIMEOUT) {
        j.tasks.forEach(function (t) { if (t.state === 'pending' || t.state === 'running') { t.state = 'failed'; t.error = '時間切れ'; } });
        j.status = summarize(j);
        finish(j);
        save(j).then(function () { notifyDone(j); });
        continue;
      }
      for (var k = 0; k < j.tasks.length; k++) {
        var t = j.tasks[k];
        if (t.state === 'pending' && (!t.retryAt || t.retryAt <= Date.now())) return { job: j, task: t };
      }
    }
    return null;
  }
  function waitingRetry() {
    var at = Infinity;
    jobs.forEach(function (j) {
      if (j.status !== 'queued' && j.status !== 'running') return;
      j.tasks.forEach(function (t) { if (t.state === 'pending' && t.retryAt) at = Math.min(at, t.retryAt); });
    });
    return at === Infinity ? 0 : Math.max(0, at - Date.now());
  }

  function call(task, pass) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, TASK_TIMEOUT);
    return fetch(task.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Passcode': pass || '' },
      body: JSON.stringify(task.body),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
    }, function (e) {
      return { status: 0, data: {}, aborted: !!(e && e.name === 'AbortError') };
    }).then(function (r) { clearTimeout(timer); return r; });
  }

  function run() {
    if (running) return;
    running = true;
    (function loop() {
      if (document.hidden) { running = false; return; } // 画面が裏にある間は待つ（戻ったら再開）
      var n = nextTask();
      if (!n) {
        var wait = waitingRetry();
        running = false;
        if (wait) setTimeout(run, wait + 50);
        return;
      }
      var job = n.job, task = n.task;
      if (usage().calls >= DAILY_LIMIT) {
        task.state = 'failed';
        task.error = '今日の検索回数の上限（' + DAILY_LIMIT + '回）に達しました';
        job.status = summarize(job);
        if (job.status !== 'running' && job.status !== 'queued') finish(job);
        save(job).then(loop);
        return;
      }
      task.state = 'running';
      task.startedAt = Date.now();
      job.status = 'running';
      job.startedAt = job.startedAt || Date.now();
      hiddenDuringTask = false;
      save(job);
      countCall();
      call(task, SearchJobs.passcode ? SearchJobs.passcode() : '').then(function (r) {
        if (job.status === 'cancelled') return;
        var interrupted = r.status === 0 && (hiddenDuringTask || document.hidden || navigator.onLine === false);
        task.code = r.status;
        if (r.status === 200) {
          task.state = 'done';
          task.result = r.data;
          task.error = '';
        } else if (interrupted) {
          // 別のアプリを開いた・画面をロックした・電波が切れた：回数に数えず、戻ったらやり直す
          task.state = 'pending';
          task.interruptions = (task.interruptions || 0) + 1;
        } else {
          task.attempts = (task.attempts || 0) + 1;
          var retryable = r.status === 0 || r.status === 429 || r.status >= 500;
          var msg = (r.data && r.data.error) || (r.aborted ? '時間がかかりすぎました' : r.status ? 'エラー（' + r.status + '）' : '通信できませんでした');
          if (r.status === 401) msg = '合言葉が必要です（「失敗した部分をやり直す」で入力できます）';
          if (retryable && task.attempts < MAX_ATTEMPTS) {
            task.state = 'pending';
            task.retryAt = Date.now() + 2000 * Math.pow(2, task.attempts - 1); // 2秒・4秒…と待ち時間を倍にする
            task.error = msg;
          } else {
            task.state = 'failed';
            task.error = msg;
          }
        }
        job.status = summarize(job);
        if (job.status !== 'running' && job.status !== 'queued') finish(job);
        return save(job).then(function () {
          if (job.finishedAt && job.status !== 'running' && job.status !== 'queued') notifyDone(job);
        });
      }).then(function () { setTimeout(loop, 1100); }); // 楽天APIは1秒1回まで
    })();
  }

  // 終わったとき：先に結果の保存（notify。画面を開いていなくても必要な処理）、そのあと待っている画面に知らせる。
  // 完了の知らせはいまはアプリ内だけ。将来プッシュ通知などをつなぐときも notify に足す
  function notifyDone(job) {
    var w = waiters[job.id] || [];
    var hadWaiter = w.length > 0;
    delete waiters[job.id];
    var p;
    try { p = Promise.resolve(SearchJobs.notify(job, hadWaiter)); } catch (e) { p = Promise.resolve(); }
    p.catch(function () {}).then(function () { w.forEach(function (fn) { try { fn(job); } catch (e) {} }); });
  }

  function sameParams(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  var SearchJobs = {
    STATUS_JA: { queued: '待機中', running: '検索中', completed: '完了', partial: '一部成功', failed: '失敗', cancelled: 'キャンセル' },
    DAILY_LIMIT: DAILY_LIMIT,
    passcode: null,
    notify: function () {},

    register: function (type, def) { types[type] = def; },

    load: load,

    // 検索を始める。info: { label, genre }。同じ内容の検索が動いている・すぐ前に終わっていれば、それを返す（連打しても増えない）
    start: function (type, params, info) {
      return load().then(function () {
        var def = types[type];
        if (!def) throw new Error('unknown job type: ' + type);
        var dup = jobs.filter(function (j) {
          return j.type === type && sameParams(j.params, params) && j.status !== 'cancelled' && j.status !== 'failed' &&
            ((j.status === 'queued' || j.status === 'running') || Date.now() - (j.finishedAt || 0) < DEDUPE_MS);
        })[0];
        if (dup) { run(); return dup; }
        var active = jobs.filter(function (j) { return j.status === 'queued' || j.status === 'running'; });
        if (active.length >= MAX_ACTIVE) {
          var err = new Error('検索が' + active.length + '件動いています。終わってからもう一度お試しください（「検索ジョブ」で確認できます）');
          err.busy = true;
          throw err;
        }
        if (usage().calls >= DAILY_LIMIT) throw new Error('今日の検索回数の上限（' + DAILY_LIMIT + '回）に達しました');
        var tasks = def.tasks(params).map(function (t, i) { return { id: 't' + i, path: t.path, body: t.body, label: t.label || '', state: 'pending', attempts: 0 }; });
        var job = {
          id: 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          type: type, params: params, meta: (info && info.meta) || null, label: (info && info.label) || (def.label ? def.label(params) : type), genre: (info && info.genre) || '',
          status: 'queued', tasks: tasks, createdAt: Date.now(), updatedAt: Date.now(), result: null, count: null, error: '', seen: false
        };
        jobs.unshift(job);
        // 古いジョブは消す（動いているものは残す）
        jobs.filter(function (j, i) { return i >= MAX_JOBS && j.status !== 'queued' && j.status !== 'running'; }).forEach(function (j) {
          jobs.splice(jobs.indexOf(j), 1);
          removeStored(j.id);
        });
        return save(job).then(function () { run(); return job; });
      });
    },

    // 終わったら fn(job) を呼ぶ（この画面を開いている間だけ。閉じたら結果は「検索ジョブ」から見る）
    whenDone: function (job, fn) {
      if (job.status !== 'queued' && job.status !== 'running') { fn(job); return; }
      (waiters[job.id] = waiters[job.id] || []).push(fn);
    },

    list: function () { return load().then(function () { return jobs.slice(); }); },
    get: function (id) { return load().then(function () { return jobs.filter(function (j) { return j.id === id; })[0] || null; }); },
    on: function (fn) { listeners.push(fn); },

    // 失敗した部分だけやり直す
    retryFailed: function (id) {
      return SearchJobs.get(id).then(function (job) {
        if (!job) return null;
        job.tasks.forEach(function (t) { if (t.state === 'failed') { t.state = 'pending'; t.attempts = 0; t.retryAt = 0; t.error = ''; } });
        job.createdAt = Date.now(); // 全体の制限時間を数え直す
        job.status = summarize(job);
        job.finishedAt = 0;
        return save(job).then(function () { run(); return job; });
      });
    },
    cancel: function (id) {
      return SearchJobs.get(id).then(function (job) {
        if (!job || (job.status !== 'queued' && job.status !== 'running')) return job;
        job.status = 'cancelled';
        job.tasks.forEach(function (t) { if (t.state === 'pending' || t.state === 'running') { t.state = 'failed'; t.error = 'キャンセルしました'; } });
        finish(job);
        job.status = 'cancelled';
        return save(job).then(function () { notifyDone(job); return job; });
      });
    },
    remove: function (id) {
      return load().then(function () {
        jobs = jobs.filter(function (j) { return j.id !== id; });
        return removeStored(id);
      });
    },
    markSeen: function (id) {
      return SearchJobs.get(id).then(function (job) { if (job && !job.seen) { job.seen = true; return save(job); } });
    },
    resume: function () { load().then(run); }
  };

  // 画面が裏に回った・戻った（別のアプリ・ロック）、再読み込み、電波の回復で、続きを進める
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hiddenDuringTask = true;
    else SearchJobs.resume();
  });
  window.addEventListener('pageshow', function () { SearchJobs.resume(); });
  window.addEventListener('online', function () { SearchJobs.resume(); });

  window.SearchJobs = SearchJobs;
})();
