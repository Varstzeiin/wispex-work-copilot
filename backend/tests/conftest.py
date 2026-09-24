import os
import tempfile

# Configure a throwaway database BEFORE the app modules are imported
_tmpdir = tempfile.mkdtemp(prefix="wispex-test-")
# TEST_DATABASE_URL runs the same suite against PostgreSQL (the production database)
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{_tmpdir}/test.db"
os.environ["APP_ENV"] = "test"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"
os.environ["GOOGLE_CLIENT_ID"] = ""
os.environ["GOOGLE_CLIENT_SECRET"] = ""
os.environ["GOOGLE_REDIRECT_URI"] = ""
# Tests never download or run the embedding model. Semantic tests inject a deterministic embedder.
os.environ["SEMANTIC_SEARCH"] = "off"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.database import Base, engine  # noqa: E402
from app.core.security import ai_rate_limiter, auth_rate_limiter, demo_rate_limiter, send_rate_limiter  # noqa: E402
from app.main import app  # noqa: E402

CSRF = {"X-Requested-With": "wispex"}

# Completing a task requires every item of the (default) personal final checklist
from app.models.document import DEFAULT_FINAL_CHECKLIST  # noqa: E402

COMPLETE = {"status": "COMPLETED", "confirm_verified": True, "checklist_confirmed": list(DEFAULT_FINAL_CHECKLIST)}


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    from app import models  # noqa: F401
    from app.ai.provider import set_provider
    from app.storage.backends import LocalEncryptedStorage, set_storage

    set_storage(LocalEncryptedStorage(str(tmp_path / "storage")))
    set_provider(None)  # document AI disabled unless a test enables it
    from app.ai import embeddings

    embeddings.reset()  # keyword search only unless a test injects an embedder
    from app.integrations.outbound import set_outbound

    set_outbound(None, None)  # no real email or webhook in tests
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    auth_rate_limiter.reset()
    demo_rate_limiter.reset()
    ai_rate_limiter.reset()
    send_rate_limiter.reset()
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
