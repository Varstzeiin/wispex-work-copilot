"""Document intelligence pipeline.

UPLOAD -> FILE VALIDATION -> STORAGE -> (if permitted) AI EXTRACTION + CLASSIFICATION
-> CONFIDENCE SCORING -> DETERMINISTIC VALIDATION -> CROSS-DOCUMENT VALIDATION
-> DISCREPANCY DETECTION -> HUMAN REVIEW

AI output never becomes final truth on its own: low-confidence or rule-failing fields go to the
review queue, and every discrepancy needs a human decision.
"""

import hashlib
import io
import logging
import re
import secrets
import uuid
from typing import Optional

from fastapi import HTTPException, status
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.prompts.extraction import FIELD_NAMES
from app.ai.provider import ProviderError, get_provider
from app.core.config import get_settings
from app.core.database import SessionLocal, utcnow
from app.models import Discrepancy, Document, DocumentSettings, ExtractedField, Shipment, Task, User
from app.rules.discrepancy_rules import (
    ACTION,
    IMPACT,
    TYPE_LABEL,
    Comparison,
    Side,
    compare_documents,
    describe,
)
from app.rules.document_rules import NUMERIC_FIELDS, validate_fields
from app.services import audit_service
from app.services.settings_service import get_user_settings
from app.services.task_service import refresh_priority
from app.storage.backends import StorageError, get_storage

logger = logging.getLogger("wispex.documents")

MAGIC = [
    (b"%PDF-", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
]
TYPE_TO_TASK_DOC = {
    "INVOICE": "Commercial Invoice",
    "PACKING_LIST": "Packing List",
    "BILL_OF_LADING": "Bill of Lading",
    "AIR_WAYBILL": "Air Waybill",
}
TASK_DOC_TO_TYPE = {v.lower(): k for k, v in TYPE_TO_TASK_DOC.items()}
FIELD_TO_ISSUE = {
    "quantity": "QUANTITY_MISMATCH",
    "net_weight": "WEIGHT_MISMATCH",
    "gross_weight": "WEIGHT_MISMATCH",
    "product_description": "DESCRIPTION_MISMATCH",
    "consignee": "DESCRIPTION_MISMATCH",
}
MAX_FILES_PER_UPLOAD = 10


# ---------- Settings ----------


def get_doc_settings(db: Session, user: User) -> DocumentSettings:
    s = db.get(DocumentSettings, user.id)
    if s is None:
        s = DocumentSettings(user_id=user.id)
        db.add(s)
        db.flush()
    return s


def ai_allowed(db: Session, user: User) -> bool:
    """Documents go to an AI provider only if the server has one AND the user confirmed permission.

    Demo accounts never send uploads to an AI provider: people might upload real files there.
    """
    if user.is_demo or get_provider() is None:
        return False
    return get_doc_settings(db, user).ai_processing_allowed


# ---------- File validation ----------


def detect_mime(data: bytes) -> Optional[str]:
    """Decide the type from the file's bytes. Filenames and extensions are never trusted."""
    for magic, mime in MAGIC:
        if data.startswith(magic):
            return mime
    return None


def safe_filename(name: str) -> str:
    base = re.split(r"[\\/]", name or "")[-1]
    base = re.sub(r"[\x00-\x1f\x7f]", "", base).strip()
    return base[:150] or "document"


def inspect_pdf(data: bytes) -> int:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password-protected PDFs cannot be processed.")
        pages = len(reader.pages)
    except HTTPException:
        raise
    except (PdfReadError, Exception) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This PDF could not be read. It may be damaged.") from exc
    limit = get_settings().max_pdf_pages
    if pages > limit:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"PDFs are limited to {limit} pages.")
    return pages


# ---------- Lookups ----------


def get_document_for_user(db: Session, user: User, document_id: uuid.UUID) -> Document:
    doc = db.get(Document, document_id)
    if doc is None or doc.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    return doc


def task_for_shipment(db: Session, user: User, reference: str) -> Optional[Task]:
    if not reference:
        return None
    return db.scalar(
        select(Task)
        .join(Shipment, Task.shipment_id == Shipment.id)
        .where(Task.user_id == user.id, Shipment.reference == reference)
        .order_by(Task.created_at.desc())
    )


