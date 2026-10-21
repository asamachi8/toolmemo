/* ===========================================================
   util.js — 共通の小道具
   =========================================================== */
(function (global) {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- ID ---------- */
  function newId() {
    // 内部一意ID。時刻順 + 乱数で衝突を避ける。
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- 日時 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtDateTime(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtFileStamp(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      '_' + pad(d.getHours()) + pad(d.getMinutes());
  }

  var DAY = 86400000;

  /* ---------- 本文ユーティリティ ---------- */
  function isBlank(s) { return !s || s.replace(/[\s　]+/g, '') === ''; }

  // 一覧プレビュー: 本文の先頭2行（先頭の空行は読み飛ばす）
  function previewOf(body) {
    if (!body) return '';
    var lines = body.split('\n');
    var i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    return lines.slice(i, i + 2).join('\n').slice(0, 300);
  }

  /* ---------- トースト（1〜2秒・非ブロッキング） ---------- */
  var toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) toastEl = $('#toast');
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 1600);
  }

  /* ---------- 確認ダイアログ ---------- */
  // buttons: [{label, value, cls}] 返り値は選ばれた value（背景タップ時は null）
  function confirmDialog(text, buttons) {
    return new Promise(function (resolve) {
      var wrap = $('#dialog');
      $('#dlg-text').textContent = text;
      var box = $('#dlg-btns');
      box.textContent = '';
      var done = function (v) {
        wrap.hidden = true;
        box.textContent = '';
        wrap.onclick = null;
        resolve(v);
      };
      buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.textContent = b.label;
        if (b.cls) btn.className = b.cls;
        btn.onclick = function (e) { e.stopPropagation(); done(b.value); };
        box.appendChild(btn);
      });
      wrap.onclick = function (e) { if (e.target === wrap) done(null); };
      wrap.hidden = false;
    });
  }

  /* ---------- 操作シート ---------- */
  function sheet(title, buttons) {
    return new Promise(function (resolve) {
      var wrap = $('#sheet');
      $('#sheet-title').textContent = title || '';
      var box = $('#sheet-btns');
      box.textContent = '';
      var done = function (v) {
        wrap.hidden = true;
        box.textContent = '';
        wrap.onclick = null;
        resolve(v);
      };
      buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.textContent = b.label;
        if (b.cls) btn.className = b.cls;
        btn.onclick = function (e) { e.stopPropagation(); done(b.value); };
        box.appendChild(btn);
      });
      wrap.onclick = function (e) { if (e.target === wrap) done(null); };
      wrap.hidden = false;
    });
  }

  /* ---------- 長押し ---------- */
  // 長押しで onLong、普通のタップで onTap。両方が起きないようにする。
  function attachPress(el, onTap, onLong) {
    var timer = null, longFired = false, sx = 0, sy = 0, moved = false;

    function start(x, y) {
      longFired = false; moved = false; sx = x; sy = y;
      timer = setTimeout(function () {
        timer = null;
        if (moved) return;
        longFired = true;
        if (onLong) onLong();
      }, 500);
    }
    function move(x, y) {
      if (Math.abs(x - sx) > 10 || Math.abs(y - sy) > 10) {
        moved = true;
        if (timer) { clearTimeout(timer); timer = null; }
      }
    }
    function end(ok) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!longFired && !moved && ok && onTap) onTap();
    }

    // Pointer Events だけを使う。
    // touch と mouse の両方を監視すると、1回のタップで onTap が2回走り
    // （タッチ後にブラウザが擬似マウスイベントを送るため）、
    // 選択の切り替えが「入って即座に外れる」＝反応しないように見える。
    var activeId = null;
    var lastType = 'mouse';

    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;          // 右クリック等は contextmenu で扱う
      lastType = e.pointerType || 'mouse';
      activeId = e.pointerId;
      start(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove', function (e) {
      if (activeId !== e.pointerId) return;
      move(e.clientX, e.clientY);
    }, { passive: true });
    el.addEventListener('pointerup', function (e) {
      if (activeId !== e.pointerId) return;
      activeId = null;
      end(true);
    });
    el.addEventListener('pointercancel', function (e) {
      if (activeId !== e.pointerId) return;
      activeId = null;
      end(false);                           // スクロール開始などはタップにしない
    });

    // PC: 右クリックを長押し相当として扱う（タッチの長押しは上のタイマーが担当）
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (lastType !== 'mouse' || longFired) return;
      if (timer) { clearTimeout(timer); timer = null; }
      if (onLong) onLong();
    });
  }

  /* ---------- ファイル保存 ---------- */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  global.U = {
    $: $, $$: $$,
    newId: newId,
    fmtDateTime: fmtDateTime,
    fmtFileStamp: fmtFileStamp,
    DAY: DAY,
    isBlank: isBlank,
    previewOf: previewOf,
    toast: toast,
    confirmDialog: confirmDialog,
    sheet: sheet,
    attachPress: attachPress,
    downloadBlob: downloadBlob,
    readFileText: readFileText
  };
})(window);
