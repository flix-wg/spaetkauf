"""Every odds number down to the individual runs: arrivals of one train at one stop (data/history.sqlite)."""

import os
import sqlite3
from datetime import date, datetime, time, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

from .config import REPO_ROOT
from .matching import _pick_station, parse_train, type_family
from .odds import BERLIN, WEEKDAYS

router = APIRouter(prefix="/api/history")
SOURCE = "Deutsche Bahn arrival data via piebro/deutsche-bahn-data, CC BY 4.0"
EPOCH = date(1970, 1, 1)
WEEKDAY_SQL = "(r.day + 3) % 7"  # day = days since 1970-01-01, a Thursday
LATE = "(r.delay_min IS NULL OR r.delay_min >= {})"  # a cancelled run (NULL delay) counts as late
_FROM = "FROM runs r JOIN legs l ON l.id = r.leg_id JOIN stops s ON s.id = l.stop_id"


def history_path() -> Path:
    path = Path(os.environ.get("SPAETKAUF_HISTORY_PATH") or "data/history.sqlite")
    return path if path.is_absolute() else REPO_ROOT / path


def open_history(path: Path | None = None) -> sqlite3.Connection:
    path = path or history_path()
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    conn.execute("SELECT 1 FROM runs LIMIT 1")
    return conn


def history_conn(request: Request) -> sqlite3.Connection:
    state = request.app.state
    if getattr(state, "history", None) is None:
        try:
            state.history = open_history()
        except sqlite3.Error as exc:
            raise HTTPException(503, "Run history unavailable") from exc
    return state.history


def _find_train(conn: sqlite3.Connection, train: str) -> tuple[int, str, str]:
    """(train id, type, number); a number is looked up across its type family, as in odds."""
    parsed = parse_train(train)
    if parsed is None:
        raise HTTPException(404, f"'{train}' is not a train like 'ICE 1103'")
    kind, number = parsed
    found = conn.execute(
        f"SELECT id, train_type, train_number FROM trains WHERE train_number = ? "
        f"AND train_type IN ({','.join('?' * len(type_family(kind)))}) ORDER BY train_type = ? DESC",
        (number, *type_family(kind), kind),
    ).fetchall()
    if len(found) != 1 and not (found and found[0][1] == kind):
        raise HTTPException(404, f"No history for {kind} {number}")
    return found[0]


def _weekday(weekday: int | None) -> tuple[str, list[int]]:
    return ("", []) if weekday is None else (f" AND {WEEKDAY_SQL} = ?", [weekday])


def _planned(day: int, minute: int) -> str:
    local = datetime.combine(EPOCH + timedelta(days=day), time(minute // 60, minute % 60))
    return local.replace(tzinfo=BERLIN).isoformat()


def _summary(rows: list[tuple]) -> dict:
    delays = [d for _, _, d in rows]
    return {
        "n": len(rows),
        "late20": sum(d is None or d >= 20 for d in delays),
        "late60": sum(d is None or d >= 60 for d in delays),
        "late120": sum(d is None or d >= 120 for d in delays),
        "cancelled": sum(d is None for d in delays),
    }


@router.get("")
def runs(
    request: Request,
    train: str,
    stop: str,
    weekday: int | None = Query(None, ge=0, le=6),
):
    conn = history_conn(request)
    train_id, kind, number = _find_train(conn, train)
    stops = conn.execute(
        "SELECT DISTINCT s.station_key, s.name FROM legs l JOIN stops s ON s.id = l.stop_id "
        "WHERE l.train_id = ? ORDER BY s.name",
        (train_id,),
    ).fetchall()
    key, _ = _pick_station([k for k, _ in stops], stop)
    if key is None:
        raise HTTPException(
            404,
            f"{kind} {number} does not stop at '{stop}'; stops: {', '.join(n for _, n in stops)}",
        )
    extra, args = _weekday(weekday)
    rows = conn.execute(
        f"SELECT r.day, r.planned_min, r.delay_min, s.name {_FROM} "
        f"WHERE l.train_id = ? AND s.station_key = ?{extra} ORDER BY r.day DESC, r.planned_min DESC",
        (train_id, key, *args),
    ).fetchall()
    return {
        "train": f"{kind} {number}",
        "stop": rows[0][3] if rows else next(n for k, n in stops if k == key),
        "weekday": None if weekday is None else WEEKDAYS[weekday],
        "runs": [
            {"date": (EPOCH + timedelta(days=d)).isoformat(), "planned": _planned(d, m),
             "delay_min": delay, "cancelled": delay is None}
            for d, m, delay, _ in rows
        ],
        "summary": _summary([(d, m, delay) for d, m, delay, _ in rows]),
        "source": SOURCE,
    }  # fmt: skip


@router.get("/train")
def train_stops(request: Request, train: str, weekday: int | None = Query(None, ge=0, le=6)):
    """The stops of one train with their run counts and 20+ min late share, for a lookup screen."""
    conn = history_conn(request)
    train_id, kind, number = _find_train(conn, train)
    extra, args = _weekday(weekday)
    rows = conn.execute(
        f"SELECT s.station_key, min(s.name), count(*), sum({LATE.format(20)}) {_FROM} "
        f"WHERE l.train_id = ?{extra} GROUP BY s.station_key ORDER BY min(s.name)",
        (train_id, *args),
    ).fetchall()
    return {
        "train": f"{kind} {number}",
        "weekday": None if weekday is None else WEEKDAYS[weekday],
        "stops": [
            {"stop": name, "key": key, "n": n, "late20": late, "late20_share": round(late / n, 4)}
            for key, name, n, late in rows
        ],
        "source": SOURCE,
    }
