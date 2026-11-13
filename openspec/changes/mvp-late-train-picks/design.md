# Design

## Context

See proposal.md for motivation. Constraints that shape the design:

- About 33 build hours, one human, agent-built. Final submission 15 Nov 10:00 Helsinki; scope freeze 14 Nov 20:00.
- Judges and peers try the demo live on their own phones and may type any route. The demo must stay reachable until about 22 Nov.
- bahn.de's terms forbid automated extraction and access outside its user interface, so the product is its own site and only links there.
- Probed on 14 Nov: Transitous (`api.transitous.org`, MOTIS) returns DB long-distance connections with train names and live times (ICE 514 at Hamburg Hbf showed +37 min). Its stop ids are DELFI ids, not EVA numbers.
- Probed: `piebro/deutsche-bahn-data` (`monthly_processed_data/data-YYYY-MM.parquet`, about 360 MB per month) has `train_type`, `train_number`, `eva`, `station_name`, `delay_in_min`, `arrival_planned_time`, `arrival_change_time`, `arrival_is_canceled`, `train_line_station_num`, `time`.

## Goals / Non-Goals

**Goals:**
- One process, one database file, one container: deployable and restartable in minutes.
- One contract between backend and frontend, fixed below, so both are built in parallel.
- Every number on screen is computed from real data or labelled as replay.

**Non-Goals:**
- A delay forecast model. Odds are base rates.
- Horizontal scaling, accounts, payments, prices.
- Self-hosted routing. Transitous is enough for a non-commercial open-source demo; self-hosted MOTIS on gtfs.de is the product path and is not built now.

## Decisions

### D1. Own installable web app, no extension
An extension's only extra value is reading and changing bahn.de, which is the legally unsafe part, and on iPhone it needs an App Store app. A site is one link for judges. Alternative rejected: Safari/Chrome extension.

### D2. Layout and stack
```
backend/    FastAPI app (Python 3.12, uv), SQLite, one asyncio background loop
frontend/   Vite + React + TypeScript + Tailwind, vite-plugin-pwa, fonts via @fontsource
scripts/    build_odds.py, backtest.py (DuckDB)
data/       odds.sqlite (committed if under 25 MB), backtest.json
deploy/     Dockerfile (node build stage, python runtime), docker-compose.yml, Caddyfile
design/     mockup boards from the concept phase, reference only
```
The backend serves the built frontend, so there is one origin and no CORS. FastAPI over Node because the odds job is Python and DuckDB. SQLite over Postgres because there is one writer.

