# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.1"]
# ///
"""Build data/history.sqlite: one row per long-distance arrival (train, stop, date), so every number in
odds.sqlite can be traced to individual runs. Same event filter, dedup and delay as build_odds.py.

uv run scripts/build_history.py [--raw DIR] [--min-runs 1]
"""

import argparse
import random
import sqlite3
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_odds
from build_odds import END, START, load_events

from app.matching import LONG_DISTANCE_TYPES, station_key

OUT = build_odds.ROOT / "data" / "history.sqlite"
ODDS = build_odds.ROOT / "data" / "odds.sqlite"
LIMIT_MB = 45


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, default=build_odds.RAW, help="directory with data-YYYY-MM.parquet")
    ap.add_argument("--min-runs", type=int, default=1, help="drop (train, stop) pairs with fewer runs")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    t0 = time.time()
    files = sorted(args.raw.glob("data-*.parquet"))
    if not files:
        sys.exit(f"no data-*.parquet in {args.raw}; run scripts/build_odds.py first")
    con = duckdb.connect()
    load_events(con, files, START, END)
    names = con.execute("SELECT eva, mode(station_name) FROM events GROUP BY 1 ORDER BY 1").fetchall()
    con.execute("""
        CREATE TABLE trains AS SELECT row_number() OVER (ORDER BY train_type, train_number) AS id,
            train_type, train_number FROM (SELECT DISTINCT train_type, train_number FROM events)""")
    con.execute("CREATE TABLE stop_ids AS SELECT row_number() OVER (ORDER BY eva) AS id, eva "
                "FROM (SELECT DISTINCT eva FROM events)")
    con.execute("""
        CREATE TABLE legs AS SELECT row_number() OVER (ORDER BY train_id, stop_id) AS id, train_id, stop_id
        FROM (SELECT DISTINCT t.id AS train_id, s.id AS stop_id FROM events
              JOIN trains t USING (train_type, train_number) JOIN stop_ids s USING (eva))""")
    con.execute(f"""
        CREATE TABLE runs AS
        SELECT l.id AS leg_id,
               datediff('day', DATE '1970-01-01', planned::DATE) AS day,
               hour(planned) * 60 + minute(planned) AS planned_min,
               CASE WHEN cancelled THEN NULL ELSE delay_min END AS delay_min
        FROM (SELECT events.*, t.id AS train_id, s.id AS stop_id,
                     count(*) OVER (PARTITION BY train_type, train_number, eva) AS pair_runs
              FROM events JOIN trains t USING (train_type, train_number) JOIN stop_ids s USING (eva)) e
        JOIN legs l USING (train_id, stop_id)
        WHERE pair_runs >= {args.min_runs}
    """)
    unknown = con.execute("SELECT count(*) FROM events WHERE NOT cancelled AND delay_min IS NULL").fetchone()[0]
    if unknown:  # delay_min NULL means cancelled in runs; an unknown delay would be mistaken for it
        sys.exit(f"{unknown} non-cancelled arrivals have no delay; runs needs a separate cancelled column")
    trains = con.execute("SELECT id, train_type, train_number FROM trains ORDER BY id").fetchall()
    stop_ids = dict(con.execute("SELECT eva, id FROM stop_ids").fetchall())
    stops = [(stop_ids[e], e, station_key(n), n) for e, n in names]
    date_range = con.execute("SELECT min(planned)::DATE, max(planned)::DATE FROM events").fetchone()

    tmp = args.out.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.executescript("""
        PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
        CREATE TABLE trains (id INTEGER PRIMARY KEY, train_type TEXT NOT NULL, train_number TEXT NOT NULL,
                             UNIQUE (train_type, train_number));
        CREATE TABLE stops (id INTEGER PRIMARY KEY, eva TEXT NOT NULL UNIQUE, station_key TEXT NOT NULL,
                            name TEXT NOT NULL);
        CREATE INDEX idx_stops_key ON stops (station_key);
        -- day = days since 1970-01-01 (weekday 0 = Monday is (day + 3) % 7), planned_min = local minute of day,
        -- delay_min = arrival_change_time - arrival_planned_time; NULL = cancelled (saves a byte per row)
        -- one row per (train, stop) pair keeps the run rows small
        CREATE TABLE legs (id INTEGER PRIMARY KEY, train_id INTEGER NOT NULL, stop_id INTEGER NOT NULL,
                           UNIQUE (train_id, stop_id));
        CREATE TABLE runs (leg_id INTEGER NOT NULL, day INTEGER NOT NULL,
                           planned_min INTEGER NOT NULL, delay_min INTEGER,
                           PRIMARY KEY (leg_id, day, planned_min)) WITHOUT ROWID;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    db.executemany("INSERT INTO trains VALUES (?, ?, ?)", trains)
    db.executemany("INSERT INTO stops VALUES (?, ?, ?, ?)", stops)
    db.executemany("INSERT INTO legs VALUES (?, ?, ?)", con.execute("SELECT * FROM legs ORDER BY id").fetchall())
    cur = con.execute("SELECT * FROM runs ORDER BY leg_id, day, planned_min")
    while batch := cur.fetchmany(200_000):
        db.executemany("INSERT INTO runs VALUES (?, ?, ?, ?)", batch)
    n_rows = db.execute("SELECT count(*) FROM runs").fetchone()[0]
    meta = {
        "source": "piebro/deutsche-bahn-data (Hugging Face), CC BY 4.0",
        "files": ",".join(f.name for f in files),
        "date_from": str(date_range[0]), "date_to": str(date_range[1]),
        "train_types": ",".join(LONG_DISTANCE_TYPES),
        "delay_definition": "arrival_change_time - arrival_planned_time; same events as odds.sqlite",
        "min_runs": str(args.min_runs),
        "rows": str(n_rows),
        "built_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    db.executemany("INSERT INTO meta VALUES (?, ?)", meta.items())
    db.commit()
    db.execute("VACUUM")
    db.close()
    tmp.rename(args.out)
    size = args.out.stat().st_size / 1e6
    print(f"{args.out.name}: {n_rows} runs, {len(trains)} trains, {len(stops)} stops, "
          f"{size:.1f} MB (limit {LIMIT_MB}), {time.time() - t0:.0f} s", flush=True)
    if size > LIMIT_MB:
        print(f"WARNING: over {LIMIT_MB} MB; rebuild with --min-runs 5 or similar")
    check_against_odds(args.out, ODDS, args.min_runs)


def check_against_odds(history: Path, odds: Path, min_runs: int) -> None:
    """3 random (train, stop, weekday) cells: runs and 20+ late runs must equal train_stop_stats."""
    if not odds.exists():
        print(f"consistency check skipped: {odds} missing")
        return
    o, h = sqlite3.connect(odds), sqlite3.connect(history)
    cells = o.execute("SELECT train_type, train_number, station_key, weekday, sum(n), sum(ge20) "
                      "FROM train_stop_stats GROUP BY 1, 2, 3, 4 HAVING sum(n) >= 10").fetchall()
    ok = True
    for tt, tn, key, wd, n, ge20 in random.sample(cells, 3):
        got = h.execute("""
            SELECT count(*), coalesce(sum(r.delay_min IS NULL OR r.delay_min >= 20), 0)
            FROM runs r JOIN legs l ON l.id = r.leg_id JOIN trains t ON t.id = l.train_id
            JOIN stops s ON s.id = l.stop_id
            WHERE t.train_type = ? AND t.train_number = ? AND s.station_key = ? AND (r.day + 3) % 7 = ?
        """, (tt, tn, key, wd)).fetchone()
        match = got == (n, ge20)
        ok &= match
        print(f"check {tt} {tn} {key!r} weekday {wd}: odds n={n} ge20={ge20}; history n={got[0]} "
              f"late20={got[1]} -> {'OK' if match else 'MISMATCH'}")
    if not ok:
        sys.exit("consistency check failed")


if __name__ == "__main__":
    main()
