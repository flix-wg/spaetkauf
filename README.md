# Kurt

Buy the cheap ticket for the train that is usually late, then ride a better one.

A Deutsche Bahn saver ticket (Sparpreis) is only valid on the train you booked. Once that train is expected to reach your destination 20 or more minutes late, the binding is lifted and you can take another train; from 60 minutes late you also get part of the fare back. Kurt ranks long-distance connections by how often they arrived 20+ minutes late in the past, suggests a backup and helps with the refund form.

Kurt started at Junction 2026. It is not affiliated with Deutsche Bahn and never calls bahn.de or any DB service; you book and claim there yourself. The odds describe past runs, not a promise.

## Running it locally

You need Python 3.12 with [uv](https://docs.astral.sh/uv/) and Node 22 or newer.

```bash
cd backend && uv sync --frozen && uv run uvicorn app.main:app --port 8710
cd frontend && npm ci && npm run dev    # second terminal
```

Then open http://localhost:5710. No API keys are needed; a few optional ones are listed in `.env.example`. `VITE_MOCK=1 npm run dev` runs the frontend on example data without the backend. Tests: `cd backend && uv run pytest`.

More in `docs/`: [how the odds are computed](docs/odds.md), [run history](docs/history.md), [the browser extension](docs/extension.md) and [self-hosting](docs/self-hosting.md).

## Data

Delay history: Deutsche Bahn (DB InfraGO Timetables API), collected by [piebro/deutsche-bahn-data](https://github.com/piebro/deutsche-bahn-data) and licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). `data/odds.sqlite` and `data/backtest.json` are derived from it (arrivals from December 2025 to October 2026, aggregated into late rates per train and stop) and are also CC BY 4.0.

Routes and live delays: [Transitous](https://transitous.org) ([data sources](https://transitous.org/sources/)), map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

## License

Code: [MIT](LICENSE). Files in `data/`: CC BY 4.0.
