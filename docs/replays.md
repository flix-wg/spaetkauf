# Replays

A replay plays a real train run on a compressed clock: about 60 s for the whole run, first +20 within about 25 s. It goes through the same snapshot, state and alert code as live tracking (`tracker.record`). A replay trip has `is_replay: true` and `replay_of: <original date>`, and every push title starts with "Replay · " and every body ends with "(replay of <date>)". Nothing is interpolated or padded. Frames are dropped from the front only when the first +20 would otherwise come too late. Runs that never reach +20 play every frame and fire no threshold alert.

## Sources

- `live`: snapshots this server recorded while auto-tracking a train (`trip_snapshots`). The delay is the **forecast for the alighting stop** at the time of the snapshot. A recording needs at least 8 snapshots and a maximum of +20 or more.
- `history`: runs in `data/replays.json`, built by `scripts/build_replays.py` from the raw DB delay dataset (`data/raw/data-2026-09/10.parquet`). One frame per stop the train reached after boarding, ending at the alighting stop. The delay is the one **measured at that stop**: `arrival_change_time − arrival_planned_time`, from the last observation of each stop. The dataset's times are local (Europe/Berlin) and are stored as UTC. A run is identified by `id` without its last `-<stop>` part. Coupled trains share a run and are listed once (ICE 844, not ICE 854, on 2026-10-30).

Runs in the file: ICE 611 on 2026-10-30 and 2026-09-30 (Hamburg Hbf → München Hbf), ICE 544 on 2026-10-27 and ICE 844 on 2026-10-30 (Berlin Hauptbahnhof → Köln Hbf), and ICE 519 on 2026-10-30 (Hamburg → München, crosses +20 and ends at +24).

- ICE 611, 2026-10-24 (Saturday): Hamburg Hbf → München Hbf, peak +12, final −5 min; no Friday in Sep/Oct meets the limits (lowest Friday peak: +20 on 2026-10-09).
- ICE 789, 2026-10-30: Hamburg Hbf → München Hbf, peak +16, final −3 min (near miss; no +20 alert).

Credit (show with any history replay): "Delay history: piebro/deutsche-bahn-data (CC BY 4.0)."

## API

`GET /api/demo/recordings` returns a list, best first (crossing +20, then +60 in a separate step, live before history). Item:

```json
{"id": "history:ice611-2026-10-30", "source": "history", "delay_basis": "at_stop",
 "train": "ICE 611", "from": "Hamburg Hbf", "to": "München Hbf", "date": "2026-10-30",
 "frames": 15, "finished": true, "outcome": "cash50", "max_delay_min": 157, "crosses_20": true, "crosses_60": true}
```

- `id` is `live:<trip id>` or `history:<run id>`.
- `outcome` comes from the last frame: `on_time` (<20 min), `unlocked` (20–59), `cash25` (60–119), `cash50` (120+), or `cancelled` if that frame is cancelled. For an unfinished live recording, this is its latest recorded state.
- `delay_basis` is `destination_forecast` for live and `at_stop` for history.
- `crosses_20` is true when the first frame is under 20 and a later frame reaches 20.
- `crosses_60` is true when the first frame that reaches 20 is still under 60 and a later frame reaches 60.

`POST /api/demo/replay` takes the body `{push?, price_eur?, recording?}`, where `recording` is an `id` from the list (default: the first). It returns `{trip_id, secret, recording: <item>}`, or 404 when nothing qualifies.

## A frame in the Trip view

During playback `GET /api/trips/{id}` shows the latest frame. On top of the usual Trip fields it has:

```json
{"state": "cash25", "delay_min": 66, "expected_arr": null, "delay_basis": "at_stop",
 "at_stop": {"name": "Köln Hbf", "planned_arr": "2026-10-30T14:46:00Z", "actual_arr": "2026-10-30T15:52:00Z"},
 "is_replay": true, "replay_of": "2026-10-30", "finished": false, "final_delay_min": null}
```

- `at_stop` is null for live data. For history, show "at Köln Hbf: +66". The number is the delay measured at that stop, not a forecast for the destination.
- `expected_arr` is null for history frames except the last one, the alighting stop, where it is the real arrival.

## Observed playback (ICE 611, 2026-10-30, local server)

The trip was on time until +32 at Dortmund Hbf (20.5 s, unlocked), +63 at Solingen Hbf (26.3 s, cash25), +157 at Frankfurt Flughafen (35.6 s, cash50), and ended at +124 at München Hbf (60.9 s). Alerts fired once each: 20, 60, 120.
