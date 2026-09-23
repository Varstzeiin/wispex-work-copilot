import os
import tempfile

# Configure a throwaway database BEFORE the app modules are imported
_tmpdir = tempfile.mkdtemp(prefix="wispex-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmpdir}/test.db"
os.environ["APP_ENV"] = "test"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"
os.environ["GOOGLE_CLIENT_ID"] = ""
os.environ["GOOGLE_CLIENT_SECRET"] = ""
os.environ["GOOGLE_REDIRECT_URI"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.database import Base, engine  # noqa: E402
from app.core.security import auth_rate_limiter, demo_rate_limiter  # noqa: E402
from app.main import app  # noqa: E402

CSRF = {"X-Requested-With": "wispex"}


@pytest.fixture(autouse=True)
def fresh_db():
    from app import models  # noqa: F401

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    auth_rate_limiter.reset()
    demo_rate_limiter.reset()
    get_settings.cache_clear()
    yield


def make_client() -> TestClient:
    return TestClient(app, headers=CSRF)


def register(client: TestClient, email: str = "user@example.com", password: str = "a-long-password") -> dict:
    response = client.post("/api/auth/register", json={"email": email, "password": password, "full_name": "Test"})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def client() -> TestClient:
    c = make_client()
    register(c)
    return c
