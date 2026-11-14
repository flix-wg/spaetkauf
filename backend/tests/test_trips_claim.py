from decimal import Decimal

import pytest

from app.claim import compute_claim
from app.trips import derive_state

PICK = {
    "id": "p1",
    "dep": "2026-11-14T08:00:00Z",
    "arr": "2026-11-14T12:00:00Z",
    "legs": [{"train": "ICE 703", "from": "Hamburg Hbf", "to": "München Hbf"}],
}


@pytest.mark.parametrize(
    "delay,cancelled,state",
    [(0, False, "on_time"), (19, False, "on_time"), (20, False, "unlocked"),
     (59, False, "unlocked"), (60, False, "cash25"), (119, False, "cash25"),
     (120, False, "cash50"), (5, True, "cancelled"), (None, False, "on_time")],
)  # fmt: skip
def test_state(delay, cancelled, state):
    assert derive_state(delay, cancelled) == state


@pytest.mark.parametrize(
    "price,delay,switched,due,amount",
    [("34.99", 71, False, True, 8.75),
     ("12.90", 65, False, False, None),
     ("40.00", 120, False, True, 20.0),
     ("40.00", 119, False, True, 10.0),
     ("34.99", 45, False, False, None),
     (None, 90, False, True, None),
     ("34.99", 40, True, False, None),
     ("34.99", 130, True, False, None)],
)  # fmt: skip
def test_claim_rules(price, delay, switched, due, amount):
    got = compute_claim(Decimal(price) if price else None, delay, switched)
    assert (got["due"], got["amount_eur"]) == (due, amount)
    if price is None:
        assert got["pct"] == 25 and "price" in got["reason"]
    if switched and delay < 60:
        assert "switched" in got["reason"]