# ---------- Upload ----------


def upload_documents(
    db: Session,
    user: User,
    files: list[tuple[str, bytes]],
    shipment_reference: str = "",
    task_id: Optional[uuid.UUID] = None,
    document_type: Optional[str] = None,
) -> tuple[list[dict], list[uuid.UUID]]:
    """Validate and store files. Returns per-file results and the document IDs to analyse."""
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose at least one file.")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Upload at most {MAX_FILES_PER_UPLOAD} files at once.")

    task = None
    if task_id:
        task = db.get(Task, task_id)
        if task is None or task.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Linked task not found.")
        if not shipment_reference and task.shipment:
            shipment_reference = task.shipment.reference
    shipment_reference = shipment_reference.strip()[:80]

    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    use_ai = ai_allowed(db, user)
    storage = get_storage()
    results: list[dict] = []
    to_process: list[uuid.UUID] = []

    for raw_name, data in files:
        name = safe_filename(raw_name)
        if len(data) == 0:
            results.append({"filename": name, "status": "REJECTED", "message": "The file is empty."})
            continue
        if len(data) > max_bytes:
            results.append(
                {
                    "filename": name,
                    "status": "REJECTED",
                    "message": f"Files are limited to {get_settings().max_upload_mb} MB.",
                }
            )
            continue
        mime = detect_mime(data)
        if mime is None:
            results.append(
                {"filename": name, "status": "REJECTED", "message": "Only PDF, JPG and PNG files are accepted."}
            )
            continue
        try:
            pages = inspect_pdf(data) if mime == "application/pdf" else None
        except HTTPException as exc:
            results.append({"filename": name, "status": "REJECTED", "message": exc.detail})
            continue

        checksum = hashlib.sha256(data).hexdigest()
        existing = db.scalar(select(Document).where(Document.user_id == user.id, Document.checksum_sha256 == checksum))
        if existing:
            results.append(
                {
                    "filename": name,
                    "status": "DUPLICATE",
                    "document_id": existing.id,
                    "message": f"This exact file was already uploaded as “{existing.original_filename}”.",
                }
            )
            continue

        doc = Document(
            id=uuid.uuid4(),
            user_id=user.id,
            task_id=task.id if task else None,
            shipment_reference=shipment_reference,
            original_filename=name,
            mime_type=mime,
            size_bytes=len(data),
            page_count=pages,
            checksum_sha256=checksum,
            uploaded_at=utcnow(),
        )
        doc.storage_key = f"{user.id}/{doc.id}"
        try:
            storage.save(doc.storage_key, data, mime)
        except StorageError as exc:
            results.append({"filename": name, "status": "REJECTED", "message": str(exc)})
            continue

        if document_type:
            doc.document_type, doc.type_source, doc.type_confidence = document_type, "USER", 1.0
        if use_ai:
            doc.processing_status = "QUEUED"
            to_process.append(doc.id)
        else:
            doc.processing_status = "AI_NOT_PERMITTED"
        db.add(doc)
        db.flush()
        if not use_ai:
            _create_manual_fields(db, doc)
        audit_service.log(
            db,
            user.id,
            "DOCUMENT_UPLOADED",
            "document",
            doc.id,
            new_state={"type": doc.document_type, "status": doc.processing_status},
            metadata={"size": doc.size_bytes, "mime": mime},
        )
        _after_type_known(db, user, doc)
        results.append({"filename": name, "status": "UPLOADED", "document_id": doc.id})

    db.commit()
    return results, to_process


def _create_manual_fields(db: Session, doc: Document) -> None:
    """Empty field rows for manual entry when no AI is used."""
    today = utcnow().date()
    checks = validate_fields(doc.document_type, {n: {"value": None} for n in FIELD_NAMES}, today)
    doc.fields = [
        ExtractedField(
            name=n,
            position=i,
            value=None,
            normalized=None,
            confidence=0.0,
            source="HUMAN",
            status="NEEDS_REVIEW" if checks[n].required else "OK",
            rule_messages=checks[n].messages,
        )
        for i, n in enumerate(FIELD_NAMES)
    ]


