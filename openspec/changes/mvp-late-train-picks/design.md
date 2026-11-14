# Design

## Context

See proposal.md for motivation. Constraints that shape the design:

- About 33 build hours, one human, agent-built. Final submission 15 Nov 10:00 Helsinki; scope freeze 14 Nov 20:00.
- Judges and peers try the demo live on their own phones and may type any route. The demo must stay reachable until about 22 Nov.
- bahn.de's terms forbid automated extraction and access outside its user interface. The server and the app therefore never contact bahn.de and only link there; the extension (D15) only reads the page the traveller loaded and never acts on it.
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

### D1. Own installable web app as the core, extension as an add-on
A site is one link for judges and works on any phone; on iPhone an extension would need an App Store app. The app works on its own. The Chrome extension (D15) adds our odds to a bahn.de results page the traveller already has open on a desktop; it reads that page and adds badges, nothing more. Alternatives rejected: a native app; an extension as the only product.

### D2. Layout and stack
```
backend/    FastAPI app (Python 3.12, uv), SQLite, read-only DuckDB run history, one asyncio background loop
frontend/   Vite + React + TypeScript + Tailwind, vite-plugin-pwa, fonts via @fontsource
extension/  Chrome MV3 extension, plain JavaScript without a build step; node:test and a Playwright run on fixtures
scripts/    build_odds.py, backtest.py, build_history.py, build_replays.py (DuckDB)
data/       odds.sqlite (committed if under 25 MB), backtest.json, replays.json; history.duckdb (not in git)
deploy/     Dockerfile (node build stage, python runtime), docker-compose.yml, Caddyfile, ship.sh, upload_history.sh
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
- Every share below is shrunk: `p = (k + m·p_parent) / (n + m)` with `p_parent` the same train and stop on all weekdays, itself shrunk toward the train type's overall rate, m = 50 (chosen on the training period; the backtest showed lower Brier and better calibration at both ends than plain `k / n`, see `docs/backtest.md`). The counts shown (`late` = `ge20`, `n`) stay raw.
- Direct: `p20` from `ge20` and `n` at the alighting stop, for the weekday of the scheduled arrival in Berlin time; `p60` likewise from `ge60`. Shown with `ge20` and `n`.
- With changes: `p20 = 1 - (1 - p_miss_1)...(1 - p_last20)`, where `p_miss_i` is the share of runs of leg i that arrived at the change stop later than the scheduled change time minus 2 minutes (taken from the nearest `ge*` bucket at or below it; ge5 when that is under 5 minutes) and `p_last20` is the last leg's share. `p60` is the last leg's share only, since a missed change rarely costs an hour. Labelled as an estimate. Independence between legs is an assumption and is stated in the backtest note.
- Fewer than 10 runs on that weekday for any needed leg, or a leg without a train number: no odds.

### D7. Ride-instead
From the connections fetched for the same search (up to 3 `/plan` pages): connections other than the booked one, sharing no trip with it and not yet departed, leaving at or up to 120 min after it and arriving no later than the booked arrival plus 20 min, excluding legs on reservation-only trains (per DB's FAQ: TGV/ICE to France, trains to Poland, to Milan via Basel; detected by train type TGV, ICE 9550-9599, or a foreign stop in that list). Choose the earliest scheduled arrival; ties go to fewer changes. An earlier train counts only when the traveller opts in (`before`, at most 60 min, depart mode only) and no later one fits, because it helps only if the delay is posted before it leaves; the card says so, and the first `/plan` page then starts `before` minutes earlier. Live variant (D8) uses departures from now and compares with the booked train's expected arrival.

Kurt's pick is the pick with the highest `p20` among those with odds, not already posted, with a ride-instead and `p20 >= 0.30` (`KURT_MIN_P20`); ties keep the ranking order. When none qualifies, no pick is marked and the screen shows the plain list.

### D8. Tracking loop and trip state
One asyncio task, every 120 s: for each trip whose window (departure minus 3 h to arrival plus 45 min) is open, fetch the trip by id, read expected arrival at the alighting stop, store a snapshot, derive the state.

`state = cancelled | cash50 (>=120) | cash25 (>=60) | unlocked (>=20) | on_time`

Alerts fire on the first crossing of 20, 60, 120 and on cancellation, recorded per trip so they never repeat. After arrival plus 45 min the trip is `finished` with its final delay. The same loop refreshes the late-now board every 5 min from station boards of about 12 hubs (Hamburg, Berlin, Hannover, Köln, Frankfurt, Mannheim, Stuttgart, München, Nürnberg, Leipzig, Dortmund, Karlsruhe) and auto-tracks the three most delayed trains each hour so that real recordings exist for replay. It also auto-tracks up to two trains an hour that are 8 to 19 minutes late with an hour or more to their terminus, since they are likely to cross +20. At most 12 auto-tracked trips are open at once.

### D9. Replay
Two real sources: `live` recordings (the `trip_snapshots` of auto-tracked trains; the delay is the forecast for the alighting stop) and `history` runs in `data/replays.json`, built by `scripts/build_replays.py` from the delay dataset with one frame per stop the train reached (the delay is measured at that stop; credit "Delay history: piebro/deutsche-bahn-data (CC BY 4.0)"). A replay trip plays one recording on a compressed clock (whole run in about 60 s, first crossing inside about 25 s) through the same state and alert code with `is_replay = true` and the original date, which the UI and the push text must show. Nothing is interpolated or padded. My trips lists the recordings (`GET /api/demo/recordings`) and starts the one the presenter picks. Shapes and the run list: `docs/replays.md`.

### D10. Push
Web Push with VAPID keys generated at deploy time and kept in the environment. The subscription is stored with the trip. iOS only delivers to a site installed on the home screen, so the live screen also polls every 20 s while open and shows the same alert in-app.

### D11. Signals
- Exa: one search per route corridor and date (origin city, destination city, date, German keywords for strike, closure, track works, storm), news and notice pages from the last 21 days, with a structured summary per result (kind, affected date range, one-line reason, relevant yes/no). Cached 6 h per corridor and date. The exact request shape is taken from Exa's current docs in task 5.1; if structured summaries are not available, kind is derived from keywords and the summary is Exa's own.
- Context.dev: page monitors on the GDL and EVG press pages and a strike-news search, with a signed webhook to `/hooks/context`. Changes are stored and shown as banners. Monitor creation is a one-off script; endpoint and signature scheme come from `docs.context.dev` in task 5.3.
- Strike call: a stored change from the last 14 days whose title or summary announces a strike (keyword match, negations like "kein Streik" excluded) has its dates read by a small regex parser (German and English day-month forms and ranges; no LLM). If the dates cover the travel date, `kurt_call` is `strike`: no train is Kurt's pick, because past-run odds do not cover strike days, and the latest earlier day without an announced strike is offered as `try_date`. A strike with unknown dates keeps Kurt's pick and attaches the warning (`strike_unclear`). The odds list never changes. Watched trips on a struck day get a once-only push. Wording never states DB policy: "a strike is announced for this day; past-run odds do not cover strike days".
- Test changes (title "TEST:", sent by `scripts/send_test_change.py`, signed like Context.dev) are stored with `test = 1`, marked `test: true` in every output and removed by a signed clear event.
- Exa items and banners are display only (see risk-signals spec). No DB-owned page is fetched.

### D12. API contract (JSON, times ISO 8601 UTC with the stop's timezone given once)
```
GET  /api/health                      -> {ok, version, sources:{transitous, exa, adapter, context}, plan_budget_left}
GET  /api/stations?q=                 -> [{id, name, lat, lon}]
GET  /api/picks?from=&to=&date=&time=[&before=0..60] -> {from, to, date, tz, picks:[Pick], note, kurt_call:"pick"|"none"|"strike"|"strike_unclear", strike:Strike|null}
     Strike = {title, url, source, changed_at, dates:[iso date]|null, covers_date, test, try_date|null, note}
     Pick = {id, dep, arr, duration_min, changes,
             legs:[{train, from, to, dep, arr, trip_id}],
             odds:{p20, p60, late, n, weekday, basis:"history"|"estimate"|"none"} ,
             already_posted: bool, is_kurts_pick: bool,
             ride_instead:{dep, arr, changes, trains:[..], delta_arr_min}|null,
             bahn_url}
