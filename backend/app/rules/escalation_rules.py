"""When is escalation worth recommending?

The rule is deliberately conservative: escalation is recommended only when uncertainty meets a real
risk (a close deadline, a stated compliance or financial impact). Small uncertainties get
"verify first" or "ask a colleague" instead. The employee always decides.
"""

from dataclasses import dataclass, field

from app.core.i18n import tr


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
HEADLINES_ID = {
    "VERIFY": "Verifikasi dulu. Sumber terpercaya kamu mungkin sudah menjawab ini.",
    "ASK": "Ajukan pertanyaan yang jelas. Sambil menunggu, lanjutkan bagian yang sudah terverifikasi.",
    "ESCALATE": "Pertimbangkan eskalasi ke supervisor sesuai SOP, lalu catat.",
}


def assess(s: Signals) -> Assessment:
    triggers: list[dict] = []

    def add(key: str, label: str) -> None:
        triggers.append({"key": key, "label": label})

    tight = s.deadline_status in ("CRITICAL", "OVERDUE")
    if s.deadline_status == "OVERDUE":
        add("DEADLINE", tr("The submission deadline has passed", "Deadline pengiriman sudah lewat"))
    elif s.deadline_status == "CRITICAL":
        add("DEADLINE", tr("The submission deadline is close", "Deadline pengiriman sudah dekat"))
    if s.open_discrepancies:
        n = s.open_discrepancies
        add(
            "CONFLICT",
            tr(_n(n, "open document discrepancy", "open document discrepancies"), f"{n} perbedaan dokumen terbuka"),
        )
    if s.missing_documents:
        n = s.missing_documents
        add("MISSING_DOCUMENT", tr(f"{_n(n, 'required document')} missing", f"{n} dokumen wajib belum ada"))
    if s.low_confidence_fields:
        n = s.low_confidence_fields
        add("LOW_CONFIDENCE", tr(f"{_n(n, 'field')} still to review", f"{n} field masih perlu dicek"))
    if not s.sources_found:
        add(
            "NO_SOURCE",
            tr("No reliable source found in your knowledge base", "Belum ada sumber terpercaya di knowledge base kamu"),
        )
    if s.compliance_impact:
        add("COMPLIANCE", tr("Possible compliance impact", "Kemungkinan berdampak pada kepatuhan"))
    if s.financial_impact:
        add("FINANCIAL", tr("Possible financial or client impact", "Kemungkinan berdampak pada keuangan atau klien"))

    blocking = s.open_discrepancies or s.missing_documents or not s.sources_found
    if s.compliance_impact or s.financial_impact or (tight and blocking):
        rec = "ESCALATE"
    elif blocking or s.low_confidence_fields:
        rec = "ASK"
    else:
        rec = "VERIFY"

    steps = [
        {"key": "verify", "label": tr(
            "Verify against the source document",
            "Verifikasi dengan dokumen sumber",
        ), "done": False},
        {
            "key": "search",
            "label": tr("Search documentation and your knowledge base", "Cari di dokumentasi dan knowledge base kamu"),
            "done": True,
            "note": tr(
                f"{_n(s.sources_found, 'matching source')} found",
                f"{s.sources_found} sumber yang cocok ditemukan",
            ),
        },
        {
            "key": "alternatives",
            "label": tr(
                "Check alternatives (other documents, earlier cases)", "Cek alternatif (dokumen lain, kasus sebelumnya)"
            ),
            "done": False,
        },
        {
            "key": "ask",
            "label": tr("Ask an appropriate team member if applicable", "Tanya anggota tim yang tepat kalau perlu"),
            "done": False,
        },
        {
            "key": "escalate",
            "label": tr("Escalate to your supervisor when necessary", "Eskalasi ke supervisor kalau diperlukan"),
            "done": False,
        },
        {
            "key": "document",
            "label": tr(
                "Document the question or escalation and the answer",
                "Catat pertanyaan atau eskalasi beserta jawabannya",
            ),
            "done": False,
        },
    ]
    return Assessment(rec, tr(HEADLINES[rec], HEADLINES_ID[rec]), triggers, steps)