# ---------- Processing (background) ----------


def process_document(document_id: uuid.UUID) -> None:
    """Run extraction outside the upload request. Uses its own database session."""
    db = SessionLocal()
    try:
        doc = db.get(Document, document_id)
        if doc is None or doc.processing_status not in ("QUEUED",):
            return
        user = db.get(User, doc.user_id)
        provider = get_provider()
        if provider is None or not ai_allowed(db, user):
            doc.processing_status = "AI_NOT_PERMITTED"
            _create_manual_fields(db, doc)
            db.commit()
            return
        doc.processing_status = "PROCESSING"
        doc.processing_error = ""
        db.commit()

        try:
            content = get_storage().load(doc.storage_key)
            result = provider.extract_document(content, doc.mime_type)
        except (ProviderError, StorageError) as exc:
            doc.processing_status = "FAILED"
            doc.processing_error = str(exc)[:300]
            audit_service.log(db, user.id, "DOCUMENT_ANALYSIS_FAILED", "document", doc.id)
            db.commit()
            return
        except Exception:  # never leave a document stuck in PROCESSING
            logger.exception("Unexpected document processing failure")
            doc.processing_status = "FAILED"
            doc.processing_error = "Something went wrong while processing this document."
            db.commit()
            return

        apply_extraction(db, user, doc, result)
        audit_service.log(
            db,
            user.id,
            "DOCUMENT_ANALYZED",
            "document",
            doc.id,
            new_state={"status": doc.processing_status, "type": doc.document_type},
            metadata={"provider": result.provider, "model": result.model},
        )
        db.commit()
    finally:
        db.close()


def apply_extraction(db: Session, user: User, doc: Document, result) -> None:
    settings = get_doc_settings(db, user)
    before = (doc.document_type, doc.shipment_reference)
    doc.ai_provider, doc.ai_model = result.provider, result.model
    doc.processed_at = utcnow()
    # Extraction is finished: leave PROCESSING so the status reflects the review state below
    doc.processing_status = "EXTRACTED"

    if not result.valid:
        doc.processing_error = result.problem
        _create_manual_fields(db, doc)
        for f in doc.fields:
            f.status = "NEEDS_REVIEW"
        doc.processing_status = "NEEDS_REVIEW"
        return

    if doc.type_source == "USER" and doc.document_type != result.document_type:
        doc.processing_error = (
            f"You marked this as {TYPE_LABEL.get(doc.document_type, doc.document_type)}, but it looks like "
            f"{TYPE_LABEL.get(result.document_type, result.document_type.title())}. Please confirm the type."
        )
    elif doc.type_source != "USER":
        doc.document_type = result.document_type
        doc.type_confidence = result.document_type_confidence
        doc.type_source = "AI"

    raw = {n: result.fields[n].model_dump() for n in FIELD_NAMES}
    _write_fields(db, doc, raw, settings.review_threshold, source="AI")

    ref_field = result.fields.get("shipment_reference")
    if (
        not doc.shipment_reference
        and ref_field
        and ref_field.normalized
        and ref_field.confidence >= settings.review_threshold
    ):
        doc.shipment_reference = ref_field.normalized.strip()[:80]

    _after_type_known(db, user, doc, joined=(doc.document_type, doc.shipment_reference) != before)


def _write_fields(db: Session, doc: Document, raw: dict, threshold: float, source: str) -> None:
    checks = validate_fields(doc.document_type, raw, utcnow().date())
    existing = {f.name: f for f in doc.fields}
    for i, name in enumerate(FIELD_NAMES):
        c = checks[name]
        f = existing.get(name) or ExtractedField(name=name, position=i)
        f.value, f.normalized, f.confidence, f.source = c.value, c.normalized, c.confidence, source
        f.evidence = (raw[name].get("evidence") or "")[:300]
        f.rule_messages = c.messages
        f.status = "NEEDS_REVIEW" if c.needs_review(threshold) else "OK"
        if name not in existing:
            doc.fields.append(f)
    _recompute_status(doc)


