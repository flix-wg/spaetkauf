"""One asyncio task that runs periodic jobs."""

import asyncio
import logging
import time

from fastapi import FastAPI

from . import push
from .board import refresh_board
from .db import purge
from .tracker import track_trips

log = logging.getLogger("spaetkauf.loop")


def jobs(app: FastAPI) -> list[tuple[str, float, object]]:
    """(name, interval seconds, async callable)."""
    tr = app.state.transitous
    notify = getattr(app.state, "notify", push.send)
    return [
        ("board", 300, lambda: refresh_board(tr)),
        ("trips", 120, lambda: track_trips(tr, notify)),
        ("purge", 3600, lambda: asyncio.to_thread(purge, tr.settings.db_path)),
    ]


async def run_loop(app: FastAPI) -> None:
    due: dict[str, float] = {}
    while True:
        for name, interval, fn in jobs(app):
            if time.monotonic() < due.get(name, 0):
                continue
            due[name] = time.monotonic() + interval
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("job %s failed: %s", name, type(exc).__name__)
        await asyncio.sleep(5)
