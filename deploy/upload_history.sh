#!/usr/bin/env bash
# Upload data/history.duckdb to the host's history directory over ONE ssh connection.
# Usage: deploy/upload_history.sh user@host      Env override: HISTORY_DIR (default /opt/spaetkauf/history)
# The file lands under a temporary name and is renamed once complete, so the running app (which mounts the
# directory read-only) never sees a half-written file. Restart the app afterwards to pick up the new file:
#   cd /opt/spaetkauf && docker compose --env-file .env -f deploy/docker-compose.yml restart app
set -euo pipefail
host="${1:?usage: deploy/upload_history.sh user@host}"
dir="${HISTORY_DIR:-/opt/spaetkauf/history}"
cd "$(git rev-parse --show-toplevel)"
file=data/history.duckdb
test -f "$file" || { echo "$file missing: run scripts/build_history.py" >&2; exit 1; }
# The VM stalls a second connection opened right after the first (see ship.sh), so the upload and the
# rename share one multiplexed connection.
sock="$(mktemp -u /tmp/spaetkauf-history.XXXXXX)"
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=6 -S "$sock")
trap 'ssh "${ssh_opts[@]}" -O exit "$host" 2>/dev/null || true' EXIT
ssh "${ssh_opts[@]}" -M -f -N "$host"
ssh "${ssh_opts[@]}" "$host" "mkdir -p $dir && chmod 755 $dir"
rsync -t --partial -e "ssh ${ssh_opts[*]}" "$file" "$host:$dir/history.duckdb.part"
ssh "${ssh_opts[@]}" "$host" "chmod 644 $dir/history.duckdb.part && mv -f $dir/history.duckdb.part $dir/history.duckdb && ls -l $dir/history.duckdb"
