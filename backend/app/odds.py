"""Odds of arriving 20+ min late, per leg and per connection (design D5, D6)."""

import os
import sqlite3
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import REPO_ROOT
from .matching import GE_COLUMNS, find_stats, parse_train

BERLIN = ZoneInfo("Europe/Berlin")
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
BUCKETS = (5, 10, 15, 20, 30, 45, 60, 90, 120)
CHANGE_MARGIN_MIN = 2
SHRINK_M = 50  # chosen on the training period by scripts/backtest.py


def odds_path() -> Path:
    path = Path(os.environ.get("SPAETKAUF_ODDS_PATH") or "data/odds.sqlite")
    return path if path.is_absolute() else REPO_ROOT / path


def open_odds(path: Path | None = None) -> sqlite3.Connection:
    path = path or odds_path()
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    conn.execute("SELECT 1 FROM train_stop_stats LIMIT 1")
    return conn


def _t(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def weekday(ts: str) -> int:
    """Weekday (0 = Monday) of a UTC timestamp in Berlin time, as in odds.sqlite."""
    return _t(ts).astimezone(BERLIN).weekday()


_SUMS = ", ".join(f"SUM({c})" for c in ("n", *GE_COLUMNS))


@lru_cache(maxsize=4)
def type_rates(conn: sqlite3.Connection) -> dict[str, dict[str, float]]:
    rows = conn.execute(f"SELECT train_type, {_SUMS} FROM train_stop_stats GROUP BY 1")
    return {t: {c: k / n for c, k in zip(GE_COLUMNS, ks)} for t, n, *ks in rows}


def leg_odds(conn: sqlite3.Connection, train: str, stop_name: str, arr: str) -> dict:
    """History of one leg at its alighting stop for the weekday of its scheduled arrival,
    plus the same train and stop on all weekdays (`parent`) and the type's rates for shrinkage."""
    parsed = parse_train(train)
    if parsed is None:
        return {"status": "no_train_number"}
    stats = find_stats(conn, parsed[0], parsed[1], stop_name, weekday(arr))
    if stats["status"] == "ok":
        row = conn.execute(
            f"SELECT {_SUMS} FROM train_stop_stats "
            "WHERE train_type = ? AND train_number = ? AND station_key = ?",
            (stats["train_type"], stats["train_number"], stats["station_key"]),
        ).fetchone()
        stats["parent"] = dict(zip(("n", *GE_COLUMNS), row))
        stats["type_rates"] = type_rates(conn)[stats["train_type"]]
    return stats


def bucket_at_or_below(minutes: float) -> int:
    """Nearest ge* threshold at or below `minutes`; below 5 min the finest bucket (ge5) is used."""
    return max((b for b in BUCKETS if b <= minutes), default=BUCKETS[0])


def shrink(k: float, n: float, p_parent: float, m: float) -> float:
    """Pull k of n toward p_parent as if m extra runs at the parent rate had been seen."""
    return (k + m * p_parent) / (n + m)


def shrunk_rate(k, n, parent_k, parent_n, type_rate, m) -> float:
    """Cell (train, stop, weekday) toward the same train and stop on all weekdays, which is
    itself pulled toward the train type's overall rate."""
    return shrink(k, n, shrink(parent_k, parent_n, type_rate, m), m)


def rate(stats: dict, threshold: int, m: float) -> float:
    col, parent = f"ge{threshold}", stats["parent"]
    return shrunk_rate(
        stats[col], stats["n"], parent[col], parent["n"], stats["type_rates"][col], m
    )


def connection_odds(conn: sqlite3.Connection, legs: list[dict], m: float | None = None) -> dict:
    """legs: [{train, to, dep, arr}] with scheduled UTC times, transit legs only, in order.

    Direct: share of runs 20+ late at the destination. With changes:
    p = 1 - prod(1 - p_miss_i) * (1 - p_last), where p_miss_i is the share of runs of leg i
    arriving later than the scheduled change time minus 2 min. p60 is the last leg's ge60 share only:
    a missed change rarely costs a full hour, so it is not folded in.
    Every share is shrunk (`shrunk_rate`, strength m); `late` and `n` stay raw counts.
    """
    m = SHRINK_M if m is None else m
    last = legs[-1]
    out = {"p20": None, "p60": None, "late": None, "n": None,
           "weekday": WEEKDAYS[weekday(last["arr"])], "basis": "none"}  # fmt: skip
    stats = [leg_odds(conn, leg["train"], leg["to"], leg["arr"]) for leg in legs]
    if any(s["status"] != "ok" for s in stats):
        return out
    reach = 1.0
    for leg, nxt, s in zip(legs, legs[1:], stats):
        change_min = (_t(nxt["dep"]) - _t(leg["arr"])).total_seconds() / 60
        reach *= 1 - rate(s, bucket_at_or_below(change_min - CHANGE_MARGIN_MIN), m)
    end = stats[-1]
    out.update(
        p20=round(1 - reach * (1 - rate(end, 20, m)), 4),
        p60=round(rate(end, 60, m), 4),
        late=end["ge20"],
        n=end["n"],
        basis="history" if len(legs) == 1 else "estimate",
    )
    return out
