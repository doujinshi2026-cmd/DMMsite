# BOT基盤

DMM/FANZAアフィリエイト審査前でも使える、ローカルSQLite中心の最小BOT基盤です。

## 現在の範囲

- 作品候補の手動登録
- 成人向けコンテンツ限定のDB制約
- 感情分析メモの保存
- X向け3分割スレッド下書きの保存
- 投稿済み判定と重複防止

## まだ実装しない範囲

- DMM Affiliate API取得
- X API投稿
- 画像ダウンロード
- 自動スケジューリング

## 想定コマンド

Pythonが使える環境で実行します。

```powershell
python -m bot.database init
python -m bot.database add-work manual-001 "サンプル作品タイトル" --review-status draft
python -m bot.database list-pending
python -m bot.database mark-posted manual-001 --thread-id "example-thread-id"
python -m bot.database has-posted manual-001
```

## 注意

- APIキーやアクセストークンはDBやMarkdownに保存しません。
- アダルト向けサイトとして運用する前提のため、DBは `age_category = adult` のみ許可します。
- DMM側で許諾された広告素材以外は保存・加工しない方針です。

