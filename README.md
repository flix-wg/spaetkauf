# Spätkauf

Buy the cheap ticket for the train that is usually late. Ride the better one.

A Deutsche Bahn saver ticket is bound to one train until that train is expected to arrive 20+ minutes late; then any train will do. Spätkauf ranks connections by how often that happens, shows the train you would ride instead, and watches your trip live.

Built at Junction 2026. Not affiliated with Deutsche Bahn. The app never reads or calls bahn.de; you buy and claim there yourself.

- Plan and spec: `openspec/changes/mvp-late-train-picks/`
- Working rules for contributors and agents: `AGENTS.md`

Data: route and live data from Transitous/MOTIS; delay history from `piebro/deutsche-bahn-data` (CC BY 4.0).

## Run and restart

- Local backend: `cd backend && uv sync --frozen && uv run uvicorn app.main:app --reload --port 8710`.
- Local frontend (another terminal): `cd frontend && npm ci && npm run dev`; its API proxy targets port 8710.
- Mock UI without a backend: `cd frontend && VITE_MOCK=1 npm run dev` (example data).
- First deploy on a fresh VM: copy the repo to `/opt/spaetkauf`, `cp .env.example .env`, fill the keys, set `SITE_ADDRESS=<ip-with-dashes>.sslip.io`, then `docker compose --env-file .env -f deploy/docker-compose.yml up -d --build`. Caddy gets the certificate on the first request.
- Deploy from the repo root: `deploy/ship.sh <user@host>` (optional git ref as second argument; default HEAD). It ships committed files over one SSH connection, checks the VM env file exists, and rebuilds with Compose. It then polls the public health URL for HTTP success, up to 18 attempts; this does not verify search or trip persistence.
- The VM needs Docker/Compose, ports 80/443 open, and `/opt/spaetkauf/.env` already configured. Deployment preserves that file. Set `HEALTH_URL` for a different address; optional overrides: `DEPLOY_DIR`, `DEPLOY_COMPOSE`, `DEPLOY_ENV`.
- Restart on the VM: `cd /opt/spaetkauf && docker compose --env-file .env -f deploy/docker-compose.yml restart`. Booked trips persist in the `appdata` volume at `/data/app.sqlite`; check a saved trip after restarting.
- Reset trips on the VM: from `/opt/spaetkauf`, run `docker compose --env-file .env -f deploy/docker-compose.yml down`, then `docker volume rm deploy_appdata`, then `docker compose --env-file .env -f deploy/docker-compose.yml up -d`. This deletes trips and subscriptions, preserving Caddy certificates.
- Configuration names only: `SITE_ADDRESS` for public HTTPS; `SPAETKAUF_CLIENT_NAME`, `SPAETKAUF_DB_PATH`, `SPAETKAUF_ODDS_PATH`, `SPAETKAUF_HISTORY_PATH`, `SPAETKAUF_PLAN_BUDGET`, `SPAETKAUF_LOOP` have defaults (Compose sets database paths).
- Optional signals: `EXA_API_KEY`, `SPAETKAUF_EXA_BUDGET`, `CONTEXT_API_KEY`, `CONTEXT_WEBHOOK_SECRET`. Push requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`; `VAPID_SUBJECT` has a default. See `.env.example`; keep credentials out of Git.
- Demo: `GET /api/demo/recordings` lists live recordings and history runs from `data/replays.json`. `POST /api/demo/replay` accepts an optional `recording` ID and returns a trip ID and secret. Playback uses normal tracking and alerts on a compressed clock with replay labels and the original date; see [docs/replays.md](docs/replays.md).
- Per-run history (`data/history.sqlite`, 43 MB, `SPAETKAUF_HISTORY_PATH`) backs `GET /api/history`; see [docs/history.md](docs/history.md).
- Odds and backtest files are baked into the image; rebuild after changing them. CI and deployment details: [docs/ci.md](docs/ci.md).
