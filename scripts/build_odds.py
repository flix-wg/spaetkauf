# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.1"]
# ///
"""Download the DB history (piebro/deutsche-bahn-data) and build data/odds.sqlite (design D4).

uv run scripts/build_odds.py [--min-n 1]
"""

import argparse
import os
import sqlite3
import sys
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
from matching import LONG_DISTANCE_TYPES, station_key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "odds.sqlite"
MONTHS = ["2025-12"] + [f"2026-{m:02d}" for m in range(1, 11)]
START, END = "2025-12-14", "2026-10-31"
URL = "https://huggingface.co/datasets/piebro/deutsche-bahn-data/resolve/main/monthly_processed_data/data-{}.parquet"
THRESHOLDS = (5, 10, 15, 20, 30, 45, 60, 90, 120)


def download(months=MONTHS) -> list[Path]:
    RAW.mkdir(parents=True, exist_ok=True)
    ua = os.environ.get("SPAETKAUF_CLIENT_NAME", "spaetkauf-demo/0.1")
    paths = []
    for m in months:
        p = RAW / f"data-{m}.parquet"
        if not p.exists() or p.stat().st_size == 0:
            print(f"downloading {m}", flush=True)
            req = urllib.request.Request(URL.format(m), headers={"User-Agent": ua})
            tmp = p.with_suffix(".part")
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            tmp.rename(p)
        paths.append(p)
    return paths


def load_events(con: duckdb.DuckDBPyConnection, files: list[Path], start: str, end: str) -> None:
    """Create table `events`: one row per long-distance train arrival at a stop, deduplicated.

    delay_min = arrival_change_time - arrival_planned_time (delay_in_min is the departure delay where
    the train departs, see docs/odds.md). Replacement trains are dropped; their number is not the
    scheduled train's.
    """
    types = ", ".join(f"'{t}'" for t in LONG_DISTANCE_TYPES)
    file_list = ", ".join(f"'{f}'" for f in files)
    con.execute(f"""
        CREATE OR REPLACE TABLE events AS
        SELECT train_type, train_number, eva, station_name,
               arrival_planned_time AS planned,
               datediff('minute', arrival_planned_time, arrival_change_time) AS delay_min,
               coalesce(arrival_is_canceled, false) AS cancelled,
               isodow(arrival_planned_time) - 1 AS weekday
        FROM read_parquet([{file_list}])
        WHERE train_type IN ({types})
          AND NOT coalesce(is_replacement_train, false)
          AND arrival_planned_time IS NOT NULL
          AND arrival_planned_time >= TIMESTAMP '{start}'
          AND arrival_planned_time < TIMESTAMP '{end}' + INTERVAL 1 DAY
        QUALIFY row_number() OVER (
            PARTITION BY train_type, train_number, eva, arrival_planned_time ORDER BY "time" DESC) = 1
    """)


def stats_sql(source: str = "events") -> str:
    ge = ",\n".join(f"sum((cancelled OR delay_min >= {t})::INT) AS ge{t}" for t in THRESHOLDS)
    return f"""
        SELECT train_type, train_number, eva, weekday,
               count(*) AS n, sum(cancelled::INT) AS n_cancel,
               {ge},
               strftime(min(planned), '%Y-%m-%d') AS first_date,
               strftime(max(planned), '%Y-%m-%d') AS last_date
        FROM {source} GROUP BY ALL
    """


def delay_column_check(con, files) -> None:
    file_list = ", ".join(f"'{f}'" for f in files)
    print("delay_in_min check (ICE/IC, all months):")
    print(con.sql(f"""
        SELECT departure_planned_time IS NOT NULL AS departs,
               count(*) AS rows,
               round(avg((delay_in_min = datediff('minute', arrival_planned_time, arrival_change_time))::INT), 4) AS eq_arrival_delay,
               round(avg((delay_in_min = datediff('minute', departure_planned_time, departure_change_time))::INT), 4) AS eq_departure_delay,
               round(avg((arrival_change_time IS NULL)::INT), 4) AS arrival_change_missing
        FROM read_parquet([{file_list}])
        WHERE train_type IN ('ICE', 'IC') AND arrival_planned_time IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-n", type=int, default=1, help="drop (train, stop, weekday) cells with fewer runs")
    args = ap.parse_args()
    t0 = time.time()
    files = download()
    con = duckdb.connect()
    delay_column_check(con, files)
    load_events(con, files, START, END)
    print(con.sql("SELECT train_type, count(*) AS arrivals, count(DISTINCT train_number) AS trains, "
                  "round(avg((cancelled OR delay_min >= 20)::INT), 4) AS p20 FROM events GROUP BY 1 ORDER BY 2 DESC"))
    names = con.execute("SELECT eva, mode(station_name) FROM events GROUP BY 1").fetchall()
    con.execute("CREATE TABLE names(eva VARCHAR, station_name VARCHAR, station_key VARCHAR)")
    con.executemany("INSERT INTO names VALUES (?, ?, ?)", [(e, n, station_key(n)) for e, n in names])
    rows = con.execute(f"""
        SELECT s.train_type, s.train_number, s.eva, nm.station_name, nm.station_key, s.weekday, s.n, s.n_cancel,
               {", ".join(f"s.ge{t}" for t in THRESHOLDS)}, s.first_date, s.last_date
        FROM ({stats_sql()}) s JOIN names nm USING (eva)
        WHERE s.n >= {args.min_n}
        ORDER BY 1, 2, 3, 6
    """).fetchall()
    n_events = con.execute("SELECT count(*) FROM events").fetchone()[0]
    date_range = con.execute("SELECT min(planned)::DATE, max(planned)::DATE FROM events").fetchone()

    tmp = OUT.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    ge_cols = ", ".join(f"ge{t} INTEGER NOT NULL" for t in THRESHOLDS)
    db.executescript(f"""
        CREATE TABLE train_stop_stats (
            train_type TEXT NOT NULL, train_number TEXT NOT NULL, eva TEXT NOT NULL,
            station_name TEXT NOT NULL, station_key TEXT NOT NULL, weekday INTEGER NOT NULL,
            n INTEGER NOT NULL, n_cancel INTEGER NOT NULL, {ge_cols},
            first_date TEXT NOT NULL, last_date TEXT NOT NULL);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    db.executemany(f"INSERT INTO train_stop_stats VALUES ({', '.join('?' * 19)})", rows)
    db.execute("CREATE INDEX idx_train_weekday ON train_stop_stats (train_type, train_number, weekday)")
    meta = {
        "source": "piebro/deutsche-bahn-data (Hugging Face), CC BY 4.0",
        "files": ",".join(f.name for f in files),
        "date_from": str(date_range[0]), "date_to": str(date_range[1]),
        "train_types": ",".join(LONG_DISTANCE_TYPES),
        "delay_definition": "arrival_change_time - arrival_planned_time; cancelled arrival counts in every ge column",
        "weekday": "0 = Monday, of the planned arrival at the stop (local time)",
        "min_n": str(args.min_n),
        "arrival_events": str(n_events),
        "rows": str(len(rows)),
        "built_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    db.executemany("INSERT INTO meta VALUES (?, ?)", meta.items())
    db.commit()
    db.execute("VACUUM")
    db.close()
    tmp.rename(OUT)
    print(f"rows per train type in {OUT.name}:")
    db = sqlite3.connect(OUT)
    for r in db.execute("SELECT train_type, count(*), count(DISTINCT train_number), sum(n) FROM train_stop_stats "
                        "GROUP BY 1 ORDER BY 2 DESC"):
        print("  ", r)
    print(meta)
    print(f"size {OUT.stat().st_size / 1e6:.1f} MB, {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
