import hashlib
import hmac
import importlib.util
import json
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import connect, init_db
from app.signals import (
    BERLIN,
    announces_strike,
    ensure_schema,
    parse_strike_dates,
    read_strike,
    router,
    strike_for,
)

PARAMS = {"from": "Hamburg Hbf", "to": "Berlin Hbf", "date": "2026-11-15"}


def result(n: int, host: str = "news.example", **summary) -> dict:
    s = {
        "kind": "strike",
        "relevant": True,
        "date_from": "2026-11-15",
        "date_to": None,
        "reason": f"r{n}",
    }
    return {
        "title": f"t{n}",
        "url": f"https://{host}/{n}",
        "publishedDate": "2026-11-10T08:00:00.000Z",
        "summary": json.dumps({**s, **summary}),
    }


class Exa:
    def __init__(self, results: list[dict]):
        self.results, self.bodies = results, []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"results": self.results})


def make_client(tmp_path, exa: Exa | None, key: str = "k"):
    settings = Settings(db_path=tmp_path / "t.sqlite", exa_key=key, loop=False)
    init_db(settings.db_path)
    app = FastAPI()
    app.state.settings = settings
    app.state.signals_transport = httpx.MockTransport(exa) if exa else None
    app.include_router(router)
    return TestClient(app)


def test_missing_key_is_unavailable_not_an_error(tmp_path):
    exa = Exa([])
    r = make_client(tmp_path, exa, key="").get("/api/signals", params=PARAMS)
    assert r.status_code == 200
    assert r.json()["status"] == "unavailable" and r.json()["items"] == []
    assert exa.bodies == []


def test_filters_and_cap(tmp_path):
    results = [
        result(0, "www.bahn.de"),
        result(1, "reiseauskunft.bahn.de"),
        result(2, relevant=False),
        result(3, date_from="2026-10-01", kind="works", date_to="2026-10-02"),
        result(4, kind="bogus"),
        *[result(i) for i in range(5, 12)],
    ]
    exa = Exa(results)
    body = make_client(tmp_path, exa).get("/api/signals", params=PARAMS).json()
    assert body["status"] == "ok"
    assert [i["reason"] for i in body["items"]] == ["r4", "r5", "r6", "r7", "r8"]
    assert body["items"][0] == {
        "kind": "other",
        "reason": "r4",
        "source": "news.example",
        "published": "2026-11-10",
        "url": "https://news.example/4",
    }
    sent = exa.bodies[0]
    assert "bahn.de" in sent["excludeDomains"] and "Hamburg Berlin" in sent["query"]


def test_nothing_relevant_is_empty(tmp_path):
    body = (
        make_client(tmp_path, Exa([result(1, relevant=False)]))
        .get("/api/signals", params=PARAMS)
        .json()
    )
    assert body["status"] == "empty" and body["items"] == []


def test_second_call_hits_cache(tmp_path):
    exa = Exa([result(1)])
    c = make_client(tmp_path, exa)
    c.get("/api/signals", params=PARAMS)
    again = {**PARAMS, "from": "hamburg", "to": "BERLIN Hauptbahnhof"}
    assert c.get("/api/signals", params=again).json()["items"][0]["reason"] == "r1"
    assert len(exa.bodies) == 1


def signed(secret: str, payload: dict, ts: int | None = None) -> tuple[bytes, dict]:
    raw = json.dumps(payload).encode()
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    return raw, {"X-Context-Signature": f"t={ts},v1={sig}", "X-Context-Id": payload["id"]}


def test_webhook_stores_signed_and_rejects_forged(tmp_path, monkeypatch):
    monkeypatch.setenv("CONTEXT_WEBHOOK_SECRET", "whsec_other,whsec_test")
    c = make_client(tmp_path, None, key="")
    change = {
        "url": "https://www.gdl.de/presse/x",
        "title": "Warnstreik",
        "detected_at": "2026-11-14T10:00:00Z",
    }
    payload = {"event": "change.detected", "id": "evt_1", "data": {"change": change}}

    raw, headers = signed("whsec_test", payload)
    assert c.post("/hooks/context", content=raw, headers=headers).status_code == 204
    assert c.post("/hooks/context", content=raw, headers=headers).status_code == 204

    forged, fheaders = signed("wrong", {**payload, "id": "evt_2"})
    assert c.post("/hooks/context", content=forged, headers=fheaders).status_code == 401
    old, oheaders = signed("whsec_test", {**payload, "id": "evt_3"}, ts=int(time.time()) - 900)
    assert c.post("/hooks/context", content=old, headers=oheaders).status_code == 401
    assert c.post("/hooks/context", content=raw).status_code == 401

    banners = c.get("/api/signals", params=PARAMS).json()["banners"]
    assert banners == [
        {
            "source": "gdl.de",
            "url": "https://www.gdl.de/presse/x",
            "changed_at": "2026-11-14T10:00:00+00:00",
            "title": "Warnstreik",
            "test": False,
            "is_strike": True,
            "dates": None,
            "covers_date": False,
        }
    ]


def test_webhook_without_configured_secret_is_401(tmp_path, monkeypatch):
    monkeypatch.delenv("CONTEXT_WEBHOOK_SECRET", raising=False)
    raw, headers = signed("", {"event": "change.detected", "id": "evt_1", "data": {}})
    assert (
        make_client(tmp_path, None).post("/hooks/context", content=raw, headers=headers).status_code
        == 401
    )


