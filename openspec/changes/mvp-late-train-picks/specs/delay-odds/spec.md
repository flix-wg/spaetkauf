# Spec Delta

## Purpose

Provides honest historical base rates of late arrival per train, stop and weekday, and states how well those rates held up on data they had not seen.

## ADDED Requirements

### Requirement: Odds are historical base rates
The system SHALL express odds as the share of past runs of the same train number that arrived at the destination stop at or above a threshold (20, 60, 120 minutes) on the same weekday, together with the counts behind it. It SHALL NOT present them as a forecast or a promise.

#### Scenario: Odds with counts
- **WHEN** a train arrived 20+ minutes late at München Hbf on 19 of its last 30 recorded Fridays
- **THEN** the odds read 63 % and the pick says "late 19 of 30 Fridays"

#### Scenario: Thin history
- **WHEN** fewer than 10 runs exist for that train, stop and weekday
- **THEN** no percentage is shown for it

### Requirement: Odds for connections with a change
For a connection with changes the system SHALL estimate the odds of arriving 20+ minutes late from the history of the last train and the chance of missing each change, and SHALL label the result as an estimate.

#### Scenario: Tight change
- **WHEN** the first train's history shows it arrived at the change station later than the change time on 40 % of runs
- **THEN** the connection's odds are at least 40 %, are labelled "est. trip 20+ late", and the counts shown are the last train's own

### Requirement: Cancellations count as a win
The system SHALL count a cancelled arrival as late at every threshold, because a cancellation also lifts the binding.

#### Scenario: Cancelled run in history
- **WHEN** a past run was cancelled at the destination stop
- **THEN** it is counted among the late runs

### Requirement: Published backtest
The system SHALL publish a backtest: odds computed from an earlier period compared with what happened in a later period, by odds bucket, next to the overall base rate. The result SHALL be visible in the app.

#### Scenario: Viewing the backtest
- **WHEN** the traveller opens "How good is Kurt?"
- **THEN** they see, per odds bucket, how often trains were actually 20+ minutes late in the test period, the number of runs, the test period dates and the overall base rate

### Requirement: Runs behind a percentage
The system SHALL let the traveller open the past runs behind a pick's odds: the last train at the destination on that weekday, every recorded run newest first with its date, scheduled time and delay or cancellation, and a count of runs, 20+ late and cancelled. When the run history file is missing, the rest of the app SHALL keep working.

#### Scenario: Opening the runs
- **WHEN** the traveller taps the odds line of a pick whose last train is ICE 1103 to München Hbf on Fridays
- **THEN** a sheet lists ICE 1103's Friday runs at München Hbf, newest first, with 20+ late runs and cancellations marked

#### Scenario: History not loaded
- **WHEN** the history file is not on the server
- **THEN** the sheet says the run history is not loaded and offers a retry, and picks and odds load as usual

### Requirement: Lookup by train or route
The system SHALL offer a lookup screen where the traveller enters a train or two stations, optionally a weekday. For a train it SHALL list each stop with its run count and share 20+ late or cancelled; for a route, each train that ran from the first station to the second on the same run, with typical times and its shares 20+ and 60+ late at the second. Each row SHALL open its runs.

#### Scenario: A train
- **WHEN** the traveller looks up "ICE 1103"
- **THEN** every recorded stop of ICE 1103 is listed with "k of n runs" and its share, and tapping one opens its runs

#### Scenario: A route
- **WHEN** the traveller looks up Hamburg Hbf to München Hbf on Saturdays
- **THEN** the trains that ran from Hamburg Hbf to München Hbf are listed by departure time with their Saturday shares at München Hbf

#### Scenario: Unknown train
- **WHEN** the train is not in the history
- **THEN** the screen says Kurt has no run history for it and shows the server's hint

### Requirement: Attribution of the history data
The system SHALL credit the source and licence of the history data wherever odds are explained.

#### Scenario: Reading the sources
- **WHEN** the traveller opens the sources note
- **THEN** it names the dataset, its licence (CC BY 4.0) and the date range used
