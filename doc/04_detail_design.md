# 詳細設計

# DB設計

## posted_items

```sql
CREATE TABLE posted_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT UNIQUE,
    posted_at DATETIME,
    thread_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## emotion_analysis

```sql
CREATE TABLE emotion_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT,
    emotion_type TEXT,
    hook_strength INTEGER,
    cta_pattern TEXT
);
```

---

# Markdown構成

```md
---
title: "作品タイトル"
genre: ["イチャラブ"]
emotion: ["甘々", "緊張感"]
affiliate: "URL"
thumbnail: "/images/sample.jpg"
---

レビュー本文
```

---

# BOT構成

```text
bot/
 ├ fetch.py
 ├ image_selector.py
 ├ emotion_analyzer.py
 ├ formatter.py
 ├ post.py
 ├ database.py
 └ scheduler.py
```

---

# image_selector.py

## 役割

試し読み画像の中から：

- 導入向き
- 会話向き
- 引きが強い

ページを選定。

---

# emotion_analyzer.py

## 役割

作品から：

- 空気感
- 感情
- 関係性
- 緊張感

を分析。

---

# formatter.py

## 役割

1/3,2/3,3/3形式の投稿生成。

---

# スレッド生成ロジック

## 1/3

- 導入
- 違和感
- 状況説明

---

## 2/3

- 感情変化
- キャラ関係性

---

## 3/3

- 最大引き
- CTA

---

# CTAテンプレート

## パターン例

- 「続きは本編で…」
- 「この後の空気感かなり良かった」
- 「ここから一気に変わる」

---

# GitHub Actions

```yaml
name: Auto Thread Post

on:
  schedule:
    - cron: '0 */3 * * *'

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5

      - name: Install
        run: pip install -r requirements.txt

      - name: Run Bot
        run: python bot/main.py
```

---

# 環境変数

```env
DMM_API_ID=
DMM_AFFILIATE_ID=
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_SECRET=
```

---

# エラーハンドリング

## API失敗

- retry
- log出力

---

## 投稿失敗

- 再投稿防止
- スレッド整合性維持

---

# ログ設計

```text
logs/
 ├ api.log
 ├ emotion.log
 ├ post.log
 └ error.log
```

---

# 将来拡張

- AIレビュー生成
- AI画像分析
- レコメンド
- セール通知
- Discord通知
- LINE通知
