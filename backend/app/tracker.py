"""Trip polling, snapshots and once-only alerts (design D8)."""

import json
import logging
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from zoneinfo import ZoneInfo

from .alternatives import refresh_alternatives
from .db import connect
from .transitous import SourceUnavailable, Transitous
from .trips import FINISH_AFTER, derive_state, latest_snapshot, trip_view

log = logging.getLogger("spaetkauf.tracker")
WINDOW_BEFORE = timedelta(hours=3)
BERLIN = ZoneInfo("Europe/Berlin")
SEVERITY = ["20", "60", "120", "cancelled"]

Notify = Callable[[object, dict, dict], Awaitable[object]]


def _t(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts) if ts else None


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower().replace("hauptbahnhof", "hbf"))


def _ids(stop: dict) -> set[str]:
    return {stop[k] for k in ("stopId", "parentId", "id") if stop.get(k)}


def _same_station(a: set[str], b: set[str]) -> bool:
    return any(x == y or x.startswith(y + ":") or y.startswith(x + ":") for x in a for y in b)


def find_stop(stops: list[dict], want, field: str, sched: str | None) -> dict | None:
    """Match a pick stop by stop id, then by name, then by its scheduled time."""
    want_ids = _ids(want) if isinstance(want, dict) else set()
    name = want.get("name") if isinstance(want, dict) else want
    if want_ids:
        for s in stops:
            if _same_station(_ids(s), want_ids):
                return s
    if name:
        for s in stops:
            if _norm(s.get("name", "")) == _norm(name):
                return s
    if sched:
        for s in stops:
            if s.get(field) and _t(s[field]) == _t(sched):
                return s
    return None


def read_leg(data: dict, leg: dict) -> dict | None:
    """Expected times of one booked leg from a Transitous /trip answer, None if the stop is missing."""
    tlegs = data.get("legs") or []
    stops = [
        s
        for tl in tlegs
        for s in [tl.get("from") or {}, *tl.get("intermediateStops", []), tl.get("to") or {}]
    ]
    alight = find_stop(stops, leg.get("to"), "scheduledArrival", leg.get("arr"))
    if alight is None or not alight.get("scheduledArrival"):
        return None
    board = find_stop(stops, leg.get("from"), "scheduledDeparture", leg.get("dep"))
    return {
        "arr": alight.get("arrival") or alight["scheduledArrival"],
        "sched_arr": alight["scheduledArrival"],
        "dep": board.get("departure") if board else None,
        "cancelled": any(tl.get("cancelled") for tl in tlegs)
        or bool(alight.get("cancelled"))
        or bool(board and board.get("cancelled")),
        "realtime": any(tl.get("realTime") for tl in tlegs),
    }


async def poll(tr: Transitous, pick: dict) -> dict | None:
    """One snapshot for a booked pick: delay at the last leg's alighting stop."""
    legs = [leg for leg in pick.get("legs") or [] if leg.get("trip_id")]
    if not legs:
        return None
    reads = []
    for leg in legs:
        try:
            data = await tr.trip(leg["trip_id"])
        except SourceUnavailable as exc:
            status = getattr(getattr(exc.__cause__, "response", None), "status_code", None)
            log.info(
                "trip %s: %s",
                leg["trip_id"],
                "no longer resolves" if status == 404 else "unavailable",
            )
            return None
        got = read_leg(data, leg)
        if got is None:
            log.info("trip %s: alighting stop not found", leg["trip_id"])
            return None
        reads.append(got)
    if not all(r["realtime"] for r in reads):
        return None
    last = reads[-1]
    at_risk = any(a["arr"] and b["dep"] and _t(a["arr"]) > _t(b["dep"]) for a, b in pairwise(reads))
    return {
        "delay_min": round((_t(last["arr"]) - _t(last["sched_arr"])).total_seconds() / 60),
        "expected_arr": last["arr"],
        "cancelled": any(r["cancelled"] for r in reads),
        "raw": {
            "connection_at_risk": at_risk,
            "realtime": True,
            "origin_dep": reads[0]["dep"],
        },
    }


def _load(db_path, trip_id: str) -> dict:
    conn = connect(db_path)
    row = conn.execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone()
    conn.close()
    return dict(row)


def new_alerts(db_path, trip_id: str, delay: int | None, cancelled: bool, now: datetime) -> list:
    """Record every alert this snapshot reaches; return only the ones not sent before."""
    kinds = [k for k in ("20", "60", "120") if (delay or 0) >= int(k)]
    if cancelled:
        kinds.append("cancelled")
    fresh = []
    conn = connect(db_path)
    with conn:
        for kind in kinds:
            cur = conn.execute(
                "INSERT OR IGNORE INTO trip_alerts(trip_id, kind, sent_at) VALUES (?,?,?)",
                (trip_id, kind, _iso(now)),
            )
            if cur.rowcount:
                fresh.append(kind)
    conn.close()
    return fresh


def _hhmm(ts: str) -> str:
    return _t(ts).astimezone(BERLIN).strftime("%H:%M")


