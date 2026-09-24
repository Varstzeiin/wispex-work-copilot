"use client";

import clsx from "clsx";
import { ChevronRight, FileWarning, Layers, Scale, TriangleAlert, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PrivacyNotice } from "@/components/document/PrivacyNotice";
import { Badge, EmptyState, ErrorState, LinkButton, PageHeader, Spinner } from "@/components/ui";
import { Tabs } from "@/components/ui/Tabs";
import { useDocumentStatus, useReviewQueue, useShipments } from "@/features/document-ai/hooks";
import { errorMessage } from "@/lib/api/client";
import { useSettings } from "@/lib/hooks";
import { DOC_FIELD_LABEL, DOC_TYPE_LABEL, PROCESSING_STATUS, confidenceStyle } from "@/lib/utils/labels";
import { formatDateTime } from "@/lib/utils/time";

export default function DocumentsPage() {
  const [tab, setTab] = useState<"shipments" | "review">("shipments");
  const { data: status } = useDocumentStatus();
  const { data: queue } = useReviewQueue();
  const reviewCount = (queue?.fields.length ?? 0) + (queue?.documents_without_type.length ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documents"
        subtitle="Upload, check and compare shipment documents. You verify every value."
        action={
          <LinkButton href="/documents/upload" variant="primary">
            <Upload className="h-4 w-4" aria-hidden /> Upload
          </LinkButton>
        }
      />
      <PrivacyNotice status={status} />
      <Tabs
        label="Documents view"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "shipments", label: "By shipment" },
          { key: "review", label: `Review queue${reviewCount ? ` (${reviewCount})` : ""}` },
        ]}
      />
      {tab === "shipments" ? <Shipments /> : <ReviewQueue />}
    </div>
  );
}

function Shipments() {
  const { timezone } = useSettings();
  const { data, error, mutate } = useShipments();
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  if (!data.length)
    return (
      <EmptyState title="No documents yet">
        <Link href="/documents/upload" className="font-semibold text-brand-700">
          Upload documents
        </Link>{" "}
        or try the fictional samples on the upload page.
      </EmptyState>
    );

  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {data.map((g) => {
        const c = g.completeness;
        const href = g.shipment_reference ? `/documents/shipment/${encodeURIComponent(g.shipment_reference)}` : null;
        const body = (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{g.shipment_reference || "Not linked to a shipment"}</p>
                <p className="text-xs text-slate-500">
                  {g.document_count} document{g.document_count === 1 ? "" : "s"} · last upload {formatDateTime(g.last_upload, timezone)}
                </p>
              </div>
              {c && (
                <span
                  className={clsx(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                    c.missing.length ? "bg-orange-100 text-orange-900" : "bg-emerald-100 text-emerald-800",
                  )}
                >
                  {c.available} / {c.total} documents
                </span>
              )}
            </div>
            {c && c.missing.length > 0 && (
              <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-orange-800">
                <FileWarning className="h-3.5 w-3.5" aria-hidden /> Missing: {c.missing.join(", ")}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {g.open_discrepancies > 0 && (
                <Badge className="bg-red-100 text-red-800">
                  <Scale className="h-3 w-3" aria-hidden /> {g.open_discrepancies} potential mismatch{g.open_discrepancies > 1 ? "es" : ""}
                </Badge>
              )}
              {g.fields_to_review > 0 && (
                <Badge className="bg-amber-100 text-amber-900">
                  <TriangleAlert className="h-3 w-3" aria-hidden /> {g.fields_to_review} to review
                </Badge>
              )}
              {g.version_choice_needed && (
                <Badge className="bg-violet-100 text-violet-800">
                  <Layers className="h-3 w-3" aria-hidden /> Choose version
                </Badge>
              )}
              {g.processing > 0 && <Badge className="bg-sky-100 text-sky-800">Analysing {g.processing}…</Badge>}
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
              {g.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {DOC_TYPE_LABEL[d.document_type]}
                    <span className="text-slate-400"> · {d.original_filename}</span>
                  </span>
                  <span className={clsx("shrink-0 rounded px-1.5 text-[10px] font-semibold", PROCESSING_STATUS[d.processing_status].style)}>
                    {PROCESSING_STATUS[d.processing_status].label}
                  </span>
                </li>
              ))}
            </ul>
          </>
        );
        return (
          <li key={g.shipment_reference || "unassigned"}>
            {href ? (
              <Link href={href} className="block rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:shadow">
                {body}
              </Link>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-3.5">
                {body}
                <p className="mt-2 text-xs text-slate-500">Open a document to link it to a shipment reference.</p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {g.documents.map((d) => (
                    <li key={d.id}>
                      <Link href={`/documents/${d.id}`} className="font-semibold text-brand-700">
                        Open {d.original_filename}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReviewQueue() {
  const { data, error, mutate } = useReviewQueue();
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  if (!data.fields.length && !data.documents_without_type.length)
    return <EmptyState title="Nothing to review">Low-confidence and failed-check fields appear here.</EmptyState>;

  return (
    <div className="space-y-3">
      {data.documents_without_type.length > 0 && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm">
          <p className="font-semibold text-violet-900">Set the document type first</p>
          <ul className="mt-1 space-y-1">
            {data.documents_without_type.map((d) => (
              <li key={d.document_id}>
                <Link href={`/documents/${d.document_id}`} className="font-medium text-violet-900 underline">
                  {d.original_filename}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="space-y-2">
        {data.fields.map((f) => (
          <li key={`${f.document_id}-${f.name}`}>
            <Link
              href={`/documents/${f.document_id}`}
              className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-white p-3 text-sm hover:shadow"
            >
              <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-slate-900">{DOC_FIELD_LABEL[f.name] ?? f.name}</span>
                <span className="text-slate-500">
                  {" "}
                  · {DOC_TYPE_LABEL[f.document_type]} · {f.shipment_reference || "no shipment"}
                </span>
                <span className="block truncate text-slate-700">
                  {f.value ?? <em className="text-slate-400">not found</em>}
                  {f.value !== null && f.source === "AI" && (
                    <span className={clsx("ml-2 text-xs font-semibold", confidenceStyle(f.confidence))}>
                      AI {Math.round(f.confidence * 100)}%
                    </span>
                  )}
                </span>
                {f.rule_messages[0] && <span className="block text-xs text-amber-800">{f.rule_messages[0]}</span>}
              </span>
              <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
