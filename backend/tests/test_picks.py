from datetime import datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_odds import odds_db

from app import odds, picks
from app.db import init_db
from app.odds import BERLIN
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


def plan_pages(pages):
    def handler(request: httpx.Request) -> httpx.Response:
        path, params = request.url.path, request.url.params
        handler.calls.append(path)
        if path.endswith("/geocode"):
            hit = {"type": "STOP", "id": "de-DELFI_de:02000:10950", "name": "Hamburg Hbf",
                   "lat": 53.55, "lon": 10.0, "modes": ["HIGHSPEED_RAIL"]}  # fmt: skip
            return httpx.Response(200, json=[hit] if params["text"] == "Hamburg Hbf" else [])
        page = int(params.get("pageCursor", "0"))
        body = {"from": {"name": "Hamburg Hbf"}, "to": {"name": "München Hbf"},
                "itineraries": pages[page]}  # fmt: skip
        if page + 1 < len(pages):
            body["nextPageCursor"] = str(page + 1)
        return httpx.Response(200, json=body)

    handler.calls = []
    return handler


@pytest.fixture
def make_client(settings, tmp_path, monkeypatch):
    monkeypatch.setattr(odds, "SHRINK_M", 0)
    init_db(settings.db_path)
    wd = DAY.weekday()
    rows = [{"train": t, "stop": "München Hbf", "weekday": wd, "n": 20, "ge20": k, "ge60": 1}
            for t, k in (("ICE 1", 12), ("ICE 2", 10), ("ICE 3", 4))]  # fmt: skip

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
         itin(("ICE 3", "Hauptbahnhof", "09:30", "12:50"))],
        [itin(("FLX10", "München Hbf", "10:00", "14:00")),
         itin(("TGV 9", "München Hbf", "09:10", "12:30"))],
    ])  # fmt: skip
    body = get(make_client(handler)).json()
    assert handler.calls.count("/api/v1/plan") == 2
    assert (body["from"], body["to"], body["tz"]) == ("Hamburg Hbf", "München Hbf", "Europe/Berlin")
    trains = [p["legs"][0]["train"] for p in body["picks"]]
    assert trains == ["ICE 1", "ICE 2", "ICE 3", "TGV 9", "FLX10"]
    first, second, third = body["picks"][:3]
    assert first["already_posted"] and not first["is_kurts_pick"]
    assert second["is_kurts_pick"] and sum(p["is_kurts_pick"] for p in body["picks"]) == 1
    assert second["odds"] == {"p20": 0.5, "p60": 0.05, "late": 10, "n": 20,
                              "weekday": DAY.strftime("%A"), "basis": "history"}  # fmt: skip
    # the TGV arrives earlier but needs a reservation; ICE 1 left before the booked train
    assert second["ride_instead"]["trains"] == ["ICE 3"]
    assert second["ride_instead"]["delta_arr_min"] == -10
    assert third["ride_instead"] is None
    assert third["legs"][0]["to"] == "München Hbf" and third["odds"]["p20"] == 0.2
    assert len(second["legs"]) == 1 and second["changes"] == 0
    assert second["bahn_url"].startswith("https://www.bahn.de/buchung/fahrplan/suche#sts=true")
    assert (
        "so=Hamburg%20Hbf&zo=M%C3%BCnchen%20Hbf&hd=" + DAY.isoformat() + "T09:00:00"
        in (second["bahn_url"])
    )
    assert body["note"] == "2 of 5 connections have too little history for odds" \
        " (no history for FlixTrain legs)."  # fmt: skip


def test_no_alternative_and_unknown_station(make_client):
    client = make_client(plan_pages([[itin(("ICE 3", "München Hbf", "09:30", "12:50"))]]))
    (only,) = get(client).json()["picks"]
    assert only["ride_instead"] is None and only["is_kurts_pick"]
    missing = get(client, **{"from": "Nowhere"})
    assert missing.status_code == 404 and "Nowhere" in missing.json()["detail"]
