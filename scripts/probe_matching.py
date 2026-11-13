# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Task 2.3: match upcoming Transitous connections to data/odds.sqlite and report the rate (design D5).

Responses are cached in data/raw/transitous/ so a re-run makes no new /plan calls.
uv run scripts/probe_matching.py
"""

import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent))
from matching import find_stats, parse_train  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "raw" / "transitous"
API = "https://api.transitous.org/api/v1"
UA = os.environ.get("SPAETKAUF_CLIENT_NAME", "spaetkauf-demo/0.1")
PLAN_BUDGET = 20
BERLIN = ZoneInfo("Europe/Berlin")
ROUTES = [("Hamburg Hbf", "München Hbf"), ("Berlin Hbf", "Köln Hbf"), ("Frankfurt (Main) Hbf", "Berlin Hbf"),
          ("Stuttgart Hbf", "Hamburg Hbf"), ("München Hbf", "Köln Hbf")]
TIMES = ["2026-11-14T06:00:00Z", "2026-11-15T13:00:00Z"]
plan_calls = 0


def get(path: str, params: dict, cache_name: str) -> dict:
    global plan_calls
    f = CACHE / cache_name
    if f.exists():
        return json.loads(f.read_text())
    if path == "plan":
        plan_calls += 1
        if plan_calls > PLAN_BUDGET:
            raise SystemExit("plan budget exhausted")
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
        data = json.load(r)
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data))
    return data


def coords(name: str) -> str:
    res = get("geocode", {"text": name}, f"geocode_{name.replace(' ', '_')}.json")
    stop = next(x for x in res if x["type"] == "STOP")
    return f"{stop['lat']},{stop['lon']}"


def main() -> None:
    conn = sqlite3.connect(ROOT / "data" / "odds.sqlite")
    legs, conns = [], []
    for a, b in ROUTES:
        for t in TIMES:
            plan = get("plan", {"fromPlace": coords(a), "toPlace": coords(b), "time": t,
                                "transitModes": "HIGHSPEED_RAIL,LONG_DISTANCE", "numItineraries": 5, "directModes": ""},
                       f"plan_{a[:4]}_{b[:4]}_{t[:13]}.json")
            for it in plan["itineraries"]:
                rail = [leg for leg in it["legs"] if leg["mode"] not in ("WALK", "BIKE", "CAR")]
                results = []
                for leg in rail:
                    name = leg.get("routeShortName") or leg.get("displayName") or ""
                    arr = datetime.fromisoformat(leg["to"]["scheduledArrival"]).astimezone(BERLIN)
                    parsed = parse_train(name)
                    if parsed is None:
                        r = {"status": "no_train_number"}
                    else:
                        r = find_stats(conn, parsed[0], parsed[1], leg["to"]["name"], arr.weekday())
                    r.update(route=f"{a} - {b}", train=name, mode=leg["mode"], stop=leg["to"]["name"],
                             weekday=arr.weekday(), arr_local=arr.strftime("%a %d %H:%M"))
                    results.append(r)
                legs += results
                conns.append({"route": f"{a} - {b}", "dep": it["startTime"], "legs": results})
    (CACHE / "probe_results.json").write_text(json.dumps({"legs": legs, "connections": len(conns)}, indent=1))
    by = Counter(r["status"] for r in legs)
    found = sum(r["status"] in ("ok", "thin") for r in legs)
    ok_conns = sum(all(r["status"] == "ok" for r in c["legs"]) for c in conns)
    found_conns = sum(all(r["status"] in ("ok", "thin") for r in c["legs"]) for c in conns)
    print(f"new /plan calls this run: {plan_calls}")
    print(f"connections {len(conns)}, rail legs {len(legs)}, statuses {dict(by)}")
    print(f"legs with history found: {found}/{len(legs)} = {found / len(legs):.1%}; "
          f"with >=10 runs: {by['ok']}/{len(legs)} = {by['ok'] / len(legs):.1%}")
    print(f"connections all legs found: {found_conns}/{len(conns)}; all legs >=10 runs: {ok_conns}/{len(conns)}")
    print(f"matches via token overlap: {sum(r.get('match') == 'overlap' for r in legs)}, "
          f"via type fallback: {sum(bool(r.get('type_fallback')) for r in legs)}")
    for r in legs:
        if r["status"] != "ok" or r.get("match") == "overlap" or r.get("type_fallback"):
            extra = {k: r.get(k) for k in ("station_name", "station_key", "n", "stop_key", "known_keys", "train_type")
                     if r.get(k) is not None}
            print(f"  {r['status']:16} {r['train']:10} -> {r['stop']} ({r['arr_local']}) {extra}")


if __name__ == "__main__":
    main()
