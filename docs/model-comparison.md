# Booking-time model comparison

Decision: no candidate clears the shipping bar; keep the current method.

## Common test comparison

All percentages below use exactly the current backtest coverage gate: at least 10 unweighted training arrivals for (train type, train number, EVA, weekday). No method is rewarded for dropping difficult cases. Brier and log loss score individual arrivals; ranking weights groups equally. ECE is the count-weighted absolute predicted–observed gap in fixed 10-point bins; the second calibration guard is the largest gap in a bin with at least 1,000 arrivals. These guards were defined before inspecting test results.

| Method | Brier ↓ | Log loss ↓ | Brier skill ↑ | ECE ↓ | Max calibration gap, n≥1000 ↓ | Coverage | First pick 20+ ↑ | Random pick |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 0.164926 | 0.503849 | 0.1111 | 0.0161 | 0.0555 | 81.03% | 34.03% | 23.19% |
| Tuned | 0.164747 | 0.503190 | 0.1120 | 0.0118 | 0.0417 | 81.03% | 34.06% | 23.19% |
| Recency | 0.165591 | 0.505611 | 0.1075 | 0.0181 | 0.0432 | 81.03% | 33.92% | 23.19% |
| LightGBM raw | 0.171466 | 0.522341 | 0.0758 | 0.0458 | 0.1506 | 81.03% | 33.36% | 23.19% |
| LightGBM calibrated | 0.171619 | 0.527363 | 0.0750 | 0.0343 | 0.1551 | 81.03% | 32.92% | 23.19% |
| Baseline Platt | 0.166789 | 0.508787 | 0.1010 | 0.0451 | 0.0627 | 81.03% | 34.03% | 23.19% |

Training-period constant probability 0.260213: Brier 0.185531, log loss 0.558091, skill 0, same coverage; all ranking scores tie so its first-pick rate equals random.

Train: 2025-12-14–2026-08-31 (2,176,162 arrivals). Test: 2026-09-01–2026-10-31 (511,709); scored 414,655, observed rate 24.5677%. Baseline Brier 0.164926246155 matches data/backtest.json's 0.1649 and all eight rounded bucket values exactly.

Ranking group: (EVA stop, planned calendar date, floor(planned hour / 3)), with ≥2 covered arrivals. 59,358 groups; highest predicted probability wins, equal scores average their outcomes. Random means the mean event rate within each group, then the mean over groups. This measures choice among nearby destination arrivals, not a shared origin/destination route search.

### Paired uncertainty

95% day-block bootstrap intervals for baseline Brier minus candidate Brier (3,000 resamples of the 61 test days; shared daily shocks retained; no model selection uses this):

| Candidate | Brier improvement | 95% interval |
|---|---:|---|
| Tuned | 0.000179 | [0.000058, 0.000303] |
| Recency | -0.000665 | [-0.001317, -0.000013] |
| LightGBM raw | -0.006540 | [-0.007349, -0.005741] |
| LightGBM calibrated | -0.006692 | [-0.008196, -0.005242] |
| Baseline Platt | -0.001862 | [-0.003243, -0.000427] |

## Methods and leakage controls

