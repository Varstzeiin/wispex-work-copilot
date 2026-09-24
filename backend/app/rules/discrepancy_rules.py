"""Cross-document comparison.

Compares the same fact across two documents of one shipment and reports potential mismatches.
It never decides which document is correct: every mismatch requires human review.
"""

import hashlib
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from app.rules.document_rules import to_decimal

TYPE_LABEL = {
    "INVOICE": "Invoice",
    "PACKING_LIST": "Packing List",
    "BILL_OF_LADING": "Bill of Lading",
    "AIR_WAYBILL": "Air Waybill",
}
FIELD_LABEL = {
    "quantity": "Quantity",
    "net_weight": "Net weight",
    "gross_weight": "Gross weight",
    "product_description": "Product description",
    "invoice_number": "Invoice number",
    "consignee": "Consignee",
    "shipment_reference": "Shipment reference",
}
_KG = {"KG": Decimal("1"), "G": Decimal("0.001"), "T": Decimal("1000"), "LB": Decimal("0.45359237")}
TRANSPORT = ("BILL_OF_LADING", "AIR_WAYBILL")

# (field, document type A, document type B, kind)
COMPARISONS = [
    ("quantity", "INVOICE", "PACKING_LIST", "number"),
    ("net_weight", "INVOICE", "PACKING_LIST", "weight"),
    ("gross_weight", "INVOICE", "PACKING_LIST", "weight"),
    ("gross_weight", "PACKING_LIST", TRANSPORT, "weight"),
    ("gross_weight", "INVOICE", TRANSPORT, "weight"),
    ("invoice_number", "INVOICE", "PACKING_LIST", "text"),
    ("product_description", "INVOICE", "PACKING_LIST", "description"),
    ("consignee", "INVOICE", TRANSPORT, "description"),
    ("shipment_reference", "INVOICE", "PACKING_LIST", "text"),
    ("shipment_reference", "INVOICE", TRANSPORT, "text"),
]

IMPACT = {
    "quantity": "Quantity differences can make the declared goods inconsistent with the physical shipment.",
    "net_weight": "Weight differences can conflict with the transport document or inspection results.",
    "gross_weight": "Weight differences can conflict with the transport document or inspection results.",
    "invoice_number": "The Packing List may belong to a different invoice.",
    "product_description": "Different descriptions may point to different goods or need clarification.",
    "consignee": "A different consignee may indicate the wrong document set.",
    "shipment_reference": "The document may belong to a different shipment.",
}
ACTION = (
    "Review both source documents. The system cannot determine which value is correct. "
    "Follow the applicable procedure and ask the appropriate person if it stays unclear."
)


@dataclass
class Side:
    document_id: object
    document_type: str
    value: Optional[str]  # as written
    normalized: Optional[str]
    confidence: float
    unit: Optional[str] = None


@dataclass
class Comparison:
    field: str
    a: Side
    b: Side
    status: str  # MATCH | POTENTIAL_MISMATCH | CANNOT_COMPARE
    difference: str = ""
    note: str = ""

    @property
    def confidence(self) -> float:
        return round(min(self.a.confidence, self.b.confidence), 2)

    def signature(self, shipment_reference: str) -> str:
        raw = "|".join(
            [
                shipment_reference,
                self.field,
                str(self.a.document_id),
                str(self.b.document_id),
                self.a.normalized or "",
                self.b.normalized or "",
            ]
        )
        return hashlib.sha256(raw.encode()).hexdigest()

    def as_dict(self) -> dict:
        """Shape from the spec (section 17)."""
        return {
            "field": self.field,
            "document_a": TYPE_LABEL.get(self.a.document_type, self.a.document_type),
            "value_a": self.a.value,
            "document_b": TYPE_LABEL.get(self.b.document_type, self.b.document_type),
            "value_b": self.b.value,
            "difference": self.difference,
            "status": self.status,
            "requires_human_review": self.status != "MATCH",
            "confidence": self.confidence,
            "note": self.note,
        }


def _fmt(number: Decimal) -> str:
    text = f"{number:,.3f}".rstrip("0").rstrip(".")
    return text


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w != "fictional"}


def _similarity(a: str, b: str) -> float:
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def compare_pair(field: str, kind: str, a: Side, b: Side, tolerance_pct: float) -> Comparison:
    if a.value is None or b.value is None:
        missing = TYPE_LABEL.get(a.document_type if a.value is None else b.document_type)
        return Comparison(field, a, b, "CANNOT_COMPARE", note=f"Not found on the {missing}.")

    if kind in ("number", "weight"):
        va, vb = to_decimal(a.normalized), to_decimal(b.normalized)
        if va is None or vb is None:
            return Comparison(field, a, b, "CANNOT_COMPARE", note="One of the values is not a readable number.")
        unit = ""
        if kind == "weight":
            ua, ub = (a.unit or "").upper(), (b.unit or "").upper()
            if ua not in _KG or ub not in _KG:
                return Comparison(field, a, b, "CANNOT_COMPARE", note="Weight unit missing or unknown.")
            if ua != ub:
                va, vb, unit = va * _KG[ua], vb * _KG[ub], "KG"
            else:
                unit = ua
        diff = abs(va - vb)
        allowed = max(abs(va), abs(vb)) * Decimal(str(tolerance_pct)) / 100
        if diff <= allowed:
            return Comparison(field, a, b, "MATCH")
        return Comparison(field, a, b, "POTENTIAL_MISMATCH", difference=f"{_fmt(diff)} {unit}".strip())

    if kind == "text":
        same = re.sub(r"\s+", "", (a.normalized or a.value).upper()) == re.sub(
            r"\s+", "", (b.normalized or b.value).upper()
        )
        return Comparison(
            field, a, b, "MATCH" if same else "POTENTIAL_MISMATCH", difference="" if same else "different"
        )

    # description: wording often differs legitimately, so only flag low overlap
    score = _similarity(a.value, b.value)
    if score >= 0.6:
        return Comparison(field, a, b, "MATCH")
    return Comparison(
        field,
        a,
        b,
        "POTENTIAL_MISMATCH",
        difference=f"{round(score * 100)}% word overlap",
        note="Wording differs. This may be legitimate, but confirm the goods are the same.",
    )


def compare_documents(sides_by_type: dict[str, dict[str, Side]], tolerance_pct: float) -> list[Comparison]:
    """sides_by_type: document type -> field name -> Side (active version only)."""
    results: list[Comparison] = []
    for field, type_a, type_b, kind in COMPARISONS:
        types_b = type_b if isinstance(type_b, tuple) else (type_b,)
        for tb in types_b:
            if type_a not in sides_by_type or tb not in sides_by_type:
                continue
            a = sides_by_type[type_a].get(field)
            b = sides_by_type[tb].get(field)
            if a is None or b is None:
                continue
            results.append(compare_pair(field, kind, a, b, tolerance_pct))
    return results


def describe(c: Comparison) -> str:
    """One-line human description, e.g. for a task issue."""
    label = FIELD_LABEL.get(c.field, c.field)
    text = (
        f"Potential mismatch: {TYPE_LABEL[c.a.document_type]} {label.lower()} {c.a.value}"
        f"{' ' + c.a.unit if c.a.unit and 'weight' in c.field else ''} vs "
        f"{TYPE_LABEL[c.b.document_type]} {c.b.value}{' ' + c.b.unit if c.b.unit and 'weight' in c.field else ''}"
    )
    if c.difference and c.difference != "different":
        text += f" (difference {c.difference})"
    return text + ". Review the source documents."
