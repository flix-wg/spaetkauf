# Signals

Display-only context for a route and date. Signals never change the odds.

## What is queried

- `GET /api/signals?from=&to=&date=` runs one Exa search per corridor and date: German keywords
  (Streik, Warnstreik, Streckensperrung, Bauarbeiten, Sturm) plus the two city names, news only,
  published in the last 21 days, 8 results, each with a structured English summary
  (`kind`, `relevant`, `date_from`, `date_to`, `reason`). Station names lose "Hbf" and similar.
- Answers are cached 6 h in SQLite, keyed by normalised from, to and date. Failures are not cached.
- Context.dev watches three sources: the GDL press archive, the EVG press page and a web search for
  "Bahn Streik OR Warnstreik GDL OR EVG". Changes arrive at `POST /hooks/context` and show as
  banners (last 7 days, newest first, at most 3).

## What is filtered

- Only results with `relevant: true`, at most 5, `source` is the hostname.
- Results whose date range ends before the travel date or starts after it are dropped.
  A result without an end date counts as one day unless its kind is strike.
- Hosts bahn.de, deutschebahn.com, dbregio.de, db.de, bahnhof.de, inside-bahn.de (and subdomains)
  are sent to Exa as `excludeDomains` and dropped again locally. Webhook changes on these hosts are
  not stored. No DB host is ever fetched.
- No key, timeout, HTTP error or bad body gives `status: "unavailable"` with HTTP 200.
  No relevant result gives `"empty"`.

## Webhook

- Signature: `X-Context-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 over `t.` plus the raw body,
  keyed with the full secret string, within 300 s. Verified before the JSON is parsed.
  Missing, malformed, stale or wrong signatures and an unset secret give 401.
- Context.dev generates a separate secret per monitor, so `CONTEXT_WEBHOOK_SECRET` holds all of
  them, comma separated. `backend/scripts/create_monitor.py` writes it into `.env`; it is
  idempotent and `--dry-run` prints the request bodies only.
- Deduplicated on `X-Context-Id`. Only `change.detected` is stored.

## Cost

- Exa: about $0.015 per uncached call (search $0.007 plus summaries $0.008). With the 6 h cache a
  corridor and date costs at most four calls a day.
- Context.dev free plan: 1,000 credits a month. A page run costs 1, a search run 2. The two page
  monitors run every 2 hours and the search monitor every 6 hours: about 24 + 8 = 32 credits a day,
  roughly 960 a month, which is close to the limit. Pause the search monitor if credits run short.

## Terms notes

- Exa and Context.dev are called with their API keys from the server only; keys stay in `.env`.
- Requests carry the client name from `SPAETKAUF_CLIENT_NAME` and no personal data.
- Articles are shown as a one-line summary with source name, date and link, never full text.
- Monitored pages are public union press pages, checked politely every 2 hours.
- Exa searches are capped per UTC day (`SPAETKAUF_EXA_BUDGET`, default 150); once spent, uncached routes answer `unavailable`.
