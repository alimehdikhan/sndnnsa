from collections.abc import Iterator

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.dataset import Dataset, load
from app.main import create_app


def utc(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


HOURS = pd.date_range("2026-01-10", periods=48, freq="1h", tz="UTC")  # 10 Jan 00:00 .. 11 Jan 23:00

# Each forecast run has a constant generation, so a value identifies the run it came from.
RUNS = [
    ("2026-01-09T08:00Z", 1000, HOURS[:12]),  # only covers 10 Jan 00:00-11:00
    ("2026-01-09T09:30Z", 2000, HOURS),
    ("2026-01-10T08:00Z", 3000, HOURS),
    ("2026-01-10T09:40Z", 4000, HOURS),
    ("2026-01-10T12:00Z", 5000, HOURS),
    ("2026-01-10T16:00Z", 6000, HOURS),
]


def build_dataset() -> Dataset:
    # One extra half-hour at 12 Jan 00:00, outside the window, which build() should trim.
    half_hours = pd.date_range("2026-01-10", "2026-01-12", freq="30min", tz="UTC")
    actuals = pd.DataFrame({"startTime": half_hours, "generation": [1500 if t.day == 10 else 5000 for t in half_hours]})
    forecasts = pd.concat(
        pd.DataFrame({"publishTime": utc(published), "startTime": hours, "generation": float(generation)})
        for published, generation, hours in RUNS
    )
    return Dataset.build(actuals, forecasts, utc("2026-01-10T00:00Z"), utc("2026-01-12T00:00Z"))


DATASET = build_dataset()


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(create_app(load=lambda: DATASET)) as c:
        yield c


def generations(body: dict) -> list[float | None]:
    return [p["generation"] for p in body["points"]]


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_meta_describes_the_snapshot(client: TestClient) -> None:
    response = client.get("/api/meta")

    assert response.status_code == 200
    assert response.json() == {
        "start": "2026-01-10T00:00:00Z",
        "end": "2026-01-12T00:00:00Z",
        "refreshedAt": None,  # synthetic data has no files behind it
        "actualRows": 96,
        "forecastRuns": 6,
    }


def test_dataset_is_loaded_once_at_startup() -> None:
    calls = 0

    def counting_load() -> Dataset:
        nonlocal calls
        calls += 1
        return DATASET

    with TestClient(create_app(load=counting_load)) as c:
        assert calls == 1  # before any request
        c.get("/api/actuals")
        c.get("/api/metrics", params={"mode": "gate"})

    assert calls == 1


def test_requests_never_recompute(monkeypatch) -> None:
    import app.views

    fresh = build_dataset()  # its own cache, untouched by other tests
    with TestClient(create_app(load=lambda: fresh, frontend_dist=None)) as c:
        c.app.state.precompute.join()  # the background warm-up has filled the cache
        calls = 0
        real_evaluate = app.views.evaluate

        def counting_evaluate(*args, **kwargs):
            nonlocal calls
            calls += 1
            return real_evaluate(*args, **kwargs)

        monkeypatch.setattr(app.views, "evaluate", counting_evaluate)
        for h in (0, 6, 48):
            c.get("/api/metrics", params={"mode": "horizon", "h": h})
        for gate in ("09:20", "09:50", "15:30"):
            c.get("/api/metrics", params={"mode": "gate", "gate": gate})
            c.get("/api/view/accuracy", params={"mode": "gate", "gate": gate})
            c.get("/api/view/decision", params={"day": "2026-01-11", "gate": gate})
        c.get("/api/view/accuracy", params={"mode": "horizon"})

    assert calls == 0  # everything above was built at startup


def test_startup_serves_the_snapshot_at_once_and_warms_the_rest_in_the_background() -> None:
    fresh = build_dataset()
    with TestClient(create_app(load=lambda: fresh, frontend_dist=None)) as c:
        # Built before the app accepted requests:
        assert {("json", "dataset"), ("json", "meta"), ("gzip", "dataset")} <= set(fresh._memo)
        c.app.state.precompute.join(timeout=60)
        assert not c.app.state.precompute.is_alive()
        assert ("json", "view-accuracy", "horizon") in fresh._memo


def test_serves_even_when_startup_hooks_never_run() -> None:
    """Serverless runtimes may skip the lifespan; the first request loads the data."""
    fresh = build_dataset()
    c = TestClient(create_app(load=lambda: fresh, frontend_dist=None, warm_up=False))  # no `with`: no lifespan

    assert c.get("/api/dataset").status_code == 200
    assert c.get("/api/view/decision", params={"day": "2026-01-10", "gate": "09:20"}).status_code == 200
    assert c.get("/api/meta").headers["etag"] == f'W/"{fresh.version}"'


def test_startup_precomputes_every_fixed_response() -> None:
    from app.views import precompute

    fresh = build_dataset()
    precompute(fresh)

    json_keys = {key[1:] for key in fresh._memo if key[0] == "json"}
    gates = ("09:20", "09:50", "15:30")
    days = (pd.Timestamp("2026-01-10").date(), pd.Timestamp("2026-01-11").date())
    assert {("metrics", "gate", g) for g in gates} <= json_keys
    assert {("metrics", "horizon", h) for h in range(49)} <= json_keys
    assert {("view-decision", d, g) for d in days for g in gates} <= json_keys
    assert {("view-accuracy", "gate", g) for g in gates} | {("view-accuracy", "horizon")} <= json_keys


class TestHttpCaching:
    def test_data_routes_carry_snapshot_etag(self, client: TestClient) -> None:
        response = client.get("/api/actuals")

        assert response.headers["cache-control"] == "no-cache"  # revalidate with the ETag every time
        assert response.headers["etag"] == f'W/"{DATASET.version}"'

    def test_matching_if_none_match_returns_304(self, client: TestClient) -> None:
        etag = client.get("/api/view/accuracy", params={"mode": "gate"}).headers["etag"]

        response = client.get("/api/view/accuracy", params={"mode": "gate"}, headers={"If-None-Match": etag})

        assert response.status_code == 304
        assert response.content == b""
        assert response.headers["etag"] == etag

    def test_stale_etag_gets_the_full_response(self, client: TestClient) -> None:
        response = client.get("/api/meta", headers={"If-None-Match": 'W/"something-else"'})

        assert response.status_code == 200
        assert response.json()["actualRows"] == 96

    def test_health_and_errors_are_not_cached(self, client: TestClient) -> None:
        assert "etag" not in client.get("/api/health").headers
        assert "etag" not in client.get("/api/view/decision", params={"day": "2026-01-01"}).headers

    def test_snapshot_version_follows_the_data(self) -> None:
        other = build_dataset()
        changed = Dataset.build(
            other.actuals.assign(generation=other.actuals["generation"] + 1), other.forecasts, other.start, other.end
        )

        assert other.version == DATASET.version
        assert changed.version != DATASET.version


class TestDecisionView:
    def test_bundles_the_day(self, client: TestClient) -> None:
        body = client.get("/api/view/decision", params={"day": "2026-01-11", "gate": "09:20"}).json()

        assert (body["day"], body["gate"]) == ("2026-01-11", "09:20")
        assert len(body["actuals"]) == 48
        assert len(body["forecast"]) == 24
        assert {p["generation"] for p in body["forecast"]} == {3000.0}
        assert body["runs"] == ["2026-01-10T08:00:00Z"]
        assert (body["hoursForecast"], body["hoursTotal"]) == (24, 24)
        assert body["leadMin"] == 16.0  # 08:00 run -> 11 Jan 00:00
        assert body["leadMax"] == 39.0  # -> 11 Jan 23:00
        # Forecast 3000 against actual 5000 every hour: under by 2000, never over.
        assert body["kpis"]["mae"] == 2000.0
        assert body["kpis"]["bias"] == -2000.0
        assert body["kpis"]["maxOver"] is None

    def test_reports_gaps_and_largest_over_forecast(self, client: TestClient) -> None:
        body = client.get("/api/view/decision", params={"day": "2026-01-10", "gate": "09:50"}).json()

        # 09:30 run on 9 Jan (2000) against actual 1500: over by 500 every hour.
        assert body["kpis"]["maxOver"] == {"value": 500.0, "startTime": "2026-01-10T00:00:00Z"}
        assert (
            body["kpis"]["p90Over"]
            == client.get("/api/metrics", params={"mode": "gate", "gate": "09:50"}).json()["summary"]["p90Over"]
        )

    def test_matches_the_granular_routes(self, client: TestClient) -> None:
        bundle = client.get("/api/view/decision", params={"day": "2026-01-10", "gate": "09:20"}).json()
        forecast = client.get("/api/forecast/gate", params={"day": "2026-01-10", "gate": "09:20"}).json()
        actuals = client.get("/api/actuals", params={"start": "2026-01-10T00:00:00Z", "end": "2026-01-11T00:00:00Z"}).json()

        assert bundle["forecast"] == forecast["points"]
        assert bundle["actuals"] == actuals["points"]


class TestAccuracyView:
    def test_gate_mode_matches_metrics(self, client: TestClient) -> None:
        bundle = client.get("/api/view/accuracy", params={"mode": "gate", "gate": "09:20"}).json()
        metrics = client.get("/api/metrics", params={"mode": "gate", "gate": "09:20"}).json()

        (selection,) = bundle["selections"]
        assert selection["key"] == "09:20"
        assert selection["summary"] == metrics["summary"]
        assert selection["byHour"] == metrics["byHour"]
        assert selection["worst"] == metrics["worst"]
        assert bundle["byHorizon"] == metrics["byHorizon"]

    def test_histogram_is_prebinned_and_scatter_is_compact(self, client: TestClient) -> None:
        (selection,) = client.get("/api/view/accuracy", params={"mode": "gate", "gate": "09:20"}).json()["selections"]

        # Errors: -500 (12 hours) and -2000 (24 hours), in 500 MW bands centred on 0.
        bins = {b["center"]: b["count"] for b in selection["histogram"]}
        assert bins == {-2000: 24, -1500: 0, -1000: 0, -500: 12, 0: 0}
        assert selection["scatterTotal"] == 36
        assert len(selection["scatter"]) == 36
        assert selection["scatter"][0] == [0, 1500, 1000]  # 10 Jan 00:00: actual 1500, forecast 1000

    def test_horizon_mode_returns_every_horizon(self, client: TestClient) -> None:
        bundle = client.get("/api/view/accuracy", params={"mode": "horizon"}).json()

        assert [s["key"] for s in bundle["selections"]] == [str(h) for h in range(49)]
        h24 = bundle["selections"][24]
        assert h24["summary"] == client.get("/api/metrics", params={"mode": "horizon", "h": 24}).json()["summary"]

    def test_scatter_is_capped(self) -> None:
        from app.views import MAX_SCATTER_POINTS, scatter

        many = pd.DataFrame(
            {
                "startTime": pd.date_range("2026-01-10", periods=4000, freq="30min", tz="UTC"),
                "actual": 1.0,
                "forecast": 2.0,
            }
        )
        assert len(scatter(DATASET, many)) <= MAX_SCATTER_POINTS


class TestStaticFrontend:
    @pytest.fixture
    def dist(self, tmp_path):
        (tmp_path / "assets").mkdir()
        (tmp_path / "index.html").write_text("<!doctype html><title>app</title>")
        (tmp_path / "favicon.svg").write_text("<svg/>")
        (tmp_path / "assets" / "app-abc123.js").write_text("console.log('plain')")
        (tmp_path / "assets" / "app-abc123.js.br").write_bytes(b"brotli-bytes")
        (tmp_path / "assets" / "app-abc123.js.gz").write_bytes(b"gzip-bytes")
        return tmp_path

    def test_assets_are_immutable_and_precompressed(self, dist) -> None:
        def headers(c: TestClient, accept: str):
            # Stream so the test client doesn't try to decode the placeholder bytes.
            with c.stream("GET", "/assets/app-abc123.js", headers={"Accept-Encoding": accept}) as r:
                return r.headers

        with TestClient(create_app(load=lambda: DATASET, frontend_dist=dist)) as c:
            br = headers(c, "gzip, br")
            gz = headers(c, "gzip")
            plain = c.get("/assets/app-abc123.js", headers={"Accept-Encoding": "identity"})

        assert br["cache-control"] == "public, max-age=31536000, immutable"
        assert br["content-encoding"] == "br"
        assert gz["content-encoding"] == "gzip"
        assert "content-encoding" not in plain.headers
        assert plain.text == "console.log('plain')"
        assert plain.headers["content-type"].startswith(("application/javascript", "text/javascript"))

    def test_pages_serve_index_without_caching(self, dist) -> None:
        with TestClient(create_app(load=lambda: DATASET, frontend_dist=dist)) as c:
            page = c.get("/accuracy")
            missing_api = c.get("/api/nope")
            escape = c.get("/assets/../index.html")

        assert page.status_code == 200
        assert page.headers["cache-control"] == "no-cache"
        assert "<title>app</title>" in page.text
        assert missing_api.status_code == 404
        assert escape.headers.get("cache-control") != "public, max-age=31536000, immutable"


def test_large_responses_are_gzipped(client: TestClient) -> None:
    response = client.get("/api/view/accuracy", params={"mode": "gate"}, headers={"Accept-Encoding": "gzip"})

    assert response.headers["content-encoding"] == "gzip"


def test_load_says_how_to_fetch_missing_data(tmp_path) -> None:
    with pytest.raises(FileNotFoundError, match="make refresh-data"):
        load(tmp_path)


class TestActuals:
    def test_defaults_to_the_whole_window(self, client: TestClient) -> None:
        body = client.get("/api/actuals").json()

        assert body["start"] == "2026-01-10T00:00:00Z"
        assert body["end"] == "2026-01-12T00:00:00Z"
        assert len(body["points"]) == 96  # the out-of-window half-hour was trimmed
        assert body["points"][0] == {"startTime": "2026-01-10T00:00:00Z", "generation": 1500.0}

    def test_range_is_half_open(self, client: TestClient) -> None:
        body = client.get("/api/actuals", params={"start": "2026-01-11T01:00:00Z", "end": "2026-01-11T02:00:00Z"}).json()

        assert [p["startTime"] for p in body["points"]] == ["2026-01-11T01:00:00Z", "2026-01-11T01:30:00Z"]

    @pytest.mark.parametrize(
        "start",
        [
            "2026-01-11",  # date only: midnight UTC
            "2026-01-11T00:00:00",  # no offset: UTC
            "2026-01-11T01:00:00+01:00",
        ],
    )
    def test_start_is_normalised_to_utc(self, client: TestClient, start: str) -> None:
        body = client.get("/api/actuals", params={"start": start}).json()

        assert body["start"] == "2026-01-11T00:00:00Z"
        assert body["points"][0]["startTime"] == "2026-01-11T00:00:00Z"


class TestForecastAtGate:
    @pytest.mark.parametrize(
        ("gate", "generation", "published"),
        [
            ("09:20", 3000, "2026-01-10T08:00:00Z"),
            ("09:50", 4000, "2026-01-10T09:40:00Z"),
            ("15:30", 5000, "2026-01-10T12:00:00Z"),
        ],
    )
    def test_picks_latest_run_before_gate_on_previous_day(
        self, client: TestClient, gate: str, generation: float, published: str
    ) -> None:
        body = client.get("/api/forecast/gate", params={"day": "2026-01-11", "gate": gate}).json()

        assert body["day"] == "2026-01-11"
        assert body["gate"] == gate
        assert (body["start"], body["end"]) == ("2026-01-11T00:00:00Z", "2026-01-12T00:00:00Z")
        assert len(body["points"]) == 24
        assert set(generations(body)) == {generation}
        assert {p["publishTime"] for p in body["points"]} == {published}

    def test_gate_defaults_to_0920(self, client: TestClient) -> None:
        body = client.get("/api/forecast/gate", params={"day": "2026-01-11"}).json()

        assert body["gate"] == "09:20"
        assert set(generations(body)) == {3000}

    def test_hours_without_an_eligible_forecast_are_null(self, client: TestClient) -> None:
        # Before 09:20 on 9 Jan only the 08:00 run exists, and it stops at 11:00.
        body = client.get("/api/forecast/gate", params={"day": "2026-01-10"}).json()

        assert len(body["points"]) == 24
        assert generations(body) == [1000.0] * 12 + [None] * 12
        assert body["points"][12] == {"startTime": "2026-01-10T12:00:00Z", "publishTime": None, "generation": None}


class TestForecastAtHorizon:
    def test_returns_hourly_points_for_the_window(self, client: TestClient) -> None:
        body = client.get("/api/forecast/horizon", params={"h": 24}).json()

        assert body["h"] == 24
        assert len(body["points"]) == 48

    @pytest.mark.parametrize(
        ("h", "start", "generation"),
        [
            (24, "2026-01-11T12:00:00Z", 5000.0),  # 12:00 run is exactly 24h ahead
            (25, "2026-01-11T12:00:00Z", 4000.0),
            (0, "2026-01-11T12:00:00Z", 6000.0),
            (24, "2026-01-10T05:00:00Z", None),  # nothing published by 9 Jan 05:00
        ],
    )
    def test_picks_latest_run_at_least_h_ahead(self, client: TestClient, h: int, start: str, generation: float | None) -> None:
        end = (utc(start) + pd.Timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        body = client.get("/api/forecast/horizon", params={"h": h, "start": start, "end": end}).json()

        assert [p["startTime"] for p in body["points"]] == [start]
        assert generations(body) == [generation]


class TestMetrics:
    def test_gate_mode(self, client: TestClient) -> None:
        body = client.get("/api/metrics", params={"mode": "gate", "gate": "09:20"}).json()

        assert (body["mode"], body["gate"], body["h"]) == ("gate", "09:20", None)
        # Pairs: 10 Jan 00:00-11:00 from the 1000 run (actual 1500, e = -500) and every
        # hour of 11 Jan from the 3000 run (actual 5000, e = -2000). Half-hours and
        # 10 Jan 12:00-23:00 have no forecast.
        assert body["coverage"] == {"rows": 96, "missingForecast": 60, "missingActual": 0, "pairs": 36}
        summary = body["summary"]
        assert summary["n"] == 36
        assert summary["mae"] == pytest.approx(1500.0)  # (12 * 500 + 24 * 2000) / 36
        assert summary["bias"] == pytest.approx(-1500.0)
        assert summary["nOver"] == 0
        assert summary["p90Over"] is None  # NaN in pandas, null in JSON
        assert [row["hour"] for row in body["byHour"]] == list(range(24))
        assert [row["horizonH"] for row in body["byHorizon"]] == list(range(1, 49))
        assert [m["startTime"] for m in body["worst"]] == [f"2026-01-11T0{i}:00:00Z" for i in range(5)]
        assert body["worst"][0]["absError"] == 2000.0
        assert len(body["pairs"]) == 36
        assert body["pairs"][0] == {
            "startTime": "2026-01-10T00:00:00Z",
            "publishTime": "2026-01-09T08:00:00Z",
            "forecast": 1000.0,
            "actual": 1500.0,
            "error": -500.0,
            "absError": 500.0,
        }

    def test_horizon_mode(self, client: TestClient) -> None:
        body = client.get("/api/metrics", params={"mode": "horizon", "h": 24}).json()

        assert (body["mode"], body["gate"], body["h"]) == ("horizon", None, 24)
        # 10 Jan: 08:00-09:00 from the 08:00 run on 9 Jan, 10:00-23:00 from the 09:30 run.
        # 11 Jan: every hour (the 09:30 run on 9 Jan covers it all).
        assert body["summary"]["n"] == 16 + 24

    def test_gate_changes_the_result(self, client: TestClient) -> None:
        early = client.get("/api/metrics", params={"mode": "gate", "gate": "09:20"}).json()
        late = client.get("/api/metrics", params={"mode": "gate", "gate": "15:30"}).json()

        assert early["summary"]["mae"] != late["summary"]["mae"]


@pytest.mark.parametrize(
    ("path", "params", "bad_param"),
    [
        ("/api/actuals", {"start": "2026-01-09T23:30:00Z"}, "start"),
        ("/api/actuals", {"end": "2026-01-12T00:30:00Z"}, "end"),
        ("/api/actuals", {"start": "2026-01-11T00:00:00Z", "end": "2026-01-11T00:00:00Z"}, "end"),
        ("/api/actuals", {"start": "yesterday"}, "start"),
        ("/api/forecast/gate", {}, "day"),
        ("/api/forecast/gate", {"day": "2026-01-09"}, "day"),
        ("/api/forecast/gate", {"day": "2026-01-12"}, "day"),
        ("/api/forecast/gate", {"day": "11/01/2026"}, "day"),
        ("/api/forecast/gate", {"day": "2026-01-11", "gate": "10:00"}, "gate"),
        ("/api/forecast/horizon", {}, "h"),
        ("/api/forecast/horizon", {"h": -1}, "h"),
        ("/api/forecast/horizon", {"h": 49}, "h"),
        ("/api/forecast/horizon", {"h": 1.5}, "h"),
        ("/api/forecast/horizon", {"h": 24, "start": "2026-01-01T00:00:00Z"}, "start"),
        ("/api/metrics", {}, "mode"),
        ("/api/metrics", {"mode": "both"}, "mode"),
        ("/api/metrics", {"mode": "horizon"}, "h"),
        ("/api/metrics", {"mode": "horizon", "h": 49}, "h"),
        ("/api/metrics", {"mode": "gate", "gate": "09:30"}, "gate"),
    ],
)
def test_invalid_input_is_rejected(client: TestClient, path: str, params: dict, bad_param: str) -> None:
    response = client.get(path, params=params)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["query", bad_param]


class TestDatasetSnapshot:
    def test_round_trips_to_every_forecast_and_actual_row(self, client: TestClient) -> None:
        body = client.get("/api/dataset").json()
        origin = utc(body["start"])

        rows = [
            (origin + pd.Timedelta(seconds=run["publish"]), origin + pd.Timedelta(seconds=first + 3600 * i), mw)
            for run in body["runs"]
            for first, values in run["segments"]
            for i, mw in enumerate(values)
        ]
        expected = DATASET.forecasts.sort_values(["publishTime", "startTime"])
        assert rows == list(zip(expected["publishTime"], expected["startTime"], expected["generation"].astype(int), strict=True))
        assert [origin + pd.Timedelta(seconds=s) for s in body["actualTimes"]] == list(DATASET.actuals["startTime"])
        assert body["actualMw"] == DATASET.actuals["generation"].astype(int).tolist()
        assert body["version"] == DATASET.version
        assert body["end"] == "2026-01-12T00:00:00Z"

    def test_a_missing_hour_starts_a_new_segment(self, client: TestClient) -> None:
        body = client.get("/api/dataset").json()

        # Run R1 covers only 10 Jan 00:00-11:00: one segment of 12 hours from the start.
        first_run = body["runs"][0]
        assert first_run["segments"] == [[0, [1000] * 12]]

    def test_is_precomputed_and_served_gzipped_with_the_snapshot_etag(self, client: TestClient) -> None:
        response = client.get("/api/dataset", headers={"Accept-Encoding": "gzip"})

        assert response.headers["content-encoding"] == "gzip"
        assert response.headers["etag"] == f'W/"{DATASET.version}"'
        assert ("json", "dataset") in DATASET._memo