def _recompute_status(doc: Document, changed: bool = False) -> None:
    """changed: a value was edited, so an earlier "verified" no longer holds."""
    if doc.processing_status in ("QUEUED", "PROCESSING", "FAILED"):
        return
    if changed and doc.processing_status == "VERIFIED":
        doc.processing_status, doc.verified_at = "EXTRACTED", None
    if doc.document_type == "UNKNOWN" or any(f.status == "NEEDS_REVIEW" for f in doc.fields):
        if doc.processing_status != "AI_NOT_PERMITTED":  # manual-entry documents keep that label until done
            doc.processing_status = "NEEDS_REVIEW"
        doc.verified_at = None
    elif doc.processing_status != "VERIFIED":
        doc.processing_status = "EXTRACTED"


def _after_type_known(db: Session, user: User, doc: Document, joined: bool = True) -> None:
    """Keep versions, the linked task's document list and discrepancies up to date.

    joined: the document just entered its (shipment, type) group, e.g. new upload or type change.
    """
    if doc.document_type in TYPE_TO_TASK_DOC:
        recompute_versions(db, user, doc, joined)
        task = db.get(Task, doc.task_id) if doc.task_id else task_for_shipment(db, user, doc.shipment_reference)
        if task is not None:
            name = TYPE_TO_TASK_DOC[doc.document_type]
            if name.lower() not in {d.lower() for d in task.available_documents or []}:
                task.available_documents = [*(task.available_documents or []), name]
                refresh_priority(task, get_user_settings(db, user))
    db.flush()
    if doc.shipment_reference:
        refresh_shipment(db, user, doc.shipment_reference)


# ---------- Versions ----------


def version_group(db: Session, user: User, doc: Document) -> list[Document]:
    if not doc.shipment_reference or doc.document_type not in TYPE_TO_TASK_DOC:
        return [doc]
    return list(
        db.scalars(
            select(Document)
            .where(
                Document.user_id == user.id,
                Document.shipment_reference == doc.shipment_reference,
                Document.document_type == doc.document_type,
            )
            .order_by(Document.uploaded_at)
        ).all()
    )


def recompute_versions(db: Session, user: User, doc: Document, joined: bool) -> None:
    """A single document is active. When another version joins the group, nothing is active until
    the user chooses: the newest file is never assumed to be the correct one."""
    db.flush()
    group = version_group(db, user, doc)
    if len(group) == 1:
        group[0].is_active_version = True
    elif joined:
        for d in group:
            d.is_active_version = False


def choose_version(db: Session, user: User, doc: Document) -> None:
    for d in version_group(db, user, doc):
        d.is_active_version = d.id == doc.id
    audit_service.log(db, user.id, "DOCUMENT_VERSION_SELECTED", "document", doc.id)
    db.flush()
    refresh_shipment(db, user, doc.shipment_reference)
    db.commit()


def version_diff(base: Document, other: Document) -> list[dict]:
    a = {f.name: f for f in base.fields}
    b = {f.name: f for f in other.fields}
    changes = []
    for name in FIELD_NAMES:
        va = a[name].normalized if name in a else None
        vb = b[name].normalized if name in b else None
        if (va or "") != (vb or ""):
            changes.append(
                {
                    "field": name,
                    "this": a[name].value if name in a else None,
                    "other": b[name].value if name in b else None,
                }
            )
    return changes


# ---------- Cross-document validation ----------


def _sides(doc: Document) -> dict[str, Side]:
    fields = {f.name: f for f in doc.fields}
    unit = fields["weight_unit"].normalized if "weight_unit" in fields else None
    return {f.name: Side(doc.id, doc.document_type, f.value, f.normalized, f.confidence, unit) for f in doc.fields}


