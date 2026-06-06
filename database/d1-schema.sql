CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'published', 'archived')),
  article_type TEXT NOT NULL DEFAULT 'review'
    CHECK (article_type IN ('review', 'column', 'news', 'list')),
  source_type TEXT NOT NULL DEFAULT 'manual',
  published_at TEXT,
  updated_at TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  product_title TEXT NOT NULL DEFAULT '',
  circle_name TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  affiliate_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  sample_images_json TEXT NOT NULL DEFAULT '[]',
  genres_json TEXT NOT NULL DEFAULT '[]',
  emotions_json TEXT NOT NULL DEFAULT '[]',
  weekly_pick INTEGER NOT NULL DEFAULT 0,
  weekly_pick_order INTEGER NOT NULL DEFAULT 0,
  editor_note TEXT NOT NULL DEFAULT '',
  rights_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (rights_status IN ('pending_review', 'approved_ad_material', 'link_only')),
  pr_label TEXT NOT NULL DEFAULT 'PR',
  automation_ready INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',
  product_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  imported_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_status_updated_at
  ON articles(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_articles_published_at
  ON articles(published_at);

CREATE INDEX IF NOT EXISTS idx_articles_circle_name
  ON articles(circle_name);

CREATE INDEX IF NOT EXISTS idx_articles_status_circle_author
  ON articles(status, circle_name, author_name);

CREATE INDEX IF NOT EXISTS idx_articles_weekly_pick
  ON articles(weekly_pick, weekly_pick_order);
