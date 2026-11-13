# Spec Delta

## Purpose

Fixes which outside data sources the system may use and how, so the product stays inside their terms and never automates Deutsche Bahn's website.

## ADDED Requirements

### Requirement: No automated access to bahn.de
The system SHALL NOT send any request to bahn.de or its internal interfaces, SHALL NOT read or change bahn.de pages, and SHALL only offer links that the traveller opens themselves.

#### Scenario: Whole flow
- **WHEN** a traveller searches, books, tracks and claims a trip
- **THEN** the server and the app have made no request to a bahn.de host

### Requirement: Polite use of the route and live source
The system SHALL cache route and live answers, SHALL keep route searches under 700 per day, and SHALL identify itself to the source with a client name. When the daily budget is spent it SHALL answer from cache or say that the limit is reached.

#### Scenario: Same search twice
- **WHEN** two travellers search the same route and date within 10 minutes
- **THEN** only one request reaches the route source

#### Scenario: Budget spent
- **WHEN** the daily route-search budget is used up
- **THEN** new searches get a clear "limit reached for today" message and cached searches still work

### Requirement: Secrets and personal data stay out of the repository and logs
The system SHALL read all keys from the environment, SHALL NOT log keys, notification subscriptions or ticket prices, and SHALL store only what a trip needs: the connection, an optional price, and the notification subscription.

#### Scenario: Starting without optional keys
- **WHEN** the search or monitor key is missing
- **THEN** the app starts, the matching feature reports itself unavailable, and nothing else fails

### Requirement: Source attribution
The system SHALL credit every data source with its licence in a sources note reachable from every screen.

#### Scenario: Opening the sources note
- **WHEN** the traveller opens the sources note
- **THEN** it lists the route and live source, the history dataset with CC BY 4.0, and the search and monitor providers
