"""Pick one forecast per target time from the WINDFOR runs saved by app.ingest.

Both selectors take a frame with tz-aware UTC `publishTime`/`startTime` columns and a
`generation` column, and return one row per target startTime, sorted by startTime.
Targets with no eligible forecast are kept as gaps: NaT publishTime, NaN generation.

By default the targets are the startTimes present in `fc`. Pass `targets` to select
for other times too (e.g. every half-hour of the actuals); any that no forecast
covers come back as gaps.
"""

from collections.abc import Iterable
from datetime import datetime

import pandas as pd

LONDON = "Europe/London"
COLUMNS = ["startTime", "publishTime", "generation"]


def latest_by_horizon(fc: pd.DataFrame, horizon_h: float, *, targets: Iterable[pd.Timestamp] | None = None) -> pd.DataFrame:
    """For each startTime, the forecast with max publishTime where publishTime <= startTime - horizon_h."""
    start = _targets(fc, targets)
    cutoff = start - pd.Timedelta(hours=horizon_h)
    return _latest(fc, start, cutoff, inclusive=True)


def latest_at_gate(fc: pd.DataFrame, gate: str = "09:20", *, targets: Iterable[pd.Timestamp] | None = None) -> pd.DataFrame:
    """For each startTime, the latest forecast published strictly before `gate` (HH:MM,
    Europe/London) on D-1, where D is the startTime's delivery day in Europe/London.
    """
    gate_time = datetime.strptime(gate, "%H:%M")
    start = _targets(fc, targets)
    # Day arithmetic on naive London wall-clock time, so a DST change between D-1 and D
    # can't shift the gate by an hour. Localising then gives the gate's UTC instant.
    delivery_day = start.dt.tz_convert(LONDON).dt.tz_localize(None).dt.normalize()
    gate_local = delivery_day - pd.Timedelta(days=1) + pd.Timedelta(hours=gate_time.hour, minutes=gate_time.minute)
    cutoff = gate_local.dt.tz_localize(LONDON).dt.tz_convert("UTC")
    return _latest(fc, start, cutoff, inclusive=False)


def _targets(fc: pd.DataFrame, targets: Iterable[pd.Timestamp] | None) -> pd.Series:
    if targets is None:
        start = fc["startTime"]
    else:
        start = pd.Series(pd.to_datetime(list(targets), utc=True)).astype(fc["startTime"].dtype)
    return start.drop_duplicates().sort_values().reset_index(drop=True).rename("startTime")


def _latest(fc: pd.DataFrame, start: pd.Series, cutoff: pd.Series, *, inclusive: bool) -> pd.DataFrame:
    """For each target startTime, the fc row with the max publishTime before (or at) its cutoff."""
    targets = pd.DataFrame({"startTime": start, "cutoff": cutoff})
    candidates = fc[COLUMNS].merge(targets, on="startTime")
    published, limit = candidates["publishTime"], candidates["cutoff"]
    eligible = candidates[published <= limit if inclusive else published < limit]
    latest = eligible.sort_values("publishTime", kind="stable").drop_duplicates("startTime", keep="last")
    result = targets[["startTime"]].merge(latest[COLUMNS], on="startTime", how="left")
    # Float so the schema doesn't depend on whether any gaps happened to occur.
    return result.astype({"generation": "float64"})
