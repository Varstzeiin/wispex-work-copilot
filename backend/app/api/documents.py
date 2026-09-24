import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.provider import get_provider
from app.core.config import get_settings
from app.core.database import get_db, utcnow
from app.core.security import get_current_user
from app.demo.sample_documents import SAMPLES, sample_pdf
from app.models import Discrepancy, Document, Task, User
from app.rules.discrepancy_rules import TYPE_LABEL
from app.services import audit_service
from app.services import document_service as ds
from app.storage.backends import StorageError, get_storage

router = APIRouter(tags=["documents"])

DocType = Literal["INVOICE", "PACKING_LIST", "BILL_OF_LADING", "AIR_WAYBILL", "OTHER"]


# ---------- Status & settings ----------


@router.get("/documents/status")
def document_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = get_settings()
    provider = get_provider()
    doc_settings = ds.get_doc_settings(db, user)
    db.commit()
    return {
        "ai_configured": provider is not None,
        "ai_provider": provider.name if provider else None,
        "ai_model": s.ai_model if provider and provider.name == "anthropic" else None,
        "ai_allowed": ds.ai_allowed(db, user),
        "ai_permission_confirmed": doc_settings.ai_processing_allowed,
        "is_demo": user.is_demo,
        "max_upload_mb": s.max_upload_mb,
        "max_pdf_pages": s.max_pdf_pages,
        "accepted": ["application/pdf", "image/jpeg", "image/png"],
        "storage": get_storage().name,
    }


class DocumentSettingsIn(BaseModel):
    ai_processing_allowed: Optional[bool] = None
    # Required when switching AI processing on: the user confirms the organization permits it
    confirm_policy: bool = False
    review_threshold: Optional[float] = Field(default=None, ge=0.5, le=0.99)
    weight_tolerance_pct: Optional[float] = Field(default=None, ge=0, le=10)
    final_checklist: Optional[list[str]] = Field(default=None, max_length=25)


def _settings_out(db: Session, user: User) -> dict:
    s = ds.get_doc_settings(db, user)
    return {
        "ai_processing_allowed": s.ai_processing_allowed,
        "ai_permission_confirmed_at": s.ai_permission_confirmed_at,
        "review_threshold": s.review_threshold,
        "weight_tolerance_pct": s.weight_tolerance_pct,
        "final_checklist": s.final_checklist or [],
    }


@router.get("/documents/settings")
def read_document_settings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    out = _settings_out(db, user)
    db.commit()
    return out


@router.put("/documents/settings")
def update_document_settings(
    data: DocumentSettingsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    s = ds.get_doc_settings(db, user)
    if data.ai_processing_allowed is not None and data.ai_processing_allowed != s.ai_processing_allowed:
        if data.ai_processing_allowed:
            if user.is_demo:
                raise HTTPException(status.HTTP_409_CONFLICT, "Demo accounts never send documents to an AI provider.")
            if not data.confirm_policy:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Confirm that your organization permits this application and AI provider to process documents.",
                )
            s.ai_permission_confirmed_at = utcnow()
        s.ai_processing_allowed = data.ai_processing_allowed
        audit_service.log(
            db,
            user.id,
            "AI_PERMISSION_CHANGED",
            "settings",
            user.id,
            new_state={"ai_processing_allowed": s.ai_processing_allowed},
        )
    if data.review_threshold is not None:
        s.review_threshold = data.review_threshold
    if data.weight_tolerance_pct is not None:
        s.weight_tolerance_pct = data.weight_tolerance_pct
    if data.final_checklist is not None:
        items, seen = [], set()
        for raw in data.final_checklist:
            item = raw.strip()[:120]
            if item and item.lower() not in seen:
                seen.add(item.lower())
                items.append(item)
        s.final_checklist = items
        audit_service.log(db, user.id, "CHECKLIST_UPDATED", "settings", user.id, metadata={"items": len(items)})
    db.commit()
    return _settings_out(db, user)


# ---------- Upload ----------


async def _read_limited(upload: UploadFile, limit: int) -> bytes:
    """Read at most limit+1 bytes so an oversized file never fills memory."""
    data = await upload.read(limit + 1)
    await upload.close()
    return data


