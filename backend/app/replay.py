"""Replay of a real trip on a compressed clock (design D9).

Two sources, both real: `live` recordings are snapshots this server tracked (the delay is the
forecast for the destination); `history` runs come from data/replays.json, built from the DB delay
dataset (the delay is the one measured at each stop the train passed, one frame per stop).
"""

import asyncio
import json
import logging
import time
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from . import push
from .config import REPO_ROOT
from .db import connect
from .tracker import BERLIN, finish, record
from .trips import create_trip

log = logging.getLogger("spaetkauf.replay")
router = APIRouter(prefix="/api/demo")
HISTORY = REPO_ROOT / "data" / "replays.json"
MIN_SNAPSHOTS = 8
PLAY_SECONDS = 60.0
FIRST_CROSSING_BY = 25.0
LEAD_IN = 2.0


def _name(stop) -> str | None:
    return stop.get("name") if isinstance(stop, dict) else stop


def _day(pick: dict, fallback: str) -> str:
    ts = pick.get("arr") or fallback
    return datetime.fromisoformat(ts).astimezone(BERLIN).date().isoformat()


def _flags(delays: list[int]) -> dict:
    """crosses_20: starts under 20 and reaches it later; crosses_60: reaches 20 before 60."""
    first20 = next((d for d in delays if d >= 20), None)
    return {
        "max_delay_min": max(delays),
        "crosses_20": delays[0] < 20 and first20 is not None,
        "crosses_60": first20 is not None and first20 < 60 and max(delays) >= 60,
    }


def _live(db_path) -> list[dict]:
    conn = connect(db_path)
    rows = conn.execute(
        """
        SELECT t.* FROM trips t JOIN trip_snapshots s ON s.trip_id = t.id
        WHERE t.is_replay = 0 AND t.auto = 1
          AND s.delay_min IS NOT NULL
        GROUP BY t.id HAVING COUNT(*) >= ? AND MAX(s.delay_min) >= 20
        """,
        (MIN_SNAPSHOTS,),
    ).fetchall()
    out = []
    for row in rows:
        delays = [
            d
            for (d,) in conn.execute(
                "SELECT delay_min FROM trip_snapshots WHERE trip_id = ? AND delay_min IS NOT NULL"
                " ORDER BY at, rowid",
                (row["id"],),
            )
        ]
        pick = json.loads(row["pick"])
        legs = pick.get("legs") or [{}]
        out.append(
            {
                "id": f"live:{row['id']}",
                "source": "live",
                "delay_basis": "destination_forecast",
                "train": legs[0].get("train"),
                "from": _name(legs[0].get("from")),
                "to": _name(legs[-1].get("to")),
                "date": _day(pick, row["created_at"]),
                "frames": len(delays),
                "finished": row["finished_at"] is not None,
                **_flags(delays),
            }
        )
    conn.close()
    return out


def _history_runs() -> list[dict]:
    return json.loads(HISTORY.read_text())["runs"] if HISTORY.is_file() else []


def _history() -> list[dict]:
    out = []
    for run in _history_runs():
        delays = [s["delay_min"] for s in run["stops"] if s["delay_min"] is not None]
        out.append(
            {
                "id": f"history:{run['id']}",
                "source": "history",
                "delay_basis": "at_stop",
                "train": run["train"],
                "from": run["from"],
                "to": run["to"],
                "date": run["date"],
                "frames": len(delays),
                "finished": True,
                **_flags(delays),
            }
        )
    return out


def recordings(db_path) -> list[dict]:
    """All playable recordings, best first: crossings first, live before history."""
    found = _live(db_path) + _history()
    order = {r["id"]: i for i, r in enumerate(found)}
    return sorted(
        found,
        key=lambda r: (
            not r["crosses_20"],
            not r["crosses_60"],
            r["source"] != "live",
            order[r["id"]],
        ),
    )


def best_recording(db_path) -> dict | None:
    found = recordings(db_path)
    return found[0] if found else None


def _material(db_path, rec_id: str) -> tuple[dict, list[dict], str]:
    """(pick, frames, original date) of one recording; frames are snapshot dicts in order."""
    source, _, key = rec_id.partition(":")
    if source == "history":
        run = next(r for r in _history_runs() if r["id"] == key)
        leg = {
            "train": run["train"],
            "from": run["from"],
            "to": run["to"],
            "dep": run["dep"],
            "arr": run["arr"],
            "trip_id": None,
        }
        pick = {"id": run["id"], "dep": run["dep"], "arr": run["arr"], "changes": 0, "legs": [leg]}
        last = len(run["stops"]) - 1
        frames = [
            {
                "at": s["planned_arr"],
                "delay_min": s["delay_min"],
                "expected_arr": s["actual_arr"] if i == last else None,
                "cancelled": s["cancelled"],
                "raw": {
                    "basis": "at_stop",
                    "stop": s["stop"],
                    "planned_arr": s["planned_arr"],
                    "actual_arr": s["actual_arr"],
                },
            }
            for i, s in enumerate(run["stops"])
        ]
        return pick, frames, run["date"]
    conn = connect(db_path)
    row = conn.execute("SELECT * FROM trips WHERE id = ?", (key,)).fetchone()
    snaps = [
        {**dict(s), "raw": json.loads(s["raw"] or "{}")}
        for s in conn.execute(
            "SELECT * FROM trip_snapshots WHERE trip_id = ? ORDER BY at, rowid", (key,)
        ).fetchall()
    ]
    conn.close()
    pick = json.loads(row["pick"])
    return pick, snaps, _day(pick, snaps[0]["at"])


def schedule(snaps: list[dict]) -> list[tuple[float, dict]]:
    """(seconds after start, snapshot): whole trip in about PLAY_SECONDS, first +20 early.

    Frames are only dropped from the front, and only when the first +20 would otherwise come
    after FIRST_CROSSING_BY."""
    snaps = [s for s in snaps if s["delay_min"] is not None or s["cancelled"]]
    first = next(i for i, s in enumerate(snaps) if s["cancelled"] or (s["delay_min"] or 0) >= 20)

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

    start = 0
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
                    snap = r["frames"][r["next"]][1]
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


@router.get("/recordings")
def list_recordings(request: Request):
    return recordings(request.app.state.settings.db_path)


class ReplayBody(BaseModel):
    push: dict | None = None
    price_eur: Decimal | None = Field(default=None, gt=0, le=3000, decimal_places=2)
    _check_push = field_validator("push")(lambda cls, v: push.check_subscription(v))
    recording: str | None = None


@router.post("/replay")
async def start_replay(request: Request, body: ReplayBody | None = None):
    app = request.app
    db_path = app.state.settings.db_path
    body = body or ReplayBody()
    found = recordings(db_path)
    if body.recording:
        found = [r for r in found if r["id"] == body.recording]
    if not found:
        raise HTTPException(
            404, "No such recording." if body.recording else "No recording to replay yet."
        )
    rec = found[0]
    pick, frames, day = _material(db_path, rec["id"])
    trip_id, secret = create_trip(db_path, pick, body.price_eur, body.push, replay_of=day)
    if not hasattr(app.state, "replays"):
        app.state.replays = {}
    app.state.replays[trip_id] = {
        "frames": schedule(frames),
        "started": time.monotonic(),
        "next": 0,
    }
    task = getattr(app.state, "replay_task", None)
    if task is None or task.done():
        app.state.replay_task = asyncio.create_task(drive(app))
    return {"trip_id": trip_id, "secret": secret, "recording": rec}
