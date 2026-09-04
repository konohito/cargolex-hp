#!/usr/bin/env python3
"""blog/posts/*.md からブログのHTMLを生成する。

- blog/index.html（一覧・ページネーション）
- blog/<スラッグ>.html（記事ページ）
- feed.xml（RSS）
- sitemap.xml（全ページ＋記事）
- index.html の最新記事ブロック

ヘッダー・フッターは person.html から取り出して使うため、
ナビを変更してもブログ側は自動で追従する。
外部ライブラリは使わない（GitHub Actions の python3 だけで動く）。
"""

from __future__ import annotations

import html
import os
import re
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS_DIR = os.path.join(ROOT, "blog", "posts")
OUT_DIR = os.path.join(ROOT, "blog")
BASE_URL = "https://konohito.github.io/cargolex-hp/"
SITE_NAME = "カーゴレックス"
PER_PAGE = 9
DEFAULT_OG = "assets/img/og-image.jpg"
JST = timezone(timedelta(hours=9))

BASE_PAGES = [
    ("", "1.0"),
    ("business.html", "0.8"),
    ("person.html", "0.8"),
    ("price.html", "0.8"),
    ("company.html", "0.6"),
    ("contact.html", "0.8"),
]


# --------------------------------------------------------------------------
# Markdown（必要な記法だけを扱う小さなレンダラ）
# --------------------------------------------------------------------------

SAFE_SCHEMES = ("http://", "https://", "mailto:", "tel:")


def safe_url(url: str) -> str:
    """javascript: など危険なURLを弾く。相対パスはそのまま通す。"""
    u = url.strip()
    if u.startswith(SAFE_SCHEMES) or u.startswith(("#", "/")):
        return u
    if ":" in u.split("/")[0]:  # 未知のスキーム
        return "#"
    return u


def inline(text: str) -> str:
    """行内の記法（画像・リンク・太字・コード）を変換する。入力はエスケープ済み。"""
    text = re.sub(
        r"!\[([^\]]*)\]\(([^)\s]+)\)",
        lambda m: '<img src="%s" alt="%s" loading="lazy">' % (safe_url(m.group(2)), m.group(1)),
        text,
    )
    text = re.sub(
        r"\[([^\]]+)\]\(([^)\s]+)\)",
        lambda m: '<a href="%s">%s</a>' % (safe_url(m.group(2)), m.group(1)),
        text,
    )
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    return text


def render_markdown(md: str) -> str:
    lines = html.escape(md.replace("\r", "")).split("\n")
    out: list[str] = []
    para: list[str] = []
    ul: list[str] = []
    ol: list[str] = []
    quote: list[str] = []

    def flush_para():
        if para:
            out.append("<p>" + inline("<br>".join(para)) + "</p>")
            para.clear()

    def flush_ul():
        if ul:
            out.append("<ul>" + "".join("<li>%s</li>" % inline(x) for x in ul) + "</ul>")
            ul.clear()

    def flush_ol():
        if ol:
            out.append("<ol>" + "".join("<li>%s</li>" % inline(x) for x in ol) + "</ol>")
            ol.clear()

    def flush_quote():
        if quote:
            out.append("<blockquote>" + inline("<br>".join(quote)) + "</blockquote>")
            quote.clear()

    def flush_all():
        flush_para()
        flush_ul()
        flush_ol()
        flush_quote()

    for raw in lines:
        line = raw.strip()
        if not line:
            flush_all()
            continue
        if re.match(r"^(-{3,}|_{3,})$", line):
            flush_all()
            out.append("<hr>")
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            flush_all()
            # 記事タイトル（# ）は別途ページ見出しにするので本文では h3 相当から始める
            level = min(len(m.group(1)) + 2, 5)
            out.append("<h%d>%s</h%d>" % (level, inline(m.group(2)), level))
            continue
        m = re.match(r"^&gt;\s?(.*)$", line)  # 引用（> はエスケープ済み）
        if m:
            flush_para()
            flush_ul()
            flush_ol()
            quote.append(m.group(1))
            continue
        m = re.match(r"^(?:[-*・]|・)\s*(.+)$", line)
        if m:
            flush_para()
            flush_ol()
            flush_quote()
            ul.append(m.group(1))
            continue
        m = re.match(r"^\d+[.)]\s+(.+)$", line)
        if m:
            flush_para()
            flush_ul()
            flush_quote()
            ol.append(m.group(1))
            continue
        flush_ul()
        flush_ol()
        flush_quote()
        para.append(line)

    flush_all()
    return "".join(out)


