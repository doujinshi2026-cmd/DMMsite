# R18ブックス・同人誌レビューガイド

成人向け同人作品のレビュー記事を、まずは手動で増やしていくためのサイト基盤です。

本番の記事データはCloudflare D1に保存します。`content/posts/*.md` は初回移行やローカル確認用のデータで、Git管理には含めません。

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
- 今週のおすすめ枠への掲載、表示順、おすすめコメント、試し読み画像URLの手動編集
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

ジャンルは最大5件まで複数選択できます。ジャンルチップをクリックすると選択に追加され、選択済みジャンルをクリックすると解除されます。複数ジャンルを選ぶと、すべてのジャンルを持つ作品だけに絞り込まれます。

公開WorkerではD1側で絞り込み・件数計算・20件単位のページ取得を行います。検索候補は入力時に `/site/suggestions.json` から遅延取得し、一覧HTMLは5分、候補JSONは1時間エッジキャッシュします。過剰なジャンル指定、長すぎる検索条件、存在しないページ番号は安全なURLへ正規化されます。

記事本文に埋め込んだ画像は、`affiliate_url` があればそれを優先し、未設定の場合は `source_url` へ遷移します。

ジャンルはBlog CMSで1行1タグ、またはスペース・読点「、」・カンマ「,」区切りで入力します。

## 今週のおすすめ枠

Blog CMSで記事の `今週のおすすめ` を有効にすると、通常の `/site` の一番上に「今週のおすすめ」として表示されます。検索やジャンル絞り込み中は、絞り込み結果を優先するためおすすめ枠は出ません。

おすすめ枠では `おすすめコメント` を本文やDMM取得文とは別に手動入力できます。`試し読み画像URL` に複数URLが入っている記事は、横スライド式の画像ビューアで表示されます。

## 保存先

```text
content/posts/          ローカル記事Markdown（Git管理外）
public/uploads/         アップロード画像
tools/blog-admin/       管理画面
scripts/blog-admin.mjs  ローカル管理サーバー
lib/content-store.mjs   記事・画像の保存ロジック
database/d1-schema.sql  Cloudflare D1用の記事テーブル
src/worker.js           Cloudflare Workers用の公開サイト/API/Cron
```

## DMM API取り込み

DMM Webサービスの商品情報API `ItemList` から、FANZA同人の商品データを取得してD1の記事として追加します。
作品情報の取得にHTMLスクレイピングは使用しません。
標準では `service=doujin` / `floor=digital_doujin` を使い、ゲームやCG集を混ぜないよう `media=comic` で同人コミックだけを取り込みます。

本番の作品数を増やす標準ルートはCloudflare WorkerのD1更新です。`content/posts/*.md` を増やしてデプロイする運用ではありません。

```powershell
npm run works:update
```

`works:update` はデプロイ済みWorkerの `/api/dmm/import` をBasic認証付きで呼びます。ローカルの `.env` に次を入れてください。DMMの `DMM_API_ID` とAPI取得用の `DMM_AFFILIATE_ID` はCloudflare Worker Secretにも登録しておきます。サイトに掲載するリンクのIDは `DMM_LINK_AFFILIATE_ID` で分けて指定します。

```text
CLOUDFLARE_WORKER_URL=https://dmmsite.doujinshi2026.workers.dev
BLOG_CMS_USER=admin
BLOG_CMS_PASSWORD=CloudflareにSecret登録したパスワード
DMM_AFFILIATE_ID=商品情報API用登録のID（例: 末尾990）
DMM_LINK_AFFILIATE_ID=承認済みサイト用のID（例: 末尾003）
```

動作確認だけ行い、D1を書き換えない場合は次を使います。

```powershell
npm run works:update:dry
```

取り込み内容:

- API: `https://api.dmm.com/affiliate/v3/ItemList`
- 標準条件: `site=FANZA` / `service=doujin` / `floor=digital_doujin` / `media=comic`
- sort: `rank`、`date`、`review`、`price`、`-price`、`match`
- 取得件数: 1回あたり最大100件。さらに増やす場合は `--offset` を変えて複数回実行
- 重複判定: `content_id`、slug、元ページURL、アフィリエイトURL、作品名
- 状態: `published`
- 種類: `review`
- 公開日: 取り込み実行時刻
- タイトル、slug、作品名: APIの `title`
- サークル名: APIの `iteminfo.maker`
- 作者名: APIの `iteminfo.author`
- ジャンル: APIの `iteminfo.genre`
- 抜粋: APIの商品データから生成した短い基本情報
- サムネイルURL: APIの `imageURL.large` または `imageURL.list`
- 試し読み画像URL: APIの `sampleImageURL`
- 元ページURL、広告URL: APIの `URL` / `affiliateURL`

よく使う取り込み例:

```powershell
npm run works:update:dry -- --sort rank --limit 100
npm run works:update -- --sort rank --limit 100
npm run works:update -- --sort date --limit 100 --offset 1
npm run works:update -- --sort date --limit 100 --offset 101
npm run works:update -- --sort review --limit 100 --offset 1
```

BL/TLのfloorを取得する場合:

```powershell
npm run works:update -- --floor digital_doujin_bl --sort rank --limit 100
npm run works:update -- --floor digital_doujin_tl --sort rank --limit 100
```

## 作品の選定条件

選定条件は `src/work-selection-policy.js` で一元管理します。

