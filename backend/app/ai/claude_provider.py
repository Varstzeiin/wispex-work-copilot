"""Claude adapter for document extraction.

Only used when AI_PROVIDER=anthropic and the user has confirmed that their organization permits
sending documents to this provider. Nothing is sent otherwise.
"""

import base64
import json
import logging

import anthropic

from app.ai.prompts.extraction import OUTPUT_SCHEMA, SYSTEM_PROMPT, USER_INSTRUCTION
from app.ai.provider import ExtractionResult, ProviderError, validate_output
from app.core.config import get_settings

logger = logging.getLogger("wispex.ai")

# Server-side fallback: if a safety classifier declines, the API re-runs the request on
# Anthropic's recommended fallback model instead of returning the refusal.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class ClaudeProvider:
    name = "anthropic"

    def __init__(self, client: anthropic.Anthropic | None = None):
        settings = get_settings()
        self.model = settings.ai_model
        # With no explicit key the SDK resolves credentials from the environment (ANTHROPIC_API_KEY, ...)
        self.client = client or anthropic.Anthropic(
            api_key=settings.ai_api_key or None,
            timeout=settings.ai_timeout_seconds,
            max_retries=2,
        )

    def _content_block(self, content: bytes, mime_type: str) -> dict:
        data = base64.standard_b64encode(content).decode("ascii")
        if mime_type == "application/pdf":
            return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}}
        return {"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": data}}

    def extract_document(self, content: bytes, mime_type: str) -> ExtractionResult:
        try:
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                betas=[FALLBACK_BETA],
                fallbacks="default",
                system=SYSTEM_PROMPT,
                output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            self._content_block(content, mime_type),
                            {"type": "text", "text": USER_INSTRUCTION},
                        ],
                    }
                ],
            )
        except anthropic.AuthenticationError as exc:
            logger.error("AI authentication failed")
            raise ProviderError(
                "Document AI is not configured correctly on the server. Please contact the administrator.",
                retryable=False,
            ) from exc
        except anthropic.PermissionDeniedError as exc:
            raise ProviderError("The AI provider refused access for this account.", retryable=False) from exc
        except anthropic.BadRequestError as exc:
            logger.warning("AI rejected the request: %s", exc.message)
            raise ProviderError(
                "This file could not be processed by the AI. Enter the fields manually.", retryable=False
            ) from exc
        except anthropic.RateLimitError as exc:
            raise ProviderError("The AI service is busy. Please try again in a minute.") from exc
        except anthropic.APIStatusError as exc:
            logger.warning("AI provider error %s", exc.status_code)
            raise ProviderError("The AI service had a problem. Please try again.") from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError("Could not reach the AI service. Please try again.") from exc

        # Check the stop reason before reading content
        if response.stop_reason == "refusal":
            raise ProviderError("The AI declined to process this document. Enter the fields manually.", retryable=False)
        if response.stop_reason == "max_tokens":
            raise ProviderError("The AI response was cut off. Please try again.")

        text = next((block.text for block in response.content if block.type == "text"), "")
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            raw = None
        # response.model is the model that actually answered (it can differ after a fallback)
        return validate_output(raw, self.name, response.model)
