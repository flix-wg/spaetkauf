"""Export read-only odds and history for the static site.

uv run --project backend python scripts/export_static.py --odds data/odds.sqlite \
    --history data/history.duckdb --out /tmp/kurt-static
Copy /tmp/kurt-static/history/ to data/static/history/ for the committed history.
Either input may be omitted; --history also writes the per-route counts to odds/routes/. Backtest and replay JSON are copied from data/.
"""

import argparse
import json
import shutil
import sqlite3
from itertools import groupby
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GE = ("ge5", "ge10", "ge15", "ge20", "ge30", "ge45", "ge60", "ge90", "ge120")
LIMIT = 20 * 1024 * 1024


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def export_odds(source, out):
    out.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(out / "trains", ignore_errors=True)
    with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as db:
        numbers = {}
        columns = ", ".join(GE)
        rows = db.execute(
            f"SELECT train_type, train_number, station_key, eva, station_name, weekday, n, n_cancel, "
            f"{columns}, first_date, last_date FROM train_stop_stats "
            "ORDER BY train_type, train_number, station_key, weekday, eva"
        )
        for (kind, number), group in groupby(rows, key=lambda r: r[:2]):
            numbers.setdefault(number, []).append(kind)
            write_json(
                out / "trains" / f"{kind}-{number}.json",
                {"type": kind, "number": number, "rows": [r[2:] for r in group]},
            )
        rates = db.execute(
            f"SELECT train_type, SUM(n), {', '.join(f'SUM({c})' for c in GE)} "
            "FROM train_stop_stats GROUP BY 1"
        )
        type_rates = {kind: {c: k / n for c, k in zip(GE, counts)} for kind, n, *counts in rates}
        stations = {}
        names = dict(
            db.execute(
                "SELECT station_key, MIN(station_name) FROM train_stop_stats GROUP BY station_key"
            )
        )
        for key, eva, _ in db.execute(
            "SELECT station_key, eva, SUM(n) FROM train_stop_stats "
            "GROUP BY station_key, eva ORDER BY station_key, SUM(n) DESC, eva"
        ):
            stations.setdefault(key, {"eva": eva.lstrip("0"), "name": names[key]})
        write_json(
            out / "index.json",
            {
                "meta": dict(db.execute("SELECT key, value FROM meta")),
                "numbers": numbers,
                "type_rates": type_rates,
                "stations": stations,
                "eva_names": dict(
                    db.execute("SELECT eva, MIN(station_name) FROM train_stop_stats GROUP BY eva")
                ),
            },
        )


def export_part(db, query, path, count):
    db.execute(f"COPY ({query}) TO ? (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 8192)", [str(path)])
    if path.stat().st_size >= LIMIT:
        path.unlink()
        if count < 2:
            raise ValueError(f"A single row exceeds the Parquet size limit: {path}")
        half = count // 2
        for suffix, offset, size in (("a", 0, half), ("b", half, count - half)):
            export_part(
                db,
                f"SELECT * FROM ({query}) LIMIT {size} OFFSET {offset}",
                path.with_stem(path.stem + "-" + suffix),
                size,
            )


def export_history(source, out):
    import duckdb

    out.mkdir(parents=True, exist_ok=True)
    for pattern in ("events-*.parquet", "trains*.parquet", "stops*.parquet", "meta.json"):
        for old in out.glob(pattern):
            old.unlink()
    with duckdb.connect(str(source), read_only=True) as db:
        meta = dict(db.execute("SELECT key, value FROM meta").fetchall())
        for table, query in (
            (
                "trains",
                "SELECT id, train_type::VARCHAR AS train_type, train_number FROM trains ORDER BY id",
            ),
            ("stops", "SELECT * FROM stops ORDER BY id"),
        ):
            count = db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            export_part(db, query, out / f"{table}.parquet", count)
        months = db.execute(
            "SELECT strftime(day, '%Y-%m'), count(*) FROM events GROUP BY 1 ORDER BY 1"
        ).fetchall()
        for month, count in months:
            query = (
                f"SELECT * FROM events WHERE strftime(day, '%Y-%m') = '{month}' "
                "ORDER BY stop_id, train_id, day, arr_planned, dep_planned, run_id, seq"
            )
            export_part(db, query, out / f"events-{month}.parquet", count)
        write_json(out / "meta.json", {
            **{k: meta[k] for k in ("date_from", "date_to", "source")},
            "files": sorted(p.name for p in out.glob("*.parquet")),
        })


def route_file(key):
    """odds/routes/<file>: a station key is lowercase ASCII words joined by spaces."""
    return key.replace(" ", "_") + ".json"


def export_routes(source, out):
    """One file per boarding station: for each later stop, every long-distance run that stopped at both,
    counted at the later stop like the train files ([weekday, n, n_cancel, ge5..ge120] rows)."""
    import duckdb

    shutil.rmtree(out, ignore_errors=True)
    ge = ", ".join(f"sum((arr_cancelled OR arr_delay >= {c[2:]})::INT)" for c in GE)
    with duckdb.connect(str(source), read_only=True) as db:
        db.execute("""
            CREATE TEMP TABLE pairs AS
            WITH e AS (
                SELECT e.*, s.station_key AS k FROM events e JOIN stops s ON s.id = e.stop_id
                WHERE e.run_id IS NOT NULL AND s.station_key <> '')
            SELECT DISTINCT o.k AS ok, d.k AS dk, d.run_id, d.seq, d.train_id,
                   d.arr_planned, d.arr_delay, d.arr_cancelled
            FROM e o JOIN e d ON o.run_id = d.run_id AND o.seq < d.seq AND o.k <> d.k
            WHERE o.dep_planned IS NOT NULL AND d.arr_planned IS NOT NULL
        """)
        trains = {
            (ok, dk): n
            for ok, dk, n in db.execute("SELECT ok, dk, count(DISTINCT train_id) FROM pairs GROUP BY ALL").fetchall()
        }
        rows = db.execute(f"""
            SELECT ok, dk, isodow(arr_planned) - 1, count(*), sum(arr_cancelled::INT), {ge}
            FROM pairs GROUP BY ALL ORDER BY ALL
        """).fetchall()
    for origin, group in groupby(rows, key=lambda r: r[0]):
        routes = {}
        for dest, dest_rows in groupby(group, key=lambda r: r[1]):
            routes[dest] = {"trains": trains[origin, dest], "rows": [list(r[2:]) for r in dest_rows]}
        write_json(out / route_file(origin), routes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--odds", type=Path)
    parser.add_argument("--history", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not args.odds and not args.history:
        parser.error("provide --odds and/or --history")
    if args.odds:
        export_odds(args.odds, args.out / "odds")
    if args.history:
        export_history(args.history, args.out / "history")
        export_routes(args.history, args.out / "odds" / "routes")
    args.out.mkdir(parents=True, exist_ok=True)
    for name in ("backtest.json", "replays.json"):
        shutil.copyfile(ROOT / "data" / name, args.out / name)


if __name__ == "__main__":
    main()
