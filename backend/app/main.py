from collections.abc import AsyncIterator, Awaitable, Callable
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.gzip import GZipMiddleware

from app import dataset
from app.api import router
from app.static import DEFAULT_DIST, mount_frontend
from app.views import precompute, precompute_essentials

API_CACHE_CONTROL = "public, max-age=3600"


def create_app(load: Callable[[], dataset.Dataset] = dataset.load, frontend_dist: Path | None = DEFAULT_DIST) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        ds = load()  # once, at startup
        # The UI needs only the snapshot, so serve as soon as that's built (well under a
        # second) and prepare every other response in the background.
        precompute_essentials(ds)
        app.state.dataset = ds
        app.state.precompute = threading.Thread(target=precompute, args=(ds,), name="precompute", daemon=True)
        app.state.precompute.start()
        yield

    app = FastAPI(title="Wind forecast API", lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=500)
    app.middleware("http")(snapshot_caching)
    app.include_router(router)
    if frontend_dist is not None and (frontend_dist / "index.html").is_file():
        mount_frontend(app, frontend_dist)
    return app


async def snapshot_caching(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """Data routes: cacheable for an hour, ETag = the data snapshot's hash, 304 when it matches."""
    path = request.url.path
    if request.method != "GET" or not path.startswith("/api/") or path == "/api/health":
        return await call_next(request)
    etag = f'W/"{request.app.state.dataset.version}"'
    headers = {"ETag": etag, "Cache-Control": API_CACHE_CONTROL}
    if etag in {tag.strip() for tag in request.headers.get("if-none-match", "").split(",")}:
        return Response(status_code=304, headers=headers)
    response = await call_next(request)
    if response.status_code == 200:
        response.headers.update(headers)
    return response


app = create_app()
