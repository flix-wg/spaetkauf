"""Late-now board (design D8): hub arrivals, delay per train, auto-tracking."""

import json
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request

from .db import connect
from .stations import rail_stops
from .transitous import SourceUnavailable, Transitous
from .trips import create_trip

log = logging.getLogger("spaetkauf.board")
router = APIRouter(prefix="/api")

HUBS = [
    "Hamburg Hbf", "Berlin Hbf", "Hannover Hbf", "Köln Hbf", "Frankfurt Hbf", "Mannheim Hbf",
    "Stuttgart Hbf", "München Hbf", "Nürnberg Hbf", "Leipzig Hbf", "Dortmund Hbf", "Karlsruhe Hbf",
]  # fmt: skip
LATE_MIN = 20
STALE_AFTER = timedelta(minutes=15)
AUTO_PER_HOUR = 3


def _t(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def arrivals(station: str, data: dict) -> list[dict]:
    """Live, non-cancelled arrivals of one board with their delay in minutes."""
    out = []
    for st in data.get("stopTimes", []):
        place = st.get("place") or {}
        if not st.get("realTime") or st.get("cancelled") or place.get("cancelled"):
            continue
        if not place.get("arrival") or not place.get("scheduledArrival"):
            continue
        delay = round((_t(place["arrival"]) - _t(place["scheduledArrival"])).total_seconds() / 60)
        out.append(
            {
                "train": st["routeShortName"],
                "station": station,
                "sched": place["scheduledArrival"],
                "expected": place["arrival"],
                "delay_min": delay,
                "headsign": st.get("headsign") or "",
                "trip_id": st.get("tripId"),
                "from": (st.get("tripFrom") or {}).get("name"),
            }
        )
    return out


def dedupe(rows: list[dict]) -> list[dict]:
    best: dict[str, dict] = {}
    for r in rows:
        if r["train"] not in best or r["delay_min"] > best[r["train"]]["delay_min"]:
            best[r["train"]] = r
    return list(best.values())


async def hub_stops(tr: Transitous) -> list[tuple[str, str]]:
    """(name, stop id) per hub; geocode answers are cached for 24 h."""
    out = []
    for name in HUBS:
        try:
            hits = [h for h in rail_stops(await tr.geocode(name))]
        except SourceUnavailable:
            continue
        if hits:
            out.append((name, hits[0]["id"]))
    return out


async def refresh_board(tr: Transitous) -> dict:
    rows: list[dict] = []
    failed = 0
    stops = await hub_stops(tr)
    for name, stop_id in stops:
        try:
            rows += arrivals(name, await tr.stoptimes(stop_id))
        except SourceUnavailable:
            failed += 1
    conn = connect(tr.settings.db_path)
    if not stops or failed == len(stops):
        with conn:
            conn.execute("INSERT OR IGNORE INTO board(id) VALUES (1)")
            conn.execute("UPDATE board SET last_error = 'source unavailable' WHERE id = 1")
        conn.close()
        raise SourceUnavailable("no hub board could be read")
    trains = dedupe(rows)
    late = sorted((r for r in trains if r["delay_min"] >= LATE_MIN), key=lambda r: -r["delay_min"])
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with conn:
        conn.execute("INSERT OR IGNORE INTO board(id) VALUES (1)")
        conn.execute(
            "UPDATE board SET checked_at = ?, checked = ?, late = ?, last_error = NULL WHERE id = 1",
            (now, len(trains), json.dumps(late)),
        )
    conn.close()
    track_worst(tr.settings.db_path, late)
    return {"checked_at": now, "checked": len(trains), "late": late}


def track_worst(db_path, late: list[dict]) -> int:
    """Create internal trips for the most delayed trains, at most 3 per hour."""
    hour = datetime.now(UTC).strftime("%Y-%m-%dT%H")
    conn = connect(db_path)
    made = conn.execute(
        "SELECT COUNT(*) FROM trips WHERE auto = 1 AND created_at LIKE ?", (hour + "%",)
    ).fetchone()[0]
    known = {
        leg.get("trip_id")
        for (p,) in conn.execute("SELECT pick FROM trips WHERE auto = 1").fetchall()
        for leg in json.loads(p).get("legs", [])
    }
    conn.close()
    created = 0
    for r in late:
        if made + created >= AUTO_PER_HOUR:
            break
        if not r["trip_id"] or r["trip_id"] in known:
            continue
        arr = _t(r["sched"])
        pick = {
            "id": r["trip_id"],
            "dep": (arr - timedelta(hours=2)).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),  # tracking window start
            "arr": r["sched"],
            "changes": 0,
            "legs": [
                {
                    "train": r["train"],
                    "from": r["from"],
                    "to": r["station"],
                    "dep": None,
                    "arr": r["sched"],
                    "trip_id": r["trip_id"],
                }
            ],
        }
        create_trip(db_path, pick, auto=True)
        created += 1
    return created


def board_view(db_path) -> dict:
    conn = connect(db_path)
    row = conn.execute("SELECT * FROM board WHERE id = 1").fetchone()
    conn.close()
    if row is None or row["checked_at"] is None:
        return {"checked_at": None, "stale": True, "checked": 0, "late": []}
    age = datetime.now(UTC) - _t(row["checked_at"])
    late = [
        {k: v for k, v in r.items() if k not in ("trip_id", "from")}
        for r in json.loads(row["late"])
    ]
    return {
        "checked_at": row["checked_at"],
        "stale": bool(row["last_error"]) or age > STALE_AFTER,
        "checked": row["checked"],
        "late": late,
    }


@router.get("/late-now")
def late_now(request: Request):
    return board_view(request.app.state.settings.db_path)
