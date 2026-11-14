# Self-hosting

Kurt runs as two containers: the app (FastAPI serving the built PWA) and Caddy (HTTPS). A small Linux VM is enough: the app uses about 150 MB of RAM.

## 1. Server

- A VM with Docker and the Compose plugin, ports 80 and 443 open.
- A host name pointing at the VM. Without a domain, `<ip-with-dashes>.sslip.io` works (for example `203-0-113-7.sslip.io`).

## 2. Configure

```bash
git clone https://github.com/flix-wg/spaetkauf.git /opt/spaetkauf && cd /opt/spaetkauf
cp .env.example .env
```

Edit `.env`. Empty values fall back to defaults. The helper scripts below need [uv](https://docs.astral.sh/uv/) (Python 3.12); run them on the server or in a clone on your own machine.

| Variable | Needed for | Notes |
|---|---|---|
| `SITE_ADDRESS` | HTTPS | Your host name. Several work, comma separated, e.g. `kurt.example.org, 203-0-113-7.sslip.io`. |
| `SPAETKAUF_CLIENT_NAME` | Transitous | User-Agent with a contact, e.g. `kurt-myname/0.1 (+https://example.org)`. Transitous asks every client for one. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push alerts | Generate with `cd backend && uv run python scripts/gen_vapid.py`. |
| `VAPID_SUBJECT` | Push alerts | `mailto:` or `https:` contact for push services. |
| `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL` | Impressum, Datenschutz | Address lines separated by `;`. Shown on `/impressum` and `/datenschutz`. |
| `LEGAL_HOSTING` | Datenschutz | Your hosting provider, e.g. `Hetzner Online GmbH, Gunzenhausen (Rechenzentrum in Deutschland)`. |
| `LEGAL_CDN` | Datenschutz | Set to `cloudflare` if the site runs behind Cloudflare. |
| `EXA_API_KEY`, `SPAETKAUF_EXA_BUDGET` | News signals (optional) | Without a key, picks show no news. |
| `CONTEXT_API_KEY`, `CONTEXT_WEBHOOK_SECRET` | Strike monitors (optional) | `cd backend && uv run python scripts/create_monitor.py` creates the monitors and writes the secrets into `.env`. It builds the webhook URL from `SITE_ADDRESS`, so run it while that holds a single host. |
| `ANTHROPIC_API_KEY`, `SPAETKAUF_ADAPT_DAILY_CAP` | Extension adapter (optional) | When bahn.de changes its layout, the server sends a text-free outline of the page to Anthropic to find the results again (at most 50 a day by default). |
| `SPAETKAUF_PLAN_BUDGET` | Transitous | Max route searches per day (default 700). |

The privacy page describes what this code does with the settings above. If you change the code or turn on other services, update `frontend/src/screens/Legal.tsx`.

## 3. Start

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
curl -fsS https://<your-host>/api/health
```

Caddy gets the TLS certificate on the first request. Saved trips live in the `appdata` volume (`/data/app.sqlite`). The app deletes a trip 30 days after it arrives (or a year after it was saved, if it never finished) and cached search results after 7 days; the privacy page says so.

The Chrome extension talks to the public demo by default. Point it at your server in its options page.

## 4. Optional: run history

The "past runs" lists need `data/history.duckdb` (65 MB, not in git). Build it with `uv run scripts/build_odds.py` (downloads the source data) and `uv run scripts/build_history.py`, copy it to `/opt/spaetkauf/history/` on the server and restart the app. Details: [history.md](history.md), [odds.md](odds.md).

## Update, restart, reset

- Update: `git pull`, then the `up -d --build` command again. Or from your own machine: `deploy/ship.sh user@host [git-ref]` with `HEALTH_URL=https://<your-host>/api/health`.
- Restart: `docker compose --env-file .env -f deploy/docker-compose.yml restart`.
- Delete all trips and push subscriptions: `docker compose --env-file .env -f deploy/docker-compose.yml down`, then `docker volume rm deploy_appdata`, then `up -d`.
- The app logs only the host name of each outbound call, so you can check that it never talks to bahn.de: `docker compose --env-file .env -f deploy/docker-compose.yml logs app | grep outbound`.

## Behind Cloudflare

Proxy the DNS record (orange cloud) only after Caddy has its certificate. SSL mode "Full (strict)". Leave "Always Use HTTPS" off (Caddy redirects itself and needs plain HTTP for certificate renewals). Add a cache rule that bypasses the cache for `/api/*`, `/sw.js` and `/manifest.webmanifest`. Keep Bot Fight Mode off, or webhooks and the extension's API calls may get a challenge. Set `LEGAL_CDN=cloudflare`.

CI and automated deploys: [ci.md](ci.md).
