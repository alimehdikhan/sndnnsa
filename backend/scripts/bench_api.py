"""Response-time benchmark: 50 sequential requests per API route, p50/p95 in ms.

Usage: python scripts/bench_api.py [base_url] [--json out.json]
"""

import json
import statistics
import sys
import time
import urllib.request

BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "http://127.0.0.1:8000")
OUT = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
N = 50

ROUTES = [
    "/api/health",
    "/api/meta",
    "/api/actuals",
    "/api/forecast/gate?day=2026-01-12&gate=09:20",
    "/api/forecast/horizon?h=24",
    "/api/metrics?mode=gate&gate=09:20",
    "/api/metrics?mode=horizon&h=24",
    "/api/view/decision?day=2026-01-12&gate=09:20",
    "/api/view/accuracy?mode=gate&gate=09:20",
    "/api/view/accuracy?mode=horizon",
]


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    k = (len(ordered) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


results = {}
for route in ROUTES:
    req = urllib.request.Request(BASE + route, headers={"Accept-Encoding": "gzip"})
    times, size, status = [], 0, None
    try:
        urllib.request.urlopen(req).read()  # warm-up, not timed
        for _ in range(N):
            t0 = time.perf_counter()
            with urllib.request.urlopen(req) as r:
                body = r.read()
                status = r.status
            times.append((time.perf_counter() - t0) * 1000)
            size = len(body)
    except urllib.error.HTTPError as e:
        print(f"{route:52} HTTP {e.code} (route not available)")
        continue
    results[route] = {"p50": round(statistics.median(times), 1), "p95": round(percentile(times, 0.95), 1), "bytes": size}
    print(f"{route:52} p50 {results[route]['p50']:7.1f} ms   p95 {results[route]['p95']:7.1f} ms   {size:>8} B on the wire")

if OUT:
    with open(OUT, "w") as f:
        json.dump(results, f, indent=2)
