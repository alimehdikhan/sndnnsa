"""The Elexon fetch, against a fake transport: chunking, filtering, de-duplication and retries."""

from datetime import UTC, date, datetime
from urllib.parse import parse_qs

import httpx
import pandas as pd
import pytest

from app import ingest


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)


def client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), base_url=ingest.BASE_URL)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Retries back off with time.sleep; record the delays instead of waiting."""
    delays: list[float] = []
    monkeypatch.setattr(ingest.time, "sleep", delays.append)
    return delays


# ---------- Chunking ----------


def test_weekly_chunks_cover_the_window_exactly() -> None:
    chunks = list(ingest.weekly_chunks(date(2026, 1, 1), date(2026, 1, 17)))

    assert chunks == [
        (date(2026, 1, 1), date(2026, 1, 8)),
        (date(2026, 1, 8), date(2026, 1, 15)),
        (date(2026, 1, 15), date(2026, 1, 17)),  # the last chunk is cut at the end
    ]


def test_no_chunks_for_an_empty_window() -> None:
    assert list(ingest.weekly_chunks(date(2026, 1, 8), date(2026, 1, 8))) == []


# ---------- Actuals (FUELHH) ----------


def test_actuals_are_fetched_for_wind_by_settlement_date_and_trimmed_to_the_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingest, "ACTUALS_START", utc("2026-01-02T00:00Z"))
    monkeypatch.setattr(ingest, "ACTUALS_END", utc("2026-01-03T00:00Z"))
    requests: list[dict[str, list[str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/datasets/FUELHH/stream")
        requests.append(parse_qs(request.url.query.decode()))
        row = lambda start, published, mw: {  # noqa: E731
            "fuelType": "WIND",
            "startTime": start,
            "publishTime": published,
            "generation": mw,
        }
        return httpx.Response(
            200,
            json=[
                row("2026-01-01T23:30:00Z", "2026-01-02T00:00:00Z", 900),  # before the window
                row("2026-01-02T00:00:00Z", "2026-01-02T00:30:00Z", 1000),
                row("2026-01-02T00:00:00Z", "2026-01-02T01:00:00Z", 1100),  # republished: this one wins
                row("2026-01-02T00:30:00Z", "2026-01-02T01:00:00Z", 1200),
                row("2026-01-03T00:00:00Z", "2026-01-03T00:30:00Z", 1300),  # at the (exclusive) end
            ],
        )

    df = ingest.fetch_actuals(client(handler))

    # Settlement dates are UK-local, so the end date is fetched too; WIND only.
    assert requests == [{"settlementDateFrom": ["2026-01-02"], "settlementDateTo": ["2026-01-03"], "fuelType": ["WIND"]}]
    assert df["startTime"].tolist() == [pd.Timestamp("2026-01-02T00:00Z"), pd.Timestamp("2026-01-02T00:30Z")]
    assert df["generation"].tolist() == [1100, 1200]
    assert str(df["startTime"].dt.tz) == "UTC"


# ---------- Forecasts (WINDFOR) ----------


def test_forecasts_are_fetched_in_weekly_publish_windows_and_boundary_repeats_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingest, "FORECASTS_START", utc("2026-01-01T00:00Z"))
    monkeypatch.setattr(ingest, "FORECASTS_END", utc("2026-01-10T00:00Z"))
    windows: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        q = parse_qs(request.url.query.decode())
        windows.append((q["publishDateTimeFrom"][0], q["publishDateTimeTo"][0]))
        # The API's "to" is inclusive, so a run published on the boundary comes back twice.
        boundary = {"publishTime": "2026-01-08T00:00:00Z", "startTime": "2026-01-09T00:00:00Z", "generation": 5000}
        if windows[-1][0] == "2026-01-01T00:00:00Z":
            return httpx.Response(
                200,
                json=[
                    {"publishTime": "2026-01-02T08:00:00Z", "startTime": "2026-01-03T00:00:00Z", "generation": 4000},
                    boundary,
                ],
            )
        return httpx.Response(200, json=[boundary])

    df = ingest.fetch_forecasts(client(handler))

    assert windows == [("2026-01-01T00:00:00Z", "2026-01-08T00:00:00Z"), ("2026-01-08T00:00:00Z", "2026-01-10T00:00:00Z")]
    assert len(df) == 2
    assert df["publishTime"].tolist() == [pd.Timestamp("2026-01-02T08:00Z"), pd.Timestamp("2026-01-08T00:00Z")]


def test_an_empty_response_fails_loudly() -> None:
    with pytest.raises(RuntimeError, match="no rows"):
        ingest.normalise([], "publishTime", utc("2026-01-01T00:00Z"), utc("2026-01-02T00:00Z"), key=["publishTime", "startTime"])


# ---------- Retries ----------


def test_server_errors_and_rate_limits_are_retried_with_backoff(no_sleep: list[float]) -> None:
    statuses = iter([503, 429, 200])

    def handler(request: httpx.Request) -> httpx.Response:
        status = next(statuses)
        return httpx.Response(status, json=[{"ok": True}] if status == 200 else {"error": "busy"})

    assert ingest.get_json(client(handler), "/datasets/WINDFOR/stream", {}) == [{"ok": True}]
    assert no_sleep == [1.0, 2.0]


def test_connection_errors_are_retried() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(200, json=[])

    assert ingest.get_json(client(handler), "/datasets/FUELHH/stream", {}) == []
    assert attempts == 2


def test_client_errors_are_not_retried(no_sleep: list[float]) -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(400, json={"error": "bad request"})

    with pytest.raises(httpx.HTTPStatusError):
        ingest.get_json(client(handler), "/datasets/FUELHH/stream", {})
    assert (attempts, no_sleep) == (1, [])


def test_retries_stop_after_the_last_attempt(no_sleep: list[float]) -> None:
    with pytest.raises(httpx.HTTPStatusError):
        ingest.get_json(client(lambda request: httpx.Response(502)), "/datasets/FUELHH/stream", {})
    assert no_sleep == [1.0, 2.0, 4.0, 8.0]  # MAX_ATTEMPTS = 5: four waits, then give up


# ---------- The window covers January's purchase decisions ----------


def test_the_snapshot_window_covers_decisions_made_in_january_2026() -> None:
    """Decisions on D-1 = 1..31 Jan are for delivery 2 Jan..1 Feb; the last runs that
    can inform them are published on 31 Jan."""
    assert ingest.ACTUALS_START == utc("2026-01-02T00:00Z")
    assert ingest.ACTUALS_END == utc("2026-02-02T00:00Z")
    assert ingest.FORECASTS_END == utc("2026-02-01T00:00Z")
