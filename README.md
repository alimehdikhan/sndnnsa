# GB Wind Forecast Monitor

_Working title._ Compares Elexon's published GB wind generation forecast (WINDFOR)
with actual wind outturn (FUELHH) for January 2026.

- **Decision view** replays the forecast that was available at a gate time (09:20,
  09:50 or 15:30 UK time on the day before delivery) against what the wind actually did
  that day. It names the forecast run used, and its error strip shares a crosshair
  with the main chart.
- **Accuracy view** scores the forecast across 2–31 January: MAE, bias, the P90
  over-forecast buffer, and error by horizon (0–48 h), by hour of day and by size, plus
  the five worst misses.

![Decision view, dark theme](docs/screenshots/decision-dark.png)

![Accuracy view, light theme](docs/screenshots/accuracy-light.png)

## Findings (January 2026)

Scored on the 720 on-the-hour periods with both a forecast and an outturn. Mean
outturn over those hours is 11.5 GW.

| Gate (day before) | MAE | Bias | RMSE | P90 buffer | Hours over-forecast |
| --- | --- | --- | --- | --- | --- |
| 09:20 | 2,058 MW (18.0%) | +1,772 MW | 2,532 MW | 4,373 MW | 84% |
| 09:50 | 2,035 MW (17.8%) | +1,759 MW | 2,535 MW | 4,438 MW | 84% |
| 15:30 | 1,930 MW (16.9%) | +1,730 MW | 2,387 MW | 4,020 MW | 85% |

1. **The forecast runs high almost all the time.** At every gate it over-forecasts in
   about five hours out of six. At 09:20 it averages 13.2 GW against 11.5 GW of outturn,
   15% high. Only 4 of the 30 delivery days have a negative daily bias.
2. **The offset doesn't shrink with lead time, so it isn't weather uncertainty.** A
   forecast published just 1 hour ahead is still +1.5 GW high (MAE 1.73 GW). The
   constant bias accounts for about half of the squared error (49% at 09:20, 53% at
   15:30). Meanwhile the shape is right: forecast and outturn correlate at 0.93. This
   points to a level difference between the two datasets, which this analysis doesn't
   resolve (see Caveats).
3. **Error grows steadily with horizon:**

   | Published ahead | MAE | P90 buffer |
   | --- | --- | --- |
   | 1 h | 1.73 GW | 3.6 GW |
   | 24 h | 1.98 GW | 4.1 GW |
   | 48 h | 2.34 GW | 5.2 GW |

   At 48 h only 570 hours can be scored, because not every run reaches that far.
4. **A later gate helps a little; 09:50 doesn't.** Moving from 09:20 to 15:30 lowers
   MAE by 128 MW and the P90 buffer by 353 MW. At 09:50, MAE is 23 MW lower but the
   buffer is 65 MW higher.
5. **Early morning is worst.** At the 09:20 gate, MAE peaks at 04:00–06:00
   (2.45–2.48 GW) and is lowest at 21:00–22:00 (1.76–1.80 GW).
6. **The worst misses come from one run, on one night.** The five largest errors fall
   on 12 Jan 00:00–04:00, all from the run published 11 Jan 07:30: about 20.8 GW
   forecast against 14.1 GW actual, so +6.5 to +6.9 GW. By day, 28 Jan is the worst
   (11.1 GW forecast against 5.8 GW actual, MAE 5.3 GW), then 11 and 12 Jan (MAE
   4.9 GW).
7. **What it means for planning.** Relying on the 09:20 forecast in January, holding
   back about 4.4 GW would have covered 90% of the over-forecast hours; at 15:30 the
   figure is 4.0 GW. Most of that buffer is the steady offset. With the month's mean
   bias removed, the remaining error has a standard deviation of about 1.8 GW at 09:20.

## Method

- **Gate selection.** For each target hour, the latest run published *strictly before*
  the gate (Europe/London) on the day before the target's UK delivery day. Day
  arithmetic is done on London wall-clock time, so a clock change between D-1 and D
  can't move the gate.
- **Horizon selection.** The latest run published at least *h* hours before the target
  (`publishTime ≤ startTime − h`).
- **Scoring.** Error is forecast − actual, so positive means over-forecast. Forecasts
  are hourly and actuals half-hourly. Only on-the-hour periods are paired, so 720 of the
  1,440 half-hours are scored. Missing values stay missing: they are counted in
  coverage and excluded from every metric, never interpolated.
- **P90 buffer.** The 90th percentile of the over-forecasts only: the margin that would
  have covered 90% of the hours where the forecast came in too high.

The rules live in `backend/app/selection.py` and `backend/app/metrics.py`, with
hand-computed tests, including the gate boundary, DST and missing data.

## How it works

The API loads the parquet snapshot once and serves it compactly
(`GET /api/dataset`, about 50 KB gzipped). The browser computes every selection and
metric itself (`frontend/src/lib/engine.ts`), so after the first load no interaction
touches the network.

- Controls update on the same frame as the input.
- Charts follow in a React transition, keeping the previous view on screen meanwhile.
- The engine is checked against the backend's own answers, so the two can't drift:
  - `npm test` replays a fixture of backend outputs, including a dataset that spans
    the March clock change.
  - `make parity` compares every view the running API serves on the real data.

