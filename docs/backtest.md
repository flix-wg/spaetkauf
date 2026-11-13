# Backtest (task 2.4)

Run: `uv run scripts/backtest.py` (needs the parquet files from `build_odds.py`). Output: `data/backtest.json`.

## Method

- Odds from arrivals 2025-12-14 to 2026-08-31, per train (type and number), stop (EVA) and weekday: `p = ge20 / n`, same definitions as `odds.sqlite` (arrival delay, cancelled counts as late).
- Outcomes: every long-distance arrival from 2026-09-01 to 2026-10-31. Late = 20+ min or cancelled.
- Only arrivals whose cell had at least 10 training runs count: **414,655 of 511,709 test arrivals (81 %)**.
- Buckets of 10 points by predicted odds. Bucket counts sum to 414,655.

## Result

Base rate in the test period: **26.4 %** of all long-distance arrivals were 20+ min late or cancelled (24.6 % of the scored runs; 26.0 % in the training period). Cancellations alone: 5.0 %.

| odds bucket | predicted mean | observed late 20+ | runs |
|---|---|---|---|
| 0–10 % | 5.6 % | 10.0 % | 77,997 |
| 10–20 % | 14.8 % | 15.5 % | 109,498 |
| 20–30 % | 24.6 % | 23.7 % | 92,986 |
| 30–40 % | 34.4 % | 32.5 % | 58,767 |
| 40–50 % | 43.9 % | 40.8 % | 37,250 |
| 50–60 % | 53.6 % | 49.6 % | 22,626 |
| 60–70 % | 63.8 % | 57.8 % | 9,656 |
| 70–80 % | 73.2 % | 65.1 % | 3,701 |
| 80–90 % | 82.4 % | 68.3 % | 1,502 |
| 90–100 % | 93.1 % | 67.4 % | 672 |

Brier score 0.168 against 0.186 for always predicting the training base rate: a skill of 9.5 %.

## Reading

- The ranking holds: trains with higher historical odds were late more often in September and October, from 10 % in the lowest bucket to about two thirds in the top buckets.
- Between 10 % and 50 % the odds are close to what happened (within about 3 points).
- High odds overstate: above 60 % the observed rate is 6 to 26 points lower than predicted, and the top three buckets all land near 65–68 %. Cells with very high history are partly bad luck in the training months (few runs, construction periods) and regress toward the mean. The app should not promise more than "about two in three" for its best picks.
- Low odds understate: the 0–10 % bucket was late 10 % of the time.
- Runs on the same day are not independent (a storm or a strike hits many trains at once), so two test months are a small sample of conditions even with 414k runs. The connection odds in D6 also assume independence between legs; this backtest covers single train arrivals only and does not test that assumption.
- Nothing was tuned: one run, thresholds and cut-offs as written in tasks.md.
