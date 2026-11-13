"""Risk signals (design D11): Exa news search per corridor and date, Context.dev change banners.

Display only. Results on Deutsche Bahn hosts are dropped and never fetched.
"""

import asyncio
import hashlib
import hmac
import json
import os
import re
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Query, Request, Response

from .config import Settings
from .db import connect

router = APIRouter()

EXA_URL = "https://api.exa.ai/search"
DB_HOSTS = (
    "bahn.de",
    "deutschebahn.com",
    "dbregio.de",
    "db.de",
    "bahnhof.de",
    "inside-bahn.de",
)
CACHE_TTL = 6 * 3600
LOOKBACK_DAYS = 21
BANNER_DAYS = 7
MAX_ITEMS = 5
MAX_BANNERS = 3
KINDS = {"strike", "works", "weather", "event", "other"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS signals_cache (
  key TEXT PRIMARY KEY, fetched_at REAL NOT NULL, items TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS context_changes (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, url TEXT NOT NULL,
  title TEXT, summary TEXT, changed_at TEXT NOT NULL
);
"""
_locks: dict[str, asyncio.Lock] = {}


def ensure_schema(conn) -> None:
    with conn:
        conn.executescript(SCHEMA)


def is_db_host(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == d or host.endswith("." + d) for d in DB_HOSTS)


def city(name: str) -> str:
    name = re.sub(r"\(.*?\)", " ", name)
    name = re.sub(
        r"\b(Hbf|Hauptbahnhof|Bahnhof|Bf|Central|Main Station)\b\.?", " ", name, flags=re.IGNORECASE
    )
    return re.sub(r"\s+", " ", name).strip(" ,-")


def _utc_iso(value: str | None) -> str:
    try:
        dt = datetime.fromisoformat(value or "")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC).isoformat(timespec="seconds")
    except ValueError:
        return datetime.now(UTC).isoformat(timespec="seconds")


def exa_body(a: str, b: str, date: str) -> dict:
    since = datetime.now(UTC) - timedelta(days=LOOKBACK_DAYS)
    question = (
        "Does this article report a rail strike, track closure, construction, weather or event "
        f"that affects long-distance trains between {a} and {b} around {date}? "
        "Answer in English, one sentence."
    )
    return {
        "query": f"Streik OR Warnstreik OR Streckensperrung OR Bauarbeiten OR Sturm Bahn "
        f"Fernverkehr {a} {b}",
        "type": "auto",
        "category": "news",
        "numResults": 8,
        "startPublishedDate": since.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "excludeDomains": list(DB_HOSTS),
        "contents": {
            "text": {"maxCharacters": 1500},
            "summary": {
                "query": question,
                "schema": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": sorted(KINDS)},
                        "relevant": {"type": "boolean"},
                        "date_from": {"type": "string", "description": "YYYY-MM-DD or empty"},
                        "date_to": {"type": "string", "description": "YYYY-MM-DD or empty"},
                        "reason": {"type": "string"},
                    },
                    "required": ["kind", "relevant", "reason"],
                },
            },
        },
    }


def covers(summary: dict, date: str) -> bool:
    start, end = summary.get("date_from") or "", summary.get("date_to") or ""
    if not end and summary.get("kind") != "strike":
        end = start
    return not (start and start > date) and not (end and end < date)


def parse_results(results: list, date: str) -> list[dict]:
    items = []
    for r in results or []:
        if not isinstance(r, dict):
            continue
        url = r.get("url") or ""
        if not url.startswith(("http://", "https://")) or is_db_host(url):
            continue
        summary = r.get("summary")
        if isinstance(summary, str):
            try:
                summary = json.loads(summary)
            except ValueError:
                continue
        if not isinstance(summary, dict) or summary.get("relevant") is not True:
            continue
        if not covers(summary, date):
            continue
        kind = summary.get("kind")
        items.append(
            {
                "kind": kind if kind in KINDS else "other",
                "reason": str(summary.get("reason") or r.get("title") or "")[:300],
                "source": (urlparse(url).hostname or "").removeprefix("www."),
                "published": (r.get("publishedDate") or "")[:10] or None,
                "url": url,
            }
        )
        if len(items) == MAX_ITEMS:
            break
    return items


async def _search(request: Request, settings: Settings, a: str, b: str, date: str) -> list[dict]:
    async with httpx.AsyncClient(
        timeout=15,
        headers={"User-Agent": settings.client_name, "x-api-key": settings.exa_key},
        transport=getattr(request.app.state, "signals_transport", None),
    ) as client:
        resp = await client.post(EXA_URL, json=exa_body(a, b, date))
        resp.raise_for_status()
        return parse_results(resp.json().get("results"), date)


def banners(conn) -> list[dict]:
    since = (datetime.now(UTC) - timedelta(days=BANNER_DAYS)).isoformat(timespec="seconds")
    rows = conn.execute(
        "SELECT source, url, changed_at FROM context_changes WHERE changed_at >= ? "
        "ORDER BY changed_at DESC LIMIT ?",
        (since, MAX_BANNERS),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/api/signals")
async def get_signals(
    request: Request,
    from_: str = Query(alias="from", min_length=2, max_length=80),
    to: str = Query(min_length=2, max_length=80),
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    settings = getattr(request.app.state, "settings", None) or Settings.from_env()
    a, b = city(from_), city(to)
    conn = connect(settings.db_path)
    ensure_schema(conn)
    key = hashlib.sha256(f"{a.casefold()}|{b.casefold()}|{date}".encode()).hexdigest()
    status, items, checked = "unavailable", [], time.time()
    try:
        async with _locks.setdefault(key, asyncio.Lock()):
            row = conn.execute(
                "SELECT fetched_at, items FROM signals_cache WHERE key = ?", (key,)
            ).fetchone()
            if row and time.time() - row["fetched_at"] < CACHE_TTL:
                items, checked = json.loads(row["items"]), row["fetched_at"]
                status = "ok" if items else "empty"
            elif settings.exa_key and a and b:
                try:
                    items = await _search(request, settings, a, b, date)
                except (httpx.HTTPError, ValueError, AttributeError):
                    items = []
                else:
                    status = "ok" if items else "empty"
                    checked = time.time()
                    with conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO signals_cache(key, fetched_at, items) VALUES (?, ?, ?)",
                            (key, checked, json.dumps(items)),
                        )
        return {
            "status": status,
            "checked_at": datetime.fromtimestamp(checked, UTC).isoformat(timespec="seconds"),
            "items": items,
            "banners": banners(conn),
        }
    finally:
        conn.close()


def verify_signature(raw: bytes, header: str, secrets: list[str]) -> bool:
    parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
    ts, sig = parts.get("t", ""), parts.get("v1", "")
    if not re.fullmatch(r"\d{1,12}", ts) or not re.fullmatch(r"[0-9a-fA-F]{64}", sig):
        return False
    if abs(time.time() - int(ts)) > 300:
        return False
    msg = ts.encode() + b"." + raw
    return any(
        hmac.compare_digest(hmac.new(s.encode(), msg, hashlib.sha256).hexdigest(), sig.lower())
        for s in secrets
    )


@router.post("/hooks/context", status_code=204)
async def context_hook(request: Request):
    # Context.dev signs per monitor, so CONTEXT_WEBHOOK_SECRET may hold several, comma separated
    secrets = [
        s.strip() for s in os.environ.get("CONTEXT_WEBHOOK_SECRET", "").split(",") if s.strip()
    ]
    raw = await request.body()
    header = request.headers.get("x-context-signature", "")
    if not secrets or not verify_signature(raw, header, secrets):
        return Response(status_code=401)
    try:
        event = json.loads(raw)
        change = event["data"]["change"] if event.get("event") == "change.detected" else None
    except (ValueError, KeyError, TypeError, AttributeError):
        return Response(status_code=400)
    url = (change or {}).get("url") or ""
    if not url.startswith(("http://", "https://")) or is_db_host(url):
        return Response(status_code=204)
    event_id = request.headers.get("x-context-id") or event.get("id") or change.get("id")
    settings = getattr(request.app.state, "settings", None) or Settings.from_env()
    conn = connect(settings.db_path)
    try:
        ensure_schema(conn)
        with conn:
            conn.execute(
                "INSERT OR IGNORE INTO context_changes(id, source, url, title, summary, changed_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    str(event_id),
                    (urlparse(url).hostname or "").removeprefix("www."),
                    url,
                    change.get("title"),
                    change.get("summary"),
                    _utc_iso(change.get("detected_at") or event.get("created_at")),
                ),
            )
    finally:
        conn.close()
    return Response(status_code=204)
