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
For each pick the system SHALL name the best other connection the traveller could ride if the booked one is late: the earliest-arriving connection from the same origin that leaves at or up to 120 minutes after the booked departure, arrives at most 20 minutes after the booked arrival, shares no train with the booked connection and is not reservation-only.

#### Scenario: A better train exists
- **WHEN** a direct train leaves 30 minutes after the booked one and arrives earlier
- **THEN** the pick shows it under "If late, ride" with its times, trains and number of changes

#### Scenario: No alternative in the window
- **WHEN** no other connection fits the window
- **THEN** the pick shows no ride-instead train and is not marked as Kurt's pick

### Requirement: Earlier ride-instead on request
When the traveller turns on "Ride instead: also up to 1 h earlier", the system SHALL also consider a connection that leaves up to 60 minutes before the booked one and has not left yet, but only when no later connection fits, and SHALL say that it helps only if the delay is posted in time. Arrive-by searches ignore this option.

#### Scenario: Only an earlier train fits
- **WHEN** the option is on, no later connection fits, and a train leaving 40 minutes before the booked one arrives earlier
- **THEN** it is shown as the ride-instead with "Earlier: only if the delay is posted in time"

#### Scenario: Option off
- **WHEN** the option is off
- **THEN** no ride-instead leaves before the booked train

### Requirement: Arrive-by search
The system SHALL let the traveller search by latest arrival time. It SHALL list connections scheduled to arrive in the 3 hours before that time, each with its spare time, an upper bound on how often it would have arrived too late, and which delay outcomes still arrive in time. Kurt's pick SHALL be the one with the highest odds (at least 30 %) among those that stay in time even 20+ minutes late and were too late on at most 10 % of runs; it needs no ride-instead.

#### Scenario: Late still works
- **WHEN** the traveller must arrive by 18:00 and a train is due at 16:50
- **THEN** it is listed under "Late still works" with 1 h 10 min to spare, its miss bound, and "In time even 1 h late: 25 % back"

#### Scenario: Too tight for a delay
- **WHEN** a train is due 10 minutes before the latest arrival time
- **THEN** it is listed under "Only on time" and is not Kurt's pick

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
