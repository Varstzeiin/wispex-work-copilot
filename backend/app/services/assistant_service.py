"""AI copilot workflows (MVP 4): "I'm not sure", question and message drafting, clarifications,
error analysis and adaptive personal checklist suggestions.

Drafts are built deterministically from the user's own data, so they work without any AI provider
and never invent facts. The optional AI rewrite is checked afterwards: if any number or reference
changed, the original text is kept. Nothing is ever sent automatically.
"""

import re
import secrets
import uuid
from collections import Counter
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.provider import ProviderError, get_provider
from app.core.database import utcnow
from app.models import (
    Clarification,
    CommunicationDraft,
    Discrepancy,
    Document,
    ErrorReport,
    ExtractedField,
    Task,
    User,
)
from app.rules.deadline_rules import evaluate_deadline, format_duration
from app.rules.discrepancy_rules import FIELD_LABEL, TYPE_LABEL
from app.rules.escalation_rules import Signals, assess
from app.services import audit_service, knowledge_service
from app.services.document_service import get_doc_settings
from app.services.error_service import CATEGORY_LABEL, recurring_patterns
from app.services.settings_service import get_user_settings
from app.services.task_service import get_task_for_user, refresh_priority

STATUS_LABEL = {
    "NEW": "Not started",
    "IN_PROGRESS": "In progress",
    "WAITING": "Waiting for information",
    "NEEDS_REVIEW": "Needs review",
    "ESCALATED": "Escalated",
    "ON_HOLD": "On hold",
    "COMPLETED": "Completed",
}
DRAFT_LABEL = {
    "CLARIFICATION": "Clarification request",
    "MISSING_DOCUMENT": "Missing documents",
    "DISCREPANCY": "Document discrepancy",
    "ESCALATION": "Escalation",
    "CORRECTION": "Correction notification",
    "STATUS_UPDATE": "Status update",
}


def sentence(text: str) -> str:
    """Trim, capitalise the first letter and make sure it ends with punctuation."""
    text = " ".join((text or "").split())
    if not text:
        return ""
    text = text[0].upper() + text[1:]
    return text if text[-1] in ".?!" else text + "."


def _greeting(greeting: str) -> str:
    g = " ".join((greeting or "").split()).rstrip(",") or "Hi"
    return f"{g},"


def _local(dt: datetime, tz_name: str, now: datetime) -> str:
    tz = ZoneInfo(tz_name)
    local, today = dt.astimezone(tz), now.astimezone(tz)
    if local.date() == today.date():
        return f"{local:%H:%M} today"
    if local.date() == (today + timedelta(days=1)).date():
        return f"{local:%H:%M} tomorrow"
    return f"{local:%d %b %Y, %H:%M}"


# ---------- Task context ----------


