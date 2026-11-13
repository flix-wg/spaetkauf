# /// script
# requires-python = ">=3.12"
# dependencies = ["duckdb>=1.1"]
# ///
"""Write data/replays.json: real historical runs for the demo replay (design D9).

uv run scripts/build_replays.py   (needs data/raw/ from scripts/build_odds.py)
"""

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import duckdb

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "replays.json"
MONTHS = ["2026-09", "2026-10"]
BERLIN = ZoneInfo("Europe/Berlin")
ATTRIBUTION = "Delay history: piebro/deutsche-bahn-data (CC BY 4.0)."

# (type, number, date of boarding, boarding stop, alighting stop). Coupled trains (e.g. ICE 844 and
# ICE 854 on 2026-10-30 share a run) are listed once.
RUNS = [
    ("ICE", "611", "2026-10-30", "Hamburg Hbf", "München Hbf"),
    ("ICE", "611", "2026-09-30", "Hamburg Hbf", "München Hbf"),
    ("ICE", "544", "2026-10-27", "Berlin Hauptbahnhof", "Köln Hbf"),
    ("ICE", "844", "2026-10-30", "Berlin Hauptbahnhof", "Köln Hbf"),
    ("ICE", "519", "2026-10-30", "Hamburg Hbf", "München Hbf"),
]


def utc(ts: datetime | None) -> str | None:
    if ts is None:
        return None
    return ts.replace(tzinfo=BERLIN).astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    files = ", ".join(f"'{RAW / f'data-{m}.parquet'}'" for m in MONTHS)
    con = duckdb.connect()
    con.execute(f"""
        CREATE TABLE stops AS
        SELECT regexp_replace(id, '-[0-9]+$', '') AS run_key, train_type, train_number,
               train_line_station_num AS n, station_name,
               arrival_planned_time AS ap, arrival_change_time AS ac,
               departure_planned_time AS dp,
               coalesce(arrival_is_canceled, false) AS cancelled
        FROM read_parquet([{files}])
        WHERE NOT coalesce(is_replacement_train, false)
        QUALIFY row_number() OVER (
            PARTITION BY regexp_replace(id, '-[0-9]+$', ''), train_line_station_num
            ORDER BY "time" DESC) = 1
    """)
    out = []
    for tt, tn, day, board, alight in RUNS:
        keys = con.execute(
            """SELECT DISTINCT a.run_key FROM stops a JOIN stops b USING (run_key)
               WHERE a.train_type = ? AND a.train_number = ? AND a.station_name = ?
                 AND b.station_name = ? AND a.n < b.n AND CAST(a.dp AS DATE) = ?""",
            [tt, tn, board, alight, day],
        ).fetchall()
        if len(keys) != 1:
            raise SystemExit(f"{tt} {tn} {day}: expected one run, found {len(keys)}")
        rows = con.execute(
            "SELECT n, station_name, ap, ac, dp, cancelled FROM stops WHERE run_key = ? ORDER BY n",
            [keys[0][0]],
        ).fetchall()
        names = [r[1] for r in rows]
        i, j = names.index(board), names.index(alight)
        stops = [
            {
                "stop": name,
                "planned_arr": utc(ap),
                "actual_arr": utc(ac),
                "delay_min": round((ac - ap).total_seconds() / 60) if ac and ap else None,
                "cancelled": bool(cancelled),
            }
            for _, name, ap, ac, _, cancelled in rows[i + 1 : j + 1]
        ]
        run = {
            "id": f"{tt}{tn}-{day}".lower(),
            "train": f"{tt} {tn}",
            "date": day,
            "from": board,
            "to": alight,
            "dep": utc(rows[i][4]),
            "arr": stops[-1]["planned_arr"],
            "stops": stops,
        }
        out.append(run)
        print(run["train"], day, board, "->", alight, [s["delay_min"] for s in stops])
    OUT.write_text(
        json.dumps({"attribution": ATTRIBUTION, "runs": out}, ensure_ascii=False, indent=1) + "\n"
    )
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