@pytest.mark.parametrize("status", [429, 500])
def test_exa_failure_is_unavailable(tmp_path, status):
    c = make_client(tmp_path, lambda request: httpx.Response(status))
    assert c.get("/api/signals", params=PARAMS).json()["status"] == "unavailable"


def test_exa_daily_budget_caps_paid_calls(tmp_path, monkeypatch):
    monkeypatch.setenv("SPAETKAUF_EXA_BUDGET", "2")
    exa = Exa([])
    c = make_client(tmp_path, exa)
    answers = [
        c.get("/api/signals", params={**PARAMS, "date": f"2026-11-{d}"}).json()["status"]
        for d in (15, 16, 17)
    ]
    assert answers == ["empty", "empty", "unavailable"] and len(exa.bodies) == 2


REF = date(2026, 11, 14)


@pytest.mark.parametrize(
    "text, want",
    [
        ("Streik am 16. November", ["2026-11-16"]),
        ("Warnstreik am 16.11.", ["2026-11-16"]),
        ("Streik am 16.11.2026 ab 2 Uhr", ["2026-11-16"]),
        ("Streik vom 16. bis 18. November", ["2026-11-16", "2026-11-17", "2026-11-18"]),
        ("Streik 16.–18.11.", ["2026-11-16", "2026-11-17", "2026-11-18"]),
        ("Streik vom 16.11. bis zum 17.11.2026", ["2026-11-16", "2026-11-17"]),
        ("GDL: Montag, 16. November, Streik", ["2026-11-16"]),
        ("Rail strike on 16 November", ["2026-11-16"]),
        ("Rail strike on November 16th, 2026", ["2026-11-16"]),
        ("strike from 16 to 18 November", ["2026-11-16", "2026-11-17", "2026-11-18"]),
        ("Streik am 16. und 18. Nov.", ["2026-11-16", "2026-11-18"]),
        ("Streik 30. November bis 1. Dezember", ["2026-11-30", "2026-12-01"]),
        ("Streik am 5. Januar", ["2027-01-05"]),
        ("Streik ab 16.00 Uhr, Termin offen", None),
        ("GDL kündigt Streiks an", None),
    ],
)
def test_parse_strike_dates(text, want):
    assert parse_strike_dates(text, REF) == want


def test_announces_strike():
    assert announces_strike("Keine Einigung: GDL ruft zum Warnstreik auf")
    assert announces_strike("EVG calls a strike")
    assert not announces_strike("Kein neuer Streik vor Weihnachten")
    assert not announces_strike("Tarifverhandlungen werden fortgesetzt")


def test_past_strike_is_not_an_unclear_warning(tmp_path, monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 14, 12, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr("app.signals.datetime", Clock)
    row = {
        "title": "GDL-Streik vom 10. bis 12. Januar 2024 beendet",
        "changed_at": "2026-11-14T10:00:00+00:00",
        "source": "gdl.de",
        "url": "https://www.gdl.de/presse/x",
    }
    assert read_strike(row) is None
    db = tmp_path / "t.sqlite"
    conn = connect(db)
    try:
        ensure_schema(conn)
        with conn:
            conn.execute(
                "INSERT INTO context_changes(id, title, changed_at, source, url) "
                "VALUES ('past', :title, :changed_at, :source, :url)",
                row,
            )
        assert strike_for(conn, date(2026, 11, 15), today=REF) is None
    finally:
        conn.close()


def load_script():
    path = Path(__file__).parents[1] / "scripts" / "send_test_change.py"
    spec = importlib.util.spec_from_file_location("send_test_change", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_signed_test_change_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("CONTEXT_WEBHOOK_SECRET", "whsec_other,whsec_test")
    script = load_script()
    day = datetime.now(BERLIN).date() + timedelta(days=2)
    c = make_client(tmp_path, None, key="")
    sent = []

    async def notify(db_path, row, payload):
        sent.append((row["id"], payload))

    c.app.state.notify = notify
    db = c.app.state.settings.db_path
    pick = {"dep": f"{day}T08:00:00Z", "arr": f"{day}T12:00:00Z", "legs": []}
    conn = connect(db)
    with conn:
        conn.execute(
            "INSERT INTO trips(id, pick, created_at) VALUES ('t1', ?, '2026-11-14T00:00:00Z')",
            (json.dumps(pick),),
        )
    conn.close()

    for _ in range(2):  # the second change does not alert the trip again
        raw, headers = script.signed(script.sample_change(day), "whsec_test")
        assert c.post("/hooks/context", content=raw, headers=headers).status_code == 204
    body = c.get("/api/signals", params={**PARAMS, "date": day.isoformat()}).json()
    strike = body["strike"]
    assert strike["title"].startswith("TEST: GDL ruft zum Streik")
    assert (strike["dates"], strike["covers_date"], strike["test"]) == (
        [day.isoformat()],
        True,
        True,
    )
    assert body["banners"][0]["test"] and body["banners"][0]["covers_date"]
    assert [(tid, p["body"]) for tid, p in sent] == [
        ("t1", f"Strike announced for your travel day: {strike['title']}")
    ]

    raw, headers = script.signed(script.clear_event(), "whsec_wrong")
    assert c.post("/hooks/context", content=raw, headers=headers).status_code == 401
    raw, headers = script.signed(script.clear_event(), "whsec_test")
    assert c.post("/hooks/context", content=raw, headers=headers).status_code == 204
    body = c.get("/api/signals", params={**PARAMS, "date": day.isoformat()}).json()
    assert body["strike"] is None and body["banners"] == []
    conn = connect(db)
    assert conn.execute("SELECT COUNT(*) FROM trip_alerts").fetchone()[0] == 0
    conn.close()
