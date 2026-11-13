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
