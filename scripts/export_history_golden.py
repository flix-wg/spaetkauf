"""Export parity fixtures using history.py from the unchanged f33b3b0 backend."""

import json
import sys
from datetime import date
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.history import route, runs, stop_day, train_stops  # noqa: E402


def main():
    data = ROOT / "frontend/public/data/history"
    meta = json.loads((data / "meta.json").read_text())
    with duckdb.connect(config={"threads": 4}) as db:
        for name, file in (("events", "events-*.parquet"), ("trains", "trains.parquet"), ("stops", "stops.parquet")):
            db.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{data / file}')")
        db.execute("CREATE TABLE meta(key VARCHAR, value VARCHAR)")
        db.executemany("INSERT INTO meta VALUES (?, ?)", list(meta.items()))
        fixtures = {
            "runs": runs("ICE 785", "München Hbf", None, db),
            "route": route("Hamburg Hbf", "München Hbf", 4, db),
            "train": train_stops("ICE 785", 4, db),
            "day": stop_day("München Hbf", date(2026, 3, 29), db),
        }
    target = ROOT / "frontend/tests/core/golden/history.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
