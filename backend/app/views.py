"""Every response the API can give for the fixed windows, built once at startup.

The data is a static snapshot, so selections, metrics and the two page bundles
are computed in `precompute()` and held as ready-to-send JSON bytes. Routes only
look results up. Requests for a custom start/end window slice the precomputed
selections (no reselection) and are memoised the same way.
"""

import gzip
import math
from datetime import date, timedelta
from typing import Any, get_args

import numpy as np
import pandas as pd
from pydantic import BaseModel

from app.dataset import Dataset
from app.metrics import Evaluation, evaluate
from app.schemas import (
    AccuracySelection,
    AccuracyView,
    ActualPoint,
    ActualsResponse,
    Coverage,
    DatasetSnapshot,
    DayKpis,
    DecisionView,
    ForecastPoint,
    ForecastRun,
    Gate,
    GateForecastResponse,
    HistogramBin,
    HorizonForecastResponse,
    HorizonSummary,
    HourSummary,
    MaxOver,
    Meta,
    MetricsResponse,
    Mode,
    Pair,
    Summary,
)
from app.selection import LONDON, latest_at_gate, latest_by_horizon

GATES: tuple[Gate, ...] = get_args(Gate)
HORIZONS = range(49)
BIN_WIDTH = 500
MAX_SCATTER_POINTS = 1500
HALF_HOUR = pd.Timedelta(minutes=30)


def to_json(model: BaseModel) -> bytes:
    """Serialise once, with the same camelCase aliases and formats as the routes."""
    return model.model_dump_json(by_alias=True).encode()


def cached_json(ds: Dataset, key: tuple[Any, ...], build) -> bytes:
    return ds.memo(("json", *key), lambda: to_json(build()))


# ---------- Windows ----------


