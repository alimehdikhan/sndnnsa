# Design decisions

Why the project is built the way it is, written as the questions a reviewer is likely
to ask.

## The analysis

**Why "latest run *strictly before* the gate, on D-1"?**
That's the forecast a decision-maker could actually have held at the gate. A run
published at 09:20:00 isn't usable at a 09:20 gate, so the comparison is strict. The
gate is a London wall-clock time on the day before the target's UK delivery day.
Computing it on wall-clock time, rather than as "UTC minus 24 h", keeps a clock change
between D-1 and D from shifting it by an hour. `tests/test_selection.py` covers the
boundary and the DST case.

**Why not interpolate the hourly forecast to half-hours?**
Interpolation would score a value nobody published. Only the on-the-hour half-hours are
paired (744 of 1,488). The other 744 are counted as "missing forecast" and reported in
coverage, never scored. The chart draws a line through the hourly points for
readability, but the tooltip says "Forecasts are hourly" between them.

**What is the P90 buffer, exactly?**
The 90th percentile of the error, taken over the hours the forecast was too high. Read
it as: holding back this much would have covered 90% of the over-forecast hours. It's a
planning number, not a confidence interval.

**Why is the bias +1.7 GW, and why doesn't the app explain it?**
Because the data can't settle it, and an unsupported cause would be the one thing a
domain reviewer would rightly attack. What the data does show:
- The bias barely changes with lead time: +1.5 GW at 1 h ahead, +1.7 GW at 24 h.
- It is about half the squared error.
- Forecast and outturn still correlate at 0.93.

That is a level difference, not forecasting skill. Plausible causes:
- **Curtailment.** FUELHH is metered output after constraint actions; the forecast is
  closer to what the wind could have produced.
- **Coverage.** The two datasets may count different wind units.

The next step would be comparing against bid-offer acceptances (BOALF) for wind BM
units. That's out of scope here, so the README flags it as a caveat.

**Why these metrics?**
Each answers a different question:
- MAE: how big a typical miss is, in MW.
- Bias: which way the forecast leans.
- RMSE: how much large misses dominate.
- nMAE: size relative to output.
- Percentiles of absolute error: the tails.
- P90 of over-forecasts: the buffer.

Percentiles use linear interpolation, as numpy's default does. Undefined values are
null, never zero. Examples: any metric over no pairs, the P90 buffer when nothing was
over-forecast.

## The architecture

**Why compute everything in the browser when there's an API?**
For speed and robustness on a live walkthrough. The snapshot is small (1,488 actuals,
19,272 forecast rows, 49 KB gzipped). The browser loads it once and computes any day,
gate or horizon in a few milliseconds, so controls respond on the next frame and
nothing waits on the network. If the API goes down mid-demo, the page keeps working.

**Then why keep the per-view API endpoints?**
They are the reference implementation and they're useful on their own (`/docs`). More
importantly, they make the browser engine checkable:
- `npm test` replays the backend's answers on two synthetic snapshots, one spanning a
  DST change.
- `make parity` compares every view the API serves on the real data: 93 Decision
  views, 3 gates and 49 horizons, to a relative tolerance of 1e-9.

Two implementations with an automated equality check are safer than one implementation
nobody can cross-examine.

**Why pandas on the backend and hand-written TypeScript in the browser?**
pandas makes the rules short and readable (`selection.py` is a merge and a filter), and
it's what an analyst would review. The browser can't run pandas, so the engine re-states
the same rules with binary searches over sorted arrays. It also matches numpy's details:
linear percentiles, round-half-to-even and stable tie-breaking.

**Why does startup only build the snapshot?**
The UI needs nothing else. The API is ready in about 1.2 s, mostly Python imports, and
every other response is precomputed in a background thread over the next few seconds.
A request that arrives first computes and caches its own answer.

**Why ETags and gzip on a local app?**
Repeat visits cost a 304 instead of a download, and the snapshot travels as 49 KB
instead of 137 KB. Both are cheap to get right and they matter once the app is
deployed.

## The interface

**Why does the URL change as you click?**
A presenter can link straight to a view (`/decision?day=2026-01-12&gate=09:50`). Back
and Forward step between pages; stepping through days replaces the history entry, so
it isn't flooded.

**How do the controls stay instant while charts take ~100–250 ms to draw?**
There are two copies of the view state. The controls and URL update on the input's own
frame. The charts follow in a React transition, which keeps the previous view on screen
and drops intermediate states when input keeps arriving. Charts and numbers animate
between selections, except during a burst (a held key, a dragged slider), when they
jump instead of trailing behind.

**Why only two colours in the charts?**
Sky means what actually happened, and under-forecasts. Amber means what was forecast,
and over-forecasts. Everything else is neutral, and red is kept for errors. The pair
passes colour-blind separation checks in both themes. The P90 buffer is hatched, so it
reads as uncertainty rather than as a third series.

## Limits, stated plainly

- One month of decisions: those made in January 2026, for delivery 2 Jan – 1 Feb (all
  GMT). The rules handle DST and the UI takes its date range from the data, but only
  this window has been analysed.
- Results are in-sample: the buffer and bias describe January. They aren't a validated
  forecast correction.
- To analyse another window, change `ACTUALS_START`/`ACTUALS_END` and the forecast range
  in `backend/app/ingest.py`, then run `make refresh-data`.
