# カーゴレックス 公式サイト（CARGOLEX）

熊本の軽貨物運送支援事業・生活支援サービス事業「カーゴレックス」のホームページです。

公開URL: https://konohito.github.io/cargolex-hp/

## 構成

依存ライブラリなしの静的サイトです。ブログのみ、公開時にPythonで生成します。

| ファイル | 内容 |
| --- | --- |
| `index.html` | トップページ |
| `business.html` | 法人のお客様（チャーター便・スポット便・定期便・ハンドキャリー） |
| `person.html` | 個人のお客様（引越し・お庭の草刈・剪定・くらしの便利サービス） |
| `price.html` | 料金表 |
| `company.html` | 会社概要 |
| `contact.html` | お問い合わせ（フォーム＋FAQ） |
| `blog/posts/*.md` | ブログ記事の原稿 |
| `admin.html` / `js/admin.js` | ブログ投稿画面（GitHub Contents API 経由で記事を作成・更新・削除） |
| `tools/build_blog.py` | ブログ生成スクリプト |
| `css/site.css` | 共通スタイル（トークン・コンポーネント・ヘッダー/フッター・レスポンシブ） |
| `js/site.js` | モバイルナビ・ヘッダー影・お問い合わせフォーム |
| `assets/img/` | 最適化済み画像（WebP）・アイコン・OGP画像 |

## ブログ

記事は投稿画面（`admin.html`）から書けます。書き方は [BLOG_HOWTO.md](BLOG_HOWTO.md) を参照してください。

投稿画面は fine-grained personal access token（Contents: Read and write）を
ブラウザの localStorage に保存し、GitHub の Contents API を直接呼びます。
サーバーは不要で、`noindex` のため検索結果には出ません。

`blog/posts/*.md` から、公開時に `tools/build_blog.py` が次を生成します
（生成物はリポジトリに含めず、`.gitignore` で除外しています）。

- `blog/index.html`（一覧・9件ごとのページ送り）
- `blog/<スラッグ>.html`（記事ページ／OGP・JSON-LD・前後記事ナビつき）
- `feed.xml`（RSS）、`sitemap.xml`、トップページの最新記事3件

ヘッダー・フッターは `person.html` から取り出して使うため、ナビを変更すると
ブログ側にも自動で反映されます。ローカルで確認する場合は `python3 tools/build_blog.py` を実行します。

サイトのURL（canonical・OGP・sitemap・RSS）は、リポジトリ直下に `CNAME` があれば
その独自ドメインを、なければ GitHub Pages のURLを使います。独自ドメインへ移す際は
`CNAME` を置くだけで全ページのURLが切り替わります。

## 公開（デプロイ）

`main` ブランチへ push すると、GitHub Actions（`.github/workflows/deploy.yml`）が
ブログを生成したうえで GitHub Pages へ自動デプロイします。

## お問い合わせフォームの送信先設定

現在フォームは送信先未設定のため、送信時に電話への案内を表示します。
実際にメールを受け取るには：

1. [Formspree](https://formspree.io/)（無料枠あり）等でフォームを作成し、受信用メールアドレスを登録
2. `js/site.js` の `FORM_ENDPOINT` に発行されたエンドポイントURL（例: `https://formspree.io/f/xxxxxxxx`）を設定

これだけで送信・完了メッセージ・エラー処理まで動作します。

## 独自ドメインを使う場合

リポジトリの Settings → Pages → Custom domain で設定後、
各HTMLの `canonical` / OGP の URL と `sitemap.xml`・`robots.txt` のURLを差し替えてください。