def delivery_days(ds: Dataset) -> list[date]:
    """Europe/London delivery days lying wholly inside the data window."""
    first = ds.start.tz_convert(LONDON).ceil("D").date()
    last = ds.end.tz_convert(LONDON).floor("D").date() - timedelta(days=1)
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def day_window(day: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    midnight = pd.Timestamp(day)
    start = midnight.tz_localize(LONDON).tz_convert("UTC")
    end = (midnight + pd.Timedelta(days=1)).tz_localize(LONDON).tz_convert("UTC")
    return start, end


# ---------- Selections over every forecast startTime ----------


def _all_forecast_times(ds: Dataset) -> pd.Series:
    return ds.memo(("forecast-times",), lambda: ds.forecasts["startTime"].drop_duplicates().sort_values())


def gate_selection(ds: Dataset, gate: Gate) -> pd.DataFrame:
    return ds.memo(("selection", "gate", gate), lambda: latest_at_gate(ds.forecasts, gate, targets=_all_forecast_times(ds)))


def horizon_selection(ds: Dataset, h: int) -> pd.DataFrame:
    return ds.memo(("selection", "horizon", h), lambda: latest_by_horizon(ds.forecasts, h, targets=_all_forecast_times(ds)))


def _between(df: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    times = df["startTime"]
    return df[(times >= start) & (times < end)]


# ---------- Granular routes ----------


def meta(ds: Dataset) -> Meta:
    return Meta(
        start=ds.start,
        end=ds.end,
        refreshed_at=ds.refreshed_at,
        actual_rows=len(ds.actuals),
        forecast_runs=int(ds.forecasts["publishTime"].nunique()),
    )


def actuals(ds: Dataset, start: pd.Timestamp, end: pd.Timestamp) -> ActualsResponse:
    rows = _between(ds.actuals, start, end)[["startTime", "generation"]]
    return ActualsResponse(start=start, end=end, points=[ActualPoint(**r) for r in records(rows)])


def forecast_at_gate(ds: Dataset, day: date, gate: Gate) -> GateForecastResponse:
    start, end = day_window(day)
    points = _between(gate_selection(ds, gate), start, end)
    return GateForecastResponse(day=day, gate=gate, start=start, end=end, points=forecast_points(points))


def forecast_at_horizon(ds: Dataset, h: int, start: pd.Timestamp, end: pd.Timestamp) -> HorizonForecastResponse:
    points = _between(horizon_selection(ds, h), start, end)
    return HorizonForecastResponse(h=h, start=start, end=end, points=forecast_points(points))


def evaluation(ds: Dataset, mode: Mode, key: Gate | int) -> Evaluation:
    """Scores one selection over every actual in the window (targets = actual startTimes)."""

    def compute() -> Evaluation:
        targets = ds.actuals["startTime"]
        if mode == "gate":
            selected = latest_at_gate(ds.forecasts, key, targets=targets)
        else:
            selected = latest_by_horizon(ds.forecasts, key, targets=targets)
        return evaluate(selected, ds.actuals)

    return ds.memo(("evaluation", mode, key), compute)


def metrics(ds: Dataset, mode: Mode, key: Gate | int) -> MetricsResponse:
    ev = evaluation(ds, mode, key)
    return MetricsResponse(
        mode=mode,
        gate=key if mode == "gate" else None,
        h=key if mode == "horizon" else None,
        start=ds.start,
        end=ds.end,
        coverage=Coverage(**ev.coverage),
        summary=_summary(ev.summary),
        by_hour=[HourSummary(**r) for r in records(ev.by_hour)],
        by_horizon=by_horizon(ds),
        worst=[Pair(**r) for r in records(ev.worst)],
        pairs=[Pair(**r) for r in records(ev.pairs)],
    )


def by_horizon(ds: Dataset) -> list[HorizonSummary]:
    return ds.memo(("by-horizon",), lambda: [HorizonSummary(**r) for r in records(ds.by_horizon)])


# ---------- The whole snapshot ----------


def snapshot(ds: Dataset) -> DatasetSnapshot:
    """Every actual and forecast row, with times as whole seconds since ds.start."""
    origin = ds.start
    second = pd.Timedelta(seconds=1)

    def seconds(times: pd.Series) -> np.ndarray:
        offsets = (times - origin) / second
        if not np.all(np.mod(offsets.to_numpy(dtype="float64"), 1) == 0):
            raise ValueError("snapshot times must be whole seconds")
        return offsets.to_numpy(dtype="float64").astype("int64")

    fc = ds.forecasts.sort_values(["publishTime", "startTime"], kind="stable")
    publish = seconds(fc["publishTime"])
    start = seconds(fc["startTime"])
    mw = _compact(fc["generation"])
    runs: list[ForecastRun] = []
    i = 0
    while i < len(fc):
        j = i
        while j < len(fc) and publish[j] == publish[i]:
            j += 1
        segments: list[tuple[int, list[int | float | None]]] = []
        for k in range(i, j):
            if segments and start[k] - start[k - 1] == 3600:
                segments[-1][1].append(mw[k])
            else:
                segments.append((int(start[k]), [mw[k]]))
        runs.append(ForecastRun(publish=int(publish[i]), segments=segments))
        i = j

    return DatasetSnapshot(
        version=ds.version,
        start=ds.start,
        end=ds.end,
        refreshed_at=ds.refreshed_at,
        actual_times=seconds(ds.actuals["startTime"]).tolist(),
        actual_mw=_compact(ds.actuals["generation"]),
        runs=runs,
    )


def _compact(values: pd.Series) -> list[int | float | None]:
    """MW values for JSON: whole numbers as ints (MW data is integral), NaN as null."""
    out: list[int | float | None] = []
    for v in values.to_numpy(dtype="float64").tolist():
        out.append(None if v != v else int(v) if v.is_integer() else v)
    return out


# ---------- Page bundles ----------


def decision_view(ds: Dataset, day: date, gate: Gate) -> DecisionView:
    """Everything the Decision view draws for one day and gate, in one response."""
    start, end = day_window(day)
    fc = _between(gate_selection(ds, gate), start, end)
    act = _between(ds.actuals, start, end)[["startTime", "generation"]]

    with_fc = fc[fc["publishTime"].notna() & fc["generation"].notna()]
    leads = (with_fc["startTime"] - with_fc["publishTime"]).dt.total_seconds() / 3600
    pairs = with_fc.merge(act, on="startTime", suffixes=("_fc", "_act")).dropna(subset=["generation_act"])
    errors = pairs["generation_fc"].astype("float64") - pairs["generation_act"].astype("float64")
    over = errors[errors > 0]
    max_over = None
    if len(over):
        i = over.idxmax()
        max_over = MaxOver(value=float(over[i]), start_time=pairs.loc[i, "startTime"])

    return DecisionView(
        day=day,
        gate=gate,
        start=start,
        end=end,
        actuals=[ActualPoint(**r) for r in records(act)],
        forecast=forecast_points(fc),
        runs=sorted(with_fc["publishTime"].unique()),
        lead_min=_num(leads.min()) if len(leads) else None,
        lead_max=_num(leads.max()) if len(leads) else None,
        hours_forecast=len(with_fc),
        hours_total=len(fc),
        kpis=DayKpis(
            mae=_num(errors.abs().mean()) if len(errors) else None,
            bias=_num(errors.mean()) if len(errors) else None,
            max_over=max_over,
            p90_over=_summary(evaluation(ds, "gate", gate).summary).p90_over,
        ),
    )


def accuracy_view(ds: Dataset, mode: Mode, gate: Gate) -> AccuracyView:
    """KPIs, error by hour, histogram, scatter and worst misses for a gate, or for
    every horizon 0-48h at once so the slider can switch client-side."""
    keys: list[Gate | int] = [gate] if mode == "gate" else list(HORIZONS)
    return AccuracyView(
        mode=mode,
        gate=gate if mode == "gate" else None,
        start=ds.start,
        end=ds.end,
        by_horizon=by_horizon(ds),
        selections=[accuracy_selection(ds, mode, key) for key in keys],
    )


def accuracy_selection(ds: Dataset, mode: Mode, key: Gate | int) -> AccuracySelection:
    def build() -> AccuracySelection:
        ev = evaluation(ds, mode, key)
        pairs = ev.pairs
        leads = (pairs["startTime"] - pairs["publishTime"]).dt.total_seconds() / 3600
        return AccuracySelection(
            key=str(key),
            coverage=Coverage(**ev.coverage),
            summary=_summary(ev.summary),
            by_hour=[HourSummary(**r) for r in records(ev.by_hour)],
            worst=[Pair(**r) for r in records(ev.worst)],
            lead_min=_num(leads.min()) if len(leads) else None,
            lead_max=_num(leads.max()) if len(leads) else None,
            bin_width=BIN_WIDTH,
            histogram=histogram(pairs["error"]),
            scatter=scatter(ds, pairs),
            scatter_total=len(pairs),
        )

    return ds.memo(("accuracy-selection", mode, key), build)


def histogram(errors: pd.Series) -> list[HistogramBin]:
    """Counts per BIN_WIDTH band centred on zero (bin k covers k*W +/- W/2), zero bin always present."""
    if errors.empty:
        return []
    k = np.floor(errors.to_numpy(dtype="float64") / BIN_WIDTH + 0.5).astype(int)
    lo, hi = min(int(k.min()), 0), max(int(k.max()), 0)
    counts = np.bincount(k - lo, minlength=hi - lo + 1)
    return [HistogramBin(center=(lo + i) * BIN_WIDTH, count=int(c)) for i, c in enumerate(counts)]


def scatter(ds: Dataset, pairs: pd.DataFrame) -> list[tuple[int, int, int]]:
    """(half-hours from window start, actual MW, forecast MW), at most MAX_SCATTER_POINTS."""
    step = max(1, math.ceil(len(pairs) / MAX_SCATTER_POINTS))
    sample = pairs.iloc[::step]
    slots = ((sample["startTime"] - ds.start) / HALF_HOUR).round().astype(int)
    return list(
        zip(
            slots.tolist(),
            sample["actual"].round().astype(int).tolist(),
            sample["forecast"].round().astype(int).tolist(),
            strict=True,
        )
    )


# ---------- Startup ----------


def precompute_essentials(ds: Dataset) -> None:
    """What the UI asks for first: the snapshot it computes every view from, and the
    status strip's metadata. Fast enough (well under a second) to block startup on."""
    for key, build in ((("meta",), lambda: meta(ds)), (("dataset",), lambda: snapshot(ds))):
        body = cached_json(ds, key, build)
        ds.memo(("gzip", *key), lambda body=body: gzip.compress(body, compresslevel=6))


def precompute(ds: Dataset) -> None:
    """Build and serialise every fixed-window response, so no request computes anything.
    Runs in the background after startup (see app.main); a request that arrives first
    computes and caches its own response."""
    precompute_essentials(ds)
    cached_json(ds, ("actuals", ds.start, ds.end), lambda: actuals(ds, ds.start, ds.end))
    for gate in GATES:
        cached_json(ds, ("metrics", "gate", gate), lambda gate=gate: metrics(ds, "gate", gate))
        cached_json(ds, ("view-accuracy", "gate", gate), lambda gate=gate: accuracy_view(ds, "gate", gate))
        for day in delivery_days(ds):
            cached_json(ds, ("forecast-gate", day, gate), lambda day=day, gate=gate: forecast_at_gate(ds, day, gate))
            cached_json(ds, ("view-decision", day, gate), lambda day=day, gate=gate: decision_view(ds, day, gate))
    for h in HORIZONS:
        cached_json(ds, ("metrics", "horizon", h), lambda h=h: metrics(ds, "horizon", h))
        cached_json(ds, ("forecast-horizon", h, ds.start, ds.end), lambda h=h: forecast_at_horizon(ds, h, ds.start, ds.end))
    cached_json(ds, ("view-accuracy", "horizon"), lambda: accuracy_view(ds, "horizon", GATES[0]))
    # Gzip each body once too; api._send serves these to clients that accept gzip.
    # A snapshot of the keys: requests may be adding entries from other threads meanwhile.
    for key in [k for k in list(ds._memo) if k[0] == "json"]:
        body = ds._memo[key]
        if len(body) >= 500:
            ds.memo(("gzip", *key[1:]), lambda body=body: gzip.compress(body, compresslevel=6))


# ---------- Helpers ----------


def records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Rows as dicts with NaN/NaT replaced by None (float32 columns widened first)."""
    columns = []
    for name in df.columns:
        col = df[name]
        if col.dtype.kind == "f":
            columns.append([None if v != v else v for v in col.to_numpy(dtype="float64").tolist()])
        elif isinstance(col.dtype, pd.DatetimeTZDtype) or col.dtype.kind == "M":
            columns.append([None if v is pd.NaT else v for v in col.tolist()])
        else:
            columns.append(col.tolist())
    names = list(df.columns)
    return [dict(zip(names, row, strict=True)) for row in zip(*columns, strict=True)]


def forecast_points(selected: pd.DataFrame) -> list[ForecastPoint]:
    return [ForecastPoint(**r) for r in records(selected[["startTime", "publishTime", "generation"]])]


def _num(value: Any) -> float | None:
    value = float(value)
    return None if math.isnan(value) else value


def _summary(summary: dict[str, float]) -> Summary:
    return Summary(**{k: None if isinstance(v, float) and math.isnan(v) else v for k, v in summary.items()})
