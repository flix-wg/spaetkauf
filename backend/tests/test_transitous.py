import asyncio

import httpx
import pytest

from app.db import init_db
from app.transitous import BudgetSpent, SourceUnavailable, Transitous


def test_cache_persists_and_budget_blocks(settings, fake):
    init_db(settings.db_path)

    async def run():
        tr = Transitous(settings, httpx.MockTransport(fake))
        await tr.geocode("Hamburg Hbf")
        await tr.geocode("Hamburg Hbf")
        assert fake.calls.count("/api/v1/geocode") == 1

        await tr.plan("a", "b")
        await tr.plan("a", "b")  # cache hit, no budget spent
        await tr.plan("a", "c")
        await tr.plan("a", "d")
        assert tr.budget_left() == 0
        with pytest.raises(BudgetSpent):
            await tr.plan("a", "e")
        await tr.plan("a", "b")  # cached answers still work

        again = Transitous(settings, httpx.MockTransport(fake))  # restart
        await again.geocode("Hamburg Hbf")
        assert fake.calls.count("/api/v1/geocode") == 1
        assert again.budget_left() == 0

    asyncio.run(run())
    assert fake.calls.count("/api/v1/plan") == 3


def test_source_down_retries_once(settings):
    init_db(settings.db_path)
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(503)

    async def run():
        tr = Transitous(settings, httpx.MockTransport(handler))
        with pytest.raises(SourceUnavailable):
            await tr.trip("x")

    asyncio.run(run())
    assert len(calls) == 2


def test_outside_timetable_is_actionable_without_retry(settings):
    from fastapi.testclient import TestClient

    from app.main import create_app

    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(400, json={"error": (
            "query time 2028-06-01 07:00 is outside of loaded timetable window "
            "[2026-10-13 00:00, 2027-11-13 00:00["
        )})

    with TestClient(create_app(settings, httpx.MockTransport(handler))) as client:
        response = client.get("/api/picks", params={
            "from": "de-DELFI_a", "to": "de-DELFI_b", "date": "2028-06-01", "time": "09:00",
        })
        assert response.status_code == 400
        assert "Timetables only cover 2026-10-13 to 2027-11-12" in response.json()["detail"]
        assert calls == ["/api/v1/plan"]
        assert client.app.state.transitous.budget_left() == 2
