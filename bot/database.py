from __future__ import annotations

import argparse
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = PROJECT_ROOT / "database" / "bot.sqlite3"
SCHEMA_PATH = PROJECT_ROOT / "database" / "schema.sql"


class DatabaseError(RuntimeError):
    """Raised when the local BOT database cannot complete an operation."""


def _resolve_db_path(db_path: str | Path | None = None) -> Path:
    return Path(db_path) if db_path else DEFAULT_DB_PATH


@contextmanager
def connect(db_path: str | Path | None = None):
    path = _resolve_db_path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: str | Path | None = None) -> Path:
    if not SCHEMA_PATH.exists():
        raise DatabaseError(f"Schema file not found: {SCHEMA_PATH}")

    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    path = _resolve_db_path(db_path)
    with connect(path) as conn:
        conn.executescript(schema)
        conn.execute(
            "INSERT INTO bot_runs (run_type, status, message) VALUES (?, ?, ?)",
            ("init_db", "success", "Database schema initialized."),
        )
    return path


def upsert_work(
    *,
    product_id: str,
    title: str,
    circle_name: str | None = None,
    source_type: str = "manual",
    source_url: str | None = None,
    affiliate_url: str | None = None,
    thumbnail_url: str | None = None,
    age_category: str = "adult",
    review_status: str = "draft",
    rights_status: str = "pending_review",
    db_path: str | Path | None = None,
) -> sqlite3.Row:
    if age_category != "adult":
        raise ValueError("This project is configured for adult-only affiliate content.")

    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO works (
                product_id,
                title,
                circle_name,
                source_type,
                source_url,
                affiliate_url,
                thumbnail_url,
                age_category,
                review_status,
                rights_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(product_id) DO UPDATE SET
                title = excluded.title,
                circle_name = excluded.circle_name,
                source_type = excluded.source_type,
                source_url = excluded.source_url,
                affiliate_url = excluded.affiliate_url,
                thumbnail_url = excluded.thumbnail_url,
                age_category = excluded.age_category,
                review_status = excluded.review_status,
                rights_status = excluded.rights_status,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                product_id,
                title,
                circle_name,
                source_type,
                source_url,
                affiliate_url,
                thumbnail_url,
                age_category,
                review_status,
                rights_status,
            ),
        )
        row = conn.execute(
            "SELECT * FROM works WHERE product_id = ?",
            (product_id,),
        ).fetchone()
        if row is None:
            raise DatabaseError(f"Failed to upsert work: {product_id}")
        return row


def get_work(product_id: str, db_path: str | Path | None = None) -> sqlite3.Row | None:
    with connect(db_path) as conn:
        return conn.execute(
            "SELECT * FROM works WHERE product_id = ?",
            (product_id,),
        ).fetchone()


def has_posted(
    product_id: str,
    *,
    channel: str = "x",
    db_path: str | Path | None = None,
) -> bool:
    with connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT 1
            FROM posted_items
            WHERE product_id = ? AND channel = ?
            LIMIT 1
            """,
            (product_id, channel),
        ).fetchone()
        return row is not None


def mark_posted(
    product_id: str,
    *,
    channel: str = "x",
    thread_id: str | None = None,
    db_path: str | Path | None = None,
) -> None:
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO posted_items (product_id, channel, thread_id)
            VALUES (?, ?, ?)
            ON CONFLICT(product_id, channel) DO UPDATE SET
                posted_at = CURRENT_TIMESTAMP,
                thread_id = excluded.thread_id
            """,
            (product_id, channel, thread_id),
        )


def save_emotion_analysis(
    product_id: str,
    *,
    emotion_type: str,
    hook_strength: int,
    cta_pattern: str | None = None,
    notes: str | None = None,
    db_path: str | Path | None = None,
) -> sqlite3.Row:
    if not 0 <= hook_strength <= 100:
        raise ValueError("hook_strength must be between 0 and 100.")

    with connect(db_path) as conn:
        work = conn.execute(
            "SELECT id FROM works WHERE product_id = ?",
            (product_id,),
        ).fetchone()
        if work is None:
            raise DatabaseError(f"Work not found: {product_id}")

        conn.execute(
            """
            INSERT INTO emotion_analysis (
                work_id,
                emotion_type,
                hook_strength,
                cta_pattern,
                notes
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(work_id, emotion_type) DO UPDATE SET
                hook_strength = excluded.hook_strength,
                cta_pattern = excluded.cta_pattern,
                notes = excluded.notes,
                updated_at = CURRENT_TIMESTAMP
            """,
            (work["id"], emotion_type, hook_strength, cta_pattern, notes),
        )
        row = conn.execute(
            """
            SELECT *
            FROM emotion_analysis
            WHERE work_id = ? AND emotion_type = ?
            """,
            (work["id"], emotion_type),
        ).fetchone()
        if row is None:
            raise DatabaseError(f"Failed to save emotion analysis: {product_id}")
        return row


