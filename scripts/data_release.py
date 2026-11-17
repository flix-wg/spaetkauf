"""Upstream state and the pinned data release (data/release.json). Stdlib only.

python3 -I scripts/data_release.py check       # GitHub output: changed=true|false
python3 -I scripts/data_release.py guard       # fails if a fresh build lost too many arrivals
python3 -I scripts/data_release.py write TAG   # pins the fresh data/ build as release TAG

The odds use the newest WINDOW monthly files of piebro/deutsche-bahn-data. A month is published around
the 2nd of the following month, and sometimes all months are reprocessed; either changes a checksum.
"""

import hashlib
import json
import sqlite3
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RELEASE = ROOT / "data" / "release.json"
TREE = "https://huggingface.co/api/datasets/piebro/deutsche-bahn-data/tree/main/monthly_processed_data"
WINDOW = 12
MIN_KEEP = 0.75  # a fresh build must keep this share of the pinned build's arrival events
ASSETS = ("odds.sqlite", "history.duckdb")


def upstream() -> dict[str, str]:
    """{YYYY-MM: sha256} of the newest WINDOW monthly files."""
    req = urllib.request.Request(TREE, headers={"User-Agent": "spaetkauf-data/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        entries = json.load(r)
    files = {}
    for e in entries:
        name = Path(e["path"]).name
        if e["type"] == "file" and name.startswith("data-") and name.endswith(".parquet"):
            files[name[5:12]] = e["lfs"]["oid"]
    months = sorted(files)[-WINDOW:]
    if len(months) < WINDOW:
        sys.exit(f"upstream lists only {len(months)} monthly files")
    return {m: files[m] for m in months}


def pinned() -> dict:
    return json.loads(RELEASE.read_text()) if RELEASE.exists() else {}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def odds_meta() -> dict:
    with sqlite3.connect((ROOT / "data" / "odds.sqlite").resolve().as_uri() + "?mode=ro", uri=True) as db:
        return dict(db.execute("SELECT key, value FROM meta"))


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "check":
        changed = upstream() != pinned().get("upstream")
        print(f"changed={'true' if changed else 'false'}")
    elif cmd == "guard":
        before = pinned().get("arrival_events")
        after = int(odds_meta()["arrival_events"])
        print(f"arrival events: {before} -> {after}")
        if before and after < MIN_KEEP * before:
            sys.exit(f"fresh build has {after} arrival events, under {MIN_KEEP:.0%} of {before}")
    elif cmd == "write" and len(sys.argv) == 3:
        meta = odds_meta()
        if not meta.get("upstream"):
            sys.exit("odds.sqlite was built with --months; build without it to record the upstream files")
        release = {
            "tag": sys.argv[2],
            "date_from": meta["date_from"],
            "date_to": meta["date_to"],
            "arrival_events": int(meta["arrival_events"]),
            "upstream": json.loads(meta["upstream"]),
            "assets": {name: sha256(ROOT / "data" / name) for name in ASSETS},
        }
        RELEASE.write_text(json.dumps(release, indent=2) + "\n")
        print(json.dumps(release, indent=2))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