def message(row: dict, view: dict, kind: str) -> dict:
    legs = view["booked"].get("legs") or [{}]
    train = legs[0].get("train") if len(legs) == 1 else "connection"
    n = view["delay_min"]
    amounts = {t["at"]: t["amount_eur"] for t in view["thresholds"]}
    if kind == "cancelled":
        title = "Your train is cancelled"
        body = "Ticket unlocked: ride any train, or get a full refund."
    elif kind == "20":
        title = "It's late. You win."
        now = (
            f"is +{n} min at {view['at_stop']['name']}"
            if view["at_stop"]
            else f"is now expected +{n} min"
        )
        body = f"Your {train or 'train'} {now}. Ticket unlocked: ride any train."
        if view["alternatives"]:
            best = view["alternatives"][0]
            body += f" Kurt's tip: the {_hhmm(best['dep'])}, in at {_hhmm(best['arr'])}."
    else:
        pct, title = {"60": (25, "Cash back unlocked"), "120": (50, "Half your money back")}[kind]
        amount = amounts[int(kind)]
        money = f" ({amount:.2f} EUR)" if amount is not None else ""
        body = f"+{n} min: {pct} % of your ticket comes back{money}."
    if row["is_replay"]:
        title = f"Replay · {title}"
        body = f"{body} (replay of {row['replay_of']})"
    return {"title": title, "body": body, "url": f"/trip/{row['id']}"}


async def record(
    db_path,
    trip_id: str,
    snap: dict,
    now: datetime,
    notify: Notify,
    tr: Transitous | None = None,
) -> list[str]:
    """Store a snapshot and send the alerts it newly reaches; shared by live tracking and replay."""
    conn = connect(db_path)
    with conn:
        conn.execute(
            "INSERT INTO trip_snapshots(trip_id, at, delay_min, expected_arr, cancelled, raw)"
            " VALUES (?,?,?,?,?,?)",
            (
                trip_id,
                _iso(now),
                snap["delay_min"],
                snap["expected_arr"],
                int(bool(snap["cancelled"])),
                json.dumps(snap.get("raw") or {}),
            ),
        )
    conn.close()
    row = _load(db_path, trip_id)
    state = derive_state(snap["delay_min"], bool(snap["cancelled"]))
    live = tr is not None and not (row["auto"] or row["is_replay"] or row["switched"])
    if live and state != "on_time":
        await refresh_alternatives(tr, row, now)
        row = _load(db_path, trip_id)
    alert_delay = None if json.loads(row["pick"]).get("already_posted") else snap["delay_min"]
    fresh = new_alerts(db_path, trip_id, alert_delay, bool(snap["cancelled"]), now)
    if fresh:
        view = trip_view(row, latest_snapshot(db_path, trip_id), now)
        await notify(db_path, row, message(row, view, max(fresh, key=SEVERITY.index)))
    return fresh


async def strike_alerts(
    db_path, title: str, dates: set[str], test: bool, notify: Notify, now: datetime | None = None
) -> list[str]:
    """Once-only 'strike' alert for watched trips whose travel day is in `dates` (Berlin dates).

    Test changes use the kind 'strike-test' so clearing them can re-arm the alert.
    """
    now = now or datetime.now(UTC)
    kind = "strike-test" if test else "strike"
    conn = connect(db_path)
    rows = conn.execute(
        "SELECT * FROM trips WHERE finished_at IS NULL AND is_replay = 0 AND auto = 0"
    ).fetchall()
    fresh = []
    with conn:
        for row in map(dict, rows):
            pick = json.loads(row["pick"])
            days = {_t(pick[k]).astimezone(BERLIN).date().isoformat() for k in ("dep", "arr")
                    if pick.get(k)}  # fmt: skip
            if (
                days & dates
                and conn.execute(
                    "INSERT OR IGNORE INTO trip_alerts(trip_id, kind, sent_at) VALUES (?,?,?)",
                    (row["id"], kind, _iso(now)),
                ).rowcount
            ):
                fresh.append(row)
    conn.close()
    for row in fresh:
        body = f"Strike announced for your travel day: {title}"
        await notify(db_path, row, {"title": "Strike announced", "body": body,
                                    "url": f"/trip/{row['id']}"})  # fmt: skip
    return [row["id"] for row in fresh]


def finish(db_path, trip_id: str, final_delay: int | None, now: datetime) -> None:
    conn = connect(db_path)
    with conn:
        conn.execute(
            "UPDATE trips SET finished_at = ?, final_delay_min = ? WHERE id = ?",
            (_iso(now), final_delay, trip_id),
        )
    conn.close()


async def track_trips(tr: Transitous, notify: Notify, now: datetime | None = None) -> int:
    """Poll every trip whose window is open; finish the ones past arrival + 45 min."""
    now = now or datetime.now(UTC)
    db_path = tr.settings.db_path
    conn = connect(db_path)
    rows = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM trips WHERE finished_at IS NULL AND is_replay = 0"
        ).fetchall()
    ]
    conn.close()
    polled = 0
    for row in rows:
        pick = json.loads(row["pick"])
        dep, arr = _t(pick.get("dep")), _t(pick.get("arr"))
        if arr is None:
            continue
        if dep and now < dep - WINDOW_BEFORE:
            continue
        try:
            snap = await poll(tr, pick)
            if snap:
                await record(db_path, row["id"], snap, now, notify, tr)
                polled += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("tracking trip %s failed: %s", row["id"], type(exc).__name__)
        last = latest_snapshot(db_path, row["id"])
        delay = last["delay_min"] if last else None
        if now > arr + timedelta(minutes=max(delay or 0, 0)) + FINISH_AFTER:
            finish(db_path, row["id"], delay, now)
    return polled
