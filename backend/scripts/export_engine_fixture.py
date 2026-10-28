"""Write the frontend engine's parity fixture: synthetic snapshots plus the backend's own
answers for every Decision and Accuracy view on them.

The frontend computes selections and metrics itself (frontend/src/lib/engine.ts); its
tests replay this fixture so the two implementations can't drift. Re-run after changing
app/selection.py, app/metrics.py or app/views.py:

    python scripts/export_engine_fixture.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app import views  # noqa: E402
from app.dataset import Dataset  # noqa: E402
from tests.test_api import build_dataset  # noqa: E402

OUT = BACKEND.parent / "frontend" / "tests" / "fixtures" / "engine.json"
# A spread of horizons (inclusive/exclusive edges, both ends) keeps the fixture small.
HORIZONS = (0, 1, 2, 6, 12, 17, 24, 25, 36, 47, 48)


def utc(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def dst_dataset() -> Dataset:
    """27-30 March 2026, across the clocks going forward (01:00 UTC on Sunday 29 March).

    Runs publish either side of every gate in both GMT and BST, with varied values, a NaN
    forecast, a run with a missing hour, NaN actuals and an actual with no forecast hour.
    """
    rng = np.random.default_rng(7)
    start, end = utc("2026-03-27T00:00Z"), utc("2026-03-31T00:00Z")
    half_hours = pd.date_range(start, end, freq="30min", inclusive="left")
    actual = rng.integers(2000, 15000, len(half_hours)).astype("float64")
    actual[[5, 6, 100]] = np.nan
    actuals = pd.DataFrame({"startTime": half_hours, "generation": actual})

    frames = []
    for day in pd.date_range("2026-03-25", "2026-03-30", freq="D", tz="UTC"):
        for publish in ("08:15", "08:25", "09:10", "09:25", "09:45", "14:20", "15:35"):
            published = day + pd.Timedelta(f"{publish}:00")
            hours = pd.date_range(published.ceil("h") + pd.Timedelta(hours=1), periods=60, freq="1h")
            generation = rng.integers(1000, 18000, len(hours)).astype("float64")
            frames.append(pd.DataFrame({"publishTime": published, "startTime": hours, "generation": generation}))
    forecasts = pd.concat(frames, ignore_index=True)
    forecasts.loc[17, "generation"] = np.nan  # a forecast row with no value: still the latest, so a gap
    forecasts = forecasts.drop(index=[40, 41]).reset_index(drop=True)  # a run missing two hours
    return Dataset.build(actuals, forecasts, start, end)


def answers(ds: Dataset) -> dict:
    load = lambda model: json.loads(views.to_json(model))  # noqa: E731
    return {
        "snapshot": load(views.snapshot(ds)),
        "decision": {
            f"{day}|{gate}": load(views.decision_view(ds, day, gate)) for day in views.delivery_days(ds) for gate in views.GATES
        },
        "accuracy": {
            **{f"gate|{gate}": load(views.accuracy_view(ds, "gate", gate)) for gate in views.GATES},
            "horizon": _some_horizons(load(views.accuracy_view(ds, "horizon", views.GATES[0]))),
        },
    }


def _some_horizons(view: dict) -> dict:
    return {**view, "selections": {str(h): view["selections"][h] for h in HORIZONS}}


def main() -> None:
    fixture = {"january": answers(build_dataset()), "dst": answers(dst_dataset())}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(BACKEND.parent)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
