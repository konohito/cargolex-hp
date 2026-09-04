/* ブログ投稿画面
 * GitHub の Contents API を直接呼んで blog/posts/*.md を作成・更新・削除する。
 * 接続キー（fine-grained personal access token）は、この端末の localStorage にのみ保存する。
 */
(function () {
  'use strict';

  var OWNER = 'konohito';
  var REPO = 'cargolex-hp';
  var BRANCH = 'main';
  var API = 'https://api.github.com';
  var POSTS_DIR = 'blog/posts';
  var IMG_DIR = 'assets/img';
  var TOKEN_KEY = 'cargolex_admin_token';
  var DRAFT_KEY = 'cargolex_admin_draft';

  var $ = function (id) { return document.getElementById(id); };
  var token = '';
  var editing = null;          // 編集中の記事 {path, sha, slug}
  var pendingImages = [];      // 未アップロードの画像 [{path, blob, url}]
  var coverPath = '';          // アイキャッチのパス（assets/img/... ）

  // ---------------------------------------------------------------- 共通

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function show(el, msg, kind) {
    el.innerHTML = msg ? '<p class="adm-msg ' + kind + '">' + msg + '</p>' : '';
  }

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function apiError(status, body) {
    if (status === 401) return '接続キーが正しくないか、期限が切れています。「サインアウト」して登録し直してください。';
    if (status === 403) return '権限が足りません。接続キーの Contents が「Read and write」になっているか確認してください。';
    if (status === 404) return 'リポジトリにアクセスできません。接続キーの対象リポジトリに konohito/cargolex-hp が入っているか確認してください。';
    if (status === 409 || status === 422) return '保存できませんでした。別の場所で同じ記事が更新された可能性があります。一覧を読み込み直してからお試しください。';
    var detail = body && body.message ? '（' + esc(body.message) + '）' : '';
    return '通信に失敗しました' + detail + '。しばらく待ってからもう一度お試しください。';
  }

  function api(path, options) {
    options = options || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.body) headers['Content-Type'] = 'application/json';

    return fetch(API + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
        if (!res.ok) {
          var err = new Error(apiError(res.status, data));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error('インターネットに接続できませんでした。通信状況をご確認ください。');
    });
  }

  function repoPath(p) {
    return '/repos/' + OWNER + '/' + REPO + '/contents/' + p;
  }

  // ------------------------------------------------------- Markdown（表示用）

  var SAFE = /^(https?:\/\/|mailto:|tel:|#|\/)/;

  function safeUrl(u) {
    u = String(u).trim();
    if (SAFE.test(u)) return u;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) return '#';
    return u;
  }

  function localUrl(path) {
    for (var i = 0; i < pendingImages.length; i++) {
      if (pendingImages[i].path === path) return pendingImages[i].url;
    }
    return path;
  }

  function inline(t) {
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
      return '<img src="' + esc(localUrl(safeUrl(url))) + '" alt="' + alt + '">';
    });
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
      return '<a href="' + esc(safeUrl(url)) + '">' + text + '</a>';
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    return t;
  }

  function renderMarkdown(md) {
    var lines = esc(md.replace(/\r/g, '')).split('\n');
    var out = [], para = [], ul = [], ol = [], quote = [];

    function fp() { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } }
    function fu() { if (ul.length) { out.push('<ul>' + ul.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>'); ul = []; } }
    function fo() { if (ol.length) { out.push('<ol>' + ol.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>'); ol = []; } }
    function fq() { if (quote.length) { out.push('<blockquote>' + inline(quote.join('<br>')) + '</blockquote>'); quote = []; } }
    function all() { fp(); fu(); fo(); fq(); }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim(), m;
      if (!line) { all(); continue; }
      if (/^(-{3,}|_{3,})$/.test(line)) { all(); out.push('<hr>'); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        all();
        var lv = Math.min(Math.max(m[1].length + 1, 3), 5);
        out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>');
        continue;
      }
      if ((m = line.match(/^&gt;\s?(.*)$/))) { fp(); fu(); fo(); quote.push(m[1]); continue; }
      if ((m = line.match(/^(?:[-*]\s+|・\s*)(.+)$/))) { fp(); fo(); fq(); ul.push(m[1]); continue; }
      if ((m = line.match(/^\d+[.)]\s+(.+)$/))) { fp(); fu(); fq(); ol.push(m[1]); continue; }
      fu(); fo(); fq(); para.push(line);
    }
    all();
    return out.join('');
  }

  // ---------------------------------------------------------------- 画像

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした。')); };
      img.src = url;
    });
  }

  function shrink(file) {
    var MAX = 1600;
    return loadImage(file).then(function (img) {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var scale = Math.min(1, MAX / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          blob ? resolve(blob) : reject(new Error('画像を変換できませんでした。'));
        }, 'image/jpeg', 0.82);
      });
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1]); };
      fr.onerror = function () { reject(new Error('画像を読み込めませんでした。')); };
      fr.readAsDataURL(blob);
    });
  }

  function newImageName() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    var rand = Math.random().toString(36).slice(2, 6);
    return 'blog-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + rand + '.jpg';
  }

  function stageImage(file) {
    return shrink(file).then(function (blob) {
      var path = IMG_DIR + '/' + newImageName();
      var item = { path: path, blob: blob, url: URL.createObjectURL(blob) };
      pendingImages.push(item);
      return item;
    });
  }

  function uploadPending() {
    if (!pendingImages.length) return Promise.resolve();
    var queue = pendingImages.slice();
    return queue.reduce(function (chain, item) {
      return chain.then(function () {
        return blobToBase64(item.blob).then(function (b64) {
          return api(repoPath(item.path), {
            method: 'PUT',
            body: { message: '写真を追加: ' + item.path, content: b64, branch: BRANCH }
          });
        });
      });
    }, Promise.resolve()).then(function () {
      pendingImages = pendingImages.filter(function (i) { return queue.indexOf(i) === -1; });
    });
  }

  // ---------------------------------------------------------------- フォーム

  function today() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function form() {
    return {
      title: $('f-title').value.trim(),
      date: $('f-date').value || today(),
      category: $('f-category').value.trim(),
      slug: $('f-slug').value.trim().toLowerCase(),
      body: $('f-body').value
    };
  }

  function updatePreview() {
    var f = form();
    $('p-date').textContent = f.date.replace(/-/g, '.');
    var cat = $('p-cat');
    cat.textContent = f.category;
    cat.hidden = !f.category;
    $('p-title').textContent = f.title || 'タイトルを入力してください';
    var pc = $('p-cover');
    if (coverPath) {
      $('p-cover-img').src = localUrl(coverPath);
      pc.hidden = false;
    } else {
      pc.hidden = true;
    }
    $('p-body').innerHTML = renderMarkdown(f.body);
  }

  function buildMarkdown(f) {
    var head = ['---', 'title: ' + f.title, 'date: ' + f.date];
    if (f.category) head.push('category: ' + f.category);
    if (coverPath) head.push('cover: ' + coverPath);
    head.push('---', '');
    return head.join('\n') + '\n' + f.body.replace(/\r/g, '').trim() + '\n';
  }

  function parseMarkdown(text) {
    var meta = {}, body = text.replace(/\r/g, '');
    if (body.indexOf('---') === 0) {
      var end = body.indexOf('\n---', 3);
      if (end !== -1) {
        body.slice(3, end).split('\n').forEach(function (line) {
          var i = line.indexOf(':');
          if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        });
        body = body.slice(end + 4).replace(/^\n+/, '');
      }
    }
    return { meta: meta, body: body };
  }

  function autoSlug(date) {
    return 'post-' + date.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 5);
  }

  function resetForm() {
    editing = null;
    coverPath = '';
    pendingImages = [];
    $('f-title').value = '';
    $('f-date').value = today();
    $('f-category').value = '';
    $('f-slug').value = '';
    $('f-slug').readOnly = false;
    $('f-body').value = '';
    $('f-cover-file').value = '';
    $('cover-preview').hidden = true;
    $('publish-label').textContent = 'この内容で公開する';
    $('cancel-edit').hidden = true;
    updatePreview();
  }

  function saveDraft() {
    if (editing) return;
    try {
      var f = form();
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        title: f.title, date: f.date, category: f.category, slug: f.slug, body: f.body
      }));
    } catch (e) { /* 保存できなくても動作に影響なし */ }
  }

  function restoreDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || (!d.title && !d.body)) return false;
      $('f-title').value = d.title || '';
      $('f-date').value = d.date || today();
      $('f-category').value = d.category || '';
      $('f-slug').value = d.slug || '';
      $('f-body').value = d.body || '';
      return true;
    } catch (e) { return false; }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* noop */ }
  }

  // ---------------------------------------------------------------- 公開

  function publish() {
    var msg = $('msg');
    var f = form();
    if (!f.title) { show(msg, 'タイトルを入力してください。', 'err'); $('f-title').focus(); return; }
    if (!f.body.trim()) { show(msg, '本文を入力してください。', 'err'); $('f-body').focus(); return; }

    var slug = f.slug || autoSlug(f.date);
    if (!/^[0-9a-z][0-9a-z-]*$/.test(slug)) {
      show(msg, '記事のURL名は半角の小文字英数字とハイフンだけで入力してください。', 'err');
      $('f-slug').focus();
      return;
    }

    var path = editing ? editing.path : POSTS_DIR + '/' + f.date + '-' + slug + '.md';
    var btn = $('publish');
    btn.classList.add('adm-busy');
    show(msg, '公開しています…（写真がある場合は少し時間がかかります）', 'info');

    uploadPending()
      .then(function () {
        if (editing) return null;
        // 同名の記事がないか確認する
        return api(repoPath(path)).then(function () {
          throw new Error('同じURL名の記事がすでにあります。「記事のURL名」を変えてください。');
        }, function (err) {
          if (err.status === 404) return null;
          throw err;
        });
      })
      .then(function () {
        var body = {
          message: (editing ? 'ブログ記事を更新: ' : 'ブログ記事を追加: ') + f.title,
          content: b64encode(buildMarkdown(f)),
          branch: BRANCH
        };
        if (editing) body.sha = editing.sha;
        return api(repoPath(path), { method: 'PUT', body: body });
      })
      .then(function () {
        clearDraft();
        var wasEditing = !!editing;
        resetForm();
        show(msg,
          '<strong>' + (wasEditing ? '記事を更新しました。' : '記事を公開しました。') + '</strong><br>' +
          '1〜2分後に <a href="blog/" target="_blank" rel="noopener" style="text-decoration:underline">ブログページ</a> に反映されます。' +
          '（反映状況は <a href="https://github.com/' + OWNER + '/' + REPO + '/actions" target="_blank" rel="noopener" style="text-decoration:underline">こちら</a> で確認できます）',
          'ok');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(function (err) {
        show(msg, esc(err.message), 'err');
      })
      .then(function () {
        btn.classList.remove('adm-busy');
      });
  }

  // ---------------------------------------------------------------- 一覧

  function loadList() {
    var box = $('list');
    var msg = $('list-msg');
    show(msg, '読み込んでいます…', 'info');
    box.innerHTML = '';

    api(repoPath(POSTS_DIR) + '?ref=' + BRANCH)
      .then(function (entries) {
        var files = (entries || []).filter(function (e) {
          return e.type === 'file' && /\.md$/.test(e.name);
        }).sort(function (a, b) { return a.name < b.name ? 1 : -1; });

        if (!files.length) {
          show(msg, '', '');
          box.innerHTML = '<p class="adm-note" style="margin:0">記事はまだありません。</p>';
          return;
        }

        return Promise.all(files.map(function (file) {
          return api(repoPath(file.path)).then(function (data) {
            var parsed = parseMarkdown(b64decode(data.content));
            var m = file.name.match(/^(\d{4}-\d{2}-\d{2})/);
            return {
              path: file.path,
              name: file.name,
              sha: data.sha,
              title: parsed.meta.title || file.name,
              date: parsed.meta.date || (m ? m[1] : ''),
              category: parsed.meta.category || ''
            };
          });
        })).then(function (posts) {
          show(msg, '', '');
          box.innerHTML = posts.map(function (p, i) {
            return '<div class="adm-item">' +
              '<div class="adm-item-main"><strong>' + esc(p.title) + '</strong>' +
              '<span>' + esc(p.date) + (p.category ? '　' + esc(p.category) : '') + '　/　' + esc(p.name) + '</span></div>' +
              '<button class="adm-mini" data-edit="' + i + '" type="button">書き直す</button>' +
              '<button class="adm-mini danger" data-del="' + i + '" type="button">削除</button>' +
              '</div>';
          }).join('');
          box.dataset.posts = JSON.stringify(posts);
        });
      })
      .catch(function (err) {
        show(msg, esc(err.message), 'err');
      });
  }

  function postsFromList() {
    try { return JSON.parse($('list').dataset.posts || '[]'); } catch (e) { return []; }
  }

  function editPost(post) {
    show($('msg'), '読み込んでいます…', 'info');
    api(repoPath(post.path)).then(function (data) {
      var parsed = parseMarkdown(b64decode(data.content));
      pendingImages = [];
      editing = { path: post.path, sha: data.sha };
      coverPath = parsed.meta.cover || '';
      $('f-title').value = parsed.meta.title || '';
      $('f-date').value = parsed.meta.date || post.date || today();
      $('f-category').value = parsed.meta.category || '';
      var slugMatch = post.name.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
      $('f-slug').value = slugMatch ? slugMatch[1] : '';
      $('f-slug').readOnly = true;
      $('f-body').value = parsed.body;
      $('f-cover-file').value = '';
      if (coverPath) {
        $('cover-img').src = coverPath;
        $('cover-preview').hidden = false;
      } else {
        $('cover-preview').hidden = true;
      }
      $('publish-label').textContent = 'この内容で更新する';
      $('cancel-edit').hidden = false;
      updatePreview();
      switchTab('write');
      show($('msg'), '「' + esc(parsed.meta.title || post.name) + '」を読み込みました。書き直して「この内容で更新する」を押してください。', 'info');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }).catch(function (err) {
      show($('msg'), esc(err.message), 'err');
    });
  }

  function deletePost(post) {
    if (!window.confirm('「' + post.title + '」を削除します。よろしいですか？')) return;
    show($('list-msg'), '削除しています…', 'info');
    api(repoPath(post.path), {
      method: 'DELETE',
      body: { message: 'ブログ記事を削除: ' + post.title, sha: post.sha, branch: BRANCH }
    }).then(function () {
      show($('list-msg'), '削除しました。1〜2分後にホームページへ反映されます。', 'ok');
      loadList();
    }).catch(function (err) {
      show($('list-msg'), esc(err.message), 'err');
    });
  }

  // ---------------------------------------------------------------- 画面切替

  function switchTab(which) {
    var write = which === 'write';
    $('tab-write').classList.toggle('on', write);
    $('tab-list').classList.toggle('on', !write);
    $('pane-write').hidden = !write;
    $('pane-list').hidden = write;
    if (!write) loadList();
  }

  function enterApp() {
    $('setup').hidden = true;
    $('app').hidden = false;
    $('signout').hidden = false;
    if (!$('f-date').value) $('f-date').value = today();
    if (restoreDraft()) {
      show($('msg'), '前回の書きかけの内容を復元しました。', 'info');
    }
    updatePreview();
  }

  function enterSetup() {
    $('setup').hidden = false;
    $('app').hidden = true;
    $('signout').hidden = true;
  }

  function saveToken() {
    var value = $('token').value.trim();
    var msg = $('setup-msg');
    if (!value) { show(msg, '接続キーを貼り付けてください。', 'err'); return; }
    show(msg, '接続を確認しています…', 'info');
    token = value;
    api('/repos/' + OWNER + '/' + REPO).then(function () {
      try { localStorage.setItem(TOKEN_KEY, value); } catch (e) { /* noop */ }
      $('token').value = '';
      show(msg, '', '');
      enterApp();
    }).catch(function (err) {
      token = '';
      show(msg, esc(err.message), 'err');
    });
  }

  // ---------------------------------------------------------------- 入力補助

  function insert(before, after, placeholder) {
    var ta = $('f-body');
    var start = ta.selectionStart, end = ta.selectionEnd;
    var selected = ta.value.slice(start, end) || placeholder || '';
    var text = before + selected + (after || '');
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    var pos = start + before.length;
    ta.focus();
    ta.setSelectionRange(pos, pos + selected.length);
    updatePreview();
    saveDraft();
  }

  function bind() {
    $('save-token').addEventListener('click', saveToken);
    $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveToken(); });

    $('signout').addEventListener('click', function (e) {
      e.preventDefault();
      if (!window.confirm('この端末に保存した接続キーを消します。よろしいですか？')) return;
      try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* noop */ }
      token = '';
      enterSetup();
    });

    $('tab-write').addEventListener('click', function () { switchTab('write'); });
    $('tab-list').addEventListener('click', function () { switchTab('list'); });
    $('reload-list').addEventListener('click', loadList);

    ['f-title', 'f-date', 'f-category', 'f-body'].forEach(function (id) {
      $(id).addEventListener('input', function () { updatePreview(); saveDraft(); });
    });
    $('f-slug').addEventListener('input', saveDraft);

    document.querySelectorAll('.adm-tool[data-ins]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.dataset.ins;
        if (kind === 'h') insert('\n## ', '', '小見出し');
        else if (kind === 'li') insert('\n- ', '', '箇条書き');
        else if (kind === 'b') insert('**', '**', '太字にしたい文字');
        else if (kind === 'a') insert('[', '](https://)', 'リンクの文字');
      });
    });

    $('ins-img').addEventListener('click', function () { $('body-img-file').click(); });

    $('body-img-file').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      show($('msg'), '写真を準備しています…', 'info');
      stageImage(file).then(function (item) {
        insert('\n![写真](' + item.path + ')\n', '', '');
        show($('msg'), '写真を本文に入れました。公開ボタンを押すとアップロードされます。', 'ok');
      }).catch(function (err) {
        show($('msg'), esc(err.message), 'err');
      });
      this.value = '';
    });

    $('f-cover-file').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      show($('msg'), '写真を準備しています…', 'info');
      stageImage(file).then(function (item) {
        coverPath = item.path;
        $('cover-img').src = item.url;
        $('cover-preview').hidden = false;
        updatePreview();
        show($('msg'), 'アイキャッチ写真を設定しました。公開ボタンを押すとアップロードされます。', 'ok');
      }).catch(function (err) {
        show($('msg'), esc(err.message), 'err');
      });
    });

    $('f-cover-clear').addEventListener('click', function () {
      coverPath = '';
      $('f-cover-file').value = '';
      $('cover-preview').hidden = true;
      updatePreview();
    });

    $('publish').addEventListener('click', publish);

    $('cancel-edit').addEventListener('click', function () {
      resetForm();
      show($('msg'), '', '');
    });

    $('list').addEventListener('click', function (e) {
      var edit = e.target.closest('[data-edit]');
      var del = e.target.closest('[data-del]');
      var posts = postsFromList();
      if (edit) editPost(posts[Number(edit.dataset.edit)]);
      else if (del) deletePost(posts[Number(del.dataset.del)]);
    });
  }

  function init() {
    bind();
    try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }
    $('f-date').value = today();
    if (token) enterApp(); else enterSetup();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
