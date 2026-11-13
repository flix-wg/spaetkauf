import asyncio

from app.board import refresh_board
from app.db import connect


def test_health_and_stations(client):
    h = client.get("/api/health").json()
    assert h["ok"] and h["plan_budget_left"] == 3
    s = client.get("/api/stations", params={"q": "Hamburg"}).json()
    assert s and all(set(x) == {"id", "name", "lat", "lon"} for x in s)
    assert [x["name"] for x in s] == ["Hamburg Hbf"]


def test_late_now_board_and_autotrack(client, settings):
    assert client.get("/api/late-now").json()["stale"] is True
    board = asyncio.run(refresh_board(client.app.state.transitous))
    got = client.get("/api/late-now").json()
    assert got["checked"] == board["checked"] > 0 and got["stale"] is False
    delays = [r["delay_min"] for r in got["late"]]
    assert delays == sorted(delays, reverse=True) and all(d >= 20 for d in delays)
    assert len({r["train"] for r in got["late"]}) == len(got["late"])
    assert set(got["late"][0]) == {"train", "station", "sched", "expected", "delay_min", "headsign"}

    conn = connect(settings.db_path)
    auto = conn.execute("SELECT id, secret_hash FROM trips WHERE auto = 1").fetchall()
    assert 1 <= len(auto) <= 3 and all(a["secret_hash"] is None for a in auto)
    assert client.get(f"/api/trips/{auto[0]['id']}", params={"secret": "x"}).status_code == 404
