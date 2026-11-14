# Spec Delta

## Purpose

Lets a traveller search a German long-distance route and date and see which connections are most often late, each paired with the train they would ride instead.

## ADDED Requirements

### Requirement: Station lookup
The system SHALL suggest stations matching typed text so the traveller can choose an origin and a destination.

#### Scenario: Typing a station name
- **WHEN** the traveller types "Hamb"
- **THEN** the suggestions include "Hamburg Hbf"

#### Scenario: No match
- **WHEN** the typed text matches no station
- **THEN** the system shows that nothing was found and keeps the field editable

### Requirement: Ranked picks for a route and date
The system SHALL return real long-distance connections for the chosen origin, destination and date, ordered by the odds of arriving 20 or more minutes late, highest first. Each pick SHALL show departure and arrival time, duration, number of changes, train names and its odds.

#### Scenario: Route with history
- **WHEN** the traveller searches Hamburg Hbf to München Hbf for a date within the published timetable
- **THEN** at least one connection is listed with trains, times and odds, and Kurt's pick is the connection with the highest odds that has a ride-instead and at least 30 % odds of arriving 20 or more minutes late (no pick is marked when none qualifies)

#### Scenario: Connection without history
- **WHEN** a connection's trains have fewer than 10 past runs on that weekday
- **THEN** it is listed after the connections with odds and labelled "not enough history"

#### Scenario: No connections
- **WHEN** the route source returns no long-distance connection
- **THEN** the system says so and suggests another date or station

### Requirement: Ride-instead pairing
For each pick the system SHALL name the best other connection the traveller could ride if the booked one is late: the earliest-arriving connection that departs from the same origin up to 120 minutes after the booked departure (by default no earlier than it; when the traveller opts in with `before`, up to 60 minutes earlier, which only helps if the delay is posted before that train leaves), arrives at most 20 minutes after the booked arrival and is not reservation-only.

#### Scenario: A better train exists
- **WHEN** a direct train leaves 30 minutes after the booked one and arrives earlier
- **THEN** the pick shows it under "If it's late, you'd ride" with its times and how many minutes earlier or later it arrives than the booked connection

#### Scenario: No alternative in the window
- **WHEN** no other connection departs in the window
- **THEN** the pick shows no ride-instead train and says the next option is on the live screen

### Requirement: Buying stays with the traveller
Each pick SHALL offer a link that opens bahn.de for the traveller to buy the ticket there, and a separate action to mark the pick as booked. The system SHALL NOT show prices or buy anything.

#### Scenario: Open on bahn.de
- **WHEN** the traveller taps "Open on bahn.de"
- **THEN** bahn.de opens in a new tab and no request to bahn.de is made by the system itself

#### Scenario: Mark as booked
- **WHEN** the traveller taps "I booked this" and optionally enters the price they paid
- **THEN** the trip is saved on this device and its live screen opens

### Requirement: Known delays are excluded from the pitch
The system SHALL state on the picks screen that a delay already posted when buying does not count, and SHALL NOT recommend a connection because of a delay that is already live.

#### Scenario: Searching for today
- **WHEN** the traveller searches a departure within the next 3 hours and the train already shows a live delay
- **THEN** the pick is labelled "already posted: does not count" and is not marked as Kurt's pick
