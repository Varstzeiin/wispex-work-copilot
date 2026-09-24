"use client";

import clsx from "clsx";
import { CheckCircle2, Copy, Download, FileUp, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

import { PrivacyNotice } from "@/components/document/PrivacyNotice";
import { Button, Card, Field, InlineError, PageHeader, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { uploadWithProgress, useDocumentStatus, useRefreshDocuments } from "@/features/document-ai/hooks";
import { useTasks } from "@/features/task-management/hooks";
import { useOnline } from "@/lib/hooks";
import { DOC_TYPE_LABEL } from "@/lib/utils/labels";
import type { UploadResult } from "@/types";

const SAMPLES = [
  { key: "invoice", label: "Invoice (v1)" },
  { key: "invoice_v2", label: "Invoice (v2)" },
  { key: "packing_list", label: "Packing List" },
  { key: "bill_of_lading", label: "Bill of Lading" },
];
const MAX_FILES = 10;

export default function UploadPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <UploadForm />
    </Suspense>
  );
}

function formatSize(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function UploadForm() {
  const params = useSearchParams();
  const online = useOnline();
  const refresh = useRefreshDocuments();
  const { data: status } = useDocumentStatus();
  const { data: tasks } = useTasks({ view: "open", sort: "deadline", pageSize: 100 });
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [reference, setReference] = useState(params.get("ref") ?? "");
  const [taskId, setTaskId] = useState(params.get("task") ?? "");
  const [docType, setDocType] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [cancel, setCancel] = useState<(() => void) | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maxBytes = (status?.max_upload_mb ?? 15) * 1024 * 1024;
  const tooBig = files.filter((f) => f.size > maxBytes);

  function addFiles(list: FileList | null) {
    if (!list) return;
    // Copy first: a FileList is live and empties when the input is reset below
    const picked = Array.from(list);
    setResult(null);
    setError(null);
    setFiles((current) => {
      const merged = [...current];
      for (const f of picked) {
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
      }
      return merged.slice(0, MAX_FILES);
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit() {
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    if (reference.trim()) form.append("shipment_reference", reference.trim());
    if (taskId) form.append("task_id", taskId);
    if (docType) form.append("document_type", docType);

    setError(null);
    setResult(null);
    setProgress(0);
    const upload = uploadWithProgress(form, setProgress);
    setCancel(() => upload.cancel);
    try {
      const res = await upload.promise;
      setResult(res);
      setFiles([]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload could not be completed.");
    } finally {
      setProgress(null);
      setCancel(null);
    }
  }

  const uploading = progress !== null;
  const selectedTask = tasks?.items.find((t) => t.id === taskId);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Upload documents" subtitle="PDF, JPG or PNG. Up to 10 files at once." />
      <PrivacyNotice status={status} />

      <Card>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="sr-only"
          id="file-input"
          onChange={(e) => addFiles(e.target.files)}
          disabled={uploading}
        />
        <label
          htmlFor="file-input"
          className={clsx(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-brand-500 hover:bg-brand-50",
            uploading && "pointer-events-none opacity-50",
          )}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
        >
          <FileUp className="h-8 w-8 text-brand-600" aria-hidden />
          <span className="font-semibold text-slate-900">Choose files or drop them here</span>
          <span className="text-xs text-slate-500">Max {status?.max_upload_mb ?? 15} MB per file · PDFs up to {status?.max_pdf_pages ?? 50} pages</span>
        </label>

        {files.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {files.map((f) => (
              <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className={clsx("text-xs tabular-nums", f.size > maxBytes ? "font-semibold text-red-700" : "text-slate-500")}>
                  {formatSize(f.size)}
                </span>
                {!uploading && (
                  <button onClick={() => setFiles(files.filter((x) => x !== f))} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label={`Remove ${f.name}`}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {tooBig.length > 0 && <p className="mt-2 text-xs text-red-700">Remove files larger than {status?.max_upload_mb ?? 15} MB.</p>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Link to task (optional)" htmlFor="task">
            <select
              id="task"
              className={inputClass}
              value={taskId}
              onChange={(e) => {
                setTaskId(e.target.value);
                const t = tasks?.items.find((x) => x.id === e.target.value);
                if (t?.shipment_reference) setReference(t.shipment_reference);
              }}
              disabled={uploading}
            >
              <option value="">No task</option>
              {tasks?.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.shipment_reference ?? t.title} · {t.deadline.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shipment reference" htmlFor="reference" hint={selectedTask ? "Taken from the task." : "Groups the documents for comparison."}>
            <input id="reference" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} disabled={uploading || !!selectedTask?.shipment_reference} placeholder="e.g. SHP-DEMO-7" />
          </Field>
          <Field
            label="Document type"
            htmlFor="doctype"
            hint={status?.ai_allowed ? "Leave on auto-detect to let the AI classify each file." : "Without AI, set the type here or on each document."}
          >
            <select id="doctype" className={inputClass} value={docType} onChange={(e) => setDocType(e.target.value)} disabled={uploading}>
              <option value="">{status?.ai_allowed ? "Auto-detect" : "Set later"}</option>
              {["INVOICE", "PACKING_LIST", "BILL_OF_LADING", "AIR_WAYBILL", "OTHER"].map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {uploading && (
          <div className="mt-4" role="status">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>{progress! < 1 ? `Uploading… ${Math.round(progress! * 100)}%` : "Checking files…"}</span>
              {progress! < 1 && cancel && (
                <button onClick={cancel} className="font-semibold text-red-700">
                  Cancel upload
                </button>
              )}
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${Math.round(progress! * 100)}%` }} />
            </div>
          </div>
        )}
        <div className="mt-3">
          <InlineError message={error} />
        </div>
        <Button className="mt-3" block size="lg" onClick={submit} loading={uploading} disabled={!online || !files.length || tooBig.length > 0}>
          Upload {files.length ? `${files.length} file${files.length > 1 ? "s" : ""}` : ""}
        </Button>
      </Card>

      {result && (
        <Card>
          <SectionTitle>Result</SectionTitle>
          <ul className="space-y-2 text-sm">
            {result.results.map((r, i) => (
              <li key={`${r.filename}-${i}`} className="flex items-start gap-2">
                {r.status === "UPLOADED" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                ) : r.status === "DUPLICATE" ? (
                  <Copy className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-slate-900">{r.filename}</span>
                  {r.message && <span className="block text-slate-600">{r.message}</span>}
                  {r.document_id && (
                    <Link href={`/documents/${r.document_id}`} className="text-xs font-semibold text-brand-700">
                      Open document
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {result.queued > 0 && (
            <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">
              {result.queued} file{result.queued > 1 ? "s are" : " is"} being analysed in the background. Results appear on the documents page.
            </p>
          )}
          <Link href={reference ? `/documents/shipment/${encodeURIComponent(reference)}` : "/documents"} className="mt-3 inline-block text-sm font-semibold text-brand-700">
            Go to {reference ? `shipment ${reference}` : "documents"}
          </Link>
        </Card>
      )}

      <Card>
        <SectionTitle>Try it with fictional samples</SectionTitle>
        <p className="text-sm text-slate-600">Download invented documents for shipment SHP-DEMO-7, then upload them here. They contain deliberate mismatches.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <a key={s.key} href={`/api/documents/samples/${s.key}`} className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Download className="h-3.5 w-3.5" aria-hidden /> {s.label}
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
