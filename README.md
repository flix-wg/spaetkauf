# Kurt

Buy the cheap ticket for the train that is usually late, then ride a better one. Try it at https://kurtfaehrt.de.

A Deutsche Bahn saver ticket (Sparpreis) is only valid on the train you booked. Once that train is expected to reach your destination 20 or more minutes late, the binding is lifted and you can take another train; from 60 minutes late you also get part of the fare back. Kurt ranks long-distance connections by how often they arrived 20+ minutes late in the past and suggests a backup.

Kurt started at Junction 2026. It is not affiliated with Deutsche Bahn and never calls bahn.de or any DB service; you book and claim there yourself. The odds describe past runs, not a promise.

## Set it up

To run your own copy you need Python 3.12 with [uv](https://docs.astral.sh/uv/) and Node 22 or newer:

```bash
bash scripts/fetch_data.sh
uv run --project backend python scripts/export_static.py --odds data/odds.sqlite --history data/history.duckdb --out frontend/public/data
bash scripts/fetch_duckdb_ext.sh
cd frontend && npm ci && npm run dev
```

Open http://localhost:5710. No backend or API keys are needed: the browser computes odds, queries history with DuckDB-WASM, and requests routes from Transitous. Booked trips stay in this browser. Set operator details in `frontend/.env.local` using `frontend/.env.example`.

Checks: in `frontend/`, run `npm test`, `npm run typecheck` and `npm run build`; in `extension/`, run `npm test`. The retained backend has its own checks: `cd backend && uv run ruff check . && uv run pytest -q`. See [self-hosting](docs/self-hosting.md) for the static build and Pages deployment.

## Browser extension

The extension shows Kurt's odds on a bahn.de results page. Until the store versions are out, install it by hand: clone this repo, run `npm ci && npm run build` in `extension/`, open `chrome://extensions`, turn on Developer mode, click Load unpacked and pick the `extension/` folder. It works out the odds itself from the Kurt site's static files; set that site in the extension's options.

More in `docs/`: [how the odds are computed](docs/odds.md), [run history](docs/history.md), [the extension](docs/extension.md) and [self-hosting](docs/self-hosting.md).

## Data and license

Delay history: Deutsche Bahn (DB InfraGO Timetables API), collected by [piebro/deutsche-bahn-data](https://github.com/piebro/deutsche-bahn-data) and licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The odds and run history are derived from it (arrivals in the newest 12 months it publishes, aggregated into late rates per train and stop; rebuilt when a new month comes out and published as `data-*` releases of this repository), as is `data/backtest.json`; all are also CC BY 4.0.

Routes and live delays: [Transitous](https://transitous.org) ([data sources](https://transitous.org/sources/)), map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

Code: [MIT](LICENSE).
