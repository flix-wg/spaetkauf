"""Check static exports against the real source databases."""

import json
import sqlite3
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import duckdb
import pytest

ROOT = Path(__file__).resolve().parent.parent
HISTORY = ROOT / "data/history.duckdb"
COUNTS = ("n", "n_cancel", "ge5", "ge10", "ge15", "ge20", "ge30", "ge45", "ge60", "ge90", "ge120")


@pytest.fixture(scope="module")
def odds_export(tmp_path_factory):
    out = tmp_path_factory.mktemp("static-odds")
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/export_static.py"),
            "--odds",
            str(ROOT / "data/odds.sqlite"),
            "--out",
            str(out),
        ],
        check=True,
    )
    return out / "odds"


def test_train_shard_matches_sqlite(odds_export):
    with sqlite3.connect(ROOT / "data/odds.sqlite") as db:
        train = db.execute(
            "SELECT train_type, train_number FROM train_stop_stats "
            "ORDER BY train_type = 'ICE' AND train_number = '785' DESC LIMIT 1"
        ).fetchone()
        expected = db.execute(
            f"SELECT station_key, weekday, {', '.join(f'SUM({c})' for c in COUNTS)} "
            "FROM train_stop_stats WHERE train_type = ? AND train_number = ? GROUP BY 1, 2",
            train,
        ).fetchall()
    shard = json.loads((odds_export / "trains" / f"{train[0]}-{train[1]}.json").read_text())
    assert (shard["type"], shard["number"]) == train
    assert shard["rows"] == sorted(shard["rows"], key=lambda r: (r[0], r[3], r[1]))
    actual = defaultdict(lambda: [0] * len(COUNTS))
    for row in shard["rows"]:
        for i, count in enumerate(row[4:15]):
            actual[row[0], row[3]][i] += count
    assert dict(actual) == {(key, wd): list(counts) for key, wd, *counts in expected}


def test_index_numbers_cover_every_train(odds_export):
    index = json.loads((odds_export / "index.json").read_text())
    with sqlite3.connect(ROOT / "data/odds.sqlite") as db:
        trains = db.execute("SELECT DISTINCT train_type, train_number FROM train_stop_stats")
        for kind, number in trains:
            assert kind in index["numbers"][number]
            assert (odds_export / "trains" / f"{kind}-{number}.json").is_file()


def test_parquet_parts_under_limit(tmp_path):
    if not HISTORY.is_file():
        pytest.skip(f"History source not present: {HISTORY}")
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/export_static.py"),
            "--history",
            str(HISTORY),
            "--out",
            str(tmp_path),
        ],
        check=True,
    )
    parts = sorted((tmp_path / "history").glob("*.parquet"))
    assert parts
    meta = json.loads((tmp_path / "history/meta.json").read_text())
    assert meta["files"] == [p.name for p in parts]
    assert all(p.stat().st_size < 20 * 1024 * 1024 for p in parts)
    events = sorted((tmp_path / "history").glob("events-*.parquet"))
    assert events
    with duckdb.connect(str(HISTORY), read_only=True) as db:
        expected = db.execute("SELECT count(*) FROM events").fetchone()[0]
        actual = db.execute(
            "SELECT count(*) FROM read_parquet(?)", [[str(p) for p in events]]
        ).fetchone()[0]
        max_group = db.execute(
            "SELECT max(row_group_num_rows) FROM parquet_metadata(?)", [[str(p) for p in events]]
        ).fetchone()[0]
    assert actual == expected
    assert max_group <= 8192


def test_odds_export_with_system_python(tmp_path):
    subprocess.run(
        [
            "/usr/bin/python3",
            "-I",
            str(ROOT / "scripts/export_static.py"),
            "--odds",
            str(ROOT / "data/odds.sqlite"),
            "--out",
            str(tmp_path),
        ],
        check=True,
    )
    assert (tmp_path / "odds/index.json").is_file()


@pytest.mark.parametrize("sql", [
    "WITH f AS mode(j.dep_min) ORDER BY n DESC LIMIT 100",
    "WITH f AS mode(j.dep_min), mode(j.arr_min) ORDER BY changed LIMIT 100",
    "SELECT e.dep_delay, e.dep_cancelled ORDER BY changed LIMIT 1001",
])
def test_golden_export_rejects_changed_backend_sql(sql):
    from export_history_golden import OrderedHistory

    with pytest.raises(ValueError, match="Backend history SQL changed"):
        OrderedHistory(None).execute(sql)
