import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import audit, auth, calendar, demo, planner, settings, tasks
from app.core.config import get_settings
from app.core.database import init_db
from app.core.security import require_csrf_header

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("wispex")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


config = get_settings()
app = FastAPI(
    title="Wispex Work Copilot API",
    version="0.1.0",
    lifespan=lifespan,
    # Interactive docs are handy in development but not exposed in production
    docs_url=None if config.is_production else "/api/docs",
    openapi_url=None if config.is_production else "/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in config.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Requested-With"],
)


@app.middleware("http")
async def security_headers_and_timing(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = "no-store"  # API data can be sensitive, never cache it
    if config.cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # Log method, path template and timing only. Never bodies or query values.
    logger.info("%s %s %s %.0fms id=%s", request.method, request.url.path, response.status_code, elapsed_ms, request_id)
    return response


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse({"message": exc.detail}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    problems = []
    for err in exc.errors()[:5]:
        field = ".".join(str(p) for p in err["loc"] if p not in ("body", "query"))
        problems.append(f"{field}: {err['msg']}" if field else err["msg"])
    return JSONResponse({"message": "Please check the form. " + "; ".join(problems)}, status_code=422)


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    # Technical details stay in the server log. The user gets a safe, friendly message.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        {"message": "Something went wrong. Nothing was marked as completed. Please try again."},
        status_code=500,
    )


protected = [Depends(require_csrf_header)]
for router in (auth.router, demo.router, tasks.router, planner.router, settings.router, calendar.router, audit.router):
    app.include_router(router, prefix="/api", dependencies=protected)


@app.get("/api/health")
def health():
    return {"status": "ok", "environment": config.app_env}
