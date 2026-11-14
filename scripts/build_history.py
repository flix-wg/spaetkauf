# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb==2.0.0"]
# ///
"""Build data/history.duckdb: every long-distance event (arrival and departure) per train, stop and date,
so each number in odds.sqlite can be traced to individual runs. Same filter, dedup and arrival delay as
build_odds.py (`load_events`); departure-only rows (a train's first stop) are added.

uv run scripts/build_history.py [--raw DIR] [--out FILE]

The duckdb version is pinned like backend/pyproject.toml: a file written by a newer DuckDB cannot be read
by an older one.
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

OUT = build_odds.ROOT / "data" / "history.duckdb"
ODDS = build_odds.ROOT / "data" / "odds.sqlite"
RUN_GAP = "INTERVAL 12 HOUR"  # the same ride id is reused every day; a new run starts after this gap


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, default=build_odds.RAW, help="directory with data-YYYY-MM.parquet")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    t0 = time.time()
    files = sorted(args.raw.glob("data-*.parquet"))
    if not files:
        sys.exit(f"no data-*.parquet in {args.raw}; run scripts/build_odds.py first")
    con = duckdb.connect()
    load_events(con, files, START, END, with_departures=True)
    names = con.execute("SELECT eva, mode(station_name) FROM events GROUP BY 1 ORDER BY 1").fetchall()
    con.execute("CREATE TABLE stops (id USMALLINT, eva VARCHAR, station_key VARCHAR, name VARCHAR)")
    con.executemany(
        "INSERT INTO stops VALUES (?, ?, ?, ?)",
        [(i, e, station_key(n), n) for i, (e, n) in enumerate(names, 1)],
    )
    types = ", ".join(f"'{t}'" for t in LONG_DISTANCE_TYPES)
    con.execute("""
        CREATE TABLE trains AS
        SELECT (row_number() OVER (ORDER BY train_type, train_number))::USMALLINT AS id,
               train_type, train_number
        FROM (SELECT DISTINCT train_type, train_number FROM events)""")
    # A run = the events of one ride id between two resets of the stop sequence or a long gap.
    con.execute(f"""
        CREATE TABLE ev AS
        WITH o AS (
            SELECT *, lag(seq) OVER w AS prev_seq, lag(ts) OVER w AS prev_ts
            FROM events WINDOW w AS (PARTITION BY ride_id ORDER BY ts, seq)),
        b AS (
            SELECT *, sum(CASE WHEN prev_seq IS NULL OR seq <= prev_seq OR ts - prev_ts > {RUN_GAP}
                               THEN 1 ELSE 0 END)
                      OVER (PARTITION BY ride_id ORDER BY ts, seq ROWS UNBOUNDED PRECEDING) AS run_no
            FROM o)
        SELECT t.id AS train_id, s.id AS stop_id, ts::DATE AS day,
               CASE WHEN ride_id IS NULL THEN NULL ELSE dense_rank() OVER (ORDER BY ride_id, run_no) END
                   AS run_id,
               seq::SMALLINT AS seq,
               planned AS arr_planned, CASE WHEN cancelled THEN NULL ELSE delay_min END::SMALLINT AS arr_delay,
               planned IS NOT NULL AND cancelled AS arr_cancelled,
               dep_planned, CASE WHEN dep_cancelled THEN NULL ELSE dep_delay_min END::SMALLINT AS dep_delay,
               dep_planned IS NOT NULL AND dep_cancelled AS dep_cancelled
        FROM b JOIN trains t USING (train_type, train_number) JOIN stops s USING (eva)
    """)
    n_arr, n_all = con.execute("SELECT count(arr_planned), count(*) FROM ev").fetchone()
    date_range = con.execute("SELECT min(day), max(day) FROM ev").fetchone()
    n_runs = con.execute("SELECT count(DISTINCT run_id) FROM ev").fetchone()[0]

    tmp = args.out.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    con.execute(f"ATTACH '{tmp}' AS out")
    con.execute("CREATE TYPE out.train_type AS ENUM (" + types + ")")
    con.execute("CREATE TABLE out.trains AS SELECT id, train_type::out.train_type AS train_type, "
                "train_number FROM trains ORDER BY id")  # fmt: skip
    con.execute("CREATE TABLE out.stops AS SELECT * FROM stops ORDER BY id")
    # sorted by (train, stop, day): zone maps make a per-train lookup read a few row groups
    con.execute("CREATE TABLE out.events AS SELECT * FROM ev ORDER BY train_id, stop_id, day, arr_planned, "
                "dep_planned")  # fmt: skip
    meta = {
        "source": "piebro/deutsche-bahn-data (Hugging Face), CC BY 4.0",
        "files": ",".join(f.name for f in files),
        "date_from": str(date_range[0]), "date_to": str(date_range[1]),
        "train_types": ",".join(LONG_DISTANCE_TYPES),
        "delay_definition": "arrival_change_time - arrival_planned_time (departure likewise); NULL when "
                            "cancelled or unknown; same events as odds.sqlite",
        "rows": str(n_all), "arrival_rows": str(n_arr), "runs": str(n_runs),
        "built_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "duckdb": duckdb.__version__,
    }  # fmt: skip
    con.execute("CREATE TABLE out.meta (key VARCHAR PRIMARY KEY, value VARCHAR NOT NULL)")
    con.executemany("INSERT INTO out.meta VALUES (?, ?)", list(meta.items()))
    con.execute("CHECKPOINT out")
    con.execute("DETACH out")
    con.close()
    print(f"{args.out.name}: {n_all} events ({n_arr} with an arrival), {n_runs} runs, "
          f"{tmp.stat().st_size / 1e6:.1f} MB, {time.time() - t0:.0f} s", flush=True)
    check_against_odds(tmp, ODDS)  # exits before the rename, so a failed build keeps the old file
    tmp.replace(args.out)


def check_against_odds(history: Path, odds: Path) -> None:
    """3 random (train, stop, weekday) cells: runs and 20+ late runs must equal train_stop_stats."""
    if not odds.exists():
        print(f"consistency check skipped: {odds} missing")
        return
    o, h = sqlite3.connect(odds), duckdb.connect(str(history), read_only=True)
    cells = o.execute("SELECT train_type, train_number, station_key, weekday, sum(n), sum(ge20) "
                      "FROM train_stop_stats GROUP BY 1, 2, 3, 4 HAVING sum(n) >= 10").fetchall()
    ok = True
    for tt, tn, key, wd, n, ge20 in random.sample(cells, 3):
        got = h.execute("""
            SELECT count(*), coalesce(sum((e.arr_cancelled OR e.arr_delay >= 20)::INT), 0)
            FROM events e JOIN trains t ON t.id = e.train_id JOIN stops s ON s.id = e.stop_id
            WHERE e.arr_planned IS NOT NULL AND t.train_type = ? AND t.train_number = ?
              AND s.station_key = ? AND isodow(e.day) - 1 = ?
        """, [tt, tn, key, wd]).fetchone()  # fmt: skip
        match = tuple(got) == (n, ge20)
        ok &= match
        print(f"check {tt} {tn} {key!r} weekday {wd}: odds n={n} ge20={ge20}; history n={got[0]} "
              f"late20={got[1]} -> {'OK' if match else 'MISMATCH'}")
    if not ok:
        sys.exit("consistency check failed")


if __name__ == "__main__":
    main()