GET  /api/picks?...&mode=arrive&time=T -> as above plus {mode:"arrive", arrive_by}; Pick plus
             {spare_min, p_miss|null, late_ok:{unlock, refund25, refund50}, group:"late_ok"|"on_time"}
GET  /api/signals?from=&to=&date=     -> {status:"ok"|"empty"|"unavailable", checked_at, items:[{kind, reason, source, published, url}], banners:[{source, url, changed_at, title, test, is_strike, dates, covers_date}], strike:Strike|null}
POST /api/trips  {pick, price_eur?, push?}   -> {trip_id, secret}
GET  /api/trips/{id}?secret=          -> Trip = {booked:Pick, price_eur, state, delay_min, expected_arr, updated_at, stale,
             thresholds:[{at:20|60|120, label, amount_eur|null, reached}],
             alternatives:[{dep, arr, changes, trains, catchable_min, delta_vs_expected_min}],
             stay:{amount_at_60_eur, amount_at_120_eur},
             is_replay, replay_of, finished, final_delay_min, switched}
PATCH  /api/trips/{id}  {price_eur?, switched?, push?}
DELETE /api/trips/{id}
GET  /api/trips/{id}/claim            -> {due, pct, amount_eur, reason, fields:[{label, value}], where}
GET  /api/late-now                    -> {checked_at, stale, checked, late:[{train, station, sched, expected, delay_min, headsign}]}
GET  /api/backtest                    -> contents of data/backtest.json
GET  /api/push/key                    -> {public_key}
GET  /api/demo/recordings             -> [Recording]   (live recordings and history runs, docs/replays.md)
POST /api/demo/replay  {recording?, price_eur?, push?} -> {trip_id, secret, recording}   (404 while no recording exists)
GET  /api/history?train=&stop=[&weekday=]      -> {train, stop, weekday, runs:[{date, planned, delay_min, cancelled}], summary, source}
GET  /api/history/train?train=[&weekday=]      -> the train's stops with run counts and late20 share
GET  /api/history/stop?stop=&date=             -> past arrivals board, at most 1000 rows
GET  /api/history/route?from=&to=[&weekday=]   -> trains that ran from -> to on one run, at most 100
POST /api/ext/odds  {from?, to, to_eva?, date, connections:[{dep, arr, trains, date?}] (at most 30)}
                                      -> {to, date, kurt, link, results:[{i, p20, p60, n, late, weekday, basis:"history"|"last_train"|"none", train, kurt}]}