def shipment_comparisons(db: Session, user: User, reference: str) -> tuple[list[Comparison], list[str]]:
    """Compare the active version of each document type. Returns comparisons and blocking notes."""
    docs = db.scalars(
        select(Document).where(Document.user_id == user.id, Document.shipment_reference == reference)
    ).all()
    notes: list[str] = []
    by_type: dict[str, dict[str, Side]] = {}
    for doc_type in TYPE_TO_TASK_DOC:
        of_type = [d for d in docs if d.document_type == doc_type]
        if not of_type:
            continue
        active = [d for d in of_type if d.is_active_version]
        if len(of_type) > 1 and not active:
            notes.append(f"{len(of_type)} versions of the {TYPE_LABEL[doc_type]}: choose the one that applies.")
            continue
        doc = active[0] if active else of_type[0]
        if doc.processing_status in ("QUEUED", "PROCESSING", "FAILED", "UPLOADED"):
            continue
        by_type[doc_type] = _sides(doc)
    tolerance = get_doc_settings(db, user).weight_tolerance_pct
    return compare_documents(by_type, tolerance), notes


def refresh_shipment(db: Session, user: User, reference: str) -> None:
    """Create new discrepancies, supersede ones whose values changed. Never resolves anything silently."""
    if not reference:
        return
    comparisons, _ = shipment_comparisons(db, user, reference)
    task = task_for_shipment(db, user, reference)
    current = {}
    for c in comparisons:
        if c.status == "POTENTIAL_MISMATCH":
            current[c.signature(reference)] = c

    existing = {
        d.signature: d
        for d in db.scalars(
            select(Discrepancy).where(Discrepancy.user_id == user.id, Discrepancy.shipment_reference == reference)
        ).all()
    }
    for sig, c in current.items():
        if sig in existing:
            continue
        issue_id = ""
        if task is not None:
            issue_id = _add_task_issue(db, user, task, c)
        d = Discrepancy(
            user_id=user.id,
            shipment_reference=reference,
            task_id=task.id if task else None,
            field=c.field,
            document_a_id=c.a.document_id,
            document_b_id=c.b.document_id,
            value_a=(c.a.value or "")[:300],
            value_b=(c.b.value or "")[:300],
            difference=c.difference[:120],
            confidence=c.confidence,
            potential_impact=IMPACT.get(c.field, ""),
            recommended_action=ACTION,
            signature=sig,
            task_issue_id=issue_id,
            created_at=utcnow(),
        )
        db.add(d)
        db.flush()
        audit_service.log(db, user.id, "DISCREPANCY_DETECTED", "discrepancy", d.id, metadata={"field": c.field})

    for sig, d in existing.items():
        if d.status == "OPEN" and sig not in current:
            d.status = "SUPERSEDED"
            d.resolution_note = "The compared values changed (field corrected or another version chosen). Check again."
            d.resolved_at = utcnow()
            _close_task_issue(db, user, d, "Document check: values changed after review.")


def _add_task_issue(db: Session, user: User, task: Task, c: Comparison) -> str:
    issue_id = secrets.token_hex(6)
    task.issues = [
        *(task.issues or []),
        {
            "id": issue_id,
            "type": FIELD_TO_ISSUE.get(c.field, "OTHER"),
            "description": describe(c)[:500],
            "resolved": False,
            "created_at": utcnow().isoformat(),
            "resolved_at": None,
            "source": "document_check",
        },
    ]
    refresh_priority(task, get_user_settings(db, user))
    return issue_id


def _close_task_issue(db: Session, user: User, d: Discrepancy, note: str) -> None:
    if not d.task_id or not d.task_issue_id:
        return
    task = db.get(Task, d.task_id)
    if task is None:
        return
    now = utcnow()
    task.issues = [
        {**i, "resolved": True, "resolved_at": now.isoformat()} if i.get("id") == d.task_issue_id else i
        for i in task.issues or []
    ]
    stamp = now.strftime("%Y-%m-%d %H:%M UTC")
    task.notes = (task.notes + "\n" if task.notes else "") + f"[{stamp}] {note}"
    refresh_priority(task, get_user_settings(db, user))


def resolve_discrepancy(db: Session, user: User, d: Discrepancy, new_status: str, note: str) -> Discrepancy:
    if d.status != "OPEN":
        raise HTTPException(status.HTTP_409_CONFLICT, "This discrepancy is already closed.")
    if not note.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Record how it was resolved, and who confirmed it.")
    d.status, d.resolution_note, d.resolved_at = new_status, note.strip()[:2000], utcnow()
    verb = "resolved" if new_status == "RESOLVED" else "dismissed"
    _close_task_issue(db, user, d, f"Document check {verb}: {note.strip()[:300]}")
    audit_service.log(db, user.id, "DISCREPANCY_RESOLVED", "discrepancy", d.id, new_state={"status": new_status})
    db.commit()
    return d