## Layout

- `backend/`: Python 3.11+, FastAPI, pandas, pytest. Ingest, selection, metrics and
  the API.
- `frontend/`: React, Vite, TypeScript, Tailwind CSS, shadcn/ui, Recharts, TanStack
  Query, Vitest. The icon set in `src/components/glyphs.tsx` is drawn for this app.
- `backend/data/`: the January 2026 snapshot (parquet, about 120 KB). It is committed,
  so the app runs without network access.

## Getting started

Requires Python 3.11 or newer, Node.js 20.19+ (or 22.12+), and GNU Make.

```sh
make install        # backend/.venv + frontend node_modules
make dev            # API on http://localhost:8000 (docs at /docs), UI on http://localhost:5173
make test           # pytest, then frontend type-check, lint and engine tests
make refresh-data   # optional: re-fetch the snapshot from Elexon into backend/data/
```

The API is ready about a second after it starts. It builds the snapshot first and
prepares every other response in the background. If port 5173 is taken, Vite picks the
next free one and prints it.

To analyse another window, change the dates in `backend/app/ingest.py` and run
`make refresh-data`. The UI takes its date range from the data.

Production: `make serve` builds the frontend, then serves it and the API from one
origin on http://localhost:8000.

### Using it

Each view's selection is in the URL, and Back/Forward step through pages:

```text
/decision?day=2026-01-12&gate=09:50
/accuracy?mode=gate&gate=15:30
/accuracy?mode=horizon&h=12
```

| Key | Action |
| --- | --- |
| `←` / `→` | Decision: previous/next day. Accuracy: horizon −1/+1 h, or previous/next gate in gate mode |
| `Shift` + `←` / `→` | A week, or 6 hours |
| `Home` / `End` | First/last day, or horizon 0/48 h |
| `1` `2` `3` | Gate 09:20 / 09:50 / 15:30 |
| `G` / `H` | Accuracy: score by gate / by horizon |
| `D` / `A` | Decision / Accuracy view |
| `?` | Show all shortcuts |

The day buttons repeat while held. Hovering the hour-of-day chart highlights the same
hour in the three KPI sparklines, and the reverse also works.

## Checks

| Command | What it checks |
| --- | --- |
| `make test` | Backend: 99 pytest tests. Frontend: type-check, lint, 30 engine tests |
| `make parity` | The engine against every API view on the real data (needs `make serve`) |
| `make engine-fixture` | Regenerates the engine fixture after a rule change |
| `make bench` / `make size` / `make lighthouse` | API p50/p95, the 180 KB initial-JS budget, Lighthouse CI |

CI (`.github/workflows/ci.yml`) runs the tests, the size budget and Lighthouse.
Measurements are in [PERFORMANCE.md](PERFORMANCE.md). The reasoning behind the
choices, written as the questions a reviewer would ask, is in
[docs/DECISIONS.md](docs/DECISIONS.md).

## Deploy

**Vercel: static, no server.** Import the repository in Vercel; `vercel.json` sets
everything:
- It runs `npm run build:static`.
- It serves `frontend/dist`.
- It sends deep links such as `/decision?...` to the app.

The static build reads the committed snapshot (`backend/data/snapshot.json`) instead of
the API, so it needs no Python. `make refresh-data` regenerates that file, and a test
fails if it ever drifts from the parquet. Trade-off: the `/api/*` endpoints and `/docs`
aren't available there.

**Docker: the full app, API included.**

```sh
docker build -t gb-wind-forecast .
docker run --rm -p 8000:8000 gb-wind-forecast   # http://localhost:8000, API docs at /docs
```

The image honours `$PORT` and has a health check. `render.yaml` deploys it as a Render
web service (New → Blueprint). It uses about 140 MB of memory.

## Caveats

- **Bias.** Across January the forecast sits well above outturn: about +1.8 GW at
  the 09:20 gate. This analysis doesn't establish why. Candidates are:
  - curtailment, where FUELHH records metered output after constraint actions and the
    forecast doesn't;
  - differences in which wind units each dataset covers.

  The app reports the bias and doesn't attribute it.
- **Pairing.** Hourly forecasts are compared only with the on-the-hour half-hour of
  outturn.
- **Data.** Elexon BMRS Insights Solution API, datasets FUELHH (fuel type `WIND`) and
  WINDFOR. Times are shown in UK local time; January is GMT throughout.

## API

```text
GET /api/health
GET /api/dataset                                      (the snapshot the UI computes from)
GET /api/meta
GET /api/actuals?start&end
GET /api/forecast/gate?day=YYYY-MM-DD&gate=09:20|09:50|15:30
GET /api/forecast/horizon?h=0..48&start&end
GET /api/metrics?mode=gate|horizon&gate&h
GET /api/view/decision?day=YYYY-MM-DD&gate=09:20      (one Decision view, precomputed)
GET /api/view/accuracy?mode=gate|horizon&gate         (one Accuracy view, precomputed)
```

Responses carry a weak ETag for the data snapshot and `Cache-Control: max-age=3600`,
and are gzipped.
