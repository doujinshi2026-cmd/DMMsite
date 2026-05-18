# 基本設計

# 技術構成

| 分類 | 技術 |
|---|---|
| Frontend | Next.js |
| Styling | Tailwind CSS |
| Hosting | Cloudflare Pages |
| BOT | Python |
| DB | SQLite |
| Automation | GitHub Actions |
| Content | Markdown |
| API | DMM Affiliate API |
| SNS | X API |

---

# アーキテクチャ

```text
DMM API
↓
Python収集
↓
感情分析
↓
Markdown生成
↓
GitHub Push
↓
Next.js Build
↓
Cloudflare Pages
```

---

# ディレクトリ構成

```text
project/
├ app/
├ components/
├ lib/
├ content/
│  └ posts/
├ bot/
├ scripts/
├ database/
├ public/
└ .github/
```

---

# UX設計

# スレッド構成

## 1/3

役割：

- フック
- 違和感
- 導入

表示内容：

- 会話
- キャラ
- 状況

---

## 2/3

役割：

- 感情引き込み
- 関係性変化

表示内容：

- 心理描写
- 距離感変化

---

## 3/3

役割：

- 最大引き
- CTA

表示内容：

- 気になる瞬間直前
- 続き導線

---

# CTA設計

例：

- 「続きが気になる…」
- 「この空気感かなり良かった」
- 「この後が本番」

---

# SEO設計

## URL

```text
/reviews/work-name
```

---

## title

```text
【レビュー】作品名｜感情・空気感レビュー
```

---

## OGP

- 試し読み画像
- キャラ感情訴求

---

# BOT設計

## 投稿フロー

```text
作品取得
↓
画像選定
↓
感情分析
↓
文章生成
↓
スレッド投稿
↓
履歴保存
```