# ---------- Human review ----------


def normalize_human_value(name: str, value: str) -> str:
    """Deterministic normalisation for values typed by a person."""
    v = value.strip()
    if name in NUMERIC_FIELDS:
        compact = v.replace(" ", "")
        if "," in compact and "." in compact:
            compact = compact.replace(",", "")
        elif "," in compact:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Use a dot for decimals and no thousands separators, for example 1500 or 1500.50.",
            )
        return compact
    if name in ("currency", "weight_unit"):
        return v.upper()
    return v


def update_field(db: Session, user: User, doc: Document, name: str, value: Optional[str]) -> Document:
    if name not in FIELD_NAMES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown field.")
    field = next((f for f in doc.fields if f.name == name), None)
    if field is None:
        _create_manual_fields(db, doc)
        field = next(f for f in doc.fields if f.name == name)
    if value is not None and value.strip():
        normalized = normalize_human_value(name, value)
        raw = {f.name: {"value": f.value, "normalized": f.normalized, "confidence": f.confidence} for f in doc.fields}
        raw[name] = {"value": value.strip(), "normalized": normalized, "confidence": 1.0}
        check = validate_fields(doc.document_type, raw, utcnow().date())[name]
        field.value, field.normalized = value.strip()[:500], normalized
        field.rule_messages = check.messages
    else:
        field.value = field.normalized = None
        field.rule_messages = []
    # A person looked at it: verified, even if they confirmed the AI's reading unchanged
    field.source, field.confidence, field.status = "HUMAN", 1.0, "VERIFIED"
    if field.rule_messages and value:
        field.status = "NEEDS_REVIEW"
    _recompute_status(doc, changed=True)
    audit_service.log(db, user.id, "FIELD_VERIFIED", "document", doc.id, metadata={"field": name})
    db.flush()
    if doc.shipment_reference:
        refresh_shipment(db, user, doc.shipment_reference)
    db.commit()
    return doc


def confirm_field(db: Session, user: User, doc: Document, name: str) -> Document:
    field = next((f for f in doc.fields if f.name == name), None)
    if field is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown field.")
    if field.rule_messages and field.value is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This value fails a check. Correct it instead of confirming.")
    return update_field(db, user, doc, name, field.value)


def set_type(db: Session, user: User, doc: Document, document_type: str) -> Document:
    previous = doc.document_type
    doc.document_type, doc.type_source, doc.type_confidence = document_type, "HUMAN", 1.0
    if doc.processing_status == "VERIFIED" and previous != document_type:
        doc.processing_status, doc.verified_at = "EXTRACTED", None
    if doc.processing_error.startswith("You marked this as"):
        doc.processing_error = ""
    if doc.fields:
        raw = {f.name: {"value": f.value, "normalized": f.normalized, "confidence": f.confidence} for f in doc.fields}
        sources = {f.name: (f.source, f.status) for f in doc.fields}
        _write_fields(db, doc, raw, get_doc_settings(db, user).review_threshold, source="AI")
        for f in doc.fields:  # keep human verification
            if sources[f.name][0] == "HUMAN" and sources[f.name][1] == "VERIFIED" and not f.rule_messages:
                f.source, f.status = "HUMAN", "VERIFIED"
        _recompute_status(doc)
    audit_service.log(
        db,
        user.id,
        "DOCUMENT_TYPE_SET",
        "document",
        doc.id,
        previous_state={"type": previous},
        new_state={"type": document_type},
    )
    _after_type_known(db, user, doc, joined=previous != document_type)
    db.commit()
    return doc


def set_shipment(db: Session, user: User, doc: Document, reference: str) -> Document:
    old = doc.shipment_reference
    doc.shipment_reference = reference.strip()[:80]
    _after_type_known(db, user, doc, joined=old != doc.shipment_reference)
    if old and old != doc.shipment_reference:
        refresh_shipment(db, user, old)
    db.commit()
    return doc


