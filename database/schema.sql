PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    circle_name TEXT,
    source_type TEXT NOT NULL DEFAULT 'manual'
        CHECK (source_type IN ('manual', 'dmm_api')),
    source_url TEXT,
    affiliate_url TEXT,
    thumbnail_url TEXT,
    age_category TEXT NOT NULL DEFAULT 'adult'
        CHECK (age_category = 'adult'),
    review_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (review_status IN ('draft', 'ready', 'published', 'archived')),
    rights_status TEXT NOT NULL DEFAULT 'pending_review'
        CHECK (rights_status IN ('pending_review', 'approved_ad_material', 'link_only')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS emotion_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL,
    emotion_type TEXT NOT NULL,
    hook_strength INTEGER NOT NULL DEFAULT 0
        CHECK (hook_strength BETWEEN 0 AND 100),
    cta_pattern TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
    UNIQUE (work_id, emotion_type)
);

CREATE TABLE IF NOT EXISTS sns_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL,
    channel TEXT NOT NULL DEFAULT 'x'
        CHECK (channel IN ('x')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'ready', 'posted', 'failed', 'archived')),
    external_thread_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sns_thread_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    part_no INTEGER NOT NULL
        CHECK (part_no BETWEEN 1 AND 3),
    body TEXT NOT NULL,
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (thread_id) REFERENCES sns_threads(id) ON DELETE CASCADE,
    UNIQUE (thread_id, part_no)
);

CREATE TABLE IF NOT EXISTS posted_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'x'
        CHECK (channel IN ('x')),
    posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    thread_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, channel)
);

CREATE TABLE IF NOT EXISTS bot_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type TEXT NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('started', 'success', 'failed')),
    message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_works_review_status
    ON works(review_status);

CREATE INDEX IF NOT EXISTS idx_posted_items_product_channel
    ON posted_items(product_id, channel);

CREATE INDEX IF NOT EXISTS idx_sns_threads_work_channel
    ON sns_threads(work_id, channel);

