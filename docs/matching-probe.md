# Matching probe (task 2.3)

Run: `uv run scripts/probe_matching.py`. Logic in `scripts/matching.py` (`parse_train`, `station_key`, `find_stats`), tests in `scripts/test_matching.py` (`uv run --with pytest pytest scripts/test_matching.py`). Transitous responses are cached in `data/raw/transitous/` (gitignored); the probe used 10 `/plan` calls and 6 geocode calls.

## Sample

5 routes (Hamburg–München, Berlin–Köln, Frankfurt–Berlin, Stuttgart–Hamburg, München–Köln), two `/plan` calls each (Sat 14 Nov from 07:00 and Sun 15 Nov from 14:00 Berlin time), 5 itineraries per call: **52 connections, 83 rail legs**. Each leg is looked up by (type and number from `routeShortName`, alighting stop name, weekday of scheduled arrival in Berlin time).

## Result

| | first run | after fixes |
|---|---|---|
| legs with history found | 80/83 (96.4 %) | 80/83 (96.4 %) |
| legs with at least 10 runs | 73/83 (88.0 %) | 73/83 (88.0 %) |
| connections, all legs found | 49/52 | 49/52 |
| connections, all legs with at least 10 runs | 42/52 | 42/52 |
| matches needing token overlap | 5 | 0 |

The match rate is above 90 %, so no coordinate fallback was added. All 80 found stops matched by exact station key.

## Misses

- **No train number (3 legs):** `FLX10` to Fulda (Sat 10:53, Sun 16:54, Sun 18:53). FlixTrain legs carry only the line name (`routeShortName` and `displayName` "FLX10", `tripShortName` empty); the history has FLX train numbers (e.g. 1239). In the first run "FLX10" was parsed as train 10 and the number fell back to ICE 10, a wrong train; only the missing Fulda stop stopped it. Matching by scheduled time could identify the FLX train but was not built; the picks step should show "not enough history" for FlixTrain legs (they are not sold on bahn.de anyway).
- **Too few runs (7 legs, all to Köln Hbf, stop matched exactly):** ICE 152, 154 (twice), 156 on Saturday with 7 runs; ICE 1254 on Sunday with 7 runs; ICE 1252 on Sunday (twice) with 3 runs. In the history these numbers ran only on weekends from January and daily from 20 April to 17 May 2026, never after. This is real thin history, not a matching error. Pooling all weekdays would give 33–34 runs per train, but that changes D6 and was not done.
- **Unknown train / stop not matched:** none after the fixes.

## Fixes made from the misses

1. `parse_train` requires a space between type and number ("ICE 785"); every DB leg in the sample has one, and "FLX10" now returns no train instead of a wrong one.
2. "am" is dropped in `station_key`, so "Frankfurt (Main) Flughafen Fernbahnhof" (Transitous) and "Frankfurt am Main Flughafen Fernbahnhof" (history) match exactly instead of by overlap.
3. The type fallback (same number, other type) is limited to the families ICE/IC, EC/ECE, RJ/RJX, EN/NJ and must be unique.

## Known risk

The overlap rule from D5 accepts a unique best match with one shared token. A stop like "Berlin-Spandau" on a train whose history knows only "Berlin Hbf" would match Berlin Hbf. It did not occur in the sample (no overlap match remained), but the backend should treat `match == "overlap"` as weaker.
