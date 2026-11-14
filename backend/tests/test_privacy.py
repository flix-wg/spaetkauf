import time
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.config import Settings
from app.db import connect, init_db, purge
from app.main import create_app


def test_legal_from_env(monkeypatch, tmp_path):
    monkeypatch.setattr("app.config._load_dotenv", lambda _: None)
    values = {
        "OPERATOR_NAME": "Test Betreiber",
        "OPERATOR_ADDRESS": " Musterstraße 1 ; ; 12345 Berlin; ",
        "OPERATOR_EMAIL": "test@example.org",
        "LEGAL_HOSTING": "Test Hosting",
        "LEGAL_CDN": "cloudflare",
        "SPAETKAUF_DB_PATH": str(tmp_path / "legal.sqlite"),
        "SPAETKAUF_LOOP": "0",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    with TestClient(create_app(Settings.from_env())) as client:
        response = client.get("/api/legal")
    assert response.status_code == 200
    assert response.json() == {
        "name": "Test Betreiber",
        "address": ["Musterstraße 1", "12345 Berlin"],
        "email": "test@example.org",
        "hosting": "Test Hosting",
        "cdn": "cloudflare",
        "adapter": False,
    }


def test_purge_keeps_what_the_privacy_page_promises(tmp_path):
    db = tmp_path / "p.sqlite"
    init_db(db)
    ago = lambda d: (datetime.now(UTC) - timedelta(days=d)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = [  # id, created, finished
        ("old-done", ago(40), ago(31)),
        ("recent-done", ago(40), ago(29)),
        ("open", ago(200), None),
        ("stale-open", ago(400), None),
    ]
    conn = connect(db)
    with conn:
        for tid, created, finished in rows:
            conn.execute(
                "INSERT INTO trips(id, pick, created_at, finished_at) VALUES (?, '{}', ?, ?)",
                (tid, created, finished),
            )
        conn.execute("INSERT INTO trip_snapshots(trip_id, at) VALUES ('old-done', ?)", (ago(31),))
        conn.execute("INSERT INTO http_cache VALUES ('old', ?, '{}'), ('new', ?, '{}')",
                     (time.time() - 8 * 86400, time.time()))  # fmt: skip
    purge(db)
    assert {r[0] for r in conn.execute("SELECT id FROM trips")} == {"recent-done", "open"}
    assert conn.execute("SELECT COUNT(*) FROM trip_snapshots").fetchone()[0] == 0
    assert [r[0] for r in conn.execute("SELECT key FROM http_cache")] == ["new"]
    conn.close()
