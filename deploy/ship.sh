#!/usr/bin/env bash
# Ship a git ref to a Docker Compose host and rebuild. Usage: deploy/ship.sh user@host [ref]
# Env overrides: DEPLOY_DIR, DEPLOY_COMPOSE, DEPLOY_ENV (name on the server, never touched), HEALTH_URL.
set -euo pipefail
host="${1:?usage: deploy/ship.sh user@host [ref]}"
ref="${2:-HEAD}"
dir="${DEPLOY_DIR:-/opt/spaetkauf}"
compose="${DEPLOY_COMPOSE:-deploy/docker-compose.yml}"
envfile="${DEPLOY_ENV:-.env}"
url="${HEALTH_URL:-https://65-108-33-75.sslip.io/api/health}"
# Keepalives matter: a quiet build leaves the session idle, and a NAT or firewall in
# between can drop it without telling the client, which then waits forever.
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=6)
cd "$(git rev-parse --show-toplevel)"
sha="$(git rev-parse --short "$ref")"
# One ssh connection only: the VM drops or stalls a second connection opened right after
# the first (found while debugging the old two-connection script), so upload and rebuild share one.
# Remote stdin is the tar stream, so compose gets </dev/null; build output streams (no pipe to tail).
git archive "$ref" | ssh "${ssh_opts[@]}" "$host" "set -e; mkdir -p $dir; tar -x -C $dir; echo $sha > $dir/REVISION; cd $dir; test -f $envfile; docker compose --env-file $envfile -f $compose up -d --build --quiet-pull </dev/null"
for _ in $(seq 18); do
  if curl -fsS -o /dev/null --max-time 5 "$url" 2>/dev/null; then echo "shipped $sha to $host, healthy"; exit 0; fi
  sleep 5
done
echo "health check failed after 90s: $url" >&2
exit 1
