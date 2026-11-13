# Spec Delta

## Purpose

Frames the product as one installable mobile web app with a consistent, playful identity that also presents well on a laptop at a demo table.

## ADDED Requirements

### Requirement: Mobile-first installable app
The system SHALL work as a single web app at phone width with no horizontal scrolling, SHALL be installable to the home screen, and SHALL reach every screen through a bottom navigation with three entries: Picks, My trips, Late now.

#### Scenario: Phone width
- **WHEN** the app is opened at 390 px width
- **THEN** every screen fits the width, tap targets are at least 44 px high, and the bottom navigation is visible

#### Scenario: Installing
- **WHEN** the traveller adds the site to the home screen and opens it from there
- **THEN** it opens without browser chrome and can ask for notification permission

### Requirement: Laptop presentation view
At laptop width the system SHALL show the app inside a phone-sized frame beside a panel with the product's one-line pitch and a QR code that opens the same address on a phone.

#### Scenario: Opened on a laptop
- **WHEN** the app is opened at 1280 px width or more
- **THEN** the phone frame, the pitch line and a scannable QR code for the current site address are visible

### Requirement: Visual identity
The system SHALL use a white background with the accent colour #FD4F00, the snail mascot Kurt, large monospaced delay numbers, and text that keeps a contrast ratio of at least 4.5:1.

#### Scenario: Accent used as text
- **WHEN** accent-coloured text appears on white
- **THEN** it uses the darker accent #C93D00 so that the contrast is at least 4.5:1

### Requirement: Loading, empty and error states
Every screen that loads data SHALL show a loading state, an empty state and an error state with a way to retry.

#### Scenario: Backend unreachable
- **WHEN** a request fails
- **THEN** the screen shows a short message and a retry action instead of a blank area

### Requirement: Honest labels
The system SHALL label example, replayed or stale data wherever it appears, and SHALL carry a short note that Spätkauf is independent of Deutsche Bahn.

#### Scenario: Footer note
- **WHEN** the traveller opens the sources note
- **THEN** it says the app is not affiliated with Deutsche Bahn and lists the data sources
