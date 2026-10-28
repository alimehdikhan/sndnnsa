"""HTTP routes. Times are UTC; a start/end given without an offset is read as UTC.

Every response body is built and serialised once (see app.views.precompute) and
returned as stored JSON bytes; routes only validate input and look results up.
"""

import gzip
from datetime import date, datetime
from typing import Annotated, Any, NoReturn

import pandas as pd
from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.exceptions import RequestValidationError

from app import views
from app.dataset import Dataset
from app.schemas import (
    AccuracyView,
    ActualsResponse,
    DatasetSnapshot,
    DecisionView,
    Gate,
    GateForecastResponse,
    Health,
    HorizonForecastResponse,
    Meta,
    MetricsResponse,
    Mode,
)

router = APIRouter(prefix="/api")


def get_dataset(request: Request) -> Dataset:
    return request.app.state.dataset


DatasetDep = Annotated[Dataset, Depends(get_dataset)]
Start = Annotated[datetime | None, Query(description="Inclusive. Defaults to the start of the data window.")]
End = Annotated[datetime | None, Query(description="Exclusive. Defaults to the end of the data window.")]
DayParam = Annotated[date, Query(description="Delivery day in Europe/London.")]
GateParam = Annotated[Gate, Query(description="Europe/London time on the day before delivery.")]
HOURS_AHEAD = "Forecasts must be published at least this many hours before startTime."


def _send(request: Request, ds: Dataset, key: tuple[Any, ...], build) -> Response:
    """Stored JSON for `key`; gzipped once and reused for clients that accept gzip."""
    body = views.cached_json(ds, key, build)
    if len(body) >= 500 and "gzip" in request.headers.get("accept-encoding", ""):
        compressed = ds.memo(("gzip", *key), lambda: gzip.compress(body, compresslevel=6))
        return Response(
            content=compressed,
            media_type="application/json",
            headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
        )
    return Response(content=body, media_type="application/json")


@router.get("/health")
def health() -> Health:
    return Health(status="ok")


@router.get("/meta", response_model=Meta)
def meta(request: Request, ds: DatasetDep) -> Response:
    return _send(request, ds, ("meta",), lambda: views.meta(ds))


@router.get("/actuals", response_model=ActualsResponse)
def actuals(request: Request, ds: DatasetDep, start: Start = None, end: End = None) -> Response:
    start_ts, end_ts = _window(ds, start, end)
    return _send(request, ds, ("actuals", start_ts, end_ts), lambda: views.actuals(ds, start_ts, end_ts))


@router.get("/forecast/gate", response_model=GateForecastResponse)
def forecast_at_gate(request: Request, ds: DatasetDep, day: DayParam, gate: GateParam = "09:20") -> Response:
    _check_day(ds, day)
    return _send(request, ds, ("forecast-gate", day, gate), lambda: views.forecast_at_gate(ds, day, gate))


@router.get("/forecast/horizon", response_model=HorizonForecastResponse)
def forecast_at_horizon(
    request: Request,
    ds: DatasetDep,
    h: Annotated[int, Query(ge=0, le=48, description=HOURS_AHEAD)],
    start: Start = None,
    end: End = None,
) -> Response:
    start_ts, end_ts = _window(ds, start, end)
    key = ("forecast-horizon", h, start_ts, end_ts)
    return _send(request, ds, key, lambda: views.forecast_at_horizon(ds, h, start_ts, end_ts))


@router.get("/metrics", response_model=MetricsResponse)
def metrics(
    request: Request,
    ds: DatasetDep,
    mode: Mode,
    gate: Annotated[Gate, Query(description="Used when mode=gate.")] = "09:20",
    h: Annotated[int | None, Query(ge=0, le=48, description=f"Required when mode=horizon. {HOURS_AHEAD}")] = None,
) -> Response:
    """Scores the chosen selection over every actual in the data window.

    byHorizon doesn't depend on mode: it's the error curve for horizons 1-48h.
    """
    if mode == "horizon" and h is None:
        _reject("h", "Field required when mode=horizon", None)
    key = gate if mode == "gate" else h
    return _send(request, ds, ("metrics", mode, key), lambda: views.metrics(ds, mode, key))


@router.get("/dataset", response_model=DatasetSnapshot)
def dataset(request: Request, ds: DatasetDep) -> Response:
    """The whole snapshot in compact form. The UI loads it once and computes every view
    locally, with the same selection and metric rules as the routes below."""
    return _send(request, ds, ("dataset",), lambda: views.snapshot(ds))


@router.get("/view/decision", response_model=DecisionView)
def decision_view(request: Request, ds: DatasetDep, day: DayParam, gate: GateParam = "09:20") -> Response:
    """The Decision view in one request: actuals, forecast, runs used and day KPIs."""
    _check_day(ds, day)
    return _send(request, ds, ("view-decision", day, gate), lambda: views.decision_view(ds, day, gate))


@router.get("/view/accuracy", response_model=AccuracyView)
def accuracy_view(
    request: Request,
    ds: DatasetDep,
    mode: Mode,
    gate: Annotated[Gate, Query(description="Used when mode=gate.")] = "09:20",
) -> Response:
    """The Accuracy view in one request. mode=horizon returns every horizon 0-48h."""
    key = ("view-accuracy", "gate", gate) if mode == "gate" else ("view-accuracy", "horizon")
    return _send(request, ds, key, lambda: views.accuracy_view(ds, mode, gate))


# ---------- Validation ----------


def _reject(param: str, msg: str, value: Any) -> NoReturn:
    """A 422 in the same shape as FastAPI's own query validation errors."""
    raise RequestValidationError([{"type": "value_error", "loc": ("query", param), "msg": msg, "input": value}])


def _utc(dt: datetime) -> pd.Timestamp:
    ts = pd.Timestamp(dt)
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")


def _fmt(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%dT%H:%MZ")


def _window(ds: Dataset, start: datetime | None, end: datetime | None) -> tuple[pd.Timestamp, pd.Timestamp]:
    """Resolve optional start/end to UTC, defaulting to and bounded by the data window."""
    start_ts = ds.start if start is None else _utc(start)
    end_ts = ds.end if end is None else _utc(end)
    scope = f"{_fmt(ds.start)} .. {_fmt(ds.end)}"
    if not ds.start <= start_ts < ds.end:
        _reject("start", f"Must be within the data window {scope}", start)
    if not ds.start < end_ts <= ds.end:
        _reject("end", f"Must be within the data window {scope}", end)
    if start_ts >= end_ts:
        _reject("end", "Must be after start", end)
    return start_ts, end_ts


def _check_day(ds: Dataset, day: date) -> None:
    days = views.delivery_days(ds)
    if not days[0] <= day <= days[-1]:
        _reject("day", f"Must be a delivery day from {days[0]} to {days[-1]}", day)
