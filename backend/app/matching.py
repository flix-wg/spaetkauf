"""Match a live leg (train name, alighting stop, weekday) to rows in odds.sqlite (design D5)."""

import re
import sqlite3
import unicodedata

LONG_DISTANCE_TYPES = (
    "ICE", "IC", "EC", "ECE", "EN", "NJ", "RJ", "RJX", "FLX", "TGV", "WB", "ES", "EST", "EUR", "D",
)  # fmt: skip
MIN_RUNS = 10
GE_COLUMNS = ("ge5", "ge10", "ge15", "ge20", "ge30", "ge45", "ge60", "ge90", "ge120")

_DROP = {"hbf", "hauptbahnhof", "bahnhof", "bf", "am"}
# Live feeds and the history label some trains differently; a number is looked up across its family only.
_FAMILIES = ({"ICE", "IC"}, {"EC", "ECE"}, {"RJ", "RJX"}, {"EN", "NJ"})
_FOLD = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def parse_train(short_name: str | None) -> tuple[str, str] | None:
    """'ICE 785' -> ('ICE', '785'). None without a separate number: 'FLX10' is a FlixTrain line, not a train."""
    m = re.fullmatch(r"\s*([A-Za-z]+)\s+0*(\d+)\s*", short_name or "")
    if not m:
        return None
    return m.group(1).upper(), m.group(2)


def station_tokens(name: str) -> list[str]:
    s = unicodedata.normalize("NFC", name or "").lower().translate(_FOLD)
    s = re.sub(r"\bs\s*\+\s*u\b", " ", s)
    return sorted({t for t in re.split(r"[^0-9a-z]+", s) if t and t not in _DROP})


def station_key(name: str) -> str:
    return " ".join(station_tokens(name))


def type_family(train_type: str) -> set[str]:
    return next((f for f in _FAMILIES if train_type in f), {train_type})


def _pick_station(keys: list[str], stop_name: str) -> tuple[str | None, str]:
    key = station_key(stop_name)
    if key in keys:
        return key, "exact"
    tokens = set(key.split())
    scored = sorted(((len(tokens & set(k.split())), k) for k in keys), reverse=True)
    if scored and scored[0][0] >= 1 and (len(scored) == 1 or scored[1][0] < scored[0][0]):
        return scored[0][1], "overlap"
    return None, "none"


def find_stats(
    conn: sqlite3.Connection, train_type: str, train_number: str, stop_name: str, weekday: int
) -> dict:
    """History of one train at one stop on one weekday (0 = Monday).

    Always returns a dict with `status`: ok | thin | unknown_train | stop_not_matched.
    Counts are summed over all EVA ids that share the matched station key.
    """
    train_number = str(int(train_number)) if str(train_number).isdigit() else str(train_number)
    found_type = train_type
    rows = conn.execute(
        "SELECT DISTINCT station_key FROM train_stop_stats WHERE train_type = ? AND train_number = ?",
        (train_type, train_number),
    ).fetchall()
    if not rows:
        family = type_family(train_type) - {train_type}
        types = conn.execute(
            f"SELECT DISTINCT train_type FROM train_stop_stats WHERE train_number = ? "
            f"AND train_type IN ({','.join('?' * len(family)) or 'NULL'})",
            (train_number, *family),
        ).fetchall()
        if len(types) != 1:
            return {
                "status": "unknown_train",
                "train_type": train_type,
                "train_number": train_number,
            }
        found_type = types[0][0]
        rows = conn.execute(
            "SELECT DISTINCT station_key FROM train_stop_stats WHERE train_type = ? AND train_number = ?",
            (found_type, train_number),
        ).fetchall()
    key, how = _pick_station([r[0] for r in rows], stop_name)
    if key is None:
        return {
            "status": "stop_not_matched",
            "train_type": found_type,
            "train_number": train_number,
            "stop_key": station_key(stop_name),
            "known_keys": sorted(r[0] for r in rows),
        }
    sums = ", ".join(f"COALESCE(SUM({c}), 0)" for c in ("n", "n_cancel", *GE_COLUMNS))
    r = conn.execute(
        f"SELECT {sums}, MIN(first_date), MAX(last_date), GROUP_CONCAT(DISTINCT eva), MIN(station_name) "
        "FROM train_stop_stats WHERE train_type = ? AND train_number = ? AND station_key = ? AND weekday = ?",
        (found_type, train_number, key, weekday),
    ).fetchone()
    names = ("n", "n_cancel", *GE_COLUMNS, "first_date", "last_date", "eva", "station_name")
    out = dict(zip(names, r))
    out.update(
        train_type=found_type,
        train_number=train_number,
        station_key=key,
        match=how,
        weekday=weekday,
        type_fallback=found_type != train_type,
    )
    out["status"] = "ok" if out["n"] >= MIN_RUNS else "thin"
    return out
