"""One asyncio task that runs periodic jobs. Add the trip loop as another entry in `jobs`."""

import asyncio
import logging
import time

from fastapi import FastAPI

from .board import refresh_board

log = logging.getLogger("spaetkauf.loop")


def jobs(app: FastAPI) -> list[tuple[str, float, object]]:
    """(name, interval seconds, async callable)."""
    tr = app.state.transitous
    return [("board", 300, lambda: refresh_board(tr))]


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
