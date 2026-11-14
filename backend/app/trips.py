"""Trips: storage, derived state and the HTTP routes (design D8, D12)."""

import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from .alternatives import alternatives_view, origin_departed
from .claim import WHERE, claim_amount, compute_claim
from .db import connect
from .push import check_subscription

router = APIRouter(prefix="/api/trips")
STALE_AFTER = timedelta(minutes=10)
FINISH_AFTER = timedelta(minutes=45)
THRESHOLDS = [(20, "Ticket unlocked", 0), (60, "25 % back", 25), (120, "50 % back", 50)]


def derive_state(delay_min: int | None, cancelled: bool = False) -> str:
    if cancelled:
        return "cancelled"
    d = delay_min or 0
    if d >= 120:
        return "cash50"
    if d >= 60:
        return "cash25"
    if d >= 20:
        return "unlocked"
    return "on_time"


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts) if ts else None


def create_trip(
    db_path,
    pick: dict,
    price: Decimal | None = None,
    push: dict | None = None,
    auto: bool = False,
    replay_of: str | None = None,
) -> tuple[str, str | None]:
    trip_id = secrets.token_urlsafe(6)
    secret = None if auto else secrets.token_urlsafe(24)
    conn = connect(db_path)
    with conn:
        conn.execute(
            "INSERT INTO trips(id, secret_hash, pick, price_eur, push, auto, is_replay,"
            " replay_of, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                trip_id,
                _hash(secret) if secret else None,
                json.dumps(pick),
                str(price) if price is not None else None,
                json.dumps(push) if push else None,
                int(auto),
                int(replay_of is not None),
                replay_of,
                _iso(_now()),
            ),
        )
    conn.close()
    return trip_id, secret


def load_trip(db_path, trip_id: str, secret: str | None) -> dict:
    """Row as dict; 404 for unknown ids, auto trips and wrong secrets."""
    conn = connect(db_path)
    row = conn.execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone()
    conn.close()
    if row is None or row["secret_hash"] is None or not secret:
        raise HTTPException(404, "Trip not found")
    if not hmac.compare_digest(row["secret_hash"], _hash(secret)):
        raise HTTPException(404, "Trip not found")
    return dict(row)


