"""Connections an unlocked traveller can still catch (design D7 live variant, D8)."""

import json
import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from .claim import compute_claim
from .db import connect
from .stations import rail_stops
from .transitous import BudgetSpent, SourceUnavailable, Transitous

log = logging.getLogger("spaetkauf.alternatives")
REFRESH = timedelta(minutes=10)
SHOW = 3


def _t(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts) if ts else None


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _minutes(delta: timedelta) -> int:
    return round(delta.total_seconds() / 60)


async def resolve_place(tr: Transitous, stop) -> str | None:
    """A /plan place for a pick stop: its stop id, else coordinates, else a geocoded rail stop."""
    if isinstance(stop, dict):
        for key in ("stopId", "id"):
            if stop.get(key):
                return stop[key]
        if stop.get("lat") is not None and stop.get("lon") is not None:
            return f"{stop['lat']},{stop['lon']}"
        stop = stop.get("name")
    if not stop:
        return None
    hits = rail_stops(await tr.geocode(stop))
    return hits[0]["id"] if hits else None


def options(plan: dict, booked_trip_ids: set[str], now: datetime) -> list[dict]:
    """Catchable itineraries without the booked trains, earliest arrival first."""
    out = []
    for it in plan.get("itineraries", []):
        rides = [leg for leg in it.get("legs", []) if leg.get("tripId")]
        if not rides or any(leg["tripId"] in booked_trip_ids for leg in rides):
            continue
        if any(leg.get("cancelled") for leg in rides):
            continue
        dep, arr = rides[0]["startTime"], rides[-1]["endTime"]
        if _t(dep) <= now:
            continue
        out.append(
            {
                "dep": dep,
                "arr": arr,
                "changes": len(rides) - 1,
                "trains": [leg.get("displayName") or leg.get("routeShortName") for leg in rides],
            }
        )
    out.sort(key=lambda o: (_t(o["arr"]), o["changes"]))
    return out[: SHOW * 2]


async def refresh_alternatives(tr: Transitous, row: dict, now: datetime) -> None:
    """Re-plan from the booked origin at most every 10 min; /plan is budget-limited."""
    last = _t(row.get("alts_at"))
    if last and now - last < REFRESH:
        return
    conn = connect(tr.settings.db_path)
    with conn:
        conn.execute("UPDATE trips SET alts_at = ? WHERE id = ?", (_iso(now), row["id"]))
    conn.close()
    legs = json.loads(row["pick"]).get("legs") or []
    if not legs:
        return
    try:
        origin = await resolve_place(tr, legs[0].get("from"))
        dest = await resolve_place(tr, legs[-1].get("to"))
        if not origin or not dest:
            return
        plan = await tr.plan(origin, dest, time=_iso(now))
    except (SourceUnavailable, BudgetSpent) as exc:
        log.info("alternatives for %s skipped: %s", row["id"], type(exc).__name__)
        return
    found = options(plan, {leg.get("trip_id") for leg in legs if leg.get("trip_id")}, now)
    conn = connect(tr.settings.db_path)
    with conn:
        conn.execute("UPDATE trips SET alts = ? WHERE id = ?", (json.dumps(found), row["id"]))
    conn.close()


def alternatives_view(
    row: dict, snap: dict | None, price: Decimal | None, now: datetime
) -> list[dict]:
    pick = json.loads(row["pick"])
    sched = _t(pick.get("arr"))
    expected = _t(snap.get("expected_arr") if snap else None) or sched
    out = []
    for o in json.loads(row.get("alts") or "[]"):
        dep, arr = _t(o["dep"]), _t(o["arr"])
        if dep <= now:
            continue
        late = _minutes(arr - sched) if sched else None
        forfeits = late is None or late < 60
        out.append(
            {
                **o,
                "catchable_min": int((dep - now).total_seconds() // 60),
                "delta_vs_expected_min": _minutes(arr - expected) if expected else None,
                "forfeits_compensation": forfeits,
                "compensation_eur": 0.0
                if forfeits
                else compute_claim(price, late, True)["amount_eur"],
            }
        )
        if len(out) == SHOW:
            break
    return out
