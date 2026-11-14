# Tasks

Checkpoints (Helsinki time): core path on real data by Sat 14 Nov 10:00 · deployed by 16:00 · scope freeze 20:00 · video and deck by Sun 01:00 · submission set to FINAL by Sun 08:00.

## 1. Foundation

- [x] 1.1 Add MIT `LICENSE`, `.gitignore` (with `.env`, `data/raw/`, `node_modules`, `.venv`), `.env.example` listing every variable without values, and a short `README.md`; verify `git status` shows no secret or data file as trackable
- [x] 1.2 Scaffold `backend/` (uv project, FastAPI, pytest, ruff) with `GET /api/health`; verify `uv run pytest` passes and the endpoint answers locally
- [x] 1.3 Scaffold `frontend/` (Vite, React, TypeScript, Tailwind, vite-plugin-pwa, @fontsource fonts) with the colour and type tokens from design D13; verify `npm run build` succeeds and the backend serves the built app at `/`
- [x] 1.4 Copy the reference boards into `design/` with a one-paragraph note on which board maps to which screen; verify the files open

## 2. Odds data

- [x] 2.1 Write `scripts/build_odds.py` (DuckDB) that downloads the monthly parquet files for 2025-12 to 2026-10 into `data/raw/` and builds `data/odds.sqlite` per design D4; verify row counts per train type are printed and a spot check of one ICE train number matches a manual DuckDB query
- [x] 2.2 Document in `docs/odds.md` which delay column is used, the date range, the filters and the attribution line; verify the numbers quoted there come from the script output
- [x] 2.3 Probe matching (design D5): take 50 upcoming long-distance connections from Transitous on 5 routes, match every leg to `odds.sqlite`, and write the match rate and the misses to `docs/matching-probe.md`; verify the rate is at least 90 % or the coordinate fallback is added and the rate re-measured
- [x] 2.4 Write `scripts/backtest.py`: odds from 2025-12-14 to 2026-08-31, outcomes from 2026-09-01 to 2026-10-31, buckets of 10 points, overall base rate; write `data/backtest.json` and `docs/backtest.md`; verify bucket run counts sum to the test-period total

## 3. Picks

- [x] 3.1 Implement the Transitous client with cache, daily `/plan` budget, timeout and client name (design D3) and `GET /api/stations`; verify with a test using recorded responses that a repeated call is served from cache and the budget blocks call 701
- [x] 3.2 Implement odds lookup and connection odds (design D5, D6) with tests for: direct train, one change, thin history, cancelled runs
- [x] 3.3 Implement `GET /api/picks` with ranking, Kurt's pick, ride-instead (design D7), `already_posted` and the bahn.de link; verify against the live API that Hamburg Hbf to München Hbf returns picks with odds, and with tests for the no-alternative and already-posted cases

## 4. Tracking, board, replay, push

- [x] 4.1 Implement trips (`POST`, `GET`, `PATCH`, `DELETE` with id and secret) and the SQLite schema including snapshots and sent alerts; verify with tests that a wrong secret is rejected and delete removes the subscription
- [x] 4.2 Implement the background loop and state derivation (design D8) including stale detection, drop-back and once-only alerts; verify with a test that feeds a delay series 12, 24, 15, 26, 61 and expects exactly one +20 and one +60 alert
- [x] 4.3 Implement live alternatives for an unlocked trip and the switch-or-stay values; verify with a test that switching to an earlier arrival reports zero compensation at stake
- [x] 4.4 Implement `GET /api/late-now` from hub station boards with dedupe by train, and hourly auto-tracking of the three most delayed trains; verify against the live API that the board returns the checked count and that an auto-tracked trip accumulates snapshots
- [ ] 4.5 Implement Web Push (VAPID key endpoint, subscription storage, send on alert) and the replay endpoint (design D9, D10); verify on a phone or desktop browser that starting a replay delivers a notification containing "Replay" and the original date

## 5. Signals

- [x] 5.1 Implement the Exa search behind `GET /api/signals` using the request shape from Exa's current docs, with a 6 h cache and the unavailable state; verify with a real key on one route and date, and with a test for the missing-key path
- [x] 5.2 Filter out DB-owned hosts from fetching (links only) and cap at five items; verify with a test
- [x] 5.3 Implement `POST /hooks/context` with signature check and a one-off script that creates the page monitor for the watched pages, per `docs.context.dev`; verify a correctly signed sample is stored and a forged one gets 401

## 6. App screens

