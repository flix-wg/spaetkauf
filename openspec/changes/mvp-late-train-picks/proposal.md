# Proposal

## Why

A Deutsche Bahn saver ticket (Sparpreis) is bound to one train, but the binding is lifted as soon as that train is expected to reach the destination 20 or more minutes late; at 60 and 120 minutes money comes back on top. DB long-distance punctuality was 60.1 % in 2025, so on many trains this happens often. Nobody tells a traveller, before buying, which train is likely to be late and which better train they could ride instead. A delay that is already known when buying does not count, so the choice has to be made from history, in advance.

Spätkauf is built at Junction 2026 (hacking window 13 Nov 19:30 to 15 Nov 10:00, Helsinki time) for the Exa challenge with the Context.dev tech challenge.

## What Changes

- New mobile web app (installable, no native app) with a snail mascot, Kurt, and these screens: search, picks, my trips, live trip, claim, late right now, lookup.
- Picks: for a route and date, rank real connections by how often the booked train arrived 20+ minutes late on that weekday, and pair each with the train the traveller would ride instead once the binding is lifted.
- Arrive-by search: for a latest arrival time, list the connections that still arrive in time even 20+ minutes late, with the spare time and how often they would have been too late.
- Live trip: the traveller marks a pick as booked; the app watches it and tells them when the ticket is unlocked (+20), when cash comes back (+60, +120), and whether to switch or stay.
- Late right now: a board of long-distance trains that are 20+ minutes late at this moment.
- Claim helper: the compensation amount and a text to paste into DB's own form.
- Risk signals: cited reasons from the public web for a route and date (strikes, track works, storms), and a watch on strike announcement pages. When an announced strike covers the travel day, Kurt makes no pick for it.
- Lookup: the past runs behind every percentage, and a lookup of past runs by train or by route.
- Demo support: a clearly labelled replay of a recorded real trip, and a desktop layout with side navigation and a QR code.
- Browser extension for desktop Chrome: on a bahn.de results page the traveller has open, it shows our odds beside each long-distance connection and marks Kurt's pick.
- The server and the app never send a request to bahn.de; they only link to it. The extension reads the bahn.de page the traveller loaded and adds badges to it; it never clicks, fills or fetches anything there. The traveller buys and claims themselves.

Out of scope: buying or claiming on the traveller's behalf, automating bahn.de in any way, prices, accounts, ticket PDF import, scoreboard, any forecast beyond historical base rates, an extension for other browsers or for phones.

## Capabilities

### New Capabilities
- `late-train-picks`: route search, by departure or by latest arrival, that returns connections ranked by late odds, each with the train to ride instead and a link to bahn.de.
- `delay-odds`: historical base rates of late arrival per train, stop and weekday, with a backtest that states how good they are, the past runs behind each rate, and a lookup by train or route.
- `trip-tracking`: watching a booked trip, threshold states, switch-or-stay alternatives, push alerts and labelled replay.
- `late-now-board`: the live list of long-distance trains currently 20+ minutes late.
- `risk-signals`: cited web evidence for a route and date and a monitor on strike announcement pages.
- `claim-helper`: compensation amount and paste-ready claim text for a finished trip.
- `web-app-shell`: the installable mobile app, four-tab navigation, desktop layout with QR code, and visual identity.
- `source-boundaries`: which data sources the system uses and how, including what the server, the app and the extension never do with bahn.de.
- `bahn-extension`: badges with odds and Kurt's pick on a bahn.de results page the traveller has open, and the optional selector adapter.

### Modified Capabilities

None.

## Impact

- New repository: Python backend, React frontend, Chrome MV3 extension, build scripts for the odds table, the run history and the replays, Docker Compose deployment.
- External services: Transitous (routing and live delays, non-commercial open-source use), Exa (search), Context.dev (page monitor), Hugging Face dataset `piebro/deutsche-bahn-data` (CC BY 4.0), Anthropic API (optional, a small model for the extension's selector adapter).
- Data: `data/history.duckdb` (65 MB) holds the runs behind the odds; it is not in git or the image and is copied to the VM separately.
- Extension: installed by loading `extension/` unpacked in Chrome; it talks only to the configured Spätkauf server.
- Hosting: one Verda CPU VM, kept up until about 22 Nov 2026 because judges may test the demo for seven days.
- Submission rules: source is MIT-licensed and must be readable by the organisers by 15 Nov 10:00; all code is written during the event.
- Unknown: the full Exa and Context.dev briefs and their criteria weights have not been read yet. If they require something this proposal lacks, `risk-signals` is where it changes.
