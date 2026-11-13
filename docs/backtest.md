# Backtest (task 2.4, shrinkage in 3.2)

Run: `uv run scripts/backtest.py` (needs the parquet files from `build_odds.py`); add `--write` to update `data/backtest.json`. About 3 s once the files are downloaded.

## Method

- Odds from arrivals 2025-12-14 to 2026-08-31, per train (type and number), stop (EVA) and weekday, same definitions as `odds.sqlite` (arrival delay, cancelled counts as late).
- Outcomes: every long-distance arrival from 2026-09-01 to 2026-10-31. Late = 20+ min or cancelled.
- Only arrivals whose cell had at least 10 training runs count: **414,655 of 511,709 test arrivals (81 %)**. Both methods below score exactly these runs.
- Two estimates per cell, scored on the same split:
  - **plain**: `p = k / n` (k = runs 20+ late or cancelled, n = runs).
  - **shrunk** (used by the app): `p = (k + m · p_parent) / (n + m)`, where `p_parent` is the same train at the same stop on all weekdays, itself shrunk the same way toward the train type's overall rate. Function `shrunk_rate` in `backend/app/odds.py`; the script calls that function.
- m was chosen on the training period only: cells from 2025-12-14 to 2026-07-31, scored on August 2026. Holdout Brier by m: plain 0.1800, m=5 0.1787, 10 0.1779, 15 0.1775, 20 0.1772, 30 0.1770, **50 0.1769**, 80 0.1774. m = 50 was then applied once to the test period.
- Buckets of 10 points by predicted odds. Bucket counts sum to 414,655.

## Result

Base rate in the test period: **26.4 %** of all long-distance arrivals were 20+ min late or cancelled (24.6 % of the scored runs; 26.0 % in the training period). Cancellations alone: 5.0 %.

| | Brier | skill over constant 26.0 % |
|---|---|---|
| constant training base rate | 0.1855 | 0 |
| plain k / n | 0.1680 | 9.5 % |
| **shrunk, m = 50** | **0.1649** | **11.1 %** |

| odds bucket | plain: predicted | observed | runs | shrunk: predicted | observed | runs |
|---|---|---|---|---|---|---|
| 0–10 % | 5.6 % | 10.0 % | 77,997 | 7.7 % | 7.6 % | 38,010 |
| 10–20 % | 14.8 % | 15.5 % | 109,498 | 15.0 % | 13.3 % | 137,433 |
| 20–30 % | 24.6 % | 23.7 % | 92,986 | 24.7 % | 23.6 % | 114,505 |
| 30–40 % | 34.4 % | 32.5 % | 58,767 | 34.6 % | 35.3 % | 69,199 |
| 40–50 % | 43.9 % | 40.8 % | 37,250 | 44.3 % | 48.3 % | 37,588 |
| 50–60 % | 53.6 % | 49.6 % | 22,626 | 54.2 % | 59.7 % | 14,088 |
| 60–70 % | 63.8 % | 57.8 % | 9,656 | 63.3 % | 68.1 % | 3,423 |
| 70–80 % | 73.2 % | 65.1 % | 3,701 | 73.8 % | 77.5 % | 409 |
| 80–90 % | 82.4 % | 68.3 % | 1,502 | – | – | 0 |
| 90–100 % | 93.1 % | 67.4 % | 672 | – | – | 0 |

`data/backtest.json` holds the shrunk result under the original keys (`buckets`, `brier`, `brier_skill`, ...), plus `method`, `shrinkage_m`, `m_selection` and the plain comparison under `plain`. With shrinkage there are no buckets above 80 %, so `buckets` has 8 entries.

## Reading

- Shrinkage is kept: it lowers the Brier score on the test period and fixes both ends. The lowest bucket now predicts 7.7 % and sees 7.6 % (plain: 5.6 % against 10.0 %); the top bucket predicts 74 % and sees 78 % (plain: 93 % against 67 %).
- The cost: no cell is predicted above 80 %, and between 40 % and 70 % the shrunk odds are now 4 to 6 points below what happened. Kurt understates the middle slightly instead of overstating the top; for a "how late is this train" claim that is the safer side.
- The ranking holds with either method: higher odds were late more often, from about 8 % to about 78 %.
- The counts shown to the traveller ("late 19 of 30 Fridays") stay raw; only the percentage is shrunk. The thin-history rule (fewer than 10 runs on that weekday: no odds) is unchanged, although shrinkage would allow odds for those cells too.
- Runs on the same day are not independent (a storm or a strike hits many trains at once), so two test months are a small sample of conditions even with 414k runs. The connection odds in D6 also assume independence between legs; this backtest covers single train arrivals only and does not test that assumption.
- The app's cell sums all EVAs that share a station key (Berlin Hbf has two); the backtest's cell is one EVA. The difference affects a handful of stations.
