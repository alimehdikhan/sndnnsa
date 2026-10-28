"""Vercel's Python entry point: the FastAPI app, reading the JSON snapshot.

vercel.json routes /api/*, /docs and /openapi.json here and serves the built frontend
for everything else. The function ships without pyarrow (see requirements.txt), so it
loads backend/data/snapshot.json rather than the parquet files; tests check both give
identical responses. Locally, from the repository root: uvicorn api.index:app
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.dataset import load_json
from app.main import create_app

# Serverless instances are short-lived: each request computes and caches its own response.
app = create_app(load=load_json, frontend_dist=None, warm_up=False)
