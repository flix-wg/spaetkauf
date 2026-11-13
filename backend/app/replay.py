"""Replay of a recorded real trip on a compressed clock (design D9)."""

import asyncio
import json
import logging
import time
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from . import push
from .db import connect
from .tracker import BERLIN, finish, record
from .trips import create_trip

log = logging.getLogger("spaetkauf.replay")
router = APIRouter(prefix="/api/demo")
MIN_SNAPSHOTS = 8
PLAY_SECONDS = 60.0
FIRST_CROSSING_BY = 25.0
LEAD_IN = 2.0
FRAMES_BEFORE = 3


def best_recording(db_path) -> dict | None:
    conn = connect(db_path)
    row = conn.execute(
        """
        SELECT t.*, COUNT(*) AS n, MAX(s.delay_min) AS worst, MIN(s.delay_min) AS best
        FROM trips t JOIN trip_snapshots s ON s.trip_id = t.id
        WHERE t.is_replay = 0 AND (t.finished_at IS NOT NULL OR t.auto = 1)
        GROUP BY t.id
        HAVING n >= ? AND worst >= 20
        ORDER BY worst >= 60 DESC, best < 20 DESC, t.finished_at IS NOT NULL DESC, n DESC
        LIMIT 1
        """,
        (MIN_SNAPSHOTS,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def schedule(snaps: list[dict]) -> list[tuple[float, dict]]:
    """(seconds after start, snapshot): whole trip in about PLAY_SECONDS, first +20 early."""
    snaps = [s for s in snaps if s["delay_min"] is not None or s["cancelled"]]
    first = next(i for i, s in enumerate(snaps) if s["cancelled"] or (s["delay_min"] or 0) >= 20)
    start = max(0, first - FRAMES_BEFORE)

    def offsets(start: int) -> list[float]:
        t = [datetime.fromisoformat(s["at"]) for s in snaps[start:]]
        span = (t[-1] - t[0]).total_seconds()
        n = len(t) - 1
        return [
            LEAD_IN
            + (PLAY_SECONDS - LEAD_IN)
            * ((x - t[0]).total_seconds() / span if span > 0 else (i / n if n else 0))
            for i, x in enumerate(t)
        ]

    while start < first and offsets(start)[first - start] > FIRST_CROSSING_BY:
        start += 1
    return list(zip(offsets(start), snaps[start:]))


async def drive(app) -> None:
    """Short-interval task that exists only while replays are active."""
    replays: dict = app.state.replays
    db_path = app.state.settings.db_path
    while replays:
        for trip_id, r in list(replays.items()):
            elapsed = time.monotonic() - r["started"]
            try:
                while r["next"] < len(r["frames"]) and r["frames"][r["next"]][0] <= elapsed:
                    snap = dict(r["frames"][r["next"]][1])
                    snap["raw"] = json.loads(snap.get("raw") or "{}")
                    notify = getattr(app.state, "notify", push.send)
                    await record(db_path, trip_id, snap, datetime.now(UTC), notify)
                    r["next"] += 1
                if r["next"] == len(r["frames"]):
                    last = r["frames"][-1][1]["delay_min"]
                    finish(db_path, trip_id, last, datetime.now(UTC))
                    del replays[trip_id]
            except Exception as exc:  # noqa: BLE001
                log.warning("replay %s stopped: %s", trip_id, type(exc).__name__)
                replays.pop(trip_id, None)
        await asyncio.sleep(0.5)


class ReplayBody(BaseModel):
    push: dict | None = None
    price_eur: Decimal | None = Field(default=None, gt=0, le=3000, decimal_places=2)


@router.post("/replay")
async def start_replay(request: Request, body: ReplayBody | None = None):
    app = request.app
    db_path = app.state.settings.db_path
    rec = best_recording(db_path)
    if rec is None:
        raise HTTPException(
            404,
            "No recording yet: a replay needs a tracked trip with at least "
            f"{MIN_SNAPSHOTS} snapshots that reached +20 min.",
        )
    conn = connect(db_path)
    snaps = [
        dict(s)
        for s in conn.execute(
            "SELECT * FROM trip_snapshots WHERE trip_id = ? ORDER BY at, rowid", (rec["id"],)
        ).fetchall()
    ]
    conn.close()
    pick = json.loads(rec["pick"])
    day = datetime.fromisoformat(pick.get("arr") or snaps[0]["at"]).astimezone(BERLIN)
    body = body or ReplayBody()
    trip_id, secret = create_trip(
        db_path, pick, body.price_eur, body.push, replay_of=day.date().isoformat()
    )
    if not hasattr(app.state, "replays"):
        app.state.replays = {}
    app.state.replays[trip_id] = {
        "frames": schedule(snaps),
        "started": time.monotonic(),
        "next": 0,
    }
    task = getattr(app.state, "replay_task", None)
    if task is None or task.done():
        app.state.replay_task = asyncio.create_task(drive(app))
    return {"trip_id": trip_id, "secret": secret}
