import sqlite3
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_odds import odds_db

from app import odds, picks
from app.db import connect, init_db
from app.odds import BERLIN
from app.signals import ensure_schema
from app.transitous import Transitous

DAY = (datetime.now(BERLIN) + timedelta(days=7)).date()
MUC = "de-DELFI_de:09162:100"


def at(hhmm: str) -> str:
    h, m = map(int, hhmm.split(":"))
    return datetime(DAY.year, DAY.month, DAY.day, h, m, tzinfo=BERLIN).isoformat()


def itin(*legs, delay=0):
    """legs: (train, to, dep, arr) in local HH:MM; delay = live delay of the last leg."""
    out = [{"mode": "WALK", "from": {"name": "START"}, "to": {"name": "Hamburg Hbf"}}]
    for i, (train, to, dep, arr) in enumerate(legs):
        last = i == len(legs) - 1
        end = {"name": to, "scheduledArrival": at(arr), "arrival": at(arr)}
        if last and delay:
            live = datetime.fromisoformat(at(arr)) + timedelta(minutes=delay)
            end["arrival"] = live.isoformat()
        out.append({"mode": "HIGHSPEED_RAIL", "tripId": f"{train}-{dep}", "routeShortName": train,
                    "realTime": bool(delay), "from": {"name": "Hamburg Hbf"}, "to": end,
                    "scheduledStartTime": at(dep), "scheduledEndTime": at(arr)})  # fmt: skip
    return {"startTime": at(legs[0][2]), "legs": out}


def plan_pages(pages, cursor="nextPageCursor"):
    def handler(request: httpx.Request) -> httpx.Response:
        path, params = request.url.path, request.url.params
        handler.calls.append(path)
        handler.params.append(dict(params))
        if path.endswith("/geocode"):
            hit = {"type": "STOP", "id": "de-DELFI_de:02000:10950", "name": "Hamburg Hbf",
                   "lat": 53.55, "lon": 10.0, "modes": ["HIGHSPEED_RAIL"]}  # fmt: skip
            return httpx.Response(200, json=[hit] if params["text"] == "Hamburg Hbf" else [])
        page = int(params.get("pageCursor", "0"))
        body = {"from": {"name": "Hamburg Hbf"}, "to": {"name": "München Hbf"},
                "itineraries": pages[page]}  # fmt: skip
        if page + 1 < len(pages):
            body[cursor] = str(page + 1)
        return httpx.Response(200, json=body)

    handler.calls, handler.params = [], []
    return handler


@pytest.fixture
def make_client(settings, tmp_path, monkeypatch):
    monkeypatch.setattr(odds, "SHRINK_M", 0)
    init_db(settings.db_path)
    wd = DAY.weekday()
    rows = [{"train": t, "stop": "München Hbf", "weekday": wd, "n": 20, "ge20": k, "ge30": k30,
             "ge60": 1} for t, k, k30 in (("ICE 1", 12, 6), ("ICE 2", 10, 0), ("ICE 3", 4, 0))]  # fmt: skip

    def make(handler):
        app = FastAPI()
        app.state.transitous = Transitous(settings, httpx.MockTransport(handler))
        app.state.odds = odds_db(tmp_path / "odds.sqlite", rows)
        app.include_router(picks.router)
        return TestClient(app)

    return make


def get(client, **params):
    return client.get("/api/picks", params={"from": "Hamburg Hbf", "to": MUC,
                                            "date": DAY.isoformat(), "time": "07:00", **params})  # fmt: skip


def test_ranking_kurts_pick_ride_instead_and_already_posted(make_client):
    handler = plan_pages([
        [itin(("ICE 1", "München Hbf", "08:00", "12:00"), delay=25),
         itin(("ICE 2", "München Hbf", "09:00", "13:00")),
         itin(("ICE 3", "Hauptbahnhof", "09:30", "12:50")),
         itin(("ICE 4", "München Hbf", "10:00", "12:55"))],
        [itin(("FLX10", "München Hbf", "10:00", "14:00")),
         itin(("TGV 9", "München Hbf", "09:10", "12:30")),
         itin(("ICE 9554", "München Hbf", "09:20", "12:20"))],
    ])  # fmt: skip
    body = get(make_client(handler)).json()
    assert handler.calls.count("/api/v1/plan") == 2
    assert (body["from"], body["to"], body["tz"]) == ("Hamburg Hbf", "München Hbf", "Europe/Berlin")
    trains = [p["legs"][0]["train"] for p in body["picks"]]
    assert trains == ["ICE 1", "ICE 2", "ICE 3", "TGV 9", "ICE 9554", "ICE 4", "FLX10"]
    first, second, third = body["picks"][:3]
    assert first["already_posted"] and not first["is_kurts_pick"]
    assert second["is_kurts_pick"] and sum(p["is_kurts_pick"] for p in body["picks"]) == 1
    assert second["odds"] == {"p20": 0.5, "p60": 0.05, "late": 10, "n": 20,
                              "weekday": DAY.strftime("%A"), "basis": "history"}  # fmt: skip
    # the TGV and ICE 9554 arrive earlier but need a reservation; ICE 1 left before the booked train
    assert second["ride_instead"]["trains"] == ["ICE 3"]
    assert second["ride_instead"]["delta_arr_min"] == -10
    # ICE 3 has a ride-instead but only 20 % odds: below KURT_MIN_P20, so it is not highlighted
    assert third["ride_instead"]["trains"] == ["ICE 4"] and not third["is_kurts_pick"]
    assert third["legs"][0]["to"] == "München Hbf" and third["odds"]["p20"] == 0.2
    assert len(second["legs"]) == 1 and second["changes"] == 0
    assert second["bahn_url"].startswith("https://www.bahn.de/buchung/fahrplan/suche#sts=true")
    assert (
        "so=Hamburg%20Hbf&zo=M%C3%BCnchen%20Hbf&hd=" + DAY.isoformat() + "T09:00:00"
        in (second["bahn_url"])
    )
    assert body["note"] == "4 of 7 connections have too little history for odds" \
        " (no history for FlixTrain legs)."  # fmt: skip