- 初期掲載: 過去作品全体を含むDMM API `sort=rank` のコミック上位500作品
- 定期更新: 24時間ごとに更新されるDMM API `sort=rank` のコミック上位100作品
- 常時保持: `どじろーブックス`、`みずのウロ`、`ひやしまくら`
- 注目作品: ItemList APIに識別項目がないため、別条件へ置き換えず未対応として明記

初期同期と指定サークルの補完:

```powershell
npm run works:selection:sync
```

削除前の保持作品・削除候補一覧:

```powershell
npm run works:selection:plan
```

結果は `logs/work-selection-plan.json` に保存されます。削除は確認文字列を明示した場合だけ実行されます。

```powershell
npm run works:selection -- prune --confirm DELETE_UNSELECTED_WORKS
```

## Cloudflare WorkersでAPI自動更新

本番運用では、ローカルPCのタスクスケジューラではなくCloudflare WorkersのCron Triggerで更新します。
この構成では、公開サイト・管理画面・DMM API取り込みを1つのWorkerで動かし、記事データはD1に保存します。

Cloudflare側の構成:

- Worker名: `dmmsite`
- D1 database: `dmmsite-db`
- 公開サイト: `/site`
- 管理画面: `/admin`
- 手動取り込み: `npm run works:update` または `/api/dmm/import`
- Cron: `10 3 * * *`
- 候補件数: `DMM_API_IMPORT_LIMIT=100`
- 対象メディア: `DMM_API_IMPORT_MEDIA=comic`
- 対象floor: `DMM_API_IMPORT_FLOOR=digital_doujin`

CloudflareのCronはUTC基準です。定期更新は人気順上位100作品だけに限定します。

| 日本時間 | UTC Cron | 取得内容 |
| --- | --- | --- |
| 12:10 | `10 3 * * *` | 人気順 `sort=rank` / コミック上位100 |

Cronでも `/api/dmm/import` と同じ商品情報API取り込みを実行します。新着順・レビュー順は定期更新しません。

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

既存のD1データベースへおすすめ枠と試し読み画像の列を追加する場合は、次の移行SQLを1回だけ実行します。

```powershell
npx wrangler d1 execute dmmsite-db --remote --file=database/d1-migration-editorial-fields.sql
```

既存記事の試し読み画像を補完する場合は、管理者認証付きで `/api/dmm/backfill` を呼びます。まずは dry run で確認してください。

```text
https://<your-worker-domain>/api/dmm/backfill?dryRun=1&limit=40
```

DMM/FANZAアフィリエイト承認後に通常の商品URLを公式APIのアフィリエイトリンクへ切り替える手順は次にまとめています。

```text
manual/2026-06-05_dmm-affiliate-link-switch.md
```

ローカルMarkdown記事を確認・更新する場合:

```powershell
npm run dmm:affiliate:dry
npm run dmm:affiliate
```

本番D1の記事を確認・更新する場合:

```powershell
npm run cf:dmm:affiliate:dry
npm run cf:dmm:affiliate
```

既存の `content/posts/*.md` をD1へ移す場合だけ、seed SQLを生成して流し込みます。これは初回移行用で、日々の作品追加はWorkerのCronと `npm run works:update` がD1へ直接書き込みます。

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
http://localhost:8787/api/dmm/import?dryRun=1&sort=rank&limit=20&media=comic
```

問題なければデプロイします。

```powershell
npm run cf:d1:optimize:remote
npm run cf:deploy
```

デプロイ後の確認:

- `https://<your-worker-domain>/site` で公開サイトを確認
- `https://<your-worker-domain>/admin` で管理画面を確認
- `npm run works:update:dry` で新規候補だけを確認
- `npm run works:update` でD1へ手動取り込み
- Cloudflare Dashboard の Workers & Pages > `dmmsite` > Settings > Triggers でCronを確認
- Workers Logsで `dmm-api-import` のログを確認

## 運用方針

- 申請前は自分で書いた独自レビューを増やします。
- 画像は公式に許諾された広告素材、または利用許諾が明確な素材だけを使います。
- 記事上部とCTA付近に `PR` または `広告` の表記を入れます。
- 本番の作品数はD1を正とします。Markdown seedは初回移行とローカル確認だけに使います。

## DMMアフィリエイト申請前チェック

- 本番URLの `/site` がログインなしで表示できる状態にします。
- 公開サイトには `published` の記事だけを表示し、下書き・確認用テンプレート・管理画面・プレビュー画面は公開導線から外します。
- サイト上部と商品リンク周辺に、広告・PR表記、18歳未満閲覧禁止、DMM/FANZA公式ではないことを明示します。
- 運営者名、問い合わせ先、プライバシーポリシーを本番サイト上に用意します。
- 登録したサイトURL以外、メール、PDF、SNSのDMなどへアフィリエイトリンクを流用しません。
- 掲載画像はDMM/FANZAが許諾した広告素材、または利用許諾が明確な素材だけにします。
- 作品コメントや商品説明をそのまま大量転載せず、独自レビューや選定理由を増やします。
- 児童ポルノを連想させる表現、過度な暴力、犯罪助長、差別、誹謗中傷、権利侵害に当たる表現は掲載しません。
- DMM/FANZAが運営・保証・推薦していると誤認させるサイト名や説明文にしません。

## Cloudflare公開

Cloudflare公開時のセキュリティ設定は次にまとめています。

```text
manual/2026-05-23_cloudflare-security-deploy.md
```

Cloudflare Workers版では `/api/*`、`/preview/*`、`/admin`、`/admin.js` をBasic認証で保護します。
デプロイ前に `BLOG_CMS_PASSWORD` をSecretへ設定してください。
!!