# --------------------------------------------------------------------------
# 記事の読み込み
# --------------------------------------------------------------------------


class Post:
    def __init__(self, filename: str, text: str):
        self.filename = filename
        meta, body = self._split_front_matter(text)

        stem = re.sub(r"\.md$", "", filename)
        m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[-_]?(.*)$", stem)
        if m:
            file_date = "%s-%s-%s" % (m.group(1), m.group(2), m.group(3))
            slug_src = m.group(4) or stem
        else:
            file_date = ""
            slug_src = stem

        self.date = meta.get("date", "") or file_date or "1970-01-01"
        self.category = meta.get("category", "") or meta.get("カテゴリ", "")
        self.cover = meta.get("cover", "") or meta.get("写真", "")

        heading = ""
        rest_lines = []
        for line in body.replace("\r", "").split("\n"):
            if not heading and line.strip().startswith("# "):
                heading = line.strip()[2:].strip()
                continue
            rest_lines.append(line)
        self.body_md = "\n".join(rest_lines).strip()
        self.title = meta.get("title", "") or meta.get("タイトル", "") or heading or stem

        slug = re.sub(r"[^0-9A-Za-z_-]+", "-", slug_src).strip("-").lower()
        self.slug = slug or ("post-" + re.sub(r"[^0-9]", "", self.date))
        self.url = "blog/%s.html" % self.slug
        self.body_html = render_markdown(self.body_md)
        self.excerpt = meta.get("excerpt", "") or self._first_text()

    @staticmethod
    def _split_front_matter(text: str):
        text = text.replace("\r", "")
        meta: dict[str, str] = {}
        if text.lstrip().startswith("---"):
            stripped = text.lstrip()
            end = stripped.find("\n---", 3)
            if end != -1:
                head = stripped[3:end]
                body = stripped[end + 4:].lstrip("\n")
                for line in head.split("\n"):
                    if ":" in line:
                        k, v = line.split(":", 1)
                        meta[k.strip().lower()] = v.strip()
                return meta, body
        return meta, text

    def _first_text(self) -> str:
        for line in self.body_md.split("\n"):
            t = line.strip()
            if not t or t.startswith(("#", "-", "*", "・", ">", "!", "|")):
                continue
            t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)
            return t.replace("**", "").replace("`", "")
        return ""

    @property
    def date_display(self) -> str:
        return self.date.replace("-", ".")

    @property
    def datetime(self) -> datetime:
        try:
            return datetime.strptime(self.date, "%Y-%m-%d").replace(tzinfo=JST)
        except ValueError:
            return datetime(1970, 1, 1, tzinfo=JST)


def load_posts() -> list[Post]:
    if not os.path.isdir(POSTS_DIR):
        return []
    posts = []
    for name in sorted(os.listdir(POSTS_DIR)):
        if not name.endswith(".md") or name.startswith("_"):
            continue
        with open(os.path.join(POSTS_DIR, name), encoding="utf-8") as f:
            posts.append(Post(name, f.read()))
    posts.sort(key=lambda p: (p.date, p.slug), reverse=True)
    return posts


# --------------------------------------------------------------------------
# 共通パーツ（person.html から取り出す）
# --------------------------------------------------------------------------


def slice_between(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i) + len(end)
    return text[i:j]


ABSOLUTE_PREFIXES = ("http://", "https://", "//", "#", "mailto:", "tel:", "data:", "/")


def to_subdir(html_text: str, prefix: str = "../") -> str:
    """サイト直下向けの相対パスを、blog/ 配下から見たパスに直す。"""

    def repl(m):
        attr, url = m.group(1), m.group(2)
        if url.startswith(ABSOLUTE_PREFIXES) or url == "":
            return m.group(0)
        return '%s="%s%s"' % (attr, prefix, url)

    return re.sub(r'\b(href|src)="([^"]*)"', repl, html_text)


def build_chrome():
    with open(os.path.join(ROOT, "person.html"), encoding="utf-8") as f:
        src = f.read()

    header = slice_between(src, '<header class="site-header">', "</header>")
    footer = slice_between(src, "<footer", "</footer>")
    cta = slice_between(src, '<nav class="mobile-cta"', "</nav>")

    # 「個人のお客様」の現在地表示を外し、「ブログ」を現在地にする
    header = header.replace(
        '<a class="on" href="person.html" aria-current="page">個人のお客様</a>',
        '<a href="person.html">個人のお客様</a>',
    )
    header = header.replace(
        '<a class="drawer-link on" href="person.html">個人のお客様</a>',
        '<a class="drawer-link" href="person.html">個人のお客様</a>',
    )
    header = header.replace(
        '<a href="blog/">ブログ</a>',
        '<a class="on" href="blog/" aria-current="page">ブログ</a>',
    )
    header = header.replace(
        '<a class="drawer-link" href="blog/">ブログ</a>',
        '<a class="drawer-link on" href="blog/">ブログ</a>',
    )
    return to_subdir(header), to_subdir(footer), to_subdir(cta)


