"""Fetch GB wind actuals (FUELHH) and forecasts (WINDFOR) from the Elexon Insights API.

Run with `make refresh-data`, or `python -m app.ingest` from backend/.
"""

import time
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, TypeVar

import httpx
import pandas as pd

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
DATA_DIR = Path(__file__).resolve().parents[1] / "data"

# Half-open UTC windows: [start, end). Day-ahead purchase decisions made in January 2026
# (on D-1 = 1..31 Jan) are for delivery days 2 Jan .. 1 Feb, so actuals cover those days
# and forecasts cover every run published up to the last decision, on 31 Jan (with two
# days before the first decision, so the earliest gates have runs to choose from).
ACTUALS_START = datetime(2026, 1, 2, tzinfo=UTC)  # on startTime
ACTUALS_END = datetime(2026, 2, 2, tzinfo=UTC)
FORECASTS_START = datetime(2025, 12, 30, tzinfo=UTC)  # on publishTime
FORECASTS_END = datetime(2026, 2, 1, tzinfo=UTC)

CHUNK = timedelta(days=7)
TIMEOUT = httpx.Timeout(60.0, connect=10.0)  # API responses can take 15s+ under load
MAX_ATTEMPTS = 5
BACKOFF_SECONDS = 1.0
RETRY_STATUSES = {429, 500, 502, 503, 504}

T = TypeVar("T", date, datetime)


def weekly_chunks(start: T, end: T) -> Iterator[tuple[T, T]]:
    """Split [start, end) into consecutive [a, b) windows of at most seven days."""
    while start < end:
        yield start, min(start + CHUNK, end)
        start += CHUNK


def get_json(client: httpx.Client, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    """GET with exponential backoff on timeouts, connection errors, 429 and 5xx."""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.get(path, params=params)
            response.raise_for_status()
            return response.json()
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            retryable = not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code in RETRY_STATUSES
            if not retryable or attempt == MAX_ATTEMPTS:
                raise
            delay = BACKOFF_SECONDS * 2 ** (attempt - 1)
            print(f"    attempt {attempt} failed ({exc!r}); retrying in {delay:.0f}s")
            time.sleep(delay)
    raise AssertionError("unreachable")


def iso_utc(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_actuals(client: httpx.Client) -> pd.DataFrame:
    # FUELHH/stream can't filter on startTime, so fetch by settlement date and filter
    # afterwards. Settlement dates are UK-local: under BST the last UTC half-hour of a
    # day belongs to the next settlement date, hence fetching through ACTUALS_END's date.
    rows: list[dict[str, Any]] = []
    first, last = ACTUALS_START.date(), ACTUALS_END.date()
    for a, b in weekly_chunks(first, last + timedelta(days=1)):
        to = b - timedelta(days=1)  # settlementDateTo is inclusive
        print(f"  FUELHH settlementDate {a} .. {to}")
        rows += get_json(
            client,
            "/datasets/FUELHH/stream",
            {"settlementDateFrom": a.isoformat(), "settlementDateTo": to.isoformat(), "fuelType": "WIND"},
        )
    return normalise(rows, "startTime", ACTUALS_START, ACTUALS_END, key=["fuelType", "startTime"])


def fetch_forecasts(client: httpx.Client) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for a, b in weekly_chunks(FORECASTS_START, FORECASTS_END):
        # publishDateTimeTo is inclusive, so runs published exactly on a chunk boundary
        # come back twice; normalise() drops them.
        print(f"  WINDFOR publishTime {iso_utc(a)} .. {iso_utc(b)}")
        rows += get_json(
            client,
            "/datasets/WINDFOR/stream",
            {"publishDateTimeFrom": iso_utc(a), "publishDateTimeTo": iso_utc(b)},
        )
    return normalise(rows, "publishTime", FORECASTS_START, FORECASTS_END, key=["publishTime", "startTime"])


def normalise(rows: list[dict[str, Any]], window_col: str, start: datetime, end: datetime, key: list[str]) -> pd.DataFrame:
    """Parse times as tz-aware UTC, keep rows with window_col in [start, end), de-duplicate on key.

    Where a key repeats, the most recently published row wins.
    """
    if not rows:
        raise RuntimeError(f"API returned no rows for {window_col} in [{start}, {end})")
    df = pd.DataFrame(rows)
    for col in ("publishTime", "startTime"):
        df[col] = pd.to_datetime(df[col], utc=True)
    df = df[(df[window_col] >= start) & (df[window_col] < end)]
    deduped = df.sort_values("publishTime", kind="stable").drop_duplicates(subset=key, keep="last")
    print(f"    {len(rows)} rows fetched, {len(df)} in window, {len(df) - len(deduped)} duplicates dropped")
    return deduped.sort_values(key).reset_index(drop=True)


def resolution(gaps: pd.Series) -> str:
    """Most common gap between consecutive startTimes, given those gaps."""
    gap = gaps.dropna().mode().iloc[0]
    return f"{int(gap.total_seconds() // 60)} min"


def fmt(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%d %H:%M")


FETCHED_AT_KEY = b"fetched_at"


def write_snapshot(df: pd.DataFrame, path: Path, fetched_at: datetime) -> None:
    """Parquet with the fetch time in its metadata, since file times don't survive a git clone."""
    # Imported here: the serverless API reads the JSON snapshot and ships without pyarrow.
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.Table.from_pandas(df, preserve_index=False)
    metadata = {**(table.schema.metadata or {}), FETCHED_AT_KEY: fetched_at.isoformat().encode()}
    pq.write_table(table.replace_schema_metadata(metadata), path)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url=BASE_URL, timeout=TIMEOUT) as client:
        print("Fetching actuals")
        actuals = fetch_actuals(client)
        print("Fetching forecasts")
        forecasts = fetch_forecasts(client)

    fetched_at = datetime.now(UTC)
    write_snapshot(actuals, DATA_DIR / "actuals.parquet", fetched_at)
    write_snapshot(forecasts, DATA_DIR / "forecasts.parquet", fetched_at)

    a_start = actuals["startTime"]
    print(
        f"\nactuals.parquet: {len(actuals)} rows, resolution {resolution(a_start.diff())}, "
        f"startTime {fmt(a_start.min())} .. {fmt(a_start.max())} UTC"
    )
    f_pub, f_start = forecasts["publishTime"], forecasts["startTime"]
    per_run = forecasts.groupby("publishTime")["startTime"]
    print(
        f"forecasts.parquet: {len(forecasts)} rows, resolution {resolution(per_run.diff())}, "
        f"{f_pub.nunique()} forecast runs\n"
        f"  publishTime {fmt(f_pub.min())} .. {fmt(f_pub.max())} UTC\n"
        f"  startTime   {fmt(f_start.min())} .. {fmt(f_start.max())} UTC"
    )


if __name__ == "__main__":
    main()