def verify_document(db: Session, user: User, doc: Document) -> Document:
    if doc.document_type == "UNKNOWN":
        raise HTTPException(status.HTTP_409_CONFLICT, "Set the document type first.")
    pending = [f.name for f in doc.fields if f.status == "NEEDS_REVIEW"]
    if pending:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{len(pending)} field(s) still need review.")
    doc.processing_status, doc.verified_at = "VERIFIED", utcnow()
    audit_service.log(db, user.id, "DOCUMENT_VERIFIED", "document", doc.id)
    db.commit()
    return doc


def reprocess(db: Session, user: User, doc: Document) -> bool:
    if not ai_allowed(db, user):
        raise HTTPException(status.HTTP_409_CONFLICT, "AI processing is not enabled for your account.")
    if doc.storage_key is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This demo document has no stored file.")
    if doc.processing_status in ("QUEUED", "PROCESSING"):
        return False
    doc.processing_status, doc.processing_error = "QUEUED", ""
    db.commit()
    return True


def delete_document(db: Session, user: User, doc: Document) -> None:
    reference = doc.shipment_reference
    if doc.storage_key:
        try:
            get_storage().delete(doc.storage_key)
        except StorageError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    audit_service.log(db, user.id, "DOCUMENT_DELETED", "document", doc.id, previous_state={"type": doc.document_type})
    db.delete(doc)
    db.flush()
    others = version_group(db, user, doc) if reference else []
    if len(others) == 1:
        others[0].is_active_version = True
    refresh_shipment(db, user, reference)
    db.commit()


# ---------- Serialisation ----------


def field_out(f: ExtractedField) -> dict:
    return {
        "name": f.name,
        "value": f.value,
        "normalized": f.normalized,
        "confidence": round(f.confidence, 2),
        "source": f.source,
        "status": f.status,
        "rule_messages": f.rule_messages or [],
        "evidence": f.evidence,
    }


def document_out(doc: Document, versions: int = 1) -> dict:
    fields = sorted(doc.fields, key=lambda f: f.position)
    return {
        "id": doc.id,
        "task_id": doc.task_id,
        "shipment_reference": doc.shipment_reference,
        "original_filename": doc.original_filename,
        "mime_type": doc.mime_type,
        "size_bytes": doc.size_bytes,
        "page_count": doc.page_count,
        "checksum_sha256": doc.checksum_sha256,
        "document_type": doc.document_type,
        "type_source": doc.type_source,
        "type_confidence": doc.type_confidence,
        "is_active_version": doc.is_active_version,
        "version_count": versions,
        "processing_status": doc.processing_status,
        "processing_error": doc.processing_error,
        "ai_provider": doc.ai_provider,
        "ai_model": doc.ai_model,
        "has_file": doc.storage_key is not None,
        "is_demo": doc.is_demo,
        "uploaded_at": doc.uploaded_at,
        "processed_at": doc.processed_at,
        "verified_at": doc.verified_at,
        "fields": [field_out(f) for f in fields],
        "review_count": sum(1 for f in fields if f.status == "NEEDS_REVIEW"),
    }


def discrepancy_out(d: Discrepancy, docs: dict) -> dict:
    a, b = docs.get(d.document_a_id), docs.get(d.document_b_id)
    return {
        "id": d.id,
        "shipment_reference": d.shipment_reference,
        "task_id": d.task_id,
        "field": d.field,
        "document_a": TYPE_LABEL.get(a.document_type, "Document") if a else "Document",
        "document_a_id": d.document_a_id,
        "value_a": d.value_a,
        "document_b": TYPE_LABEL.get(b.document_type, "Document") if b else "Document",
        "document_b_id": d.document_b_id,
        "value_b": d.value_b,
        "difference": d.difference,
        "confidence": d.confidence,
        "status": d.status,
        "requires_human_review": d.status == "OPEN",
        "potential_impact": d.potential_impact,
        "recommended_action": d.recommended_action,
        "resolution_note": d.resolution_note,
        "created_at": d.created_at,
        "resolved_at": d.resolved_at,
    }
