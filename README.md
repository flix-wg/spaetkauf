# Spätkauf

Buy the cheap ticket for the train that is usually late. Ride the better one.

A Deutsche Bahn saver ticket is bound to one train until that train is expected to arrive 20+ minutes late; then any train will do. Spätkauf ranks connections by how often that happens, shows the train you would ride instead, and watches your trip live.

Built at Junction 2026. Not affiliated with Deutsche Bahn. The app never reads or calls bahn.de; you buy and claim there yourself.

- Plan and spec: `openspec/changes/mvp-late-train-picks/`
- Working rules for contributors and agents: `AGENTS.md`

Data: route and live data from Transitous; delay history from `piebro/deutsche-bahn-data` (CC BY 4.0).

## Deploy

One VM with Docker and Compose. Run from the repo root.

- First deploy: `cp .env.example .env`, fill the keys, set `SITE_ADDRESS=<ip-with-dashes>.sslip.io` (empty serves on localhost only), then `docker compose --env-file .env -f deploy/docker-compose.yml up -d --build`. Ports 80 and 443 must be open; Caddy gets the certificate on the first request.
- Update: `git pull && docker compose --env-file .env -f deploy/docker-compose.yml up -d --build`
- Restart: `docker compose --env-file .env -f deploy/docker-compose.yml restart`
- Reset the app database: `docker compose --env-file .env -f deploy/docker-compose.yml down && docker volume rm deploy_appdata` (`down -v` would also drop the certificates).
- Data: the app database is the `appdata` volume at `/data/app.sqlite`; `data/odds.sqlite` and `data/backtest.json` are baked into the image, so rebuild after changing them. Check `/api/health` for status.
