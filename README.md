# Kurt

Buy the cheap ticket for the train that is usually late. Ride the better one.

A Deutsche Bahn saver ticket (Sparpreis) is bound to one train. Once that train is expected to reach your destination 20+ minutes late, the binding is lifted and you may take another train. At 60 minutes late you get 25 % of the fare back, at 120 minutes 50 %. Kurt ranks long-distance connections by how often that has happened before, suggests a backup train, watches your trip live and helps you fill in the claim.

Live demo: https://65-108-33-75.sslip.io. It runs for 7 days after launch or until its server credits run out, whichever comes first. After that, run it yourself (below).

Built at Junction 2026. Not affiliated with Deutsche Bahn. Kurt never calls bahn.de or any DB service: you buy tickets and claim refunds there yourself. Kurt's odds come from past data and are no promise that a train will be late.

## What's in the repo

- `backend/`: FastAPI app, SQLite for saved trips, odds from `data/odds.sqlite`.
- `frontend/`: React PWA (installable, Web Push alerts).
- `extension/`: optional Chrome extension (load it unpacked) that shows Kurt's odds on a bahn.de results page you have open. It reads that page, works out the odds from the Kurt site's static odds files and adds badges; it never clicks, fills or loads anything on bahn.de. See [docs/extension.md](docs/extension.md).
- `deploy/`: Dockerfile, Docker Compose with Caddy (automatic HTTPS).
- `scripts/`: rebuild the odds table and the history from the source data.

## Run it locally

You need Python 3.12 with [uv](https://docs.astral.sh/uv/) and Node 22+.

```bash
git clone https://github.com/flix-wg/spaetkauf.git && cd spaetkauf
cd backend && uv sync --frozen && uv run uvicorn app.main:app --port 8710
```

In a second terminal:

```bash
cd frontend && npm ci && npm run dev
```

Open http://localhost:5710. The dev server sends `/api` to port 8710. No API keys are needed for search, odds, trips and live tracking. To try the UI without a backend, run `VITE_MOCK=1 npm run dev` (example data).

Tests: `cd backend && uv run pytest`.

## Self-host

One small VM with Docker is enough. See [docs/self-hosting.md](docs/self-hosting.md).

## Data and credits

- Delay history: Deutsche Bahn (DB InfraGO Timetables API), collected by [piebro/deutsche-bahn-data](https://github.com/piebro/deutsche-bahn-data), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). `data/odds.sqlite` and `data/backtest.json` are derived from it: Kurt aggregated arrival delays from December 2025 to October 2026 into late rates per train and route. These derived files are also under CC BY 4.0.
- Routes and live delays: [Transitous](https://transitous.org) ([data sources](https://transitous.org/sources/)), map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Transitous is free for open-source, non-commercial use; please keep your instance light on its API.
- Optional, each with your own API key: news signals from [Exa](https://exa.ai), strike monitors from [Context.dev](https://context.dev), and an [Anthropic](https://www.anthropic.com) model that helps the extension when bahn.de changes its page layout.

## License

Code: [MIT](LICENSE). Data files in `data/`: CC BY 4.0, see above.