def task_context(db: Session, user: User, task: Optional[Task]) -> dict:
    """Facts about a task that a question or message can refer to. Only the user's own data."""
    if task is None:
        return {
            "task_id": None, "shipment_reference": "", "client_name": "", "status": "", "status_label": "",
            "deadline": None, "deadline_sentence": "", "missing_documents": [], "available_documents": [],
            "discrepancies": [], "low_confidence_fields": [], "open_issues": 0,
        }
    settings = get_user_settings(db, user)
    now = utcnow()
    ref = task.shipment.reference if task.shipment else ""
    deadline = evaluate_deadline(task.submission_deadline, now, settings.deadline_thresholds)
    deadline_sentence = ""
    if task.submission_deadline:
        when = _local(task.submission_deadline, settings.timezone, now)
        if deadline.overdue:
            deadline_sentence = (
                f"The submission deadline ({when}) passed {format_duration(deadline.minutes_remaining)} ago."
            )
        else:
            deadline_sentence = (
                f"The submission deadline is {when}, about {format_duration(deadline.minutes_remaining)} from now."
            )

    discrepancies, low_conf = [], []
    if ref:
        docs = {
            d.id: d
            for d in db.scalars(
                select(Document).where(Document.user_id == user.id, Document.shipment_reference == ref)
            ).all()
        }
        for d in db.scalars(
            select(Discrepancy)
            .where(Discrepancy.user_id == user.id, Discrepancy.shipment_reference == ref, Discrepancy.status == "OPEN")
            .order_by(Discrepancy.created_at)
        ).all():
            a, b = docs.get(d.document_a_id), docs.get(d.document_b_id)
            discrepancies.append(
                {
                    "id": d.id,
                    "field": d.field,
                    "field_label": FIELD_LABEL.get(d.field, d.field.replace("_", " ").capitalize()),
                    "document_a": TYPE_LABEL.get(a.document_type, "document") if a else "document",
                    "document_b": TYPE_LABEL.get(b.document_type, "document") if b else "document",
                    "value_a": d.value_a,
                    "value_b": d.value_b,
                    "difference": d.difference,
                }
            )
        active_ids = [d.id for d in docs.values() if d.is_active_version]
        if active_ids:
            for f in db.scalars(
                select(ExtractedField).where(
                    ExtractedField.document_id.in_(active_ids), ExtractedField.status == "NEEDS_REVIEW"
                )
            ).all():
                doc = docs[f.document_id]
                low_conf.append(
                    {"field": f.name, "document": TYPE_LABEL.get(doc.document_type, "document"),
                     "confidence": f.confidence}
                )

    return {
        "task_id": task.id,
        "shipment_reference": ref,
        "client_name": task.client.name if task.client else "",
        "status": task.status,
        "status_label": STATUS_LABEL.get(task.status, task.status),
        "deadline": deadline.as_dict(),
        "deadline_sentence": deadline_sentence,
        "missing_documents": task.missing_documents,
        "available_documents": task.available_documents or [],
        "discrepancies": discrepancies,
        "low_confidence_fields": low_conf,
        "open_issues": len(task.open_issues),
    }


def _context_sentence(ctx: dict) -> str:
    if not ctx["shipment_reference"]:
        return ""
    client = f" for {ctx['client_name']}" if ctx["client_name"] else ""
    return f"I am working on shipment {ctx['shipment_reference']}{client}."


def _discrepancy_evidence(d: dict) -> str:
    diff = d["difference"] if d["difference"] and d["difference"] != "different" else ""
    a, b = d["value_a"], d["value_b"]
    # "40 KG" -> show the unit with bare numbers too: "850 KG" instead of "850"
    unit = diff.split()[-1] if diff and diff.split()[-1].isalpha() else ""
    if unit and re.fullmatch(r"[\d.,]+", a) and re.fullmatch(r"[\d.,]+", b):
        a, b = f"{a} {unit}", f"{b} {unit}"
    extra = f" (difference: {diff})" if diff else ""
    return f"The {d['document_a']} shows {a} while the {d['document_b']} shows {b}{extra}."


def _matching_discrepancy(ctx: dict, field_name: str) -> Optional[dict]:
    wanted = " ".join(field_name.lower().split())
    for d in ctx["discrepancies"]:
        if wanted and (wanted in d["field_label"].lower() or d["field_label"].lower() in wanted):
            return d
    return ctx["discrepancies"][0] if len(ctx["discrepancies"]) == 1 and not wanted else None


# ---------- "I'm not sure" ----------


def compose_question(ctx: dict, greeting: str, field_name: str, issue: str, evidence: str, ask: str) -> dict:
    """Context -> Specific issue -> Evidence -> Deadline -> Question."""
    issue_text = sentence(issue)
    if field_name and field_name.lower() not in issue_text.lower():
        issue_text = " ".join(p for p in (sentence(f"I am not sure about the {field_name.lower()}"), issue_text) if p)
    if not evidence:
        match = _matching_discrepancy(ctx, field_name)
        evidence = _discrepancy_evidence(match) if match else ""
    ask_text = " ".join((ask or "").split()).rstrip("?.")
    if ask_text:
        question = f"Could you please advise {ask_text[0].lower() + ask_text[1:]} when you have a moment?"
        if re.match(r"(?i)^(could|can|would|will|should|is|are|do|does|may)\b", ask_text):
            question = ask_text + "?"
    else:
        question = "Could you please advise how I should proceed when you have a moment?"
    parts = {
        "context": _context_sentence(ctx),
        "issue": issue_text,
        "evidence": sentence(evidence),
        "deadline": ctx["deadline_sentence"],
        "question": question,
    }
    text = " ".join(p for p in [_greeting(greeting), *parts.values()] if p)
    return {"parts": parts, "text": text}


