# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.1"]
# ///
"""Task 2.4: odds from an earlier period against outcomes in a later one, by 10-point bucket.

Scores the plain cell rate and the shrunk rate (backend/app/odds.py `shrunk_rate`) on the same
split. The shrinkage strength m is chosen on the training period only: cells from Dec-Jul,
scored on August.

uv run scripts/backtest.py   (needs data/raw from build_odds.py)
"""

import json
import math
import sys
from datetime import UTC, datetime
from pathlib import Path

import duckdb

sys.path[:0] = [str(Path(__file__).parent), str(Path(__file__).resolve().parent.parent / "backend")]
from app.odds import shrunk_rate
from build_odds import ROOT, download, load_events

MONTHS = ["2025-12"] + [f"2026-{m:02d}" for m in range(1, 11)]  # the backtest keeps its fixed periods

TRAIN = ("2025-12-14", "2026-08-31")
HOLDOUT_FROM = "2026-08-01"
TEST = ("2026-09-01", "2026-10-31")
MIN_TRAIN_RUNS = 10
M_GRID = (0, 5, 10, 15, 20, 30, 50, 80)
KEY = "train_type, train_number, eva, weekday"


def scored_cells(con, cells_from: str, cells_where: str, outcomes: str) -> list[tuple]:
    """Per cell with >= MIN_TRAIN_RUNS: (k, n, parent_k, parent_n, type_rate, test_n, test_late)."""
    return con.execute(f"""
        WITH c AS (SELECT {KEY}, count(*) AS n, sum(late20) AS k
                   FROM {cells_from} WHERE {cells_where} GROUP BY ALL),
             par AS (SELECT train_type, train_number, eva, sum(n) AS pn, sum(k) AS pk
                     FROM c GROUP BY ALL),
             typ AS (SELECT train_type, sum(k) / sum(n) AS tr FROM c GROUP BY ALL),
             o AS (SELECT {KEY}, count(*) AS tn, sum(late20) AS tk FROM {outcomes} GROUP BY ALL)
        SELECT c.k, c.n, par.pk, par.pn, typ.tr, o.tn, o.tk
        FROM c JOIN par USING (train_type, train_number, eva) JOIN typ USING (train_type)
        JOIN o USING (train_type, train_number, eva, weekday)
        WHERE c.n >= {MIN_TRAIN_RUNS}
    """).fetchall()


def evaluate(rows: list[tuple], m: float | None) -> dict:
    """m None = plain k / n."""
    total = sum(r[5] for r in rows)
    err, buckets = 0.0, {}
    for k, n, pk, pn, tr, tn, tk in rows:
        p = k / n if m is None else shrunk_rate(k, n, pk, pn, tr, m)
        err += tk * (1 - p) ** 2 + (tn - tk) * p**2
        b = buckets.setdefault(min(math.floor(p * 10 + 1e-9), 9), [0.0, 0, 0])
        b[0] += p * tn
        b[1] += tk
        b[2] += tn
    out = [
        {"bucket": f"{b * 10}-{b * 10 + 10}%", "predicted_mean": round(s / tn, 4),
         "observed_rate": round(tk / tn, 4), "n": tn}
        for b, (s, tk, tn) in sorted(buckets.items())
    ]
    assert sum(b["n"] for b in out) == total
    return {"brier": err / total, "runs": total, "buckets": out}


def with_late(con, name: str) -> None:
    con.execute(f"CREATE TABLE {name} AS SELECT *, (cancelled OR delay_min >= 20)::INT AS late20 "
                "FROM events")


def main() -> None:
    files = download(dict.fromkeys(MONTHS))
    con = duckdb.connect()
    load_events(con, files, *TRAIN)
    with_late(con, "train_events")
    load_events(con, files, *TEST)
    with_late(con, "test_events")

    fit = f"planned < TIMESTAMP '{HOLDOUT_FROM}'"
    holdout = f"(SELECT * FROM train_events WHERE NOT ({fit}))"
    hold_rows = scored_cells(con, "train_events", fit, holdout)
    selection = {"plain": round(evaluate(hold_rows, None)["brier"], 5)}
    selection |= {str(m): round(evaluate(hold_rows, m)["brier"], 5) for m in M_GRID}
    best_m = min(M_GRID, key=lambda m: selection[str(m)])
    print(f"holdout (cells to {HOLDOUT_FROM}, scored on August) Brier by m: {selection}; m = {best_m}")

    rows = scored_cells(con, "train_events", "TRUE", "test_events")
    plain, shrunk = evaluate(rows, None), evaluate(rows, best_m)
    all_test, base_all, cancel_share = con.execute(
        "SELECT count(*), avg(late20), avg(cancelled::INT) FROM test_events").fetchone()
    train_base = con.execute("SELECT avg(late20) FROM train_events").fetchone()[0]
    base_scored = sum(r[6] for r in rows) / plain["runs"]
    brier_base = sum(r[6] * (1 - train_base) ** 2 + (r[5] - r[6]) * train_base**2
                     for r in rows) / plain["runs"]
    use_shrunk = shrunk["brier"] < plain["brier"]
    used = shrunk if use_shrunk else plain
    method = "plain: k / n per train, stop and weekday"
    if use_shrunk:
        method = (f"shrunk: (k + m * p_parent) / (n + m), m = {best_m}, parent = same train and "
                  "stop on all weekdays, itself shrunk toward the train type's rate")
    selection_info = {"fit": [TRAIN[0], "2026-07-31"], "holdout": [HOLDOUT_FROM, TRAIN[1]],
                      "brier_by_m": selection}
    plain_info = {"brier": round(plain["brier"], 4),
                  "brier_skill": round(1 - plain["brier"] / brier_base, 4), "buckets": plain["buckets"]}
    result = {
        "train_period": {"from": TRAIN[0], "to": TRAIN[1]},
        "test_period": {"from": TEST[0], "to": TEST[1]},
        "threshold_min": 20,
        "min_training_runs_per_cell": MIN_TRAIN_RUNS,
        "cell": "train type + number, stop (EVA), weekday",
        "runs": used["runs"],
        "test_arrivals_all": all_test,
        "coverage": round(used["runs"] / all_test, 4),
        "base_rate": round(base_all, 4),
        "base_rate_scored_runs": round(base_scored, 4),
        "base_rate_training": round(train_base, 4),
        "cancelled_share_test": round(cancel_share, 4),
        "brier": round(used["brier"], 4),
        "brier_constant_base_rate": round(brier_base, 4),
        "brier_skill": round(1 - used["brier"] / brier_base, 4),
        "buckets": used["buckets"],
        "method": method,
        "shrinkage_m": best_m if use_shrunk else None,
        "m_selection": selection_info,
        "plain": plain_info,
        "note": "Late = arrival 20+ min after plan or cancelled at that stop. Odds are base rates, not a forecast.",
        "source": "piebro/deutsche-bahn-data (Hugging Face), CC BY 4.0",
        "built_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    print(json.dumps(result, indent=1, ensure_ascii=False))
    print(f"shrunk m={best_m}: Brier {shrunk['brier']:.5f} vs plain {plain['brier']:.5f}")
    for a, b in zip(plain["buckets"], shrunk["buckets"]):
        print(f"{a['bucket']:>8} plain {a['predicted_mean']:.3f}->{a['observed_rate']:.3f} "
              f"({a['n']:>6})  shrunk {b['predicted_mean']:.3f}->{b['observed_rate']:.3f} ({b['n']:>6})")
    out = ROOT / "data" / "backtest.json"
    if "--write" in sys.argv:
        out.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
