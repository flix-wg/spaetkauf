#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
target="$root/frontend/public/duckdb/extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm"
sha=22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55
verify() { printf '%s  %s\n' "$sha" "$1" | sha256sum --check --status; }
if [[ -f "$target" ]] && verify "$target"; then chmod 644 "$target"; exit 0; fi
mkdir -p -- "$(dirname -- "$target")"
tmp=$(mktemp "${target}.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 120 \
  https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm -o "$tmp"
verify "$tmp" || { echo 'DuckDB Parquet extension checksum mismatch' >&2; exit 1; }
chmod 644 "$tmp"
mv -- "$tmp" "$target"
