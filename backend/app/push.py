"""Web Push with VAPID keys from the environment (design D10)."""

import asyncio
import json
import logging
import os

from fastapi import APIRouter, HTTPException
from pywebpush import WebPushException, webpush

from .db import connect

log = logging.getLogger("spaetkauf.push")
router = APIRouter(prefix="/api/push")
DEFAULT_SUBJECT = "mailto:demo@spaetkauf.invalid"


@router.get("/key")
def public_key():
    key = os.environ.get("VAPID_PUBLIC_KEY")
    if not key:
        raise HTTPException(404, "Push is not set up on this server: VAPID_PUBLIC_KEY is empty.")
    return {"public_key": key}


def _post(subscription: dict, payload: dict, private_key: str, subject: str) -> None:
    webpush(
        subscription,
        json.dumps(payload),
        vapid_private_key=private_key,
        vapid_claims={"sub": subject},
        ttl=3600,
        timeout=10,
    )


async def send(db_path, row: dict, payload: dict) -> bool:
    """Push to the trip's stored subscription; drop it when the push service says it is gone."""
    if not row.get("push"):
        return False
    private_key = os.environ.get("VAPID_PRIVATE_KEY")
    if not private_key:
        log.info("push for trip %s skipped: no VAPID key", row["id"])
        return False
    subject = os.environ.get("VAPID_SUBJECT") or DEFAULT_SUBJECT
    try:
        await asyncio.to_thread(_post, json.loads(row["push"]), payload, private_key, subject)
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            conn = connect(db_path)
            with conn:
                conn.execute("UPDATE trips SET push = NULL WHERE id = ?", (row["id"],))
            conn.close()
        log.warning("push for trip %s failed: HTTP %s", row["id"], status)
        return False
    except Exception as exc:  # noqa: BLE001
        log.warning("push for trip %s failed: %s", row["id"], type(exc).__name__)
        return False
    return True
