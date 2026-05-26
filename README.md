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

ローカルCMSを共有PC、Cloudflare Tunnel、外部公開サーバーで開く場合は、必ず `BLOG_CMS_USER` と `BLOG_CMS_PASSWORD` を設定してください。
Cloudflare Workers版では `/admin` をBasic認証付きで公開できます。

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
database/d1-schema.sql  Cloudflare D1用の記事テーブル
src/worker.js           Cloudflare Workers用の公開サイト/API/Cron
```

## DMMランキングから自動作成

24時間人気ランキングの上位100件を候補として確認し、未投稿の作品はレビュー記事として追加し、既存記事の抜粋が空なら作品コメントで補完できます。
制限対策として、作品詳細ページの取得は1回あたり最大50件に抑え、詳細ページ同士のリクエスト間に750msの待機を入れています。

```powershell
npm run dmm:import
```

動作確認だけ行い、記事ファイルを作らない場合は次を使います。

```powershell
npm run dmm:import:dry
```

取り込み内容:

- 対象URL: `https://www.dmm.co.jp/dc/doujin/-/ranking-all/=/submedia=comic/sort=sales/term=h24/`
- 対象順位: 上位100件を候補として確認
- 詳細取得: 未取得・情報不足の作品を1回あたり最大50件
- 待機時間: 作品詳細ページの取得ごとに750ms
- 重複判定: `cid=d_...`、slug、元ページURL、作品名
- 状態: `published`
- 種類: `review`
- 公開日: 取り込み実行時刻
- タイトル、slug、作品名: ランキングの `.rank-name`
- サークル名: ランキングの `.rank-circle`
- ジャンル: 作品ページの `.c_icon_detailGenreTag`
- 抜粋: 作品ページの「作品コメント」内の `.summary__txt`
- サムネイルURL: 作品ページ内の `doujin-assets.dmm.co.jp` のPR画像
- 元ページURL、広告URL: 作品ページへ遷移した後のURL
- 作者名、本文: 空欄

現在の取得方法は、DMM/FANZAのHTMLページを `fetch` で取得し、ランキング名・サークル名・作品コメント・ジャンル・サムネイルURLなどをHTMLから読み取る方式です。
これは公式APIではなく、技術的にはWebスクレイピングに分類されます。画像ファイル自体は保存せず、商品ページ内の画像URLを記事データに保存しています。

Windowsで毎日00:00と12:00に実行する場合は、タスクスケジューラへ登録します。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-dmm-ranking-task.ps1
```

ログは `logs/dmm-ranking-import.log` に追記されます。時刻を変える場合は次のように指定します。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-dmm-ranking-task.ps1 -At 12:00
```

一度に確認する候補数や詳細取得数を変える場合は、次のように指定できます。

```powershell
npm run dmm:import -- --limit 100 --detail-limit 50 --delay-ms 750
```

## Cloudflare Workersで00:00 / 12:00自動更新

本番運用では、ローカルPCのタスクスケジューラではなくCloudflare WorkersのCron Triggerで更新します。
この構成では、公開サイト・管理画面・DMMランキング取り込みを1つのWorkerで動かし、記事データはD1に保存します。

Cloudflare側の構成:

- Worker名: `dmmsite`
- D1 database: `dmmsite-db`
- 公開サイト: `/site`
- 管理画面: `/admin`
- 手動取り込み: `/api/dmm/import?dryRun=1`
- Cron: `0 15 * * *`, `0 3 * * *`
- 候補件数: `DMM_RANKING_LIMIT=100`
- 1回あたりの詳細取得上限: `DMM_RANKING_DETAIL_LIMIT=50`
- 詳細取得の待機時間: `DMM_RANKING_REQUEST_DELAY_MS=750`

CloudflareのCronはUTC基準です。日本時間00:00は前日のUTC 15:00、日本時間12:00はUTC 03:00なので、`wrangler.jsonc` では `0 15 * * *` と `0 3 * * *` を設定しています。
ランキングページは上位100件を候補として読みますが、各回で作品詳細ページを取得するのは未取得・情報不足の作品だけです。上限に達した分は次回以降へ回します。

初回セットアップ:

```powershell
npm install -D wrangler@latest
npx wrangler login
npm run cf:d1:create
```

`cf:d1:create` の出力に表示される `database_id` を `wrangler.jsonc` の `00000000-0000-0000-0000-000000000000` と置き換えます。
この置き換えが終わるまで、`cf:d1:init:remote` と `cf:deploy` は実行しないでください。

設定が置き換わったか確認します。

```powershell
npm run cf:config
```

管理画面を外部公開するため、必ずパスワードをSecretに入れます。

```powershell
npx wrangler secret put BLOG_CMS_PASSWORD
```

D1のテーブルを作成します。

```powershell
npm run cf:d1:init:remote
```

既存の `content/posts/*.md` をD1へ移す場合は、seed SQLを生成して流し込みます。

```powershell
npm run cf:d1:seed
npx wrangler d1 execute dmmsite-db --remote --file=database/d1-seed.sql
```

ローカルでWorkerを確認する場合:

```powershell
npm run cf:d1:init:local
npm run cf:d1:seed:local
npm run cf:dev
```

Cron処理はローカルでも手動で呼び出せます。

```powershell
curl "http://localhost:8787/__scheduled"
```

DMM取り込みだけを管理者認証付きで確認する場合は、ブラウザで `/admin` にログインしたあと、次のURLを開きます。

```text
http://localhost:8787/api/dmm/import?dryRun=1
```

取得件数を抑えて確認する場合:

```text
http://localhost:8787/api/dmm/import?dryRun=1&limit=100&detailLimit=10&delayMs=750
```

問題なければデプロイします。

```powershell
npm run cf:deploy
```

デプロイ後の確認:

- `https://<your-worker-domain>/site` で公開サイトを確認
- `https://<your-worker-domain>/admin` で管理画面を確認
- `/api/dmm/import?dryRun=1` で新規候補だけを確認
- `/api/dmm/import` で手動取り込み
- Cloudflare Dashboard の Workers & Pages > `dmmsite` > Settings > Triggers でCronを確認
- Workers Logsで `dmm-ranking-import` のログを確認

## 運用方針

- 申請前は自分で書いた独自レビューを増やします。
- 画像は公式に許諾された広告素材、または利用許諾が明確な素材だけを使います。
- 記事上部とCTA付近に `PR` または `広告` の表記を入れます。
- ローカル作業ではMarkdown、Cloudflare本番ではD1を記事データの保存先にします。

## Cloudflare公開

Cloudflare公開時のセキュリティ設定は次にまとめています。

```text
manual/2026-05-23_cloudflare-security-deploy.md
```

Cloudflare Workers版では `/api/*`、`/preview/*`、`/admin`、`/admin.js` をBasic認証で保護します。
デプロイ前に `BLOG_CMS_PASSWORD` をSecretへ設定してください。
