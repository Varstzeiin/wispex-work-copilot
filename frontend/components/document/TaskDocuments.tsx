"use client";

import { Scale, Upload } from "lucide-react";
import Link from "next/link";

import { Badge, Card, LinkButton, SectionTitle } from "@/components/ui";
import { useShipment } from "@/features/document-ai/hooks";
import { DOC_TYPE_LABEL, PROCESSING_STATUS } from "@/lib/utils/labels";
import type { Task } from "@/types";

/** Uploaded documents and open document-check discrepancies for the task's shipment. */
export function TaskDocuments({ task }: { task: Task }) {
  const ref = task.shipment_reference;
  const { data, error } = useShipment(ref ?? null);
  const uploadHref = `/documents/upload?task=${task.id}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`;
  const open = data?.discrepancies.filter((d) => d.status === "OPEN") ?? [];

  return (
    <Card>
      <SectionTitle
        action={
          <LinkButton href={uploadHref} variant="ghost" className="min-h-8 px-2 text-brand-700">
            <Upload className="h-4 w-4" aria-hidden /> Upload
          </LinkButton>
        }
      >
        Uploaded documents
      </SectionTitle>
      {!ref && <p className="text-sm text-slate-500">Add a shipment reference to the task to group its documents.</p>}
      {ref && (error || !data) && <p className="text-sm text-slate-500">{error ? "No documents uploaded for this shipment yet." : "Loading…"}</p>}
      {data && (
        <>
          <ul className="space-y-1.5 text-sm">
            {data.documents.map((d) => (
              <li key={d.id}>
                <Link href={`/documents/${d.id}`} className="flex items-center justify-between gap-2 hover:underline">
                  <span className="truncate">
                    {DOC_TYPE_LABEL[d.document_type]}
                    {d.version_count > 1 && !d.is_active_version && <span className="text-xs text-violet-700"> (other version)</span>}
                  </span>
                  <Badge className={PROCESSING_STATUS[d.processing_status].style}>{PROCESSING_STATUS[d.processing_status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
          {open.length > 0 && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
              <Scale className="h-4 w-4 shrink-0" aria-hidden /> {open.length} potential mismatch{open.length > 1 ? "es" : ""} between documents
            </p>
          )}
          <Link href={`/documents/shipment/${encodeURIComponent(ref!)}`} className="mt-2 inline-block text-sm font-semibold text-brand-700">
            Open cross-document check
          </Link>
        </>
      )}
    </Card>
  );
}
