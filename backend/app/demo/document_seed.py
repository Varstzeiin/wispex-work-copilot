"""Fictional document records for the demo (no files are stored, no AI is called).

The extracted values go through the same deterministic validation and cross-document check as
real uploads, so the demo shows real discrepancies and review items.
"""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.ai.prompts.extraction import FIELD_NAMES
from app.ai.provider import ExtractionResult, FieldOut
from app.models import Document, User
from app.services import document_service as ds

CONSIGNEE = "Example Importer PT (fictional)"


def _result(doc_type: str, values: dict[str, tuple]) -> ExtractionResult:
    fields = {n: FieldOut(value=None, normalized=None, confidence=0.0, evidence="") for n in FIELD_NAMES}
    for name, spec in values.items():
        value, normalized, confidence = spec if len(spec) == 3 else (*spec, 0.97)
        fields[name] = FieldOut(value=value, normalized=normalized, confidence=confidence, evidence="demo record")
    return ExtractionResult(
        valid=True,
        document_type=doc_type,
        document_type_confidence=0.96,
        fields=fields,
        provider="demo",
        model="fictional-demo-data",
    )


def _doc(
    db: Session,
    user: User,
    ref: str,
    doc_type: str,
    filename: str,
    minutes_ago: int,
    now: datetime,
    values: dict[str, tuple],
) -> Document:
    doc = Document(
        user_id=user.id,
        shipment_reference=ref,
        original_filename=filename,
        mime_type="image/jpeg" if filename.endswith(".jpg") else "application/pdf",
        size_bytes=48_000,
        page_count=1,
        checksum_sha256=f"demo-{ref}-{filename}"[:64],
        storage_key=None,
        is_demo=True,
        processing_status="EXTRACTED",
        uploaded_at=now - timedelta(minutes=minutes_ago),
    )
    db.add(doc)
    db.flush()
    ds.apply_extraction(db, user, doc, _result(doc_type, values))
    return doc


def _invoice(ref, number, qty, net, gross, total="12,500.00", desc="Plastic storage boxes, assorted"):
    return {
        "invoice_number": (number, number),
        "invoice_date": ("2026-09-15", "2026-09-15"),
        "seller": ("Example Exporter Ltd (fictional)", "Example Exporter Ltd (fictional)"),
        "consignee": (CONSIGNEE, CONSIGNEE),
        "shipment_reference": (ref, ref),
        "currency": ("USD", "USD"),
        "total_value": (total, total.replace(",", "")),
        "quantity": (qty, qty.replace(",", "")),
        "quantity_unit": ("PCS", "PCS"),
        "net_weight": (net, net.replace(",", "")),
        "gross_weight": (gross, gross.replace(",", "")),
        "weight_unit": ("KG", "KG"),
        "product_description": (desc, desc),
    }


def _packing(ref, number, qty, net, gross, gross_conf=0.97, desc="Plastic storage boxes, assorted sizes"):
    return {
        "invoice_number": (number, number),
        "document_date": ("2026-09-15", "2026-09-15"),
        "shipment_reference": (ref, ref),
        "consignee": (CONSIGNEE, CONSIGNEE),
        "quantity": (qty, qty.replace(",", "")),
        "quantity_unit": ("PCS", "PCS"),
        "net_weight": (net, net.replace(",", "")),
        "gross_weight": (gross, gross.replace(",", ""), gross_conf),
        "weight_unit": ("KG", "KG"),
        "product_description": (desc, desc),
    }


def _transport(ref, number, gross):
    return {
        "transport_document_number": (number, number),
        "document_date": ("2026-09-16", "2026-09-16"),
        "shipment_reference": (ref, ref),
        "consignee": (CONSIGNEE, CONSIGNEE),
        "gross_weight": (gross, gross.replace(",", "")),
        "weight_unit": ("KG", "KG"),
    }


