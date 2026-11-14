# Spec Delta

## Purpose

Shows Spätkauf's odds and Kurt's pick on a bahn.de results page that the traveller already has open in desktop Chrome, without acting on that page or fetching anything from bahn.de.

## ADDED Requirements

### Requirement: Odds badge per long-distance connection
On a results page of www.bahn.de or int.bahn.de that the traveller has loaded, the extension SHALL read each connection card's times and train names and SHALL show a badge on each card with a long-distance train (at most 30 per page): the share of past runs of the last train that arrived at the destination 20 or more minutes late on that weekday, with the counts.

#### Scenario: Direct train with history
- **WHEN** a card shows a direct ICE that arrived 20+ minutes late on 14 of its 34 recorded Saturdays at the destination
- **THEN** its badge reads "41 % 20+ late (14 of 34 Saturdays)"

#### Scenario: Connection with changes
- **WHEN** a card has more than one train and the last one is long-distance
- **THEN** the badge uses only the last train's history, says "last train", and does not count missed changes

#### Scenario: No odds
- **WHEN** the last train is regional, or it has fewer than 10 past runs on that weekday
- **THEN** the badge says "No odds: last leg is a regional train" or "No history for this train yet"

### Requirement: Kurt's pick on the page
The extension SHALL mark as Kurt's pick the badged connection with the highest odds of at least 30 %. Only that badge SHALL carry a link, which opens the same route and date in the Spätkauf app. No ride-instead is required.

#### Scenario: Pick marked
- **WHEN** one connection on the page has 45 % odds and the others less
- **THEN** its badge is filled with the accent colour, shows Kurt, starts with "Kurt:" and has an "Open in Spätkauf" link

### Requirement: A delay bahn.de already shows does not count
When a card already shows a delay or cancellation, the extension SHALL start its badge with "Delay already posted: won't count", SHALL NOT mark it as Kurt's pick, and SHALL leave its odds unchanged. Seat and occupancy notices SHALL NOT count as a posted delay.

#### Scenario: Kurt's pick shows a cancellation
- **WHEN** the card with the highest odds says "Zug fällt aus" and another card has 35 %
- **THEN** the first badge reads "Delay already posted: won't count" followed by its unchanged odds, and the 35 % card becomes Kurt's pick

#### Scenario: Seat notice
- **WHEN** a card only says "Hohe Auslastung erwartet"
- **THEN** its badge is unchanged

### Requirement: Read-only on bahn.de
The extension SHALL only read the page the traveller loaded and add its own badges. It SHALL NOT click, fill, submit or navigate anything on bahn.de, SHALL NOT send any request to bahn.de or another Deutsche Bahn host, and SHALL NOT pass clicks or key presses on its badges to the page.

#### Scenario: Opening the explanation
- **WHEN** the traveller taps the badge's "?"
- **THEN** the explanation opens and the bahn.de card underneath does not react

#### Scenario: Deutsche Bahn host as server
- **WHEN** the traveller enters a bahn.de or db.de address as the Spätkauf server
- **THEN** the setting is refused

### Requirement: Only odds inputs leave the page
The extension SHALL send odds requests only to the configured Spätkauf server, without cookies, containing only the origin and destination names, the destination's station number, the date, and per connection its departure and arrival time, train names, date if different, and whether the card shows a posted delay. The server SHALL answer them from its odds table without contacting another host.

#### Scenario: Odds request
- **WHEN** a results page is parsed
- **THEN** one request with those fields goes to `/api/ext/odds` on the Spätkauf server, and the same request within 10 minutes is answered from the extension's cache

#### Scenario: Turned off
- **WHEN** the traveller turns the extension off in its popup
- **THEN** all badges disappear and no odds request is sent

### Requirement: Selector adapter from a text-free skeleton
When the built-in parser finds no connection on a page that looks like results, the extension SHALL send the server a skeleton of the page structure and its hash, with no text, prices or station names. The server SHALL accept only skeleton lines in the fixed grammar, SHALL ask a small Claude model at most once per layout per day and at most 50 times a day in total, and SHALL answer 503 without `ANTHROPIC_API_KEY`.

#### Scenario: Unknown layout
- **WHEN** bahn.de changes its markup and the parser finds no card
- **THEN** the extension sends the skeleton, applies the returned selectors if they find connections, and keeps them for that layout

#### Scenario: Adapter off
- **WHEN** the server has no Anthropic key
- **THEN** it answers 503 and the extension does not ask again for that layout until the next day

#### Scenario: Text in the skeleton
- **WHEN** a skeleton line contains free text
- **THEN** the server rejects it with 422 and calls no model