HEAD_TMPL = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="{og_type}">
<meta property="og:site_name" content="カーゴレックス">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{og_image}">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#123f28">
<link rel="icon" type="image/png" href="../assets/img/favicon-32.png">
<link rel="apple-touch-icon" href="../assets/img/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="カーゴレックス ブログ" href="../feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&amp;family=Barlow:wght@400;500;700&amp;family=Noto+Sans+JP:wght@400;500;700;900&amp;display=swap">
<link rel="stylesheet" href="../css/site.css">
{extra_head}</head>
<body>
<a class="skip-link" href="#main">本文へスキップ</a>

"""

TAIL = '\n<script src="../js/site.js" defer></script>\n</body>\n</html>\n'


def esc_attr(s: str) -> str:
    return html.escape(s or "", quote=True)


def clip(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[:n] + "…"


def cover_url(post: Post, prefix: str) -> str:
    return prefix + post.cover if post.cover else ""


def card_html(post: Post, prefix: str) -> str:
    cover = cover_url(post, prefix)
    media = (
        '<div class="blog-card-media"><img src="%s" alt="" width="800" height="500" loading="lazy"></div>'
        % esc_attr(cover)
        if cover
        else '<div class="blog-card-media blog-card-media-empty"><img src="%sassets/img/mascot.png" alt="" width="437" height="460" loading="lazy"></div>'
        % prefix
    )
    cat = (
        '<span class="blog-cat">%s</span>' % html.escape(post.category)
        if post.category
        else ""
    )
    return (
        '<a class="blog-card" href="%s%s">%s'
        '<div class="blog-card-body">'
        '<div class="blog-meta"><span class="blog-date">%s</span>%s</div>'
        '<h3>%s</h3><p>%s</p>'
        '<span class="blog-more">続きを読む →</span>'
        "</div></a>"
    ) % (
        prefix,
        esc_attr(post.url),
        media,
        post.date_display,
        cat,
        html.escape(post.title),
        html.escape(clip(post.excerpt, 68)),
    )


# --------------------------------------------------------------------------
# 生成
# --------------------------------------------------------------------------


def write(path: str, content: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def build_list_pages(posts: list[Post], header: str, footer: str, cta: str):
    pages = [posts[i:i + PER_PAGE] for i in range(0, len(posts), PER_PAGE)] or [[]]
    total = len(pages)

    for idx, chunk in enumerate(pages, start=1):
        filename = "index.html" if idx == 1 else "page%d.html" % idx
        canonical = BASE_URL + "blog/" + ("" if idx == 1 else filename)
        title = "ブログ｜カーゴレックス（熊本の軽貨物運送・生活支援）"
        if idx > 1:
            title = "ブログ（%d/%d）｜カーゴレックス" % (idx, total)

        cards = "".join(card_html(p, "../") for p in chunk)
        if not chunk:
            cards = '<p style="font-size:14px;opacity:.7;margin:0">記事はまだありません。</p>'

        pager = ""
        if total > 1:
            links = []
            for n in range(1, total + 1):
                href = "index.html" if n == 1 else "page%d.html" % n
                if n == idx:
                    links.append('<span class="blog-page on">%d</span>' % n)
                else:
                    links.append('<a class="blog-page" href="%s">%d</a>' % (href, n))
            pager = '<nav class="blog-pager" aria-label="ページ送り">%s</nav>' % "".join(links)

        body = """
<main id="main" style="overflow-x:hidden">

<section class="wrap" style="padding-top:34px">
  <div style="font-size:12px;color:color-mix(in srgb,var(--color-text) 52%%,transparent);margin-bottom:30px"><a href="../index.html">トップ</a> ／ ブログ</div>
  <span class="kick" style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--color-accent-700);font-weight:600">Blog</span>
  <h1 style="font-size:clamp(28px,4.4vw,46px);line-height:1.24;margin:14px 0 16px">ブログ</h1>
  <p style="font-size:15px;line-height:1.9;color:color-mix(in srgb,var(--color-text) 68%%,transparent);margin:0">お庭の草刈・剪定やお引越しなど、日々の作業の様子や暮らしに役立つ情報をお届けします。</p>