def analyze_unsure(
    db: Session,
    user: User,
    task_id: Optional[uuid.UUID],
    field_name: str,
    issue: str,
    evidence: str,
    ask: str,
    greeting: str,
    compliance_impact: bool,
    financial_impact: bool,
) -> dict:
    task = get_task_for_user(db, user, task_id) if task_id else None
    ctx = task_context(db, user, task)
    results = knowledge_service.search(db, user, f"{field_name} {issue}", limit=5)
    signals = Signals(
        deadline_status=ctx["deadline"]["status"] if ctx["deadline"] else "NO_DEADLINE",
        open_discrepancies=len(ctx["discrepancies"]),
        missing_documents=len(ctx["missing_documents"]),
        low_confidence_fields=len(ctx["low_confidence_fields"]),
        sources_found=len(results),
        compliance_impact=compliance_impact,
        financial_impact=financial_impact,
    )
    return {
        "context": ctx,
        "knowledge": knowledge_service.public(results),
        "knowledge_message": "" if results else knowledge_service.NO_SOURCE_MESSAGE,
        "assessment": assess(signals).as_dict(),
        "draft": compose_question(ctx, greeting, field_name, issue, evidence, ask),
    }


# ---------- Clarifications ----------


def get_clarification(db: Session, user: User, clarification_id: uuid.UUID) -> Clarification:
    c = db.get(Clarification, clarification_id)
    if c is None or c.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    return c


def create_clarification(
    db: Session,
    user: User,
    task_id: Optional[uuid.UUID],
    kind: str,
    field_name: str,
    issue: str,
    evidence: str,
    question: str,
    asked_to: str,
    compliance_impact: bool = False,
) -> Clarification:
    task = get_task_for_user(db, user, task_id) if task_id else None
    c = Clarification(
        user_id=user.id,
        task_id=task.id if task else None,
        shipment_reference=task.shipment.reference if task and task.shipment else "",
        kind=kind,
        field_name=field_name.strip(),
        issue=issue.strip(),
        evidence=evidence.strip(),
        question=question.strip(),
        asked_to=asked_to.strip(),
    )
    if task is not None:
        # The open question stays visible on the task until the answer is recorded
        c.task_issue_id = secrets.token_hex(6)
        who = f" {asked_to.strip()}" if asked_to.strip() else ""
        verb = "Escalated to" if kind == "ESCALATION" else "Asked"
        topic = field_name.strip() or issue.strip()
        task.issues = [
            *(task.issues or []),
            {
                "id": c.task_issue_id,
                "type": "COMPLIANCE_QUESTION" if compliance_impact else "OTHER",
                "description": f"{verb}{who}: {topic}"[:500],
                "resolved": False,
                "created_at": utcnow().isoformat(),
                "resolved_at": None,
                "source": "clarification",
            },
        ]
        refresh_priority(task, get_user_settings(db, user))
    db.add(c)
    db.flush()
    action = "ESCALATION_CREATED" if kind == "ESCALATION" else "CLARIFICATION_CREATED"
    audit_service.log(db, user.id, action, "clarification", c.id, new_state={"status": "OPEN"},
                      metadata={"task_id": str(task.id) if task else None})
    db.commit()
    return c


def _close_task_issue(db: Session, user: User, c: Clarification, note: str) -> None:
    if not c.task_id or not c.task_issue_id:
        return
    task = db.get(Task, c.task_id)
    if task is None:
        return
    now = utcnow()
    task.issues = [
        {**i, "resolved": True, "resolved_at": now.isoformat()} if i.get("id") == c.task_issue_id else i
        for i in task.issues or []
    ]
    if note:
        stamp = now.strftime("%Y-%m-%d %H:%M UTC")
        task.notes = (task.notes + "\n" if task.notes else "") + f"[{stamp}] {note}"
    refresh_priority(task, get_user_settings(db, user))


