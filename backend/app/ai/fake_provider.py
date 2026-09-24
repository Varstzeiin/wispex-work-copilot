"""Deterministic stand-in for development and automated tests (AI_PROVIDER=fake).

It reads "Label: value" lines from the text layer of a PDF, such as the fictional sample documents
in app/demo/sample_documents.py. It is refused in production (see core/config.py).
"""

import io
import re

from pypdf import PdfReader

from app.ai.prompts.extraction import FIELD_NAMES
from app.ai.provider import ExtractionResult, KnowledgeAnswer, validate_answer, validate_output

_TYPE_HEADINGS = {
    "COMMERCIAL INVOICE": "INVOICE",
    "PACKING LIST": "PACKING_LIST",
    "BILL OF LADING": "BILL_OF_LADING",
    "AIR WAYBILL": "AIR_WAYBILL",
}
_LINE = re.compile(r"^\s*([A-Za-z ]+?)\s*:\s*(.+?)\s*$")


def _normalize(name: str, value: str) -> str:
    if name in ("total_value", "quantity", "gross_weight", "net_weight"):
        return re.sub(r"[^0-9.]", "", value.replace(",", ""))
    if name in ("currency", "weight_unit"):
        return value.strip().upper()
    return value.strip()


class FakeProvider:
    name = "fake"

    def extract_document(self, content: bytes, mime_type: str) -> ExtractionResult:
        text = ""
        if mime_type == "application/pdf":
            try:
                text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages)
            except Exception:
                text = ""

        doc_type = next((t for heading, t in _TYPE_HEADINGS.items() if heading in text.upper()), "OTHER")
        fields = {n: {"value": None, "normalized": None, "confidence": 0.0, "evidence": ""} for n in FIELD_NAMES}
        for line in text.splitlines():
            match = _LINE.match(line)
            if not match:
                continue
            name = match.group(1).strip().lower().replace(" ", "_")
            value = match.group(2)
            if name not in fields:
                continue
            # "(unclear)" in a sample marks a value that a real reader would find hard to read
            unclear = "(unclear)" in value
            value = value.replace("(unclear)", "").strip()
            fields[name] = {
                "value": value,
                "normalized": _normalize(name, value),
                "confidence": 0.62 if unclear else 0.97,
                "evidence": "sample document text layer",
            }
        raw = {
            "document_type": doc_type,
            "document_type_confidence": 0.95 if doc_type != "OTHER" else 0.4,
            "fields": fields,
        }
        return validate_output(raw, self.name, "fake-extractor")

    def answer_knowledge_question(self, question: str, sources: list[dict]) -> KnowledgeAnswer:
        """Quotes the first sentence of the best source. Deterministic, never adds facts."""
        if not sources:
            return KnowledgeAnswer(sufficient=False, model="fake-answer")
        first = sources[0]
        sentence = re.split(r"(?<=[.!?])\s", first["text"].strip(), maxsplit=1)[0]
        raw = {"sufficient": True, "answer": f"{sentence} [1]", "used_source_ids": [first["id"]]}
        return validate_answer(raw, [s["id"] for s in sources], "fake-answer")

    def rewrite_message(self, text: str) -> str:
        """Collapses repeated spaces only, so tests can check that facts survive a rewrite."""
        return "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in text.strip().splitlines())
