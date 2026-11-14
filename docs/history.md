# Run history

`data/history.sqlite` holds every long-distance arrival behind the odds in `data/odds.sqlite`: one row per
(train, stop, date), so a number like "late 14 of 46 Saturdays" can be listed run by run.

- Source: piebro/deutsche-bahn-data (Hugging Face), CC BY 4.0, 2025-12-14 to 2026-10-31. The events come from
  `load_events` in `scripts/build_odds.py`, so filter, dedup and delay (arrival_change_time - arrival_planned_time)
  are identical; a cancelled arrival counts as late at every threshold, as in the odds.
- Layout: `trains`, `stops` (EVA, station_key as in odds, display name), `legs` (train x stop) and
  `runs (leg_id, day, planned_min, delay_min)`, WITHOUT ROWID. `day` is days since 1970-01-01 (weekday 0 = Monday is
  `(day + 3) % 7`), `planned_min` the local minute of the day, `delay_min` NULL for a cancelled run. The build
  stops if a non-cancelled arrival ever lacks a delay.
- Size: 2,687,871 runs, 42.6 MB (the committed file must stay under 45 MB; the cut if it ever grows is
  `--min-runs 5`, which saves little).
- Rebuild (needs the parquet files from `scripts/build_odds.py`): `uv run scripts/build_history.py [--raw DIR]`.
  It prints a consistency check of 3 random (train, stop, weekday) cells against `train_stop_stats`.
- API: `GET /api/history?train=ICE 1103&stop=München Hbf[&weekday=0-6]` returns the runs newest first and a summary;
  `GET /api/history/train?train=ICE 1103[&weekday=]` lists the stops with run counts and late share.
  Both answer 503 when the file is missing; its path is `SPAETKAUF_HISTORY_PATH`.
