import hashlib
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_odds import odds_db

from app import ext, odds
from app.config import Settings
from app.db import connect, init_db


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(odds, "SHRINK_M", 0)
    app = FastAPI()
    settings = Settings(
        db_path=tmp_path / "app.sqlite",
        plan_budget=3,
        loop=False,
        anthropic_key="test-key",
        adapt_daily_cap=2,
    )
    init_db(settings.db_path)
    app.state.settings = settings
    app.state.odds = odds_db(
        tmp_path / "odds.sqlite",
        [
            {
                "train": "ICE 1",
                "stop": "München Hbf",
                "eva": "8000261",
                "weekday": wd,
                "n": 20,
                "ge20": k,
                "ge60": 2,
            }
            for wd, k in ((5, 12), (6, 4))
        ],
    )
    app.include_router(ext.router)
    with TestClient(app) as client:
        yield client
    app.state.odds.close()


def journey(*trains, dep="10:00", arr="14:00", **kwargs):
    return dict(dep=dep, arr=arr, trains=list(trains), **kwargs)


def post_odds(client, connections, **kwargs):
    return client.post(
        "/api/ext/odds",
        json={
            "to": "München Hbf",
            "date": "2026-11-14",
            "connections": connections,
            **kwargs,
        },
    )


def payload(skeleton="li.card\n  span.train TRAIN\n  time TIME"):
    return {"skeleton": skeleton, "hash": hashlib.sha256(skeleton.encode()).hexdigest()}


def test_odds_history_last_train_and_kurt(client):
    body = post_odds(
        client,
        [
            journey("ICE0001"),
            journey("RE 4", "ICE 1"),
            journey("ICE 1", "RE 4"),
            journey("RB 2"),
            journey("ICE 999"),
        ],
        **{"from": "Hamburg Hbf"},
    ).json()
    first, last, *missing = body["results"]
    assert (first["p20"], first["p60"], first["n"], first["late"]) == (0.6, 0.1, 20, 12)
    assert first["train"] == "ICE 1" and first["basis"] == "history"
    assert last["basis"] == "last_train" and last["p20"] == 0.6
    assert all(r["basis"] == "none" and r["p20"] is None and r["train"] is None for r in missing)
    assert body["kurt"] == 0 and [r["kurt"] for r in body["results"]] == [True] + [False] * 4
    assert urlsplit(body["link"]).path == "/picks"
    assert parse_qs(urlsplit(body["link"]).query)["fn"] == ["Hamburg Hbf"]


def test_odds_overnight_eva_and_threshold(client):
    body = post_odds(
        client,
        [journey("ICE 1", dep="23:00", arr="01:00")],
        to="Unmatched destination",
        to_eva="8000261",
    ).json()
    assert body["results"][0]["weekday"] == "Sunday"
    assert body["results"][0]["p20"] == 0.2 and body["kurt"] is None
    assert body["link"].startswith("/?")
    next_day = post_odds(client, [journey("ICE 1", date="2026-11-21")]).json()
    assert next_day["kurt"] == 0
    assert parse_qs(urlsplit(next_day["link"]).query)["date"] == ["2026-11-21"]
    body = post_odds(client, [journey("ICE 1", date="2026-11-15"), journey("ICE 1")]).json()
    assert body["kurt"] == 1 and body["results"][1]["kurt"]
    assert post_odds(client, [journey("ICE 1")], to_eva="9999999").json()["kurt"] == 0


def test_odds_limits(client):
    for connections in (
        [journey("ICE 1")] * 31,
        [journey("ICE 1", dep="25:00")],
        [journey(*(["ICE 1"] * 13))],
    ):
        assert post_odds(client, connections).status_code == 422


def test_adapt_validation_and_no_key(client):
    client.app.state.settings = Settings(db_path=client.app.state.settings.db_path, loop=False)
    assert client.post("/api/ext/adapt", json=payload()).status_code == 503
    assert client.post("/api/ext/adapt", json=payload("div passenger name")).status_code == 422
    bad = payload()
    bad["hash"] = "wrong"
    assert client.post("/api/ext/adapt", json=bad).status_code == 422
    with connect(client.app.state.settings.db_path) as conn:
        assert conn.execute("SELECT count(*) FROM ext_adapt").fetchone()[0] == 0


def test_adapt_cache_failure_and_budget(client, monkeypatch):
    calls = []
    spec = {"card": ".card", "train": ".train", "dep": "time", "arr": "time"}

    async def ask(key, skeleton):
        calls.append(skeleton)
        return spec if len(calls) == 1 else {**spec, "arr": "javascript:bad"}

    monkeypatch.setattr(ext, "ask_model", ask)
    for cached in (False, True):
        response = client.post("/api/ext/adapt", json=payload())
        assert response.status_code == 200
        assert response.json() == {"spec": spec, "cached": cached}
    assert len(calls) == 1
    failed = payload("div.other TEXT")
    assert client.post("/api/ext/adapt", json=failed).status_code == 502
    assert client.post("/api/ext/adapt", json=failed).status_code == 422
    assert len(calls) == 2
    assert client.post("/api/ext/adapt", json=payload("div.third TEXT")).status_code == 429
    assert client.post("/api/ext/adapt", json=payload()).status_code == 200


def test_adapt_pending_and_model_error(client, monkeypatch):
    pending = payload("div.pending")
    with connect(client.app.state.settings.db_path) as conn:
        conn.execute(
            "INSERT INTO ext_adapt VALUES (?, 'pending', NULL, ?)",
            (pending["hash"], datetime.now(UTC).isoformat()),
        )
    assert client.post("/api/ext/adapt", json=pending).status_code == 409

    async def ask(key, skeleton):
        raise ValueError("model error")

    monkeypatch.setattr(ext, "ask_model", ask)
    assert client.post("/api/ext/adapt", json=payload()).status_code == 502
    assert client.post("/api/ext/adapt", json=payload()).status_code == 422