- Read source parquet in place from `/home/felix/projects/spaetkauf/data/raw`; no downloads, raw-file copies, DB requests, or `.env` reads. DuckDB pinned project dependency 2.0.0; 4 threads and 5 GB SQL memory limit. The reproduction script generates `.model/events.duckdb`, a derived, filtered, deduplicated arrival cache; it was removed after analysis. Python model dependencies supplied with `uv run --with`; runtime dependencies unchanged.
- Existing `load_events` deduplication, long-distance types, replacement exclusion, planned-date boundaries and cancellation policy retained. Event-level baseline was asserted equal to existing `scored_cells`/`evaluate` at 1e-12 tolerance. No missing-delay events remain in this extract.
- Fit through 2026-06-30; validation 2026-07-01–2026-08-31. Shrinkage and recency candidates selected on validation Brier, then all training data through August used for final test predictions. Raw ≥10 coverage gate fixed from unweighted counts. Exponential weights reference midnight after the last fit date; no test-period rates, realtime, delays or cancellations are prediction features.
- Grid: m ∈ {5,15,30,50,80,120,200}; half-life ∈ {0 (no decay),30,60,120 days}; parent chains cell→train/stop→type, cell→train/stop→train→type, cell→train/stop→type/stop→type, cell→type. Every hierarchy level uses the same m. All validation scores in `tuning.json`.
- Tuned selection: {'half': 0, 'chain': 'cell-station-type', 'm': 50, 'brier': 0.1823042094645852}. Recency selection: {'half': 60, 'chain': 'cell-station-type', 'm': 15, 'brier': 0.181070014195112}.
- LightGBM features: train type, train number category, joint type/number category, numeric number, EVA category, weekday, planned hour and its sine/cosine, month, day of year, scheduled stop sequence. No target-encoded features or origin-times estimated from realized runs. Categories use fixed input labels; no test outcomes or rates enter fit. Stop sequence is available in the historical timetable but would require routing metadata or a historical mapping to serve.
- LightGBM: learning rate .05, λ₂=10, feature fraction .9, seed 42, four threads; (leaves,min child) ∈ {(15,200),(31,300),(63,500)}, up to 650 trees, validation log-loss early stopping after 40 rounds. Validation results: [{'leaves': 15, 'min_child': 200, 'trees': 29, 'brier': 0.187759100440861}, {'leaves': 31, 'min_child': 300, 'trees': 28, 'brier': 0.18980034351330205}, {'leaves': 63, 'min_child': 500, 'trees': 15, 'brier': 0.19178064149882404}]. Candidate configuration selected by validation Brier on covered arrivals.
- Calibration selection: July predictions fit Platt/isotonic; August compares them (Brier {'none': 0.18546310931151688, 'isotonic': 0.1812798052000343, 'platt': 0.1825360814222201}). Chosen isotonic; refit calibration on July–August covered predictions, refit selected LightGBM on all pre-September arrivals for the selected number of trees, and transfer calibration. The raw model is shown for transparency. Validation used for tuning and calibration is not an unbiased model evaluation; the untouched test period is the evaluation.
- Additional small challenger: Platt scaling of baseline, fitted on July–August predictions from the pre-July baseline; transferred to the full-training baseline. No test-driven calibration.
- The current server shrinks each requested threshold in `backend/app/odds.py` (`shrunk_rate`/`rate`), after matching names and pooling station-key aliases in `matching.py`. Backtest uses EVA cells, as requested; this reproduces the published benchmark but does not exercise live station-family/name matching. Multi-leg p20 multiplies probabilities of reaching transfers and last-leg on-time arrival; p60 uses only the last leg. Raw counts remain the explanation.

## 20+ calibration by the original 10-point bins

### Baseline

| Bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 0-10% | 38,010 | 0.0774 | 0.0764 |
| 10-20% | 137,433 | 0.1505 | 0.1329 |
| 20-30% | 114,505 | 0.2471 | 0.2362 |
| 30-40% | 69,199 | 0.3458 | 0.3532 |
| 40-50% | 37,588 | 0.4434 | 0.4834 |
| 50-60% | 14,088 | 0.5416 | 0.5971 |
| 60-70% | 3,423 | 0.6330 | 0.6810 |
| 70-80% | 409 | 0.7379 | 0.7751 |

### Tuned

| Bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 0-10% | 46,334 | 0.0741 | 0.0766 |
| 10-20% | 131,857 | 0.1498 | 0.1364 |
| 20-30% | 109,129 | 0.2471 | 0.2379 |
| 30-40% | 68,312 | 0.3459 | 0.3475 |
| 40-50% | 38,538 | 0.4432 | 0.4722 |
| 50-60% | 15,186 | 0.5409 | 0.5826 |
| 60-70% | 4,421 | 0.6403 | 0.6689 |
| 70-80% | 777 | 0.7300 | 0.7207 |
| 80-90% | 101 | 0.8111 | 0.7624 |

### Recency

| Bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 0-10% | 50,170 | 0.0716 | 0.0794 |
| 10-20% | 119,006 | 0.1509 | 0.1376 |
| 20-30% | 102,440 | 0.2477 | 0.2258 |
| 30-40% | 68,737 | 0.3462 | 0.3219 |
| 40-50% | 40,982 | 0.4455 | 0.4220 |
| 50-60% | 21,617 | 0.5436 | 0.5269 |
| 60-70% | 8,742 | 0.6404 | 0.6320 |
| 70-80% | 2,392 | 0.7401 | 0.6969 |
| 80-90% | 569 | 0.8222 | 0.6749 |

