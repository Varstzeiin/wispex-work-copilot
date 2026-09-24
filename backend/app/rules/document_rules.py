"""Deterministic validation of extracted fields.

AI output is only a first reading. These rules decide, without any AI, which fields go to the
manual review queue.
"""

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

REQUIRED_FIELDS: dict[str, list[str]] = {
    "INVOICE": ["invoice_number", "invoice_date", "currency", "total_value", "quantity"],
    "PACKING_LIST": ["quantity", "gross_weight", "net_weight", "weight_unit"],
    "BILL_OF_LADING": ["transport_document_number", "consignee", "gross_weight"],
    "AIR_WAYBILL": ["transport_document_number", "consignee", "gross_weight"],
}

NUMERIC_FIELDS = ("total_value", "quantity", "gross_weight", "net_weight")
DATE_FIELDS = ("invoice_date", "document_date")
WEIGHT_UNITS = ("KG", "LB", "G", "T")
# Common ISO 4217 codes. Anything else is not rejected, only sent for review.
KNOWN_CURRENCIES = {
    "USD",
    "EUR",
    "IDR",
    "SGD",
    "CNY",
    "JPY",
    "GBP",
    "AUD",
    "MYR",
    "THB",
    "KRW",
    "HKD",
    "INR",
    "VND",
    "PHP",
    "CHF",
    "CAD",
    "NZD",
    "TWD",
    "AED",
    "SAR",
}


def to_decimal(value: Optional[str]) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(value.strip())
    except (InvalidOperation, AttributeError):
        return None


def to_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


@dataclass
class FieldCheck:
    name: str
    value: Optional[str]
    normalized: Optional[str]
    confidence: float
    messages: list[str] = field(default_factory=list)
    required: bool = False

    def needs_review(self, threshold: float) -> bool:
        if self.messages:
            return True
        if self.value is None:
            return self.required
        return self.confidence < threshold


def validate_fields(document_type: str, fields: dict[str, dict], today: date) -> dict[str, FieldCheck]:
    """fields: name -> {"value", "normalized", "confidence"}. Returns one check per field."""
    required = set(REQUIRED_FIELDS.get(document_type, []))
    checks: dict[str, FieldCheck] = {}
    for name, f in fields.items():
        value, normalized = f.get("value"), f.get("normalized")
        check = FieldCheck(name, value, normalized, float(f.get("confidence") or 0.0), required=name in required)
        if value is None:
            if check.required:
                check.messages.append("Required for this document type but not found.")
        elif name in NUMERIC_FIELDS:
            number = to_decimal(normalized)
            if number is None:
                check.messages.append("Could not read this as a number.")
            elif number <= 0:
                check.messages.append("Expected a value greater than zero.")
        elif name in DATE_FIELDS:
            parsed = to_date(normalized)
            if parsed is None:
                check.messages.append("Could not read this as a date.")
            elif parsed > today + timedelta(days=366):
                check.messages.append("Date is more than a year in the future.")
        elif name == "currency":
            code = (normalized or "").upper()
            if not re.fullmatch(r"[A-Z]{3}", code):
                check.messages.append("Currency should be a 3-letter ISO code.")
            elif code not in KNOWN_CURRENCIES:
                check.messages.append("Uncommon currency code. Please confirm it.")
        elif name == "weight_unit" and (normalized or "").upper() not in WEIGHT_UNITS:
            check.messages.append("Weight unit should be KG, LB, G or T.")
        checks[name] = check

    # Cross-field rule inside one document
    gross = to_decimal(checks["gross_weight"].normalized) if "gross_weight" in checks else None
    net = to_decimal(checks["net_weight"].normalized) if "net_weight" in checks else None
    if gross is not None and net is not None and net > gross:
        msg = "Net weight is greater than gross weight on the same document."
        checks["gross_weight"].messages.append(msg)
        checks["net_weight"].messages.append(msg)
    if (gross is not None or net is not None) and "weight_unit" in checks and checks["weight_unit"].value is None:
        checks["weight_unit"].messages.append("A weight is present but its unit was not found.")
    return checks