def seed_documents(db: Session, user: User, now: datetime) -> None:
    # SHP-001: complete and consistent
    _doc(
        db,
        user,
        "SHP-001",
        "INVOICE",
        "SHP-001_Invoice.pdf",
        170,
        now,
        _invoice("SHP-001", "INV-A-1001", "800", "400", "430"),
    )
    _doc(
        db,
        user,
        "SHP-001",
        "PACKING_LIST",
        "SHP-001_PackingList.pdf",
        168,
        now,
        _packing("SHP-001", "INV-A-1001", "800", "400", "430"),
    )
    _doc(
        db, user, "SHP-001", "BILL_OF_LADING", "SHP-001_BL.pdf", 165, now, _transport("SHP-001", "BL-DEMO-5501", "430")
    )

    # SHP-002: Packing List still missing
    _doc(
        db,
        user,
        "SHP-002",
        "INVOICE",
        "SHP-002_Invoice.pdf",
        290,
        now,
        _invoice("SHP-002", "INV-B-2002", "240", "120", "131"),
    )
    _doc(
        db, user, "SHP-002", "BILL_OF_LADING", "SHP-002_BL.pdf", 280, now, _transport("SHP-002", "BL-DEMO-5502", "131")
    )

    # SHP-003: quantity mismatch (1,500 vs 1,550)
    _doc(
        db,
        user,
        "SHP-003",
        "INVOICE",
        "SHP-003_Invoice.pdf",
        350,
        now,
        _invoice("SHP-003", "INV-A-1003", "1,500", "700", "760"),
    )
    _doc(
        db,
        user,
        "SHP-003",
        "PACKING_LIST",
        "SHP-003_PackingList.pdf",
        345,
        now,
        _packing("SHP-003", "INV-A-1003", "1,550", "700", "760"),
    )
    _doc(
        db, user, "SHP-003", "BILL_OF_LADING", "SHP-003_BL.pdf", 340, now, _transport("SHP-003", "BL-DEMO-5503", "760")
    )

    # SHP-004 (air): net weight mismatch (850 vs 890 KG)
    _doc(
        db,
        user,
        "SHP-004",
        "INVOICE",
        "SHP-004_Invoice.pdf",
        110,
        now,
        _invoice("SHP-004", "INV-C-4004", "96", "850", "905", desc="Electronic sensor modules"),
    )
    _doc(
        db,
        user,
        "SHP-004",
        "PACKING_LIST",
        "SHP-004_PackingList.pdf",
        108,
        now,
        _packing("SHP-004", "INV-C-4004", "96", "890", "905", desc="Electronic sensor modules"),
    )
    _doc(db, user, "SHP-004", "AIR_WAYBILL", "SHP-004_AWB.pdf", 105, now, _transport("SHP-004", "AWB-618-2004", "905"))

    # SHP-005: hard-to-read gross weight on the scanned Packing List goes to the review queue
    _doc(
        db,
        user,
        "SHP-005",
        "INVOICE",
        "SHP-005_Invoice.pdf",
        230,
        now,
        _invoice("SHP-005", "INV-B-2005", "300", "610", "655"),
    )
    _doc(
        db,
        user,
        "SHP-005",
        "PACKING_LIST",
        "SHP-005_PackingList_scan.jpg",
        228,
        now,
        _packing("SHP-005", "INV-B-2005", "300", "610", "655", gross_conf=0.62),
    )

    # SHP-006: two invoice versions, the user has to choose which one applies
    _doc(
        db,
        user,
        "SHP-006",
        "INVOICE",
        "SHP-006_Invoice_v1.pdf",
        60,
        now,
        _invoice("SHP-006", "INV-A-1006", "1,200", "540", "590", total="9,600.00"),
    )
    _doc(
        db,
        user,
        "SHP-006",
        "INVOICE",
        "SHP-006_Invoice_v2.pdf",
        30,
        now,
        _invoice("SHP-006", "INV-A-1006", "1,250", "560", "610", total="10,000.00"),
    )
    _doc(
        db,
        user,
        "SHP-006",
        "PACKING_LIST",
        "SHP-006_PackingList.pdf",
        55,
        now,
        _packing("SHP-006", "INV-A-1006", "1,250", "560", "610"),
    )
