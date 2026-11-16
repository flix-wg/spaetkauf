# Run history

`data/history.duckdb` lists every long-distance event behind `data/odds.sqlite`, so a line like "late 14 of 46 Saturdays" can be opened run by run. The source DuckDB file is not in git. The deployed app reads the committed monthly Parquet exports in `data/static/history/`, copied to `/data/history/` at build time; no history server is needed.

## Building it

```bash
uv run scripts/build_odds.py      # downloads the source data into data/raw/
uv run scripts/build_history.py   # about 10 s
```

The events come from the same `load_events` function as the odds, so filters, deduplication and the delay definition match. The script ends with a spot check of three random train, stop and weekday cells against `train_stop_stats`. It pins the same DuckDB version as `backend/pyproject.toml`, because an older DuckDB cannot read a file written by a newer one.

Export a rebuilt source with `uv run --project backend python scripts/export_static.py --history data/history.duckdb --out data/static`, then copy `data/static/history/` to `frontend/public/data/history/` before building.

## Layout

- `trains` (type, number) and `stops` (EVA, `station_key`, display name).
- `events (train_id, stop_id, day, run_id, seq, arr_planned, arr_delay, arr_cancelled, dep_planned, dep_delay, dep_cancelled)`, sorted by train, stop and day. Delays are minutes, NULL when cancelled or unknown. `arr_planned` is NULL at a train's first stop.
- `run_id` numbers one trip of a train. The source reuses its ride id every day, so a new run starts where the stop sequence resets or after 12 hours without an event.

The current file has 2,964,486 events in 357,131 runs.

## In the browser

The static site queries monthly Parquet files with DuckDB-WASM using HTTP range reads. Run
`scripts/fetch_duckdb_ext.sh` before a frontend build or test to fetch the self-hosted Parquet extension. The
WASM module ships gzipped; the CSP needs `script-src wasm-unsafe-eval` and `connect-src self blob:`.
