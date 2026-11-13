"""Only route and live source (design D3). Never talks to a DB host."""

import asyncio
import json
import time
from datetime import UTC, datetime

import httpx

from .config import Settings
from .db import connect

BASE = "https://api.transitous.org"
LONG_DISTANCE = "HIGHSPEED_RAIL,LONG_DISTANCE"
TTL = {"plan": 600, "trip": 60, "stoptimes": 120, "geocode": 86400}


class BudgetSpent(Exception):
    """The daily /plan budget is used up."""


class SourceUnavailable(Exception):
    """Transitous failed or timed out."""


class Transitous:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.last_ok: bool | None = None
        self._client = httpx.AsyncClient(
            base_url=BASE,
            timeout=10,
            headers={"User-Agent": settings.client_name},
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def budget_left(self) -> int:
        day = datetime.now(UTC).date().isoformat()
        conn = connect(self.settings.db_path)
        row = conn.execute("SELECT used FROM plan_budget WHERE day = ?", (day,)).fetchone()
        conn.close()
        return max(0, self.settings.plan_budget - (row["used"] if row else 0))

    def _spend(self) -> None:
        day = datetime.now(UTC).date().isoformat()
        conn = connect(self.settings.db_path)
        with conn:
            conn.execute("INSERT OR IGNORE INTO plan_budget(day, used) VALUES (?, 0)", (day,))
            cur = conn.execute(
                "UPDATE plan_budget SET used = used + 1 WHERE day = ? AND used < ?",
                (day, self.settings.plan_budget),
            )
        conn.close()
        if cur.rowcount == 0:
            raise BudgetSpent("limit reached for today")

    async def _get(self, kind: str, path: str, params: dict):
        params = {k: v for k, v in params.items() if v is not None}
        key = f"{path}?{json.dumps(params, sort_keys=True)}"
        conn = connect(self.settings.db_path)
        row = conn.execute(
            "SELECT fetched_at, body FROM http_cache WHERE key = ?", (key,)
        ).fetchone()
        conn.close()
        if row and time.time() - row["fetched_at"] < TTL[kind]:
            return json.loads(row["body"])

        last: Exception | None = None
        for attempt in range(2):
            if kind == "plan":
                self._spend()
            try:
                resp = await self._client.get(path, params=params)
                if resp.status_code >= 500:
                    raise httpx.HTTPStatusError("server error", request=resp.request, response=resp)
                resp.raise_for_status()
                data = resp.json()
            except httpx.HTTPStatusError as exc:
                last = exc
                if exc.response.status_code < 500:
                    break
            except (httpx.TransportError, ValueError) as exc:
                last = exc
            else:
                self.last_ok = True
                conn = connect(self.settings.db_path)
                with conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO http_cache(key, fetched_at, body) VALUES (?,?,?)",
                        (key, time.time(), json.dumps(data)),
                    )
                conn.close()
                return data
            if attempt == 0:
                await asyncio.sleep(0.5)
        self.last_ok = False
        raise SourceUnavailable(f"{path}: {type(last).__name__}") from last

    async def geocode(self, text: str) -> list[dict]:
        return await self._get("geocode", "/api/v1/geocode", {"text": text})

    async def plan(
        self,
        from_place: str,
        to_place: str,
        time: str | None = None,
        arrive_by: bool = False,
        cursor: str | None = None,
        num_itineraries: int | None = None,
    ) -> dict:
        return await self._get(
            "plan",
            "/api/v1/plan",
            {
                "fromPlace": from_place,
                "toPlace": to_place,
                "time": time,
                "arriveBy": "true" if arrive_by else None,
                "pageCursor": cursor,
                "numItineraries": num_itineraries,
                "transitModes": LONG_DISTANCE,
            },
        )

    async def trip(self, trip_id: str) -> dict:
        return await self._get("trip", "/api/v1/trip", {"tripId": trip_id})

    async def stoptimes(self, stop_id: str, n: int = 40, radius: int = 200) -> dict:
        return await self._get(
            "stoptimes",
            "/api/v1/stoptimes",
            {"stopId": stop_id, "n": n, "radius": radius, "mode": LONG_DISTANCE},
        )
