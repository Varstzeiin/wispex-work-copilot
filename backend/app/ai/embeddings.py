"""Local text embeddings for search by meaning.

The model runs inside the API process (ONNX via fastembed). Knowledge text never leaves the server,
so semantic search needs no AI permission and also works for demo accounts.

The model loads when the server starts, before requests are served. If it cannot load, search falls
back to keyword matching and the UI says so.

Pre-download for offline servers:  python -m app.ai.embeddings download
"""

import logging
import math
import sys
import threading
import time
from typing import Optional, Protocol

from app.core.config import get_settings

logger = logging.getLogger("wispex.embeddings")

# Minimum cosine similarity for a "same meaning" match. Model specific: checked on the demo notes for
# the default model. For another model, set SEMANTIC_MIN_SIMILARITY after checking with your own notes.
DEFAULT_MIN_SIMILARITY = {
    "sentence-transformers/all-MiniLM-L6-v2": 0.30,
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2": 0.40,
}


class Embedder(Protocol):
    name: str
    min_similarity: float

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Unit-length vectors, one per text."""
        ...


def _unit(vector) -> list[float]:
    values = [float(x) for x in vector]
    norm = math.sqrt(sum(x * x for x in values)) or 1.0
    return [x / norm for x in values]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))  # both are unit length


class FastEmbedEmbedder:
    def __init__(self, model_name: str, model_path: str = "", cache_dir: str = "", min_similarity: float = 0.0):
        from fastembed import TextEmbedding

        kwargs = {"specific_model_path": model_path} if model_path else {}
        if cache_dir:
            kwargs["cache_dir"] = cache_dir
        self.model = TextEmbedding(model_name, **kwargs)
        self.name = model_name
        self.min_similarity = min_similarity or DEFAULT_MIN_SIMILARITY.get(model_name, 0.35)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [_unit(v) for v in self.model.embed(texts, batch_size=32)]


_embedder: Optional[Embedder] = None
_status = "OFF"  # OFF | LOADING | READY | UNAVAILABLE
_lock = threading.Lock()


def _load() -> None:
    global _embedder, _status
    s = get_settings()
    try:
        embedder = FastEmbedEmbedder(
            s.embedding_model, s.embedding_model_path, s.embedding_cache_dir, s.semantic_min_similarity
        )
        embedder.embed(["warm up"])
        _embedder, _status = embedder, "READY"
        logger.info("Semantic search ready (%s)", s.embedding_model)
    except Exception as exc:  # missing package, no network for the download, broken files
        _status = "UNAVAILABLE"
        logger.warning("Semantic search unavailable, using keyword search only: %s", type(exc).__name__)


def preload() -> None:
    """Load the model at server start, before any request is served.

    Loading imports large native libraries and builds the ONNX session, which can hold the Python
    GIL. Inside a running server that froze every request for seconds on a cold start, so the
    model is loaded here instead. If it fails, the server still starts with keyword search.
    """
    global _status
    if get_settings().semantic_search != "local" or _embedder is not None:
        return
    with _lock:
        _status = "LOADING"
    started = time.perf_counter()
    _load()
    logger.info("Semantic search start-up took %.1fs (%s)", time.perf_counter() - started, _status)


def get_embedder() -> Optional[Embedder]:
    """The embedder when ready. Normally preloaded at start-up (see preload); if not, the first call
    starts loading it in the background and search uses keywords until it is ready."""
    global _status
    if _embedder is not None or _status in ("UNAVAILABLE", "LOADING"):
        return _embedder
    if get_settings().semantic_search != "local":
        return None
    with _lock:
        if _status == "OFF":
            _status = "LOADING"
            threading.Thread(target=_load, name="embedding-loader", daemon=True).start()
    return _embedder


def status() -> str:
    get_embedder()
    if get_settings().semantic_search != "local" and _embedder is None:
        return "OFF"
    return _status


def set_embedder(embedder: Optional[Embedder]) -> None:
    """Inject an embedder (tests), or None to disable semantic search."""
    global _embedder, _status
    _embedder = embedder
    _status = "READY" if embedder is not None else "UNAVAILABLE"


def reset() -> None:
    """Back to the configured behaviour (the next call loads the model again)."""
    global _embedder, _status
    _embedder, _status = None, "OFF"


def _download() -> int:
    """Fetch the configured model into EMBEDDING_CACHE_DIR, so the server can run without internet."""
    s = get_settings()
    try:
        FastEmbedEmbedder(s.embedding_model, s.embedding_model_path, s.embedding_cache_dir).embed(["ok"])
    except Exception as exc:
        print(f"Could not load {s.embedding_model}: {exc}", file=sys.stderr)
        return 1
    print(f"{s.embedding_model} is ready in {s.embedding_cache_dir or 'the default cache'}")
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["download"]:
        sys.exit(_download())
    print("Usage: python -m app.ai.embeddings download", file=sys.stderr)
    sys.exit(2)