POST /api/ext/adapt {skeleton, hash}  -> {spec:{card, train, dep, arr}, cached} | 409 | 422 | 429 | 502 | 503
POST /hooks/context                   -> 204 | 400 | 401   (change.detected, or spaetkauf.test.clear)
```
`mode=arrive` (time required, else 400) lists connections scheduled to arrive in the 3 h before T, paging Transitous backward (at most 3 plan calls). `spare_min` is T minus the scheduled arrival; `late_ok` says which delay outcomes (20 min unlock, 60 and 120 min refunds) still arrive by T; `group` is `late_ok` from 20 min spare, else `on_time`. `p_miss` is an upper bound on arriving after T: the last leg's share at the largest delay bucket at or below the spare time, every missed change counted as a miss, 1.0 under 5 min spare, null without history. Kurt's pick is the highest p20 among `late_ok` picks with p_miss ≤ 0.10 and p20 ≥ 0.30; no ride-instead is needed. Order: `late_ok` within the cap by p20, the other `late_ok`, then `on_time` by arrival, latest first. Depart mode and its response are unchanged. `before` (depart mode only, clamped to 0-60) lets ride-instead use an earlier train, see D7. History routes answer 404 with a hint for an unknown train, stop or date and 503 when the history file is missing (D18).

Trips are addressed by id plus a random secret kept in the browser's local storage; that is the whole "account". Every trip route, including PATCH, DELETE and /claim, needs the secret as ?secret= or an X-Trip-Secret header; a wrong secret and an unknown id both return 404.

### D13. Frontend
Routes: `/` search, `/picks`, `/trips`, `/trip/:id`, `/trip/:id/claim`, `/late`, `/lookup`, sheet `sources`, sheet `backtest`, sheet with the runs behind an odds line. Navigation has four tabs: Picks, My trips, Late now, Lookup (desktop layout: D19). Tokens: accent `#FD4F00`, accent text `#C93D00`, ink `#14161A`, muted `#5B616B`, line `#E4E4E0`, surface `#F5F5F3`, tint `#FFF1EA`, ok tint `#E9F5EC`. Type: Space Grotesk (headings), Inter (body), JetBrains Mono (numbers), self-hosted. Components carried over from the boards in `design/`: Kurt the snail (inline SVG), snail rating, flap tiles for delay numbers, threshold meter (+20, +60, +120), book-to-ride pair card, copy rows. The safe-mode boards (`SafePicks`, `SafeLive`, `SafeClaim`) are the visual reference; ticket sharing (`SafeShare`) is replaced by "I booked this". Motion is limited to flap-tile flips and the meter, and respects reduced-motion.

### D14. Hosting
One Verda CPU VM, Docker Compose with two services: `app` (backend serving the built frontend, volume for the SQLite files, `/opt/spaetkauf/history` mounted read-only for the run history) and `caddy` (TLS). Address `https://<ip>.sslip.io` unless a subdomain is provided. Secrets in `/opt/spaetkauf/.env` on the VM. Deploy is `git pull && docker compose up -d --build`. The VM is deleted after 22 Nov.

