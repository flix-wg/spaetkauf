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
