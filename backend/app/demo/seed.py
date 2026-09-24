"""Fictional demo data. Never add real company or client information here.

All times are relative to "now" so the countdowns are always meaningful.
"""

import secrets
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.database import create_user_rows, utcnow
from app.core.security import hash_password
from app.demo.assistant_seed import seed_assistant
from app.demo.automation_seed import seed_automation
from app.demo.document_seed import seed_documents
from app.demo.performance_seed import seed_performance
from app.models import Client, Shipment, Task, User, UserSettings
from app.services import audit_service
from app.services.task_service import refresh_priority

INV, PL, BL, AWB = "Commercial Invoice", "Packing List", "Bill of Lading", "Air Waybill"
SEA_DOCS = [INV, PL, BL]
AIR_DOCS = [INV, PL, AWB]


def _issue(kind: str, text: str, resolved: bool = False) -> dict:
    return {"id": secrets.token_hex(6), "type": kind, "description": text, "resolved": resolved}


def demo_tasks(now: datetime) -> list[dict]:
    m = lambda minutes: now + timedelta(minutes=minutes)  # noqa: E731
    return [
        dict(ref="SHP-001", client="Client A", mode="SEA", title="Import declaration data prep",
             deadline=m(42), eta=m(180), est=25, docs=SEA_DOCS, have=SEA_DOCS, age_h=3),
        dict(ref="SHP-002", client="Client B", mode="SEA", title="Import declaration data prep",
             deadline=m(80), eta=m(-120), est=30, docs=SEA_DOCS, have=[INV, BL], age_h=5,
             action="Request Packing List from shipper"),
        dict(ref="SHP-003", client="Client A", mode="SEA", title="Import declaration data prep",
             deadline=m(150), eta=m(240), est=35, docs=SEA_DOCS, have=SEA_DOCS, age_h=6),
        dict(ref="SHP-004", client="Client C", mode="AIR", title="Air import data prep",
             deadline=m(185), eta=m(90), est=20, docs=AIR_DOCS, have=AIR_DOCS, age_h=2),
        dict(ref="SHP-005", client="Client B", mode="SEA", title="Import declaration data prep",
             deadline=m(300), eta=m(600), est=25, docs=SEA_DOCS, have=SEA_DOCS, age_h=4,
             issues=[_issue("LOW_CONFIDENCE",
                            "Gross weight on the scanned Packing List is hard to read. Manual check needed")]),
        dict(ref="SHP-006", client="Client A", mode="SEA", title="Import declaration data prep",
             deadline=m(420), eta=m(900), est=40, docs=SEA_DOCS, have=SEA_DOCS, age_h=1),
        dict(ref="SHP-007", client="Client C", mode="SEA", title="Import declaration data prep",
             deadline=m(240), eta=m(300), est=30, docs=SEA_DOCS, have=SEA_DOCS, age_h=8,
             status="ESCALATED",
             issues=[_issue("COMPLIANCE_QUESTION",
                            "Product description is too general to confirm classification. Asked supervisor")],
             notes="Escalated to supervisor. Waiting for guidance on product description."),
        dict(ref="SHP-008", client="Client B", mode="SEA", title="Import declaration data prep",
             deadline=m(540), eta=m(1440), est=25, docs=SEA_DOCS, have=[INV, PL], age_h=26,
             status="WAITING", action="Bill of Lading requested from forwarder"),
        dict(ref="SHP-009", client="Client A", mode="AIR", title="Air import data prep",
             deadline=m(-60), eta=m(-240), est=20, docs=AIR_DOCS, have=AIR_DOCS, age_h=7,
             status="COMPLETED", completed_min_ago=90, actual=18),
        dict(ref="SHP-010", client="Client C", mode="SEA", title="Import declaration data prep",
             deadline=m(-30), eta=m(-300), est=30, docs=SEA_DOCS, have=SEA_DOCS, age_h=9,
             status="COMPLETED", completed_min_ago=45, actual=34,
             issues=[_issue("DESCRIPTION_MISMATCH",
                            "Item description wording differed between Invoice and Packing List. "
                            "Confirmed with senior, same goods", resolved=True)]),
        dict(ref="SHP-011", client="Client B", mode="SEA", title="Import declaration data prep",
             deadline=m(26 * 60), eta=m(20 * 60), est=30, docs=SEA_DOCS, have=[INV], age_h=1),
        dict(ref="SHP-012", client="Client A", mode="SEA", title="Import declaration data prep",
             deadline=m(-15), eta=m(-600), est=25, docs=SEA_DOCS, have=SEA_DOCS, age_h=50,
             status="IN_PROGRESS"),
        dict(ref="SHP-013", client="Client C", mode="SEA", title="Import declaration data prep",
             deadline=m(12 * 60), eta=m(30 * 60), est=30, docs=SEA_DOCS, have=SEA_DOCS, age_h=10,
             status="ON_HOLD", notes="Client requested hold pending a revised invoice."),
        dict(ref="SHP-014", client="Client A", mode="AIR", title="Air import data prep",
             deadline=m(270), eta=m(200), est=20, docs=AIR_DOCS, have=AIR_DOCS, age_h=3,
             status="NEEDS_REVIEW"),
        dict(ref="SHP-015", client="Client B", mode="SEA", title="Pre-arrival document check",
             deadline=None, eta=m(2 * 24 * 60), est=15, docs=SEA_DOCS, have=[INV, PL], age_h=0),
    ]


