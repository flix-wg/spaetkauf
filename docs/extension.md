# Browser extension

The extension in `extension/` adds Kurt's odds to a bahn.de results page you already have open. Each long-distance connection gets a badge, and one gets Kurt's mark: the highest odds of at least 30 % that has a backup on the same page leaving within 2 hours and arriving at most 20 minutes later. That is the rule the app uses. A card that already shows a delay or cancellation keeps its odds, loses the mark and says the posted delay won't count.

Optionally (settings, off by default), each badge also shows how often the trip reaches your stop on time, meaning under 5 minutes late, from the same train files. See `docs/on-time.md`.

The extension only reads the page. It never clicks, fills in or loads anything on bahn.de.

## Install

Run `npm ci && npm run build` in `extension/` (this bundles the app's odds code from `frontend/src/core/` into `extension/dist/odds.js`). Then open `chrome://extensions`, turn on Developer mode, choose Load unpacked and select `extension/`. The default site is `https://kurtfaehrt.de`. In the settings, you can change the Kurt site that serves `/data/odds/` (HTTPS, or HTTP on localhost).

## How it works

The service worker computes the odds with the same code as the app. It fetches `/data/odds/index.json` and one file per train from the Kurt site, and looks the route up on Transitous (`api.transitous.org`) to count a missed change, at most 60 `/plan` calls a day. A session `declarativeNetRequest` rule sets `User-Agent: kurt-extension/<version> (+https://github.com/flix-wg/spaetkauf)` on those Transitous requests, since extension requests carry no Referer. Odds are cached for ten minutes. A missing train file means no odds on that card; an unreachable site shows an error and the page retries.

## What it sends

The extension computes odds from Kurt files. The Kurt site receives file requests with IP addresses and technical data. Transitous receives start, destination, date, departure time, IP address and a technical extension identifier. Page structure, prices and account data are not sent. Chrome stores settings; Google syncs them if sync is on. Search counters and status data stay local. The website uses Cloudflare Web Analytics for aggregated usage and loading metrics. Nothing goes to bahn.de beyond the page you loaded.

## Tests

From `extension/`: `npm test` (builds the bundle; golden cases in `test/golden.json` come from `scripts/export_golden.py`). `npm run e2e` needs Playwright with Chromium and serves the fixtures and static odds locally, with bahn.de and Transitous blocked.

## Limits

The static version has not been tried on live bahn.de yet. The pick only sees backups shown on the page, so it can miss one the app would find. A bahn.de layout change can break the built-in parser. When Transitous fails, takes over 4 seconds or the start station is unknown, only the last train's history counts.
