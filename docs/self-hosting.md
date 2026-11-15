# Self-hosting

Kurt runs as two containers: the app (FastAPI, which also serves the built web app) and Caddy for HTTPS. A small Linux VM with Docker and the Compose plugin is enough; the app uses about 150 MB of RAM. Open ports 80 and 443 and point a host name at the VM. Without a domain, `<ip-with-dashes>.sslip.io` works.

## Configure

```bash
git clone https://github.com/flix-wg/spaetkauf.git /opt/spaetkauf && cd /opt/spaetkauf
cp .env.example .env
```

Empty values in `.env` fall back to defaults. The ones that matter:

| Variable | Notes |
|---|---|
| `SITE_ADDRESS` | Your host name, or several, comma separated. |
| `SPAETKAUF_CLIENT_NAME` | User-Agent with a contact, e.g. `kurt-yourname/0.1 (+https://example.org)`. Transitous asks every client for one. |
| `SPAETKAUF_PLAN_BUDGET` | Route searches per day (default 700). Keep the load on Transitous light. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push alerts. Generate the keys with `cd backend && uv run python scripts/gen_vapid.py`. |
| `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL`, `LEGAL_HOSTING`, `LEGAL_CDN` | Shown on `/impressum` and `/datenschutz`. |

`.env.example` lists the optional API keys as well (news, strike monitors, the extension's layout helper). Kurt works without them. If you change the code or turn on other services, update the privacy page in `frontend/src/screens/Legal.tsx` to match.

## Start

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
curl -fsS https://<your-host>/api/health
```

Caddy fetches the certificate on the first request. Saved trips live in the `appdata` volume. The app deletes a trip 30 days after it arrives (a year after saving if it never finished) and cached searches after 7 days.

The "past runs" lists also need `data/history.duckdb`; see [history.md](history.md).

## Day to day

- Update: `git pull`, then run the `up -d --build` command again. From another machine, `HEALTH_URL=https://<your-host>/api/health deploy/ship.sh user@host [git-ref]` does the same.
- Delete all trips and push subscriptions: `docker compose ... down`, `docker volume rm deploy_appdata`, then `up -d`.
- The app logs the host name of every outbound call, so you can check that it never contacts bahn.de: `docker compose --env-file .env -f deploy/docker-compose.yml logs app | grep outbound`.

Behind Cloudflare, turn on the proxy only after Caddy has its certificate, use SSL mode "Full (strict)", leave "Always Use HTTPS" off and bypass the cache for `/api/*`, `/sw.js` and `/manifest.webmanifest`. Set `LEGAL_CDN=cloudflare`.
