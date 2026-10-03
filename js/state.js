/* ===========================================================
   state.js — 設定 / タグ履歴 / 編集中ドラフト / 画面状態
   小さく頻繁に読む値は localStorage（同期・軽量）に置く。
   =========================================================== */
(function (global) {
  'use strict';

  var K = {
    settings: 'mt.settings',
    tags: 'mt.tags',
    backup: 'mt.backup',
    draft: 'mt.draft',
    session: 'mt.session'
  };

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 容量超過時は無視 */ }
  }

  /* ---------- 設定 ---------- */
  var defaults = {
    fontSize: 'm',       // s | m | l （初期値 中）
    theme: 'light',      // light | dark（手動切替のみ）
    dividerKey: null,    // PC用ショートカット {key, ctrl, shift, alt, meta, label}
    backupNotify: true   // 初期値 ON
  };

  var settings = Object.assign({}, defaults, load(K.settings, {}));

  function saveSettings() { save(K.settings, settings); }

  function applyAppearance() {
    var el = document.documentElement;
    el.className = 'fs-' + settings.fontSize + ' theme-' + settings.theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', settings.theme === 'dark' ? '#15171a' : '#ffffff');
  }

  /* ---------- バックアップ時刻 ---------- */
  var backup = load(K.backup, { lastBackupAt: 0, snoozeUntil: 0, since: Date.now() });
  if (!backup.since) backup.since = Date.now();
  function saveBackupMeta() { save(K.backup, backup); }

  /* ---------- タグ履歴（最近使用した順） ---------- */
  var tags = load(K.tags, []);

  function saveTags() { save(K.tags, tags); }

  function tagNames() { return tags.map(function (t) { return t.name; }); }

  function touchTags(names) {
    var now = Date.now();
    names.forEach(function (n) {
      var hit = null;
      for (var i = 0; i < tags.length; i++) if (tags[i].name === n) { hit = tags[i]; break; }
      if (hit) hit.last = now;
      else tags.push({ name: n, last: now });
    });
    tags.sort(function (a, b) { return b.last - a.last; });
    saveTags();
  }

  function removeTagFromHistory(name) {
    tags = tags.filter(function (t) { return t.name !== name; });
    saveTags();
  }

  function renameTagInHistory(from, to) {
    var toEntry = null, fromEntry = null;
    tags.forEach(function (t) {
      if (t.name === to) toEntry = t;
      if (t.name === from) fromEntry = t;
    });
    if (toEntry && fromEntry) {
      // 統合: 新しい方の使用時刻を残す
      toEntry.last = Math.max(toEntry.last, fromEntry.last);
      tags = tags.filter(function (t) { return t.name !== from; });
    } else if (fromEntry) {
      fromEntry.name = to;
    }
    tags.sort(function (a, b) { return b.last - a.last; });
    saveTags();
  }

  function setTagHistory(list) {
    tags = Array.isArray(list) ? list.slice() : [];
    tags.sort(function (a, b) { return b.last - a.last; });
    saveTags();
  }

  /* ---------- 内容の署名（更新日時を変えるべきか判定するため） ---------- */
  function sig(body, tagList, imgs) {
    var s = (body || '') + '\u0000' + (tagList || []).join('\u0001') + '\u0000' + (imgs || []).join('\u0001');
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return s.length + ':' + h.toString(36);
  }

  /* ---------- 編集中ドラフト（異常終了からの復旧用） ---------- */
  var draftTimer = null;

  function readDraft() { return load(K.draft, null); }

  function writeDraft(d) { save(K.draft, d); }

  // 過剰な同期書き込みを避けるため、入力中は間引いて書く。
  function scheduleDraft(getDraft) {
    if (draftTimer) return;
    draftTimer = setTimeout(function () {
      draftTimer = null;
      var d = getDraft();
      if (d) writeDraft(d);
    }, 700);
  }

  function flushDraft(getDraft) {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    var d = getDraft();
    if (d) writeDraft(d);
  }

  function clearDraft() {
    try { localStorage.removeItem(K.draft); } catch (e) { /* noop */ }
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
  }

  /* ---------- 画面状態（いた場所を勝手に変えない） ---------- */
  var session = load(K.session, null) || {
    view: 'list',
    scrolls: {},
    searchTags: [],
    trashOpenId: null
  };
  if (!session.scrolls) session.scrolls = {};
  if (!session.searchTags) session.searchTags = [];

  function saveSession() { save(K.session, session); }

  global.S = {
    settings: settings,
    saveSettings: saveSettings,
    applyAppearance: applyAppearance,

    backup: backup,
    saveBackupMeta: saveBackupMeta,

    tags: function () { return tags; },
    tagNames: tagNames,
    touchTags: touchTags,
    removeTagFromHistory: removeTagFromHistory,
    renameTagInHistory: renameTagInHistory,
    setTagHistory: setTagHistory,

    sig: sig,

    readDraft: readDraft,
    writeDraft: writeDraft,
    scheduleDraft: scheduleDraft,
    flushDraft: flushDraft,
    clearDraft: clearDraft,

    session: session,
    saveSession: saveSession
  };
})(window);
