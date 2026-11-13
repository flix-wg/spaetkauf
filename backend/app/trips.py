"""Trips: storage, derived state and the HTTP routes (design D8, D12)."""

import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .claim import WHERE, claim_amount, compute_claim
from .db import connect

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
        "SELECT * FROM trip_snapshots WHERE trip_id = ? ORDER BY at DESC LIMIT 1", (trip_id,)
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
    finished = bool(arr and now > arr + timedelta(minutes=(delay or 0)) + FINISH_AFTER)
    if snap:
        stale = now - _parse(snap["at"]) > STALE_AFTER and not finished
    else:
        stale = bool(dep and dep - timedelta(hours=3) <= now <= (arr or now) + FINISH_AFTER)
    thresholds = []
    for at, label, pct in THRESHOLDS:
        amount = None
        if price is not None and pct:
            value = claim_amount(price, pct)
            amount = float(value) if value >= Decimal("4.00") else None
        thresholds.append(
            {"at": at, "label": label, "amount_eur": amount, "reached": (delay or 0) >= at}
        )
    return {
        "booked": pick,
        "price_eur": float(price) if price is not None else None,
        "state": derive_state(delay, cancelled),
        "delay_min": delay,
        "expected_arr": snap["expected_arr"] if snap else None,
        "updated_at": snap["at"] if snap else None,
        "stale": stale,
        "thresholds": thresholds,
        "alternatives": [],
        "is_replay": bool(row["is_replay"]),
        "replay_of": row["replay_of"],
        "finished": finished,
        "final_delay_min": delay if finished else None,
        "switched": bool(row["switched"]),
    }


class CreateTrip(BaseModel):
    pick: dict
    price_eur: Decimal | None = Field(default=None, gt=0, le=3000, decimal_places=2)
    push: dict | None = None


class PatchTrip(BaseModel):
    price_eur: Decimal | None = Field(default=None, gt=0, le=3000, decimal_places=2)
    switched: bool | None = None
    push: dict | None = None


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
    return trip_view(row, latest_snapshot(db, trip_id))


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
    pick = view["booked"]
    legs = pick.get("legs") or [{}]
    first, last = legs[0], legs[-1]
    dep = pick.get("dep") or first.get("dep") or ""
    delay = view["delay_min"]
    fields = [
        {"label": "Date", "value": dep[:10]},
        {"label": "Train", "value": ", ".join(leg.get("train", "") for leg in legs)},
        {"label": "From", "value": _name(first.get("from"))},
        {"label": "To", "value": _name(last.get("to"))},
        {"label": "Scheduled arrival", "value": pick.get("arr") or ""},
        {"label": "Actual arrival", "value": view["expected_arr"] or ""},
        {"label": "Delay", "value": f"{delay} min" if delay is not None else ""},
    ]
    return {**result, "fields": fields, "where": WHERE}
