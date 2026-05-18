# 2026-05-18 作業記録 Step 03

## 作業日時

2026-05-18 JST

## 今回の目的

ユーザー指定により、SEOを意識したサイト名、初期レビュー対象3件、問い合わせ先、画像利用方針、GitHub公開準備を整理した。

## 決定したサイト名

```text
R18ブックス・同人誌レビューガイド
```

理由:

- `R18ブックス`
- `同人誌`
- `レビュー`

を自然に含み、検索流入を狙いやすい。

`DMM`、`FANZA`、`公式`、`公認` はサイト名に入れず、公式運営と誤認されるリスクを避ける。

## 初期レビュー対象

アダルト漫画:

```text
https://book.dmm.co.jp/product/6240685/b915awnmg03968/
```

同人誌:

```text
https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_254912/?dmmref=ListRanking&i3_ref=search&i3_ord=4
https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_491335/?dmmref=ListRanking&i3_ref=list&i3_ord=2
```

## 画像利用方針

公式ヘルプを確認し、表紙や商品画像は一般的な引用として自由に保存・転載する扱いにはしない方針にした。

運用方針:

- 申請前はテキスト中心。
- 画像を使う場合はDMM/FANZAの広告素材、商品リンク作成ツール、使用可能な商品メイン画像に限定する。
- 加工は拡大・縮小のみ。
- トリミング、文字入れ、合成、過度な加工はしない。

参照:

- https://support.dmm.co.jp/affiliate/article/48064
- https://support.dmm.co.jp/affiliate/article/48066
- https://support.dmm.com/affiliate/article/44081

## 問い合わせ先

```text
doujinshi2026@gmail.com
```

## GitHub公開先

```text
https://github.com/doujinshi2026-cmd/DMMsite.git
```

## 追加・更新したファイル

- `doc/05_site_policy_for_dmm_affiliate.md`
- `doc/06_initial_site_strategy.md`
- `manual/2026-05-18_affiliate-approval-checklist.md`
- `manual/2026-05-18_github-publish.md`
- `history/2026-05-18_step-03_site-name-review-links-github-prep.md`

## GitHub公開の状況

ローカルGitリポジトリを作成し、初回コミットを作成した。

初回コミット:

```text
eb9f40e Initial DMM affiliate site foundation
```

GitHub CLI `gh` が未インストールのため、GitHub認証状態は確認できなかった。

直接pushを試したが、GitHub側から以下が返ったため未完了。

```text
remote: Repository not found.
fatal: repository 'https://github.com/doujinshi2026-cmd/DMMsite.git/' not found
```

想定される原因:

- GitHubリポジトリがまだ作成されていない。
- リポジトリURLが異なる。
- プライベートリポジトリで、現在のGit認証情報にアクセス権がない。

次に必要な作業:

```powershell
winget install --id GitHub.cli
gh auth login
gh auth status
```

リポジトリが未作成の場合は、GitHub上で `doujinshi2026-cmd/DMMsite` を作成してから再度pushする。
