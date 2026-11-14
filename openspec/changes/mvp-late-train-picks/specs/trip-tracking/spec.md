# Spec Delta

## Purpose

Watches a trip the traveller has booked and tells them in time when the ticket is unlocked, when money comes back, and whether switching trains or staying is the better move.

## ADDED Requirements

### Requirement: Live state of a booked trip
The system SHALL show, for a booked trip, the current expected delay at the destination, when it was last updated, and one state: on time, unlocked (20+), 25 % back (60+), 50 % back (120+) or cancelled.

#### Scenario: Delay crosses 20 minutes
- **WHEN** the expected arrival at the destination is 27 minutes after schedule
- **THEN** the state is "unlocked", the delay reads +27, and the next thresholds (+60, +120) are shown with their cash value if a price was entered

#### Scenario: Live data missing
- **WHEN** no live data has arrived for the trip for more than 10 minutes
- **THEN** the screen says the data is stale and shows the time of the last update

#### Scenario: Trip finished on time
- **WHEN** the train arrives less than 20 minutes late
- **THEN** the state is "on time" and the screen says nothing was lost: the traveller rode the cheap ticket

### Requirement: Switch or stay
Once a trip is unlocked the system SHALL list connections the traveller can still catch from the origin or from where the train is, and SHALL state the trade-off: switching to an earlier arrival forfeits the delay compensation, staying keeps the race to +60 open.

#### Scenario: A faster train is catchable
- **WHEN** the trip is unlocked and another connection leaves in 40 minutes and arrives before the booked train's expected arrival
- **THEN** it is offered as "Switch" with its times, next to "Stay" with the amount at stake at +60

### Requirement: Alerts on threshold crossings
The system SHALL send a push notification to the device that booked the trip when the expected delay first reaches 20, 60 and 120 minutes, and when the train is cancelled. Each threshold alerts once per trip.

#### Scenario: First crossing of 20 minutes
- **WHEN** the expected delay moves from 12 to 24 minutes and notifications are allowed
- **THEN** one notification says the ticket is unlocked and names the ride-instead train

#### Scenario: Delay drops back
- **WHEN** the expected delay falls from 24 to 15 minutes
- **THEN** the state returns to "on time", the screen says the forecast dropped, and no second "unlocked" alert is sent if it rises again

#### Scenario: Notifications not allowed
- **WHEN** the traveller declines notifications
- **THEN** the live screen still updates while open

### Requirement: Labelled replay of a real trip
The system SHALL offer a replay that plays back a recorded real trip at higher speed through the same screens and alerts. Replay SHALL be labelled as a replay with the original date on every screen and in every notification.

#### Scenario: Starting the replay
- **WHEN** the presenter starts the replay
- **THEN** a trip appears whose delay climbs as it did on the recorded day, the label "Replay of <date>" is visible, and the +20 alert fires within 30 seconds

#### Scenario: Choosing a recording
- **WHEN** the presenter opens My trips
- **THEN** "Watch a replay" lists the live recordings and history runs with train, date and outcome, and tapping one starts that replay

### Requirement: Trips are stored without an account
The system SHALL keep booked trips for the device without requiring sign-up, and SHALL let the traveller delete a trip.

#### Scenario: Returning later
- **WHEN** the traveller reopens the app on the same device
- **THEN** their booked trips are listed

#### Scenario: Deleting a trip
- **WHEN** the traveller deletes a trip
- **THEN** it is removed from the device list and from the server, including its notification subscription
