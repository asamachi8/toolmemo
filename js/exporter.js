/* ===========================================================
   exporter.js — TXT / Markdown / PDF 書き出し
   書き出し順は書き出し箱の画面表示（上→下）と一致させる。
   PDF は端末の「PDFとして保存」を使う。日本語・絵文字をそのまま印字でき、
   巨大な日本語フォントを同梱しないため最も軽い。
   =========================================================== */
(function (global) {
  'use strict';

  var TXT_SEP = '========================================';

  function stamp() { return U.fmtFileStamp(Date.now()); }

  // 表示順のメタ配列から、本文を読み込んだ書き出し用データを作る
  function materialize(metas) {
    return Promise.all(metas.map(function (m) {
      return Store.body(m.id).then(function (body) {
        return { meta: m, body: body };
      });
    }));
  }

  function tagLine(tags) {
    return (tags || []).map(function (t) { return '#' + t; }).join(' ');
  }

  function headLine(item) {
    var t = tagLine(item.meta.tags);
    return U.fmtDateTime(item.meta.updatedAt) + (t ? '  ' + t : '');
  }

  /* ---------- TXT ---------- */
  function buildTxt(items) {
    return items.map(function (it) {
      return headLine(it) + '\n\n' + it.body;
    }).join('\n\n' + TXT_SEP + '\n\n') + '\n';
  }

  /* ---------- Markdown ---------- */
  function buildMd(items) {
    return items.map(function (it) {
      return headLine(it) + '\n\n' + it.body;
    }).join('\n\n---\n\n') + '\n';
  }

  /* ---------- PDF（印刷 → PDFとして保存） ---------- */
  function buildPdf(items) {
    var area = U.$('#printarea');
    area.textContent = '';
    var urls = [];
    var waits = [];

    items.forEach(function (it) {
      var sec = document.createElement('section');
      sec.className = 'pm';

      var meta = document.createElement('p');
      meta.className = 'pm-meta';
      meta.textContent = headLine(it);
      sec.appendChild(meta);

      var body = document.createElement('p');
      body.className = 'pm-body';
      body.textContent = it.body;
      sec.appendChild(body);

      var imgs = it.meta.imgs || [];
      if (imgs.length) {
        var holder = document.createElement('div');
        holder.className = 'pm-img';
        sec.appendChild(holder);
        imgs.forEach(function (iid) {
          waits.push(Store.image(iid).then(function (blob) {
            if (!blob) return;
            return new Promise(function (resolve) {
              var u = URL.createObjectURL(blob);
              urls.push(u);
              var im = new Image();
              im.onload = im.onerror = function () { resolve(); };
              im.src = u;
              holder.appendChild(im);
            });
          }));
        });
      }
      area.appendChild(sec);
    });

    var title = document.title;
    var fileTitle = 'IdeaMemo_' + stamp();

    return Promise.all(waits).then(function () {
      return new Promise(function (resolve) {
        var cleaned = false;
        function cleanup() {
          if (cleaned) return;
          cleaned = true;
          window.removeEventListener('afterprint', cleanup);
          document.title = title;
          area.textContent = '';
          urls.forEach(function (u) { URL.revokeObjectURL(u); });
          resolve();
        }
        window.addEventListener('afterprint', cleanup);
        document.title = fileTitle;   // 保存時の初期ファイル名になる
        setTimeout(function () {
          window.print();
          setTimeout(cleanup, 60000); // afterprint が来ない環境の保険
        }, 120);
      });
    });
  }

  /* ---------- 公開API ---------- */
  var Exporter = {
    // metas: 書き出し箱の表示順そのまま
    txt: function (metas) {
      return materialize(metas).then(function (items) {
        var blob = new Blob([buildTxt(items)], { type: 'text/plain;charset=utf-8' });
        U.downloadBlob(blob, 'IdeaMemo_' + stamp() + '.txt');
        return items;
      });
    },

    md: function (metas) {
      return materialize(metas).then(function (items) {
        var blob = new Blob([buildMd(items)], { type: 'text/markdown;charset=utf-8' });
        U.downloadBlob(blob, 'IdeaMemo_' + stamp() + '.md');
        return items;
      });
    },

    pdf: function (metas) {
      return materialize(metas).then(function (items) { return buildPdf(items); });
    },

    withImages: function (metas) {
      return metas.filter(function (m) { return (m.imgs || []).length > 0; });
    }
  };

  global.Exporter = Exporter;
})(window);