def test_trip_round_trip_and_secrets(client, settings):
    r = client.post(
        "/api/trips",
        json={"pick": PICK, "price_eur": 34.99, "push": {"endpoint": "https://fcm.googleapis.com/fcm/send/x"}},
    )
    assert r.status_code == 201
    tid, secret = r.json()["trip_id"], r.json()["secret"]
    for bad in ("https://127.0.0.1:8443/x", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x"):
        r = client.post("/api/trips", json={"pick": PICK, "push": {"endpoint": bad}})
        assert r.status_code == 422 and "push service" in r.text

    assert client.get(f"/api/trips/{tid}", params={"secret": "wrong"}).status_code == 404
    assert client.get(f"/api/trips/{tid}").status_code == 404
    view = client.get(f"/api/trips/{tid}", params={"secret": secret}).json()
    assert view["state"] == "on_time" and view["price_eur"] == 34.99
    assert [t["amount_eur"] for t in view["thresholds"]] == [None, 8.75, 17.5]
    assert view["alternatives"] == [] and view["switched"] is False

    assert (
        client.patch(
            f"/api/trips/{tid}", params={"secret": "wrong"}, json={"switched": True}
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/trips/{tid}", params={"secret": secret}, json={"switched": True}
        ).json()["switched"]
        is True
    )
    claim = client.get(f"/api/trips/{tid}/claim", params={"secret": secret}).json()
    assert claim["due"] is False  # no delay recorded yet

    assert client.delete(f"/api/trips/{tid}", params={"secret": "wrong"}).status_code == 404
    assert client.delete(f"/api/trips/{tid}", params={"secret": secret}).status_code == 204
    assert client.get(f"/api/trips/{tid}", params={"secret": secret}).status_code == 404

    from app.db import connect

    conn = connect(settings.db_path)
    assert conn.execute("SELECT COUNT(*) FROM trips").fetchone()[0] == 0


def test_switched_claim_uses_no_booked_arrival(client, settings):
    from app.db import connect

    saved = client.post("/api/trips", json={"pick": PICK, "price_eur": 34.99}).json()
    tid, secret = saved["trip_id"], saved["secret"]
    conn = connect(settings.db_path)
    conn.execute(
        "INSERT INTO trip_snapshots(trip_id, at, delay_min, expected_arr) VALUES (?,?,?,?)",
        (tid, "2026-11-14T12:00:00Z", 71, "2026-11-14T13:11:00Z"),
    )
    conn.commit()
    conn.close()
    client.patch(f"/api/trips/{tid}", params={"secret": secret}, json={"switched": True})
    claim = client.get(f"/api/trips/{tid}/claim", params={"secret": secret}).json()
    assert (claim["due"], claim["pct"], claim["amount_eur"]) == (False, 0, None)
    assert {f["label"]: f["value"] for f in claim["fields"]}["Actual arrival"] == ""
    assert all(text in claim["reason"] for text in ("actual arrival", "under 60", "25 %", "50 %"))


def test_claim_forecast_until_arrival(client, settings, monkeypatch):
    from datetime import datetime

    from app.db import connect
    from app.tracker import finish

    saved = client.post("/api/trips", json={"pick": PICK, "price_eur": 34.99}).json()
    tid, secret = saved["trip_id"], saved["secret"]
    url = f"/api/trips/{tid}/claim"
    monkeypatch.setattr("app.trips._now", lambda: datetime.fromisoformat("2026-11-14T13:00:00Z"))
    assert client.get(url, params={"secret": secret}).json()["provisional"] is True
    conn = connect(settings.db_path)
    conn.execute(
        "INSERT INTO trip_snapshots(trip_id, at, delay_min, expected_arr) VALUES (?,?,?,?)",
        (tid, "2026-11-14T13:00:00Z", 71, "2026-11-14T13:11:00Z"),
    )
    conn.commit()
    conn.close()
    claim = client.get(url, params={"secret": secret}).json()
    assert claim["provisional"] is True and claim["amount_eur"] == 8.75
    assert "Expected arrival" in [f["label"] for f in claim["fields"]]
    monkeypatch.setattr("app.trips._now", lambda: datetime.fromisoformat("2026-11-14T13:11:00Z"))
    claim = client.get(url, params={"secret": secret}).json()
    assert claim["provisional"] is True and claim["amount_eur"] == 8.75
    assert "Expected arrival" in [f["label"] for f in claim["fields"]]
    finish(settings.db_path, tid, 71, datetime.fromisoformat("2026-11-14T14:00:00Z"))
    monkeypatch.setattr("app.trips._now", lambda: datetime.fromisoformat("2026-11-14T15:00:00Z"))
    claim = client.get(url, params={"secret": secret}).json()
    assert claim["provisional"] is True
    assert "Expected arrival" in [f["label"] for f in claim["fields"]]
    conn = connect(settings.db_path)
    conn.execute(  # a live reading after the arrival time confirms it
        "INSERT INTO trip_snapshots(trip_id, at, delay_min, expected_arr) VALUES (?,?,?,?)",
        (tid, "2026-11-14T13:15:00Z", 72, "2026-11-14T13:12:00Z"),
    )
    conn.commit()
    conn.close()
    claim = client.get(url, params={"secret": secret}).json()
    assert claim["provisional"] is False
    assert "Actual arrival" in [f["label"] for f in claim["fields"]]


def test_claim_preserves_replay_identity(client, settings):
    from app.trips import create_trip

    tid, secret = create_trip(settings.db_path, PICK, Decimal("34.99"), replay_of="2026-10-23")
    claim = client.get(f"/api/trips/{tid}/claim", params={"secret": secret}).json()
    assert claim["is_replay"] is True and claim["replay_of"] == "2026-10-23"


@pytest.mark.parametrize(
    "basis,replay_of",
    [("at_stop", "2026-10-30"), ("destination_forecast", "2026-10-30"),
     ("destination_forecast", None)],
)
def test_claim_arrival_clocks_match_replay_source(client, settings, basis, replay_of):
    import json

    from app.db import connect
    from app.trips import create_trip

    pick = {**PICK, "arr": "2026-10-30T19:32:00Z", "delay_basis": basis}
    tid, secret = create_trip(settings.db_path, pick, Decimal(40), replay_of=replay_of)
    conn = connect(settings.db_path)
    with conn:
        conn.execute(
            "INSERT INTO trip_snapshots(trip_id, at, delay_min, expected_arr, raw)"
            " VALUES (?,?,?,?,?)",
            (tid, "2026-10-30T21:36:00Z", 124, "2026-10-30T21:36:00Z",
             json.dumps({"basis": basis})),
        )
        conn.execute("UPDATE trips SET finished_at = ? WHERE id = ?", ("2026-10-30T21:36:00Z", tid))
    conn.close()
    claim = client.get(f"/api/trips/{tid}/claim", params={"secret": secret}).json()
    fields = {f["label"]: f["value"] for f in claim["fields"]}
    if basis == "at_stop":
        assert fields["Scheduled arrival"] == "30.10.2026 19:32"
        assert fields["Actual arrival"] == "30.10.2026 21:36"
    else:
        assert fields["Scheduled arrival"] == "2026-10-30T19:32:00Z"
        assert fields["Actual arrival"] == "2026-10-30T21:36:00Z"
