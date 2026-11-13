"""One-off: create the Context.dev strike monitors and store their webhook secrets in .env.

    uv run python scripts/create_monitor.py --dry-run
    uv run python scripts/create_monitor.py

Idempotent: monitors tagged "spaetkauf" are listed first and matched by name. Context.dev signs
per monitor, so CONTEXT_WEBHOOK_SECRET becomes a comma separated list. Nothing secret is printed.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import httpx

API = "https://api.context.dev/v1"
TAG = "spaetkauf"
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
PAGE_GOAL = "New announcements of strikes or warning strikes affecting German long-distance rail"
MONITORS = [
    ("spaetkauf GDL press", {"type": "page", "url": "https://www.gdl.de/presse/newsarchiv"}, 2),
    ("spaetkauf EVG press", {"type": "page", "url": "https://www.evg-online.org/presse/"}, 2),
    (
        "spaetkauf strike news",
        {"type": "search", "query": "Bahn Streik OR Warnstreik GDL OR EVG"},
        6,
    ),
]
SEARCH_GOAL = "News of a new or announced rail strike or warning strike by GDL or EVG in Germany"
DB_HOSTS = ("bahn.de", "deutschebahn.com", "dbregio.de", "db.de", "bahnhof.de", "inside-bahn.de")


def read_env(path: Path) -> dict[str, str]:
    out = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            key, sep, value = line.strip().partition("=")
            if sep and not key.startswith("#"):
                out[key.strip()] = value.strip().strip("\"'")
    return out


def write_env(path: Path, key: str, value: str) -> None:
    text = path.read_text() if path.is_file() else ""
    line = f"{key}={value}"
    if re.search(rf"^{key}=.*$", text, re.MULTILINE):
        text = re.sub(rf"^{key}=.*$", lambda _: line, text, flags=re.MULTILINE)
    else:
        text = text + ("" if text.endswith("\n") or not text else "\n") + line + "\n"
    path.write_text(text)


def bodies(host: str) -> list[dict]:
    out = []
    for name, target, hours in MONITORS:
        target = {
            **target,
            "instructions": SEARCH_GOAL if target["type"] == "search" else PAGE_GOAL,
        }
        assert not any(d in target.get("url", "") for d in DB_HOSTS)
        out.append(
            {
                "name": name,
                "tags": [TAG],
                "target": target,
                "schedule": {"type": "interval", "frequency": hours, "unit": "hours"},
                "webhook": {
                    "url": f"https://{host}/hooks/context",
                    "events": ["change.detected"],
                    "retry": {},
                },
            }
        )
    return out


def list_tagged(client: httpx.Client) -> list[dict]:
    found, cursor = [], None
    while True:
        params = {"tags": TAG, "limit": 100, **({"cursor": cursor} if cursor else {})}
        resp = client.get("/monitors", params=params)
        resp.raise_for_status()
        page = resp.json()
        found += page["data"]
        if not page.get("has_more"):
            return found
        cursor = page["next_cursor"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="print the request bodies only")
    args = ap.parse_args()
    env = {**read_env(ENV_FILE), **os.environ}
    host = re.sub(r"^https?://|/.*$", "", env.get("SITE_ADDRESS", ""))

    if args.dry_run:
        for body in bodies(host or "<SITE_ADDRESS>"):
            print(json.dumps(body, indent=2))
        return 0
    if not host or not env.get("CONTEXT_API_KEY"):
        print("Set SITE_ADDRESS and CONTEXT_API_KEY first.", file=sys.stderr)
        return 1

    with httpx.Client(
        base_url=API,
        timeout=30,
        headers={
            "Authorization": f"Bearer {env['CONTEXT_API_KEY']}",
            "User-Agent": env.get("SPAETKAUF_CLIENT_NAME", "spaetkauf-demo/0.1"),
        },
    ) as client:
        monitors = {m["name"]: m for m in list_tagged(client)}
        for body in bodies(host):
            if body["name"] in monitors:
                print(f"exists  {body['name']}")
                continue
            resp = client.post("/monitors", json=body)
            resp.raise_for_status()
            monitors[body["name"]] = resp.json()
            print(f"created {body['name']}")
        secrets = [
            m["webhook"]["secret"]
            for m in monitors.values()
            if (m.get("webhook") or {}).get("secret")
        ]
    if len(secrets) != len(monitors):
        print(
            "Some monitors returned no webhook secret; check the key's permissions.",
            file=sys.stderr,
        )
        return 1
    write_env(ENV_FILE, "CONTEXT_WEBHOOK_SECRET", ",".join(secrets))
    print(f"CONTEXT_WEBHOOK_SECRET written to .env ({len(secrets)} secrets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