def answer_clarification(
    db: Session, user: User, c: Clarification, answer: str, save_to_knowledge: bool, verified: bool
) -> Clarification:
    if c.status != "OPEN":
        raise HTTPException(status.HTTP_409_CONFLICT, "This question is already closed.")
    if not answer.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Record the answer you received.")
    c.status, c.answer, c.answered_at = "ANSWERED", answer.strip(), utcnow()
    who = f" from {c.asked_to}" if c.asked_to else ""
    _close_task_issue(db, user, c, f"Answer{who}: {answer.strip()[:300]}")
    if save_to_knowledge:
        title = c.field_name or c.issue[:120] or "Answered question"
        body = f"Question: {c.issue or c.question}\nAnswer: {c.answer}"
        if c.shipment_reference:
            body += f"\nCase: {c.shipment_reference}"
        stamp = c.answered_at.strftime("%d %b %Y")
        source = f"{c.asked_to}, {stamp}" if c.asked_to else stamp
        note = knowledge_service.create_note(
            db, user, title[:200], body, "RESOLVED_QUESTION", source, verified=verified
        )
        c.knowledge_note_id = note.id
    audit_service.log(db, user.id, "CLARIFICATION_ANSWERED", "clarification", c.id,
                      previous_state={"status": "OPEN"}, new_state={"status": "ANSWERED"})
    db.commit()
    return c


def cancel_clarification(db: Session, user: User, c: Clarification) -> Clarification:
    if c.status != "OPEN":
        raise HTTPException(status.HTTP_409_CONFLICT, "This question is already closed.")
    c.status = "CANCELLED"
    _close_task_issue(db, user, c, "")
    audit_service.log(db, user.id, "CLARIFICATION_CANCELLED", "clarification", c.id,
                      previous_state={"status": "OPEN"}, new_state={"status": "CANCELLED"})
    db.commit()
    return c


def clarification_out(c: Clarification) -> dict:
    return {
        "id": c.id,
        "task_id": c.task_id,
        "shipment_reference": c.shipment_reference,
        "kind": c.kind,
        "field_name": c.field_name,
        "issue": c.issue,
        "evidence": c.evidence,
        "question": c.question,
        "asked_to": c.asked_to,
        "status": c.status,
        "answer": c.answer,
        "answered_at": c.answered_at,
        "knowledge_note_id": c.knowledge_note_id,
        "created_at": c.created_at,
    }


