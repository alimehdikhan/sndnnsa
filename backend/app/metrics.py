"""Score selected forecasts (see app.selection) against actuals.

Error is forecast minus actual, so positive means over-forecast.

Missing values: the join keeps every startTime from either side. Rows with no forecast
(a selection gap) or no actual (absent or NaN) are counted in `coverage` and excluded
from every metric. A metric that is undefined for the rows available, such as any
metric over zero pairs, P90 over-forecast when nothing was over-forecast, or nMAE when
mean actual is 0, is NaN rather than an error.

Percentiles interpolate linearly between order statistics (pandas' default).
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.selection import LONDON, latest_by_horizon

NAN = float("nan")


@dataclass(frozen=True)
class Evaluation:
    coverage: dict[str, int]  # see coverage()
    summary: dict[str, float]  # see summarise()
    by_hour: pd.DataFrame  # see error_by_hour()
    worst: pd.DataFrame  # see worst_misses()
    pairs: pd.DataFrame  # every joined row with both forecast and actual, by startTime


def evaluate(selected: pd.DataFrame, actuals: pd.DataFrame, n_worst: int = 5) -> Evaluation:
    """Everything except error by horizon, which needs the raw forecasts (see error_by_horizon)."""
    joined = join(selected, actuals)
    return Evaluation(
        coverage=coverage(joined),
        summary=summarise(joined),
        by_hour=error_by_hour(joined),
        worst=worst_misses(joined, n_worst),
        pairs=joined[joined["error"].notna()].reset_index(drop=True),
    )


def join(selected: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    """Outer-join selected forecasts to actuals on startTime.

    Returns startTime, publishTime, forecast, actual, error, abs_error, sorted by
    startTime. error is NaN wherever either side is missing.
    """
    for name, df in (("selected", selected), ("actuals", actuals)):
        dupes = int(df["startTime"].duplicated().sum())
        if dupes:
            raise ValueError(f"{name} has {dupes} duplicate startTime(s); expected one row per startTime")
    forecast = selected[["startTime", "publishTime", "generation"]].rename(columns={"generation": "forecast"})
    actual = actuals[["startTime", "generation"]].rename(columns={"generation": "actual"})
    joined = forecast.merge(actual, on="startTime", how="outer")
    # Score in float64 whatever the storage dtype (MW values are loaded as float32).
    joined = joined.astype({"forecast": "float64", "actual": "float64"})
    joined["error"] = joined["forecast"] - joined["actual"]
    joined["abs_error"] = joined["error"].abs()
    return joined.sort_values("startTime").reset_index(drop=True)


def coverage(joined: pd.DataFrame) -> dict[str, int]:
    """Row counts. A row can be missing both sides, so the parts needn't sum to `rows`."""
    return {
        "rows": len(joined),
        "missing_forecast": int(joined["forecast"].isna().sum()),
        "missing_actual": int(joined["actual"].isna().sum()),
        "pairs": int(joined["error"].notna().sum()),
    }


def summarise(joined: pd.DataFrame) -> dict[str, float]:
    """Headline metrics over the rows of `joined` that have both forecast and actual.

    n         number of pairs scored
    mae       mean absolute error
    rmse      root mean squared error
    bias      mean error (forecast - actual)
    nmae      mae / mean actual over the same pairs
    p50_abs, p90_abs, p95_abs
              percentiles of absolute error
    n_over    number of over-forecasts (error > 0)
    p90_over  P90 of the over-forecast errors only (the buffer number)
    """
    known = joined["error"].notna().to_numpy()
    error = joined["error"].to_numpy(dtype="float64")[known]
    actual = joined["actual"].to_numpy(dtype="float64")[known]
    return _summarise_arrays(error, actual)


def _summarise_arrays(error: np.ndarray, actual: np.ndarray) -> dict[str, float]:
    """summarise() on plain arrays of scored pairs. Linear-interpolated percentiles,
    as pandas' default; NaN wherever the metric is undefined."""
    n = len(error)
    if n == 0:
        return {k: (0 if k in ("n", "n_over") else NAN) for k in SUMMARY_KEYS}
    abs_error = np.abs(error)
    over = error[error > 0]
    mae = float(abs_error.mean())
    mean_actual = float(actual.mean())
    p50, p90, p95 = np.quantile(abs_error, [0.50, 0.90, 0.95])
    return {
        "n": n,
        "mae": mae,
        "rmse": math.sqrt(float(np.mean(error**2))),
        "bias": float(error.mean()),
        "nmae": mae / mean_actual if mean_actual > 0 else NAN,
        "p50_abs": float(p50),
        "p90_abs": float(p90),
        "p95_abs": float(p95),
        "n_over": len(over),
        "p90_over": float(np.quantile(over, 0.90)) if len(over) else NAN,
    }


SUMMARY_KEYS = ("n", "mae", "rmse", "bias", "nmae", "p50_abs", "p90_abs", "p95_abs", "n_over", "p90_over")


def error_by_hour(joined: pd.DataFrame, tz: str = LONDON) -> pd.DataFrame:
    """summarise() per hour of day (0-23) of startTime in `tz`.

    All 24 hours are returned; hours with no pairs have n=0 and NaN metrics.
    """
    known = joined["error"].notna().to_numpy()
    hour = joined["startTime"].dt.tz_convert(tz).dt.hour.to_numpy()[known]
    error = joined["error"].to_numpy(dtype="float64")[known]
    actual = joined["actual"].to_numpy(dtype="float64")[known]
    return pd.DataFrame(
        [{"hour": h, **_summarise_arrays(error[hour == h], actual[hour == h])} for h in range(24)]
    )


def error_by_horizon(
    fc: pd.DataFrame, actuals: pd.DataFrame, horizons: Iterable[float] = range(1, 49)
) -> pd.DataFrame:
    """summarise() of latest_by_horizon(fc, h) against actuals, for each horizon h.

    Targets are the actuals' startTimes. Each horizon is scored on the targets that
    have a forecast that far ahead, so `n` can differ between rows.
    """
    rows = []
    for h in horizons:
        selected = latest_by_horizon(fc, h, targets=actuals["startTime"])
        rows.append({"horizon_h": h, **summarise(join(selected, actuals))})
    return pd.DataFrame(rows)


def worst_misses(joined: pd.DataFrame, n: int = 5) -> pd.DataFrame:
    """The n pairs with the largest absolute error; ties go to the earlier startTime."""
    pairs = joined[joined["error"].notna()]
    ranked = pairs.sort_values(["abs_error", "startTime"], ascending=[False, True])
    return ranked.head(n).reset_index(drop=True)
