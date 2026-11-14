"""Every odds number down to the individual runs, from data/history.duckdb (scripts/build_history.py).

One read-only connection lives on app.state; each request works on its own cursor (a DuckDB connection is
not thread-safe, cursors are).
"""

import os
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Annotated

import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .config import REPO_ROOT
from .matching import _pick_station, parse_train, type_family
from .odds import BERLIN, WEEKDAYS

router = APIRouter(prefix="/api/history")
SOURCE = "Deutsche Bahn arrival data via piebro/deutsche-bahn-data, CC BY 4.0"
MAX_STOP_ROWS = 1000
MAX_ROUTE_TRAINS = 100
LATE = "coalesce({0}.arr_cancelled OR {0}.arr_delay >= {1}, false)"  # a cancelled arrival counts as late


def history_path() -> Path:
    path = Path(os.environ.get("SPAETKAUF_HISTORY_PATH") or "data/history.duckdb")
    return path if path.is_absolute() else REPO_ROOT / path


def open_history(path: Path | None = None) -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(path or history_path()), read_only=True, config={"threads": 4})


def history_cursor(request: Request) -> Iterator[duckdb.DuckDBPyConnection]:
    state = request.app.state
    if getattr(state, "history", None) is None:
        try:
            state.history = open_history()
        except duckdb.Error as exc:
            raise HTTPException(503, "Run history unavailable") from exc
    cur = state.history.cursor()
    try:
        yield cur
    finally:
        cur.close()


Cursor = Depends(history_cursor)


def _find_train(cur, train: str) -> tuple[int, str, str]:
    """(train id, type, number); a number is looked up across its type family, as in odds."""
    parsed = parse_train(train)
    if parsed is None:
        raise HTTPException(404, f"'{train}' is not a train like 'ICE 1103'")
    kind, number = parsed
    family = sorted(type_family(kind))
    found = cur.execute(
        f"SELECT id, train_type::VARCHAR, train_number FROM trains WHERE train_number = ? "
        f"AND train_type::VARCHAR IN ({','.join('?' * len(family))}) ORDER BY train_type::VARCHAR = ? DESC",
        [number, *family, kind],
    ).fetchall()
    if len(found) != 1 and not (found and found[0][1] == kind):
        raise HTTPException(404, f"No history for {kind} {number}")
    return found[0]


def _find_stop(name: str, keys: list[tuple[str, str]], context: str) -> tuple[str, str]:
    """(station key, display name) of the stop that `name` matches among (key, name) pairs."""
    key, _ = _pick_station(sorted({k for k, _ in keys}), name)
    if key is None:
        raise HTTPException(404, f"'{name}' is not a stop {context}")
    return key, min(n for k, n in keys if k == key)


def _all_stops(cur) -> list[tuple[str, str]]:
    return cur.execute("SELECT station_key, name FROM stops").fetchall()


def _iso(ts) -> str | None:
    return None if ts is None else ts.replace(tzinfo=BERLIN).isoformat()


def _hhmm(minutes) -> str | None:
    return None if minutes is None else f"{int(minutes) // 60 % 24:02d}:{int(minutes) % 60:02d}"


def _weekday(column: str, weekday: int | None) -> tuple[str, list[int]]:
    return ("", []) if weekday is None else (f" AND isodow({column}) - 1 = ?", [weekday])


def _summary(rows: list[tuple]) -> dict:
    """rows: (delay_min, cancelled)."""

    def late(m):
        return sum(c or (d is not None and d >= m) for d, c in rows)

    return {
        "n": len(rows), "late20": late(20), "late60": late(60), "late120": late(120),
        "cancelled": sum(c for _, c in rows),
    }  # fmt: skip


@router.get("")
def runs(
    train: str,
    stop: str,
    weekday: int | None = Query(None, ge=0, le=6),
    cur=Cursor,
):
    train_id, kind, number = _find_train(cur, train)
    stops = cur.execute(
        "SELECT DISTINCT s.station_key, s.name FROM events e JOIN stops s ON s.id = e.stop_id "
        "WHERE e.train_id = ?",
        [train_id],
    ).fetchall()
    key, name = _find_stop(
        stop, stops, f"of {kind} {number}; stops: {', '.join(sorted({n for _, n in stops}))}"
    )
    extra, args = _weekday("e.day", weekday)
    rows = cur.execute(
        f"SELECT e.day, e.arr_planned, e.arr_delay, e.arr_cancelled FROM events e "
        f"JOIN stops s ON s.id = e.stop_id WHERE e.train_id = ? AND s.station_key = ? "
        f"AND e.arr_planned IS NOT NULL{extra} ORDER BY e.arr_planned DESC",
        [train_id, key, *args],
    ).fetchall()
    return {
        "train": f"{kind} {number}",
        "stop": name,
        "weekday": None if weekday is None else WEEKDAYS[weekday],
        "runs": [
            {"date": day.isoformat(), "planned": _iso(planned), "delay_min": delay, "cancelled": cancelled}
            for day, planned, delay, cancelled in rows
        ],
        "summary": _summary([(delay, cancelled) for _, _, delay, cancelled in rows]),
        "source": SOURCE,
    }  # fmt: skip


