"""Risk signals (design D11): Exa news search per corridor and date, Context.dev changes.

Exa items and banners are display only. A Context.dev change that announces a strike for the
travel date changes Kurt's call (see picks.kurt_call); the odds never change.
Results on Deutsche Bahn hosts are dropped and never fetched.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import sqlite3
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response

from . import push
from .config import Settings
from .db import connect
from .i18n import lang_from, localize

log = logging.getLogger("spaetkauf.signals")
router = APIRouter()
BERLIN = ZoneInfo("Europe/Berlin")

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
# Part of the cache key: bump when exa_body or parse_results change, so old answers are not served.
CACHE_VERSION = 2
LOOKBACK_DAYS = 21
BANNER_DAYS = 7
MAX_ITEMS = 5
MAX_BANNERS = 3
NOT_BILLED = (httpx.HTTPStatusError, httpx.ConnectError, httpx.ConnectTimeout)
EXA_BUDGET = 150  # searches per UTC day, override with SPAETKAUF_EXA_BUDGET
KINDS = {"strike", "works", "weather", "event", "other"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS signals_cache (
  key TEXT PRIMARY KEY, fetched_at REAL NOT NULL, items TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS context_changes (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, url TEXT NOT NULL,
  title TEXT, summary TEXT, changed_at TEXT NOT NULL, test INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS exa_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL);
"""
CLEAR_EVENT = "spaetkauf.test.clear"
STRIKE_DAYS = 14
MAX_STRIKE_SPAN = 14
_locks: dict[str, asyncio.Lock] = {}


_SCHEMA_READY: set[str] = set()


def ensure_schema(conn) -> None:
    """Once per database file and process: the script commits, which cost ~0.4 s per request."""
    path = conn.execute("PRAGMA database_list").fetchone()[2]
    if path and path in _SCHEMA_READY:
        return
    _ensure_schema(conn)
    if path:
        _SCHEMA_READY.add(path)


def _ensure_schema(conn) -> None:
    with conn:
        conn.executescript(SCHEMA)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(context_changes)")}
        if "test" not in cols:
            try:
                conn.execute(
                    "ALTER TABLE context_changes ADD COLUMN test INTEGER NOT NULL DEFAULT 0"
                )
            except sqlite3.OperationalError as exc:  # a concurrent request added it first
                if "duplicate column" not in str(exc):
                    raise


# Strike dates from the change text. Table driven, no LLM: day-month forms in German and English.
MONTHS = {
    "januar": 1, "january": 1, "jan": 1, "februar": 2, "february": 2, "feb": 2,
    "märz": 3, "maerz": 3, "march": 3, "mär": 3, "mar": 3, "april": 4, "apr": 4,
    "mai": 5, "may": 5, "juni": 6, "june": 6, "jun": 6, "juli": 7, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sept": 9, "sep": 9,
    "oktober": 10, "october": 10, "okt": 10, "oct": 10, "november": 11, "nov": 11,
    "dezember": 12, "december": 12, "dez": 12, "dec": 12,
}  # fmt: skip
_MON = r"(?P<mon>{})(?![a-zäöüß])\.?".format("|".join(sorted(MONTHS, key=len, reverse=True)))
_RANGE = r"(?:bis(?:\s+(?:zum|einschließlich))?|to|until|through|till|–|—|-)"
_SEP = rf"\s*(?P<sep>{_RANGE}|und|and|&|,)\s*"
_ORD = r"(?:\.|st|nd|rd|th)?"
_YEAR = r"(?:\s*,?\s*(?P<y>\d{4}))?"
_DATE_RES = [
    # 16. bis 18. November / 16.–18. November 2026 / from 16 to 18 November
    rf"\b(?P<d1>\d{{1,2}}){_ORD}{_SEP}(?:dem\s+)?(?P<d2>\d{{1,2}}){_ORD}\s*{_MON}{_YEAR}",
    # 16.–18.11. / 16.-18.11.2026
    rf"\b(?P<d1>\d{{1,2}})\.{_SEP}(?P<d2>\d{{1,2}})\.(?P<m>\d{{1,2}})\.(?P<y>\d{{4}}|\d{{2}})?(?!\d)",
    # 16.11. / 16.11.2026
    r"\b(?P<d1>\d{1,2})\.(?P<m>\d{1,2})\.(?P<y>\d{4}|\d{2})?(?!\d)",
    # 16. November / Montag, 16. November 2026 / 16 November / 16th Nov
    rf"\b(?P<d1>\d{{1,2}}){_ORD}\s*{_MON}{_YEAR}",
    # November 16 / November 16-18, 2026
    (rf"\b{_MON}\s+(?P<d1>\d{{1,2}})(?:st|nd|rd|th)?"
     rf"(?:{_SEP}(?P<d2>\d{{1,2}})(?:st|nd|rd|th)?)?(?:,?\s*(?P<y>\d{{4}}))?\b"),
]  # fmt: skip
DATE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in _DATE_RES]
_JOIN = re.compile(rf"\s*{_RANGE}\s*(?:(?:zum|dem|den)\s+)?", re.IGNORECASE)
STRIKE_WORDS = re.compile(
    r"\b\w*streik\w*|\bstrik(?:e|es|ing)\b|arbeitskampf|walkout|industrial action", re.IGNORECASE
)
NEGATION = re.compile(r"\b(?:kein\w*|no|not|ohne|without)\s+(?:\w+\s+){0,2}$", re.IGNORECASE)