### D3. Transitous is the only route and live source
All calls go through one client module with: a client name in the User-Agent (configurable, no personal data), an in-memory plus SQLite cache (plan 10 min, trip 60 s, station board 120 s, geocode 24 h), a daily counter for `/plan` capped at 700, and a 10 s timeout with one retry. Long-distance filter: `transitModes=HIGHSPEED_RAIL,LONG_DISTANCE`. Alternative rejected: DB Timetables API (needs an account, gives boards only, no routing) and db-vendo-client (wraps bahn.de's internal API).

### D4. Odds table
`scripts/build_odds.py` reads the monthly parquet files for the current timetable year (14 Dec 2025 to 31 Oct 2026), keeps long-distance train types (ICE, IC, EC, ECE, RJ, RJX, NJ, FLX, TGV), and writes one row per train number, stop and weekday:

`train_stop_stats(train_type, train_number, eva, station_name, station_key, weekday, n, n_cancel, ge5, ge10, ge15, ge20, ge30, ge45, ge60, ge90, ge120, first_date, last_date)`

Arrival delay is `arrival_change_time - arrival_planned_time` in minutes (0 when no change is recorded and the run has a plan record); the script checks this against `delay_in_min` on a sample and documents which it uses. A cancelled arrival counts in every `ge*` column. `station_key` is the normalised name (lower case, without "hbf", "hauptbahnhof", "bahnhof", "s+u", brackets and punctuation, tokens sorted).

### D5. Matching a live connection to history
Key: train type and number from the leg's short name ("ICE 785"), then the stop by `station_key` among that train's recorded stops; if no exact key matches, the stop with the highest token overlap, accepted only when at least one token matches and it is unique. No coordinates table unless the match rate on 50 upcoming connections is under 90 %; then add EVA coordinates from an open station list and match by distance under 1.5 km. This probe is task 2.3 and gates the picks work.

### D6. Odds for a connection
- Direct: `p20 = ge20 / n` at the alighting stop, for the weekday of travel. Shown with `ge20` and `n`.
- With changes: `p = 1 - (1 - p_miss_1)...(1 - p_last20)`, where `p_miss_i` is the share of runs of leg i that arrived at the change stop later than the scheduled change time minus 2 minutes (taken from the nearest `ge*` bucket at or below it) and `p_last20` is the last leg's `ge20 / n`. Labelled as an estimate. Independence between legs is an assumption and is stated in the backtest note.
- Fewer than 10 runs for any needed leg: no odds.

### D7. Ride-instead
From the same `/plan` answer plus one neighbouring page: connections other than the booked one departing between 60 min before and 120 min after it, excluding legs on reservation-only trains (per DB's FAQ: TGV/ICE to France, trains to Poland, to Milan via Basel; detected by train type TGV or a foreign terminus in that list). Choose the earliest scheduled arrival; ties go to fewer changes. Live variant (D8) uses departures from now and compares with the booked train's expected arrival.

### D8. Tracking loop and trip state
One asyncio task, every 120 s: for each trip whose window (departure minus 3 h to arrival plus 45 min) is open, fetch the trip by id, read expected arrival at the alighting stop, store a snapshot, derive the state.

`state = cancelled | cash50 (>=120) | cash25 (>=60) | unlocked (>=20) | on_time`

Alerts fire on the first crossing of 20, 60, 120 and on cancellation, recorded per trip so they never repeat. After arrival plus 45 min the trip is `finished` with its final delay. The same loop refreshes the late-now board every 5 min from station boards of about 12 hubs (Hamburg, Berlin, Hannover, Köln, Frankfurt, Mannheim, Stuttgart, München, Nürnberg, Leipzig, Dortmund, Karlsruhe) and auto-tracks the three most delayed trains each hour so that real recordings exist for replay.

### D9. Replay
`trip_snapshots` are the recording. A replay trip copies the snapshots of a recorded trip and plays them on a compressed clock (whole trip in about 60 s, first crossing inside 30 s). It runs through the same state and alert code with `is_replay = true` and the original date, which the UI and the push text must show. Until a real recording exists, the replay action is hidden; nothing is fabricated.

### D10. Push
Web Push with VAPID keys generated at deploy time and kept in the environment. The subscription is stored with the trip. iOS only delivers to a site installed on the home screen, so the live screen also polls every 20 s while open and shows the same alert in-app.

### D11. Signals
- Exa: one search per route corridor and date (origin city, destination city, date, German keywords for strike, closure, track works, storm), news and notice pages from the last 21 days, with a structured summary per result (kind, affected date range, one-line reason, relevant yes/no). Cached 6 h per corridor and date. The exact request shape is taken from Exa's current docs in task 5.1; if structured summaries are not available, kind is derived from keywords and the summary is Exa's own.
- Context.dev: a page monitor on a fixed list of union pages (GDL and EVG press pages) with a signed webhook to `/hooks/context`. Changes are stored and shown as a banner. Monitor creation is a one-off script; endpoint and signature scheme come from `docs.context.dev` in task 5.3.
- Signals are display only (see risk-signals spec). No DB-owned page is fetched.

### D12. API contract (JSON, times ISO 8601 UTC with the stop's timezone given once)
```
GET  /api/health                      -> {ok, version, sources:{transitous, exa, context}, plan_budget_left}
GET  /api/stations?q=                 -> [{id, name, lat, lon}]
GET  /api/picks?from=&to=&date=&time= -> {from, to, date, tz, picks:[Pick], note}
     Pick = {id, dep, arr, duration_min, changes,
             legs:[{train, from, to, dep, arr, trip_id}],
             odds:{p20, p60, late, n, weekday, basis:"history"|"estimate"|"none"} ,
             already_posted: bool, is_kurts_pick: bool,
             ride_instead:{dep, arr, changes, trains:[..], delta_arr_min}|null,
             bahn_url}
GET  /api/signals?from=&to=&date=     -> {status:"ok"|"empty"|"unavailable", checked_at, items:[{kind, reason, source, published, url}], banners:[{source, url, changed_at}]}
POST /api/trips  {pick, price_eur?, push?}   -> {trip_id, secret}
GET  /api/trips/{id}?secret=          -> Trip = {booked:Pick, price_eur, state, delay_min, expected_arr, updated_at, stale,
             thresholds:[{at:20|60|120, label, amount_eur|null, reached}],
             alternatives:[{dep, arr, changes, trains, catchable_min, delta_vs_expected_min}],
             is_replay, replay_of, finished, final_delay_min, switched}
PATCH  /api/trips/{id}  {price_eur?, switched?, push?}
DELETE /api/trips/{id}
GET  /api/trips/{id}/claim            -> {due, pct, amount_eur, reason, fields:[{label, value}], where}
GET  /api/late-now                    -> {checked_at, stale, checked, late:[{train, station, sched, expected, delay_min, headsign}]}
GET  /api/backtest                    -> contents of data/backtest.json
GET  /api/push/key                    -> {public_key}
POST /api/demo/replay                 -> {trip_id, secret}   (404 while no recording exists)
POST /hooks/context                   -> 204 | 401
```
Trips are addressed by id plus a random secret kept in the browser's local storage; that is the whole "account".

### D13. Frontend
Routes: `/` search, `/picks`, `/trips`, `/trip/:id`, `/trip/:id/claim`, `/late`, sheet `sources`, sheet `backtest`. Tokens: accent `#FD4F00`, accent text `#C93D00`, ink `#14161A`, muted `#5B616B`, line `#E4E4E0`, surface `#F5F5F3`, tint `#FFF1EA`, ok tint `#E9F5EC`. Type: Space Grotesk (headings), Inter (body), JetBrains Mono (numbers), self-hosted. Components carried over from the boards in `design/`: Kurt the snail (inline SVG), snail rating, flap tiles for delay numbers, threshold meter (+20, +60, +120), book-to-ride pair card, copy rows. The safe-mode boards (`SafePicks`, `SafeLive`, `SafeClaim`) are the visual reference; ticket sharing (`SafeShare`) is replaced by "I booked this". Motion is limited to flap-tile flips and the meter, and respects reduced-motion.

### D14. Hosting
One Verda CPU VM, Docker Compose with two services: `app` (backend serving the built frontend, volume for the SQLite files) and `caddy` (TLS). Address `https://<ip>.sslip.io` unless a subdomain is provided. Secrets in `/opt/spaetkauf/.env` on the VM. Deploy is `git pull && docker compose up -d --build`. The VM is deleted after 22 Nov.

## Risks / Trade-offs

- [Train or stop match rate too low] → probe first (task 2.3); fallback by coordinates; connections without a match show "not enough history" and never a guessed number.
- [Transitous slow, down or rate-limited at the venue] → caching, budget, stale labels; replay and the recorded video do not depend on it.
- [Live data missing for some trains] → stale state after 10 min; late-now board says how many trains it could check.
- [Base rates are weak predictors] → the backtest is shown in the app with its real numbers, whatever they are; the pitch claims base rates, not forecasts.
- [iOS push only after home-screen install] → in-app alert while the screen is open; install the demo phone beforehand.
- [Exa and Context.dev briefs not yet read] → signals are isolated behind `/api/signals` and one webhook so they can be reshaped without touching the rest.
- [DB's automatic delay forecasts may not lift the binding] → the app says "expected delay per live data" and tells the traveller to check the DB app before boarding another train.
- [Timetable change on 13 Dec 2026 renumbers trains] → out of scope for the event; noted in the sources sheet.

## Open Questions

- Exact Exa request shape and Context.dev monitor API: resolved inside tasks 5.1 and 5.3 from their docs; they do not change the contract above.
- Subdomain instead of sslip.io: cosmetic, can change after deploy.