def latest_snapshot(db_path, trip_id: str) -> dict | None:
    conn = connect(db_path)
    row = conn.execute(
        "SELECT * FROM trip_snapshots WHERE trip_id = ? ORDER BY at DESC, rowid DESC LIMIT 1",
        (trip_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def trip_view(row: dict, snap: dict | None, now: datetime | None = None) -> dict:
    now = now or _now()
    pick = json.loads(row["pick"])
    price = Decimal(row["price_eur"]) if row["price_eur"] else None
    delay = snap["delay_min"] if snap else None
    cancelled = bool(snap and snap["cancelled"])
    arr = _parse(pick.get("arr"))
    dep = _parse(pick.get("dep"))
    if row.get("finished_at"):
        finished = True
    elif row["is_replay"]:
        finished = False
    else:
        finished = bool(arr and now > arr + timedelta(minutes=(delay or 0)) + FINISH_AFTER)
    if row.get("finished_at"):
        final_delay = row.get("final_delay_min")
    else:
        final_delay = delay if finished else None
    if snap:
        stale = now - _parse(snap["at"]) > STALE_AFTER and not finished
    else:
        stale = bool(dep and dep - timedelta(hours=3) <= now <= (arr or now) + FINISH_AFTER)
    excluded = bool(pick.get("already_posted"))
    thresholds = []
    for at, label, pct in THRESHOLDS:
        amount = None
        if price is not None and pct and not excluded:
            value = claim_amount(price, pct)
            amount = float(value) if value >= Decimal("4.00") else None
        thresholds.append(
            {"at": at, "label": label, "amount_eur": amount, "reached": not excluded and (delay or 0) >= at}
        )
    state = derive_state(None if excluded else delay, cancelled)
    alts = []
    if state != "on_time" and not finished and not row["switched"]:
        alts = alternatives_view(row, snap, price, now)
    raw = json.loads(snap["raw"]) if snap and snap.get("raw") else {}
    return {
        "booking_delay_excluded": excluded,
        "switching_before_departure_only": origin_departed(row, snap, now),
        "booked": pick,
        "price_eur": float(price) if price is not None else None,
        "state": state,
        "delay_min": delay,
        "expected_arr": snap["expected_arr"] if snap else None,
        "updated_at": snap["at"] if snap else None,
        "stale": stale,
        "thresholds": thresholds,
        "alternatives": alts,
        "stay": {
            "amount_at_60_eur": thresholds[1]["amount_eur"],
            "amount_at_120_eur": thresholds[2]["amount_eur"],
        },
        "connection_at_risk": bool(raw.get("connection_at_risk")),
        "delay_basis": raw.get("basis", pick.get("delay_basis", "destination_forecast")),
        "at_stop": {
            "name": raw["stop"],
            "planned_arr": raw.get("planned_arr"),
            "actual_arr": raw.get("actual_arr"),
        }
        if raw.get("stop")
        else None,
        "is_replay": bool(row["is_replay"]),
        "replay_of": row["replay_of"],
        "finished": finished,
        "final_delay_min": final_delay,
        "switched": bool(row["switched"]),
    }


def _aware(ts) -> bool:
    try:
        return datetime.fromisoformat(ts).tzinfo is not None
    except (TypeError, ValueError):
        return False


class CreateTrip(BaseModel):
    pick: dict
    price_eur: Decimal | None = Field(default=None, gt=0, le=3000, decimal_places=2)
    push: dict | None = None

    @field_validator("pick")
    @classmethod
    def _check_pick(cls, pick: dict) -> dict:
        legs = pick.get("legs")
        if not isinstance(legs, list) or not legs or not all(isinstance(x, dict) for x in legs):
            raise ValueError("pick needs a non-empty list of legs")
        stamps = [pick.get("dep"), pick.get("arr")]
        stamps += [leg[k] for leg in legs for k in ("dep", "arr") if leg.get(k) is not None]
        if not all(_aware(ts) for ts in stamps):
            raise ValueError("pick times must be ISO 8601 with a timezone")
        return pick

    _check_push = field_validator("push")(lambda cls, v: check_subscription(v))


class PatchTrip(BaseModel):
    price_eur: Decimal | None = Field(default=None, gt=0, le=3000, decimal_places=2)
    switched: bool | None = None
    push: dict | None = None

    _check_push = field_validator("push")(lambda cls, v: check_subscription(v))


def _name(stop) -> str:
    return (stop.get("name", "") if isinstance(stop, dict) else stop) or ""


def _secret(secret: str | None, header: str | None) -> str | None:
    return secret or header


@router.post("", status_code=201)
def post_trip(body: CreateTrip, request: Request):
    trip_id, secret = create_trip(
        request.app.state.settings.db_path, body.pick, body.price_eur, body.push
    )
    return {"trip_id": trip_id, "secret": secret}


@router.get("/{trip_id}")
def get_trip(
    trip_id: str,
    request: Request,
    secret: str | None = None,
    x_trip_secret: str | None = Header(None),
):
    db = request.app.state.settings.db_path
    row = load_trip(db, trip_id, _secret(secret, x_trip_secret))
    conn = connect(db)
    peak_delay = conn.execute(
        "SELECT MAX(delay_min) FROM trip_snapshots WHERE trip_id = ?", (trip_id,)
    ).fetchone()[0]
    conn.close()
    return {**trip_view(row, latest_snapshot(db, trip_id)), "peak_delay_min": peak_delay}


@router.patch("/{trip_id}")
def patch_trip(
    trip_id: str,
    body: PatchTrip,
    request: Request,
    secret: str | None = None,
    x_trip_secret: str | None = Header(None),
):
    db = request.app.state.settings.db_path
    load_trip(db, trip_id, _secret(secret, x_trip_secret))
    sent = body.model_fields_set
    conn = connect(db)
    with conn:
        if "price_eur" in sent:
            price = str(body.price_eur) if body.price_eur is not None else None
            conn.execute("UPDATE trips SET price_eur = ? WHERE id = ?", (price, trip_id))
        if "switched" in sent and body.switched is not None:
            conn.execute(
                "UPDATE trips SET switched = ? WHERE id = ?", (int(body.switched), trip_id)
            )
        if "push" in sent:
            push = json.dumps(body.push) if body.push else None
            conn.execute("UPDATE trips SET push = ? WHERE id = ?", (push, trip_id))
    conn.close()
    return get_trip(trip_id, request, secret, x_trip_secret)


@router.delete("/{trip_id}", status_code=204)
def delete_trip(
    trip_id: str,
    request: Request,
    secret: str | None = None,
    x_trip_secret: str | None = Header(None),
):
    db = request.app.state.settings.db_path
    load_trip(db, trip_id, _secret(secret, x_trip_secret))
    conn = connect(db)
    with conn:
        conn.execute("DELETE FROM trips WHERE id = ?", (trip_id,))
    conn.close()


@router.get("/{trip_id}/claim")
def get_claim(
    trip_id: str,
    request: Request,
    secret: str | None = None,
    x_trip_secret: str | None = Header(None),
):
    db = request.app.state.settings.db_path
    row = load_trip(db, trip_id, _secret(secret, x_trip_secret))
    snap = latest_snapshot(db, trip_id)
    view = trip_view(row, snap)
    result = compute_claim(
        Decimal(row["price_eur"]) if row["price_eur"] else None,
        view["delay_min"],
        bool(row["switched"]),
    )
    if view["booking_delay_excluded"]:
        result = {"due": False, "pct": 0, "amount_eur": None,
                  "reason": "The delay was already posted when you booked; no compensation is due."}
    pick = view["booked"]
    legs = pick.get("legs") or [{}]
    first, last = legs[0], legs[-1]
    dep = pick.get("dep") or first.get("dep") or ""
    switched = bool(row["switched"])
    expected = view["expected_arr"]
    provisional = not expected or _now() < _parse(expected)
    if row["is_replay"]:
        provisional = not view["finished"] or not expected
    delay = None if switched else view["delay_min"]
    fields = [
        {"label": "Date", "value": dep[:10]},
        {"label": "Train", "value": ", ".join(leg.get("train", "") for leg in legs)},
        {"label": "From", "value": _name(first.get("from"))},
        {"label": "To", "value": _name(last.get("to"))},
        {"label": "Scheduled arrival", "value": pick.get("arr") or ""},
        {
            "label": "Expected arrival" if provisional and not switched else "Actual arrival",
            "value": "" if switched else expected or "",
        },
        {"label": "Delay", "value": f"{delay} min" if delay is not None else ""},
    ]
    if view["is_replay"] and view["delay_basis"] == "at_stop":
        # History stores local clock times as UTC; send copy-ready values without conversion.
        for field in fields:
            if (
                field["label"] in {"Scheduled arrival", "Expected arrival", "Actual arrival"}
                and field["value"]
            ):
                field["value"] = _parse(field["value"]).strftime("%d.%m.%Y %H:%M")
    return {
        **result, "fields": fields, "where": WHERE,
        "switched": switched, "provisional": bool(provisional),
        "is_replay": view["is_replay"], "replay_of": view["replay_of"],
    }
