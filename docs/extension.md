# Browser extension

The extension in `extension/` adds Kurt's odds to a bahn.de results page you already have open. Each long-distance connection gets a badge, and one gets Kurt's mark: the highest odds of at least 30 % that has a backup on the same page leaving within 2 hours and arriving at most 20 minutes later. That is the rule the app uses. A card that already shows a delay or cancellation keeps its odds, loses the mark and says the posted delay won't count.

The extension only reads the page. It never clicks, fills in or loads anything on bahn.de.

## Install

Open `chrome://extensions`, turn on Developer mode, choose Load unpacked and select `extension/`. Set your Kurt server in the extension's settings (HTTPS, or HTTP on localhost).

## What it sends

Odds requests go to your Kurt server only and contain station names, the destination EVA, date, times and train names. If bahn.de changes its layout and the built-in parser fails, the extension can send the server an outline of the page: tag and class names with no text, prices or station names. With `ANTHROPIC_API_KEY` set, the server asks a model for new selectors (at most 50 calls a day, `SPAETKAUF_ADAPT_DAILY_CAP`). Without the key it sticks to the built-in parser.

## Tests

From `extension/`: `node --test`. The browser test, `SPK_SERVER=http://127.0.0.1:8000 node test/e2e.mjs`, needs Playwright with Chromium installed and runs against local fixtures with bahn.de blocked.

## Limits

The pick only sees backups shown on the page, so it can miss one the app would find. A bigger layout change can break both the parser and the suggested selectors.