- [x] 6.1 Build the shell: bottom navigation, sources sheet, backtest sheet, loading, empty and error components, laptop frame with pitch line and QR code; verify at 390 px and 1280 px in a browser
- [x] 6.2 Build search and picks (pick card with book-to-ride pair, snail rating, counts line, signals area, banner, "Open on bahn.de", "I booked this" with optional price); verify the full path against the real backend
- [x] 6.3 Build my trips and the live trip screen (flap tiles, threshold meter, switch or stay, stale and finished states, replay label, in-app alert, notification opt-in); verify with a replay trip
- [x] 6.4 Build the late-now screen with the headline count and refresh time; verify against the real backend
- [x] 6.5 Build the claim screen with amount, reason and copy rows; verify the 34.99 at 71 minutes case shows 8.75
- [x] 6.6 Polish pass against the boards in `design/`: spacing, type scale, contrast, tap targets, reduced motion, installed-app icon and name; verify with screenshots of all five screens at 390 px

## 7. Claim

- [x] 7.1 Implement `GET /api/trips/{id}/claim` with the rounding and minimum rules and the switched case; verify with tests for 34.99 at 71 min, 12.90 at 65 min, 120+ min, no price, and switched

## 8. Deploy

- [x] 8.1 Write `deploy/Dockerfile`, `docker-compose.yml` and `Caddyfile`; verify `docker compose up` on the dev box serves the app and `/api/health` over the proxy
- [ ] 8.2 Provision the Verda CPU VM after checking price and credit balance, deploy, set `.env`; verify from a phone on mobile data that the HTTPS address loads and a search works
- [ ] 8.3 Write the restart and reset steps in `README.md`; verify by restarting the stack and finding booked trips intact

## 9. Integration and demo readiness

- [ ] 9.1 Run the whole journey on the deployed site in a fresh browser profile: search, book, live, replay with notification, claim, late now; record what failed and fix it
- [ ] 9.2 Confirm with server logs that no request went to a bahn.de host during 9.1
- [ ] 9.3 Tag the working version and note the tag and the demo address in `README.md`

## 10. Built after the plan

- [x] 10.1 Arrive-by mode for picks (`mode=arrive`, design D12): connections arriving in the 3 h before T, spare time, miss bound, late outcomes, Kurt's pick within the cap, and the two groups on the picks screen; test `test_arrive_mode_groups_bounds_and_kurts_pick`
- [x] 10.2 Opt-in earlier ride-instead (`before`, up to 60 min, design D7) with the toggle on the picks screen and the note on the card; test `test_earlier_ride_instead_only_with_before`
- [x] 10.3 Kurt's call from strike announcements (design D11): no pick on a covered day, `try_date`, warning on unclear dates, once-only push for watched trips; test `test_kurt_call_follows_strike_announcements` and the strike tests in `test_signals.py`
- [x] 10.4 Per-run history (`scripts/build_history.py`, `data/history.duckdb`, `GET /api/history*`, `deploy/upload_history.sh`, design D18, `docs/history.md`); tests in `backend/tests/test_history.py`, including a check against `train_stop_stats`
- [x] 10.5 Lookup screen (by train or route, optional weekday) and the runs sheet behind every odds line
- [x] 10.6 Fourth tab (Lookup) and the desktop layout with side bar and QR code that replaced the laptop phone frame (design D19)
- [x] 10.7 Replay picker on My trips (`GET /api/demo/recordings`, `recording` on `POST /api/demo/replay`) with history runs from `data/replays.json` (`docs/replays.md`)
- [x] 10.8 Watch auto-tracking: up to two trains an hour that are 8 to 19 min late, at most 12 open auto trips (design D8)
- [x] 10.9 Chrome MV3 extension (design D15, D16): parser for bahn.de result cards, badges in a closed shadow root, Kurt's pick, posted-delay flag, service worker with a 10 min cache, popup and settings, `POST /api/ext/odds`; tests `node --test` in `extension/`, `backend/tests/test_ext.py`, and `test/e2e.mjs` on local fixtures and one saved real page
- [x] 10.10 Selector adapter (design D17): text-free skeleton, `POST /api/ext/adapt` with line grammar, hash check, per-layout cache, daily cap and `ANTHROPIC_API_KEY`; tests in `extension/test/skeleton.test.js` and `test_adapt_*`

## Workflow follow-up

- Make the repository readable by the organisers before 15 Nov 10:00 Helsinki time.
- Archive this change after the event.
