CREATE TABLE IF NOT EXISTS article_selection_memberships (
  article_slug TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL,
  source_rank INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  run_id TEXT NOT NULL,
  PRIMARY KEY (article_slug, source_key)
);

CREATE INDEX IF NOT EXISTS idx_article_selection_source
  ON article_selection_memberships(source_key, source_rank);

CREATE INDEX IF NOT EXISTS idx_article_selection_product
  ON article_selection_memberships(product_id);
