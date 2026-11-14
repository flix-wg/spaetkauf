import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.history import EPOCH
from app.main import create_app
from app.matching import station_key

# 2026-11-07 and 2026-11-14 are Saturdays, 2026-11-13 a Friday
RUNS = [
    ("2026-11-07", 600, 25),
    ("2026-11-13", 605, 3),
    ("2026-11-14", 610, None),
    ("2026-11-14", 1300, 130),
]


def history_db(path):
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE trains (id INTEGER PRIMARY KEY, train_type TEXT, train_number TEXT);
        CREATE TABLE stops (id INTEGER PRIMARY KEY, eva TEXT, station_key TEXT, name TEXT);
        CREATE TABLE legs (id INTEGER PRIMARY KEY, train_id INTEGER, stop_id INTEGER);
        CREATE TABLE runs (leg_id, day, planned_min, delay_min);
        INSERT INTO trains VALUES (1, 'ICE', '1103');
        INSERT INTO stops VALUES (1, '8000261', 'muenchen', 'München Hbf'), (2, '8000105', 'frankfurt main', 'Frankfurt(Main)Hbf');
        INSERT INTO legs VALUES (1, 1, 1), (2, 1, 2);
    """)
    assert station_key("München Hbf") == "muenchen"
    for d, minute, delay in RUNS:
        db.execute(
            "INSERT INTO runs VALUES (1, ?, ?, ?)",
            ((date.fromisoformat(d) - EPOCH).days, minute, delay),
        )
    db.execute("INSERT INTO runs VALUES (2, ?, 500, 0)", ((date(2026, 11, 14) - EPOCH).days,))
    db.commit()
    db.close()


@pytest.fixture
def client(tmp_path, monkeypatch):
    history_db(tmp_path / "history.sqlite")
    monkeypatch.setenv("SPAETKAUF_HISTORY_PATH", str(tmp_path / "history.sqlite"))
    with TestClient(create_app(Settings.from_env())) as c:
        yield c


def test_runs_for_weekday_newest_first_with_summary(client):
    body = client.get(
        "/api/history", params={"train": "ICE 1103", "stop": "Muenchen Hauptbahnhof", "weekday": 5}
    ).json()
    assert [(r["date"], r["delay_min"], r["cancelled"]) for r in body["runs"]] == [
        ("2026-11-14", 130, False), ("2026-11-14", None, True), ("2026-11-07", 25, False)]  # fmt: skip
    assert body["runs"][0]["planned"] == "2026-11-14T21:40:00+01:00"
    assert body["summary"] == {"n": 3, "late20": 3, "late60": 2, "late120": 2, "cancelled": 1}
    assert (body["train"], body["stop"], body["weekday"]) == ("ICE 1103", "München Hbf", "Saturday")
    stops = client.get("/api/history/train", params={"train": "ice 1103"}).json()["stops"]
    assert [(s["stop"], s["n"], s["late20"]) for s in stops] == [
        ("Frankfurt(Main)Hbf", 1, 0),
        ("München Hbf", 4, 3),
    ]


def test_unknown_train_and_stop_are_404_with_hint(client):
    assert client.get("/api/history", params={"train": "ICE 9", "stop": "Köln"}).status_code == 404
    r = client.get("/api/history", params={"train": "ICE 1103", "stop": "Hamburg"})
    assert r.status_code == 404 and "München Hbf" in r.json()["detail"]


def test_missing_file_is_503_and_app_starts(tmp_path, monkeypatch):
    monkeypatch.setenv("SPAETKAUF_HISTORY_PATH", str(tmp_path / "none.sqlite"))
    with TestClient(create_app(Settings.from_env())) as c:
        assert c.get("/api/health").status_code == 200
        assert c.get("/api/history", params={"train": "ICE 1", "stop": "x"}).status_code == 503


def test_real_history_matches_odds_aggregate():
    from app.history import history_path
    from app.odds import odds_path

    if not (history_path().exists() and odds_path().exists()):
        pytest.skip("data/history.sqlite or data/odds.sqlite not built")
    odds, hist = sqlite3.connect(odds_path()), sqlite3.connect(history_path())
    tt, tn, key, wd, n, ge20 = odds.execute(
        "SELECT train_type, train_number, station_key, weekday, sum(n), sum(ge20) FROM train_stop_stats "
        "GROUP BY 1, 2, 3, 4 ORDER BY sum(n) DESC LIMIT 1").fetchone()  # fmt: skip
    got = hist.execute(
        "SELECT count(*), sum(r.delay_min IS NULL OR r.delay_min >= 20) FROM runs r "
        "JOIN legs l ON l.id = r.leg_id JOIN trains t ON t.id = l.train_id JOIN stops s ON s.id = l.stop_id "
        "WHERE t.train_type = ? AND t.train_number = ? AND s.station_key = ? AND (r.day + 3) % 7 = ?",
        (tt, tn, key, wd)).fetchone()  # fmt: skip
    assert got == (n, ge20)