### D15. Extension boundary
The extension runs content scripts on `www.bahn.de` and `int.bahn.de` and works only with the page the traveller has loaded.
- Reads: from the URL, origin and destination names (`so`, `zo`, or a "Nach:"/"To:" label on the page), the destination's station number (`zoei` or `zoid`) and the date (`hd`); date headings in the list; from each connection card, times, duration, train names, and whether the card shows a delay or cancellation.
- Sends: to the configured Spätkauf server only, through the service worker, without cookies and without following redirects: origin and destination names, destination station number, date, and per long-distance card its times and train names (at most 30). The adapter (D17) sends a text-free skeleton. A server address on a bahn.de, db.de, bahn.com or deutschebahn.com host is refused.
- Writes: one badge per card in a closed shadow root. Clicks and key presses on a badge do not reach the page. Only Kurt's badge has a link, to the same search in the Spätkauf app.
- Never: clicks, fills, submits or navigates anything on bahn.de; fetches from bahn.de or another DB host; sends prices, cookies or other page text; tracks the traveller.
Our server never contacts bahn.de or a DB host for the extension either: `/api/ext/odds` answers from the odds table alone.

### D16. Extension odds are simpler than the app's
The card gives times and train names but no trip ids, so the server cannot run D6 or D7. `/api/ext/odds` uses only the last train's shrunk share at the destination (by station number when given, else by name) for the weekday of the scheduled arrival; a regional last train or thin history gives no odds. With changes the badge says "last train" and missed changes are not counted. Kurt's pick is the highest p20 ≥ 0.30, without a ride-instead. The posted check is done in the extension from the card's text (German and English delay and cancellation words; seat and occupancy notices ignored): such a card reads "Delay already posted: won't count", keeps its odds, and loses Kurt's mark; no other card takes it over. Alternative rejected: a second routing call per page to get trip ids, which costs plan budget for every page view.

### D17. Selector adapter
bahn.de's markup can change. When the heuristic parser finds no card on a page that looks like results (at least 4 times and a train name), the extension builds a skeleton: from the smallest element holding all times, one line per element with tag, class names, data- and aria- attribute names, role values, and the kind of its own text (TIME, TRAIN, PRICE, DUR, TEXT), never the text. Class and attribute names with three digits in a row or a word from the searched station names are dropped; repeated siblings are cut after three; at most 2000 lines and 100,000 characters. The server checks every line against that grammar and the SHA-256 hash, then asks `claude-haiku-5-5` for CSS selectors (card, train, dep, arr) in a fixed JSON schema and validates them. Results are kept per layout hash: success for good, failure until the next Berlin day; at most 50 model calls a day (`SPAETKAUF_ADAPT_DAILY_CAP`); without `ANTHROPIC_API_KEY` it answers 503 and the extension stays on heuristics. The extension keeps the last 20 good selector sets. Alternative rejected: sending page HTML or text to the model.

### D18. Run history in DuckDB
`scripts/build_history.py` writes every long-distance event behind the odds (same filter and delay definition) to `data/history.duckdb`, sorted by train, stop and day, with a run id per trip. The app opens it read-only once at startup and uses a cursor per request. It stays out of git and the image (65 MB) and is uploaded to the VM separately; when it is missing, history routes answer 503 and everything else works. Details and timings: `docs/history.md`.

### D19. Desktop layout instead of a phone frame
Below 1024 px the app is one column, at most 480 px wide, with the bottom tabs. From 1024 px (Tailwind `lg:`) the tabs become a side bar with the logo, the four entries and a QR code of the site address, and screens with two parts use two columns (form or Kurt's pick on the left, lists on the right). A phone frame wasted most of a laptop or projector screen.

## Risks / Trade-offs

- [Train or stop match rate too low] → probe first (task 2.3); fallback by coordinates; connections without a match show "not enough history" and never a guessed number.
- [Transitous slow, down or rate-limited at the venue] → caching, budget, stale labels; replay and the recorded video do not depend on it.
- [Live data missing for some trains] → stale state after 10 min; late-now board says how many trains it could check.
- [Base rates are weak predictors] → the backtest is shown in the app with its real numbers, whatever they are; the pitch claims base rates, not forecasts.
- [iOS push only after home-screen install] → in-app alert while the screen is open; install the demo phone beforehand.
- [Exa and Context.dev briefs not yet read] → signals are isolated behind `/api/signals` and one webhook so they can be reshaped without touching the rest.
- [DB's automatic delay forecasts may not lift the binding] → the app says "expected delay per live data" and tells the traveller to check the DB app before boarding another train.
- [Timetable change on 13 Dec 2026 renumbers trains] → out of scope for the event; noted in the sources sheet.
- [bahn.de changes its result markup] → heuristic parser plus the adapter (D17); the extension was tested on fixtures and one saved real page, not against live bahn.de.

## Open Questions

- Exact Exa request shape and Context.dev monitor API: resolved inside tasks 5.1 and 5.3 from their docs; they do not change the contract above.
- Subdomain instead of sslip.io: cosmetic, can change after deploy.