CANCELLATION = re.compile(
    r"\b(?:abgesagt|ausgesetzt|beendet|abgewendet|Einigung|called off|cancelled|canceled|"
    r"suspended|agreement)\b", re.IGNORECASE
)
LOCAL = re.compile(
    r"\b(?:BVG|MVG|HVV|U-Bahn|Bus|Tram|Straßenbahn|ÖPNV|Nahverkehr|S-Bahn)\b", re.IGNORECASE
)
LONG_DISTANCE = re.compile(
    r"\b(?:Fernverkehr|ICE|IC|Deutsche Bahn|DB|GDL|EVG|long-distance)\b", re.IGNORECASE
)
UNAFFECTED = re.compile(
    r"\b(?:Fernverkehr|long-distance)[^.!?\n]*(?:nicht betroffen|not affected|ausgenommen)"
    r"|\b(?:ausgenommen|not affected)[^.!?\n]*(?:Fernverkehr|long-distance)", re.IGNORECASE
)
PUBLICATION = re.compile(
    r"\b(?:Pressemitteilung vom|Stand|veröffentlicht am|aktualisiert|published|updated|as of)"
    r"\s*:?\s*$", re.IGNORECASE
)


def cancels_strike(text: str) -> bool:
    return any(not NEGATION.search(text[:m.start()]) for m in CANCELLATION.finditer(text))


def _dated_text(text: str, cancellation: bool = False) -> str:
    # Keep ordinal dots ("16. November") inside the sentence.
    return "\n".join(
        part for part in re.split(r"[\n!?]+|(?<!\d)\.(?:\s+|$)|(?<=\d{4})\.(?:\s+|$)", text)
        if announces_strike(part) or (cancellation and cancels_strike(part))
    )


def _day(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _span(a: date | None, b: date | None) -> list[date]:
    if not a or not b or b < a or (b - a).days >= MAX_STRIKE_SPAN:
        return []
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]


def _match_dates(m: re.Match, ref: date) -> list[date]:
    g = m.groupdict()
    month = MONTHS[g["mon"].lower()] if g.get("mon") else int(g["m"])
    year = g.get("y")
    if year:
        y = int(year) + (2000 if len(year) == 2 else 0)
    else:  # no year: the reference year, or the next one when that is long past
        first = _day(ref.year, month, int(g["d1"]))
        y = ref.year + 1 if first and first < ref - timedelta(days=60) else ref.year
    d1 = _day(y, month, int(g["d1"]))
    if not g.get("d2"):
        return [d1] if d1 else []
    d2 = _day(y, month, int(g["d2"]))
    if g.get("sep", "").strip().lower() in ("und", "and", "&", ","):
        return [d for d in (d1, d2) if d]
    return _span(d1, d2)


