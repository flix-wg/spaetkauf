import asyncio
import contextlib

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import (
    __version__,
    board,
    ext,
    history,
    outbound,
    picks,
    push,
    replay,
    signals,
    stations,
    trips,
)
from .config import REPO_ROOT, Settings
from .db import init_db
from .i18n import lang_from, text
from .loop import run_loop
from .transitous import BudgetSpent, OutsideTimetable, SourceUnavailable, Transitous

DIST = REPO_ROOT / "frontend" / "dist"


def create_app(
    settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None
) -> FastAPI:
    settings = settings or Settings.from_env()
    outbound.log_outbound()
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
        if getattr(app.state, "odds", None) is not None:
            app.state.odds.close()
        if getattr(app.state, "history", None) is not None:
            app.state.history.close()

    app = FastAPI(title="Kurt", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.transitous = Transitous(settings, transport)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        detail = text(exc.detail, lang_from(request)) if isinstance(exc.detail, str) else exc.detail
        return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(BudgetSpent)
    async def _budget(request: Request, exc: BudgetSpent):
        return JSONResponse({"detail": text("Limit reached for today", lang_from(request))}, status_code=429)

    @app.exception_handler(OutsideTimetable)
    async def _timetable(request: Request, exc: OutsideTimetable):
        return JSONResponse({"detail": text(str(exc), lang_from(request))}, status_code=400)

    @app.exception_handler(SourceUnavailable)
    async def _down(request: Request, exc: SourceUnavailable):
        return JSONResponse({"detail": text("Live source unavailable", lang_from(request))}, status_code=503)

    @app.get("/api/health")
    def health(request: Request):
        tr = request.app.state.transitous
        return {
            "ok": True,
            "version": __version__,
            "sources": {
                "transitous": {None: "unknown", True: "ok", False: "unavailable"}[tr.last_ok],
                "exa": "configured" if settings.exa_key else "missing",
                "adapter": "configured" if settings.anthropic_key else "missing",
                "context": "configured" if settings.context_key else "missing",
            },
            "plan_budget_left": tr.budget_left(),
        }

    @app.get("/api/legal")
    def legal():
        return {
            "name": settings.operator_name,
            "address": [line.strip() for line in settings.operator_address.split(";") if line.strip()],
            "email": settings.operator_email,
            "hosting": settings.legal_hosting,
            "cdn": settings.legal_cdn,
            "adapter": bool(settings.anthropic_key),
        }

    app.include_router(ext.router)
    app.include_router(stations.router)
    app.include_router(trips.router)
    app.include_router(board.router)
    app.include_router(push.router)
    app.include_router(replay.router)
    app.include_router(picks.router)
    app.include_router(signals.router)
    app.include_router(history.router)

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
