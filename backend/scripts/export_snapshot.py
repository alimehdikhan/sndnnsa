"""Write the snapshot the UI computes from (the body of GET /api/dataset) to
backend/data/snapshot.json, for the static deployment, which has no API (see
vercel.json and `npm run build:static`). `make refresh-data` runs this after fetching;
tests/test_dataset.py fails if the committed file falls out of step with the parquet.

    python scripts/export_snapshot.py
"""

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app import dataset, views  # noqa: E402

OUT = dataset.DATA_DIR / "snapshot.json"


def main() -> None:
    body = views.to_json(views.snapshot(dataset.load()))
    OUT.write_bytes(body)
    print(f"wrote {OUT.relative_to(BACKEND.parent)} ({len(body) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