@router.get("/train")
def train_stops(train: str, weekday: int | None = Query(None, ge=0, le=6), cur=Cursor):
    """The stops of one train with their run counts and 20+ min late share, for a lookup screen."""
    train_id, kind, number = _find_train(cur, train)
    extra, args = _weekday("e.day", weekday)
    rows = cur.execute(
        f"SELECT s.station_key, min(s.name), count(*), sum({LATE.format('e', 20)}::INT) FROM events e "
        f"JOIN stops s ON s.id = e.stop_id WHERE e.train_id = ? AND e.arr_planned IS NOT NULL{extra} "
        f"GROUP BY s.station_key ORDER BY min(s.name)",
        [train_id, *args],
    ).fetchall()
    return {
        "train": f"{kind} {number}",
        "weekday": None if weekday is None else WEEKDAYS[weekday],
        "stops": [
            {"stop": name, "key": key, "n": n, "late20": late, "late20_share": round(late / n, 4)}
            for key, name, n, late in rows
        ],
        "source": SOURCE,
    }  # fmt: skip


@router.get("/stop")
def stop_day(stop: str, day: Annotated[date, Query(alias="date")], cur=Cursor):
    """A past arrivals board: all long-distance arrivals at a stop on one date."""
    key, name = _find_stop(stop, _all_stops(cur), "in the history")
    first, last = cur.execute(
        "SELECT min(value::DATE), max(value::DATE) FROM meta WHERE key IN ('date_from', 'date_to')"
    ).fetchone()
    if not first <= day <= last:
        raise HTTPException(404, f"The history covers {first} to {last}, not {day}")
    rows = cur.execute(
        "SELECT t.train_type::VARCHAR, t.train_number, e.arr_planned, e.arr_delay, e.arr_cancelled, "
        "e.dep_planned, e.dep_delay, e.dep_cancelled "
        "FROM events e JOIN trains t ON t.id = e.train_id JOIN stops s ON s.id = e.stop_id "
        "WHERE s.station_key = ? AND e.day = ? AND e.arr_planned IS NOT NULL "
        f"ORDER BY e.arr_planned, t.train_type, t.train_number LIMIT {MAX_STOP_ROWS + 1}",
        [key, day],
    ).fetchall()
    return {
        "stop": name,
        "date": day.isoformat(),
        "truncated": len(rows) > MAX_STOP_ROWS,
        "arrivals": [
            {"train": f"{kind} {number}", "planned": _iso(planned), "delay_min": delay, "cancelled": cancelled,
             "departs": _iso(dep), "dep_delay_min": dep_delay, "dep_cancelled": dep_cancelled}
            for kind, number, planned, delay, cancelled, dep, dep_delay, dep_cancelled in rows[:MAX_STOP_ROWS]
        ],
        "source": SOURCE,
    }  # fmt: skip


@router.get("/route")
def route(
    from_: str = Query(alias="from"),
    to: str = Query(),
    weekday: int | None = Query(None, ge=0, le=6),
    cur=Cursor,
):
    """Trains that served `from` and then `to` on the same run, with how late they arrived at `to`."""
    stops = _all_stops(cur)
    a_key, a_name = _find_stop(from_, stops, "in the history")
    b_key, b_name = _find_stop(to, stops, "in the history")
    extra, args = _weekday("f.dep_planned", weekday)
    rows = cur.execute(
        f"""
        WITH f AS (
            SELECT e.run_id, e.seq, e.train_id, e.dep_planned FROM events e
            WHERE e.stop_id IN (SELECT id FROM stops WHERE station_key = ?) AND e.run_id IS NOT NULL
              AND e.dep_planned IS NOT NULL),
        j AS (
            SELECT f.train_id, e.arr_delay, e.arr_cancelled,
                   date_part('hour', f.dep_planned) * 60 + date_part('minute', f.dep_planned) AS dep_min,
                   date_part('hour', e.arr_planned) * 60 + date_part('minute', e.arr_planned) AS arr_min
            FROM f JOIN events e ON e.run_id = f.run_id AND e.seq > f.seq
            WHERE e.stop_id IN (SELECT id FROM stops WHERE station_key = ?) AND e.arr_planned IS NOT NULL
              {extra})
        SELECT t.train_type::VARCHAR, t.train_number, count(*) AS n,
               sum({LATE.format("j", 20)}::INT), sum({LATE.format("j", 60)}::INT),
               median(j.arr_delay), median(j.dep_min), median(j.arr_min)
        FROM j JOIN trains t ON t.id = j.train_id
        GROUP BY t.train_type, t.train_number ORDER BY n DESC LIMIT {MAX_ROUTE_TRAINS}
        """,
        [a_key, b_key, *args],
    ).fetchall()
    trains = [
        {"train": f"{kind} {number}", "n": n, "dep": _hhmm(dep), "arr": _hhmm(arr),
         "late20": l20, "late20_share": round(l20 / n, 4), "late60": l60, "late60_share": round(l60 / n, 4),
         "median_delay_min": None if med is None else round(med, 1)}
        for kind, number, n, l20, l60, med, dep, arr in rows
    ]  # fmt: skip
    trains.sort(key=lambda t: (t["dep"], t["train"]))
    return {
        "from": a_name,
        "to": b_name,
        "weekday": None if weekday is None else WEEKDAYS[weekday],
        "trains": trains,
        "source": SOURCE,
    }  # fmt: skip
