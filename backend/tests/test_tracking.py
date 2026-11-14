import asyncio
import json
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from conftest import fixture
from pywebpush import WebPushException

from app import board, push, replay
from app.alternatives import options
from app.db import connect, init_db
from app.tracker import poll, record, track_trips
from app.transitous import Transitous
from app.trips import create_trip, latest_snapshot, trip_view

T0 = datetime(2026, 11, 14, 10, 0, tzinfo=UTC)
PICK = {
    "id": "p1",
    "dep": "2026-11-14T08:00:00Z",
    "arr": "2026-11-14T12:00:00Z",
    "legs": [{"train": "ICE 703", "from": "Hamburg Hbf", "to": "München Hbf", "trip_id": "x"}],
}


@pytest.fixture(autouse=True)
def _db(settings):
    init_db(settings.db_path)


def _row(db, trip_id):
    conn = connect(db)
    row = dict(conn.execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone())
    conn.close()
    return row


def _snap(delay, cancelled=False):
    return {"delay_min": delay, "expected_arr": None, "cancelled": cancelled, "raw": {}}


def test_delay_series_alerts_once_per_threshold(settings):
    sent = []

    async def notify(db, row, payload):
        sent.append(payload)

    tid, _ = create_trip(settings.db_path, PICK, Decimal("34.99"))
    states = []
    for i, delay in enumerate([12, 24, 15, 26, 61]):
        asyncio.run(
            record(settings.db_path, tid, _snap(delay), T0 + timedelta(minutes=2 * i), notify)
        )
        row = _row(settings.db_path, tid)
        states.append(trip_view(row, latest_snapshot(settings.db_path, tid), T0)["state"])

    assert states == ["on_time", "unlocked", "on_time", "unlocked", "cash25"]
    assert [p["title"] for p in sent] == ["It's late. You win.", "Cash back unlocked"]
    assert sent[0]["body"].startswith("Your ICE 703 is now expected +24 min.")
    assert "8.75 EUR" in sent[1]["body"] and sent[1]["url"] == f"/trip/{tid}"
    conn = connect(settings.db_path)
    kinds = sorted(
        k for (k,) in conn.execute("SELECT kind FROM trip_alerts WHERE trip_id = ?", (tid,))
    )
    assert kinds == ["20", "60"]


def test_poll_reads_alighting_stop_and_broken_connection(settings):
    def handler(request):
        if request.url.params["tripId"] == "gone":
            return httpx.Response(404, json={"error": "trip not found"})
        return httpx.Response(200, json=fixture("trip_ice514.json"))

    tr = Transitous(settings, httpx.MockTransport(handler))
    munich = {"id": "de-DELFI_de:09162:100", "name": "München Hbf"}
    augsburg = {"id": "de-DELFI_de:09761:100", "name": "Augsburg Hbf"}
    leg = {"trip_id": "t1", "from": munich, "to": augsburg}

    async def go():
        mid = await poll(tr, {"legs": [leg]})
        end = await poll(tr, {"legs": [{**leg, "to": "Hamburg Altona"}]})
        change = await poll(
            tr, {"legs": [leg, {"trip_id": "t2", "from": "Pasing", "to": "Hamburg-Altona"}]}
        )
        gone = await poll(tr, {"legs": [{**leg, "trip_id": "gone"}]})
        await tr.aclose()
        return mid, end, change, gone

    mid, end, change, gone = asyncio.run(go())
    assert (mid["delay_min"], mid["cancelled"], mid["raw"]["connection_at_risk"]) == (
        3,
        False,
        False,
    )
    assert end["delay_min"] == 35 and end["expected_arr"] == "2026-11-14T00:09:00Z"
    assert change["delay_min"] == 35 and change["raw"]["connection_at_risk"] is True
    assert gone is None


def test_switch_to_earlier_arrival_has_no_compensation_at_stake(settings):
    tid, _ = create_trip(settings.db_path, PICK, Decimal("34.99"))
    alts = [
        {"dep": "2026-11-14T10:40:00Z", "arr": "2026-11-14T11:50:00Z", "changes": 0, "trains": ["ICE 9"]},
        {"dep": "2026-11-14T11:30:00Z", "arr": "2026-11-14T13:10:00Z", "changes": 1, "trains": ["IC 1", "ICE 2"]},
    ]  # fmt: skip
    conn = connect(settings.db_path)
    with conn:
        conn.execute("UPDATE trips SET alts = ? WHERE id = ?", (json.dumps(alts), tid))
    conn.close()
    snap = {
        "delay_min": 30,
        "expected_arr": "2026-11-14T12:30:00Z",
        "cancelled": 0,
        "at": "2026-11-14T10:00:00Z",
        "raw": "{}",
    }
    view = trip_view(_row(settings.db_path, tid), snap, T0)

    early, late = view["alternatives"]
    assert (early["catchable_min"], early["delta_vs_expected_min"]) == (40, -40)
    assert early["forfeits_compensation"] is True and early["compensation_eur"] == 0
    assert late["forfeits_compensation"] is False and late["compensation_eur"] == 8.75
    assert view["stay"] == {"amount_at_60_eur": 8.75, "amount_at_120_eur": 17.5}

    booked_it = fixture("plan_ham_muc.json")["itineraries"][0]
    booked = booked_it["legs"][0]["tripId"]
    later = json.loads(json.dumps(booked_it).replace(booked, "other").replace("T11:42", "T12:42"))
    sooner = json.loads(json.dumps(booked_it).replace(booked, "fast").replace("T11:42", "T10:59"))
    tgv = json.loads(json.dumps(booked_it).replace(booked, "tgv").replace("ICE 703", "TGV 9570"))
    plan = {"itineraries": [booked_it, later, sooner, tgv]}
    found = options(plan, {booked}, datetime(2026, 11, 14, 0, 0, tzinfo=UTC))
    assert [o["arr"] for o in found] == ["2026-11-14T10:59:00Z", "2026-11-14T12:42:00Z"]
    assert found[0] == {**found[0], "changes": 0, "trains": ["ICE 703"]}