# ---------- Communication drafts ----------


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def generate_draft(
    db: Session,
    user: User,
    kind: str,
    task_id: Optional[uuid.UUID],
    discrepancy_id: Optional[uuid.UUID],
    error_id: Optional[uuid.UUID],
    greeting: str,
    note: str,
) -> dict:
    """Context -> Issue -> Evidence -> Deadline -> Requested action, from the user's own records."""
    error = None
    if kind == "CORRECTION":
        if not error_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose the error report this correction is about.")
        error = db.get(ErrorReport, error_id)
        if error is None or error.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Error report not found")
        task_id = task_id or error.task_id
    task = get_task_for_user(db, user, task_id) if task_id else None
    if task is None and kind not in ("CORRECTION", "CLARIFICATION"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose the task this message is about.")
    if task is None and kind == "CLARIFICATION" and not note.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a task or describe what you need clarified.")
    ctx = task_context(db, user, task)
    ref = ctx["shipment_reference"] or (error.shipment_reference if error else "")
    note_text = sentence(note)

    context = _context_sentence(ctx) if ctx["shipment_reference"] else (
        f"This is about shipment {ref}." if ref else ""
    )
    issue = evidence = request = ""

    if kind == "CLARIFICATION":
        issue = note_text or "I need a clarification before I can continue."
        request = "Could you please advise how I should proceed?"
    elif kind == "MISSING_DOCUMENT":
        missing = ctx["missing_documents"]
        if not missing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This task has no missing documents.")
        issue = f"I have not yet received the {_join(missing)}."
        if ctx["available_documents"]:
            evidence = f"Received so far: {_join(ctx['available_documents'])}."
        request = f"Could you please send the {_join(missing)} as soon as possible?"
    elif kind == "DISCREPANCY":
        d = next((x for x in ctx["discrepancies"] if x["id"] == discrepancy_id), None) if discrepancy_id else None
        d = d or (ctx["discrepancies"][0] if ctx["discrepancies"] else None)
        if d is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "There is no open discrepancy for this shipment.")
        issue = (
            f"I found a difference in the {d['field_label'].lower()} "
            f"between the {d['document_a']} and the {d['document_b']}."
        )
        evidence = _discrepancy_evidence(d)
        request = "Could you please confirm which value is correct, or send a corrected document?"
    elif kind == "ESCALATION":
        points = []
        if ctx["discrepancies"]:
            n = len(ctx["discrepancies"])
            points.append(f"{n} open document discrepanc{'y' if n == 1 else 'ies'}")
        if ctx["missing_documents"]:
            points.append(f"missing {_join(ctx['missing_documents'])}")
        if ctx["low_confidence_fields"]:
            points.append(f"{len(ctx['low_confidence_fields'])} field(s) that are hard to read")
        issue = note_text or "I need your guidance before I can complete this shipment."
        evidence = f"Open points: {_join(points)}." if points else ""
        request = "Could you please advise how to proceed?"
    elif kind == "CORRECTION":
        assert error is not None
        wrong = f" was entered as {error.incorrect_value}" if error.incorrect_value else " was entered incorrectly"
        right = f" The correct value is {error.correct_value}" if error.correct_value else ""
        source = f" (source: {error.source_document})" if error.source_document and right else ""
        issue = f"I found an error in data that was already submitted: the {error.field_name}{wrong}."
        evidence = f"{right.strip()}{source}." if right else ""
        request = (
            "The correction has been completed."
            if error.status == "RESOLVED"
            else "I am correcting it and will confirm once it is done."
        )
        if note_text:
            request = f"{note_text} {request}"
    elif kind == "STATUS_UPDATE":
        issue = f"Current status: {ctx['status_label'].lower()}."
        total = len(ctx["available_documents"]) + len(ctx["missing_documents"])
        bits = [f"documents received: {len(ctx['available_documents'])} of {total}"] if total else []
        if ctx["missing_documents"]:
            bits.append(f"still missing: {_join(ctx['missing_documents'])}")
        if ctx["open_issues"]:
            bits.append(f"open points: {ctx['open_issues']}")
        evidence = sentence(", ".join(bits)) if bits else ""
        request = note_text or "I will send another update when the status changes."
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown message type.")

    parts = {
        "context": context,
        "issue": sentence(issue),
        "evidence": sentence(evidence),
        "deadline": ctx["deadline_sentence"] if kind != "CORRECTION" else "",
        "request": sentence(request),
    }
    paragraphs = [
        " ".join(p for p in (parts["context"], parts["issue"]) if p),
        parts["evidence"],
        parts["deadline"],
        parts["request"],
    ]
    body = "\n\n".join([_greeting(greeting), *[p for p in paragraphs if p], "Thank you."])
    subject = f"{ref}: {DRAFT_LABEL[kind]}" if ref else DRAFT_LABEL[kind]
    return {
        "kind": kind,
        "task_id": ctx["task_id"],
        "shipment_reference": ref,
        "subject": subject,
        "body": body,
        "parts": parts,
    }


def get_draft(db: Session, user: User, draft_id: uuid.UUID) -> CommunicationDraft:
    d = db.get(CommunicationDraft, draft_id)
    if d is None or d.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    return d


def save_draft(
    db: Session, user: User, kind: str, task_id: Optional[uuid.UUID], recipient: str, subject: str, body: str
) -> CommunicationDraft:
    task = get_task_for_user(db, user, task_id) if task_id else None
    d = CommunicationDraft(
        user_id=user.id,
        task_id=task.id if task else None,
        shipment_reference=task.shipment.reference if task and task.shipment else "",
        kind=kind,
        recipient=recipient.strip(),
        subject=subject.strip(),
        body=body.strip(),
    )
    db.add(d)
    db.flush()
    audit_service.log(db, user.id, "MESSAGE_DRAFTED", "draft", d.id, new_state={"kind": kind, "status": "DRAFT"})
    db.commit()
    return d


