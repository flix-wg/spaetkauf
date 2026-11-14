import sqlite3

import duckdb
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

# 2026-11-07 and 2026-11-14 are Saturdays, 2026-11-13 a Friday.
# ICE 1103 runs Frankfurt (dep) -> Muenchen (arr); run 3 is cancelled at Muenchen, run 4 is 130 min late.
# (run id, day, minute of day at Muenchen, delay, cancelled)
MUC = [(1, "2026-11-07", 600, 25, False), (2, "2026-11-13", 605, 3, False),
       (3, "2026-11-14", 610, None, True), (4, "2026-11-14", 1300, 130, False)]  # fmt: skip


def history_db(path):
    db = duckdb.connect(str(path))
    db.execute("""
        CREATE TABLE trains (id USMALLINT, train_type VARCHAR, train_number VARCHAR);
        CREATE TABLE stops (id USMALLINT, eva VARCHAR, station_key VARCHAR, name VARCHAR);
        CREATE TABLE events (train_id USMALLINT, stop_id USMALLINT, day DATE, run_id UINTEGER, seq SMALLINT,
            arr_planned TIMESTAMP, arr_delay SMALLINT, arr_cancelled BOOLEAN,
            dep_planned TIMESTAMP, dep_delay SMALLINT, dep_cancelled BOOLEAN);
        CREATE TABLE meta (key VARCHAR, value VARCHAR);
        INSERT INTO meta VALUES ('date_from', '2025-12-14'), ('date_to', '2026-12-31');
        INSERT INTO trains VALUES (1, 'ICE', '1103'), (2, 'IC', '2000');
        INSERT INTO stops VALUES (1, '8000105', 'frankfurt main', 'Frankfurt(Main)Hbf'),
                                 (2, '8000261', 'muenchen', 'München Hbf');
    """)
    for run, day, minute, delay, cancelled in MUC:
        planned = f"{day} {minute // 60:02d}:{minute % 60:02d}:00"
        db.execute("INSERT INTO events VALUES (1, 1, ?, ?, 1, NULL, NULL, false, ?::TIMESTAMP - INTERVAL 3 HOUR, 0, false)",
                   [day, run, planned])  # fmt: skip
        db.execute("INSERT INTO events VALUES (1, 2, ?, ?, 2, ?, ?, ?, NULL, NULL, false)",
                   [day, run, planned, delay, cancelled])  # fmt: skip
    # another train ends in Frankfurt and never reaches Muenchen after it
    db.execute(
        "INSERT INTO events VALUES (2, 2, '2026-11-14', 9, 1, NULL, NULL, false, '2026-11-14 08:00', 0, false)"
    )
    db.execute(
        "INSERT INTO events VALUES (2, 1, '2026-11-14', 9, 2, '2026-11-14 10:00', 5, false, NULL, NULL, false)"
    )
    db.close()


@pytest.fixture
def client(tmp_path, monkeypatch):
    history_db(tmp_path / "history.duckdb")
    monkeypatch.setenv("SPAETKAUF_HISTORY_PATH", str(tmp_path / "history.duckdb"))
    with TestClient(create_app(Settings.from_env())) as c:
        yield c


def test_runs_for_weekday_newest_first_with_summary(client):
    params = {"train": "ICE 1103", "stop": "Muenchen Hauptbahnhof", "weekday": 5}
    body = client.get("/api/history", params=params).json()
    assert [(r["date"], r["delay_min"], r["cancelled"]) for r in body["runs"]] == [
        ("2026-11-14", 130, False), ("2026-11-14", None, True), ("2026-11-07", 25, False)]  # fmt: skip
    assert body["runs"][0]["planned"] == "2026-11-14T21:40:00+01:00"
    assert body["summary"] == {"n": 3, "late20": 3, "late60": 2, "late120": 2, "cancelled": 1}
    assert (body["train"], body["stop"], body["weekday"]) == ("ICE 1103", "München Hbf", "Saturday")
    stops = client.get("/api/history/train", params={"train": "ice 1103"}).json()["stops"]
    assert [(s["stop"], s["n"], s["late20"]) for s in stops] == [("München Hbf", 4, 3)]


def test_stop_board_and_route(client):
    board = client.get("/api/history/stop", params={"stop": "München", "date": "2026-11-14"}).json()
    assert [(a["train"], a["delay_min"]) for a in board["arrivals"]] == [
        ("ICE 1103", None),
        ("ICE 1103", 130),
    ]
    route = client.get(
        "/api/history/route", params={"from": "Frankfurt", "to": "München Hbf"}
    ).json()
    assert route["trains"] == [{"train": "ICE 1103", "n": 4, "dep": "07:07", "arr": "10:07",
                                "late20": 3, "late20_share": 0.75, "late60": 2, "late60_share": 0.5,
                                "median_delay_min": 25.0}]  # fmt: skip
    back = client.get(
        "/api/history/route", params={"from": "München", "to": "Frankfurt", "weekday": 5}
    )
    assert [t["train"] for t in back.json()["trains"]] == ["IC 2000"]  # the direction matters


def test_unknown_train_stop_and_date_are_404_with_hint(client):
    assert client.get("/api/history", params={"train": "ICE 9", "stop": "Köln"}).status_code == 404
    r = client.get("/api/history", params={"train": "ICE 1103", "stop": "Hamburg"})
    assert r.status_code == 404 and "München Hbf" in r.json()["detail"]
    r = client.get("/api/history/stop", params={"stop": "München", "date": "2020-01-01"})
    assert r.status_code == 404 and "2025-12-14" in r.json()["detail"]


def test_missing_file_is_503_and_app_starts(tmp_path, monkeypatch):
    monkeypatch.setenv("SPAETKAUF_HISTORY_PATH", str(tmp_path / "none.duckdb"))
    with TestClient(create_app(Settings.from_env())) as c:
        assert c.get("/api/health").status_code == 200
        assert c.get("/api/history", params={"train": "ICE 1", "stop": "x"}).status_code == 503


def test_real_history_matches_odds_aggregate():
    from app.history import history_path, open_history
    from app.odds import odds_path

    if not (history_path().exists() and odds_path().exists()):
        pytest.skip("data/history.duckdb or data/odds.sqlite not built")
    tt, tn, key, wd, n, ge20 = sqlite3.connect(odds_path()).execute(
        "SELECT train_type, train_number, station_key, weekday, sum(n), sum(ge20) FROM train_stop_stats "
        "GROUP BY 1, 2, 3, 4 ORDER BY sum(n) DESC LIMIT 1").fetchone()  # fmt: skip
    got = open_history().execute(
        "SELECT count(*), sum((e.arr_cancelled OR e.arr_delay >= 20)::INT) FROM events e "
        "JOIN trains t ON t.id = e.train_id JOIN stops s ON s.id = e.stop_id WHERE e.arr_planned IS NOT NULL "
        "AND t.train_type = ? AND t.train_number = ? AND s.station_key = ? AND isodow(e.day) - 1 = ?",
        [tt, tn, key, wd]).fetchone()  # fmt: skip
    assert tuple(got) == (n, ge20)
