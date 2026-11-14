# Signals

Context for a route and date. Signals never change the odds. A Context.dev change that announces
a strike for the travel date changes Kurt's call (see "Strike call" below).

## What is queried

- `GET /api/signals?from=&to=&date=` runs one Exa search per corridor and date: German keywords
  (Streik, Warnstreik, Streckensperrung, Bauarbeiten, Sturm) plus the two city names, news only,
  published in the last 21 days, 8 results, each with a structured English summary
  (`kind`, `relevant`, `affects_long_distance_on_route`, `date_from`, `date_to`, `reason`). The
  `affects_long_distance_on_route` question names both cities and the date. Station names lose
  "Hbf" and similar.
- Answers are cached 6 h in SQLite, keyed by `CACHE_VERSION`, normalised from, to and date.
  Failures are not cached. Bump `CACHE_VERSION` when the request or filter changes.
- Context.dev watches three sources: the GDL press archive, the EVG press page and a web search for
  "Bahn Streik OR Warnstreik GDL OR EVG". Changes arrive at `POST /hooks/context` and show as
  banners (last 7 days, newest first, at most 3) with `title`, `test`, `is_strike`, `dates` and
  `covers_date`.

## Strike call

- `GET /api/picks` and `GET /api/signals` read the Context.dev changes of the last 14 days. A change
  counts as a strike announcement when its title or summary contains Streik, Warnstreik, strike,
  Arbeitskampf or walkout, not right after a negation ("kein neuer Streik", "no strike").
- Dates come from a regex parser in `app/signals.py`: "16. November", "16.11.", "16.11.2026",
  "16. bis 18. November", "16.–18.11.", "Montag, 16. November", "16 November", "November 16",
  "from 16 to 18 November", "16.11. bis 18.11.". A missing year is the year of the change (the next
  one when that date is over 60 days past). Dates before the day the change was seen are dropped.
  No date found means `dates: null`.
- One `strike` object is chosen: dates cover the travel date first, then unknown dates, then a strike
  on other days still ahead; newest first. Past strikes give `strike: null`.
- `kurt_call`: `strike` when the dates cover the travel date (no train is Kurt's pick; `try_date` is
  the latest earlier day without an announced strike, null if that is in the past), `none` when no
  pick qualifies, `strike_unclear` when a strike has unknown dates (Kurt's pick kept), else `pick`.
  The picks and their odds are the same in every case.
- `strike.note` is the backend's text. It never states DB policy, only that a strike is announced
  for this day and that past-run odds do not cover strike days.
- A newly stored strike change with dates sends each watched trip (not replays, not auto-tracked)
  on a struck day one push: "Strike announced for your travel day: <title>". The once-only kind is
  `strike` (`strike-test` for test changes).

## Test changes

- `uv run python scripts/send_test_change.py <base_url> [--date YYYY-MM-DD]` posts a GDL-style
  sample change titled "TEST:" for the date (default tomorrow, Berlin), signed with the first
  secret of `CONTEXT_WEBHOOK_SECRET` from the repo `.env`. The server stores it with `test = 1`
  (also any change titled "TEST:") and every output shows `test: true`.
- `--clear` posts a signed `spaetkauf.test.clear` event that deletes all test changes and their
  `strike-test` trip alerts. Without a valid signature it is a 401 like any other event.

## What is filtered

- Only results with `relevant: true`, at most 5, `source` is the hostname. Results with
  `affects_long_distance_on_route: false` are dropped; a missing or unreadable value keeps the
  result. Reasons that say there is no impact, "not long-distance", "nicht im Fernverkehr" or
  "affects only S-Bahn/regional trains" (with no long-distance train later in the sentence) are
  dropped, also from the cache. An empty answer with a malformed summary is not cached.
- In the app, results whose reason names long-distance trains (long-distance, Fernverkehr, ICE,
  intercity, high-speed) and do not say they are unaffected add a warning to Kurt’s pick: past runs
  may not include this, so the chance may not hold. The pick and its odds stay the same.
- Results whose date range ends before the travel date or starts after it are dropped.
  A result without an end date counts as one day unless its kind is strike.
- Hosts bahn.de, deutschebahn.com, dbregio.de, db.de, bahnhof.de, inside-bahn.de (and subdomains)
  are sent to Exa as `excludeDomains` and dropped again locally. Webhook changes on these hosts are
  not stored. No DB host is ever fetched.
- No key, timeout, HTTP error or bad body gives `status: "unavailable"` with HTTP 200.
  An Exa error response or a failed connection gives the day's budget unit back.
  No relevant result gives `"empty"` ("No route news found in the last 3 weeks.").

## Webhook

- Signature: `X-Context-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 over `t.` plus the raw body,
  keyed with the full secret string, within 300 s. Verified before the JSON is parsed.
  Missing, malformed, stale or wrong signatures and an unset secret give 401.
- Context.dev generates a separate secret per monitor, so `CONTEXT_WEBHOOK_SECRET` holds all of
  them, comma separated. `backend/scripts/create_monitor.py` writes it into `.env`; it is
  idempotent and `--dry-run` prints the request bodies only.
- Deduplicated on `X-Context-Id`. Only `change.detected` is stored.
- Real payload text is not verified yet: the parser reads `data.change.title` and
  `data.change.summary`, the fields the handler already stored.

## Cost

- Exa: about $0.015 per uncached call (search $0.007 plus summaries $0.008). With the 6 h cache a
  corridor and date costs at most four calls a day.
- Context.dev: a page run costs 1 credit, a search run 2. The two page monitors run every 2 hours
  and the search monitor every 6 hours: about 24 + 8 = 32 credits a day. The account had about
  49,700 credits left on 2026-11-14, so this is not the limit the free plan’s 1,000 a month suggests.

## Terms notes

- Exa and Context.dev are called with their API keys from the server only; keys stay in `.env`.
- Requests carry the client name from `SPAETKAUF_CLIENT_NAME` and no personal data.
- Articles are shown as a one-line summary with source name, date and link, never full text.
- Monitored pages are public union press pages, checked politely every 2 hours.
- Exa searches are capped per UTC day (`SPAETKAUF_EXA_BUDGET`, default 150); once spent, uncached routes answer `capped` ("News check paused for today.").
