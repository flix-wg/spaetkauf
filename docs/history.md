# Run history

`data/history.duckdb` holds every long-distance event behind the odds in `data/odds.sqlite`, so a number like
"late 14 of 46 Saturdays" can be listed run by run. It is not in git or in the image: it lives on the host in
`/opt/spaetkauf/history`, mounted read-only at `/history`.

- Source: piebro/deutsche-bahn-data (Hugging Face), CC BY 4.0, 2025-12-14 to 2026-10-31. Events come from
  `load_events` in `scripts/build_odds.py` (`with_departures=True` adds the rows that only depart, a train's
  first stop), so filter, dedup and delay (`arrival_change_time - arrival_planned_time`) are the odds' own.
  A cancelled arrival counts as late at every threshold, as in the odds.
- Layout: `trains` (type as ENUM, number), `stops` (EVA, station_key as in odds, display name), `meta`, and
  `events (train_id, stop_id, day, run_id, seq, arr_planned, arr_delay, arr_cancelled, dep_planned, dep_delay,
  dep_cancelled)`, stored sorted by (train, stop, day) so a per-train lookup reads a few row groups. Delays are
  SMALLINT minutes, NULL when cancelled or unknown. `arr_planned` is NULL on a train's first stop.
- `run_id` numbers one trip of a train. The source reuses `train_line_ride_id` every day, so a new run starts
  where the stop sequence resets or after 12 hours without an event.
- Size: 2,964,486 events (2,687,871 with an arrival, the odds' count), 357,131 runs, 65 MB.
- Build (needs the parquet files from `scripts/build_odds.py`, takes about 10 s):
  `uv run scripts/build_history.py [--raw DIR]`. It prints a consistency check of 3 random
  (train, stop, weekday) cells against `train_stop_stats`. The script and `backend/pyproject.toml` pin the same
  duckdb version: a file written by a newer DuckDB cannot be read by an older one.
- Upload: `deploy/upload_history.sh user@host` copies the file to `/opt/spaetkauf/history/` over one SSH
  connection under a temporary name and renames it when complete. Then restart the app (the connection is
  opened once at startup).

## API

- `GET /api/history?train=ICE 1103&stop=München Hbf[&weekday=0-6]`: the runs at that stop, newest first, with
  `summary` (n, late20, late60, late120, cancelled).
- `GET /api/history/train?train=ICE 1103[&weekday=]`: the train's stops with run counts and late20 share.
- `GET /api/history/stop?stop=München Hbf&date=2026-10-31`: a past arrivals board (up to 1000 rows).
- `GET /api/history/route?from=Hamburg Hbf&to=München Hbf[&weekday=]`: trains that served `from` and then `to`
  on the same run (join on `run_id`, `from.seq < to.seq`): n runs, late20/late60 share at `to`, median arrival
  delay, typical planned departure and arrival (median minute of day), sorted by departure; at most 100 trains.

Unknown train, stop or date answers 404 with a hint; a missing file answers 503 and the app still starts. The
app opens one read-only connection and uses a cursor per request. `SPAETKAUF_HISTORY_PATH` sets the path.

## Speed

`scripts/bench_history.py` (in-process requests, DuckDB with 4 threads, dev box, 50 random real queries per
endpoint; the route cases are real from/to pairs, plus all pairs among the 6 busiest stops):

| endpoint | p50 | p95 |
|---|---|---|
| runs (train + stop) | 10 ms | 11 ms |
| train | 6.5 ms | 7.7 ms |
| stop + date | 7.7 ms | 10 ms |
| route | 18 ms | 23 ms |
| route, busiest stops | 22 ms | 24 ms |
| route + weekday | 16 ms | 20 ms |

Before frontend build/test in CI or a fresh checkout, run `scripts/fetch_duckdb_ext.sh` to fetch and verify the self-hosted DuckDB-WASM Parquet extension.
