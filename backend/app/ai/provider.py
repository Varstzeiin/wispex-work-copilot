"""AI provider abstraction.

The rest of the application only talks to `AIProvider`, never to a vendor SDK directly, so the
model or vendor can change without touching business logic. Output is always validated here.
"""

from dataclasses import dataclass, field
from typing import Literal, Optional, Protocol

from pydantic import BaseModel, Field, ValidationError

from app.ai.prompts.extraction import DOCUMENT_TYPES, FIELD_NAMES
from app.core.config import get_settings


class ProviderError(Exception):
    """A user-safe failure message. `retryable` tells the UI whether "Try again" makes sense."""

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class FieldOut(BaseModel):
    value: Optional[str]
    normalized: Optional[str]
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(default="", max_length=300)


class ExtractionOut(BaseModel):
    document_type: Literal["INVOICE", "PACKING_LIST", "BILL_OF_LADING", "AIR_WAYBILL", "OTHER"]
    document_type_confidence: float = Field(ge=0, le=1)
    fields: dict[str, FieldOut]


@dataclass
class ExtractionResult:
    """Validated provider output. `valid=False` means the output could not be trusted at all."""

    valid: bool
    document_type: str = "UNKNOWN"
    document_type_confidence: float = 0.0
    fields: dict[str, FieldOut] = field(default_factory=dict)
    provider: str = ""
    model: str = ""
    problem: str = ""


def validate_output(raw: object, provider: str, model: str) -> ExtractionResult:
    """Never silently accept malformed AI output: anything that fails validation needs review."""
    try:
        parsed = ExtractionOut.model_validate(raw)
    except ValidationError:
        return ExtractionResult(
            valid=False,
            provider=provider,
            model=model,
            problem="The AI output did not match the expected format. Please enter or check the fields manually.",
        )
    unknown = set(parsed.fields) - set(FIELD_NAMES)
    missing = set(FIELD_NAMES) - set(parsed.fields)
    if unknown or missing or parsed.document_type not in DOCUMENT_TYPES:
        return ExtractionResult(
            valid=False,
            provider=provider,
            model=model,
            problem="The AI output was incomplete. Please enter or check the fields manually.",
        )
    return ExtractionResult(
        valid=True,
        document_type=parsed.document_type,
        document_type_confidence=parsed.document_type_confidence,
        fields=parsed.fields,
        provider=provider,
        model=model,
    )


class AIProvider(Protocol):
    name: str

    def extract_document(self, content: bytes, mime_type: str) -> ExtractionResult:
        """Classify the document and extract structured fields with confidence scores."""
        ...


_provider: Optional[AIProvider] = None


def get_provider() -> Optional[AIProvider]:
    """The configured provider, or None when document AI is disabled on this server."""
    global _provider
    if _provider is None:
        name = get_settings().ai_provider
        if name == "anthropic":
            from app.ai.claude_provider import ClaudeProvider

            _provider = ClaudeProvider()
        elif name == "fake":
            from app.ai.fake_provider import FakeProvider

            _provider = FakeProvider()
    return _provider


def set_provider(provider: Optional[AIProvider]) -> None:
    """Inject a provider (tests) or reset to the configured one with None."""
    global _provider
    _provider = provider
