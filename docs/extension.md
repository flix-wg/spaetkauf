# Spätkauf for bahn.de

Shows historical late-arrival odds beside long-distance connections and marks Kurt’s pick. It reads results already loaded by the traveller; it does not book or navigate.

Install: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/`. In the extension’s settings, set the Spätkauf server URL (HTTPS, or HTTP on localhost). Custom HTTPS servers ask for access on save. The popup toggles overlays and shows server health, adapter availability, parser path, counts, last check, layout hash and three parsed connections.

Privacy: odds requests send origin/destination names and destination EVA, date, times and train names to the configured Spätkauf server only. When the heuristic fails, the adapter sends a structure-only skeleton of tags, classes, attribute names and content tokens: no text, prices or station names. Nothing is sent to bahn.de beyond the page the user loads. No tracking.

The server uses `claude-haiku-5-5` to suggest selectors when heuristics fail: one call per layout hash per day, at most 50 calls/day by default (`SPAETKAUF_ADAPT_DAILY_CAP`). Set `ANTHROPIC_API_KEY` on the server to enable it. A 503 means heuristics only. Successful selectors are kept locally (20 layouts); unavailable layouts are remembered for 24 hours. Odds are cached for ten minutes in the service worker.

Tests from `extension/`: `node --test`; for the local browser integration run `SPK_SERVER=http://127.0.0.1:8000 node test/e2e.mjs`. Playwright and its Chromium channel must already be installed. Optional `SPK_SHOTS` sets the screenshot directory (default `~/tmp/spk-shots-real`). The integration test checks local fixtures and service-worker requests without backend CORS middleware; it blocks bahn.de network access.

Limits: the extension has never been tested against live bahn.de beyond one saved page. Layout changes can defeat both heuristics and suggested selectors. Odds describe past runs, not a prediction; connections with changes use only the last train’s history and do not count missed changes.
