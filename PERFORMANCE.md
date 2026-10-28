# Performance

## Latest: every view computed in the browser

The UI now fetches one compact snapshot (`/api/dataset`: 137 KB raw, 47 KB gzipped)
and computes selections and metrics locally (`frontend/src/lib/engine.ts`). Charts
render in a React transition, so controls never wait for them. Measured in real-time
headless Chrome against the production build. Each figure is the median of 5–6
actions, timed from the input event to the painted frame.

| Interaction | Control updated | View updated | Network requests |
|---|---|---|---|
| Decision: next-day button | 41 ms | 103 ms | 0 |
| Decision: ← key | 32 ms | 80 ms | 0 |
| Decision: gate key / segment click | 36–40 ms | 91–92 ms | 0 |
| Accuracy: → key, horizon +1 h | 32 ms | 255 ms | 0 |
| Accuracy: held ← key (auto-repeat, 1.8 s) | kept pace | intermediate frames skipped; longest frame 150 ms | 0 |
| Switching page (D/A keys) | — | 270–285 ms | 0 |

- Lighthouse on `/decision`: 99–100, LCP 705–716 ms, CLS 0, TBT 52–94 ms (the CI
  budget is 150 ms).
- Initial JS: 101.3 KB gzipped (budget 180 KB).
- No loading skeleton appears after the first load.

The sections below record the earlier optimisation pass, when each view was a
precomputed API response.


Measured on a Windows 11 laptop against localhost, same machine before and after.

- **Bundle sizes:** gzip level 9 of the production build (`npm run size`).
- **Lighthouse:** v12, desktop preset, performance only, median of 3 runs per page. Before: the build served by `vite preview`. After: the build served by FastAPI (`make serve`).
- **API:** 50 sequential requests per route with `Accept-Encoding: gzip` (`make bench`). The "before" API already included an in-process response memo from an earlier change.
- **Interactions:** real-time headless Chrome. Time from click or key press to the changed text being painted, median of 10–15 actions.

## Bundle

| | Before | After |
|---|---|---|
| Initial JS (entry + modulepreloads), gzip | 263.1 KB | **96.1 KB** |
| Initial CSS, gzip | 11.3 KB | 11.3 KB |
| JS for the Decision route at load, gzip | 263.1 KB | 250.5 KB |
| JS for the Accuracy route at load, gzip | 263.1 KB | 252.6 KB |
| Calendar code (date picker), gzip | in main bundle | 21.5 KB, loaded when idle or on first open |
| Font files that can be downloaded | 7 subsets (~218 KB) | 1 Latin file (48 KB); none on Apple devices |

Route JS is the entry plus that page's chunk, the shared chart chunk and Recharts. Recharts (111.5 KB) is the largest remaining piece. Both pages draw charts, so neither route can avoid it.

## Lighthouse (desktop)

| Page | Metric | Before | After | Target (Decision, in CI) |
|---|---|---|---|---|
| Decision | Performance | 99 | **100** | ≥ 95 |
| | LCP | 779 ms | **744 ms** | < 1.5 s |
| | CLS | 0.006 | **0** | < 0.05 |
| | TBT | 9 ms | 18 ms | < 150 ms |
| Accuracy | Performance | 96 | **98** | |
| | LCP | 779 ms | **759 ms** | |
| | CLS | 0.051 | **0** | |
| | TBT | 152 ms | **99 ms** | |

## API response times (ms)

| Route | p50 before | p95 before | p50 after | p95 after |
|---|---|---|---|---|
| `/api/health` | 2.0 | 4.5 | 2.2 | 2.5 |
| `/api/meta` | 3.2 | 4.3 | 2.2 | 2.7 |
| `/api/actuals` | 16.1 | 17.0 | **2.4** | 3.0 |
| `/api/forecast/gate` | 3.4 | 3.8 | 2.9 | 3.6 |
| `/api/forecast/horizon` | 11.0 | 11.9 | **2.4** | 2.9 |
| `/api/metrics?mode=gate` | 15.5 | 16.5 | **2.3** | 2.8 |
| `/api/metrics?mode=horizon` | 15.7 | 17.5 | **2.4** | 2.8 |
| `/api/view/decision` (new) | n/a | n/a | 2.9 | 3.4 |
| `/api/view/accuracy?mode=gate` (new) | n/a | n/a | 2.3 | 2.7 |
| `/api/view/accuracy?mode=horizon` (new, all 49 horizons) | n/a | n/a | 2.4 | 3.0 |

About 2 ms is the floor for a local HTTP round trip here. Repeat visits within an hour don't hit the network at all (`Cache-Control: max-age=3600`). After that, the browser revalidates with the ETag and gets a 304.

## Interactions (production build)

| Interaction | Before | After |
|---|---|---|
| Accuracy: switch gate, control responds | 240 ms | **13 ms** |
| Accuracy: switch gate, charts updated | 240 ms | 237 ms |
| Accuracy: horizon slider step, control responds | debounce + request + render | **27 ms** |
| Accuracy: horizon slider step, charts updated | debounce + request + render | 218 ms, no request |
| Decision: next/previous day | 21 ms | 23 ms |
| Decision: switch gate | 19 ms | 19 ms |

## Not hit, or with trade-offs

- **Decision TBT went from 9 to 18 ms.** It's still far under the 150 ms target. The extra time comes from splitting work across separate chunks.
- **Accuracy charts still take about 220 ms to redraw** after a selection change. The cost is rendering: Recharts redraws four charts, about 720 scatter points among them. Controls now respond within a frame, and chart updates run as interruptible background work, so a moving slider never waits on them. The next step would be drawing the scatter on a canvas.
- **API startup was about 9 s** while every response was precomputed before serving. Now the API serves after building only the snapshot: ready in about 1.2 s, mostly Python imports. The other responses are precomputed in a background thread over the next 7–8 s, and a request that arrives first computes its own.
- **Data cached in browsers can be up to an hour old.** With `max-age=3600`, a browser can keep using its copy for an hour after `make refresh-data` and a restart. The ETag changes with the data, so revalidation then fetches the new version.
- **Two items differ from the brief:**
  - `ORJSONResponse` is deprecated in this FastAPI version. Instead, every response is serialised once at startup with Pydantic and stored, along with a gzipped copy, so routes do no serialisation at all.
  - `vite-plugin-compression` hasn't been released since 2022. The maintained `vite-plugin-compression2` is used instead.
