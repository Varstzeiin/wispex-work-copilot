"""Entry point for Vercel's Python runtime, which looks for an `app` object here.

Other hosts start the server with: uvicorn app.main:app
"""

from app.main import app

__all__ = ["app"]
