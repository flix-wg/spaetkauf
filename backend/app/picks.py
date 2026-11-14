"""Ranked picks for a route and date (design D6, D7, D11, D12) and the backtest file."""

import hashlib
import json
import sqlite3
import unicodedata
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request

from .matching import parse_train, station_tokens
from .odds import BERLIN, connection_odds, odds_path, open_odds
from .signals import strike_signal
from .stations import rail_stops
from .transitous import Transitous

router = APIRouter(prefix="/api")
TZ = "Europe/Berlin"
ENOUGH = 10
MAX_PAGES = 3
LATE_MIN = 20
KURT_MIN_P20 = 0.30
RIDE_WINDOW = (timedelta(minutes=0), timedelta(minutes=120))
RIDE_SLACK = timedelta(minutes=20)
# Reservation-only trains cannot be ridden on a lifted binding (D7): TGV, the 95xx Paris ICEs,
# and legs to or from the foreign stops on those routes.
RESERVATION_ONLY = {"TGV"}
FOREIGN_STOPS = (
    "paris", "strasbourg", "marseille", "lyon", "milano", "warszawa",
    "poznan", "gdansk", "krakow", "wroclaw", "szczecin",
)  # fmt: skip


def _t(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _minutes(a: datetime, b: datetime) -> int:
    return round((b - a).total_seconds() / 60)


def is_stop_id(place: str) -> bool:
    """Transitous ids look like 'de-DELFI_de:02000:10950' or 'be-sncb_8015458'."""
    return "_" in place and not any(c.isspace() for c in place)


async def resolve(tr: Transitous, place: str) -> tuple[str, str | None]:
    """(stop id, display name or None when an id was given)."""
    place = place.strip()
    if is_stop_id(place):
        return place, None
    hits = rail_stops(await tr.geocode(place)) if len(place) >= 2 else []
    if not hits:
        raise HTTPException(404, f"Unknown station: {place}")
    return hits[0]["id"], hits[0]["name"]


def connection(it: dict) -> dict | None:
    """One itinerary as a pick without odds; None when it has no transit leg."""
    raw = [leg for leg in it.get("legs", []) if leg.get("tripId")]
    if not raw:
        return None
    legs = [
        {
            "train": leg.get("routeShortName") or leg.get("displayName") or "",
            "from": leg["from"]["name"],
            "to": leg["to"]["name"],
            "dep": _iso(_t(leg["scheduledStartTime"])),
            "arr": _iso(_t(leg["scheduledEndTime"])),
            "trip_id": leg["tripId"],
        }
        for leg in raw
    ]
    end = raw[-1]["to"]
    posted = any(leg.get("cancelled") for leg in raw) or bool(end.get("cancelled"))
    if raw[-1].get("realTime") and end.get("arrival") and end.get("scheduledArrival"):
        posted |= _minutes(_t(end["scheduledArrival"]), _t(end["arrival"])) >= LATE_MIN
    key = json.dumps([[leg["trip_id"] for leg in legs], legs[0]["dep"]])
    dep, arr = _t(legs[0]["dep"]), _t(legs[-1]["arr"])
    return {
        "id": hashlib.sha1(key.encode()).hexdigest()[:12],
        "dep": legs[0]["dep"],
        "arr": legs[-1]["arr"],
        "duration_min": _minutes(dep, arr),
        "changes": len(legs) - 1,
        "legs": legs,
        "odds": None,
        "already_posted": posted,
        "is_kurts_pick": False,
        "ride_instead": None,
        "bahn_url": "",
    }


def fill_names(legs: list[dict], src_name: str, dst_name: str) -> None:
    """Some feeds name a stop just 'Hauptbahnhof'; borrow the neighbouring leg's or route's name."""
    for i, leg in enumerate(legs):
        if not station_tokens(leg["from"]):
            leg["from"] = legs[i - 1]["to"] if i else src_name
        if not station_tokens(leg["to"]):
            nxt = legs[i + 1]["from"] if i + 1 < len(legs) else dst_name
            leg["to"] = nxt if station_tokens(nxt) else leg["to"]


def _foreign(stop: str) -> bool:
    flat = unicodedata.normalize("NFKD", stop.lower().replace("ł", "l"))
    flat = "".join(c for c in flat if not unicodedata.combining(c))
    return any(name in flat for name in FOREIGN_STOPS)


def reservation_only_leg(train: str | None, *stops: str | None) -> bool:
    kind, number = parse_train(train) or ("", "")
    if kind in RESERVATION_ONLY or number in {str(n) for n in range(9550, 9600)}:
        return True
    return any(_foreign(stop) for stop in stops if stop)


def _reservation_only(pick: dict) -> bool:
    return any(reservation_only_leg(x["train"], x["from"], x["to"]) for x in pick["legs"])


def ride_instead(booked: dict, others: list[dict]) -> dict | None:
    """Earliest-arriving other connection in the window that beats booked arrival + 20 min (D7).

    Connections sharing a trip with the booked one are skipped: that train is the late one.
    """
    dep, arr = _t(booked["dep"]), _t(booked["arr"])
    trips = {leg["trip_id"] for leg in booked["legs"]}
    fits = [
        p for p in others
        if p["id"] != booked["id"]
        and RIDE_WINDOW[0] <= _t(p["dep"]) - dep <= RIDE_WINDOW[1]
        and _t(p["arr"]) <= arr + RIDE_SLACK
        and not trips & {leg["trip_id"] for leg in p["legs"]}
        and not _reservation_only(p)
    ]  # fmt: skip
    if not fits:
        return None
    best = min(fits, key=lambda p: (p["arr"], p["changes"]))
    return {
        "dep": best["dep"],
        "arr": best["arr"],
        "changes": best["changes"],
        "trains": [leg["train"] for leg in best["legs"]],
        "delta_arr_min": _minutes(arr, _t(best["arr"])),
    }


def bahn_url(from_name: str, to_name: str, dep: str) -> str:
    local = _t(dep).astimezone(BERLIN).strftime("%Y-%m-%dT%H:%M:%S")
    return (
        "https://www.bahn.de/buchung/fahrplan/suche#sts=true"
        f"&so={quote(from_name, safe='')}&zo={quote(to_name, safe='')}&hd={local}"
        "&hza=D&ar=false&s=true&d=false&fm=false&bp=false"
    )


def rank(picks: list[dict]) -> list[dict]:
    """By p20 descending, picks without odds last, then by departure; marks Kurt's pick (likeliest late, with ride-instead, p20 >= KURT_MIN_P20)."""
    picks.sort(key=lambda p: (p["odds"]["p20"] is None, -(p["odds"]["p20"] or 0), p["dep"]))
    eligible = [
        p for p in picks
        if p["ride_instead"] and not p["already_posted"]
        and (p["odds"]["p20"] or 0) >= KURT_MIN_P20
    ]  # fmt: skip
    if eligible:
        max(eligible, key=lambda p: p["odds"]["p20"])["is_kurts_pick"] = True
    return picks


def kurt_call(picks: list[dict], strike: dict | None) -> str:
    """'strike' (announced strike covers the day: no Kurt's pick), 'none', 'strike_unclear'
    (strike with unknown dates: pick kept, warning attached) or 'pick'. Odds stay as they are."""
    if strike and strike["covers_date"]:
        for p in picks:
            p["is_kurts_pick"] = False
        return "strike"
    if not any(p["is_kurts_pick"] for p in picks):
        return "none"
    return "strike_unclear" if strike and strike["dates"] is None else "pick"


def note(picks: list[dict]) -> str:
    if not picks:
        return "No long-distance connections found; try another date or station."
    without = [p for p in picks if p["odds"]["basis"] == "none"]
    if not without:
        return ""
    flix = any(parse_train(leg["train"]) is None for p in without for leg in p["legs"])
    reason = " (no history for FlixTrain legs)" if flix else ""
    return f"{len(without)} of {len(picks)} connections have too little history for odds{reason}."


def start_time(day: date, at: str | None, now: datetime) -> datetime:
    today = now.astimezone(BERLIN).date()
    if day < today:
        raise HTTPException(400, "Date is in the past")
    if at:
        try:
            clock = time.fromisoformat(at)
        except ValueError:
            raise HTTPException(400, "time must be HH:MM") from None
        return datetime.combine(day, clock, BERLIN)
    if day == today:
        return now
    return datetime.combine(day, time(6), BERLIN)


async def fetch(
    tr: Transitous, src: str, dst: str, start: datetime, day: date
) -> tuple[list, dict]:
    """Itineraries departing on `day`, page by page until ENOUGH connections or MAX_PAGES."""
    found: dict[str, dict] = {}
    first: dict = {}
    cursor = None
    for _ in range(MAX_PAGES):
        if cursor:
            page = await tr.plan(src, dst, cursor=cursor)
        else:
            page = first = await tr.plan(src, dst, time=_iso(start))
        for it in page.get("itineraries", []):
            pick = connection(it)
            if pick and _t(pick["dep"]).astimezone(BERLIN).date() == day:
                found.setdefault(pick["id"], pick)
        cursor = page.get("nextPageCursor")
        last = max((it["startTime"] for it in page.get("itineraries", [])), default=None)
        past_day = last and _t(last).astimezone(BERLIN).date() > day
        if len(found) >= ENOUGH or not cursor or past_day:
            break
    return list(found.values()), first


def odds_conn(request: Request) -> sqlite3.Connection:
    state = request.app.state
    if getattr(state, "odds", None) is None:
        try:
            state.odds = open_odds()
        except sqlite3.Error as exc:
            raise HTTPException(503, "Odds table unavailable") from exc
    return state.odds


@router.get("/picks")
async def picks(
    request: Request,
    from_: Annotated[str, Query(alias="from")],
    to: str,
    day: Annotated[date, Query(alias="date")],
    at: Annotated[str | None, Query(alias="time")] = None,
):
    tr: Transitous = request.app.state.transitous
    conn = odds_conn(request)
    start = start_time(day, at, datetime.now(BERLIN))
    src, src_name = await resolve(tr, from_)
    dst, dst_name = await resolve(tr, to)
    found, first = await fetch(tr, src, dst, start, day)
    src_name = src_name or first.get("from", {}).get("name") or from_
    dst_name = dst_name or first.get("to", {}).get("name") or to
    for p in found:
        fill_names(p["legs"], src_name, dst_name)
        p["odds"] = connection_odds(conn, p["legs"])
        p["ride_instead"] = ride_instead(p, found)
        p["bahn_url"] = bahn_url(src_name, dst_name, p["dep"])
    ranked = rank(found)
    strike = strike_signal(tr.settings.db_path, day)
    call = kurt_call(ranked, strike)
    return {"from": src_name, "to": dst_name, "date": day.isoformat(), "tz": TZ,
            "picks": ranked, "note": note(ranked), "kurt_call": call, "strike": strike}  # fmt: skip


@router.get("/backtest")
def backtest():
    path = odds_path().parent / "backtest.json"
    if not path.is_file():
        raise HTTPException(404, "No backtest available")
    return json.loads(path.read_text())
