"use client";

import { FileWarning } from "lucide-react";
import Link from "next/link";

import { ComingLater } from "@/components/ui/ComingLater";
import { Card, SectionTitle, Spinner } from "@/components/ui";
import { useTasks } from "@/features/task-management/hooks";

export default function DocumentsPage() {
  // Real, working today: missing-document overview from task document tracking
  const { data } = useTasks({ view: "open", sort: "deadline", pageSize: 100 });
  const missing = data?.items.filter((t) => t.missing_documents.length > 0) ?? [];

  return (
    <ComingLater
      title="Documents"
      phase="MVP 3 · Document intelligence"
      summary="Document upload, OCR and AI extraction are not active yet. Today you can track which required documents each task has received, directly on the task page."
      planned={[
        "Upload PDF, JPG and PNG (Commercial Invoice, Packing List, Bill of Lading, Air Waybill, supporting documents)",
        "Batch upload grouped by shipment, with completeness (e.g. 2 / 3 documents available)",
        "OCR + document understanding + structured extraction with a confidence score per field",
        "Manual review queue for low-confidence fields",
        "Cross-document comparison (quantity, weight, description, references, dates)",
        "Duplicate and version detection with a change view between versions",
      ]}
      principles={[
        "The app never declares which document is correct unless you configure an explicit rule",
        "AI output never becomes final automatically. Every discrepancy goes to human review",
        "Documents are only sent to an AI provider if your organization explicitly permits it",
      ]}
    >
      <Card>
        <SectionTitle>Missing documents across open tasks</SectionTitle>
        {!data && <Spinner />}
        {data && missing.length === 0 && <p className="text-sm text-slate-500">All open tasks have their required documents.</p>}
        <ul className="space-y-2">
          {missing.map((t) => (
            <li key={t.id}>
              <Link href={`/tasks/${t.id}`} className="flex items-start gap-2 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-900">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1">
                  <strong>{t.shipment_reference ?? t.title}</strong>
                  <span className="block text-xs">Missing: {t.missing_documents.join(", ")}</span>
                </span>
                <span className="text-xs font-semibold">{t.deadline.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </ComingLater>
  );
}
