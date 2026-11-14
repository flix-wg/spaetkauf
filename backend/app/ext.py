"""Historical odds and structural selector adaptation for the browser extension."""

import asyncio
import hashlib
import json
import logging
import re
from contextlib import closing
from datetime import UTC, datetime, time, timedelta
from datetime import date as Date
from typing import Annotated
from urllib.parse import urlencode

import anthropic
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator

from . import odds, picks
from .db import connect
from .matching import LONG_DISTANCE_TYPES, parse_train

router = APIRouter(prefix="/api/ext")
log = logging.getLogger(__name__)
Clock = Annotated[str, Field(pattern=r"^\d{2}:\d{2}$")]
Train = Annotated[str, Field(max_length=20)]
LINE = re.compile(
    r"(?:  ){0,60}(?:#shadow|[a-z][a-z0-9-]{0,40}"
    r"(?:\.[A-Za-z_-][A-Za-z0-9_-]{0,63})*"
    r"(?:\[(?:(?:aria|data)-[a-z0-9-]{1,40}|role=[a-z]{1,30})\])*)"
    r"(?: (?:TIME|TRAIN|PRICE|DUR|TEXT))*"
)
SPEC_KEYS = ("card", "train", "dep", "arr")
SPEC_SCHEMA = {
    "type": "object",
    "properties": {key: {"type": "string"} for key in SPEC_KEYS},
    "required": list(SPEC_KEYS),
    "additionalProperties": False,
}
SYSTEM = """This skeleton shows a Deutsche Bahn connection results list. One line per element:
indentation is depth; tag, .classes, [attribute names]; TIME/TRAIN/PRICE/DUR/TEXT describe
its own text only. #shadow is an open shadow root. Return standard CSS selectors:
card matches one element per connection containing departure, arrival and train names;
exclude price/booking areas if a smaller element holds those three. train/dep/arr are
relative to card. Prefer stable class or attribute selectors present in the skeleton.
Avoid :nth-child unless unavoidable."""


class Connection(BaseModel):
    dep: Clock
    arr: Clock
    trains: list[Train] = Field(max_length=12)
    date: Date | None = None
    posted: bool = False

    @field_validator("dep", "arr")
    @classmethod
    def valid_clock(cls, value):
        time.fromisoformat(value)
        return value


class OddsRequest(BaseModel):
    from_: str | None = Field(default=None, alias="from", max_length=80)
    to: str = Field(min_length=1, max_length=80)
    to_eva: str | None = Field(default=None, pattern=r"^\d{6,9}$")
    date: Date
    connections: list[Connection] = Field(max_length=30)


TRANSIT_WAIT = 4  # seconds; the extension gives up after 8


async def route_legs(request: Request, body: OddsRequest) -> dict[tuple[str, str], list[dict]]:
    """Transitous legs for the page's route, keyed by (local departure, last train), so a change
    counts as in the app. bahn.de cards show no change station or leg times without a click.
    Empty without a start station, or when Transitous fails or takes longer than TRANSIT_WAIT."""
    tr = getattr(request.app.state, "transitous", None)
    if tr is None or not body.from_ or not body.connections:
        return {}
    first = min(body.connections, key=lambda c: (c.date or body.date, c.dep))
    day = first.date or body.date
    start = datetime.combine(day, time.fromisoformat(first.dep), odds.BERLIN)

    async def look() -> dict[tuple[str, str], list[dict]]:
        src, src_name = await picks.resolve(tr, body.from_)
        dst, dst_name = await picks.resolve(tr, body.to)
        found, _ = await picks.fetch(tr, src, dst, start, day)
        out = {}
        for p in found:
            picks.fill_names(p["legs"], src_name or body.from_, dst_name or body.to)
            dep = datetime.fromisoformat(p["dep"]).astimezone(odds.BERLIN).strftime("%H:%M")
            last = parse_train(p["legs"][-1]["train"])
            if last:
                out.setdefault((dep, " ".join(last)), p["legs"])
        return out

    try:
        return await asyncio.wait_for(look(), TRANSIT_WAIT)
    except Exception as exc:  # noqa: BLE001  any failure keeps the last train's odds
        log.info("extension route lookup failed: %s", type(exc).__name__)
        return {}


