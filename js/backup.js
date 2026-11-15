// データのバックアップ（2026-11-14）：このiPhoneのブラウザに保存している会社のデータ（localStorage の room- で始まるもの）を、
// そのまま1つのファイル（JSON）に書き出す。読み出すだけで、データは変えない・消さない。
// 画像の版（IndexedDB の room-creative）や着用イメージ（room-images）は大きいので含めない（描き直せる・作り直せる）。
(function () {
  'use strict';

  function collect() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!/^room-/.test(k)) continue;
      data[k] = localStorage.getItem(k);
    }
    return { app: '眼科医くま ROOM商品発掘', exportedAt: new Date().toISOString(), version: (function () { var sc = document.querySelector('script[src*="backup.js"]'); var m = sc && sc.src.match(/v=([^&]+)/); return m ? m[1] : ''; })(), keys: Object.keys(data).length, note: 'localStorage の room- で始まるデータをそのまま保存（値は文字列のまま）。戻すときは開発担当に依頼してください', data: data };
  }
  function save() {
    var json = JSON.stringify(collect());
    var name = 'room-backup-' + new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
    try {
      var file = new File([json], name, { type: 'application/json' });
      // iPhone：共有シートから「ファイルに保存」できる
      if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: 'データのバックアップ' }).then(function () { return 'shared'; }, function () { return download(json, name); });
    } catch (e) {}
    return Promise.resolve(download(json, name));
  }
  function download(json, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    return 'downloaded';
  }
  // 整理の前のバックアップ（2026-11-15）：この端末のデータ＋サーバーの正本の全件（履歴つき）＋自律運営の記録をまとめて1つのファイルにする
  //   サーバーに届かないときは失敗として返す（端末の分だけで「バックアップ済み」にしない）
  function saveFull() {
    var K = window.AppKit;
    if (!K) return Promise.reject(new Error('アプリの準備ができていません'));
    return K.postJson('api/data', { action: 'export' }).then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.records) throw new Error('サーバーのデータを書き出せませんでした（' + r.status + '）。整理はしないでください');
      var all = collect();
      all.server = { exportedAt: r.data.at, records: r.data.records };
      all.worker = window.ServerSync && window.ServerSync.status ? window.ServerSync.status() : null;
      var json = JSON.stringify(all);
      var name = 'room-full-backup-' + new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
      var done = { name: name, serverRecords: r.data.records.length, localKeys: all.keys, bytes: json.length };
      try {
        var file = new File([json], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: 'データのバックアップ（整理の前）' }).then(function () { return Object.assign(done, { how: 'shared' }); }, function () { download(json, name); return Object.assign(done, { how: 'downloaded' }); });
      } catch (e) {}
      download(json, name);
      return Object.assign(done, { how: 'downloaded' });
    });
  }
  window.Backup = { collect: collect, save: save, saveFull: saveFull };
})();