</section>

<section class="wrap" style="padding-top:36px;padding-bottom:20px">
  <div class="blog-grid">%s</div>
  %s
</section>

</main>

""" % (cards, pager)

        head = HEAD_TMPL.format(
            title=esc_attr(title),
            desc=esc_attr("カーゴレックスのブログ。お庭の草刈・剪定、お引越し、エアコン工事など、熊本での日々の作業の様子や暮らしに役立つ情報をお届けします。"),
            canonical=esc_attr(canonical),
            og_type="website",
            og_title=esc_attr("ブログ｜カーゴレックス"),
            og_image=esc_attr(BASE_URL + DEFAULT_OG),
            extra_head="",
        )
        write(os.path.join(OUT_DIR, filename), head + header + body + footer + "\n" + cta + TAIL)

    return total


def build_post_pages(posts: list[Post], header: str, footer: str, cta: str):
    for i, post in enumerate(posts):
        canonical = BASE_URL + post.url
        og_image = BASE_URL + (post.cover if post.cover else DEFAULT_OG)
        desc = clip(post.excerpt, 110) or "カーゴレックスのブログ記事です。"

        cover = ""
        if post.cover:
            cover = (
                '<figure class="blueprint duo" style="padding:0;margin:26px 0 0">'
                '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>'
                '<img src="../%s" alt="%s" width="1200" height="750" style="width:100%%;height:auto;display:block">'
                "</figure>"
            ) % (esc_attr(post.cover), esc_attr(post.title))

        cat = (
            '<span class="blog-cat">%s</span>' % html.escape(post.category)
            if post.category
            else ""
        )

        newer = posts[i - 1] if i > 0 else None
        older = posts[i + 1] if i + 1 < len(posts) else None
        nav_items = []
        if newer:
            nav_items.append(
                '<a class="blog-navlink" href="../%s"><span>← 新しい記事</span><strong>%s</strong></a>'
                % (esc_attr(newer.url), html.escape(clip(newer.title, 30)))
            )
        if older:
            nav_items.append(
                '<a class="blog-navlink blog-navlink-next" href="../%s"><span>古い記事 →</span><strong>%s</strong></a>'
                % (esc_attr(older.url), html.escape(clip(older.title, 30)))
            )
        post_nav = (
            '<nav class="blog-postnav" aria-label="記事の移動">%s</nav>' % "".join(nav_items)
            if nav_items
            else ""
        )

        jsonld = """<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": {headline},
  "datePublished": "{date}",
  "image": "{image}",
  "mainEntityOfPage": "{canonical}",
  "author": {{"@type": "Organization", "name": "カーゴレックス"}},
  "publisher": {{"@type": "Organization", "name": "カーゴレックス", "logo": {{"@type": "ImageObject", "url": "{logo}"}}}}
}}
</script>
""".format(
            headline=_json_str(post.title),
            date=post.date,
            image=esc_attr(og_image),
            canonical=esc_attr(canonical),
            logo=BASE_URL + "assets/img/icon-192.png",
        )

        body = """
<main id="main" style="overflow-x:hidden">

<article class="wrap blog-article" style="padding-top:34px">
  <div style="font-size:12px;color:color-mix(in srgb,var(--color-text) 52%%,transparent);margin-bottom:26px"><a href="../index.html">トップ</a> ／ <a href="index.html">ブログ</a> ／ 記事</div>
  <div class="blog-meta"><span class="blog-date">%s</span>%s</div>
  <h1>%s</h1>
  %s
  <div class="blog-body">%s</div>
  %s
  <div class="blog-cta blueprint">
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
    <p>お庭のお手入れ・お引越し・エアコン工事など、暮らしの「困った」はカーゴレックスへ。お見積り・ご相談は無料です。</p>
    <div class="blog-cta-actions">
      <a class="btn btn-primary blueprint" href="tel:0120542587" style="padding:14px 24px;font-size:15px">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        0120-542-587（無料）
      </a>
      <a class="btn btn-secondary" href="../contact.html" style="padding:14px 24px;font-size:15px;border-radius:0">メールで相談する</a>
    </div>
  </div>
  <a href="index.html" style="display:inline-block;margin-top:34px;font-size:14px;font-weight:700;color:var(--color-accent-700)">← ブログ一覧へ戻る</a>
</article>

</main>

