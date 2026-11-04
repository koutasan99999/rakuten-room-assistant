// 楽天ROOMの紹介文とハッシュタグの記録（このiPhoneのブラウザ内。商品ごと＝商品番号で保存し、別の投稿セットに同じ商品が出ても使い回す）。
// 「文章を作り直す」を押したときだけ新しく作る。前の文章は history に残す（勝手に消さない）。編集した文章もそのまま保存する。
// registered：社長が「ROOMに登録した」を押した記録（社長の申告。ROOM側で自動確認したものではない）。
(function () {
  'use strict';

  var KEY = 'room-texts';
  function read() { var s; try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {} return s && typeof s === 'object' ? s : {}; }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
  function keyOf(p) { return String(p.code || p.url || p.name || '').slice(0, 200); }
  function now() { return new Date().toISOString(); }

  var api = {
    keyOf: keyOf,
    // 保存済みの文章。なければ、前に「いいじゃん！」で作ったROOM紹介文（PitchStore）を引き継ぐ
    get: function (p) {
      var s = read(); var k = keyOf(p);
      if (s[k]) return s[k];
      var old = window.PitchStore && window.PitchStore.find ? window.PitchStore.find(p) : null;
      if (old && old.intro) { s[k] = { intro: old.intro, tags: [], generatedAt: '', from: '前に作ったROOM紹介文', history: [], registered: old.room === 'done' ? { at: '', by: 'owner', note: '前の記録' } : null }; write(s); return s[k]; }
      return null;
    },
    // 新しく作った文章を保存（前の文章は履歴へ）
    saveGenerated: function (p, intro, tags, theme) {
      var s = read(); var k = keyOf(p); var x = s[k] || { history: [] };
      if (x.intro) x.history = [{ intro: x.intro, tags: x.tags, at: x.editedAt || x.generatedAt }].concat(x.history || []).slice(0, 5);
      Object.assign(x, { intro: intro, tags: tags, generatedAt: now(), editedAt: '', theme: theme || '', from: 'AI' });
      s[k] = x; write(s); return x;
    },
    saveEdit: function (p, intro, tags) {
      var s = read(); var k = keyOf(p); var x = s[k] || { history: [] };
      Object.assign(x, { intro: intro, tags: tags, editedAt: now() });
      s[k] = x; write(s); return x;
    },
    // 社長の申告で「ROOMに登録した」（取り消しもできる）
    setRegistered: function (p, on) {
      var s = read(); var k = keyOf(p); var x = s[k] || { history: [] };
      x.registered = on ? { at: now(), by: 'owner', note: '社長の申告' } : null;
      s[k] = x; write(s);
      // 採用済みの記録（PitchStore）にも同じ状態を残す（経営報告のROOM登録の数に反映）
      var f = window.PitchStore && window.PitchStore.find ? window.PitchStore.find(p) : null;
      if (f && f.status === 'adopt') window.PitchStore.update(f.key, { room: on ? 'done' : 'waiting' });
      return x;
    },
    // 状態：未登録 → 文章準備済み → ROOM登録済み（社長の申告）
    status: function (p, setItem) {
      var x = api.get(p);
      if ((x && x.registered) || (setItem && setItem.room === 'registered')) return 'registered';
      return x && x.intro ? 'ready' : 'none';
    }
  };
  window.RoomTextStore = api;
})();
