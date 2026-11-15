# Spec Delta

## Purpose

Frames the product as one installable mobile web app with a consistent, playful identity that also uses a laptop screen well at a demo table.

## ADDED Requirements

### Requirement: Mobile-first installable app
The system SHALL work as a single web app at phone width with no horizontal scrolling, SHALL be installable to the home screen, and SHALL reach every screen through a bottom navigation with four entries: Picks, My trips, Late now, Lookup.

#### Scenario: Phone width
- **WHEN** the app is opened at 390 px width
- **THEN** every screen fits the width, tap targets are at least 44 px high, and the bottom navigation is visible

#### Scenario: Installing
- **WHEN** the traveller adds the site to the home screen and opens it from there
- **THEN** it opens without browser chrome and can ask for notification permission

### Requirement: Desktop layout
From 1024 px width the system SHALL replace the bottom navigation with a side bar that holds the logo, the same four entries and a QR code that opens the current site address on a phone, and SHALL lay out screens with two parts in two columns. Below 1024 px the app SHALL be one column at most 480 px wide.

#### Scenario: Opened on a laptop
- **WHEN** the app is opened at 1280 px width
- **THEN** the side bar with the four entries and a scannable QR code for the current site address is visible, and the picks screen shows the route and Kurt's pick beside the list of trains

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