def test_no_alternative_and_unknown_station(make_client):
    client = make_client(plan_pages([[itin(("ICE 3", "München Hbf", "09:30", "12:50"))]]))
    (only,) = get(client).json()["picks"]
    assert only["ride_instead"] is None and not only["is_kurts_pick"]  # 20 %: nothing qualifies
    missing = get(client, **{"from": "Nowhere"})
    assert missing.status_code == 404 and "Nowhere" in missing.json()["detail"]


def test_arrive_mode_groups_bounds_and_kurts_pick(make_client):
    m = "München Hbf"
    handler = plan_pages([
        [itin(("ICE 1", m, "08:30", "12:30")), itin(("ICE 4", m, "08:40", "12:40")),
         itin(("ICE 3", m, "09:00", "12:57")), itin(("ICE 5", m, "09:30", "13:10"))],
        [itin(("ICE 6", m, "06:00", "09:50")), itin(("ICE 2", m, "07:00", "11:00"))],
    ], cursor="previousPageCursor")  # fmt: skip
    client = make_client(handler)
    body = get(client, mode="arrive", time="13:00").json()
    plans = [q for q in handler.params if "fromPlace" in q]
    assert [(q["arriveBy"], q.get("pageCursor")) for q in plans] == [("true", None), ("true", "1")]
    assert body["mode"] == "arrive" and body["kurt_call"] == "pick"
    noon = datetime.fromisoformat(at("13:00")).astimezone(UTC)
    assert body["arrive_by"] == noon.strftime("%Y-%m-%dT%H:%M:%SZ")
    # ICE 5 arrives after T, ICE 6 before the 3 h window
    got = [(p["legs"][0]["train"], p["group"], p["spare_min"], p["p_miss"]) for p in body["picks"]]
    assert got == [
        ("ICE 2", "late_ok", 120, 0.0),  # p_miss from ge120
        ("ICE 1", "late_ok", 30, 0.3),  # ge30 = 6 of 20: above the cap
        ("ICE 4", "late_ok", 20, None),  # no history
        ("ICE 3", "on_time", 3, 1.0),  # under 5 min spare
    ]
    # ICE 1 has the highest p20 but misses T too often, so Kurt picks ICE 2
    assert [p["is_kurts_pick"] for p in body["picks"]] == [True, False, False, False]
    assert body["picks"][0]["late_ok"] == {"unlock": True, "refund25": True, "refund50": True}
    assert body["picks"][1]["late_ok"] == {"unlock": True, "refund25": False, "refund50": False}
    assert get(client, mode="arrive", time="").status_code == 400


def add_change(db_path, title: str) -> None:
    conn = connect(db_path)
    ensure_schema(conn)
    with conn:
        conn.execute(
            "INSERT INTO context_changes(id, source, url, title, summary, changed_at) "
            "VALUES ('c1', 'gdl.de', 'https://www.gdl.de/presse/x', ?, '', ?)",
            (title, datetime.now(UTC).isoformat(timespec="seconds")),
        )
    conn.close()


@pytest.mark.parametrize(
    "trains, title, call",
    [
        (["ICE 2", "ICE 3"], None, "pick"),
        (["ICE 3"], None, "none"),
        (["ICE 2", "ICE 3"], f"GDL: Streik am {DAY:%d.%m.%Y}", "strike"),
        (["ICE 2", "ICE 3"], "GDL kündigt Streiks an", "strike_unclear"),
    ],
)
def test_kurt_call_follows_strike_announcements(make_client, settings, trains, title, call):
    times = {"ICE 2": ("09:00", "13:00"), "ICE 3": ("09:30", "12:50")}
    client = make_client(plan_pages([[itin((t, "München Hbf", *times[t])) for t in trains]]))
    if title:
        add_change(settings.db_path, title)
    body = get(client).json()
    assert body["kurt_call"] == call
    kurts = [p["legs"][0]["train"] for p in body["picks"] if p["is_kurts_pick"]]
    assert kurts == ([] if call in ("none", "strike") else ["ICE 2"])
    assert [p["odds"]["p20"] for p in body["picks"]] == [0.5, 0.2][-len(trains) :]
    strike = body["strike"]
    if call == "strike":
        assert strike["dates"] == [DAY.isoformat()] and strike["covers_date"]
        assert strike["try_date"] == (DAY - timedelta(days=1)).isoformat()
        assert "past-run odds do not cover strike days" in strike["note"]
    elif call == "strike_unclear":
        assert strike["dates"] is None and not strike["covers_date"] and not strike["test"]
    else:
        assert strike is None


def test_bahn_url_carries_station_ids_so_bahn_de_fills_them_in():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE train_stop_stats (station_key TEXT, eva TEXT, n INT)")
    conn.executemany("INSERT INTO train_stop_stats VALUES (?, ?, ?)",
                     [("hamburg", "08002549", 9), ("muenchen", "08000261", 9), ("muenchen", "08098262", 1)])  # fmt: skip
    url = picks.bahn_url("Hamburg Hbf", "München Hbf", "2026-11-16T07:01:00+00:00", conn)
    assert (
        "&soid=A%3D1%40O%3DHamburg%20Hbf%40L%3D8002549%40&zoid=A%3D1%40O%3DM%C3%BCnchen%20Hbf%40L%3D8000261%40"
        in url
    )
    assert "soid" not in picks.bahn_url("Nowhere", "München Hbf", "2026-11-16T07:01:00+00:00", conn)
