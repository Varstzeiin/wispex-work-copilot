"""Fictional sample documents, generated as small text PDFs.

They let anyone try the upload, extraction and cross-document check without real company data.
All companies, references and values are invented.
"""

SAMPLE_REFERENCE = "SHP-DEMO-7"

SAMPLES: dict[str, dict] = {
    "invoice": {
        "filename": "SHP-DEMO-7_Invoice_v1.pdf",
        "title": "COMMERCIAL INVOICE",
        "lines": [
            "Invoice number: INV-2026-0107",
            "Invoice date: 2026-09-18",
            "Seller: Example Exporter Ltd (fictional)",
            "Buyer: Example Importer PT (fictional)",
            "Consignee: Example Importer PT (fictional)",
            f"Shipment reference: {SAMPLE_REFERENCE}",
            "Currency: EUR",
            "Total value: 18,450.00",
            "Quantity: 1,500",
            "Quantity unit: PCS",
            "Net weight: 850",
            "Gross weight: 910",
            "Weight unit: KG",
            "Product description: Stainless steel kitchen bowls, 3 sizes",
        ],
    },
    "invoice_v2": {
        "filename": "SHP-DEMO-7_Invoice_v2.pdf",
        "title": "COMMERCIAL INVOICE",
        "lines": [
            "Invoice number: INV-2026-0107",
            "Invoice date: 2026-09-19",
            "Seller: Example Exporter Ltd (fictional)",
            "Buyer: Example Importer PT (fictional)",
            "Consignee: Example Importer PT (fictional)",
            f"Shipment reference: {SAMPLE_REFERENCE}",
            "Currency: EUR",
            "Total value: 19,065.00",
            "Quantity: 1,550",
            "Quantity unit: PCS",
            "Net weight: 890",
            "Gross weight: 950",
            "Weight unit: KG",
            "Product description: Stainless steel kitchen bowls, 3 sizes",
        ],
    },
    "packing_list": {
        "filename": "SHP-DEMO-7_PackingList.pdf",
        "title": "PACKING LIST",
        "lines": [
            "Invoice number: INV-2026-0107",
            "Document date: 2026-09-18",
            f"Shipment reference: {SAMPLE_REFERENCE}",
            "Consignee: Example Importer PT (fictional)",
            "Quantity: 1,550",
            "Quantity unit: PCS",
            "Net weight: 890",
            "Gross weight: 950 (unclear)",
            "Weight unit: KG",
            "Product description: Stainless steel bowls in 3 sizes",
        ],
    },
    "bill_of_lading": {
        "filename": "SHP-DEMO-7_BL.pdf",
        "title": "BILL OF LADING",
        "lines": [
            "Transport document number: BL-EX-445210",
            "Document date: 2026-09-20",
            f"Shipment reference: {SAMPLE_REFERENCE}",
            "Consignee: Example Importer PT (fictional)",
            "Gross weight: 950",
            "Weight unit: KG",
            "Product description: Kitchenware",
        ],
    },
}


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(title: str, lines: list[str]) -> bytes:
    """A minimal single-page PDF with a real text layer (Helvetica)."""
    text_ops = ["BT", "/F1 16 Tf", "50 790 Td", f"({_escape(title)}) Tj", "/F1 11 Tf", "0 -30 Td", "16 TL"]
    text_ops += [f"({_escape(line)}) Tj T*" for line in lines]
    text_ops += ["0 -20 Td", "(FICTIONAL SAMPLE DOCUMENT - NOT A REAL SHIPMENT) Tj", "ET"]
    stream = "\n".join(text_ops).encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def sample_pdf(key: str) -> tuple[str, bytes]:
    spec = SAMPLES[key]
    return spec["filename"], build_pdf(spec["title"], spec["lines"])