@router.post("/odds")
async def extension_odds(body: OddsRequest, request: Request):
    conn = picks.odds_conn(request)
    by_route = await route_legs(request, body)
    stop = body.to
    if body.to_eva:
        row = conn.execute(
            "SELECT station_name FROM train_stop_stats WHERE eva = ? LIMIT 1", (body.to_eva,)
        ).fetchone()
        if row:
            stop = row[0]
    results = []
    page = []  # the page's connections as ride-instead candidates
    for i, connection in enumerate(body.connections):
        day = connection.date or body.date
        dep = datetime.combine(day, time.fromisoformat(connection.dep), odds.BERLIN)
        arr = datetime.combine(day, time.fromisoformat(connection.arr), odds.BERLIN)
        if connection.arr <= connection.dep:
            arr += timedelta(days=1)
        result = {
            "i": i,
            "p20": None,
            "p60": None,
            "n": None,
            "late": None,
            "weekday": odds.WEEKDAYS[arr.weekday()],
            "basis": "none",
            "train": None,
            "kurt": False,
        }
        trains = [parse_train(re.sub(r"(?<=[A-Za-z])(?=\d)", " ", t)) for t in connection.trains]
        names = [" ".join(t) if t else raw for t, raw in zip(trains, connection.trains)]
        page.append({
            "id": i, "dep": dep.isoformat(), "arr": arr.isoformat(), "changes": len(names) - 1,
            "cancelled": connection.posted,  # a posted delay is no safe backup either
            "legs": [{"trip_id": f"{day}:{n}", "train": n, "from": "", "to": ""} for n in names],
        })  # fmt: skip
        last = trains[-1] if trains else None
        if last and last[0] in LONG_DISTANCE_TYPES:
            train = " ".join(last)
            result.update(
                odds.connection_odds(
                    conn,
                    [
                        {
                            "train": train,
                            "to": stop,
                            "dep": dep.astimezone(UTC).isoformat(),
                            "arr": arr.astimezone(UTC).isoformat(),
                        }
                    ],
                )
            )
            if result["p20"] is not None:
                result.update(train=train, basis="history" if len(trains) == 1 else "last_train")
            legs = by_route.get((connection.dep, train))
            if result["p20"] is not None and legs and len(legs) > 1:
                both = odds.connection_odds(conn, legs)
                if both["p20"] is not None:
                    result.update(both, train=train)  # basis "estimate", the same number as the app
        results.append(result)
    eligible = [
        r
        for r in results
        if not body.connections[r["i"]].posted
        and r["p20"] is not None
        and r["p20"] >= picks.KURT_MIN_P20
        # Same rule as the app: a pick needs another train on this page to switch to.
        and picks.ride_instead(page[r["i"]], page)
    ]
    kurt = max(eligible, key=lambda r: r["p20"])["i"] if eligible else None
    if kurt is not None:
        results[kurt]["kurt"] = True
    selected = body.connections[kurt if kurt is not None else 0] if body.connections else None
    at = selected.dep if selected else "00:00"
    day = (selected.date if selected else None) or body.date
    params = {"tn": body.to, "date": day.isoformat(), "time": at}
    if body.from_:
        params.update({"from": body.from_, "to": body.to, "fn": body.from_})
    link = ("/picks?" if body.from_ else "/?") + urlencode(params)
    return {
        "to": body.to,
        "date": body.date.isoformat(),
        "kurt": kurt,
        "link": link,
        "results": results,
    }


class AdaptRequest(BaseModel):
    skeleton: str = Field(max_length=100000)
    hash: str

    @field_validator("skeleton", mode="before")
    @classmethod
    def skeleton_size(cls, value):
        if isinstance(value, str) and len(value) > 100000:
            raise HTTPException(422, "Skeleton too large")
        return value

    @model_validator(mode="after")
    def valid_skeleton(self):
        lines = self.skeleton.split("\n")
        if len(lines) > 2000:
            raise HTTPException(422, "Too many skeleton lines")
        for i, line in enumerate(lines, 1):
            if not LINE.fullmatch(line):
                raise HTTPException(422, f"Invalid skeleton line {i}")
        if hashlib.sha256(self.skeleton.encode()).hexdigest() != self.hash:
            raise HTTPException(422, "Skeleton hash mismatch")
        return self


