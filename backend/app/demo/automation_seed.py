"""Fictional history details for the MVP 5 screens (forecast, patterns, analytics).

Adds a client, a shipment and a transport mode to the invented past tasks, plus a few recorded
issues, so the demo shows realistic patterns. Everything here is invented.
"""

import random
import re
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Client, Shipment, Task, User


def _issue(kind: str, text: str, at: datetime) -> dict:
    return {
        "id": secrets.token_hex(6),
        "type": kind,
        "description": text,
        "resolved": True,
        "created_at": at.isoformat(),
        "resolved_at": (at + timedelta(minutes=30)).isoformat(),
    }


def seed_automation(db: Session, user: User, now: datetime) -> None:
    rng = random.Random(11)  # deterministic demo
    clients = {c.name: c for c in db.scalars(select(Client).where(Client.user_id == user.id)).all()}
    history = db.scalars(
        select(Task).where(Task.user_id == user.id, Task.status == "COMPLETED", Task.title.like("%(SHP-2%"))
    ).all()
    for task in history:
        name = rng.choices(["Client A", "Client B", "Client C"], weights=[4, 4, 3])[0]
        client = clients.get(name)
        air = rng.random() < (0.7 if name == "Client C" else 0.15)
        reference = re.search(r"SHP-\d+", task.title).group(0)
        task.client = client
        task.shipment = Shipment(
            user_id=user.id, client_id=client.id if client else None, reference=reference,
            transport_mode="AIR" if air else "SEA",
        )
        if air:
            # Air tasks are usually estimated too low: a pattern the forecast corrects for
            task.estimated_minutes = 20
            task.actual_minutes = rng.randint(26, 38)
            task.started_at = task.completed_at - timedelta(minutes=task.actual_minutes)
        at = task.completed_at - timedelta(minutes=task.actual_minutes or 20)
        if name == "Client B" and rng.random() < 0.5:
            task.issues = [*(task.issues or []), _issue(
                "MISSING_INFORMATION", "Packing List arrived after the task had started", at)]
        if name == "Client A" and rng.random() < 0.3:
            task.issues = [*(task.issues or []), _issue(
                "WEIGHT_MISMATCH", "Gross weight differed between Invoice and Packing List. Confirmed with senior", at)]
