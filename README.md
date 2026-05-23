# R18ブックス・同人誌レビューガイド

成人向け同人作品のレビュー記事を、まずは手動で増やしていくためのサイト基盤です。

現在の主導線は、自動投稿ではなくブログ記事の作成です。記事は `content/posts/*.md` に保存し、画像は `public/uploads/` に保存します。この形式にしておくことで、後からDMM API取得、AI下書き生成、SNS投稿botなどを同じ記事データへ接続できます。

## 記事を書く

Node.jsが使える環境で管理画面を起動します。

```powershell
npm run blog:admin
```

表示されたURLをブラウザで開きます。標準では次のURLです。

```text
http://127.0.0.1:4173/
```

パスワードを設定する場合は、`.env.example` を `.env` にコピーして次の値を変更します。`.env` はGit管理外です。

```powershell
Copy-Item .env.example .env
```

```dotenv
BLOG_CMS_USER=admin
BLOG_CMS_PASSWORD=長いランダムなパスワード
```

PowerShellでその時だけ設定する場合は、次のように起動します。

```powershell
$env:BLOG_CMS_USER="admin"
$env:BLOG_CMS_PASSWORD="長いランダムなパスワード"
npm run blog:admin
```

`127.0.0.1:4173` がすでに使用中の場合は、既存の管理画面を開くか、別ポートで起動します。

```powershell
npm run blog:admin -- --port 4174
```

管理画面でできること:

- 記事の新規作成、編集、保存
- 下書き、公開準備、公開、保管の状態管理
- タイトル、slug、抜粋、サークル、作者、ジャンル、感情タグ、PR表記、権利確認状態の入力
- Markdown本文の編集とプレビュー
- 画像アップロードとMarkdownへの埋め込み
- 本文内画像クリック時の商品ページ遷移
- ジャンルタグの個別リンク化とジャンル別絞り込み
- 記事量、PR表記、広告リンク、画像権利の簡易チェック
- `/site` でブログ表示の確認

CMSはローカル作業用です。Cloudflareへ公開する対象には含めません。
共有PC、Cloudflare Tunnel、外部公開サーバーでCMSを開く場合は、必ず `BLOG_CMS_USER` と `BLOG_CMS_PASSWORD` を設定してください。

## 作品一覧の検索

`/site` ではサークル名・作者名・キーワードで絞り込めます。

```text
http://127.0.0.1:4173/site?circle=どじろーブックス
http://127.0.0.1:4173/site?author=どじろー
http://127.0.0.1:4173/site?genre=制服
http://127.0.0.1:4173/site?genre=制服&genre=巨乳
http://127.0.0.1:4173/site?circle=どじろーブックス&author=どじろー
```

ジャンルは複数選択できます。ジャンルチップをクリックすると選択に追加され、選択済みジャンルをクリックすると解除されます。複数ジャンルを選ぶと、すべてのジャンルを持つ作品だけに絞り込まれます。

記事本文に埋め込んだ画像は、`affiliate_url` があればそれを優先し、未設定の場合は `source_url` へ遷移します。

ジャンルはBlog CMSで1行1タグ、またはスペース・読点「、」・カンマ「,」区切りで入力します。

## 保存先

```text
content/posts/          記事Markdown
public/uploads/         アップロード画像
tools/blog-admin/       管理画面
scripts/blog-admin.mjs  ローカル管理サーバー
lib/content-store.mjs   記事・画像の保存ロジック
```

## 運用方針

- 申請前は自分で書いた独自レビューを増やします。
- 画像は公式に許諾された広告素材、または利用許諾が明確な素材だけを使います。
- 記事上部とCTA付近に `PR` または `広告` の表記を入れます。
- 将来の自動化は、記事Markdownを生成・更新する方向で接続します。

## Cloudflare公開

Cloudflare公開時のセキュリティ設定は次にまとめています。

```text
manual/2026-05-23_cloudflare-security-deploy.md
```

公開前に `/api/*`、`/preview/*`、`/admin.js`、`/tools/*`、`/scripts/*`、`/content/*`、`/database/*` が外部から見えないことを確認してください。
