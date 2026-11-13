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
     ("34.99", 130, True, True, 17.5)],
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
        json={"pick": PICK, "price_eur": 34.99, "push": {"endpoint": "https://push.example/x"}},
    )
    assert r.status_code == 201
    tid, secret = r.json()["trip_id"], r.json()["secret"]

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
