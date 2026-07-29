# カーゴレックス 公式サイト（CARGOLEX）

熊本の軽貨物運送支援事業・生活支援サービス事業「カーゴレックス」のホームページです。

公開URL: https://konohito.github.io/cargolex-hp/

## 構成

依存ライブラリ・ビルド工程なしの静的サイトです。

| ファイル | 内容 |
| --- | --- |
| `index.html` | トップページ |
| `business.html` | 法人のお客様（チャーター便・スポット便・定期便・ハンドキャリー） |
| `person.html` | 個人のお客様（引越し・不用品処分・暮らしのサービス） |
| `price.html` | 料金表 |
| `company.html` | 会社概要 |
| `contact.html` | お問い合わせ（フォーム＋FAQ） |
| `css/site.css` | 共通スタイル（トークン・コンポーネント・ヘッダー/フッター・レスポンシブ） |
| `js/site.js` | モバイルナビ・ヘッダー影・お問い合わせフォーム |
| `assets/img/` | 最適化済み画像（WebP）・アイコン・OGP画像 |

## 公開（デプロイ）

`main` ブランチへ push すると、GitHub Actions（`.github/workflows/deploy.yml`）が
GitHub Pages へ自動デプロイします。

## お問い合わせフォームの送信先設定

現在フォームは送信先未設定のため、送信時に電話への案内を表示します。
実際にメールを受け取るには：

1. [Formspree](https://formspree.io/)（無料枠あり）等でフォームを作成し、受信用メールアドレスを登録
2. `js/site.js` の `FORM_ENDPOINT` に発行されたエンドポイントURL（例: `https://formspree.io/f/xxxxxxxx`）を設定

これだけで送信・完了メッセージ・エラー処理まで動作します。

## 独自ドメインを使う場合

リポジトリの Settings → Pages → Custom domain で設定後、
各HTMLの `canonical` / OGP の URL と `sitemap.xml`・`robots.txt` のURLを差し替えてください。
