import sqlite3

import pytest

from app.matching import GE_COLUMNS, station_key
from app.odds import connection_odds, shrink

COLUMNS = ("train_type", "train_number", "eva", "station_name", "station_key", "weekday", "n",
           "n_cancel", *GE_COLUMNS, "first_date", "last_date")  # fmt: skip


def odds_db(path, rows: list[dict]) -> sqlite3.Connection:
    """rows: {train, stop, weekday, n, plus any ge*/n_cancel}; missing ge* default to 0."""
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute(f"CREATE TABLE train_stop_stats ({', '.join(COLUMNS)})")
    for r in rows:
        kind, number = r["train"].split()
        values = {"train_type": kind, "train_number": number, "eva": r.get("eva", "1"),
                  "station_name": r["stop"], "station_key": station_key(r["stop"]),
                  "first_date": "2025-12-14", "last_date": "2026-10-31", "n_cancel": 0,
                  **{c: 0 for c in GE_COLUMNS}, **r}  # fmt: skip
        conn.execute(f"INSERT INTO train_stop_stats VALUES ({','.join('?' * len(COLUMNS))})",
                     [values[c] for c in COLUMNS])  # fmt: skip
    conn.commit()
    return conn


@pytest.fixture
def conn(tmp_path):
    return odds_db(tmp_path / "odds.sqlite", [
        {"train": "ICE 785", "stop": "München Hbf", "weekday": 4, "n": 30, "n_cancel": 2,
         "ge10": 22, "ge20": 19, "ge60": 5},
        {"train": "ICE 1", "stop": "Fulda", "weekday": 4, "n": 20, "ge5": 8, "ge10": 4, "ge20": 2},
        {"train": "ICE 2", "stop": "München Hbf", "weekday": 4, "n": 20, "ge20": 5, "ge60": 1},
        {"train": "ICE 2", "stop": "München Hbf", "weekday": 0, "n": 20, "ge20": 15},
        {"train": "ICE 3", "stop": "München Hbf", "weekday": 4, "n": 8, "ge20": 6},
        {"train": "IC 4", "stop": "Köln Hbf", "weekday": 4, "n": 10, "n_cancel": 3, "ge20": 3},
    ])  # fmt: skip


def leg(train, to, dep, arr):
    return {"train": train, "to": to, "dep": dep, "arr": arr}


def test_direct_uses_destination_weekday_in_berlin_time(conn):
    # 23:30 UTC on Thursday is Friday 00:30 in Berlin
    odds = connection_odds(conn, [leg("ICE 785", "München Hbf", "2026-11-12T17:00:00Z",
                                      "2026-11-12T23:30:00Z")], m=0)  # fmt: skip
    assert odds == {"p20": 0.6333, "p60": 0.1667, "late": 19, "n": 30, "weekday": "Friday",
                    "basis": "history"}  # fmt: skip


def test_cancelled_runs_count_as_late(conn):
    odds = connection_odds(conn, [leg("IC 4", "Köln Hbf", "2026-11-13T08:00:00Z",
                                      "2026-11-13T12:00:00Z")], m=0)  # fmt: skip
    assert (odds["p20"], odds["late"], odds["n"]) == (0.3, 3, 10)


def test_one_change_combines_missed_change_and_last_leg(conn):
    legs = [
        leg("ICE 1", "Fulda", "2026-11-13T08:00:00Z", "2026-11-13T09:00:00Z"),
        leg("ICE 2", "München Hbf", "2026-11-13T09:12:00Z", "2026-11-13T12:00:00Z"),
    ]
    odds = connection_odds(conn, legs, m=0)
    # 12 min change - 2 min margin -> ge10 of ICE 1: 4/20; last leg 5/20
    assert odds["p20"] == pytest.approx(1 - 0.8 * 0.75)
    assert (odds["late"], odds["n"], odds["basis"]) == (5, 20, "estimate")
    legs[1]["dep"] = "2026-11-13T09:05:00Z"  # 3 min below the finest bucket uses ge5
    assert connection_odds(conn, legs, m=0)["p20"] == pytest.approx(1 - 0.6 * 0.75)


def test_thin_or_unmatched_leg_gives_no_numbers(conn):
    none = {"p20": None, "p60": None, "late": None, "n": None, "weekday": "Friday", "basis": "none"}
    thin = leg("ICE 3", "München Hbf", "2026-11-13T08:00:00Z", "2026-11-13T12:00:00Z")
    assert connection_odds(conn, [thin]) == none
    flix = leg("FLX10", "Fulda", "2026-11-13T08:00:00Z", "2026-11-13T09:00:00Z")
    good = leg("ICE 2", "München Hbf", "2026-11-13T09:30:00Z", "2026-11-13T12:00:00Z")
    assert connection_odds(conn, [flix, good]) == none


def test_shrinks_toward_all_weekdays_then_train_type(conn):
    odds = connection_odds(conn, [leg("ICE 2", "München Hbf", "2026-11-13T08:00:00Z",
                                      "2026-11-13T12:00:00Z")], m=50)  # fmt: skip
    ice = (19 + 2 + 5 + 15 + 6) / (30 + 20 + 20 + 20 + 8)
    assert odds["p20"] == pytest.approx(shrink(5, 20, shrink(20, 40, ice, 50), 50), abs=1e-4)
    assert 5 / 20 < odds["p20"] < 20 / 40 and (odds["late"], odds["n"]) == (5, 20)