def parse_strike_dates(text: str, ref: date) -> list[str] | None:
    """ISO dates named in the text, ranges expanded; None when no date is found.

    `ref` (the day the change was seen) supplies a missing year.
    """
    found = []
    for pattern in DATE_PATTERNS:
        for m in pattern.finditer(text):
            if PUBLICATION.search(text[:m.start()]):
                continue
            found.append((m.start(), m.end(), _match_dates(m, ref)))
    found.sort(key=lambda f: (f[0], -f[1]))
    taken: list[tuple[int, int, list[date]]] = []
    for start, end, days in found:
        if taken and start < taken[-1][1]:
            continue
        prev = taken[-1] if taken else None
        # "16.11. bis 18.11." / "16. November bis 18. November": two single dates joined by a range
        if prev and len(prev[2]) == 1 and len(days) == 1 and _JOIN.fullmatch(text[prev[1] : start]):
            taken[-1] = (prev[0], end, _span(prev[2][0], days[0]) or prev[2] + days)
            continue
        taken.append((start, end, days))
    out = sorted({d.isoformat() for _, _, days in taken for d in days})
    return out or None


def announces_strike(text: str) -> bool:
    return any(not NEGATION.search(text[: m.start()]) for m in STRIKE_WORDS.finditer(text))


def _changed_day(changed_at: str) -> date:
    return datetime.fromisoformat(changed_at).astimezone(BERLIN).date()


def read_strike(row: dict) -> dict | None:
    """A stored change as a strike announcement, or None when it announces no strike.

    Dates before the day the change was seen are dropped (a page's own past dates).
    """
    text = f"{row.get('title') or ''}\n{row.get('summary') or ''}"
    if (
        not announces_strike(text)
        or cancels_strike(text)
        or UNAFFECTED.search(text)
        or (LOCAL.search(text) and not LONG_DISTANCE.search(text))
    ):
        return None
    seen = _changed_day(row["changed_at"])
    dates = parse_strike_dates(_dated_text(text), seen)
    if dates is not None:
        dates = [d for d in dates if d >= seen.isoformat()]
        if not dates:
            return None
    return {
        "title": row.get("title") or "",
        "url": row["url"],
        "source": row["source"],
        "changed_at": row["changed_at"],
        "dates": dates,
        "test": bool(row.get("test")),
    }


def _human(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b}"


def strike_for(conn, day: date, today: date | None = None) -> dict | None:
    """The strike change that matters for `day`, from the last STRIKE_DAYS days.

    Preference: dates cover `day`, then dates unknown, then dates on other days still ahead;
    newest first within each. Past strikes and changes without a strike give None.
    """
    today = today or datetime.now(BERLIN).date()
    since = (datetime.now(UTC) - timedelta(days=STRIKE_DAYS)).isoformat(timespec="seconds")
    rows = conn.execute(
        "SELECT * FROM context_changes WHERE changed_at >= ? ORDER BY changed_at DESC", (since,)
    ).fetchall()
    active, cancellations = [], []
    for row in map(dict, rows):
        text = f"{row.get('title') or ''}\n{row.get('summary') or ''}"
        if cancels_strike(text):
            dates = parse_strike_dates(
                _dated_text(text, cancellation=True), _changed_day(row["changed_at"])
            )
            cancellations.append((row, dates))
            continue
        s = read_strike(row)
        if s is None:
            continue
        for cancellation, dates in cancellations:
            if cancellation["changed_at"] <= s["changed_at"]:
                continue
            if dates is None:
                if cancellation["source"] == s["source"]:
                    s = None
                    break
            elif s["dates"] is not None:
                s["dates"] = [d for d in s["dates"] if d not in dates]
                if not s["dates"]:
                    s = None
                    break
        if s is not None:
            active.append(s)
    covered = {d for s in active for d in s["dates"] or []}
    best, best_rank = None, 3
    for s in active:
        if s["dates"] is None:
            rank = 1
        elif day.isoformat() in s["dates"]:
            rank = 0
        elif s["dates"][-1] >= today.isoformat():
            rank = 2
        else:
            continue
        if rank < best_rank:
            best, best_rank = s, rank
    if best is None:
        return None
    covers = best_rank == 0
    try_date = None
    if covers:
        d = day - timedelta(days=1)
        while d.isoformat() in covered:
            d -= timedelta(days=1)
        try_date = d.isoformat() if d >= today else None
    if covers:
        note = (
            "A strike is announced for this day; past-run odds do not cover strike days, "
            "so Kurt makes no pick for it."
        )
        if try_date:
            note += f" No strike is announced for {_human(date.fromisoformat(try_date))}."
    elif best["dates"] is None:
        note = (
            "A strike was announced but its dates are unclear. If it falls on this day, "
            "past-run odds do not cover strike days."
        )
    else:
        days = ", ".join(_human(date.fromisoformat(d)) for d in best["dates"])
        note = f"A strike is announced for {days}, not for this day."
    return {**best, "covers_date": covers, "try_date": try_date, "note": note}