def create_thread_draft(
    product_id: str,
    posts: Iterable[str],
    *,
    channel: str = "x",
    db_path: str | Path | None = None,
) -> int:
    post_list = [post.strip() for post in posts if post.strip()]
    if len(post_list) != 3:
        raise ValueError("A thread draft must contain exactly 3 posts.")

    with connect(db_path) as conn:
        work = conn.execute(
            "SELECT id FROM works WHERE product_id = ?",
            (product_id,),
        ).fetchone()
        if work is None:
            raise DatabaseError(f"Work not found: {product_id}")

        cursor = conn.execute(
            """
            INSERT INTO sns_threads (work_id, channel, status)
            VALUES (?, ?, 'draft')
            """,
            (work["id"], channel),
        )
        thread_pk = int(cursor.lastrowid)

        conn.executemany(
            """
            INSERT INTO sns_thread_posts (thread_id, part_no, body)
            VALUES (?, ?, ?)
            """,
            [
                (thread_pk, index + 1, body)
                for index, body in enumerate(post_list)
            ],
        )
        return thread_pk


def list_pending_works(
    *,
    channel: str = "x",
    limit: int = 20,
    db_path: str | Path | None = None,
) -> list[sqlite3.Row]:
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT w.*
            FROM works AS w
            LEFT JOIN posted_items AS p
                ON p.product_id = w.product_id
                AND p.channel = ?
            WHERE p.id IS NULL
                AND w.review_status IN ('draft', 'ready', 'published')
            ORDER BY w.created_at ASC
            LIMIT ?
            """,
            (channel, limit),
        ).fetchall()
        return list(rows)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local BOT database utility.")
    parser.add_argument("--db", default=None, help="SQLite database path.")

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init", help="Initialize the SQLite database.")

    add_work = subparsers.add_parser("add-work", help="Insert or update a work.")
    add_work.add_argument("product_id")
    add_work.add_argument("title")
    add_work.add_argument("--circle-name")
    add_work.add_argument("--source-url")
    add_work.add_argument("--affiliate-url")
    add_work.add_argument("--thumbnail-url")
    add_work.add_argument("--review-status", default="draft")
    add_work.add_argument("--rights-status", default="pending_review")

    has_posted_parser = subparsers.add_parser("has-posted", help="Check post status.")
    has_posted_parser.add_argument("product_id")
    has_posted_parser.add_argument("--channel", default="x")

    mark_posted_parser = subparsers.add_parser("mark-posted", help="Mark as posted.")
    mark_posted_parser.add_argument("product_id")
    mark_posted_parser.add_argument("--channel", default="x")
    mark_posted_parser.add_argument("--thread-id")

    list_pending = subparsers.add_parser("list-pending", help="List pending works.")
    list_pending.add_argument("--channel", default="x")
    list_pending.add_argument("--limit", type=int, default=20)

    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "init":
        db_path = init_db(args.db)
        print(f"initialized: {db_path}")
        return 0

    if args.command == "add-work":
        init_db(args.db)
        row = upsert_work(
            product_id=args.product_id,
            title=args.title,
            circle_name=args.circle_name,
            source_url=args.source_url,
            affiliate_url=args.affiliate_url,
            thumbnail_url=args.thumbnail_url,
            review_status=args.review_status,
            rights_status=args.rights_status,
            db_path=args.db,
        )
        print(f"work: {row['product_id']} {row['title']}")
        return 0

    if args.command == "has-posted":
        init_db(args.db)
        print("yes" if has_posted(args.product_id, channel=args.channel, db_path=args.db) else "no")
        return 0

    if args.command == "mark-posted":
        init_db(args.db)
        mark_posted(
            args.product_id,
            channel=args.channel,
            thread_id=args.thread_id,
            db_path=args.db,
        )
        print(f"posted: {args.product_id}")
        return 0

    if args.command == "list-pending":
        init_db(args.db)
        rows = list_pending_works(
            channel=args.channel,
            limit=args.limit,
            db_path=args.db,
        )
        for row in rows:
            print(f"{row['product_id']}\t{row['title']}\t{row['review_status']}")
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

