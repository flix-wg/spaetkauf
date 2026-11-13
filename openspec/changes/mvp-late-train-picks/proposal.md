# Proposal

## Why

A Deutsche Bahn saver ticket (Sparpreis) is bound to one train, but the binding is lifted as soon as that train is expected to reach the destination 20 or more minutes late; at 60 and 120 minutes money comes back on top. DB long-distance punctuality was 60.1 % in 2025, so on many trains this happens often. Nobody tells a traveller, before buying, which train is likely to be late and which better train they could ride instead. A delay that is already known when buying does not count, so the choice has to be made from history, in advance.

Spätkauf is built at Junction 2026 (hacking window 13 Nov 19:30 to 15 Nov 10:00, Helsinki time) for the Exa challenge with the Context.dev tech challenge.

## What Changes

- New mobile web app (installable, no browser extension, no native app) with a snail mascot, Kurt, and five screens: search, picks, live trip, claim, late right now.
- Picks: for a route and date, rank real connections by how often the booked train arrived 20+ minutes late on that weekday, and pair each with the train the traveller would ride instead once the binding is lifted.
- Live trip: the traveller marks a pick as booked; the app watches it and tells them when the ticket is unlocked (+20), when cash comes back (+60, +120), and whether to switch or stay.
- Late right now: a board of long-distance trains that are 20+ minutes late at this moment.
- Claim helper: the compensation amount and a text to paste into DB's own form.
- Risk signals: cited reasons from the public web for a route and date (strikes, track works, storms), and a watch on strike announcement pages.
- Demo support: a clearly labelled replay of a recorded real trip, and a desktop view with a phone frame and a QR code.
- The app never reads, changes or calls bahn.de; it only links to it. The traveller buys and claims themselves.

Out of scope: buying or claiming on the traveller's behalf, prices, accounts, ticket PDF import, scoreboard, any forecast beyond historical base rates.

## Capabilities

### New Capabilities
- `late-train-picks`: route search that returns connections ranked by late odds, each with the train to ride instead and a link to bahn.de.
- `delay-odds`: historical base rates of late arrival per train, stop and weekday, with a backtest that states how good they are.
- `trip-tracking`: watching a booked trip, threshold states, switch-or-stay alternatives, push alerts and labelled replay.
- `late-now-board`: the live list of long-distance trains currently 20+ minutes late.
- `risk-signals`: cited web evidence for a route and date and a monitor on strike announcement pages.
- `claim-helper`: compensation amount and paste-ready claim text for a finished trip.
- `web-app-shell`: the installable mobile app frame, navigation, desktop phone frame with QR code, and visual identity.
- `source-boundaries`: which data sources the system uses and how, including what it never does with bahn.de.

### Modified Capabilities

None.

## Impact

- New repository: Python backend, React frontend, a build script for the odds table, Docker Compose deployment.
- External services: Transitous (routing and live delays, non-commercial open-source use), Exa (search), Context.dev (page monitor), Hugging Face dataset `piebro/deutsche-bahn-data` (CC BY 4.0).
- Hosting: one Verda CPU VM, kept up until about 22 Nov 2026 because judges may test the demo for seven days.
- Submission rules: source is MIT-licensed and must be readable by the organisers by 15 Nov 10:00; all code is written during the event.
- Unknown: the full Exa and Context.dev briefs and their criteria weights have not been read yet. If they require something this proposal lacks, `risk-signals` is where it changes.
