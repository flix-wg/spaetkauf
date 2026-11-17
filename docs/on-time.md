# On-time chance in the extension

An optional badge line that says how often a train reaches your stop on time, so people who care about punctuality can pick the train most likely to be on time. Kurt's main number stays the chance of 20+ min late.

## Data

Nothing new to export. Every train file (`/data/odds/trains/<type>-<number>.json`) already has, per stop and weekday, the runs `n` and the runs at least 5 minutes late `ge5` (a cancelled arrival counts as late). The on-time chance uses the same code path as the late chance:

- One train: `1 − rate(ge5)`, with the same pull toward this train's other weekdays and its train type (`SHRINK_M = 50`).
- With a change: `share × (1 − rate(ge5) of the last train)`, where `share` is the chance of making every change, as in the 20+ min number. A missed change is counted as not on time.

Only long-distance trains have history, so a trip that ends on a regional train shows no on-time chance, the same as today.

## What counts as on time

**Under 5 minutes late at your stop.** Cancelled counts as not on time.

DB counts a train as on time when it is under 6 minutes late. Kurt's files count lateness in steps of 5, 10, 15, 20, … minutes, so 5 is the closest step. Matching DB exactly would need a new `ge6` column, a rebuilt `odds.sqlite` and a redeploy of the data before the feature works. On ICE/IC/EC arrivals in August and September 2026, the 5-minute rule calls about 4 percentage points more arrivals late than DB's 6-minute rule (57.8 % vs 54.1 % of raw rows). That makes Kurt's figure a little stricter than DB's, and the help text says "under 5 min" so nobody compares it with DB's figures unawares. Ranking trains against each other barely changes.

## How it looks

When the setting is on, each badge with history gets a second, quieter pill next to the orange one:

`[ 41 % chance of 20+ min late (?) ]  [ 52 % on time ]`

- Neutral colours (dark text, grey border), so it never competes with Kurt's pick or the orange late chance.
- No pill when there is no history, when the delay is already posted, or when the trip ends on a regional train.
- The `?` popover gets one extra line: "On time means under 5 min late at your stop. ICE 599: on time 24 of 34 Saturdays." With a change it adds that a missed change counts as late.
- The pill's text goes into the badge's `aria-label`.

## Setting

A checkbox on the options page, under the server setting: **Show on-time chance** (`showOnTime` in `chrome.storage.sync`). **Off by default.** Kurt's pitch is the late train that frees your saver ticket. A second percentage pointing the other way on every card would add noise for most users and could be misread as the late chance. People who care about punctuality turn it on once, and Chrome sync carries it to their other browsers. Changing it redraws the badges on open bahn.de tabs without a reload.

## Copy

| Key | English | German |
|---|---|---|
| `onTimeSetting` | Show on-time chance | Pünktlichkeit anzeigen |
| `onTimeSettingHint` | Adds how often each train reaches your stop under 5 min late. | Zeigt zusätzlich, wie oft jeder Zug weniger als 5 Min. verspätet an deinem Halt ankommt. |
| `onTime` | $1 % on time | $1 % pünktlich |
| `onTimeNote` | On time means under 5 min late at your stop. | Pünktlich heißt: weniger als 5 Min. verspätet an deinem Halt. |
| `onTimeCounts` | $1: on time $2 of $3 $4. | $1: pünktlich $2 von $3 $4. |
| `onTimeChange` | A missed change counts as late. | Ein verpasster Umstieg zählt als verspätet. |

## Not in scope

The web app (kurtfaehrt.de) does not get the on-time chance here. If people use it in the extension, the same `onTime` field from `connectionOdds` can be shown there later.
