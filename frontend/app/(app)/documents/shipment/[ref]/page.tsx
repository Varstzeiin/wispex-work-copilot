"use client";

import clsx from "clsx";
import { ArrowLeft, CheckCircle2, CircleSlash, FileWarning, Layers, Scale, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { DiscrepancyCard } from "@/components/document/DiscrepancyCard";
import { Badge, Card, EmptyState, ErrorState, LinkButton, SectionTitle, Spinner } from "@/components/ui";
import { useShipment } from "@/features/document-ai/hooks";
import { errorMessage } from "@/lib/api/client";
import { useSettings } from "@/lib/hooks";
import { DOC_FIELD_LABEL, DOC_TYPE_LABEL, PROCESSING_STATUS } from "@/lib/utils/labels";
import { formatDateTime } from "@/lib/utils/time";

export default function ShipmentDocumentsPage() {
  const { ref } = useParams<{ ref: string }>();
  const reference = decodeURIComponent(ref);
  const router = useRouter();
  const { timezone } = useSettings();
  const { data, error, mutate } = useShipment(reference);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;

  const c = data.completeness;
  const open = data.discrepancies.filter((d) => d.status === "OPEN");
  const closed = data.discrepancies.filter((d) => d.status !== "OPEN");
  const mismatches = data.comparisons.filter((x) => x.status === "POTENTIAL_MISMATCH");

  return (
    <div className="space-y-4">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-slate-600">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{data.shipment_reference}</h1>
          {data.task_id && (
            <Link href={`/tasks/${data.task_id}`} className="text-sm font-semibold text-brand-700">
              Open task
            </Link>
          )}
        </div>
        <LinkButton href={`/documents/upload?ref=${encodeURIComponent(reference)}${data.task_id ? `&task=${data.task_id}` : ""}`}>
          <Upload className="h-4 w-4" aria-hidden /> Add documents
        </LinkButton>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>Completeness</SectionTitle>
          <span className={clsx("text-lg font-bold tabular-nums", c.missing.length ? "text-orange-700" : "text-emerald-700")}>
            {c.available} / {c.total} documents available
          </span>
        </div>
        <ul className="flex flex-wrap gap-2 text-sm">
          {c.required.map((r) => {
            const missing = c.missing.includes(r);
            return (
              <li key={r} className={clsx("flex items-center gap-1 rounded-full px-2.5 py-1", missing ? "bg-orange-50 text-orange-900" : "bg-emerald-50 text-emerald-800")}>
                {missing ? <FileWarning className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                {r}
                <span className="sr-only">{missing ? "missing" : "available"}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {data.notes.map((n) => (
        <p key={n} className="flex items-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
          <Layers className="h-4 w-4 shrink-0" aria-hidden /> {n} Open one of the versions below to compare them.
        </p>
      ))}

      <section>
        <SectionTitle>Cross-document check</SectionTitle>
        {open.length === 0 && mismatches.length === 0 ? (
          <EmptyState title="No potential mismatches found">
            Comparisons only cover values that were found. Still verify against the source documents.
          </EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {open.map((d) => (
              <DiscrepancyCard key={d.id} d={d} />
            ))}
          </div>
        )}
      </section>

      {data.comparisons.length > 0 && (
        <Card>
          <SectionTitle>All comparisons</SectionTitle>
          {/* A list instead of a table, so the result stays visible on narrow phones */}
          <ul className="divide-y divide-slate-100">
            {data.comparisons.map((x, i) => (
              <li key={`${x.field}-${x.document_b}-${i}`} className="py-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-slate-900">{DOC_FIELD_LABEL[x.field] ?? x.field}</span>
                  {x.status === "MATCH" ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" aria-hidden /> Match
                    </span>
                  ) : x.status === "POTENTIAL_MISMATCH" ? (
                    <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-red-700">
                      <Scale className="h-4 w-4" aria-hidden /> Mismatch{x.difference && x.difference !== "different" ? ` (${x.difference})` : ""}
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 text-slate-500">
                      <CircleSlash className="h-4 w-4" aria-hidden /> Cannot compare
                    </span>
                  )}
                </div>
                <dl className="mt-1 grid grid-cols-2 gap-2">
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">{x.document_a}</dt>
                    <dd className="break-words text-slate-800">{x.value_a ?? "—"}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">{x.document_b}</dt>
                    <dd className="break-words text-slate-800">{x.value_b ?? "—"}</dd>
                  </div>
                </dl>
                {x.note && x.status !== "MATCH" && <p className="mt-1 text-xs text-slate-500">{x.note}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            A match only means the values agree with each other. The system never decides which document is correct.
          </p>
        </Card>
      )}

      <Card>
        <SectionTitle>Documents</SectionTitle>
        <ul className="divide-y divide-slate-100">
          {data.documents.map((d) => (
            <li key={d.id}>
              <Link href={`/documents/${d.id}`} className="flex items-center justify-between gap-2 py-2.5 text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="font-semibold text-slate-900">{DOC_TYPE_LABEL[d.document_type]}</span>
                  {d.version_count > 1 && (
                    <Badge className={clsx("ml-2", d.is_active_version ? "bg-emerald-100 text-emerald-800" : "bg-violet-100 text-violet-800")}>
                      {d.is_active_version ? "Chosen version" : "Version"}
                    </Badge>
                  )}
                  <span className="block truncate text-xs text-slate-500">
                    {d.original_filename} · {formatDateTime(d.uploaded_at, timezone)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {d.review_count > 0 && <Badge className="bg-amber-100 text-amber-900">{d.review_count} to review</Badge>}
                  <Badge className={PROCESSING_STATUS[d.processing_status].style}>{PROCESSING_STATUS[d.processing_status].label}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {closed.length > 0 && (
        <section>
          <SectionTitle>Closed discrepancies</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {closed.map((d) => (
              <DiscrepancyCard key={d.id} d={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
