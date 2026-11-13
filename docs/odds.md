# Odds data

`data/odds.sqlite` is built by `uv run scripts/build_odds.py` (downloads missing months into `data/raw/`, about 10 s once downloaded). Table `train_stop_stats` as in design D4, index `idx_train_weekday (train_type, train_number, weekday)`, table `meta (key, value)` with source, date range, row counts and build time.

## Source and attribution

Delay history: [piebro/deutsche-bahn-data](https://huggingface.co/datasets/piebro/deutsche-bahn-data) on Hugging Face, licence CC BY 4.0. Files `monthly_processed_data/data-2025-12.parquet` to `data-2026-10.parquet`.

Attribution line for the app: "Delay history: piebro/deutsche-bahn-data (CC BY 4.0), arrivals 14 Dec 2025 to 31 Oct 2026."

## Date range and size

- Arrivals with planned time from 2025-12-14 to 2026-10-31 (current timetable year up to the last full month).
- 2,687,871 long-distance arrival events after filters and deduplication.
- 209,962 rows (train, stop, weekday), 22.9 MB. No `n` cut needed (`--min-n 1`); `--min-n 3` is available if the file has to shrink.

| type | rows | trains | arrivals | share 20+ late or cancelled |
|---|---|---|---|---|
| ICE | 146,329 | 1,296 | 1,834,610 | 26.1 % |
| IC | 47,341 | 615 | 556,624 | 24.9 % |
| FLX | 2,930 | 56 | 51,859 | 38.7 % |
| RJ | 2,917 | 113 | 52,132 | 23.0 % |
| NJ | 2,853 | 67 | 52,542 | 36.1 % |
| ECE | 2,629 | 173 | 32,798 | 25.2 % |
| EC | 1,928 | 115 | 37,767 | 22.2 % |
| EN | 666 | 29 | 20,376 | 31.1 % |
| TGV | 654 | 61 | 12,978 | 25.8 % |
| WB | 554 | 12 | 16,626 | 9.3 % |
| RJX | 468 | 18 | 9,377 | 23.5 % |
| EUR | 248 | 16 | 5,303 | 28.0 % |
| EST | 238 | 15 | 2,393 | 21.1 % |
| D | 144 | 14 | 1,266 | 33.3 % |
| ES | 63 | 6 | 1,220 | 41.6 % |

## Decisions from the data

- **Delay column.** `delay_in_min` is the departure delay wherever the train departs: it equals `departure_change_time - departure_planned_time` on 100 % of ICE/IC rows with a departure (2,253,052 rows) but the arrival delay on only 40.6 % of them. Only at terminal stops (246,815 rows) does it equal the arrival delay. The odds therefore use `arrival_change_time - arrival_planned_time`. `arrival_change_time` is never empty when a planned arrival exists (the processed data fills it with the planned time when no change was reported), so the "0 when no change" rule from D4 is already applied upstream.
- **Cancellations.** `arrival_is_canceled` rows keep their planned times and count in every `ge*` column and in `n_cancel`. Cancelled share of ICE arrivals per month: 3.5 % to 12.5 % (January 2026).
- **Train types.** The data has many more types (regional operators, buses). Long-distance kept: ICE, IC, EC, ECE, EN, NJ, RJ, RJX, FLX, TGV, plus WB (Westbahn), ES (European Sleeper), EST and EUR (Eurostar), D (Hamburg–Malmö) because they appear with long-distance stops. `IR`, `EX`, lower-case `ice` (6 rows) and numeric junk types are left out. RJX has 18 trains, TGV 61; both are in.
- **Replacement trains** (`is_replacement_train`) are dropped: they run under another number than the scheduled train. Rows without a plan record (`has_plan_record = false`, about 7 % of ICE/IC arrivals) and additional stops are kept; they are real arrivals of that train.
- **Duplicates.** `id` is unique, but the same arrival can appear twice (2 of 525,530 ICE arrivals in Jan–Mar). Arrivals are deduplicated on (type, number, EVA, planned arrival), keeping the latest observation. `train_line_ride_id` is not a run id (it repeats across days).
- **Weekday** is that of the planned arrival at the stop, local time, 0 = Monday. The backend must use the leg's `scheduledArrival` converted to Europe/Berlin.
- **Station names.** Each EVA gets its most frequent `station_name`; `station_key` is computed from it with `scripts/matching.py`. Some stations have two EVAs (Berlin Hbf 08011160 and 08098160); the lookup sums rows that share a key.
- **Monthly coverage** is complete: every day from Dec 2025 to Oct 2026 has ICE arrivals (about 164k–189k per month).

## Spot check

ICE 785 at München Hbf on Fridays, manual DuckDB query on the parquet files: 46 runs, 3 cancelled, 12 at 20+ min, 5 at 60+ min. Same numbers in `odds.sqlite` (`n=46, n_cancel=3, ge20=12, ge60=5`, 2025-12-19 to 2026-10-30).
