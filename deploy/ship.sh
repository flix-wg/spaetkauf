#!/usr/bin/env bash
# Ship the committed tree to the demo VM and rebuild. Usage: deploy/ship.sh root@<ip> [ref]
set -euo pipefail
host="${1:?usage: deploy/ship.sh user@host [ref]}"
ref="${2:-HEAD}"
dir=/opt/spaetkauf
cd "$(git rev-parse --show-toplevel)"
sha="$(git rev-parse --short "$ref")"
git archive "$ref" | ssh -o BatchMode=yes "$host" "mkdir -p $dir && tar -x -C $dir && echo $sha > $dir/REVISION"
ssh -o BatchMode=yes "$host" "cd $dir && test -f .env && docker compose --env-file .env -f deploy/docker-compose.yml up -d --build --quiet-pull 2>&1 | tail -5 && docker compose --env-file .env -f deploy/docker-compose.yml ps --format '{{.Service}} {{.Status}}'"
echo "shipped $sha to $host"
