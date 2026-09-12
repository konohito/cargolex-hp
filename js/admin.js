/* ブログ投稿画面
 * GitHub の Contents API を直接呼んで blog/posts/*.md と写真を作成・更新・削除する。
 * ログインキー（personal access token）は、この端末の localStorage にのみ保存する。
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
  var editing = null;   // 編集中の記事 {path, sha}
  var photos = [];      // [{path, url, blob?, uploaded}]
  var coverPath = '';

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
    if (status === 401) return 'ログインキーが正しくないか、期限が切れています。右上の「サインアウト」から登録し直してください。';
    if (status === 403) return '権限が足りません。ログインキーを作るときに権限（repo または Contents の Read and write）が入っているかご確認ください。';
    if (status === 404) return 'ホームページのデータにアクセスできません。ログインキーの対象に konohito/cargolex-hp が入っているかご確認ください。';
    if (status === 409 || status === 422) return '保存できませんでした。別の場所で同じ記事が更新された可能性があります。「記事の管理」から読み込み直してお試しください。';
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

  // ------------------------------------------------------- Markdown（プレビュー）

  var SAFE = /^(https?:\/\/|mailto:|tel:|#|\/)/;

  function safeUrl(u) {
    u = String(u).trim();
    if (SAFE.test(u)) return u;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) return '#';
    return u;
  }

  function localUrl(path) {
    for (var i = 0; i < photos.length; i++) {
      if (photos[i].path === path) return photos[i].url;
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

  // ---------------------------------------------------------------- 写真

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('「' + (file.name || '写真') + '」を読み込めませんでした。JPEGまたはPNGの写真をお試しください。'));
      };
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
          blob ? resolve(blob) : reject(new Error('写真を変換できませんでした。'));
        }, 'image/jpeg', 0.82);
      });
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1]); };
      fr.onerror = function () { reject(new Error('写真を読み込めませんでした。')); };
      fr.readAsDataURL(blob);
    });
  }

  function newImageName() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    var rand = Math.random().toString(36).slice(2, 6);
    return 'blog-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + rand + '.jpg';
  }

  function renderPhotos() {
    var box = $('photo-list');
    $('photo-hint').hidden = photos.length === 0;
    box.innerHTML = photos.map(function (ph, i) {
      var isCover = ph.path === coverPath;
      return '<div class="adm-photo' + (isCover ? ' is-cover' : '') + '">' +
        '<div class="adm-photo-img"><img src="' + esc(ph.url) + '" alt="">' +
        (isCover ? '<span class="adm-badge">アイキャッチ</span>' : '') + '</div>' +
        '<div class="adm-photo-acts">' +
        (isCover ? '' : '<button type="button" data-cover="' + i + '">アイキャッチにする</button>') +
        '<button type="button" data-insert="' + i + '">本文に入れる</button>' +
        '<button type="button" class="danger" data-remove="' + i + '">削除</button>' +
        '</div></div>';
    }).join('');
  }

  function addFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return f && /^image\//.test(f.type || '');
    });
    if (!list.length) return;
    show($('msg'), '写真を準備しています…（' + list.length + '枚）', 'info');

    list.reduce(function (chain, file) {
      return chain.then(function () {
        return shrink(file).then(function (blob) {
          var item = {
            path: IMG_DIR + '/' + newImageName(),
            blob: blob,
            url: URL.createObjectURL(blob),
            uploaded: false
          };
          photos.push(item);
          if (!coverPath) coverPath = item.path;
        });
      });
    }, Promise.resolve()).then(function () {
      renderPhotos();
      updatePreview();
      saveDraft();
      show($('msg'), '写真を' + list.length + '枚追加しました。公開ボタンを押すとアップロードされます。', 'ok');
    }).catch(function (err) {
      renderPhotos();
      updatePreview();
      show($('msg'), esc(err.message), 'err');
    });
  }

  function removePhoto(i) {
    var ph = photos[i];
    if (!ph) return;
    if (ph.path === coverPath) coverPath = '';
    // 本文からも取り除く
    var re = new RegExp('!\\[[^\\]]*\\]\\(' + ph.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)\\n?', 'g');
    $('f-body').value = $('f-body').value.replace(re, '');
    if (!ph.uploaded && ph.url) URL.revokeObjectURL(ph.url);
    photos.splice(i, 1);
    if (!coverPath && photos.length) coverPath = photos[0].path;
    renderPhotos();
    updatePreview();
    saveDraft();
  }

  function uploadPhotos() {
    var pending = photos.filter(function (p) { return !p.uploaded && p.blob; });
    if (!pending.length) return Promise.resolve();
    return pending.reduce(function (chain, item, idx) {
      return chain.then(function () {
        show($('msg'), '写真をアップロードしています…（' + (idx + 1) + '/' + pending.length + '）', 'info');
        return blobToBase64(item.blob).then(function (b64) {
          return api(repoPath(item.path), {
            method: 'PUT',
            body: { message: '写真を追加: ' + item.path, content: b64, branch: BRANCH }
          }).then(function () { item.uploaded = true; });
        });
      });
    }, Promise.resolve());
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

  // 端末の設定によっては日付欄が 09/12/2026 のような表記になるため、
  // 日本語の読み方をそのまま下に出しておく。
  function dateJa(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var week = ['日', '月', '火', '水', '木', '金', '土'];
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日（' + week[d.getDay()] + '）';
  }

  function updatePreview() {
    var f = form();
    $('f-date-ja').textContent = dateJa(f.date);
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
    photos.forEach(function (p) { if (!p.uploaded && p.url) URL.revokeObjectURL(p.url); });
    photos = [];
    $('f-title').value = '';
    $('f-date').value = today();
    $('f-category').value = '';
    $('f-slug').value = '';
    $('f-slug').readOnly = false;
    $('f-body').value = '';
    $('photo-file').value = '';
    $('publish-label').textContent = 'この内容で公開する';
    $('cancel-edit').hidden = true;
    renderPhotos();
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
    if (!f.body.trim() && !photos.length) {
      show(msg, '本文か写真のどちらかを入れてください。', 'err');
      $('f-body').focus();
      return;
    }

    var slug = f.slug || autoSlug(f.date);
    if (!/^[0-9a-z][0-9a-z-]*$/.test(slug)) {
      show(msg, '記事のURL名は半角の小文字英数字とハイフンだけで入力してください。（「詳しい設定」の中にあります）', 'err');
      return;
    }

    var path = editing ? editing.path : POSTS_DIR + '/' + f.date + '-' + slug + '.md';
    var btn = $('publish');
    btn.classList.add('adm-busy');
    show(msg, '公開しています…', 'info');

    uploadPhotos()
      .then(function () {
        if (editing) return null;
        return api(repoPath(path)).then(function () {
          throw new Error('同じURL名の記事がすでにあります。「詳しい設定」の記事のURL名を変えてください。');
        }, function (err) {
          if (err.status === 404) return null;
          throw err;
        });
      })
      .then(function () {
        show(msg, '記事を保存しています…', 'info');
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
          '1〜2分後に <a href="blog/" target="_blank" rel="noopener" style="text-decoration:underline">ブログページ</a> に反映されます。',
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
              '<span>' + esc(p.date) + (p.category ? '　' + esc(p.category) : '') + '</span></div>' +
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
      photos.forEach(function (p) { if (!p.uploaded && p.url) URL.revokeObjectURL(p.url); });
      photos = [];
      editing = { path: post.path, sha: data.sha };
      coverPath = parsed.meta.cover || '';
      if (coverPath) {
        photos.push({ path: coverPath, url: coverPath, uploaded: true });
      }
      $('f-title').value = parsed.meta.title || '';
      $('f-date').value = parsed.meta.date || post.date || today();
      $('f-category').value = parsed.meta.category || '';
      var slugMatch = post.name.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
      $('f-slug').value = slugMatch ? slugMatch[1] : '';
      $('f-slug').readOnly = true;
      $('f-body').value = parsed.body;
      $('photo-file').value = '';
      $('publish-label').textContent = 'この内容で更新する';
      $('cancel-edit').hidden = false;
      renderPhotos();
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
    if (restoreDraft()) show($('msg'), '前回の書きかけの内容を復元しました。', 'info');
    renderPhotos();
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
    if (!value) { show(msg, 'ログインキーを貼り付けてください。', 'err'); return; }
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
      if (!window.confirm('この端末に保存したログインキーを消します。よろしいですか？')) return;
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

    // 写真の追加（ボタン・ドラッグ&ドロップ・貼り付け）
    $('pick-photos').addEventListener('click', function () { $('photo-file').click(); });
    $('photo-file').addEventListener('change', function () {
      addFiles(this.files);
      this.value = '';
    });

    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    document.addEventListener('paste', function (e) {
      if ($('pane-write').hidden || !e.clipboardData) return;
      var files = [];
      Array.prototype.forEach.call(e.clipboardData.items || [], function (item) {
        if (item.kind === 'file' && /^image\//.test(item.type)) {
          var f = item.getAsFile();
          if (f) files.push(f);
        }
      });
      if (files.length) { e.preventDefault(); addFiles(files); }
    });

    $('photo-list').addEventListener('click', function (e) {
      var cover = e.target.closest('[data-cover]');
      var ins = e.target.closest('[data-insert]');
      var rm = e.target.closest('[data-remove]');
      if (cover) {
        coverPath = photos[Number(cover.dataset.cover)].path;
        renderPhotos();
        updatePreview();
      } else if (ins) {
        insert('\n![写真](' + photos[Number(ins.dataset.insert)].path + ')\n', '', '');
        show($('msg'), '本文に写真を入れました。', 'ok');
      } else if (rm) {
        removePhoto(Number(rm.dataset.remove));
      }
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
