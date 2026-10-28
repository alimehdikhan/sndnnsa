import math

import pandas as pd
import pytest

from app.metrics import error_by_horizon, error_by_hour, evaluate, join, summarise, worst_misses


def utc(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def frame(columns: list[str], rows: list[tuple]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=columns)
    for col in ("publishTime", "startTime"):
        if col in df:
            df[col] = pd.to_datetime(df[col], utc=True, format="ISO8601")
    return df.astype({"generation": "float64"})


def selected(*rows: tuple[str, str | None, float | None]) -> pd.DataFrame:
    """Selection output from (startTime, publishTime, forecast); None marks a gap."""
    return frame(["startTime", "publishTime", "generation"], list(rows))


def actuals(*rows: tuple[str, float | None]) -> pd.DataFrame:
    return frame(["startTime", "generation"], list(rows))


def forecasts(*rows: tuple[str, str, float]) -> pd.DataFrame:
    """Raw WINDFOR runs from (publishTime, startTime, generation)."""
    return frame(["publishTime", "startTime", "generation"], list(rows))


PUB = "2026-01-09T20:00Z"

# Five scored pairs with errors +10, -10, +30, 0, -40, plus three unscorable rows.
SELECTED = selected(
    ("2026-01-10T00:00Z", PUB, 110),
    ("2026-01-10T01:00Z", PUB, 90),
    ("2026-01-10T02:00Z", PUB, 130),
    ("2026-01-10T03:00Z", PUB, 100),
    ("2026-01-10T04:00Z", PUB, 60),
    ("2026-01-10T05:00Z", None, None),  # selection gap
    ("2026-01-10T06:00Z", PUB, 50),  # no actual row
    ("2026-01-10T07:00Z", PUB, 80),  # actual is NaN
)
ACTUALS = actuals(
    ("2026-01-10T00:00Z", 100),
    ("2026-01-10T01:00Z", 100),
    ("2026-01-10T02:00Z", 100),
    ("2026-01-10T03:00Z", 100),
    ("2026-01-10T04:00Z", 100),
    ("2026-01-10T05:00Z", 400),  # unscored, so must not move mean actual
    ("2026-01-10T07:00Z", None),
)


class TestEvaluate:
    def test_coverage_counts_each_kind_of_missing_row(self) -> None:
        assert evaluate(SELECTED, ACTUALS).coverage == {
            "rows": 8,
            "missing_forecast": 1,
            "missing_actual": 2,
            "pairs": 5,
        }

    def test_summary_matches_hand_computed_values(self) -> None:
        # errors e = [10, -10, 30, 0, -40]; |e| sorted = [0, 10, 10, 30, 40]
        # Linear percentile of |e| sits at position q * (n - 1) = q * 4.
        assert evaluate(SELECTED, ACTUALS).summary == pytest.approx(
            {
                "n": 5,
                "mae": 18.0,  # 90 / 5
                "rmse": math.sqrt(540),  # (100 + 100 + 900 + 0 + 1600) / 5 = 540
                "bias": -2.0,  # -10 / 5
                "nmae": 0.18,  # 18 / mean([100] * 5)
                "p50_abs": 10.0,  # position 2
                "p90_abs": 36.0,  # position 3.6: 30 + 0.6 * (40 - 30)
                "p95_abs": 38.0,  # position 3.8: 30 + 0.8 * (40 - 30)
                "n_over": 2,  # +10, +30
                "p90_over": 28.0,  # over [10, 30], position 0.9: 10 + 0.9 * 20
            }
        )

    def test_worst_misses_rank_by_absolute_error_and_skip_unscorable_rows(self) -> None:
        worst = evaluate(SELECTED, ACTUALS).worst

        # |e| ties at 10 between 00:00 and 01:00 go to the earlier startTime.
        assert list(worst["startTime"]) == [
            utc("2026-01-10T04:00Z"),
            utc("2026-01-10T02:00Z"),
            utc("2026-01-10T00:00Z"),
            utc("2026-01-10T01:00Z"),
            utc("2026-01-10T03:00Z"),
        ]
        assert list(worst["error"]) == [-40, 30, 10, -10, 0]
        assert list(worst.columns) == ["startTime", "publishTime", "forecast", "actual", "error", "abs_error"]

    def test_pairs_are_the_scorable_rows(self) -> None:
        pairs = evaluate(SELECTED, ACTUALS).pairs

        assert list(pairs["startTime"]) == [utc(f"2026-01-10T0{h}:00Z") for h in range(5)]
        assert list(pairs["error"]) == [10, -10, 30, 0, -40]

    def test_worst_misses_returns_at_most_n(self) -> None:
        worst = worst_misses(join(SELECTED, ACTUALS), n=2)

        assert list(worst["abs_error"]) == [40, 30]


class TestMissingAndUndefined:
    def test_no_pairs_gives_nan_metrics(self) -> None:
        sel = selected(("2026-01-10T00:00Z", None, None))
        act = actuals(("2026-01-10T00:00Z", 100))

        summary = summarise(join(sel, act))

        assert summary["n"] == 0
        assert summary["n_over"] == 0
        for key in ("mae", "rmse", "bias", "nmae", "p50_abs", "p90_abs", "p95_abs", "p90_over"):
            assert math.isnan(summary[key]), key

    def test_no_over_forecasts_gives_nan_buffer(self) -> None:
        sel = selected(("2026-01-10T00:00Z", PUB, 90), ("2026-01-10T01:00Z", PUB, 100))
        act = actuals(("2026-01-10T00:00Z", 100), ("2026-01-10T01:00Z", 100))

        summary = summarise(join(sel, act))

        assert summary["n_over"] == 0
        assert math.isnan(summary["p90_over"])
        assert summary["mae"] == 5.0  # (10 + 0) / 2

    def test_zero_mean_actual_gives_nan_nmae(self) -> None:
        sel = selected(("2026-01-10T00:00Z", PUB, 10))
        act = actuals(("2026-01-10T00:00Z", 0))

        summary = summarise(join(sel, act))

        assert summary["mae"] == 10.0
        assert math.isnan(summary["nmae"])

    @pytest.mark.parametrize("side", ["selected", "actuals"])
    def test_duplicate_start_times_are_rejected(self, side: str) -> None:
        sel = selected(("2026-01-10T00:00Z", PUB, 10))
        act = actuals(("2026-01-10T00:00Z", 10))
        dup = {"selected": sel, "actuals": act}
        dup[side] = pd.concat([dup[side], dup[side]])

        with pytest.raises(ValueError, match=side):
            join(dup["selected"], dup["actuals"])


class TestErrorByHour:
    def test_hours_are_europe_london_and_all_24_are_returned(self) -> None:
        # July, so London is UTC+1: 23:00 and 23:30 UTC on 1 Jul are hour 0 in London.
        sel = selected(
            ("2026-07-01T23:00Z", PUB, 110),  # hour 0, e = +10
            ("2026-07-01T23:30Z", PUB, 70),  # hour 0, e = -30
            ("2026-07-02T00:00Z", PUB, 120),  # hour 1, e = +20
            ("2026-07-02T05:00Z", None, None),  # hour 6, gap
        )
        act = actuals(
            ("2026-07-01T23:00Z", 100),
            ("2026-07-01T23:30Z", 100),
            ("2026-07-02T00:00Z", 100),
            ("2026-07-02T05:00Z", 100),
        )

        by_hour = error_by_hour(join(sel, act)).set_index("hour")

        assert list(by_hour.index) == list(range(24))
        assert by_hour.loc[0, "n"] == 2
        assert by_hour.loc[0, "mae"] == 20.0  # (10 + 30) / 2
        assert by_hour.loc[0, "bias"] == -10.0  # (10 - 30) / 2
        assert by_hour.loc[0, "rmse"] == pytest.approx(math.sqrt(500))  # (100 + 900) / 2
        assert by_hour.loc[1, ["n", "mae", "bias"]].tolist() == [1, 20.0, 20.0]
        assert by_hour.loc[6, "n"] == 0
        assert math.isnan(by_hour.loc[6, "mae"])
        assert by_hour["n"].sum() == 3  # nothing landed in UTC hour 23


class TestErrorByHorizon:
    def test_each_horizon_scores_latest_forecast_at_least_h_ahead(self) -> None:
        fc = forecasts(
            ("2026-01-10T11:00Z", "2026-01-10T12:00Z", 105),  # 1h ahead,   e = +5
            ("2026-01-10T10:00Z", "2026-01-10T12:00Z", 120),  # 2h ahead,   e = +20
            ("2026-01-10T08:30Z", "2026-01-10T12:00Z", 70),  # 3.5h ahead, e = -30
            ("2026-01-10T11:00Z", "2026-01-10T13:00Z", 190),  # 2h ahead,   e = -10
            ("2026-01-10T08:30Z", "2026-01-10T13:00Z", 260),  # 4.5h ahead, e = +60
        )
        act = actuals(
            ("2026-01-10T12:00Z", 100),
            ("2026-01-10T12:30Z", 150),  # never forecast: excluded from every horizon
            ("2026-01-10T13:00Z", 200),
        )

        result = error_by_horizon(fc, act, horizons=[1, 2, 3, 5]).set_index("horizon_h")

        # h=1: 12:00 -> 11:00 run (+5), 13:00 -> 11:00 run (-10)
        assert result.loc[1, ["n", "mae", "bias"]].tolist() == [2, 7.5, -2.5]
        # h=2: 12:00 -> 10:00 run (+20, exactly 2h ahead), 13:00 -> 11:00 run (-10)
        assert result.loc[2, ["n", "mae", "bias"]].tolist() == [2, 15.0, 5.0]
        # h=3: 12:00 -> 08:30 run (-30), 13:00 -> 08:30 run (+60)
        assert result.loc[3, ["n", "mae", "bias"]].tolist() == [2, 45.0, 15.0]
        assert result.loc[3, "rmse"] == pytest.approx(math.sqrt(2250))  # (900 + 3600) / 2
        # h=5: no run is 5h ahead of either target
        assert result.loc[5, "n"] == 0
        assert math.isnan(result.loc[5, "mae"])
