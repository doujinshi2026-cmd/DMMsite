# GitHub公開手順

## 目的

このプロジェクトを以下のGitHubリポジトリへアップロードする。

```text
https://github.com/doujinshi2026-cmd/DMMsite.git
```

## 現在の状況

この環境ではGitHub CLI `gh` が見つからないため、Codex側で認証状態を確認できない。

Git本体は利用可能。

ローカルGitリポジトリと初回コミットは作成済み。

```text
eb9f40e Initial DMM affiliate site foundation
```

直接pushを試したところ、GitHub側から `Repository not found` が返った。

考えられる原因:

- GitHub上にリポジトリがまだ作成されていない。
- リポジトリURLが違う。
- プライベートリポジトリで、現在の認証情報にアクセス権がない。

## ユーザー側で必要な準備

GitHub CLIをインストールする。

```powershell
winget install --id GitHub.cli
```

インストール後、GitHubにログインする。

```powershell
gh auth login
gh auth status
```

リポジトリが未作成の場合、GitHub上で次の名前のリポジトリを作成する。

```text
doujinshi2026-cmd/DMMsite
```

その後、Codexに再度pushを依頼する。

## 注意

- GitHubに公開する前に `.env` は作らない、または作ってもGit管理対象にしない。
- APIキー、アクセストークン、メールログイン情報はコミットしない。
- ローカルDBファイル `database/*.sqlite3` はコミットしない。
