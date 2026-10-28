import pandas as pd
import pytest

from app.selection import latest_at_gate, latest_by_horizon


def utc(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def forecasts(*rows: tuple[str, str, float]) -> pd.DataFrame:
    """A WINDFOR-shaped frame from (publishTime, startTime, generation) rows."""
    df = pd.DataFrame(rows, columns=["publishTime", "startTime", "generation"])
    for col in ("publishTime", "startTime"):
        df[col] = pd.to_datetime(df[col], utc=True, format="ISO8601")
    return df


def pick(result: pd.DataFrame, start: str) -> pd.Series:
    """The single selected row for one target startTime."""
    rows = result[result["startTime"] == utc(start)]
    assert len(rows) == 1
    return rows.iloc[0]


def assert_gap(row: pd.Series) -> None:
    assert pd.isna(row["publishTime"])
    assert pd.isna(row["generation"])


class TestLatestByHorizon:
    def test_publish_exactly_at_cutoff_is_eligible(self) -> None:
        fc = forecasts(
            ("2026-01-10T07:00Z", "2026-01-10T12:00Z", 100),
            ("2026-01-10T08:00Z", "2026-01-10T12:00Z", 200),  # exactly 4h ahead
            ("2026-01-10T08:01Z", "2026-01-10T12:00Z", 300),  # 1 min too late
        ).assign(dataset="WINDFOR")

        result = latest_by_horizon(fc, 4)

        assert list(result.columns) == ["startTime", "publishTime", "generation"]
        row = pick(result, "2026-01-10T12:00Z")
        assert row["publishTime"] == utc("2026-01-10T08:00Z")
        assert row["generation"] == 200

    @pytest.mark.parametrize(
        ("horizon_h", "expected_publish", "expected_generation"),
        [
            (0, "2026-01-10T10:00Z", 4),
            (2, "2026-01-10T10:00Z", 4),  # boundary
            (4, "2026-01-10T06:00Z", 3),
            (7, "2026-01-10T04:00Z", 2),
            (10, "2026-01-10T02:00Z", 1),  # boundary
            (1.5, "2026-01-10T10:00Z", 4),
        ],
    )
    def test_multiple_revisions_pick_latest_eligible(
        self, horizon_h: float, expected_publish: str, expected_generation: float
    ) -> None:
        start = "2026-01-10T12:00Z"
        fc = forecasts(  # deliberately unsorted
            ("2026-01-10T06:00Z", start, 3),
            ("2026-01-10T02:00Z", start, 1),
            ("2026-01-10T10:00Z", start, 4),
            ("2026-01-10T04:00Z", start, 2),
        )

        row = pick(latest_by_horizon(fc, horizon_h), start)

        assert row["publishTime"] == utc(expected_publish)
        assert row["generation"] == expected_generation

    def test_target_without_eligible_forecast_is_kept_as_gap(self) -> None:
        fc = forecasts(
            ("2026-01-10T11:00Z", "2026-01-10T13:00Z", 200),  # only 2h ahead
            ("2026-01-10T06:00Z", "2026-01-10T12:00Z", 100),
        )

        result = latest_by_horizon(fc, 4)

        assert list(result["startTime"]) == [utc("2026-01-10T12:00Z"), utc("2026-01-10T13:00Z")]
        assert pick(result, "2026-01-10T12:00Z")["generation"] == 100
        assert_gap(pick(result, "2026-01-10T13:00Z"))

    def test_explicit_targets_with_no_forecasts_are_kept_as_gaps(self) -> None:
        fc = forecasts(("2026-01-10T06:00Z", "2026-01-10T12:00Z", 100))
        targets = pd.to_datetime(["2026-01-10T12:30Z", "2026-01-10T12:00Z"], utc=True)

        result = latest_by_horizon(fc, 4, targets=targets)

        assert list(result["startTime"]) == [utc("2026-01-10T12:00Z"), utc("2026-01-10T12:30Z")]
        assert pick(result, "2026-01-10T12:00Z")["generation"] == 100
        assert_gap(pick(result, "2026-01-10T12:30Z"))


class TestLatestAtGate:
    @pytest.mark.parametrize(
        ("start", "gate_utc"),
        [
            # Winter: London is on GMT, so the gate is 09:20 UTC.
            ("2026-01-15T00:00Z", "2026-01-14T09:20Z"),
            ("2026-01-15T23:30Z", "2026-01-14T09:20Z"),
            # Clocks go forward on Sun 29 Mar 2026 at 01:00 UTC.
            ("2026-03-29T00:30Z", "2026-03-28T09:20Z"),  # 00:30 GMT on the 29th
            ("2026-03-29T22:30Z", "2026-03-28T09:20Z"),  # 23:30 BST, still the 29th
            ("2026-03-29T23:00Z", "2026-03-29T08:20Z"),  # 00:00 BST on the 30th; gate is 09:20 BST
            # Clocks go back on Sun 25 Oct 2026 at 01:00 UTC.
            ("2026-10-24T23:00Z", "2026-10-24T08:20Z"),  # 00:00 BST on the 25th
            ("2026-10-25T23:30Z", "2026-10-24T08:20Z"),  # 23:30 GMT, still the 25th
            ("2026-10-26T00:00Z", "2026-10-25T09:20Z"),  # 00:00 GMT on the 26th
        ],
    )
    def test_gate_is_0920_london_on_day_before_and_exclusive(self, start: str, gate_utc: str) -> None:
        gate = utc(gate_utc)
        just_before = gate - pd.Timedelta(minutes=1)
        fc = forecasts(
            (just_before.isoformat(), start, 1),
            (gate.isoformat(), start, 2),  # published at the gate, not before it
        )

        row = pick(latest_at_gate(fc), start)

        assert row["publishTime"] == just_before
        assert row["generation"] == 1

    def test_multiple_revisions_pick_latest_before_gate(self) -> None:
        start = "2026-01-15T12:00Z"  # gate: 2026-01-14 09:20 UTC
        fc = forecasts(
            ("2026-01-14T05:30Z", start, 2),
            ("2026-01-13T22:30Z", start, 1),
            ("2026-01-14T11:30Z", start, 4),  # after the gate
            ("2026-01-14T08:30Z", start, 3),
            ("2026-01-15T02:30Z", start, 5),  # after the gate
        )

        row = pick(latest_at_gate(fc), start)

        assert row["publishTime"] == utc("2026-01-14T08:30Z")
        assert row["generation"] == 3

    def test_target_without_eligible_forecast_is_kept_as_gap(self) -> None:
        fc = forecasts(
            ("2026-01-14T08:30Z", "2026-01-15T12:00Z", 1),
            ("2026-01-15T09:30Z", "2026-01-16T12:00Z", 2),  # after the 15th's gate
        )

        result = latest_at_gate(fc)

        assert list(result["startTime"]) == [utc("2026-01-15T12:00Z"), utc("2026-01-16T12:00Z")]
        assert pick(result, "2026-01-15T12:00Z")["generation"] == 1
        assert_gap(pick(result, "2026-01-16T12:00Z"))

    @pytest.mark.parametrize(
        ("start", "gate", "gate_utc"),
        [
            ("2026-07-15T12:00Z", "12:00", "2026-07-14T11:00Z"),  # BST
            # D is 30 Mar; a 00:30 gate on the 29th falls before that day's clock change.
            ("2026-03-29T23:00Z", "00:30", "2026-03-29T00:30Z"),
        ],
    )
    def test_custom_gate(self, start: str, gate: str, gate_utc: str) -> None:
        just_before = utc(gate_utc) - pd.Timedelta(minutes=1)
        fc = forecasts(
            (just_before.isoformat(), start, 1),
            (utc(gate_utc).isoformat(), start, 2),
        )

        row = pick(latest_at_gate(fc, gate=gate), start)

        assert row["publishTime"] == just_before
