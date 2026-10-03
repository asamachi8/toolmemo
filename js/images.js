/* ===========================================================
   images.js — 画像の最適化・保存と、全画面ビューア（閲覧専用）
   過剰圧縮はしない。スクリーンショットの文字が読める品質を保つ。
   =========================================================== */
(function (global) {
  'use strict';

  var MAX_EDGE = 2000;        // 長辺の上限
  var KEEP_AS_IS = 900 * 1024; // これ以下で寸法も収まっていれば無加工で保存

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
      img.src = url;
    });
  }

  // 端末容量に配慮しつつ、内容と文字が読める品質を維持する
  function optimize(file) {
    return loadImage(file).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      var long = Math.max(w, h);
      if (long <= MAX_EDGE && file.size <= KEEP_AS_IS) {
        return { blob: file, w: w, h: h };
      }
      var scale = long > MAX_EDGE ? MAX_EDGE / long : 1;
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);
      return new Promise(function (resolve) {
        cv.toBlob(function (b) {
          // 変換で大きくなってしまう場合は元を使う
          if (!b || (b.size >= file.size && long <= MAX_EDGE)) resolve({ blob: file, w: w, h: h });
          else resolve({ blob: b, w: cw, h: ch });
        }, 'image/jpeg', 0.88);
      });
    });
  }

  function addFromFile(file) {
    return optimize(file).then(function (r) {
      var id = U.newId();
      return Store.putImage(id, r.blob).then(function () { return id; });
    });
  }

  /* ---------- 全画面ビューア ---------- */
  var vw, vimg, scale = 1, tx = 0, ty = 0, url = null;

  function apply() {
    vimg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }

  function reset() { scale = 1; tx = 0; ty = 0; apply(); }

  function setScaleAt(newScale, mx, my) {
    newScale = Math.min(6, Math.max(1, newScale));
    var px = (mx - tx) / scale;
    var py = (my - ty) / scale;
    tx = mx - newScale * px;
    ty = my - newScale * py;
    scale = newScale;
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  }

  function center() {
    var r = vw.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function open(blob) {
    if (!vw) init();
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    vimg.src = url;
    reset();
    vw.hidden = false;
  }

  function close() {
    vw.hidden = true;
    vimg.removeAttribute('src');
    if (url) { URL.revokeObjectURL(url); url = null; }
  }

  function init() {
    vw = U.$('#viewer');
    vimg = U.$('#viewer-img');
    U.$('#viewer-close').addEventListener('click', close);

    var pointers = Object.create(null), startDist = 0, startScale = 1, lastX = 0, lastY = 0, moved = false;

    function list() {
      var out = [];
      for (var k in pointers) out.push(pointers[k]);
      return out;
    }

    vw.addEventListener('pointerdown', function (e) {
      if (e.target === U.$('#viewer-close')) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var p = list();
      moved = false;
      if (p.length === 1) { lastX = e.clientX; lastY = e.clientY; }
      if (p.length === 2) {
        startDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        startScale = scale;
      }
      try { vw.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    });

    vw.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var p = list();
      if (p.length >= 2) {
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        if (startDist > 0) {
          var c = center();
          setScaleAt(startScale * (d / startDist), (p[0].x + p[1].x) / 2 - c.x, (p[0].y + p[1].y) / 2 - c.y);
        }
        moved = true;
      } else if (p.length === 1 && scale > 1) {
        tx += e.clientX - lastX;
        ty += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        moved = true;
        apply();
      }
    });

    function up(e) {
      delete pointers[e.pointerId];
      var p = list();
      if (p.length < 2) startDist = 0;
      if (p.length === 1) { lastX = p[0].x; lastY = p[0].y; }
      // 拡大していない状態での単純なタップは閉じる
      if (p.length === 0 && !moved && scale === 1) close();
    }
    vw.addEventListener('pointerup', up);
    vw.addEventListener('pointercancel', up);

    // PC: ホイールで拡大縮小
    vw.addEventListener('wheel', function (e) {
      e.preventDefault();
      var c = center();
      setScaleAt(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - c.x, e.clientY - c.y);
    }, { passive: false });
  }

  global.Img = {
    addFromFile: addFromFile,
    open: open,
    close: close,
    isOpen: function () { return vw && !vw.hidden; }
  };
})(window);
