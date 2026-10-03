/* ===========================================================
   db.js — IndexedDB の薄いラッパ
   一覧表示で本文・画像を読まないため、ストアを3つに分ける。
     memos  : 一覧に必要な軽量メタのみ
     bodies : 本文（長文になりうるので分離）
     images : 画像 Blob（必要な画面でのみ読む）
   =========================================================== */
(function (global) {
  'use strict';

  var NAME = 'memotool';
  var VER = 1;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(NAME, VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('memos')) {
          var m = db.createObjectStore('memos', { keyPath: 'id' });
          m.createIndex('loc', 'loc', { unique: false });
        }
        if (!db.objectStoreNames.contains('bodies')) db.createObjectStore('bodies');
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(stores, mode) {
    return open().then(function (db) { return db.transaction(stores, mode); });
  }

  function wrap(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function done(t) {
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }

  var DB = {
    open: open,

    get: function (store, key) {
      return tx([store], 'readonly').then(function (t) { return wrap(t.objectStore(store).get(key)); });
    },

    put: function (store, value, key) {
      return tx([store], 'readwrite').then(function (t) {
        var s = t.objectStore(store);
        if (key === undefined) s.put(value); else s.put(value, key);
        return done(t);
      });
    },

    del: function (store, key) {
      return tx([store], 'readwrite').then(function (t) {
        t.objectStore(store).delete(key);
        return done(t);
      });
    },

    getAll: function (store) {
      return tx([store], 'readonly').then(function (t) { return wrap(t.objectStore(store).getAll()); });
    },

    getAllKeys: function (store) {
      return tx([store], 'readonly').then(function (t) { return wrap(t.objectStore(store).getAllKeys()); });
    },

    // 指定の保存場所のメタだけを取得（本文・画像は読まない）
    byLoc: function (loc) {
      return tx(['memos'], 'readonly').then(function (t) {
        return wrap(t.objectStore('memos').index('loc').getAll(loc));
      });
    },

    countByLoc: function (loc) {
      return tx(['memos'], 'readonly').then(function (t) {
        return wrap(t.objectStore('memos').index('loc').count(loc));
      });
    },

    // 1トランザクションでまとめて書く（性能・一貫性のため）
    batch: function (stores, fn) {
      return tx(stores, 'readwrite').then(function (t) {
        var api = {};
        stores.forEach(function (s) { api[s] = t.objectStore(s); });
        fn(api);
        return done(t);
      });
    },

    clearAll: function () {
      return tx(['memos', 'bodies', 'images'], 'readwrite').then(function (t) {
        t.objectStore('memos').clear();
        t.objectStore('bodies').clear();
        t.objectStore('images').clear();
        return done(t);
      });
    }
  };

  global.DB = DB;
})(window);