def mark_sent(db: Session, user: User, d: CommunicationDraft) -> CommunicationDraft:
    if d.status == "SENT_MANUALLY":
        raise HTTPException(status.HTTP_409_CONFLICT, "This draft is already marked as sent.")
    d.status, d.sent_at = "SENT_MANUALLY", utcnow()
    audit_service.log(db, user.id, "MESSAGE_MARKED_SENT", "draft", d.id,
                      previous_state={"status": "DRAFT"}, new_state={"status": "SENT_MANUALLY"})
    db.commit()
    return d


def draft_out(d: CommunicationDraft) -> dict:
    return {
        "id": d.id,
        "task_id": d.task_id,
        "shipment_reference": d.shipment_reference,
        "kind": d.kind,
        "kind_label": DRAFT_LABEL.get(d.kind, d.kind),
        "recipient": d.recipient,
        "subject": d.subject,
        "body": d.body,
        "status": d.status,
        "sent_at": d.sent_at,
        "created_at": d.created_at,
        "updated_at": d.updated_at,
    }


# ---------- AI rewrite (optional) ----------

_FACT = re.compile(r"[A-Za-z0-9][A-Za-z0-9\-/.:,]*")


def facts(text: str) -> set[str]:
    """Numbers, references, dates and times: every token that contains a digit."""
    out = set()
    for token in _FACT.findall(text):
        if not any(ch.isdigit() for ch in token):
            continue
        token = token.rstrip(".,:")
        token = re.sub(r"(?<=\d),(?=\d{3}\b)", "", token)  # 1,500 == 1500
        out.add(token.upper())
    return out


def rewrite(db: Session, user: User, text: str) -> dict:
    if not knowledge_service.ai_assist_allowed(db, user):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "AI writing help is off. Switch it on in Settings if your organization permits it.",
        )
    try:
        new_text = get_provider().rewrite_message(text)
    except ProviderError as exc:
        return {"text": text, "changed": False, "kept_original": True, "message": str(exc)}
    lost = sorted(facts(text) - facts(new_text))
    audit_service.log(db, user.id, "MESSAGE_REWRITTEN", "assistant", None, metadata={"accepted": not lost})
    db.commit()
    if lost:
        return {
            "text": text,
            "changed": False,
            "kept_original": True,
            "message": f"The AI changed or dropped a fact ({', '.join(lost[:5])}). Your original text is kept.",
        }
    return {
        "text": new_text,
        "changed": new_text != text,
        "kept_original": False,
        "message": "Wording improved. All numbers and references were kept. Review it before sending.",
    }


# ---------- Error analysis and adaptive checklist ----------

CATEGORY_CHECK = {
    "TYPOGRAPHICAL": "Typed values re-read against the source before saving",
    "DATA_READING": "Each value read twice on the source document before entering it",
    "DATA_ENTRY": "Entered data compared with the source, field by field",
    "MISSING_INFORMATION": "All required fields filled before submission",
    "CROSS_DOCUMENT": "Key values compared across Invoice, Packing List and BL/AWB",
    "SOP_PROCEDURE": "Relevant SOP step checked for this shipment type",
    "COMMUNICATION": "Open questions confirmed in writing",
    "TIME_MANAGEMENT": "Remaining time checked before starting the task",
}


def _suggested_item(pattern: dict) -> Optional[str]:
    if pattern["kind"] == "FIELD":
        topic = pattern["key"]
        return f"{topic[0].upper() + topic[1:]} checked against the source document, including the unit"
    return CATEGORY_CHECK.get(pattern["key"])


