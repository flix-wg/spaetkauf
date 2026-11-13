# Spec Delta

## Purpose

Shows which German long-distance trains are 20 or more minutes late at this moment, so anyone can see in seconds how often saver tickets unlock.

## ADDED Requirements

### Requirement: Board of trains late right now
The system SHALL list long-distance trains whose live expected arrival at a major station is 20 or more minutes after schedule, most delayed first, with train name, station, scheduled and expected time, delay, and the time of the last refresh.

#### Scenario: Trains are late
- **WHEN** live data shows ICE 514 arriving at Hamburg Hbf 37 minutes late
- **THEN** the board lists ICE 514 with +37 and marks it as unlocked

#### Scenario: Nothing is late
- **WHEN** no watched train is 20+ minutes late
- **THEN** the board says so and shows how many trains it checked

#### Scenario: Source unavailable
- **WHEN** the live source fails
- **THEN** the board shows the last successful list with its time and says it is not current

### Requirement: Headline count
The system SHALL show a headline with the number of trains currently 20+ minutes late out of the trains checked.

#### Scenario: Headline
- **WHEN** 14 of 96 checked trains are 20+ minutes late
- **THEN** the headline reads "14 of 96 trains: ticket unlocked right now"
