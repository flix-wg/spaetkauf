import sqlite3

import pytest

from app.matching import find_stats, parse_train, station_key


def test_parse_train():
    assert parse_train("ICE 785") == ("ICE", "785")
    assert parse_train("ec 08") == ("EC", "8")
    assert parse_train("FLX10") is None  # FlixTrain line name, no train number
    assert parse_train("") is None


@pytest.mark.parametrize(
    "live, history",
    [
        ("S+U Berlin Hauptbahnhof", "Berlin Hbf"),
        ("Kassel Bahnhof Wilhelmshöhe", "Kassel-Wilhelmshöhe"),
        ("Frankfurt (Main) Flughafen Fernbahnhof", "Frankfurt am Main Flughafen Fernbahnhof"),
        ("Mannheim, Hauptbahnhof", "Mannheim Hbf"),
    ],
)
def test_station_key_live_equals_history(live, history):
    assert station_key(live) == station_key(history)


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.execute(
        "CREATE TABLE train_stop_stats (train_type, train_number, eva, station_name, station_key, weekday, n, "
        "n_cancel, ge5, ge10, ge15, ge20, ge30, ge45, ge60, ge90, ge120, first_date, last_date)"
    )
    rows = [
        ("ICE", "785", "08000261", "München Hbf", 4, 30, 2, 25, 22, 20, 19, 10, 6, 5, 3, 2),
        ("ICE", "785", "08000183", "Ingolstadt Hbf", 4, 5, 0, 3, 2, 1, 1, 0, 0, 0, 0, 0),
        ("ECE", "8", "08002549", "Hamburg Hbf", 5, 40, 4, 20, 15, 12, 10, 8, 6, 5, 4, 4),
        ("ICE", "500", "08011160", "Berlin Hbf", 0, 8, 1, 4, 3, 2, 2, 1, 1, 1, 1, 1),
        ("ICE", "500", "08098160", "Berlin Hauptbahnhof", 0, 6, 0, 3, 2, 1, 1, 1, 0, 0, 0, 0),
    ]
    c.executemany(
        "INSERT INTO train_stop_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
        "'2025-12-19', '2026-10-30')",
        [(*r[:4], station_key(r[3]), *r[4:]) for r in rows],
    )
    return c


def test_find_stats_statuses(conn):
    hit = find_stats(conn, "ICE", "785", "München Hbf", 4)
    assert (hit["status"], hit["n"], hit["ge20"]) == ("ok", 30, 19)
    assert find_stats(conn, "ICE", "785", "Ingolstadt Hbf", 4)["status"] == "thin"
    assert find_stats(conn, "ICE", "785", "Nürnberg Hbf", 4)["status"] == "stop_not_matched"
    assert find_stats(conn, "ICE", "999", "München Hbf", 4)["status"] == "unknown_train"
    assert (
        find_stats(conn, "ICE", "8", "Hamburg Hbf", 5)["status"] == "unknown_train"
    )  # ICE/ECE are not one family


def test_find_stats_family_fallback_and_eva_sum(conn):
    ec = find_stats(conn, "EC", "8", "Hamburg Hbf", 5)
    assert (ec["status"], ec["train_type"], ec["type_fallback"]) == ("ok", "ECE", True)
    berlin = find_stats(conn, "ICE", "500", "S+U Berlin Hauptbahnhof", 0)
    assert (berlin["status"], berlin["n"], berlin["ge20"]) == ("ok", 14, 3)
