"""Entry point for Vercel's Python runtime, which looks for an `app` object here.

Other hosts start the server with: uvicorn app.main:app

If the app cannot start (usually a missing or malformed environment variable), a small fallback
app answers every request with what is wrong, instead of the platform's bare "500" page.
"""

import sys
from pathlib import Path

# The `app` package sits next to this file. Some runtimes load this file without putting its
# folder on the import path, which makes `import app` fail.
_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:
    from app.main import app
except Exception as exc:  # pragma: no cover - exercised through _fallback_app in tests
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    def _problem(error: Exception) -> str:
        # Our own start-up checks raise RuntimeError with a safe, fixed message
        if isinstance(error, RuntimeError):
            return str(error)
        if isinstance(error, ModuleNotFoundError):  # a module name is safe to show
            return f"Start-up failed: module '{error.name}' was not found."
        errors = getattr(error, "errors", None)
        if callable(errors):  # pydantic: name the settings, never echo their values
            names = sorted({str(e.get("loc", ["?"])[0]).upper() for e in errors()})
            return f"Invalid environment variable(s): {', '.join(names)}"
        return f"Start-up failed ({type(error).__name__})."

    _message = _problem(exc)
    app = FastAPI()

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def _misconfigured(path: str):
        return JSONResponse({"status": "misconfigured", "problem": _message}, status_code=503)


__all__ = ["app"]
