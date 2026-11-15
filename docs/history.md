# Run history

`data/history.duckdb` lists every long-distance event behind `data/odds.sqlite`, so a line like "late 14 of 46 Saturdays" can be opened run by run. At 65 MB it is not in git. The Docker setup mounts it read-only at `/history`; `SPAETKAUF_HISTORY_PATH` sets the path. Without the file the app still starts and the history endpoints answer 503.

## Building it

```bash
uv run scripts/build_odds.py      # downloads the source data into data/raw/
uv run scripts/build_history.py   # about 10 s
```

The events come from the same `load_events` function as the odds, so filters, deduplication and the delay definition match. The script ends with a spot check of three random train, stop and weekday cells against `train_stop_stats`. It pins the same DuckDB version as `backend/pyproject.toml`, because an older DuckDB cannot read a file written by a newer one.

`deploy/upload_history.sh user@host` copies the file to `/opt/spaetkauf/history/` under a temporary name and renames it when the copy is complete. Restart the app afterwards; it opens the connection once at startup.

## Layout

- `trains` (type, number) and `stops` (EVA, `station_key`, display name).
- `events (train_id, stop_id, day, run_id, seq, arr_planned, arr_delay, arr_cancelled, dep_planned, dep_delay, dep_cancelled)`, sorted by train, stop and day. Delays are minutes, NULL when cancelled or unknown. `arr_planned` is NULL at a train's first stop.
- `run_id` numbers one trip of a train. The source reuses its ride id every day, so a new run starts where the stop sequence resets or after 12 hours without an event.

The current file has 2,964,486 events in 357,131 runs.

## API

- `GET /api/history?train=ICE 1103&stop=München Hbf[&weekday=0-6]`: the runs at that stop, newest first, with a summary.
- `GET /api/history/train?train=ICE 1103[&weekday=]`: the train's stops with run counts and late share.
- `GET /api/history/stop?stop=München Hbf&date=2026-10-31`: a past arrivals board.
- `GET /api/history/route?from=Hamburg Hbf&to=München Hbf[&weekday=]`: trains that served `from` and then `to` on the same run, with late shares, median delay and typical times.

Unknown trains, stops or dates answer 404. Most requests take 5 to 25 ms (`scripts/bench_history.py`).

## In the browser

The static site queries monthly Parquet files with DuckDB-WASM using HTTP range reads. Run
`scripts/fetch_duckdb_ext.sh` before a frontend build or test to fetch the self-hosted Parquet extension. The
WASM module ships gzipped; the CSP needs `script-src wasm-unsafe-eval` and `connect-src self blob:`.