def test_history_replay_fires_each_threshold_once(client, settings, monkeypatch):
    monkeypatch.setattr(replay, "HISTORY", settings.db_path.parent / "none.json")
    assert client.post("/api/demo/replay").status_code == 404
    monkeypatch.undo()
    monkeypatch.setattr(replay, "PLAY_SECONDS", 2.0)
    monkeypatch.setattr(replay, "FIRST_CROSSING_BY", 1.0)
    monkeypatch.setattr(replay, "LEAD_IN", 0.1)
    sent = []

    async def notify(db, row, payload):
        sent.append(payload)

    client.app.state.notify = notify
    body = {"recording": "history:ice611-2026-10-30", "price_eur": 40}
    r = client.post("/api/demo/replay", json=body).json()
    assert r["recording"]["source"] == "history" and r["recording"]["crosses_60"]
    for _ in range(40):
        view = client.get(f"/api/trips/{r['trip_id']}", params={"secret": r["secret"]}).json()
        if view["finished"]:
            break
        time.sleep(0.2)

    assert view["is_replay"] and view["replay_of"] == "2026-10-30"
    assert view["finished"] and view["final_delay_min"] == 124
    assert view["delay_basis"] == "at_stop" and view["at_stop"]["name"] == "München Hbf"
    assert [p["title"] for p in sent] == [
        "Replay · It's late. You win.",
        "Replay · Cash back unlocked",
        "Replay · Half your money back",
    ]
    assert sent[0]["body"].startswith("Your ICE 611 is +32 min at Dortmund Hbf.")
    assert all(p["body"].endswith("(replay of 2026-10-30)") for p in sent)
    assert "10.00 EUR" in sent[1]["body"]


def test_push_key_and_gone_subscription(client, settings, monkeypatch):
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    assert client.get("/api/push/key").status_code == 404
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "pub")
    assert client.get("/api/push/key").json() == {"public_key": "pub"}

    monkeypatch.setenv("VAPID_PRIVATE_KEY", "priv")
    tid, _ = create_trip(settings.db_path, PICK, push={"endpoint": "https://fcm.googleapis.com/fcm/send/x"})

    def gone(*args):
        raise WebPushException("gone", response=SimpleNamespace(status_code=410, text=""))

    monkeypatch.setattr(push, "_post", gone)
    assert asyncio.run(push.send(settings.db_path, _row(settings.db_path, tid), {})) is False
    assert _row(settings.db_path, tid)["push"] is None


def test_late_trip_is_polled_past_its_schedule_then_finished(client, settings):
    pick = {
        "dep": "2026-11-13T20:00:00Z",
        "arr": "2026-11-13T23:34:00Z",
        "legs": [{"train": "ICE 514", "to": "Hamburg-Altona", "trip_id": "t1"}],
    }
    tid, _ = create_trip(settings.db_path, pick, auto=True)
    tr = client.app.state.transitous

    async def notify(db, row, payload):
        pass

    asyncio.run(track_trips(tr, notify, datetime(2026, 11, 14, 0, 30, tzinfo=UTC)))
    row = _row(settings.db_path, tid)
    assert row["finished_at"] is None
    assert latest_snapshot(settings.db_path, tid)["delay_min"] == 35
    asyncio.run(track_trips(tr, notify, datetime(2026, 11, 14, 1, 0, tzinfo=UTC)))
    row = _row(settings.db_path, tid)
    assert row["finished_at"] and row["final_delay_min"] == 35


def test_post_trip_rejects_bad_times(client):
    for bad in ["2026-11-14T08:00:00", "soon"]:
        r = client.post("/api/trips", json={"pick": {**PICK, "dep": bad}})
        assert r.status_code == 422
    assert client.post("/api/trips", json={"pick": PICK}).status_code == 201


