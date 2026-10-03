/* ===========================================================
   app.js — 画面制御
   原則: ユーザーがいた場所を勝手に変えない / 一覧で画像を読まない
   =========================================================== */
(function () {
  'use strict';

  var $ = U.$, $$ = U.$$;
  var PAGE = 40;            // 一覧は少しずつDOMへ展開する
  var SEL_LABEL = { list: 'メモ一覧', search: '検索結果', box: '書き出し箱' };

  /* ---------- 画面定義 ---------- */
  var views = {
    list: { el: $('#view-list'), scroll: $('#scroll-list'), ul: $('#items-list'), empty: $('#empty-list') },
    search: { el: $('#view-search'), scroll: $('#scroll-search'), ul: $('#items-search'), empty: $('#empty-search') },
    box: { el: $('#view-box'), scroll: $('#scroll-box'), ul: $('#items-box'), empty: $('#empty-box') },
    editor: { el: $('#view-editor'), scroll: $('#scroll-editor') },
    settings: { el: $('#view-settings'), scroll: $('#scroll-settings') },
    trash: { el: $('#view-trash'), scroll: $('#scroll-trash'), ul: $('#items-trash'), empty: $('#empty-trash') }
  };

  var cur = 'list';
  var data = { list: [], search: [], box: [], trash: [] };
  var shown = { list: 0, search: 0, box: 0, trash: 0 };
  var sel = { active: false, scope: null, ids: [] };
  var focusTop = false;      // 作成・更新後は対象が見える位置（先頭）へ

  /* ---------- 編集状態 ---------- */
  var ta = $('#ed-body');
  var ed = {
    open: false, id: null, loc: 'normal', readonly: false,
    tags: [], imgs: [], baseSig: '', returnTo: 'list'
  };
  var thumbUrls = [];

  /* ===========================================================
     共通
     =========================================================== */
  function rememberScroll() {
    var v = views[cur];
    if (v && v.scroll) {
      S.session.scrolls[cur] = v.scroll.scrollTop;
    }
  }

  function restoreScroll(name, top) {
    var v = views[name];
    if (!v || !v.scroll) return;
    var y = (top !== undefined) ? top : (S.session.scrolls[name] || 0);
    v.scroll.scrollTop = y;
    requestAnimationFrame(function () { v.scroll.scrollTop = y; });
  }

  function setView(name, scrollTop) {
    if (cur !== name) rememberScroll();
    if (sel.active && name !== cur) exitSelect();
    Object.keys(views).forEach(function (k) {
      views[k].el.classList.toggle('active', k === name);
    });
    cur = name;
    $$('.nav-btn').forEach(function (b) {
      var map = { list: 'list', search: 'search' };
      b.setAttribute('aria-current', map[name] === b.dataset.nav ? 'true' : 'false');
    });
    $('#btn-settings').hidden = (name !== 'list');
    S.session.view = name;
    S.saveSession();
    restoreScroll(name, scrollTop);
  }

  function refreshBoxCount() {
    return Store.count('box').then(function (n) {
      $('#btn-box').textContent = '書き出し箱 (' + n + ')';
      $('#box-title').textContent = '書き出し箱 (' + n + ')';
    });
  }

  /* ===========================================================
     一覧描画
     =========================================================== */
  function tagText(tags) {
    return (tags || []).map(function (t) { return '#' + t; }).join(' ');
  }

  function daysLeft(trashedAt) {
    var left = (trashedAt || 0) + Store.TRASH_DAYS * U.DAY - Date.now();
    return Math.max(0, Math.ceil(left / U.DAY));
  }

  function makeItem(m, scope) {
    var li = document.createElement('li');
    li.dataset.id = m.id;
    if (sel.active && sel.scope === scope && sel.ids.indexOf(m.id) >= 0) li.className = 'selected';

    if (sel.active && sel.scope === scope) {
      var ck = document.createElement('span');
      ck.className = 'mi-check';
      ck.textContent = (sel.ids.indexOf(m.id) >= 0) ? '☑' : '□';
      li.appendChild(ck);
    }

    var main = document.createElement('div');
    main.className = 'mi-main';

    var pv = document.createElement('div');
    pv.className = 'mi-preview';
    if (m.preview && m.preview.trim() !== '') {
      pv.textContent = m.preview;
    } else {
      pv.className += ' none';
      pv.textContent = (m.imgs && m.imgs.length) ? '（画像のみ）' : '（本文なし）';
    }
    main.appendChild(pv);

    var meta = document.createElement('div');
    meta.className = 'mi-meta';

    var when = document.createElement('span');
    when.textContent = (scope === 'trash')
      ? 'あと' + daysLeft(m.trashedAt) + '日で削除'
      : U.fmtDateTime(m.updatedAt);
    meta.appendChild(when);

    if (m.tags && m.tags.length) {
      var tg = document.createElement('span');
      tg.className = 'mi-tag';
      tg.textContent = tagText(m.tags);
      meta.appendChild(tg);
    }
    if (m.imgs && m.imgs.length) {
      var im = document.createElement('span');
      im.textContent = '🖼' + m.imgs.length;   // サムネイル本体は読み込まない
      meta.appendChild(im);
    }
    main.appendChild(meta);
    li.appendChild(main);

    if (scope === 'trash') {
      var side = document.createElement('div');
      side.className = 'mi-side';
      var b = document.createElement('button');
      b.className = 'link';
      b.textContent = '復元';
      b.dataset.act = 'restore';
      side.appendChild(b);
      li.appendChild(side);
    }
    return li;
  }

  function renderList(scope, reset) {
    var v = views[scope];
    var arr = data[scope];
    if (reset) {
      var keep = Math.max(PAGE, shown[scope]);
      v.ul.textContent = '';
      shown[scope] = 0;
      var end0 = Math.min(arr.length, keep);
      var f0 = document.createDocumentFragment();
      for (var i = 0; i < end0; i++) f0.appendChild(makeItem(arr[i], scope));
      v.ul.appendChild(f0);
      shown[scope] = end0;
    } else {
      var end = Math.min(arr.length, shown[scope] + PAGE);
      var f = document.createDocumentFragment();
      for (var j = shown[scope]; j < end; j++) f.appendChild(makeItem(arr[j], scope));
      v.ul.appendChild(f);
      shown[scope] = end;
    }
    if (v.empty) v.empty.hidden = arr.length > 0;
    if (scope === 'search') {
      $('#search-hint').hidden = S.session.searchTags.length > 0;
      $('#empty-search').hidden = !(S.session.searchTags.length > 0 && arr.length === 0);
    }
  }

  function loadList(scope) {
    if (scope === 'search') {
      var picked = S.session.searchTags;
      return Store.list('normal').then(function (arr) {
        data.search = picked.length
          ? arr.filter(function (m) {
              return (m.tags || []).some(function (t) { return picked.indexOf(t) >= 0; });
            })
          : [];
        renderList('search', true);
      });
    }
    var loc = scope === 'list' ? 'normal' : (scope === 'box' ? 'box' : 'trash');
    return Store.list(loc).then(function (arr) {
      data[scope] = arr;
      renderList(scope, true);
    });
  }

  // 一覧の追加読み込み（下端付近）
  ['list', 'search', 'box', 'trash'].forEach(function (scope) {
    views[scope].scroll.addEventListener('scroll', function () {
      var el = views[scope].scroll;
      if (shown[scope] < data[scope].length &&
          el.scrollHeight - el.scrollTop - el.clientHeight < 700) {
        renderList(scope, false);
      }
    }, { passive: true });
  });

  /* ---------- 一覧のタップ / 長押し ---------- */
  ['list', 'search', 'box', 'trash'].forEach(function (scope) {
    var ul = views[scope].ul;
    var pressId = null;

    ul.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest ? e.target.closest('button') : null;
      var li = e.target.closest ? e.target.closest('li') : null;
      pressId = (btn || !li) ? null : li.dataset.id;
    });

    ul.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var li = btn.closest('li');
      if (!li) return;
      if (btn.dataset.act === 'restore') {
        Store.moveToNormal([li.dataset.id]).then(function () {
          U.toast('✓ 復元しました');
          return Promise.all([loadList('trash'), loadList('list')]);
        });
      }
    });

    U.attachPress(ul,
      function () {
        if (!pressId) return;
        if (sel.active && sel.scope === scope) toggleSelect(pressId, scope);
        else openEditor(pressId, scope, { readonly: scope === 'trash' });
      },
      function () {
        if (!pressId || scope === 'trash') return;
        if (!sel.active) enterSelect(scope);
        if (sel.scope === scope && sel.ids.indexOf(pressId) < 0) toggleSelect(pressId, scope);
      });
  });

  /* ===========================================================
     選択モード
     =========================================================== */
  function selBars(scope) {
    var root = views[scope].el;
    return { normal: root.querySelector('[data-normalbar]'), sel: root.querySelector('[data-selbar]') };
  }

  function enterSelect(scope) {
    sel.active = true; sel.scope = scope; sel.ids = [];
    var b = selBars(scope);
    if (b.normal) b.normal.hidden = true;
    if (b.sel) b.sel.hidden = false;
    updateSelCount();
    renderList(scope, true);
  }

  function exitSelect(rerender) {
    if (!sel.active) return;
    var scope = sel.scope;
    var b = selBars(scope);
    if (b.normal) b.normal.hidden = false;
    if (b.sel) b.sel.hidden = true;
    sel.active = false; sel.scope = null; sel.ids = [];
    if (rerender !== false) renderList(scope, true);
  }

  function toggleSelect(id, scope) {
    var i = sel.ids.indexOf(id);
    if (i >= 0) sel.ids.splice(i, 1); else sel.ids.push(id);
    updateSelCount();
    var li = views[scope].ul.querySelector('li[data-id="' + id + '"]');
    if (li) {
      var on = sel.ids.indexOf(id) >= 0;
      li.classList.toggle('selected', on);
      var ck = li.querySelector('.mi-check');
      if (ck) ck.textContent = on ? '☑' : '□';
    }
  }

  function updateSelCount() {
    if (!sel.active) return;
    var b = selBars(sel.scope);
    var c = b.sel && b.sel.querySelector('.sel-count');
    if (c) c.textContent = sel.ids.length + '件';
    var all = b.sel && b.sel.querySelector('.sel-all');
    if (all) {
      var full = data[sel.scope].length > 0 && sel.ids.length === data[sel.scope].length;
      all.textContent = (full ? '☑' : '□') + ' 全選択';
    }
  }

  $$('.sel-start').forEach(function (btn) {
    btn.addEventListener('click', function () { enterSelect(btn.dataset.scope); });
  });
  $$('.sel-cancel').forEach(function (btn) {
    btn.addEventListener('click', function () { exitSelect(); });
  });
  $$('.sel-all').forEach(function (btn) {
    btn.addEventListener('click', function () {
      // 全選択の範囲は、いまその画面に表示されている対象のみ
      var arr = data[sel.scope];
      sel.ids = (sel.ids.length === arr.length) ? [] : arr.map(function (m) { return m.id; });
      updateSelCount();
      renderList(sel.scope, true);
    });
  });
  $$('.sel-move').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!sel.ids.length) return;
      var ids = sel.ids.slice(), scope = sel.scope;
      Store.moveToBox(ids).then(function () {   // 件数に関係なく確認なし
        exitSelect(false);
        U.toast('✓ 書き出し箱へ移動しました');
        return Promise.all([loadList(scope), refreshBoxCount()]);
      });
    });
  });
  $$('.sel-del').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!sel.ids.length) return;
      var ids = sel.ids.slice(), scope = sel.scope;
      var go = function () {
        return Store.trash(ids).then(function () {
          exitSelect(false);
          U.toast('✓ ゴミ箱へ移動しました');
          return Promise.all([loadList(scope), refreshBoxCount()]);
        });
      };
      if (ids.length === 1) { go(); return; }
      U.confirmDialog('選択した' + ids.length + '件をゴミ箱へ移動しますか？', [
        { label: '移動', value: 'ok', cls: 'danger' },
        { label: 'キャンセル', value: null }
      ]).then(function (r) { if (r === 'ok') go(); });
    });
  });
  $$('.sel-back').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!sel.ids.length) return;
      var ids = sel.ids.slice();
      Store.moveToNormal(ids).then(function () {
        exitSelect(false);
        U.toast('✓ 元へ戻しました');
        return Promise.all([loadList('box'), loadList('list'), refreshBoxCount()]);
      });
    });
  });

  /* ===========================================================
     編集画面
     =========================================================== */
  function emptyNow() {
    return U.isBlank(ta.value) && ed.tags.length === 0 && ed.imgs.length === 0;
  }

  function draftSnapshot() {
    if (!ed.open || ed.readonly) return null;
    return {
      id: ed.id, loc: ed.loc, body: ta.value,
      tags: ed.tags.slice(), imgs: ed.imgs.slice(),
      baseSig: ed.baseSig, returnTo: ed.returnTo,
      sel: [ta.selectionStart, ta.selectionEnd],
      scroll: views.editor.scroll.scrollTop
    };
  }

  function touchDraft() { S.scheduleDraft(draftSnapshot); }

  var sizeQueued = false;
  function autosize() {
    if (sizeQueued) return;
    sizeQueued = true;
    requestAnimationFrame(function () {
      sizeQueued = false;
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
  }

  function renderTags() {
    var box = $('#ed-chips');
    box.textContent = '';
    ed.tags.forEach(function (name) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      var t = document.createElement('span');
      t.textContent = '#' + name;
      chip.appendChild(t);
      if (!ed.readonly) {
        var x = document.createElement('button');
        x.className = 'x';
        x.textContent = '✕';
        x.onclick = function () {
          ed.tags = ed.tags.filter(function (n) { return n !== name; });
          renderTags(); touchDraft();
        };
        chip.appendChild(x);
      }
      box.appendChild(chip);
    });
    $('#ed-tagcount').textContent = ed.tags.length + ' / 5';
    renderTagHistory();
  }

  function renderTagHistory() {
    var pool = $('#ed-taghist');
    pool.textContent = '';
    if (ed.readonly) return;
    S.tags().forEach(function (t) {
      if (ed.tags.indexOf(t.name) >= 0) return;
      var b = document.createElement('button');
      b.className = 'tagbtn';
      b.textContent = '#' + t.name;
      U.attachPress(b,
        function () { addTag(t.name); },
        function () { tagHistoryMenu(t.name); });
      pool.appendChild(b);
    });
  }

  function addTag(raw) {
    var name = String(raw || '').replace(/^#+/, '').trim();
    if (!name) return;
    if (ed.tags.indexOf(name) >= 0) { U.toast('同じタグがあります'); return; }
    if (ed.tags.length >= 5) { U.toast('タグは5個までです'); return; }
    ed.tags.push(name);
    S.touchTags([name]);
    renderTags();
    touchDraft();
  }

  function renderThumbs() {
    var box = $('#ed-thumbs');
    thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    thumbUrls = [];
    box.textContent = '';
    ed.imgs.forEach(function (iid, idx) {
      var wrap = document.createElement('div');
      wrap.className = 'th';
      var im = document.createElement('img');
      im.alt = '画像' + (idx + 1);
      Store.image(iid).then(function (blob) {
        if (!blob) return;
        var u = URL.createObjectURL(blob);
        thumbUrls.push(u);
        im.src = u;
      });
      im.onclick = function () {
        Store.image(iid).then(function (blob) { if (blob) Img.open(blob); });
      };
      wrap.appendChild(im);
      if (!ed.readonly) {
        var del = document.createElement('button');
        del.className = 'del';
        del.textContent = '✕';
        del.onclick = function () {             // 画像1枚の削除は確認なし
          ed.imgs = ed.imgs.filter(function (x) { return x !== iid; });
          renderThumbs(); touchDraft();
        };
        wrap.appendChild(del);
      }
      box.appendChild(wrap);
    });
    $('#ed-imgcount').textContent = ed.imgs.length + ' / 2';
    $('#ed-imgadd').hidden = ed.readonly || ed.imgs.length >= 2;  // 3枚目の操作は出さない
  }

  function paintEditor() {
    ta.readOnly = ed.readonly;
    $('#ed-bottom').hidden = ed.readonly;
    $('#ed-bottom-ro').hidden = !ed.readonly;
    $('#ed-menu').hidden = ed.readonly;
    $('#ed-where').textContent = ed.readonly ? 'ゴミ箱のメモ（閲覧のみ）'
      : (ed.loc === 'box' ? '書き出し箱のメモ' : '');
    renderTags();
    renderThumbs();
    autosize();
  }

  // id が null なら新規。from は戻り先の画面。
  function openEditor(id, from, opts) {
    opts = opts || {};
    commitEditor('auto').then(function () {
      leaveEditorState();
      ed.open = true;
      ed.returnTo = from || 'list';
      ed.readonly = !!opts.readonly;
      if (!id) {
        ed.id = null; ed.loc = 'normal'; ed.tags = []; ed.imgs = [];
        ta.value = '';
        ed.baseSig = S.sig('', [], []);
        setView('editor', 0);
        paintEditor();
        touchDraft();
        ta.focus();   // 開いたらすぐ貼り付けられるようにする
        return;
      }
      return Store.full(id).then(function (r) {
        if (!r) { setView(from || 'list'); return; }
        ed.id = r.meta.id;
        ed.loc = r.meta.loc;
        ed.tags = (r.meta.tags || []).slice();
        ed.imgs = (r.meta.imgs || []).slice();
        ta.value = r.body;
        ed.baseSig = S.sig(r.body, ed.tags, ed.imgs);
        setView('editor', 0);
        paintEditor();
        touchDraft();
      });
    });
  }

  function openEditorFromDraft(d) {
    leaveEditorState();
    ed.open = true;
    ed.id = d.id || null;
    ed.loc = d.loc || 'normal';
    ed.readonly = false;
    ed.tags = (d.tags || []).slice(0, 5);
    ed.imgs = (d.imgs || []).slice(0, 2);
    ed.baseSig = d.baseSig || '';
    ed.returnTo = d.returnTo || 'list';
    ta.value = d.body || '';
    setView('editor', d.scroll || 0);
    paintEditor();
    if (d.sel) {
      try { ta.setSelectionRange(d.sel[0], d.sel[1]); } catch (e) { /* noop */ }
    }
    // 高さ確定後にもう一度スクロール位置を合わせる
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { views.editor.scroll.scrollTop = d.scroll || 0; });
    });
  }

  function leaveEditorState() {
    ed.open = false;
    S.clearDraft();
  }

  // reason: 'explicit' | 'auto'
  function commitEditor(reason) {
    if (!ed.open || ed.readonly) return Promise.resolve(null);
    var body = ta.value;
    var tags = ed.tags.slice();
    var imgs = ed.imgs.slice();

    if (!ed.id && U.isBlank(body) && tags.length === 0 && imgs.length === 0) {
      return Promise.resolve(null);   // 完全に空の新規メモは作成しない
    }

    return Store.save({ id: ed.id, body: body, tags: tags, imgs: imgs, baseSig: ed.baseSig })
      .then(function (res) {
        if (!res) return null;
        ed.id = res.id;
        ed.baseSig = S.sig(body, tags, imgs);
        if (res.created || res.changed) focusTop = true;
        if (reason === 'explicit') U.toast('✓ 保存しました');
        else if (res.created || res.changed) U.toast('✓ 自動保存しました');
        if (ed.open) S.flushDraft(draftSnapshot);
        return res;
      });
  }

  function closeEditor(to) {
    var target = to || ed.returnTo || 'list';
    if (!data[target]) target = 'list';
    return commitEditor('auto').then(function () {
      leaveEditorState();
      // 新規作成・実際に更新した場合のみ、対象が見える先頭へ。それ以外は元の位置。
      var top = focusTop ? 0 : undefined;
      focusTop = false;
      return Promise.all([loadList(target), refreshBoxCount()]).then(function () {
        setView(target, top);
      });
    });
  }

  /* ---------- 本文 ---------- */
  ta.addEventListener('input', function () { autosize(); touchDraft(); });
  ta.addEventListener('scroll', function () { touchDraft(); });
  ta.addEventListener('keyup', function () { touchDraft(); });
  ta.addEventListener('click', function () { touchDraft(); });
  views.editor.scroll.addEventListener('scroll', function () { touchDraft(); }, { passive: true });

  function insertDivider() {
    if (ed.readonly) return;
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    var before = v.slice(0, s), after = v.slice(e);
    // 区切り線は必ず1行として入る。続きは次の行から書ける。
    var text = (before && !/\n$/.test(before) ? '\n' : '') + U.DIVIDER + '\n';
    ta.focus();
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (err) { ok = false; }
    if (!ok) {
      ta.value = before + text + after;
      var pos = before.length + text.length;
      ta.setSelectionRange(pos, pos);
    }
    autosize();
    touchDraft();
  }

  $('#btn-divider').addEventListener('click', insertDivider);
  $('#btn-save').addEventListener('click', function () { commitEditor('explicit'); });
  $('#ed-back').addEventListener('click', function () { closeEditor(ed.returnTo); });
  $('#btn-restore').addEventListener('click', function () {
    var id = ed.id;
    Store.moveToNormal([id]).then(function () {
      U.toast('✓ 復元しました');
      ed.open = false;
      return Promise.all([loadList('trash'), loadList('list')]);
    }).then(function () { setView('trash'); });
  });

  // PC: 自分で登録したショートカットで区切り線を挿入
  ta.addEventListener('keydown', function (e) {
    var k = S.settings.dividerKey;
    if (!k || !U.isDesktop) return;
    if (e.key.toLowerCase() !== k.key) return;
    if (!!k.ctrl !== e.ctrlKey || !!k.shift !== e.shiftKey || !!k.alt !== e.altKey || !!k.meta !== e.metaKey) return;
    e.preventDefault();
    insertDivider();
  });

  /* ---------- タグ入力 ---------- */
  $('#ed-tagadd').addEventListener('click', function () {
    addTag($('#ed-taginput').value);
    $('#ed-taginput').value = '';
  });
  $('#ed-taginput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag($('#ed-taginput').value);
      $('#ed-taginput').value = '';
    }
  });

  // タグ履歴の長押しメニュー（専用のタグ管理画面は作らない）
  function tagHistoryMenu(name) {
    U.sheet('#' + name, [
      { label: '名前変更', value: 'rename' },
      { label: '履歴から削除', value: 'remove' },
      { label: 'キャンセル', value: null }
    ]).then(function (r) {
      if (r === 'remove') {
        S.removeTagFromHistory(name);
        renderTagHistory();
        renderSearchTags();
        return;
      }
      if (r !== 'rename') return;
      var next = window.prompt('新しいタグ名', name);
      if (next === null) return;
      next = next.replace(/^#+/, '').trim();
      if (!next || next === name) return;
      renameTagEverywhere(name, next);
    });
  }

  // 名前変更はそのタグを使用している全メモへ反映。既存タグへは自動統合。
  function renameTagEverywhere(from, to) {
    return DB.getAll('memos').then(function (all) {
      var hit = all.filter(function (m) { return (m.tags || []).indexOf(from) >= 0; });
      hit.forEach(function (m) {
        var out = [];
        m.tags.forEach(function (t) {
          var v = (t === from) ? to : t;
          if (out.indexOf(v) < 0) out.push(v);   // 同一メモ内で重複したら1個だけ残す
        });
        m.tags = out.slice(0, 5);
      });
      return DB.batch(['memos'], function (s) {
        hit.forEach(function (m) { s.memos.put(m); });
      });
    }).then(function () {
      S.renameTagInHistory(from, to);
      // 編集中のメモ・検索条件にも反映
      ed.tags = ed.tags.reduce(function (acc, t) {
        var v = (t === from) ? to : t;
        if (acc.indexOf(v) < 0) acc.push(v);
        return acc;
      }, []);
      S.session.searchTags = S.session.searchTags.reduce(function (acc, t) {
        var v = (t === from) ? to : t;
        if (acc.indexOf(v) < 0) acc.push(v);
        return acc;
      }, []);
      S.saveSession();
      if (ed.open) renderTags();
      renderSearchTags();
      U.toast('✓ タグ名を変更しました');
      return Promise.all([loadList('list'), loadList('box'), loadList('search')]);
    });
  }

  /* ---------- 画像 ---------- */
  $('#ed-imgadd').addEventListener('click', function () { $('#ed-imgfile').click(); });
  $('#ed-imgfile').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (ed.imgs.length >= 2) return;
    Img.addFromFile(file).then(function (id) {
      ed.imgs.push(id);      // 画像順は選択順で固定
      renderThumbs();
      touchDraft();
    }).catch(function () { U.toast('画像を読み込めませんでした'); });
  });

  /* ---------- 編集画面メニュー ---------- */
  $('#ed-menu').addEventListener('click', function () {
    U.sheet('', [
      { label: '変更を破棄', value: 'discard', cls: 'danger' },
      { label: 'キャンセル', value: null }
    ]).then(function (r) {
      if (r !== 'discard') return;
      if (!ed.id) {
        U.confirmDialog('この新規メモを破棄しますか？', [
          { label: '破棄する', value: 'ok', cls: 'danger' },
          { label: 'キャンセル', value: null }
        ]).then(function (a) {
          if (a !== 'ok') return;
          // 新規メモ自体を破棄して一覧へ戻る（ゴミ箱には入れない）
          leaveEditorState();
          ed.imgs = [];
          Store.collectGarbageImages([]).then(function () {
            return Promise.all([loadList('list'), refreshBoxCount()]);
          }).then(function () { setView('list'); });
        });
        return;
      }
      U.confirmDialog('最後に保存した状態へ戻しますか？', [
        { label: '変更を破棄', value: 'ok', cls: 'danger' },
        { label: 'キャンセル', value: null }
      ]).then(function (a) {
        if (a !== 'ok') return;
        var back = ed.returnTo;
        leaveEditorState();
        Store.collectGarbageImages([]).then(function () {
          return Promise.all([loadList(back === 'box' ? 'box' : (back === 'search' ? 'search' : 'list')), refreshBoxCount()]);
        }).then(function () { setView(back); });
      });
    });
  });

  /* ===========================================================
     ナビゲーション
     =========================================================== */
  $$('.nav-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var to = b.dataset.nav;
      if (to === 'write') {
        openEditor(null, cur === 'search' ? 'search' : 'list');
        return;
      }
      if (ed.open) { closeEditor(to); return; }
      if (to === 'list') { loadList('list').then(refreshBoxCount).then(function () { setView('list'); }); }
      else if (to === 'search') { renderSearchTags(); loadList('search').then(function () { setView('search'); }); }
    });
  });

  $$('[data-back]').forEach(function (b) {
    b.addEventListener('click', function () {
      var to = b.dataset.back;
      if (to === 'list') loadList('list').then(refreshBoxCount).then(function () { setView('list'); });
      else setView(to);
    });
  });

  $('#btn-settings').addEventListener('click', function () { setView('settings'); });

  $('#btn-box').addEventListener('click', function () {
    loadList('box').then(refreshBoxCount).then(function () { setView('box'); });
  });

  /* ===========================================================
     検索（タグのみ・複数選択はOR）
     =========================================================== */
  function renderSearchTags() {
    var pool = $('#search-tags');
    pool.textContent = '';
    var list = S.tags();
    $('#empty-searchtags').hidden = list.length > 0;
    list.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tagbtn' + (S.session.searchTags.indexOf(t.name) >= 0 ? ' on' : '');
      b.textContent = '#' + t.name;
      U.attachPress(b,
        function () {
          var i = S.session.searchTags.indexOf(t.name);
          if (i >= 0) S.session.searchTags.splice(i, 1);
          else S.session.searchTags.push(t.name);
          S.saveSession();
          b.classList.toggle('on');
          loadList('search');
        },
        function () { tagHistoryMenu(t.name); });
      pool.appendChild(b);
    });
  }

  $('#btn-search-clear').addEventListener('click', function () {
    S.session.searchTags = [];
    S.saveSession();
    renderSearchTags();
    loadList('search');
  });

  /* ===========================================================
     書き出し箱
     =========================================================== */
  $('#box-restore-all').addEventListener('click', function () {
    if (!data.box.length) return;
    var ids = data.box.map(function (m) { return m.id; });
    Store.moveToNormal(ids).then(function () {
      U.toast('✓ すべて元に戻しました');
      return Promise.all([loadList('box'), loadList('list'), refreshBoxCount()]);
    });
  });

  function askImagePdf(metas) {
    var withImg = Exporter.withImages(metas);
    if (!withImg.length) return Promise.resolve();
    return U.confirmDialog(withImg.length + '件のメモに画像があります。これらのメモだけPDF出力しても良いですか？', [
      { label: 'PDFにする', value: 'pdf', cls: 'primary' },
      { label: 'しない', value: null }
    ]).then(function (r) {
      if (r === 'pdf') return Exporter.pdf(withImg);
    });
  }

  function exportGuard() {
    if (!data.box.length) { U.toast('書き出し箱が空です'); return false; }
    return true;
  }

  $('#ex-txt').addEventListener('click', function () {
    if (!exportGuard()) return;
    var metas = data.box.slice();
    Exporter.txt(metas).then(function () {
      U.toast('✓ 書き出しました');
      return askImagePdf(metas);     // 書き出し箱の状態は変えない
    });
  });

  $('#ex-md').addEventListener('click', function () {
    if (!exportGuard()) return;
    var metas = data.box.slice();
    Exporter.md(metas).then(function () {
      U.toast('✓ 書き出しました');
      return askImagePdf(metas);
    });
  });

  $('#ex-pdf').addEventListener('click', function () {
    if (!exportGuard()) return;
    Exporter.pdf(data.box.slice()).then(function () { U.toast('✓ 書き出しました'); });
  });

  /* ===========================================================
     設定
     =========================================================== */
  function paintSettings() {
    $$('#set-fs button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.fs === S.settings.fontSize ? 'true' : 'false');
    });
    $$('#set-theme button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.theme === S.settings.theme ? 'true' : 'false');
    });
    $('#set-shortcut-block').hidden = !U.isDesktop;
    var k = S.settings.dividerKey;
    $('#set-shortcut-now').textContent = k ? '現在: ' + k.label : '未登録';
    $('#set-bknotify').checked = !!S.settings.backupNotify;
    $('#set-bklast').textContent = S.backup.lastBackupAt
      ? '最後のバックアップ: ' + U.fmtDateTime(S.backup.lastBackupAt)
      : 'まだバックアップしていません。';
  }

  $$('#set-fs button').forEach(function (b) {
    b.addEventListener('click', function () {
      S.settings.fontSize = b.dataset.fs;
      S.saveSettings(); S.applyAppearance(); paintSettings();
      if (ed.open) autosize();
    });
  });
  $$('#set-theme button').forEach(function (b) {
    b.addEventListener('click', function () {
      S.settings.theme = b.dataset.theme;
      S.saveSettings(); S.applyAppearance(); paintSettings();
    });
  });

  // 区切り線ショートカットの登録（初期ショートカットなし）
  var recording = false;
  $('#set-shortcut-rec').addEventListener('click', function () {
    recording = true;
    $('#set-shortcut-now').textContent = '希望のキー操作を押してください…';
  });
  $('#set-shortcut-clr').addEventListener('click', function () {
    S.settings.dividerKey = null;
    S.saveSettings(); paintSettings();
  });
  window.addEventListener('keydown', function (e) {
    if (!recording) return;
    e.preventDefault();
    if (e.key === 'Escape') { recording = false; paintSettings(); return; }
    if (['Control', 'Shift', 'Alt', 'Meta'].indexOf(e.key) >= 0) return;
    var parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    S.settings.dividerKey = {
      key: e.key.toLowerCase(),
      ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
      label: parts.join(' + ')
    };
    S.saveSettings();
    recording = false;
    paintSettings();
  }, true);

  $('#set-trash').addEventListener('click', function () {
    Store.purgeExpired().then(function () { return loadList('trash'); }).then(function () { setView('trash'); });
  });

  $('#set-backup').addEventListener('click', function () {
    Backup.save().then(function () {
      U.toast('✓ バックアップしました');
      paintSettings();
    }).catch(function () { U.toast('バックアップに失敗しました'); });
  });

  $('#set-restore').addEventListener('click', function () { $('#set-restore-file').click(); });
  $('#set-restore-file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    U.confirmDialog('現在のデータをすべて置き換えます。元に戻せません。復元しますか？', [
      { label: '復元する', value: 'ok', cls: 'danger' },
      { label: 'キャンセル', value: null }
    ]).then(function (r) {
      if (r !== 'ok') return;
      U.readFileText(file)
        .then(function (text) { return Backup.restore(JSON.parse(text)); })
        .then(function () {
          ed.open = false;
          U.toast('✓ 復元しました');
          return Promise.all([loadList('list'), loadList('box'), loadList('trash'), refreshBoxCount()]);
        })
        .then(function () {
          S.session.searchTags = [];
          S.saveSession();
          renderSearchTags();
          paintSettings();
          setView('list', 0);
        })
        .catch(function () { U.toast('このファイルは復元できません'); });
    });
  });

  $('#set-bknotify').addEventListener('change', function (e) {
    S.settings.backupNotify = e.target.checked;
    S.saveSettings();
  });

  /* ===========================================================
     バックアップ通知（常時監視はしない。起動時に判定するだけ）
     =========================================================== */
  function maybeNotifyBackup() {
    if (!S.settings.backupNotify) return;
    var now = Date.now();
    if (S.backup.snoozeUntil && now < S.backup.snoozeUntil) return;
    var base = S.backup.lastBackupAt || S.backup.since || now;
    if (now - base < 30 * U.DAY) return;
    U.confirmDialog('しばらくバックアップしていません。', [
      { label: 'バックアップ', value: 'go', cls: 'primary' },
      { label: 'あとで', value: 'later' }
    ]).then(function (r) {
      if (r === 'go') {
        Backup.save().then(function () { U.toast('✓ バックアップしました'); paintSettings(); });
      } else {
        S.backup.snoozeUntil = Date.now() + 30 * U.DAY;   // 次の30日間は再通知しない
        S.saveBackupMeta();
      }
    });
  }

  /* ===========================================================
     離脱時の保護
     =========================================================== */
  function persistNow() {
    rememberScroll();
    S.saveSession();
    if (ed.open && !ed.readonly) S.flushDraft(draftSnapshot);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') persistNow();
  });
  window.addEventListener('pagehide', persistNow);
  window.addEventListener('beforeunload', persistNow);

  // 画像ビューアが開いていれば、戻る操作で先に閉じる
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && Img.isOpen()) Img.close();
  });

  /* ===========================================================
     起動
     =========================================================== */
  function boot() {
    S.applyAppearance();
    paintSettings();
    renderSearchTags();

    DB.open()
      .then(function () { return Store.purgeExpired(); })
      .then(function () {
        var d = S.readDraft();
        return Store.collectGarbageImages(d ? (d.imgs || []) : []).then(function () { return d; });
      })
      .then(function (d) {
        return Promise.all([loadList('list'), loadList('box'), refreshBoxCount()]).then(function () { return d; });
      })
      .then(function (d) {
        if (d) {
          // 異常終了・OS終了からの復帰：直前の入力状態へ戻す
          openEditorFromDraft(d);
          return;
        }
        var v = S.session.view || 'list';
        if (v === 'editor' || !views[v]) v = 'list';
        var pre = (v === 'search') ? loadList('search')
          : (v === 'trash') ? loadList('trash')
          : Promise.resolve();
        return pre.then(function () {
          setView(v);
          setTimeout(maybeNotifyBackup, 600);
        });
      })
      .catch(function (err) {
        console.error(err);
        U.toast('データを開けませんでした');
        setView('list');
      });

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* オフライン化は任意 */ });
    }
  }

  boot();
})();
