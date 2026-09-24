"""When is escalation worth recommending?

The rule is deliberately conservative: escalation is recommended only when uncertainty meets a real
risk (a close deadline, a stated compliance or financial impact). Small uncertainties get
"verify first" or "ask a colleague" instead. The employee always decides.
"""

from dataclasses import dataclass, field


def _n(count: int, word: str, many: str = "") -> str:
    return f"{count} {word if count == 1 else (many or word + 's')}"


@dataclass
class Signals:
    deadline_status: str = "NO_DEADLINE"  # SAFE | WATCH | URGENT | CRITICAL | OVERDUE | NO_DEADLINE
    open_discrepancies: int = 0
    missing_documents: int = 0
    low_confidence_fields: int = 0
    sources_found: int = 0
    compliance_impact: bool = False
    financial_impact: bool = False


@dataclass
class Assessment:
    recommendation: str  # VERIFY | ASK | ESCALATE
    headline: str
    triggers: list[dict] = field(default_factory=list)
    steps: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "recommendation": self.recommendation,
            "headline": self.headline,
            "triggers": self.triggers,
            "steps": self.steps,
        }


HEADLINES = {
    "VERIFY": "Verify first. Your trusted sources may already answer this.",
    "ASK": "Ask a precise question. Continue with the verified parts meanwhile.",
    "ESCALATE": "Consider escalating to your supervisor according to the SOP, and document it.",
}


def assess(s: Signals) -> Assessment:
    triggers: list[dict] = []

    def add(key: str, label: str) -> None:
        triggers.append({"key": key, "label": label})

    tight = s.deadline_status in ("CRITICAL", "OVERDUE")
    if s.deadline_status == "OVERDUE":
        add("DEADLINE", "The submission deadline has passed")
    elif s.deadline_status == "CRITICAL":
        add("DEADLINE", "The submission deadline is close")
    if s.open_discrepancies:
        add("CONFLICT", f"{_n(s.open_discrepancies, 'open document discrepancy', 'open document discrepancies')}")
    if s.missing_documents:
        add("MISSING_DOCUMENT", f"{_n(s.missing_documents, 'required document')} missing")
    if s.low_confidence_fields:
        add("LOW_CONFIDENCE", f"{_n(s.low_confidence_fields, 'field')} still to review")
    if not s.sources_found:
        add("NO_SOURCE", "No reliable source found in your knowledge base")
    if s.compliance_impact:
        add("COMPLIANCE", "Possible compliance impact")
    if s.financial_impact:
        add("FINANCIAL", "Possible financial or client impact")

    blocking = s.open_discrepancies or s.missing_documents or not s.sources_found
    if s.compliance_impact or s.financial_impact or (tight and blocking):
        rec = "ESCALATE"
    elif blocking or s.low_confidence_fields:
        rec = "ASK"
    else:
        rec = "VERIFY"

    steps = [
        {"key": "verify", "label": "Verify against the source document", "done": False},
        {
            "key": "search",
            "label": "Search documentation and your knowledge base",
            "done": True,
            "note": f"{_n(s.sources_found, 'matching source')} found",
        },
        {"key": "alternatives", "label": "Check alternatives (other documents, earlier cases)", "done": False},
        {"key": "ask", "label": "Ask an appropriate team member if applicable", "done": False},
        {"key": "escalate", "label": "Escalate to your supervisor when necessary", "done": False},
        {"key": "document", "label": "Document the question or escalation and the answer", "done": False},
    ]
    return Assessment(rec, HEADLINES[rec], triggers, steps)