async def ask_model(api_key: str, skeleton: str) -> dict:
    """Ask for selectors using structure alone."""
    async with anthropic.AsyncAnthropic(api_key=api_key, timeout=20.0, max_retries=1) as client:
        message = await client.messages.create(
            model="claude-haiku-5-5",
            max_tokens=4096,
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": SPEC_SCHEMA},
            },
            system=SYSTEM,
            messages=[{"role": "user", "content": skeleton}],
        )
    if message.stop_reason != "end_turn":
        raise ValueError("Incomplete model response")
    block = next((block for block in message.content if block.type == "text"), None)
    if block is None:
        raise ValueError("Missing model response")
    return json.loads(block.text)


def valid_spec(spec):
    return (
        isinstance(spec, dict)
        and set(spec) == set(SPEC_KEYS)
        and all(
            isinstance(value, str)
            and 1 <= len(value) <= 200
            and not re.search(r"[<>{};\\\r\n]", value)
            and "javascript" not in value.lower()
            for value in spec.values()
        )
    )


@router.post("/adapt")
async def adapt(body: AdaptRequest, request: Request):
    settings = request.app.state.settings
    now = datetime.now(UTC)
    stamp, day = now.isoformat(), now.astimezone(odds.BERLIN).date().isoformat()
    with closing(connect(settings.db_path)) as conn:
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM ext_adapt WHERE hash = ?", (body.hash,)).fetchone()
            if row:
                updated = datetime.fromisoformat(row["updated_at"])
                if row["status"] == "ok":
                    return {"spec": json.loads(row["spec"]), "cached": True}
                if row["status"] == "pending" and (now - updated).total_seconds() < 120:
                    raise HTTPException(409, "Layout is being processed")
                if (
                    row["status"] == "failed"
                    and updated.astimezone(odds.BERLIN).date().isoformat() == day
                ):
                    raise HTTPException(422, "No selector spec for this layout")
            if not settings.anthropic_key:
                raise HTTPException(503, "Adapter not configured")
            used = conn.execute(
                "SELECT used FROM ext_adapt_budget WHERE day = ?", (day,)
            ).fetchone()
            if (used[0] if used else 0) >= settings.adapt_daily_cap:
                raise HTTPException(429, "Adapter limit reached for today")
            conn.execute(
                "INSERT INTO ext_adapt VALUES (?, 'pending', NULL, ?) ON CONFLICT(hash) "
                "DO UPDATE SET status = 'pending', spec = NULL, updated_at = excluded.updated_at",
                (body.hash, stamp),
            )
            conn.execute(
                "INSERT INTO ext_adapt_budget VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET used = used + 1",
                (day,),
            )
        try:
            spec = await ask_model(settings.anthropic_key, body.skeleton)
            if not valid_spec(spec):
                raise ValueError("Invalid selector spec")
        except Exception:  # noqa: BLE001 — model failures must persist without logging payloads
            with conn:
                conn.execute(
                    "UPDATE ext_adapt SET status = 'failed', updated_at = ? "
                    "WHERE hash = ? AND updated_at = ?",
                    (datetime.now(UTC).isoformat(), body.hash, stamp),
                )
            log.info("Adapter %s failed", body.hash[:12])
            raise HTTPException(502, "Selector adaptation failed") from None
        with conn:
            conn.execute(
                "UPDATE ext_adapt SET status = 'ok', spec = ?, updated_at = ? "
                "WHERE hash = ? AND updated_at = ?",
                (json.dumps(spec), datetime.now(UTC).isoformat(), body.hash, stamp),
            )
    log.info("Adapter %s ok", body.hash[:12])
    return {"spec": spec, "cached": False}
