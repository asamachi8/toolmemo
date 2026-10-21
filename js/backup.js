/* ===========================================================
   backup.js — 全データのバックアップ / 完全復元
   単一ファイル（JSON）で扱う。マージ復元は実装しない。
   =========================================================== */
(function (global) {
  'use strict';

  var FORMAT = 'memotool-backup';
  var VERSION = 1;

  function blobToDataUrl(blob) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { resolve(null); };
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(u) {
    var i = u.indexOf(',');
    var head = u.slice(0, i);
    var type = (head.match(/data:([^;]+)/) || [, 'application/octet-stream'])[1];
    var bin = atob(u.slice(i + 1));
    var len = bin.length;
    var buf = new Uint8Array(len);
    for (var k = 0; k < len; k++) buf[k] = bin.charCodeAt(k);
    return new Blob([buf], { type: type });
  }

  function create() {
    return Promise.all([
      DB.getAll('memos'),
      DB.getAllKeys('bodies'),
      DB.getAllKeys('images')
    ]).then(function (r) {
      var memos = r[0], bodyKeys = r[1], imgKeys = r[2];
      return Promise.all([
        Promise.all(bodyKeys.map(function (k) {
          return Store.body(k).then(function (b) { return [k, b]; });
        })),
        Promise.all(imgKeys.map(function (k) {
          return Store.image(k).then(function (b) {
            return b ? blobToDataUrl(b).then(function (u) { return [k, u]; }) : null;
          });
        }))
      ]).then(function (rr) {
        var bodies = {}, images = {};
        rr[0].forEach(function (p) { bodies[p[0]] = p[1]; });
        rr[1].forEach(function (p) { if (p && p[1]) images[p[0]] = p[1]; });
        return {
          format: FORMAT,
          version: VERSION,
          createdAt: Date.now(),
          settings: S.settings,
          tagHistory: S.tags(),
          backupMeta: { lastBackupAt: Date.now(), snoozeUntil: 0, since: S.backup.since },
          memos: memos,
          bodies: bodies,
          images: images
        };
      });
    });
  }

  /* ---------- 保存先 ----------
     端末に保存するか、他のアプリ（Googleドライブ等）へ渡すかを選べるようにする。
     使える手段は端末によって違うので、実際に使えるものだけを出す。          */

  // 書き出すファイルを先に作っておく（保存先の選択はこのあと）
  function build() {
    return create().then(function (data) {
      var name = 'IdeaMemo_Backup_' + U.fmtFileStamp(Date.now()) + '.json';
      var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      var file = null;
      try { file = new File([blob], name, { type: 'application/json' }); } catch (e) { file = null; }
      return { name: name, blob: blob, file: file };
    });
  }

  // 保存先フォルダを選んで保存できるか（PCのChrome / Edge など）
  function canPickFolder() {
    return typeof window.showSaveFilePicker === 'function';
  }

  // 他のアプリへ渡せるか（スマートフォンの共有メニュー）
  function canSendToApp(item) {
    try {
      return !!(item.file && navigator.canShare && navigator.canShare({ files: [item.file] }));
    } catch (e) { return false; }
  }

  function pickFolder(item) {
    return window.showSaveFilePicker({
      suggestedName: item.name,
      types: [{ description: 'メモのバックアップ', accept: { 'application/json': ['.json'] } }]
    }).then(function (handle) {
      return handle.createWritable().then(function (w) {
        return Promise.resolve(w.write(item.blob)).then(function () { return w.close(); });
      });
    });
  }

  function sendToApp(item) {
    return navigator.share({ files: [item.file], title: item.name });
  }

  function toThisDevice(item) {
    U.downloadBlob(item.blob, item.name);
    return Promise.resolve();
  }

  // 保存できたことを記録する（通知の30日カウントもここで戻す）
  function markSaved() {
    S.backup.lastBackupAt = Date.now();
    S.backup.snoozeUntil = 0;
    S.saveBackupMeta();
  }

  // 完全置換（マージしない）
  function restore(data) {
    if (!data || data.format !== FORMAT || !Array.isArray(data.memos)) {
      return Promise.reject(new Error('形式が違います'));
    }
    return DB.clearAll().then(function () {
      return DB.batch(['memos', 'bodies', 'images'], function (s) {
        data.memos.forEach(function (m) { s.memos.put(m); });
        Object.keys(data.bodies || {}).forEach(function (k) {
          s.bodies.put(data.bodies[k] || '', k);
        });
        Object.keys(data.images || {}).forEach(function (k) {
          try { s.images.put(dataUrlToBlob(data.images[k]), k); } catch (e) { /* 壊れた画像は飛ばす */ }
        });
      });
    }).then(function () {
      if (data.settings) {
        Object.keys(data.settings).forEach(function (k) { S.settings[k] = data.settings[k]; });
        S.saveSettings();
        S.applyAppearance();
      }
      S.setTagHistory(data.tagHistory || []);
      var bm = data.backupMeta || {};
      S.backup.lastBackupAt = bm.lastBackupAt || data.createdAt || Date.now();
      S.backup.snoozeUntil = 0;
      S.backup.since = bm.since || Date.now();
      S.saveBackupMeta();
      S.clearDraft();
      return true;
    });
  }

  global.Backup = {
    build: build,
    canPickFolder: canPickFolder,
    canSendToApp: canSendToApp,
    pickFolder: pickFolder,
    sendToApp: sendToApp,
    toThisDevice: toThisDevice,
    markSaved: markSaved,
    restore: restore
  };
})(window);
