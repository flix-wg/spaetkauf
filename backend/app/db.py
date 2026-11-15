import os
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS http_cache (
  key TEXT PRIMARY KEY, fetched_at REAL NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ext_adapt (
  hash TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'failed')),
  spec TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ext_adapt_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plan_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  secret_hash TEXT,
  pick TEXT NOT NULL,
  price_eur TEXT,
  push TEXT,
  switched INTEGER NOT NULL DEFAULT 0,
  auto INTEGER NOT NULL DEFAULT 0,
  is_replay INTEGER NOT NULL DEFAULT 0,
  replay_of TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trip_snapshots (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  delay_min INTEGER,
  expected_arr TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS snapshots_trip ON trip_snapshots(trip_id, at);
CREATE TABLE IF NOT EXISTS trip_alerts (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (trip_id, kind)
);
CREATE TABLE IF NOT EXISTS board (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  checked_at TEXT, checked INTEGER NOT NULL DEFAULT 0,
  late TEXT NOT NULL DEFAULT '[]', last_error TEXT
);
"""
TRIP_COLUMNS = {
    "lang": "TEXT",
    "finished_at": "TEXT",
    "final_delay_min": "INTEGER",
    "alts": "TEXT",
    "alts_at": "TEXT",
}


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    synchronous = "OFF" if os.getenv("SPAETKAUF_TEST_DB_FAST") == "1" else "NORMAL"
    conn.execute(f"PRAGMA synchronous = {synchronous}")
    return conn


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    with conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        have = {r["name"] for r in conn.execute("PRAGMA table_info(trips)")}
        for col, kind in TRIP_COLUMNS.items():
            if col not in have:
                conn.execute(f"ALTER TABLE trips ADD COLUMN {col} {kind}")
    conn.close()


def purge(path: Path) -> None:
    """Retention stated on /datenschutz: a trip goes 30 days after arrival (or a year after it was
    saved, if it never finished); cached search results after 7 days."""
    now = datetime.now(UTC)
    iso = lambda d: (now - timedelta(days=d)).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = connect(path)
    with conn:
        conn.execute(
            "DELETE FROM trips WHERE finished_at < ? OR (finished_at IS NULL AND created_at < ?)",
            (iso(30), iso(365)),
        )
        conn.execute("DELETE FROM http_cache WHERE fetched_at < ?", (time.time() - 7 * 86400,))
    conn.close()
