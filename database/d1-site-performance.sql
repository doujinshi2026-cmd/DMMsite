CREATE INDEX IF NOT EXISTS idx_articles_status_circle_author
  ON articles(status, circle_name, author_name);
