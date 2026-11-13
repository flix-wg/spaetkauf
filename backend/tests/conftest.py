import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text())


class FakeTransitous:
    """MockTransport serving recorded responses and counting calls per path."""

    def __init__(self):
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append(path)
        if path.endswith("/geocode"):
            return httpx.Response(200, json=fixture("geocode_hamburg.json"))
        if path.endswith("/plan"):
            return httpx.Response(200, json=fixture("plan_ham_muc.json"))
        if path.endswith("/stoptimes"):
            return httpx.Response(200, json=fixture("stoptimes_hamburg.json"))
        if path.endswith("/trip"):
            return httpx.Response(200, json=fixture("trip_ice514.json"))
        return httpx.Response(404)


@pytest.fixture
def settings(tmp_path):
    return Settings(db_path=tmp_path / "t.sqlite", plan_budget=3, loop=False)


@pytest.fixture
def fake():
    return FakeTransitous()


@pytest.fixture
def client(settings, fake):
    with TestClient(create_app(settings, httpx.MockTransport(fake))) as c:
        yield c
