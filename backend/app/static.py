"""Serve the built frontend (frontend/dist) from the API's origin.

Hashed files under /assets never change, so they are cached for a year and marked
immutable; the browser gets the pre-compressed .br or .gz written at build time
when its Accept-Encoding allows. index.html is revalidated on every load
(no-cache) so a new build is picked up immediately.
"""

import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse

DEFAULT_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
IMMUTABLE = "public, max-age=31536000, immutable"
PRECOMPRESSED = (("br", ".br"), ("gzip", ".gz"))

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")


def mount_frontend(app: FastAPI, dist: Path) -> None:
    dist = dist.resolve()
    assets = dist / "assets"

    @app.get("/assets/{path:path}", include_in_schema=False)
    def asset(path: str, request: Request) -> FileResponse:
        file = (assets / path).resolve()
        if not file.is_relative_to(assets) or not file.is_file():
            raise HTTPException(status_code=404)
        media_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        headers = {"Cache-Control": IMMUTABLE, "Vary": "Accept-Encoding"}
        accepted = request.headers.get("accept-encoding", "")
        for encoding, suffix in PRECOMPRESSED:
            compressed = file.with_name(file.name + suffix)
            if encoding in accepted and compressed.is_file():
                return FileResponse(compressed, media_type=media_type, headers={**headers, "Content-Encoding": encoding})
        return FileResponse(file, media_type=media_type, headers=headers)

    @app.get("/{path:path}", include_in_schema=False)
    def page(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        file = (dist / path).resolve()
        if path and file.is_file() and file.parent == dist:  # favicon and other root files
            return FileResponse(file, headers={"Cache-Control": "public, max-age=86400"})
        return FileResponse(dist / "index.html", media_type="text/html", headers={"Cache-Control": "no-cache"})