### LightGBM raw

| Bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 10-20% | 83,860 | 0.1750 | 0.0989 |
| 20-30% | 170,357 | 0.2414 | 0.1888 |
| 30-40% | 142,242 | 0.3470 | 0.3550 |
| 40-50% | 13,772 | 0.4350 | 0.5733 |
| 50-60% | 3,778 | 0.5312 | 0.6818 |
| 60-70% | 646 | 0.6302 | 0.7074 |

### LightGBM calibrated

| Bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 0-10% | 13,099 | 0.0822 | 0.0716 |
| 10-20% | 195,141 | 0.1499 | 0.1463 |
| 20-30% | 119,459 | 0.2411 | 0.2778 |
| 30-40% | 75,766 | 0.3155 | 0.4233 |
| 40-50% | 3,294 | 0.4393 | 0.5944 |
| 50-60% | 2,184 | 0.5836 | 0.6200 |
| 60-70% | 3,374 | 0.6339 | 0.6369 |
| 70-80% | 1,634 | 0.7242 | 0.7118 |
| 90-100% | 704 | 1.0000 | 0.7060 |

### Baseline Platt

| Bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 0-10% | 28,550 | 0.0761 | 0.0735 |
| 10-20% | 109,721 | 0.1518 | 0.1171 |
| 20-30% | 103,143 | 0.2492 | 0.1975 |
| 30-40% | 76,677 | 0.3466 | 0.2840 |
| 40-50% | 50,965 | 0.4470 | 0.3910 |
| 50-60% | 29,783 | 0.5441 | 0.5036 |
| 60-70% | 12,490 | 0.6424 | 0.6024 |
| 70-80% | 3,036 | 0.7321 | 0.6963 |
| 80-90% | 290 | 0.8301 | 0.7724 |

## 60+/120+ and cash-back proxy

These are destination arrival outcomes at each sampled stop, not whole-journey claims. Compensation proxy per EUR100 = 25 × (P60 + P120), equivalent to 25 × P60–119 + 50 × P120. Crucial: the existing labels treat cancellations as positive at every threshold. Cancellation lifts binding but these labels do not establish a 120-minute final-journey delay or cash entitlement. Keep cash-back as an experimental historical proxy; do not present it as money a buyer can expect to receive. Actual alternative travel, booked fare, eligibility, and delays already posted at booking are unavailable.

| Predictor | Brier | Log loss | ECE |
|---|---:|---:|---:|
| Baseline P60 | 0.073338 | 0.272460 | 0.0173 |
| Baseline P120 | 0.048014 | 0.196011 | 0.0154 |
| Recency P60 | 0.074281 | 0.276013 | 0.0198 |
| Recency P120 | 0.048578 | 0.198382 | 0.0144 |

### Baseline P60

| Probability bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 0-10% | 242,341 | 0.0608 | 0.0515 |
| 10-20% | 148,496 | 0.1358 | 0.1123 |
| 20-30% | 19,906 | 0.2343 | 0.1772 |
| 30-40% | 3,532 | 0.3350 | 0.2426 |
| 40-50% | 330 | 0.4321 | 0.4636 |
| 50-60% | 50 | 0.5360 | 0.5400 |

### Baseline P120

| Probability bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 0-10% | 335,668 | 0.0491 | 0.0397 |
| 10-20% | 72,757 | 0.1297 | 0.0961 |
| 20-30% | 5,784 | 0.2368 | 0.1132 |
| 30-40% | 446 | 0.3180 | 0.0919 |

### Baseline EUR100

Mean predicted EUR4.119 vs observed proxy EUR3.302 per EUR100 fare.

| Predicted EUR range | n | Mean predicted EUR | Observed proxy EUR |
|---|---:|---:|---:|
| [0, 2.5] | 117,063 | 1.692 | 1.568 |
| [2.5, 5] | 174,903 | 3.639 | 2.928 |
| [5, 7.5] | 85,765 | 6.048 | 4.915 |
| [7.5, 10] | 26,027 | 8.436 | 6.398 |
| [10, 15] | 9,570 | 11.844 | 7.505 |
| [15, 25] | 1,327 | 16.438 | 10.268 |

