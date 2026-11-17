# How the odds are computed

## The table

`data/odds.sqlite` is built by `uv run --project backend python scripts/build_odds.py`. The script downloads the newest 12 monthly files of [piebro/deutsche-bahn-data](https://huggingface.co/datasets/piebro/deutsche-bahn-data) (CC BY 4.0) into `data/raw/`, checks their checksums and takes about two minutes once they are there. The odds are not in git: the `Data` workflow checks upstream daily and, when a month is added or reprocessed, rebuilds, runs the checks, publishes the files as a `data-*` release and pins it in `data/release.json`; `scripts/fetch_data.sh` downloads the pinned files. The app finds the file through `SPAETKAUF_ODDS_PATH` and reads `backtest.json` from the same directory.

The build of 2026-11-17 covers planned arrivals from 2025-11-01 to 2026-10-31: 3,051,935 long-distance arrivals in 244,509 rows, 26.6 MB. `train_stop_stats` has one row per train (type and number), stop (EVA) and weekday, with the run count `n`, the cancellations `n_cancel` and how many runs arrived at least 5, 10, 15, 20, 30, 45, 60, 90 and 120 minutes late (`ge5` to `ge120`). `meta` records the source, date range and build time.

Choices made while building it:

- Delay is `arrival_change_time - arrival_planned_time`. The dataset's `delay_in_min` is the departure delay at every stop except the last, so it is not used.
- A cancelled arrival counts as late at every threshold.
- Long-distance types only: ICE, IC, EC, ECE, EN, NJ, RJ, RJX, FLX, TGV, WB, ES, EST, EUR and D. Replacement trains are dropped because they run under another number.
- The same arrival can appear twice in the source. Rows are deduplicated on type, number, EVA and planned arrival, keeping the latest observation.
- The weekday is that of the planned arrival in Berlin time, 0 = Monday.
- Some stations have two EVAs (Berlin Hbf). The lookup sums all rows that share a `station_key`, computed by `backend/app/matching.py`.

## From table to odds

`backend/app/odds.py` does the lookup. For a direct train, the odds are the share of past runs on that weekday that reached your destination 20 or more minutes late. With changes, each change can be missed: the chance of a miss is the share of runs of the incoming train that arrived later than the change time minus 2 minutes, and the result is `1 - prod(1 - p_miss) * (1 - p_last)`. Those connections are labelled "estimate". The 60-minute odds use the last train only.

With fewer than 10 runs on that weekday, or a leg without a train number (FlixTrain legs often carry only "FLX10"), the connection gets no odds.

Every percentage is shrunk toward the same train at the same stop on all weekdays, which is itself shrunk toward the train type's overall rate: `p = (k + m * p_parent) / (n + m)` with m = 50. The counts shown next to it ("late 19 of 30 Fridays") stay raw.

## Backtest

`uv run scripts/backtest.py` (needs the files in `data/raw/`; add `--write` to update `data/backtest.json`) trains on arrivals from 2025-12-14 to 2026-08-31 and scores every long-distance arrival from 2026-09-01 to 2026-10-31. Only arrivals whose cell had at least 10 training runs count: 414,655 of 511,709. m = 50 was picked using the training period alone (trained through July, scored on August).

| | Brier | skill over a constant 26.0 % |
|---|---|---|
| constant rate | 0.1855 | 0 |
| plain k / n | 0.1680 | 9.5 % |
| shrunk, m = 50 | 0.1649 | 11.1 % |

Plain shares overstate the top: trains predicted at 93 % were late 67 % of the time. After shrinkage the top bucket predicts 74 % and sees 78 %, and nothing is predicted above 80 %. The cost is that the 40 to 70 % range now comes out 4 to 6 points below what happened. Higher odds were late more often across the whole range, from about 8 % to about 78 %.

What the backtest does not cover: runs on the same day are not independent (one storm or strike hits many trains), the multi-leg formula assumes changes are independent, and the backtest scores single EVAs while the app pools station aliases. A gradient-boosted model and a recency-weighted variant were also tried; neither beat the shrunk rates.
