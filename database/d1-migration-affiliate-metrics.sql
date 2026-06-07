CREATE TABLE IF NOT EXISTS affiliate_metrics_daily (
  metric_date TEXT NOT NULL,
  article_slug TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  placement TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT 'unknown',
  event_type TEXT NOT NULL
    CHECK (event_type IN ('impression', 'click')),
  event_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    metric_date, article_slug, placement, variant, device_type, event_type
  )
);

CREATE INDEX IF NOT EXISTS idx_affiliate_metrics_date
  ON affiliate_metrics_daily(metric_date, placement, event_type);

CREATE INDEX IF NOT EXISTS idx_affiliate_metrics_article
  ON affiliate_metrics_daily(article_slug, metric_date);
