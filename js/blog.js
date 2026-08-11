/* ブログ: blog/posts/ 内のMarkdown記事を一覧・表示する */
(function () {
  'use strict';

  var POSTS_DIR = 'blog/posts/';

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(t) {
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return t;
  }

  /* 先頭の「# 見出し」をタイトルとして取り出し、本文をHTML化する */
  function parseMd(md) {
    var lines = md.replace(/\r/g, '').split('\n');
    var title = '';
    var html = '';
    var para = [];
    var list = [];

    function flushPara() {
      if (para.length) { html += '<p>' + inline(para.join('<br>')) + '</p>'; para = []; }
    }
    function flushList() {
      if (list.length) {
        html += '<ul>' + list.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>';
        list = [];
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = esc(lines[i].trim());
      if (!line) { flushPara(); flushList(); continue; }
      var m;
      if ((m = line.match(/^###\s+(.*)/))) { flushPara(); flushList(); html += '<h4>' + inline(m[1]) + '</h4>'; }
      else if ((m = line.match(/^##\s+(.*)/))) { flushPara(); flushList(); html += '<h3>' + inline(m[1]) + '</h3>'; }
      else if ((m = line.match(/^#\s+(.*)/))) {
        flushPara(); flushList();
        if (!title) { title = m[1]; } else { html += '<h3>' + inline(m[1]) + '</h3>'; }
      }
      else if ((m = line.match(/^[-・]\s*(.*)/))) { flushPara(); list.push(m[1]); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
    return { title: title, html: html };
  }

  function dateFromName(name) {
    var m = name.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[1] + '.' + m[2] + '.' + m[3] : '';
  }

  function firstText(md) {
    var lines = md.replace(/\r/g, '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t && t.charAt(0) !== '#' && t.charAt(0) !== '-' && t.charAt(0) !== '!') {
        return t.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      }
    }
    return '';
  }

  function validName(name) {
    return typeof name === 'string' && /\.md$/.test(name) && name.indexOf('/') === -1 && name.indexOf('..') === -1;
  }

  /* 一覧ページ */
  var listEl = document.getElementById('post-list');
  if (listEl) {
    fetch(POSTS_DIR + 'index.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (files) {
        files = files.filter(validName).sort().reverse();
        if (!files.length) {
          listEl.innerHTML = '<p style="font-size:14px;opacity:.7;margin:0">記事はまだありません。</p>';
          return;
        }
        return Promise.all(files.map(function (f) {
          return fetch(POSTS_DIR + encodeURIComponent(f)).then(function (r) {
            return r.ok ? r.text() : '';
          }).then(function (md) { return { file: f, md: md }; });
        })).then(function (posts) {
          listEl.innerHTML = posts.filter(function (p) { return p.md; }).map(function (p) {
            var parsed = parseMd(p.md);
            var excerpt = firstText(p.md);
            if (excerpt.length > 60) excerpt = excerpt.slice(0, 60) + '…';
            return '<a class="card blueprint post-card" href="post.html?p=' + encodeURIComponent(p.file) + '">' +
              '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>' +
              '<div class="post-date">' + dateFromName(p.file) + '</div>' +
              '<h3 style="font-size:21px;margin:8px 0 10px;line-height:1.5">' + esc(parsed.title || p.file) + '</h3>' +
              '<p style="font-size:13.5px;line-height:1.85;margin:0;opacity:.75">' + esc(excerpt) + '</p>' +
              '</a>';
          }).join('');
        });
      })
      .catch(function () {
        listEl.innerHTML = '<p style="font-size:14px;opacity:.7;margin:0">記事を読み込めませんでした。ページを再読み込みしてください。</p>';
      });
  }

  /* 記事ページ */
  var bodyEl = document.getElementById('post-body');
  if (bodyEl) {
    var name = new URLSearchParams(location.search).get('p') || '';
    var titleEl = document.getElementById('post-title');
    var dateEl = document.getElementById('post-date');
    if (!validName(name)) {
      titleEl.textContent = '記事が見つかりません';
      bodyEl.innerHTML = '<p><a href="blog.html">ブログ一覧</a>からお選びください。</p>';
      return;
    }
    fetch(POSTS_DIR + encodeURIComponent(name), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (md) {
        var parsed = parseMd(md);
        titleEl.textContent = parsed.title || name;
        dateEl.textContent = dateFromName(name);
        bodyEl.innerHTML = parsed.html;
        document.title = (parsed.title || 'ブログ記事') + '｜カーゴレックス';
      })
      .catch(function () {
        titleEl.textContent = '記事が見つかりません';
        bodyEl.innerHTML = '<p><a href="blog.html">ブログ一覧</a>からお選びください。</p>';
      });
  }
})();