### Recency P60

| Probability bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 0-10% | 244,713 | 0.0548 | 0.0538 |
| 10-20% | 132,560 | 0.1406 | 0.1061 |
| 20-30% | 29,535 | 0.2370 | 0.1566 |
| 30-40% | 5,829 | 0.3401 | 0.2187 |
| 40-50% | 1,570 | 0.4345 | 0.2732 |
| 50-60% | 380 | 0.5340 | 0.3737 |
| 60-70% | 68 | 0.6509 | 0.5294 |

### Recency P120

| Probability bucket | n | Predicted | Observed |
|---|---:|---:|---:|
| 0-10% | 331,282 | 0.0430 | 0.0397 |
| 10-20% | 71,067 | 0.1358 | 0.0905 |
| 20-30% | 10,451 | 0.2354 | 0.1165 |
| 30-40% | 1,659 | 0.3345 | 0.1025 |
| 40-50% | 184 | 0.4244 | 0.1739 |
| 50-60% | 12 | 0.5032 | 0.1667 |

### Recency EUR100

Mean predicted EUR4.157 vs observed proxy EUR3.302 per EUR100 fare.

| Predicted EUR range | n | Mean predicted EUR | Observed proxy EUR |
|---|---:|---:|---:|
| [0, 2.5] | 145,792 | 1.539 | 1.813 |
| [2.5, 5] | 143,376 | 3.621 | 3.022 |
| [5, 7.5] | 73,372 | 6.117 | 4.653 |
| [7.5, 10] | 32,293 | 8.567 | 5.740 |
| [10, 15] | 16,054 | 11.734 | 6.853 |
| [15, 25] | 3,743 | 17.584 | 9.251 |
| [25, 50.001] | 25 | 26.721 | 5.000 |

Cancelled scored arrivals: 18,532 (4.47%); their direct contribution to the observed proxy is EUR2.235/EUR100.

## Shipping decision and limits

Rule: require ≥0.005 test Brier reduction, ECE and supported-bin maximum error no worse than baseline, and first-pick hit rate no lower. A model must satisfy every condition. No test-set tuning or iterative feature search after seeing the final test scores.
Unverified: independent-leg composition, actual missed-transfer outcomes, live station matching coverage, new timetable/train numbers, future months, station-level distribution drift, selection on a specific origin/destination route, delay already posted when buying, and actual compensation paid. No legal eligibility claims are inferred from this dataset. No fresh deployment or frontend check is needed when keeping product code unchanged.

## Reproduction

From backend/: `uv run --with scikit-learn --with lightgbm --with pandas python ../.model/experiment.py`, then `uv run --with scikit-learn --with pandas python ../.model/report_results.py`. No network source requests are made by either script; uv may retrieve Python packages. Model versions: LightGBM 4.7.0, sklearn 1.9.1, pandas 3.1.1. `results.json` contains all numeric results; The experiment generates `predictions.npz` for paired checks; that file was removed after report generation to keep this worktree small.

## Verification and workspace changes

- `cd backend && uv run ruff check . && uv run pytest -q`: lint passed; 129 passed, 1 skipped in 277.23 s. These run the existing mocked service entry points, odds, thin-history, cancellations and transfer behavior; no live source or deployment validation was attempted.
- Asserted exact event-level agreement with the existing baseline evaluator and equality of every published calibration-bucket field.
- Product/build/backtest code, dependency manifests, specs and `data/odds.sqlite` are unchanged. Table remains 22,867,968 bytes (22.87 MB / 21.81 MiB). Only offline research artifacts under `.model/` were added, all uncommitted; no commits, pushes or branch/remote changes.
- Review covered statistical correctness/leakage, booking-time feature availability, server compatibility/fallback feasibility, calibration and ranking behavior, cancellation interpretation and reproducibility. No candidate qualifies, so no serving migration, schema change or rebuilt table is warranted. SQL memory capped at 5 GB; model training used four threads and full training data; total process peak RSS was not measured.
