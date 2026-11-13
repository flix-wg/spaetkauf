# Spec Delta

## Purpose

Adds what history cannot know: cited, dated reasons from the public web why a route may run late on a given day, and a watch on pages where rail strikes are announced.

## ADDED Requirements

### Requirement: Cited signals for a route and date
For a searched route and date the system SHALL show up to five signals found on the public web (strike, track works or closure, severe weather, large event), each with a one-line reason, its kind, the source name, the publication date and a link to the source.

#### Scenario: A strike is announced for the travel day
- **WHEN** a news source reports a rail strike covering the travel date
- **THEN** a signal of kind "strike" appears with the source, its date and a working link

#### Scenario: Nothing relevant found
- **WHEN** the search returns nothing relevant to the route and date
- **THEN** the screen says "No extra risk found for this day" and shows when it last looked

#### Scenario: Search unavailable
- **WHEN** the search service fails or no key is configured
- **THEN** picks and odds still load and the signals area says signals are unavailable

### Requirement: Signals never change the historical odds
The system SHALL show signals next to the odds and SHALL NOT alter the percentage because of them.

#### Scenario: Strike signal present
- **WHEN** a strike signal exists for the date
- **THEN** the pick keeps its historical odds and carries a separate "strike announced" marker

### Requirement: Strike page watch
The system SHALL watch a fixed list of public pages where rail strikes are announced and, when one changes, SHALL store the change and show a banner with the source link on affected screens.

#### Scenario: A watched page changes
- **WHEN** the monitor reports a change on a watched page
- **THEN** the change is stored with its time and source, and the picks and live screens show a banner linking to that page

#### Scenario: Forged change notice
- **WHEN** a change notice arrives without a valid signature
- **THEN** it is rejected and nothing is stored

### Requirement: Signals only from sources other than bahn.de
The system SHALL NOT fetch, scrape or monitor pages on bahn.de or other Deutsche Bahn sites for signals.

#### Scenario: A search result points to bahn.de
- **WHEN** a result's link is on bahn.de
- **THEN** it is shown as a link only, without the system fetching that page itself
