"""Web Push with VAPID keys from the environment (design D10)."""

import asyncio
import json
import logging
import os
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from pywebpush import WebPushException, webpush

from .db import connect

log = logging.getLogger("spaetkauf.push")
router = APIRouter(prefix="/api/push")
DEFAULT_SUBJECT = "mailto:demo@spaetkauf.invalid"
PUSH_HOSTS = ("fcm.googleapis.com", "updates.push.services.mozilla.com")
PUSH_SUFFIXES = (".push.apple.com", ".notify.windows.com")


def check_subscription(sub: dict | None) -> dict | None:
    """Only https endpoints on the browser push services: the server POSTs to this URL."""
    if sub is None:
        return None
    try:
        url = urlsplit(str(sub.get("endpoint") or ""))
        host, port = (url.hostname or "").lower(), url.port
    except ValueError:
        url, host, port = urlsplit(""), "", None
    ok = host in PUSH_HOSTS or host.endswith(PUSH_SUFFIXES)
    if url.scheme != "https" or not ok or port not in (None, 443) or "@" in url.netloc:
        raise ValueError(
            "push endpoint must be an https URL of a browser push service "
            "(Chrome, Firefox, Safari or Edge)"
        )
    return sub


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
        subscription = check_subscription(json.loads(row["push"]))
        await asyncio.to_thread(_post, subscription, payload, private_key, subject)
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