def _cleanup_old_demo_users(db: Session) -> None:
    cutoff = utcnow() - timedelta(hours=24)
    db.execute(delete(User).where(User.is_demo.is_(True), User.created_at < cutoff))


def create_demo_user(db: Session) -> User:
    _cleanup_old_demo_users(db)
    now = utcnow()
    user = User(
        email=f"demo-{secrets.token_hex(6)}@demo.example.com",
        # Random password: demo accounts can only be entered through the demo endpoint
        password_hash=hash_password(secrets.token_urlsafe(24)),
        full_name="Demo User",
        is_demo=True,
    )
    db.add(user)
    db.flush()

    # Put the demo user "on shift" whenever the demo is opened
    tz = ZoneInfo("Asia/Jakarta")
    local = now.astimezone(tz)
    start = (local - timedelta(hours=2)).replace(minute=0)
    end = start + timedelta(hours=9)
    settings = UserSettings(
        user_id=user.id,
        timezone="Asia/Jakarta",
        shift_start=start.strftime("%H:%M"),
        shift_end=end.strftime("%H:%M"),
    )
    db.add(settings)
    create_user_rows(db, user.id)

    clients = {
        "Client A": Client(user_id=user.id, name="Client A", sla_tier="HIGH"),
        "Client B": Client(user_id=user.id, name="Client B", sla_tier="STANDARD"),
        "Client C": Client(user_id=user.id, name="Client C"),
    }
    db.add_all(clients.values())
    db.flush()

    for spec in demo_tasks(now):
        client = clients[spec["client"]]
        shipment = Shipment(
            user_id=user.id, client_id=client.id, reference=spec["ref"],
            transport_mode=spec["mode"], eta=spec["eta"],
        )
        db.add(shipment)
        created = now - timedelta(hours=spec["age_h"], minutes=5)
        status = spec.get("status", "NEW")
        task = Task(
            user_id=user.id,
            shipment=shipment,
            client=client,
            title=spec["title"],
            status=status,
            eta=spec["eta"],
            submission_deadline=spec["deadline"],
            estimated_minutes=spec["est"],
            required_documents=list(spec["docs"]),
            available_documents=list(spec["have"]),
            issues=[
                {**i, "created_at": (created + timedelta(minutes=20)).isoformat(), "resolved_at": None}
                for i in spec.get("issues", [])
            ],
            assigned_action=spec.get("action", ""),
            notes=spec.get("notes", ""),
            created_at=created,
            updated_at=created,
        )
        if status in ("IN_PROGRESS", "COMPLETED", "NEEDS_REVIEW"):
            task.started_at = created + timedelta(minutes=10)
        if status == "COMPLETED":
            task.completed_at = now - timedelta(minutes=spec["completed_min_ago"])
            task.actual_minutes = spec["actual"]
        db.add(task)
        db.flush()
        refresh_priority(task, settings, now)

    seed_performance(db, user, settings, now)
    seed_automation(db, user, now)
    # Quantity (SHP-003) and weight (SHP-004) mismatches come from the document check itself
    seed_documents(db, user, now)
    seed_assistant(db, user, now)
    audit_service.log(db, user.id, "DEMO_SESSION_STARTED", "user", user.id, metadata={"tasks": 15})
    db.commit()
    return user

