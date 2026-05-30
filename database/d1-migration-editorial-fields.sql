-- Run once on existing D1 databases before deploying code that writes these fields.
ALTER TABLE articles ADD COLUMN sample_images_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE articles ADD COLUMN weekly_pick INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN weekly_pick_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN editor_note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_articles_weekly_pick
  ON articles(weekly_pick, weekly_pick_order);