def strike_signal(db_path: Path, day: date) -> dict | None:
    """strike_for with its own connection; a database error gives None, never a failed request."""
    try:
        conn = connect(db_path)
        try:
            ensure_schema(conn)
            return strike_for(conn, day)
        finally:
            conn.close()
    except sqlite3.Error as exc:
        log.warning("strike lookup failed: %s", exc)
        return None


def take_exa_budget(conn) -> str | None:
    """Reserve one search for the current UTC day; that day, or None when the cap is spent."""
    cap = int(os.environ.get("SPAETKAUF_EXA_BUDGET") or EXA_BUDGET)
    day = datetime.now(UTC).date().isoformat()
    with conn:
        conn.execute("INSERT OR IGNORE INTO exa_budget(day, used) VALUES (?, 0)", (day,))
        cur = conn.execute(
            "UPDATE exa_budget SET used = used + 1 WHERE day = ? AND used < ?", (day, cap)
        )
    return day if cur.rowcount == 1 else None


def give_exa_budget(conn, day: str) -> None:
    with conn:
        conn.execute("UPDATE exa_budget SET used = used - 1 WHERE day = ? AND used > 0", (day,))


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


def exa_body(a: str, b: str, date: str, lang: str = "en") -> dict:
    since = datetime.now(UTC) - timedelta(days=LOOKBACK_DAYS)
    question = (
        "Does this article report a rail strike, track closure, construction, weather or event "
        f"that affects long-distance trains between {a} and {b} around {date}? "
        "Use a factual English sentence grounded in the article. Mark relevant false for local-only "
        "notices, unclear impact, or no impact on long-distance trains on this route and date."
    )
    if lang == "de":
        question = question.replace("factual English sentence", "factual German sentence")
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
                        "affects_long_distance_on_route": {
                            "type": "boolean",
                            "description": (
                                "Does this item affect long-distance trains (ICE, IC, EC) "
                                f"travelling between {a} and {b} on {date}? False when the "
                                f"affected line is not on the way between {a} and {b}, when only "
                                "S-Bahn, regional or local trains are affected, or when it does "
                                f"not apply on {date}."
                            ),
                        },
                    },
                    "required": ["kind", "relevant", "affects_long_distance_on_route", "reason"],
                },
            },
        },
    }


def covers(summary: dict, date: str) -> bool:
    start, end = summary.get("date_from") or "", summary.get("date_to") or ""
    if not end and summary.get("kind") != "strike":
        end = start
    return not (start and start > date) and not (end and end < date)


def usable_reason(reason) -> bool:
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 300:
        return False
    # Only explicit "no impact" wording: "no long-distance trains will run" must stay.
    return not (UNAFFECTED.search(reason) or NO_IMPACT.search(reason))


_LOCAL_TRAINS = r"(?:local|regional|S-Bahn|(?-i:RE|RB)\d*|Regional\w*|Nahverkehr)\b"
_LONG_TRAINS = (
    r"\b(?:Fernverkehr|Fernzüge|ICEs?|ICs?|ECs?|intercity|long[- ]distance|high[- ]speed)\b"
)
NO_IMPACT = re.compile(
    r"\bno\s+(?:[\w-]+\s+){0,3}?(?:impact|implications?|effects?|disruptions?)\b"
    r"|(?:\bnot|n't|\bnicht)\s+(?:[\w-]+\s+){0,2}?(?:affect\w*|betroffen|beeinträchtigt)"
    r"|\bkeine\s+(?:\w+\s+){0,2}?Auswirkungen"
    r"|\b(?:not an?|neither)\b[^.!?\n]*\bnor\b"
    r"|\b(?:unrelated|irrelevant)\b"
    r"|\bnot\s+(?:an?\s+)?long[- ]distance"
    r"|\bnicht\s+(?:(?:im|den|dem|der)\s+)?Fernverkehr"
    # "affects only S-Bahn trains", unless a long-distance train follows in the same sentence
    r"|\b(?:affects?|concerns?|betrifft|betreffen)\s+(?:only|nur)\s+(?:the\s+|die\s+|den\s+)?"
    rf"{_LOCAL_TRAINS}(?![^.!?\n]*{_LONG_TRAINS})",
    re.IGNORECASE,
)


