"""Latency of the /api/history endpoints on data/history.duckdb: p50/p95 over random real queries.

cd backend && uv run python ../scripts/bench_history.py [N]
"""

import random
import statistics
import sys
import time

from fastapi.testclient import TestClient

from app.history import history_path, open_history
from app.main import app

N = int(sys.argv[1]) if len(sys.argv) > 1 else 50
db = open_history()
trains = db.execute(
    f"SELECT train_type::VARCHAR || ' ' || train_number FROM trains USING SAMPLE {N} ROWS",
).fetchall()
stops = db.execute(f"SELECT name FROM stops USING SAMPLE {N} ROWS").fetchall()
# real pairs: two stops of the same run, from before to after
pairs = db.execute(
    f"SELECT a.name, b.name FROM (SELECT run_id, stop_id sa, seq FROM events WHERE run_id IS NOT NULL "
    f"USING SAMPLE {N * 5} ROWS) f JOIN events e ON e.run_id = f.run_id AND e.seq > f.seq JOIN stops a ON a.id = f.sa "
    "JOIN stops b ON b.id = e.stop_id QUALIFY row_number() OVER (PARTITION BY f.run_id ORDER BY e.seq DESC) = 1",
).fetchall()
days = [
    r[0].isoformat()
    for r in db.execute(f"SELECT DISTINCT day FROM events USING SAMPLE {N} ROWS").fetchall()
]
real = db.execute(
    f"SELECT t.train_type::VARCHAR || ' ' || t.train_number, s.name FROM (SELECT train_id, stop_id FROM events "
    f"WHERE arr_planned IS NOT NULL USING SAMPLE {N} ROWS) e JOIN trains t ON t.id = e.train_id "
    "JOIN stops s ON s.id = e.stop_id"
).fetchall()
hubs = [
    r[0]
    for r in db.execute(
        "SELECT s.name FROM events e JOIN stops s ON s.id = e.stop_id GROUP BY s.name "
        "ORDER BY count(*) DESC LIMIT 6"
    ).fetchall()
]
pairs = pairs[:N]
rng = random.Random(1)
cases = {
    "runs": [("/api/history", {"train": t, "stop": s}) for t, s in real],
    "train": [("/api/history/train", {"train": t[0]}) for t in trains],
    "stop": [("/api/history/stop", {"stop": s[0], "date": rng.choice(days)}) for s in stops],
    "route": [("/api/history/route", {"from": a, "to": b}) for a, b in pairs],
    "route busiest": [
        ("/api/history/route", {"from": a, "to": b}) for a in hubs for b in hubs if a != b
    ],
    "route+weekday": [
        ("/api/history/route", {"from": a, "to": b, "weekday": rng.randrange(7)}) for a, b in pairs
    ],
}
client = TestClient(app)
print(f"{history_path()} ({history_path().stat().st_size / 1e6:.0f} MB), {N} queries per endpoint")
for name, qs in cases.items():
    ms, codes = [], {}
    for url, params in qs:
        t0 = time.perf_counter()
        r = client.get(url, params=params)
        ms.append((time.perf_counter() - t0) * 1000)
        codes[r.status_code] = codes.get(r.status_code, 0) + 1
    ms.sort()
    p95 = ms[min(len(ms) - 1, int(len(ms) * 0.95))]
    print(
        f"{name:14} p50 {statistics.median(ms):6.1f} ms  p95 {p95:6.1f} ms  max {ms[-1]:6.1f} ms  status {codes}"
    )
