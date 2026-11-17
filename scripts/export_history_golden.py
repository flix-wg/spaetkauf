"""Export parity fixtures using the preserved backend with explicit SQL tie-breaking."""

import json
import sys
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import duckdb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.history import route, runs, stop_day, train_stops  # noqa: E402


class OrderedHistory:
    """Resolve SQL ties without changing the preserved backend implementation."""

    def __init__(self, db):
        self.db = db

    def execute(self, sql, args=None):
        def replace(old, new):
            nonlocal sql
            if old not in sql:
                raise ValueError(f"Backend history SQL changed; missing: {old}")
            sql = sql.replace(old, new)

        if "WITH f AS" in sql:
            replace("mode(j.dep_min), mode(j.arr_min)",
                    "mode(j.dep_min ORDER BY j.dep_min), mode(j.arr_min ORDER BY j.arr_min)")
            replace("ORDER BY n DESC LIMIT",
                    "ORDER BY n DESC, t.train_type::VARCHAR, t.train_number LIMIT")
        if "e.dep_delay, e.dep_cancelled" in sql:
            replace("ORDER BY e.arr_planned, t.train_type, t.train_number LIMIT",
                    "ORDER BY e.arr_planned, t.train_type::VARCHAR, t.train_number, "
                    "e.arr_delay, e.arr_cancelled, e.dep_planned, e.dep_delay, e.dep_cancelled LIMIT")
        return self.db.execute(sql, args or [])


REQUEST = SimpleNamespace(headers={})  # English texts, as the static app's parity tests expect


def dst_sunday(date_from: str, date_to: str) -> date:
    """The spring DST change (last Sunday of March) inside the window, a stop day with a skipped hour."""
    for year in range(int(date_to[:4]), int(date_from[:4]) - 1, -1):
        day = date(year, 3, 31)
        day -= timedelta(days=(day.weekday() + 1) % 7)
        if date_from <= day.isoformat() <= date_to:
            return day
    raise SystemExit(f"no March DST change between {date_from} and {date_to}")


def main():
    data = ROOT / "frontend/public/data/history"
    meta = json.loads((data / "meta.json").read_text())
    with duckdb.connect(config={"threads": 4}) as db:
        for name, file in (("events", "events-*.parquet"), ("trains", "trains.parquet"), ("stops", "stops.parquet")):
            db.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{data / file}')")
        db.execute("CREATE TABLE meta(key VARCHAR, value VARCHAR)")
        db.executemany("INSERT INTO meta VALUES (?, ?)", [(key, value) for key, value in meta.items() if key != "files"])
        ordered = OrderedHistory(db)
        fixtures = {
            "runs": runs(REQUEST, "ICE 785", "München Hbf", None, ordered),
            "route": route(REQUEST, "Hamburg Hbf", "München Hbf", 4, ordered),
            "train": train_stops(REQUEST, "ICE 785", 4, ordered),
            "day": stop_day(REQUEST, "München Hbf", dst_sunday(meta["date_from"], meta["date_to"]), ordered),
        }
    target = ROOT / "frontend/tests/core/golden/history.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
