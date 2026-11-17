#!/usr/bin/env bash
# Download the data release pinned in data/release.json into data/ and verify its checksums.
# bash scripts/fetch_data.sh [odds.sqlite] [history.duckdb]   (default: both)
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
release="$root/data/release.json"
field() { python3 -I -c 'import json, sys; v = json.load(open(sys.argv[1])); [v := v[k] for k in sys.argv[2:]]; print(v)' "$release" "$@"; }
tag=$(field tag)
names=("$@")
[[ ${#names[@]} -gt 0 ]] || names=(odds.sqlite history.duckdb)
tmp=
trap '[[ -z "$tmp" ]] || rm -f -- "$tmp"' EXIT
for name in "${names[@]}"; do
  sha=$(field assets "$name")
  target="$root/data/$name"
  if [[ -f "$target" ]] && printf '%s  %s\n' "$sha" "$target" | sha256sum --check --status; then continue; fi
  tmp=$(mktemp "$target.XXXXXX")
  curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 600 --retry 3 \
    "https://github.com/flix-wg/spaetkauf/releases/download/$tag/$name" -o "$tmp"
  printf '%s  %s\n' "$sha" "$tmp" | sha256sum --check --status || { echo "$name: checksum mismatch in release $tag" >&2; exit 1; }
  chmod 644 "$tmp"
  mv -- "$tmp" "$target"
  tmp=
  echo "$name from $tag"
done
