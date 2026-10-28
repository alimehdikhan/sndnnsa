"""API response models. Fields are snake_case in Python and camelCase in JSON.

Missing values (selection gaps, metrics over zero pairs) are null, never NaN.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Gate = Literal["09:20", "09:50", "15:30"]
Mode = Literal["gate", "horizon"]


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, validate_by_alias=True)


class Health(ApiModel):
    status: Literal["ok"]


class Meta(ApiModel):
    """What the loaded snapshot covers, for the UI's status strip."""

    start: datetime
    end: datetime
    refreshed_at: datetime | None  # when the data files were last written
    actual_rows: int
    forecast_runs: int


class ActualPoint(ApiModel):
    start_time: datetime
    generation: float | None


class ForecastPoint(ApiModel):
    start_time: datetime
    publish_time: datetime | None  # null where no forecast was eligible
    generation: float | None


class ActualsResponse(ApiModel):
    start: datetime
    end: datetime
    points: list[ActualPoint]


class GateForecastResponse(ApiModel):
    day: date
    gate: Gate
    start: datetime
    end: datetime
    points: list[ForecastPoint]


class HorizonForecastResponse(ApiModel):
    h: int
    start: datetime
    end: datetime
    points: list[ForecastPoint]


class Coverage(ApiModel):
    rows: int
    missing_forecast: int
    missing_actual: int
    pairs: int


class Summary(ApiModel):
    n: int
    mae: float | None
    rmse: float | None
    bias: float | None
    nmae: float | None
    p50_abs: float | None
    p90_abs: float | None
    p95_abs: float | None
    n_over: int
    p90_over: float | None


class HourSummary(Summary):
    hour: int


class HorizonSummary(Summary):
    horizon_h: int


class Pair(ApiModel):
    """One period with both a forecast and an actual."""

    start_time: datetime
    publish_time: datetime
    forecast: float
    actual: float
    error: float
    abs_error: float


class MetricsResponse(ApiModel):
    mode: Mode
    gate: Gate | None
    h: int | None
    start: datetime
    end: datetime
    coverage: Coverage
    summary: Summary
    by_hour: list[HourSummary]
    by_horizon: list[HorizonSummary]
    worst: list[Pair]
    pairs: list[Pair]  # for scatter plots and error histograms


# ---------- Page bundles ----------


class MaxOver(ApiModel):
    value: float
    start_time: datetime


class DayKpis(ApiModel):
    mae: float | None
    bias: float | None
    max_over: MaxOver | None
    p90_over: float | None  # month-wide P90 over-forecast for this gate


class DecisionView(ApiModel):
    """Everything the Decision view needs for one delivery day and gate."""

    day: date
    gate: Gate
    start: datetime
    end: datetime
    actuals: list[ActualPoint]
    forecast: list[ForecastPoint]
    runs: list[datetime]  # publishTimes of the forecast runs used
    lead_min: float | None
    lead_max: float | None
    hours_forecast: int
    hours_total: int
    kpis: DayKpis


class HistogramBin(ApiModel):
    center: int
    count: int


class AccuracySelection(ApiModel):
    """Scores for one selection: a gate, or one horizon in hours."""

    key: str
    coverage: Coverage
    summary: Summary
    by_hour: list[HourSummary]
    worst: list[Pair]
    lead_min: float | None
    lead_max: float | None
    bin_width: int
    histogram: list[HistogramBin]
    # (half-hours since the window start, actual MW, forecast MW); at most 1,500 points
    scatter: list[tuple[int, int, int]]
    scatter_total: int


class AccuracyView(ApiModel):
    """mode=gate: one selection for that gate. mode=horizon: all 49 (h = 0..48)."""

    mode: Mode
    gate: Gate | None
    start: datetime
    end: datetime
    by_horizon: list[HorizonSummary]
    selections: list[AccuracySelection]


# ---------- The whole snapshot, for clients that select and score locally ----------


class ForecastRun(ApiModel):
    """One WINDFOR run: its publish time and its forecasts, as runs of consecutive hours."""

    publish: int  # seconds since the snapshot's start
    # (first target, seconds since start; MW for that hour and each following hour).
    # A null value is a forecast row with no generation; a missing hour starts a new segment.
    segments: list[tuple[int, list[int | float | None]]]


class DatasetSnapshot(ApiModel):
    """Actuals and every forecast row, compact. The UI loads this once and computes
    selections and metrics itself with the same rules as app.selection / app.metrics."""

    version: str
    start: datetime
    end: datetime
    refreshed_at: datetime | None
    actual_times: list[int]  # seconds since start, ascending
    actual_mw: list[int | float | None]  # null where the actual is missing
    runs: list[ForecastRun]  # by publish time

