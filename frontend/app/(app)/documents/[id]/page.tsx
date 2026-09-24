"use client";

import clsx from "clsx";
import { ArrowLeft, Bot, Download, Layers, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FieldTable } from "@/components/document/FieldTable";
import { Badge, Button, Card, ErrorState, Field, InlineError, Modal, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { useDocument, useDocumentStatus, useRefreshDocuments } from "@/features/document-ai/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { DOC_FIELD_LABEL, DOC_TYPE_LABEL, PROCESSING_STATUS } from "@/lib/utils/labels";
import { formatDateTime } from "@/lib/utils/time";

const TYPES = ["INVOICE", "PACKING_LIST", "BILL_OF_LADING", "AIR_WAYBILL", "OTHER"];

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const online = useOnline();
  const refresh = useRefreshDocuments();
  const { timezone } = useSettings();
  const { data: status } = useDocumentStatus();
  const { data: doc, error, mutate } = useDocument(id);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (doc) setReference(doc.shipment_reference);
  }, [doc?.shipment_reference]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!doc) return <Spinner />;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const analysing = doc.processing_status === "QUEUED" || doc.processing_status === "PROCESSING";
  const st = PROCESSING_STATUS[doc.processing_status];
  const canReprocess = status?.ai_allowed && doc.has_file && ["FAILED", "NEEDS_REVIEW", "AI_NOT_PERMITTED", "EXTRACTED"].includes(doc.processing_status);

  return (
    <div className="space-y-4">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-slate-600">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">{DOC_TYPE_LABEL[doc.document_type]}</h1>
          <p className="truncate text-sm text-slate-500">
            {doc.original_filename} · {doc.page_count ? `${doc.page_count} page${doc.page_count > 1 ? "s" : ""} · ` : ""}
            uploaded {formatDateTime(doc.uploaded_at, timezone)}
          </p>
          {doc.shipment_reference && (
            <Link href={`/documents/shipment/${encodeURIComponent(doc.shipment_reference)}`} className="text-sm font-semibold text-brand-700">
              Shipment {doc.shipment_reference}
            </Link>
          )}
        </div>
        <Badge className={st.style}>
          {analysing && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />} {st.label}
        </Badge>
      </div>

      {doc.is_demo && (
        <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-900">Demo record with fictional values. No file is stored for it.</p>
      )}
      {doc.processing_error && (
        <p className={clsx("rounded-xl px-3 py-2 text-sm", doc.processing_status === "FAILED" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900")} role="alert">
          {doc.processing_error}
        </p>
      )}
      {analysing && (
        <p className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Analysing the document. This page updates by itself.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>Extracted fields</SectionTitle>
            {doc.review_count > 0 && <Badge className="bg-amber-100 text-amber-900">{doc.review_count} to review</Badge>}
          </div>
          {doc.ai_provider && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              First reading by {doc.ai_provider === "anthropic" ? `Claude (${doc.ai_model})` : doc.ai_provider === "demo" ? "demo data" : doc.ai_model}
              {doc.processed_at && ` · ${formatDateTime(doc.processed_at, timezone)}`}. Check each value against the document.
            </p>
          )}
          {doc.fields.length > 0 ? (
            <FieldTable doc={doc} />
          ) : (
            <p className="text-sm text-slate-500">{analysing ? "Fields appear when the analysis is finished." : "No fields yet."}</p>
          )}
          {doc.fields.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              {doc.processing_status === "VERIFIED" ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> You verified this document {doc.verified_at && formatDateTime(doc.verified_at, timezone)}
                </p>
              ) : (
                <Button
                  onClick={() => run("verify", () => api.post(`/api/documents/${doc.id}/verify`))}
                  loading={busy === "verify"}
                  disabled={!online || doc.review_count > 0 || doc.document_type === "UNKNOWN"}
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Mark document as verified
                </Button>
              )}
              {doc.review_count > 0 && <p className="mt-1 text-xs text-slate-500">Review the highlighted fields first.</p>}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <SectionTitle>Document</SectionTitle>
            <div className="space-y-3">
              <Field
                label="Type"
                htmlFor="doc-type"
                hint={doc.type_source === "AI" && doc.type_confidence !== null ? `Detected by AI (${Math.round(doc.type_confidence * 100)}%). Change it if wrong.` : undefined}
              >
                <select
                  id="doc-type"
                  className={inputClass}
                  value={doc.document_type === "UNKNOWN" ? "" : doc.document_type}
                  disabled={!online || busy !== null || analysing}
                  onChange={(e) => e.target.value && run("type", () => api.patch(`/api/documents/${doc.id}`, { document_type: e.target.value }))}
                >
                  <option value="" disabled>
                    Choose type
                  </option>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DOC_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shipment reference" htmlFor="doc-ref">
                <div className="flex gap-2">
                  <input id="doc-ref" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
                  <Button
                    variant="secondary"
                    disabled={!online || busy !== null || reference.trim() === doc.shipment_reference}
                    onClick={() => run("ref", () => api.patch(`/api/documents/${doc.id}`, { shipment_reference: reference }))}
                  >
                    Save
                  </Button>
                </div>
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {doc.has_file && (
                <a
                  href={`/api/documents/${doc.id}/file`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" aria-hidden /> Download
                </a>
              )}
              {canReprocess && (
                <Button variant="secondary" loading={busy === "reprocess"} disabled={!online} onClick={() => run("reprocess", () => api.post(`/api/documents/${doc.id}/reprocess`))}>
                  <RefreshCw className="h-4 w-4" aria-hidden /> {doc.processing_status === "AI_NOT_PERMITTED" ? "Read with AI" : "Analyse again"}
                </Button>
              )}
              <Button variant="ghost" disabled={!online} onClick={() => setConfirmDelete(true)} aria-label="Delete document">
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <InlineError message={actionError} />
            <p className="mt-3 break-all text-[11px] text-slate-400">SHA-256 {doc.checksum_sha256.slice(0, 16)}…</p>
          </Card>

          {doc.versions && doc.versions.length > 0 && (
            <Card>
              <SectionTitle>Versions</SectionTitle>
              <p className="mb-2 flex gap-1.5 text-xs text-slate-600">
                <Layers className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
                The newest file is not assumed to be correct. Choose the version that applies. Only that one is compared.
              </p>
              <ul className="space-y-2">
                {doc.versions.map((v) => (
                  <li key={v.id} className={clsx("rounded-xl border p-2.5 text-sm", v.id === doc.id ? "border-brand-600" : "border-slate-200")}>
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/documents/${v.id}`} className="min-w-0 truncate font-medium text-slate-900 hover:underline">
                        {v.original_filename}
                      </Link>
                      {v.is_active_version ? (
                        <Badge className="bg-emerald-100 text-emerald-800">Chosen</Badge>
                      ) : (
                        <button
                          onClick={() => run("activate", () => api.post(`/api/documents/${v.id}/activate`))}
                          disabled={!online || busy !== null}
                          className="shrink-0 rounded-lg border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700"
                        >
                          Use this version
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{formatDateTime(v.uploaded_at, timezone)}{v.id === doc.id && " · this document"}</p>
                    {v.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {v.changes.map((c) => (
                          <li key={c.field}>
                            <span className="text-slate-500">{DOC_FIELD_LABEL[c.field] ?? c.field}:</span>{" "}
                            <span className="line-through decoration-slate-400">{c.this ?? "—"}</span> → <strong>{c.other ?? "—"}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Modal open={confirmDelete} title="Delete this document?" onClose={() => setConfirmDelete(false)}>
        <p className="text-sm text-slate-600">
          The stored file and its extracted values are permanently deleted. Issues already added to a task stay there until you resolve them.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            Keep
          </Button>
          <Button
            variant="danger"
            loading={busy === "delete"}
            onClick={async () => {
              if (await run("delete", () => api.delete(`/api/documents/${doc.id}`))) router.replace("/documents");
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
