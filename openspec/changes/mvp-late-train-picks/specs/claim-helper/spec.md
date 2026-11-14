# Spec Delta

## Purpose

Tells the traveller after a late trip how much money DB owes them and gives them the details to paste into DB's own claim form.

## ADDED Requirements

### Requirement: Compensation amount
For a finished trip with an entered ticket price the system SHALL compute the compensation: 25 % of the price at 60 to 119 minutes late at the destination, 50 % at 120 minutes or more, rounded up to the next 5 cents, and nothing when the result is under 4 euros or the delay is under 60 minutes.

#### Scenario: 71 minutes late on a 34.99 euro ticket
- **WHEN** the trip ended 71 minutes late and the price is 34.99
- **THEN** the amount shown is 8.75 euros

#### Scenario: Below the payout minimum
- **WHEN** the trip ended 65 minutes late and the price is 12.90
- **THEN** the screen says no payout is due because the amount is under 4 euros

#### Scenario: No price entered
- **WHEN** no price was entered
- **THEN** the screen shows the percentage owed and asks for the price

### Requirement: Paste-ready claim details
The system SHALL show the trip's date, train, stations, scheduled and actual arrival and delay as copyable fields, and SHALL say where the traveller files the claim themselves. The system SHALL NOT submit a claim or ask for bank details.

#### Scenario: Copying a field
- **WHEN** the traveller taps a field
- **THEN** its value is copied and the screen confirms it

#### Scenario: Switched trains
- **WHEN** the traveller marked that they switched to another train and arrived less than 60 minutes late
- **THEN** the screen says no compensation is due and explains why

### Requirement: Payout minimum heads-up at booking
When the traveller types a ticket price while saving a trip and 25 % of it is under 4 euros, the system SHALL show one muted line under the price: a 60-minute delay pays nothing in cash (with the 25 % amount and DB's 4-euro minimum), while a lifted Zugbindung and the full refund at 60+ minutes still apply. When 50 % is under 4 euros too, the line SHALL say even a 120-minute delay pays nothing.

#### Scenario: Cheap ticket
- **WHEN** the traveller types 12.90 as the price
- **THEN** one line says a 60-minute delay pays nothing in cash because 25 % is 3.25 euros and DB's minimum is 4 euros, and that a lifted Zugbindung and the full refund at 60+ minutes still apply

#### Scenario: Very cheap ticket
- **WHEN** the traveller types 7.50 as the price
- **THEN** the line says even a 120-minute delay pays nothing in cash

#### Scenario: Ticket above the line
- **WHEN** the traveller types 34.99 or leaves the price empty
- **THEN** no line is shown

### Requirement: What still applies under the minimum
When no claim is due only because the amount is under 4 euros, the claim screen SHALL say that a lifted Zugbindung and the full refund at 60+ minutes still apply.

#### Scenario: Claim under the minimum
- **WHEN** the trip ended 65 minutes late and the price is 12.90
- **THEN** the reason names the 4-euro minimum and says the Zugbindung and the full refund still apply

### Requirement: Delay evidence
The claim response SHALL include evidence from the trip's stored observations: scheduled and observed arrival, delay, a source label, and a timeline of the first observation, every observation whose delay differs by 5 or more minutes from the last one kept, and the last observation. No evidence is given when the traveller switched trains or the delay was known at booking.

#### Scenario: Timeline is downsampled
- **WHEN** a trip has observations of 0, 2, 9, 11, 25, 27 and 67 minutes
- **THEN** the timeline lists 0, 9, 25 and 67 minutes with the time each was observed

### Requirement: Delay proof on the claim screen
The claim screen SHALL show the evidence as a folded "Proof of the delay" row when a claim is due or the delay is within 10 minutes of 60, with a "Copy as text" button that copies a German text block. The row and the text SHALL say the data is real-time data from Transitous, not DB's own record.

#### Scenario: Copying the proof
- **WHEN** the traveller taps "Copy as text"
- **THEN** a German block with train, date, scheduled and observed arrival, delay and the timed observations is copied, naming Transitous as the source

#### Scenario: Far from the 60-minute line
- **WHEN** the trip ended 30 minutes late and no claim is due
- **THEN** no proof row is shown

### Requirement: Zugbindung card
While a trip runs and the delay at the destination is forecast or observed at 20 minutes or more, the trip screen SHALL show a card inline with the trip status, never as a pop-up: train, scheduled and forecast arrival, the rule (BB Personenverkehr 9.1.1, lifted once DB shows 20+ minutes expected per 9.1.4) and the time of the reading. It SHALL say the delay comes from Transitous, not DB, and that the conductor goes by what DB shows.

#### Scenario: Forecast passes 20 minutes
- **WHEN** the forecast delay at the destination is 27 minutes
- **THEN** the card says the train is expected 27 minutes late at the destination and that under DB's rule 9.1.1 the Zugbindung is lifted once DB shows 20+ minutes, with the time of the reading

#### Scenario: Delay drops under 20 minutes
- **WHEN** the forecast falls back under 20 minutes
- **THEN** the card is no longer shown

### Requirement: Show to conductor
The Zugbindung card SHALL have a "Show to conductor" button that opens the card full screen in a high-contrast layout until closed.

#### Scenario: Showing the conductor
- **WHEN** the traveller taps "Show to conductor"
- **THEN** the card fills the screen in large dark-on-light text until closed
