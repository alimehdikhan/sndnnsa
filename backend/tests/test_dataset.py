import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from app import views
from app.dataset import DATA_DIR, fetched_at, load
from app.ingest import write_snapshot

FRAME = pd.DataFrame({"startTime": pd.to_datetime(["2026-01-02T00:00Z"]), "generation": [1500]})


def test_fetch_time_is_read_from_the_parquet_metadata(tmp_path: Path) -> None:
    when = datetime(2026, 2, 1, 6, 30, tzinfo=timezone.utc)
    path = tmp_path / "actuals.parquet"
    write_snapshot(FRAME, path, when)
    os.utime(path, (0, 0))  # a fresh clone's file times say nothing about the fetch

    assert fetched_at([path]) == pd.Timestamp(when)
    assert pd.read_parquet(path).equals(FRAME)


def test_files_without_a_stamp_fall_back_to_their_modification_time(tmp_path: Path) -> None:
    path = tmp_path / "actuals.parquet"
    FRAME.to_parquet(path, index=False)
    os.utime(path, (1_767_225_600, 1_767_225_600))

    assert fetched_at([path]) == pd.Timestamp("2026-01-01T00:00Z")


def test_the_latest_file_stamp_wins(tmp_path: Path) -> None:
    early, late = tmp_path / "a.parquet", tmp_path / "b.parquet"
    write_snapshot(FRAME, early, datetime(2026, 2, 1, tzinfo=timezone.utc))
    write_snapshot(FRAME, late, datetime(2026, 2, 2, tzinfo=timezone.utc))

    assert fetched_at([early, late]) == pd.Timestamp("2026-02-02T00:00Z")


def test_committed_static_snapshot_matches_the_parquet() -> None:
    """The static deployment serves backend/data/snapshot.json instead of /api/dataset.
    Regenerate it with `python scripts/export_snapshot.py` after refreshing the data."""
    committed = (DATA_DIR / "snapshot.json").read_bytes()

    assert committed == views.to_json(views.snapshot(load()))
