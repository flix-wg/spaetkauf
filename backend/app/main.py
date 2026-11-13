import asyncio
import contextlib

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from . import __version__, board, stations, trips
from .config import REPO_ROOT, Settings
from .db import init_db
from .loop import run_loop
from .transitous import BudgetSpent, SourceUnavailable, Transitous

DIST = REPO_ROOT / "frontend" / "dist"


def create_app(
    settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None
) -> FastAPI:
    settings = settings or Settings.from_env()
    init_db(settings.db_path)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(run_loop(app)) if settings.loop else None
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await app.state.transitous.aclose()

    app = FastAPI(title="Spätkauf", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.transitous = Transitous(settings, transport)

    @app.exception_handler(BudgetSpent)
    async def _budget(request: Request, exc: BudgetSpent):
        return JSONResponse({"detail": "Limit reached for today"}, status_code=429)

    @app.exception_handler(SourceUnavailable)
    async def _down(request: Request, exc: SourceUnavailable):
        return JSONResponse({"detail": "Live source unavailable"}, status_code=503)

    @app.get("/api/health")
    def health(request: Request):
        tr = request.app.state.transitous
        return {
            "ok": True,
            "version": __version__,
            "sources": {
                "transitous": {None: "unknown", True: "ok", False: "unavailable"}[tr.last_ok],
                "exa": "configured" if settings.exa_key else "missing",
                "context": "configured" if settings.context_key else "missing",
            },
            "plan_budget_left": tr.budget_left(),
        }

    app.include_router(stations.router)
    app.include_router(trips.router)
    app.include_router(board.router)

    if DIST.is_dir():
        root = DIST.resolve()

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith(("api/", "hooks/")) or path in ("api", "hooks"):
                raise HTTPException(404)
            target = (root / path).resolve()
            if path and target.is_file() and root in target.parents:
                return FileResponse(target)
            return FileResponse(root / "index.html")

    return app


app = create_app()
