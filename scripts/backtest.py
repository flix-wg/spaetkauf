# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.1"]
# ///
"""Task 2.4: odds from an earlier period against outcomes in a later one, by 10-point bucket.

uv run scripts/backtest.py   (needs data/raw from build_odds.py)
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
from build_odds import MONTHS, ROOT, download, load_events, stats_sql  # noqa: E402

TRAIN = ("2025-12-14", "2026-08-31")
TEST = ("2026-09-01", "2026-10-31")
MIN_TRAIN_RUNS = 10


def main() -> None:
    files = download(MONTHS)
    con = duckdb.connect()
    load_events(con, files, *TRAIN)
    con.execute(f"CREATE TABLE train_cells AS {stats_sql()}")
    con.execute("ALTER TABLE events RENAME TO train_events")
    load_events(con, files, *TEST)
    con.execute(f"""
        CREATE TABLE scored AS
        SELECT e.*, (e.cancelled OR e.delay_min >= 20)::INT AS late20,
               c.ge20 / c.n AS p, least(floor(c.ge20 * 10.0 / c.n), 9)::INT AS bucket
        FROM events e JOIN train_cells c USING (train_type, train_number, eva, weekday)
        WHERE c.n >= {MIN_TRAIN_RUNS}
    """)
    all_test, base_all, cancel_share = con.execute(
        "SELECT count(*), avg((cancelled OR delay_min >= 20)::INT), avg(cancelled::INT) FROM events").fetchone()
    train_base = con.execute("SELECT avg((cancelled OR delay_min >= 20)::INT) FROM train_events").fetchone()[0]
    runs, base_scored, brier, brier_base = con.execute(
        "SELECT count(*), avg(late20), avg((p - late20) ^ 2), avg((? - late20) ^ 2) FROM scored", [train_base]
    ).fetchone()
    buckets = [
        {"bucket": f"{b * 10}-{b * 10 + 10}%", "predicted_mean": round(pm, 4), "observed_rate": round(obs, 4), "n": n}
        for b, pm, obs, n in con.execute(
            "SELECT bucket, avg(p), avg(late20), count(*) FROM scored GROUP BY 1 ORDER BY 1").fetchall()
    ]
    assert sum(b["n"] for b in buckets) == runs
    result = {
        "train_period": {"from": TRAIN[0], "to": TRAIN[1]},
        "test_period": {"from": TEST[0], "to": TEST[1]},
        "threshold_min": 20,
        "min_training_runs_per_cell": MIN_TRAIN_RUNS,
        "cell": "train type + number, stop (EVA), weekday",
        "runs": runs,
        "test_arrivals_all": all_test,
        "coverage": round(runs / all_test, 4),
        "base_rate": round(base_all, 4),
        "base_rate_scored_runs": round(base_scored, 4),
        "base_rate_training": round(train_base, 4),
        "cancelled_share_test": round(cancel_share, 4),
        "brier": round(brier, 4),
        "brier_constant_base_rate": round(brier_base, 4),
        "brier_skill": round(1 - brier / brier_base, 4),
        "buckets": buckets,
        "note": "Late = arrival 20+ min after plan or cancelled at that stop. Odds are base rates, not a forecast.",
        "source": "piebro/deutsche-bahn-data (Hugging Face), CC BY 4.0",
        "built_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    out = ROOT / "data" / "backtest.json"
    out.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(result, indent=1, ensure_ascii=False))
    print(f"bucket n sum {sum(b['n'] for b in buckets)} == runs {runs}")


if __name__ == "__main__":
    main()
