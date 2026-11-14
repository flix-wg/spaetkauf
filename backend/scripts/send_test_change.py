"""Send a signed sample Context.dev change announcing a strike, to demo Kurt's strike call.

    uv run python scripts/send_test_change.py http://localhost:8723 --date 2026-11-16
    uv run python scripts/send_test_change.py http://localhost:8723 --clear

The change is titled "TEST:" and flagged test, so the server marks it `test: true` everywhere.
--clear sends a signed event that deletes all test changes (and re-arms test trip alerts).
Signed like Context.dev with the first secret in CONTEXT_WEBHOOK_SECRET from the repo .env.
"""

import argparse
import json
import os
import sys
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.signals import CLEAR_EVENT, signature

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
GDL_PAGE = "https://www.gdl.de/presse/newsarchiv"
WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September",
          "Oktober", "November", "Dezember"]  # fmt: skip


def read_secret(path: Path = ENV_FILE) -> str:
    value = os.environ.get("CONTEXT_WEBHOOK_SECRET", "")
    if path.is_file():
        for line in path.read_text().splitlines():
            key, sep, rest = line.strip().partition("=")
            if sep and key.strip() == "CONTEXT_WEBHOOK_SECRET":
                value = rest.strip().strip("\"'")
    return next((s.strip() for s in value.split(",") if s.strip()), "")


def sample_change(day: date) -> dict:
    when = f"{WEEKDAYS[day.weekday()]}, {day.day}. {MONTHS[day.month - 1]} {day.year}"
    now = datetime.now(UTC).isoformat(timespec="seconds")
    eid = f"evt_test_{uuid.uuid4().hex[:12]}"
    change = {
        "id": eid,
        "url": GDL_PAGE,
        "title": f"TEST: GDL ruft zum Streik im Personenverkehr am {when} auf",
        "summary": (
            f"TEST: Sample change from send_test_change.py, not a real announcement. "
            f"Strike call for {when}, from 02:00 to 24:00."
        ),
        "detected_at": now,
        "test": True,
    }
    return {"event": "change.detected", "id": eid, "created_at": now, "data": {"change": change}}


def clear_event() -> dict:
    return {"event": CLEAR_EVENT, "id": f"evt_clear_{uuid.uuid4().hex[:12]}"}


def signed(payload: dict, secret: str) -> tuple[bytes, dict]:
    raw = json.dumps(payload).encode()
    ts = str(int(time.time()))
    return raw, {
        "Content-Type": "application/json",
        "X-Context-Signature": f"t={ts},v1={signature(secret, ts, raw)}",
        "X-Context-Id": payload["id"],
    }


def main() -> int:
    tomorrow = datetime.now(ZoneInfo("Europe/Berlin")).date() + timedelta(days=1)
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("base_url", help="e.g. http://localhost:8723")
    ap.add_argument("--date", type=date.fromisoformat, default=tomorrow, help="strike day")
    ap.add_argument("--clear", action="store_true", help="delete all test changes instead")
    args = ap.parse_args()
    secret = read_secret()
    if not secret:
        print("CONTEXT_WEBHOOK_SECRET is not set in .env.", file=sys.stderr)
        return 1
    payload = clear_event() if args.clear else sample_change(args.date)
    raw, headers = signed(payload, secret)
    url = args.base_url.rstrip("/") + "/hooks/context"
    resp = httpx.post(url, content=raw, headers=headers, timeout=15)
    what = "cleared test changes" if args.clear else f"sent test strike for {args.date}"
    print(f"{what}: HTTP {resp.status_code}")
    return 0 if resp.status_code == 204 else 1


if __name__ == "__main__":
    sys.exit(main())