def test_jump_past_60_sends_one_push(settings):
    sent = []

    async def notify(db, row, payload):
        sent.append(payload["title"])

    tid, _ = create_trip(settings.db_path, PICK)
    for i, delay in enumerate([10, 70, 25]):
        asyncio.run(record(settings.db_path, tid, _snap(delay), T0 + timedelta(minutes=i), notify))
    assert sent == ["Cash back unlocked"]


def test_rising_trains_are_auto_tracked_within_caps(client, settings, monkeypatch):
    tr = client.app.state.transitous
    rows = [
        {"train": f"ICE {n}", "delay_min": d, "trip_id": f"t{n}", "from": "München Hbf"}
        for n, d in [(1, 12), (2, 19), (3, 15), (4, 25), (5, 5)]
    ]
    late = datetime(2026, 11, 13, 23, 0, tzinfo=UTC)  # terminus 23:34Z is under an hour away
    assert asyncio.run(board.track_rising(tr, rows, late)) == 0
    early = datetime(2026, 11, 13, 21, 0, tzinfo=UTC)
    assert asyncio.run(board.track_rising(tr, rows, early)) == 2
    assert asyncio.run(board.track_rising(tr, rows, early)) == 0  # two per hour
    conn = connect(settings.db_path)
    picks = [json.loads(p) for (p,) in conn.execute("SELECT pick FROM trips WHERE auto = 1")]
    conn.close()
    assert sorted(p["legs"][0]["train"] for p in picks) == ["ICE 2", "ICE 3"]
    assert picks[0]["legs"][0]["to"]["name"] == "Hamburg-Altona"

    monkeypatch.setattr(board, "WATCH_PER_HOUR", 10)
    monkeypatch.setattr(board, "MAX_OPEN_AUTO", 3)
    assert asyncio.run(board.track_rising(tr, rows, early)) == 1  # open-trip cap


def test_replay_prefers_a_recording_that_crosses_20(client, settings, monkeypatch):
    monkeypatch.setattr(replay, "HISTORY", settings.db_path.parent / "none.json")
    for delays in ([30, 40, 50, 65, 70, 80, 90, 95], [12, 15, 18, 22, 30, 41, 58, 15]):
        tid, _ = create_trip(settings.db_path, PICK, auto=True)
        conn = connect(settings.db_path)
        with conn:
            for i, d in enumerate(delays):
                at = (T0 + timedelta(minutes=2 * i)).strftime("%Y-%m-%dT%H:%M:%SZ")
                conn.execute(
                    "INSERT INTO trip_snapshots(trip_id, at, delay_min) VALUES (?,?,?)",
                    (tid, at, d),
                )
        conn.close()
    private, _ = create_trip(settings.db_path, PICK)  # a user's own booked trip is not public
    conn = connect(settings.db_path)
    with conn:
        for i in range(8):
            at = (T0 + timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%SZ")
            conn.execute(
                "INSERT INTO trip_snapshots(trip_id, at, delay_min) VALUES (?,?,?)",
                (private, at, 25 + i),
            )
        conn.execute("UPDATE trips SET finished_at = ? WHERE id = ?", (T0.isoformat(), private))
    conn.close()
    assert client.post("/api/demo/replay", json={"recording": f"live:{private}"}).status_code == 404
    got = client.get("/api/demo/recordings").json()
    assert [(r["crosses_20"], r["max_delay_min"]) for r in got] == [(True, 58), (False, 95)]
    assert got[0]["outcome"] == "unlocked"
    assert got[0]["id"] == f"live:{tid}" and got[0]["source"] == "live"
    r = client.post("/api/demo/replay").json()
    assert r["recording"]["id"] == f"live:{tid}"


def test_on_time_history_replay_finishes_without_alerts(client, settings, monkeypatch):
    monkeypatch.setattr(replay, "PLAY_SECONDS", 0.2)
    monkeypatch.setattr(replay, "LEAD_IN", 0.01)
    sent = []

    async def notify(db, row, payload):
        sent.append(payload)

    client.app.state.notify = notify
    recordings = client.get("/api/demo/recordings").json()
    rec = next(r for r in recordings if r["id"] == "history:ice789-2026-10-30")
    assert rec["outcome"] == "on_time" and not rec["crosses_20"]
    response = client.post("/api/demo/replay", json={"recording": rec["id"]})
    assert response.status_code == 200
    r = response.json()
    for _ in range(20):
        view = client.get(f"/api/trips/{r['trip_id']}", params={"secret": r["secret"]}).json()
        if view["finished"]:
            break
        time.sleep(0.1)

    assert view["finished"] and view["state"] == "on_time"
    assert view["final_delay_min"] == -3
    assert view["at_stop"]["name"] == "München Hbf"
    assert not sent and not any(t["reached"] for t in view["thresholds"])
    assert r["trip_id"] not in client.app.state.replays
    conn = connect(settings.db_path)
    assert conn.execute("SELECT COUNT(*) FROM trip_alerts").fetchone()[0] == 0
    conn.close()
