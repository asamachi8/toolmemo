/* ===========================================================
   store.js — メモの読み書き
   保存場所: 'normal'（通常メモ） / 'box'（書き出し箱） / 'trash'（ゴミ箱）
   =========================================================== */
(function (global) {
  'use strict';

  var TRASH_DAYS = 30;

  function sortFor(loc, arr) {
    if (loc === 'box') {
      // 書き出し箱へ移動した時刻が新しいものを上に
      arr.sort(function (a, b) { return (b.movedAt || 0) - (a.movedAt || 0); });
    } else if (loc === 'trash') {
      arr.sort(function (a, b) { return (b.trashedAt || 0) - (a.trashedAt || 0); });
    } else {
      arr.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    }
    return arr;
  }

  var Store = {
    TRASH_DAYS: TRASH_DAYS,

    list: function (loc) {
      return DB.byLoc(loc).then(function (arr) { return sortFor(loc, arr); });
    },

    count: function (loc) { return DB.countByLoc(loc); },

    meta: function (id) { return DB.get('memos', id); },

    body: function (id) {
      return DB.get('bodies', id).then(function (b) { return typeof b === 'string' ? b : ''; });
    },

    full: function (id) {
      return Promise.all([Store.meta(id), Store.body(id)]).then(function (r) {
        if (!r[0]) return null;
        return { meta: r[0], body: r[1] };
      });
    },

    image: function (imgId) { return DB.get('images', imgId); },

    putImage: function (imgId, blob) { return DB.put('images', blob, imgId); },

    /* ---------- 保存 ---------- */
    // 戻り値: {id, created, changed}
    // 内容が変わっていない場合は更新日時を変更しない（一覧順も変えない）。
    save: function (input) {
      var id = input.id || null;
      var body = input.body || '';
      var tags = (input.tags || []).slice(0, 5);
      var imgs = (input.imgs || []).slice(0, 2);
      var empty = U.isBlank(body) && tags.length === 0 && imgs.length === 0;
      var now = Date.now();

      if (!id) {
        // 完全に空の新規メモは作成しない
        if (empty) return Promise.resolve(null);
        var meta = {
          id: U.newId(),
          loc: 'normal',
          updatedAt: now,
          movedAt: 0,
          trashedAt: 0,
          tags: tags,
          imgs: imgs,
          preview: U.previewOf(body)
        };
        return DB.batch(['memos', 'bodies'], function (s) {
          s.memos.put(meta);
          s.bodies.put(body, meta.id);
        }).then(function () {
          if (tags.length) S.touchTags(tags);
          return { id: meta.id, created: true, changed: true };
        });
      }

      return Store.meta(id).then(function (meta) {
        if (!meta) return null;
        // baseSig は「最後に正式保存した内容」の署名。一致すれば実質の変更なし。
        var changed = input.baseSig === undefined || S.sig(body, tags, imgs) !== input.baseSig;

        meta.tags = tags;
        meta.imgs = imgs;
        meta.preview = U.previewOf(body);
        if (changed) meta.updatedAt = now;

        return DB.batch(['memos', 'bodies'], function (s) {
          s.memos.put(meta);
          s.bodies.put(body, id);
        }).then(function () {
          if (tags.length) S.touchTags(tags);
          return { id: id, created: false, changed: changed };
        });
      });
    },

    /* ---------- 場所の移動 ---------- */
    moveToBox: function (ids) {
      var now = Date.now();
      return Store._patch(ids, function (m, i) {
        if (m.loc === 'box') return null;      // 内部IDで重複保持を防ぐ
        m.loc = 'box';
        m.movedAt = now + (ids.length - i);     // 同時移動でも画面上の順序を安定させる
        return m;
      });
    },

    moveToNormal: function (ids) {
      return Store._patch(ids, function (m) {
        m.loc = 'normal';
        m.movedAt = 0;
        m.trashedAt = 0;
        return m;
      });
    },

    trash: function (ids) {
      var now = Date.now();
      return Store._patch(ids, function (m, i) {
        m.loc = 'trash';
        m.trashedAt = now + (ids.length - i);
        m.movedAt = 0;
        return m;
      });
    },

    _patch: function (ids, fn) {
      if (!ids.length) return Promise.resolve();
      return DB.batch(['memos'], function (s) {
        ids.forEach(function (id, i) {
          var req = s.memos.get(id);
          req.onsuccess = function () {
            var m = req.result;
            if (!m) return;
            var out = fn(m, i);
            if (out) s.memos.put(out);
          };
        });
      });
    },

    /* ---------- ゴミ箱の期限処理（起動時などに1回だけ） ---------- */
    purgeExpired: function () {
      var limit = Date.now() - TRASH_DAYS * U.DAY;
      return DB.byLoc('trash').then(function (arr) {
        var dead = arr.filter(function (m) { return (m.trashedAt || 0) < limit; });
        if (!dead.length) return 0;
        return DB.batch(['memos', 'bodies', 'images'], function (s) {
          dead.forEach(function (m) {
            s.memos.delete(m.id);
            s.bodies.delete(m.id);
            (m.imgs || []).forEach(function (iid) { s.images.delete(iid); });
          });
        }).then(function () { return dead.length; });
      });
    },

    // どのメモからも参照されていない画像を片付ける（破棄・異常終了の後始末）
    collectGarbageImages: function (keepIds) {
      return Promise.all([DB.getAllKeys('images'), DB.getAll('memos')]).then(function (r) {
        var keys = r[0], memos = r[1];
        var used = Object.create(null);
        (keepIds || []).forEach(function (k) { used[k] = true; });
        memos.forEach(function (m) { (m.imgs || []).forEach(function (k) { used[k] = true; }); });
        var dead = keys.filter(function (k) { return !used[k]; });
        if (!dead.length) return 0;
        return DB.batch(['images'], function (s) {
          dead.forEach(function (k) { s.images.delete(k); });
        }).then(function () { return dead.length; });
      });
    },

    // 完全に空の新規メモを捨てる場合など
    hardDelete: function (ids) {
      if (!ids.length) return Promise.resolve();
      return DB.getAll('memos').then(function (all) {
        var map = Object.create(null);
        all.forEach(function (m) { map[m.id] = m; });
        return DB.batch(['memos', 'bodies', 'images'], function (s) {
          ids.forEach(function (id) {
            var m = map[id];
            s.memos.delete(id);
            s.bodies.delete(id);
            if (m) (m.imgs || []).forEach(function (iid) { s.images.delete(iid); });
          });
        });
      });
    }
  };

  global.Store = Store;
})(window);
