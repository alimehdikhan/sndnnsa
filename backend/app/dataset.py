"""The data the API serves, loaded once at startup (see app.main).

`load()` reads the parquet snapshot (pyarrow). `load_json()` reads the same data from
data/snapshot.json, for the serverless deployment, which ships without pyarrow.
"""

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

import pandas as pd

from app.ingest import ACTUALS_END, ACTUALS_START, DATA_DIR, FETCHED_AT_KEY
from app.metrics import error_by_horizon

__all__ = ["DATA_DIR", "SNAPSHOT_JSON", "Dataset", "fetched_at", "load", "load_json"]

SNAPSHOT_JSON = DATA_DIR / "snapshot.json"

T = TypeVar("T")

# Only what the API reads, with MW values as float32.
ACTUAL_COLUMNS = ["startTime", "generation"]
FORECAST_COLUMNS = ["publishTime", "startTime", "generation"]


@dataclass(frozen=True, eq=False)
class Dataset:
    actuals: pd.DataFrame
    forecasts: pd.DataFrame
    # The UTC window [start, end) the API answers for; requests outside it are rejected.
    start: pd.Timestamp
    end: pd.Timestamp
    # When the snapshot was fetched (see fetched_at), if known.
    refreshed_at: pd.Timestamp | None = None
    # Hash of the data snapshot: the API's ETag, so clients revalidate only when data changes.
    version: str = ""
    # Responses already computed for this dataset. The data never changes while the
    # app runs, so an answer is valid for the life of the process.
    _memo: dict[tuple[Any, ...], Any] = field(default_factory=dict, repr=False)

    @property
    def by_horizon(self) -> pd.DataFrame:
        """error_by_horizon() over the whole window. It depends only on the data and takes a
        second or two, so it's computed once, on first use."""
        return self.memo(("by-horizon-frame",), lambda: error_by_horizon(self.forecasts, self.actuals))

    def memo(self, key: tuple[Any, ...], compute: Callable[[], T]) -> T:
        """Return the cached value for `key`, computing it on first use."""
        try:
            return self._memo[key]
        except KeyError:
            value = compute()
            self._memo[key] = value  # a racing duplicate computes the same value
            return value

    @classmethod
    def build(
        cls,
        actuals: pd.DataFrame,
        forecasts: pd.DataFrame,
        start: pd.Timestamp,
        end: pd.Timestamp,
        refreshed_at: pd.Timestamp | None = None,
        version: str | None = None,
    ) -> "Dataset":
        """Trims actuals to [start, end), so every endpoint scores the same rows."""
        in_window = (actuals["startTime"] >= start) & (actuals["startTime"] < end)
        actuals = actuals[in_window].reset_index(drop=True)
        if version is None:
            digest = hashlib.sha256()
            for frame in (actuals, forecasts):
                digest.update(pd.util.hash_pandas_object(frame, index=False).to_numpy().tobytes())
            version = digest.hexdigest()[:16]
        return cls(actuals, forecasts, start, end, refreshed_at, version)


def fetched_at(paths: list[Path]) -> pd.Timestamp:
    """When the snapshot was fetched: stamped in the parquet metadata by app.ingest. Files
    from before that stamp existed fall back to their modification time."""
    import pyarrow.parquet as pq

    stamps = []
    for path in paths:
        metadata = pq.read_schema(path).metadata or {}
        if FETCHED_AT_KEY in metadata:
            stamps.append(pd.Timestamp(metadata[FETCHED_AT_KEY].decode()))
        else:
            stamps.append(pd.Timestamp(path.stat().st_mtime, unit="s", tz="UTC"))
    return max(stamps)


def load(data_dir: Path = DATA_DIR) -> Dataset:
    paths = [data_dir / "actuals.parquet", data_dir / "forecasts.parquet"]
    missing = [p.name for p in paths if not p.exists()]
    if missing:
        raise FileNotFoundError(f"{', '.join(missing)} not found in {data_dir}; run `make refresh-data` first")
    actuals = _read(paths[0], ACTUAL_COLUMNS)
    forecasts = _read(paths[1], FORECAST_COLUMNS)
    refreshed_at = fetched_at(paths)
    digest = hashlib.sha256(b"".join(p.read_bytes() for p in paths)).hexdigest()[:16]
    return Dataset.build(actuals, forecasts, pd.Timestamp(ACTUALS_START), pd.Timestamp(ACTUALS_END), refreshed_at, version=digest)


def load_json(path: Path = SNAPSHOT_JSON) -> Dataset:
    """The same Dataset as load(), from the JSON snapshot (scripts/export_snapshot.py).
    tests/test_dataset.py checks both give identical API responses."""
    snap = json.loads(path.read_bytes())
    origin = pd.Timestamp(snap["start"])

    def at(seconds: list[int]) -> pd.Series:
        return pd.Series(origin + pd.to_timedelta(seconds, unit="s"))

    publish: list[int] = []
    start: list[int] = []
    mw: list[float | None] = []
    for run in snap["runs"]:
        for first, values in run["segments"]:
            publish += [run["publish"]] * len(values)
            start += [first + 3600 * i for i in range(len(values))]
            mw += values
    actuals = pd.DataFrame({"startTime": at(snap["actualTimes"]), "generation": pd.Series(snap["actualMw"], dtype="float32")})
    forecasts = pd.DataFrame({"publishTime": at(publish), "startTime": at(start), "generation": pd.Series(mw, dtype="float32")})
    refreshed_at = pd.Timestamp(snap["refreshedAt"]) if snap["refreshedAt"] else None
    return Dataset.build(actuals, forecasts, origin, pd.Timestamp(snap["end"]), refreshed_at, version=snap["version"])


def _read(path: Path, columns: list[str]) -> pd.DataFrame:
    import pyarrow.parquet as pq

    df = pq.read_table(path, columns=columns).to_pandas()
    return df.astype({"generation": "float32"})
