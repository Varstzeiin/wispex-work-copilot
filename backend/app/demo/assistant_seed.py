"""Fictional knowledge notes, questions and drafts for the demo account (MVP 4).

The SOP references below are invented examples ("SOP-DEMO-..."). They are not real procedures.
"""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Clarification, CommunicationDraft, KnowledgeNote, Task, User

NOTES = [
    dict(
        title="Gross weight vs net weight",
        category="TRAINING",
        source_label="Onboarding training, week 1 (fictional)",
        verified=True,
        tags="weight, packing list",
        body=(
            "Gross weight is the weight of the goods including packaging. Net weight is the weight of the goods "
            "without packaging. Gross weight is always equal to or higher than net weight. Take both from the "
            "Packing List and check the unit (KG or LB)."
        ),
    ),
    dict(
        title="Quantity differs between Invoice and Packing List",
        category="SOP_REFERENCE",
        source_label="SOP-DEMO-03, section 2 (fictional)",
        verified=True,
        tags="quantity, discrepancy",
        body=(
            "When the quantity on the Invoice and the Packing List differ, do not choose a value yourself. "
            "Record both values and ask the shipper or forwarder for confirmation. If the deadline is close, "
            "inform the supervisor and document the question."
        ),
    ),
    dict(
        title="Weight differs between Packing List and transport document",
        category="SOP_REFERENCE",
        source_label="SOP-DEMO-03, section 3 (fictional)",
        verified=True,
        tags="weight, bill of lading, air waybill",
        body=(
            "Small weight differences between the Packing List and the Bill of Lading or Air Waybill must still "
            "be confirmed. The supervisor decides which value applies. Note who confirmed it on the task."
        ),
    ),
    dict(
        title="Consignee vs buyer",
        category="TERMINOLOGY",
        source_label="Senior officer (fictional)",
        verified=True,
        tags="parties",
        body=(
            "The consignee receives the goods. The buyer pays for them. They can be different companies. "
            "Take each one from its own field on the document."
        ),
    ),
    dict(
        title="Unclear scan: what to do",
        category="LESSON",
        source_label="Own note",
        verified=False,
        tags="scan, low confidence",
        body=(
            "If a value on a scan is hard to read, do not guess. Ask for a clearer copy and continue with the "
            "fields that are readable."
        ),
    ),
    dict(
        title="Reading references character by character",
        category="COMMON_MISTAKE",
        source_label="Own error analysis",
        verified=False,
        tags="invoice number, typo",
        body="Letter O and digit 0 are easy to mix up in invoice numbers. Read references character by character.",
    ),
]


def seed_assistant(db: Session, user: User, now: datetime) -> None:
    for i, spec in enumerate(NOTES):
        stamp = now - timedelta(days=20 - i)
        db.add(KnowledgeNote(user_id=user.id, created_at=stamp, updated_at=stamp, **spec))

    tasks = {
        t.shipment.reference: t
        for t in db.scalars(select(Task).where(Task.user_id == user.id)).all()
        if t.shipment is not None
    }

    # An answered question from earlier, searchable as a resolved case
    db.add(
        Clarification(
            user_id=user.id,
            shipment_reference="SHP-010",
            task_id=tasks["SHP-010"].id if "SHP-010" in tasks else None,
            kind="QUESTION",
            field_name="Product description",
            issue="Item description wording differs between Invoice and Packing List",
            question=(
                "Hi, the Invoice says 'cotton shirts' and the Packing List says 'men's cotton shirts' for shipment "
                "SHP-010. Are these the same goods?"
            ),
            asked_to="Senior officer",
            status="ANSWERED",
            answer="Yes, same goods. Use the Invoice description and note the confirmation on the task.",
            answered_at=now - timedelta(hours=2),
            created_at=now - timedelta(hours=3),
        )
    )

    # A saved draft for the missing Packing List of SHP-002
    task = tasks.get("SHP-002")
    if task is not None:
        db.add(
            CommunicationDraft(
                user_id=user.id,
                task_id=task.id,
                shipment_reference="SHP-002",
                kind="MISSING_DOCUMENT",
                recipient="Shipper contact (fictional)",
                subject="SHP-002: Missing documents",
                body=(
                    "Hi,\n\nI am working on shipment SHP-002 for Client B. I have not yet received the Packing "
                    "List.\n\nReceived so far: Commercial Invoice and Bill of Lading.\n\nCould you please send "
                    "the Packing List as soon as possible?\n\nThank you."
                ),
                created_at=now - timedelta(minutes=40),
                updated_at=now - timedelta(minutes=40),
            )
        )
