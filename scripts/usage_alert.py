"""Sum the kurtfaehrt.de zone's last 7 full days from Cloudflare analytics and flag high usage."""

import json
import os
import urllib.request
from datetime import date, timedelta

QUERY = """
query ($zoneTag: string, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: {zoneTag: $zoneTag}) {
      httpRequests1dGroups(limit: 10, filter: {date_geq: $since, date_lt: $until}) {
        dimensions { date }
        sum { requests }
        uniq { uniques }
      }
    }
  }
}
"""


def fetch_days(token, zone, since, until):
    body = json.dumps({"query": QUERY, "variables": {"zoneTag": zone, "since": since, "until": until}})
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/graphql",
        data=body.encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if payload.get("errors"):
        raise SystemExit(f"Cloudflare GraphQL errors: {payload['errors']}")
    zones = payload["data"]["viewer"]["zones"]
    if not zones:
        raise SystemExit("Zone not found or not readable with this token")
    return zones[0]["httpRequests1dGroups"]


def summarize(days, threshold, since, until):
    requests = sum(day["sum"]["requests"] for day in days)
    uniques = sum(day["uniq"]["uniques"] for day in days)
    body = (
        f"kurtfaehrt.de, {since} to {until} (exclusive), from Cloudflare zone analytics:\n\n"
        f"- Unique visitors (sum of daily uniques): {uniques:,}\n"
        f"- Requests: {requests:,}\n"
        f"- Threshold: {threshold:,} unique visitors per 7 days\n\n"
        "Kurt's train searches go straight from browsers to api.transitous.org. "
        "At this level, write to the Transitous team about expected load. "
        "Close this issue once done; the check opens a new one if usage stays above the threshold."
    )
    return uniques > threshold, uniques, requests, body


def main():
    until = date.today()
    since = until - timedelta(days=7)
    threshold = int(os.environ["THRESHOLD"])
    days = fetch_days(os.environ["CF_ANALYTICS_TOKEN"], os.environ["CF_ZONE_ID"], since.isoformat(), until.isoformat())
    alert, uniques, requests, body = summarize(days, threshold, since, until)
    print(f"7-day unique visitors: {uniques}, requests: {requests}, threshold: {threshold}")
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        out.write(f"alert={'true' if alert else 'false'}\n")
    with open("usage-alert.md", "w") as f:
        f.write(body + "\n")


if __name__ == "__main__":
    main()