def _flag(value) -> bool | None:
    if isinstance(value, str):
        value = {"true": True, "false": False}.get(value.strip().lower())
    return value if isinstance(value, bool) else None


def parse_results(results: list, date: str) -> tuple[list[dict], bool]:
    """Usable items, and whether every summary was well formed (only then may "empty" be cached).

    A missing or unreadable affects_long_distance_on_route keeps the item: hiding a real
    disruption is worse than showing one that may be off the route.
    """
    items, complete = [], True
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
                complete = False
                continue
        relevant = _flag(summary.get("relevant")) if isinstance(summary, dict) else None
        if relevant is None:
            complete = False
        if not relevant or _flag(summary.get("affects_long_distance_on_route")) is False:
            continue
        if not covers(summary, date):
            continue
        reason = summary.get("reason")
        if not usable_reason(reason):
            continue
        kind = summary.get("kind")
        items.append(
            {
                "kind": kind if kind in KINDS else "other",
                "reason": reason.strip(),
                "source": (urlparse(url).hostname or "").removeprefix("www."),
                "published": (r.get("publishedDate") or "")[:10] or None,
                "url": url,
            }
        )
        if len(items) == MAX_ITEMS:
            break
    return items, complete


async def _search(
    request: Request, settings: Settings, a: str, b: str, date: str
) -> tuple[list[dict], bool]:
    async with httpx.AsyncClient(
        timeout=15,
        headers={"User-Agent": settings.client_name, "x-api-key": settings.exa_key},
        transport=getattr(request.app.state, "signals_transport", None),
    ) as client:
        resp = await client.post(EXA_URL, json=exa_body(a, b, date, lang_from(request)))
        resp.raise_for_status()
        return parse_results(resp.json().get("results"), date)


def banners(conn, day: date) -> list[dict]:
    since = (datetime.now(UTC) - timedelta(days=BANNER_DAYS)).isoformat(timespec="seconds")
    rows = conn.execute(
        "SELECT * FROM context_changes WHERE changed_at >= ? ORDER BY changed_at DESC LIMIT ?",
        (since, MAX_BANNERS),
    ).fetchall()
    out = []
    for row in map(dict, rows):
        strike = read_strike(row)
        dates = strike["dates"] if strike else None
        out.append(
            {
                "source": row["source"],
                "url": row["url"],
                "changed_at": row["changed_at"],
                "title": row["title"] or "",
                "test": bool(row["test"]),
                "is_strike": strike is not None,
                "dates": dates,
                "covers_date": bool(dates and day.isoformat() in dates),
            }
        )
    return out