@router.post("/documents", status_code=201)
async def upload(
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    shipment_reference: str = Form(default="", max_length=80),
    task_id: Optional[uuid.UUID] = Form(default=None),
    document_type: Optional[DocType] = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit = get_settings().max_upload_mb * 1024 * 1024
    payload = [(f.filename or "document", await _read_limited(f, limit)) for f in files[: ds.MAX_FILES_PER_UPLOAD + 1]]
    results, to_process = ds.upload_documents(db, user, payload, shipment_reference, task_id, document_type)
    # Extraction runs after the response is sent, so large files never block the request
    for doc_id in to_process:
        background.add_task(ds.process_document, doc_id)
    return {"results": results, "queued": len(to_process)}


# ---------- Lists ----------


@router.get("/documents")
def list_documents(
    shipment: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Document).where(Document.user_id == user.id)
    if shipment is not None:
        stmt = stmt.where(Document.shipment_reference == shipment)
    docs = db.scalars(stmt.order_by(Document.uploaded_at.desc()).limit(200)).all()
    return [{**ds.document_out(d), "fields": []} for d in docs]


def _required_types(task: Optional[Task], docs: list[Document]) -> list[str]:
    if task and task.required_documents:
        return [ds.TASK_DOC_TO_TYPE.get(n.lower(), n) for n in task.required_documents]
    air = any(d.document_type == "AIR_WAYBILL" for d in docs) or (
        task is not None and task.shipment is not None and task.shipment.transport_mode == "AIR"
    )
    return ["INVOICE", "PACKING_LIST", "AIR_WAYBILL" if air else "BILL_OF_LADING"]


def _completeness(task: Optional[Task], docs: list[Document]) -> dict:
    required = _required_types(task, docs)
    present = {d.document_type for d in docs}
    labels = [TYPE_LABEL.get(t, t) for t in required]
    missing = [TYPE_LABEL.get(t, t) for t in required if t not in present]
    return {"required": labels, "available": len(required) - len(missing), "total": len(required), "missing": missing}


@router.get("/documents/shipments")
def shipments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    docs = db.scalars(select(Document).where(Document.user_id == user.id).order_by(Document.uploaded_at)).all()
    open_disc = db.scalars(
        select(Discrepancy).where(Discrepancy.user_id == user.id, Discrepancy.status == "OPEN")
    ).all()
    groups: dict[str, list[Document]] = {}
    for d in docs:
        groups.setdefault(d.shipment_reference, []).append(d)
    out = []
    for ref, items in groups.items():
        task = ds.task_for_shipment(db, user, ref)
        type_counts: dict[str, int] = {}
        for d in items:
            type_counts[d.document_type] = type_counts.get(d.document_type, 0) + 1
        out.append(
            {
                "shipment_reference": ref,
                "task_id": task.id if task else None,
                "document_count": len(items),
                "completeness": _completeness(task, items) if ref else None,
                "open_discrepancies": sum(1 for x in open_disc if x.shipment_reference == ref) if ref else 0,
                "fields_to_review": sum(sum(1 for f in d.fields if f.status == "NEEDS_REVIEW") for d in items),
                "processing": sum(1 for d in items if d.processing_status in ("QUEUED", "PROCESSING")),
                "version_choice_needed": any(
                    n > 1 and not any(d.is_active_version for d in items if d.document_type == t)
                    for t, n in type_counts.items()
                    if t in ds.TYPE_TO_TASK_DOC
                ),
                "documents": [
                    {
                        "id": d.id,
                        "original_filename": d.original_filename,
                        "document_type": d.document_type,
                        "processing_status": d.processing_status,
                        "is_active_version": d.is_active_version,
                    }
                    for d in items
                ],
                "last_upload": max(d.uploaded_at for d in items),
            }
        )
    # Unassigned group last, most recent activity first
    out.sort(key=lambda g: (g["shipment_reference"] == "", -g["last_upload"].timestamp()))
    return out


@router.get("/documents/shipments/{reference}")
def shipment_detail(reference: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    docs = db.scalars(
        select(Document)
        .where(Document.user_id == user.id, Document.shipment_reference == reference)
        .order_by(Document.document_type, Document.uploaded_at)
    ).all()
    if not docs:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No documents for this shipment.")
    task = ds.task_for_shipment(db, user, reference)
    comparisons, notes = ds.shipment_comparisons(db, user, reference)
    by_id = {d.id: d for d in docs}
    discrepancies = db.scalars(
        select(Discrepancy)
        .where(Discrepancy.user_id == user.id, Discrepancy.shipment_reference == reference)
        .order_by(Discrepancy.created_at.desc())
    ).all()
    counts: dict[str, int] = {}
    for d in docs:
        counts[d.document_type] = counts.get(d.document_type, 0) + 1
    return {
        "shipment_reference": reference,
        "task_id": task.id if task else None,
        "completeness": _completeness(task, docs),
        "documents": [ds.document_out(d, counts[d.document_type]) for d in docs],
        "comparisons": [c.as_dict() for c in comparisons],
        "notes": notes,
        "discrepancies": [ds.discrepancy_out(x, by_id) for x in discrepancies],
    }


@router.get("/documents/review-queue")
def review_queue(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    docs = db.scalars(select(Document).where(Document.user_id == user.id).order_by(Document.uploaded_at.desc())).all()
    items = []
    for d in docs:
        for f in d.fields:
            if f.status == "NEEDS_REVIEW":
                items.append(
                    {
                        "document_id": d.id,
                        "original_filename": d.original_filename,
                        "shipment_reference": d.shipment_reference,
                        "document_type": d.document_type,
                        **ds.field_out(f),
                    }
                )
    unknown_type = [
        {"document_id": d.id, "original_filename": d.original_filename, "shipment_reference": d.shipment_reference}
        for d in docs
        if d.document_type == "UNKNOWN" and d.processing_status not in ("QUEUED", "PROCESSING")
    ]
    return {"fields": items, "documents_without_type": unknown_type}


# ---------- Single document ----------


class DocumentPatch(BaseModel):
    document_type: Optional[DocType] = None
    shipment_reference: Optional[str] = Field(default=None, max_length=80)


class FieldIn(BaseModel):
    value: Optional[str] = Field(default=None, max_length=500)


def _detail(db: Session, user: User, doc: Document) -> dict:
    group = ds.version_group(db, user, doc)
    out = ds.document_out(doc, len(group))
    out["versions"] = (
        [
            {
                "id": v.id,
                "original_filename": v.original_filename,
                "uploaded_at": v.uploaded_at,
                "is_active_version": v.is_active_version,
                "changes": ds.version_diff(doc, v) if v.id != doc.id else [],
            }
            for v in group
        ]
        if len(group) > 1
        else []
    )
    return out


@router.get("/documents/{document_id}")
def get_document(document_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _detail(db, user, ds.get_document_for_user(db, user, document_id))


@router.get("/documents/{document_id}/file")
def download(document_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = ds.get_document_for_user(db, user, document_id)
    if doc.storage_key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This demo document has no stored file.")
    try:
        data = get_storage().load(doc.storage_key)
    except StorageError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", doc.original_filename)[:100] or "document"
    audit_service.log(db, user.id, "DOCUMENT_DOWNLOADED", "document", doc.id)
    db.commit()
    return Response(
        data,
        media_type=doc.mime_type,
        # Always download, never render inline: uploaded content is untrusted
        headers={"Content-Disposition": f'attachment; filename="{ascii_name}"', "Content-Security-Policy": "sandbox"},
    )


@router.patch("/documents/{document_id}")
def patch_document(
    document_id: uuid.UUID, data: DocumentPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    doc = ds.get_document_for_user(db, user, document_id)
    if data.shipment_reference is not None and data.shipment_reference.strip() != doc.shipment_reference:
        ds.set_shipment(db, user, doc, data.shipment_reference)
    if data.document_type is not None and data.document_type != doc.document_type:
        ds.set_type(db, user, doc, data.document_type)
    return _detail(db, user, doc)


@router.put("/documents/{document_id}/fields/{name}")
def set_field(
    document_id: uuid.UUID,
    name: str,
    data: FieldIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = ds.get_document_for_user(db, user, document_id)
    return _detail(db, user, ds.update_field(db, user, doc, name, data.value))


@router.post("/documents/{document_id}/fields/{name}/confirm")
def confirm_field(
    document_id: uuid.UUID, name: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    doc = ds.get_document_for_user(db, user, document_id)
    return _detail(db, user, ds.confirm_field(db, user, doc, name))


@router.post("/documents/{document_id}/verify")
def verify(document_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = ds.get_document_for_user(db, user, document_id)
    return _detail(db, user, ds.verify_document(db, user, doc))


@router.post("/documents/{document_id}/activate")
def activate(document_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = ds.get_document_for_user(db, user, document_id)
    ds.choose_version(db, user, doc)
    return _detail(db, user, doc)


@router.post("/documents/{document_id}/reprocess")
def reprocess(
    document_id: uuid.UUID,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = ds.get_document_for_user(db, user, document_id)
    if ds.reprocess(db, user, doc):
        background.add_task(ds.process_document, doc.id)
    return _detail(db, user, doc)


@router.delete("/documents/{document_id}", status_code=204)
def delete(document_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ds.delete_document(db, user, ds.get_document_for_user(db, user, document_id))


# ---------- Discrepancies ----------


class ResolveIn(BaseModel):
    status: Literal["RESOLVED", "DISMISSED"]
    note: str = Field(min_length=1, max_length=2000)


@router.post("/discrepancies/{discrepancy_id}/resolve")
def resolve(
    discrepancy_id: uuid.UUID, data: ResolveIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    d = db.get(Discrepancy, discrepancy_id)
    if d is None or d.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Discrepancy not found.")
    ds.resolve_discrepancy(db, user, d, data.status, data.note)
    docs = {x.id: x for x in db.scalars(select(Document).where(Document.id.in_([d.document_a_id, d.document_b_id])))}
    return ds.discrepancy_out(d, docs)


# ---------- Fictional samples ----------


@router.get("/documents/samples/{key}")
def sample(key: str, user: User = Depends(get_current_user)):
    """Fictional sample PDFs to try the workflow without real company data."""
    if key not in SAMPLES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown sample.")
    filename, data = sample_pdf(key)
    return Response(
        data, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