""" % (post.date_display, cat, html.escape(post.title), cover, post.body_html, post_nav)

        head = HEAD_TMPL.format(
            title=esc_attr("%s｜%s ブログ" % (post.title, SITE_NAME)),
            desc=esc_attr(desc),
            canonical=esc_attr(canonical),
            og_type="article",
            og_title=esc_attr(post.title),
            og_image=esc_attr(og_image),
            extra_head=jsonld,
        )
        write(os.path.join(OUT_DIR, "%s.html" % post.slug), head + header + body + footer + "\n" + cta + TAIL)


def _json_str(s: str) -> str:
    import json

    return json.dumps(s, ensure_ascii=False)


def build_feed(posts: list[Post]):
    items = []
    for p in posts[:20]:
        pub = p.datetime.strftime("%a, %d %b %Y 00:00:00 +0900")
        items.append(
            "    <item>\n"
            "      <title>%s</title>\n"
            "      <link>%s</link>\n"
            "      <guid>%s</guid>\n"
            "      <pubDate>%s</pubDate>\n"
            "      <description>%s</description>\n"
            "    </item>"
            % (
                html.escape(p.title),
                html.escape(BASE_URL + p.url),
                html.escape(BASE_URL + p.url),
                pub,
                html.escape(clip(p.excerpt, 140)),
            )
        )
    now = datetime.now(JST).strftime("%a, %d %b %Y %H:%M:%S +0900")
    feed = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0">\n'
        "  <channel>\n"
        "    <title>カーゴレックス ブログ</title>\n"
        "    <link>%sblog/</link>\n"
        "    <description>熊本の軽貨物運送支援・生活支援サービス カーゴレックスのブログ</description>\n"
        "    <language>ja</language>\n"
        "    <lastBuildDate>%s</lastBuildDate>\n"
        "%s\n"
        "  </channel>\n"
        "</rss>\n" % (BASE_URL, now, "\n".join(items))
    )
    write(os.path.join(ROOT, "feed.xml"), feed)


def build_sitemap(posts: list[Post], list_pages: int):
    urls = ['  <url><loc>%s%s</loc><priority>%s</priority></url>' % (BASE_URL, path, pr)
            for path, pr in BASE_PAGES]
    urls.append('  <url><loc>%sblog/</loc><priority>0.7</priority></url>' % BASE_URL)
    for n in range(2, list_pages + 1):
        urls.append('  <url><loc>%sblog/page%d.html</loc><priority>0.4</priority></url>' % (BASE_URL, n))
    for p in posts:
        urls.append(
            '  <url><loc>%s%s</loc><lastmod>%s</lastmod><priority>0.6</priority></url>'
            % (BASE_URL, p.url, p.date)
        )
    write(
        os.path.join(ROOT, "sitemap.xml"),
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n",
    )


LATEST_START = "<!-- BLOG_LATEST:START -->"
LATEST_END = "<!-- BLOG_LATEST:END -->"


def build_index_latest(posts: list[Post]):
    path = os.path.join(ROOT, "index.html")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    if LATEST_START not in src or LATEST_END not in src:
        return

    if posts:
        rows = []
        for p in posts[:3]:
            thumb = (
                '<img src="%s" alt="" width="200" height="140" loading="lazy">' % esc_attr(p.cover)
                if p.cover
                else '<img src="assets/img/mascot.png" alt="" width="437" height="460" loading="lazy">'
            )
            cat = '<span class="blog-cat">%s</span>' % html.escape(p.category) if p.category else ""
            rows.append(
                '<a class="blog-mini" href="%s"><span class="blog-mini-thumb">%s</span>'
                '<span class="blog-mini-body"><span class="blog-meta"><span class="blog-date">%s</span>%s</span>'
                "<strong>%s</strong></span></a>"
                % (esc_attr(p.url), thumb, p.date_display, cat, html.escape(p.title))
            )
        block = "".join(rows)
    else:
        block = '<p style="font-size:14px;opacity:.7;margin:0">記事はまだありません。</p>'

    start = src.index(LATEST_START) + len(LATEST_START)
    end = src.index(LATEST_END)
    write(path, src[:start] + block + src[end:])


def main():
    posts = load_posts()
    header, footer, cta = build_chrome()
    pages = build_list_pages(posts, header, footer, cta)
    build_post_pages(posts, header, footer, cta)
    build_feed(posts)
    build_sitemap(posts, pages)
    build_index_latest(posts)
    print("ブログを生成しました: 記事 %d件 / 一覧 %dページ" % (len(posts), pages))


if __name__ == "__main__":
    main()