def checklist_suggestions(db: Session, user: User, patterns: list[dict]) -> list[dict]:
    dismissed = set(knowledge_service.get_assistant_settings(db, user).dismissed_suggestions or [])
    current = {i.lower() for i in (get_doc_settings(db, user).final_checklist or [])}
    out = []
    for p in patterns:
        key = f"{p['kind']}:{p['key']}"
        item = _suggested_item(p)
        if not item or key in dismissed or item.lower() in current:
            continue
        out.append({"key": key, "count": p["count"], "message": p["message"], "item": item})
    return out


def insights(db: Session, user: User, days: int = 30) -> dict:
    now = utcnow()
    all_errors = list(db.scalars(select(ErrorReport).where(ErrorReport.user_id == user.id)).all())
    period = [e for e in all_errors if e.created_at >= now - timedelta(days=days)]
    patterns = recurring_patterns(all_errors, now)

    lines: list[str] = []
    if period:
        fields = Counter(" ".join(e.field_name.lower().split()) for e in period).most_common(3)
        lines.append(
            f"{len(period)} error{'s' if len(period) != 1 else ''} in the last {days} days. Most frequent field"
            f"{'s' if len(fields) > 1 else ''}: " + ", ".join(f"{f} ({n})" for f, n in fields) + "."
        )
        cats = Counter(e.category for e in period).most_common(2)
        lines.append("Most common type: " + ", ".join(f"{CATEGORY_LABEL[c].lower()} ({n})" for c, n in cats) + ".")
        causes = Counter(e.root_cause for e in period if e.root_cause).most_common(2)
        if causes:
            lines.append(
                "Root causes you recorded most: "
                + ", ".join(f"{CATEGORY_LABEL.get(c, c).lower()} ({n})" for c, n in causes)
                + "."
            )
        missing_rca = sum(1 for e in period if e.status == "RESOLVED" and not e.root_cause)
        if missing_rca:
            lines.append(
                f"{missing_rca} resolved error{'s have' if missing_rca > 1 else ' has'} no root-cause analysis yet. "
                "Adding it makes patterns easier to see."
            )
        prevention = [e.prevention_action for e in period if e.prevention_action.strip()]
        if prevention:
            lines.append(f"You recorded {len(prevention)} prevention action{'s' if len(prevention) > 1 else ''}. "
                         "Check that they are part of your routine.")
    else:
        lines.append(f"No errors recorded in the last {days} days.")

    return {
        "days": days,
        "total": len(period),
        "open": sum(1 for e in period if e.status != "RESOLVED"),
        "insights": lines,
        "patterns": patterns,
        "suggestions": checklist_suggestions(db, user, patterns),
        "note": "Personal indicators for your own improvement. Not an official evaluation.",
    }


def accept_suggestion(db: Session, user: User, key: str, item: str) -> list[str]:
    """Adds an item to the personal checklist, only after the user confirmed it."""
    now = utcnow()
    errors = list(db.scalars(select(ErrorReport).where(ErrorReport.user_id == user.id)).all())
    current = {s["key"]: s for s in checklist_suggestions(db, user, recurring_patterns(errors, now))}
    if key not in current:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This suggestion is no longer available.")
    text = " ".join((item or current[key]["item"]).split())[:120]
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The checklist item cannot be empty.")
    doc_settings = get_doc_settings(db, user)
    checklist = list(doc_settings.final_checklist or [])
    if len(checklist) >= 25:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your checklist already has 25 items. Remove one first.")
    if text.lower() not in {i.lower() for i in checklist}:
        checklist.append(text)
    doc_settings.final_checklist = checklist
    settings = knowledge_service.get_assistant_settings(db, user)
    # Remember the key so the same pattern is not suggested again after an edited item was added
    settings.dismissed_suggestions = [*(settings.dismissed_suggestions or []), key]
    audit_service.log(db, user.id, "CHECKLIST_UPDATED", "settings", user.id,
                      metadata={"source": "suggestion", "items": len(checklist)})
    db.commit()
    return checklist


def dismiss_suggestion(db: Session, user: User, key: str) -> None:
    settings = knowledge_service.get_assistant_settings(db, user)
    if key not in (settings.dismissed_suggestions or []):
        settings.dismissed_suggestions = [*(settings.dismissed_suggestions or []), key]
    db.commit()