@router.get("/api/signals")
async def get_signals(
    request: Request,
    from_: str = Query(alias="from", min_length=2, max_length=80),
    to: str = Query(min_length=2, max_length=80),
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(422, "date must be a valid YYYY-MM-DD") from None
    settings = getattr(request.app.state, "settings", None) or Settings.from_env()
    a, b = city(from_), city(to)
    conn = connect(settings.db_path)
    ensure_schema(conn)
    key = hashlib.sha256(
        (f"v{CACHE_VERSION}|{a.casefold()}|{b.casefold()}|{date}"
         + ("|de" if lang_from(request) == "de" else "")).encode()
    ).hexdigest()
    status, items, checked = "unavailable", [], time.time()
    try:
        async with _locks.setdefault(key, asyncio.Lock()):
            row = conn.execute(
                "SELECT fetched_at, items FROM signals_cache WHERE key = ?", (key,)
            ).fetchone()
            if row and time.time() - row["fetched_at"] < CACHE_TTL:
                items = [i for i in json.loads(row["items"]) if usable_reason(i.get("reason"))]
                checked = row["fetched_at"]
                status = "ok" if items else "empty"
            elif settings.exa_key and a and b and not (budget_day := take_exa_budget(conn)):
                status = "capped"
            elif settings.exa_key and a and b:
                try:
                    items, complete = await _search(request, settings, a, b, date)
                except (httpx.HTTPError, ValueError, AttributeError) as exc:
                    items = []
                    # Rejected or never sent: not billed, so retries during an outage stay free.
                    if isinstance(exc, NOT_BILLED):
                        give_exa_budget(conn, budget_day)
                else:
                    status = "ok" if items else "empty"
                    checked = time.time()
                    if items or complete:
                        with conn:
                            conn.execute(
                                "INSERT OR REPLACE INTO signals_cache(key, fetched_at, items) "
                                "VALUES (?, ?, ?)",
                                (key, checked, json.dumps(items)),
                            )
        return localize({
            "status": status,
            "checked_at": datetime.fromtimestamp(checked, UTC).isoformat(timespec="seconds"),
            "items": items,
            "banners": banners(conn, day),
            "strike": strike_for(conn, day),
        }, lang_from(request))
    finally:
        conn.close()


def signature(secret: str, ts: str, raw: bytes) -> str:
    """Context.dev scheme: hex HMAC-SHA256 over "<t>." plus the raw body, keyed with the secret."""
    return hmac.new(secret.encode(), ts.encode() + b"." + raw, hashlib.sha256).hexdigest()


def verify_signature(raw: bytes, header: str, secrets: list[str]) -> bool:
    parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
    ts, sig = parts.get("t", ""), parts.get("v1", "")
    if not re.fullmatch(r"\d{1,12}", ts) or not re.fullmatch(r"[0-9a-fA-F]{64}", sig):
        return False
    if abs(time.time() - int(ts)) > 300:
        return False
    return any(hmac.compare_digest(signature(s, ts, raw), sig.lower()) for s in secrets)


def clear_test_changes(db_path: Path) -> None:
    conn = connect(db_path)
    try:
        ensure_schema(conn)
        with conn:
            conn.execute("DELETE FROM context_changes WHERE test = 1")
            conn.execute("DELETE FROM trip_alerts WHERE kind = 'strike-test'")
    finally:
        conn.close()


async def _alert_trips(db_path: Path, strike: dict, notify) -> None:
    from .tracker import strike_alerts  # tracker -> alternatives -> picks -> signals

    try:
        await strike_alerts(db_path, strike["title"], set(strike["dates"]), strike["test"], notify)
    except Exception as exc:  # noqa: BLE001
        log.warning("strike alerts failed: %s", type(exc).__name__)


@router.post("/hooks/context", status_code=204)
async def context_hook(request: Request, background: BackgroundTasks):
    # Context.dev signs per monitor, so CONTEXT_WEBHOOK_SECRET may hold several, comma separated
    secrets = [
        s.strip() for s in os.environ.get("CONTEXT_WEBHOOK_SECRET", "").split(",") if s.strip()
    ]
    raw = await request.body()
    header = request.headers.get("x-context-signature", "")
    if not secrets or not verify_signature(raw, header, secrets):
        return Response(status_code=401)
    settings = getattr(request.app.state, "settings", None) or Settings.from_env()
    try:
        event = json.loads(raw)
        if event.get("event") == CLEAR_EVENT:  # sent by scripts/send_test_change.py --clear
            clear_test_changes(settings.db_path)
            return Response(status_code=204)
        change = event["data"]["change"] if event.get("event") == "change.detected" else None
    except (ValueError, KeyError, TypeError, AttributeError):
        return Response(status_code=400)
    url = (change or {}).get("url") or ""
    if not url.startswith(("http://", "https://")) or is_db_host(url):
        return Response(status_code=204)
    event_id = request.headers.get("x-context-id") or event.get("id") or change.get("id")
    title = change.get("title")
    row = {
        "id": str(event_id),
        "source": (urlparse(url).hostname or "").removeprefix("www."),
        "url": url,
        "title": title,
        "summary": change.get("summary"),
        "changed_at": _utc_iso(change.get("detected_at") or event.get("created_at")),
        "test": int(change.get("test") is True or str(title or "").startswith("TEST:")),
    }
    conn = connect(settings.db_path)
    try:
        ensure_schema(conn)
        with conn:
            cur = conn.execute(
                "INSERT OR IGNORE INTO context_changes"
                "(id, source, url, title, summary, changed_at, test) "
                "VALUES (:id, :source, :url, :title, :summary, :changed_at, :test)",
                row,
            )
    finally:
        conn.close()
    strike = read_strike(row) if cur.rowcount else None
    if strike and strike["dates"]:
        notify = getattr(request.app.state, "notify", push.send)
        background.add_task(_alert_trips, settings.db_path, strike, notify)
    return Response(status_code=204)
