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
- **THEN** the connection's odds are at least 40 % and are labelled "estimate, includes missed change"

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

### Requirement: Attribution of the history data
The system SHALL credit the source and licence of the history data wherever odds are explained.

#### Scenario: Reading the sources
- **WHEN** the traveller opens the sources note
- **THEN** it names the dataset, its licence (CC BY 4.0) and the date range used
