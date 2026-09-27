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
import { t } from "@/lib/i18n";
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
      setError(e instanceof Error ? e.message : t("The upload could not be completed.", "Unggahan tidak bisa diselesaikan."));
    } finally {
      setProgress(null);
      setCancel(null);
    }
  }

  const uploading = progress !== null;
  const selectedTask = tasks?.items.find((task) => task.id === taskId);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={t("Upload documents", "Unggah dokumen")}
        subtitle={t("PDF, JPG or PNG. Up to 10 files at once.", "PDF, JPG, atau PNG. Maksimal 10 file sekaligus.")}
      />
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
          <span className="font-semibold text-slate-900">{t("Choose files or drop them here", "Pilih file atau seret ke sini")}</span>
          <span className="text-xs text-slate-500">
            {t(
              `Max ${status?.max_upload_mb ?? 15} MB per file · PDFs up to ${status?.max_pdf_pages ?? 50} pages`,
              `Maks ${status?.max_upload_mb ?? 15} MB per file · PDF maks ${status?.max_pdf_pages ?? 50} halaman`,
            )}
          </span>
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
                  <button onClick={() => setFiles(files.filter((x) => x !== f))} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label={`${t("Remove", "Hapus")} ${f.name}`}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {tooBig.length > 0 && (
          <p className="mt-2 text-xs text-red-700">
            {t(`Remove files larger than ${status?.max_upload_mb ?? 15} MB.`, `Hapus file yang lebih dari ${status?.max_upload_mb ?? 15} MB.`)}
          </p>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("Link to task (optional)", "Hubungkan ke task (opsional)")} htmlFor="task">
            <select
              id="task"
              className={inputClass}
              value={taskId}
              onChange={(e) => {
                setTaskId(e.target.value);
                const task = tasks?.items.find((x) => x.id === e.target.value);
                if (task?.shipment_reference) setReference(task.shipment_reference);
              }}
              disabled={uploading}
            >
              <option value="">{t("No task", "Tanpa task")}</option>
              {tasks?.items.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.shipment_reference ?? task.title} · {task.deadline.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("Shipment reference", "Referensi shipment")}
            htmlFor="reference"
            hint={selectedTask ? t("Taken from the task.", "Diambil dari task.") : t("Groups the documents for comparison.", "Mengelompokkan dokumen untuk dibandingkan.")}
          >
            <input id="reference" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} disabled={uploading || !!selectedTask?.shipment_reference} placeholder={t("e.g. SHP-DEMO-7", "mis. SHP-DEMO-7")} />
          </Field>
          <Field
            label={t("Document type", "Jenis dokumen")}
            htmlFor="doctype"
            hint={
              status?.ai_allowed
                ? t("Leave on auto-detect to let the AI classify each file.", "Biarkan deteksi otomatis agar AI mengenali jenis tiap file.")
                : t("Without AI, set the type here or on each document.", "Tanpa AI, isi jenisnya di sini atau di tiap dokumen.")
            }
          >
            <select id="doctype" className={inputClass} value={docType} onChange={(e) => setDocType(e.target.value)} disabled={uploading}>
              <option value="">{status?.ai_allowed ? t("Auto-detect", "Deteksi otomatis") : t("Set later", "Isi nanti")}</option>
              {["INVOICE", "PACKING_LIST", "BILL_OF_LADING", "AIR_WAYBILL", "OTHER"].map((type) => (
                <option key={type} value={type}>
                  {DOC_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {uploading && (
          <div className="mt-4" role="status">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                {progress! < 1
                  ? `${t("Uploading…", "Mengunggah…")} ${Math.round(progress! * 100)}%`
                  : t("Checking files…", "Memeriksa file…")}
              </span>
              {progress! < 1 && cancel && (
                <button onClick={cancel} className="font-semibold text-red-700">
                  {t("Cancel upload", "Batalkan unggahan")}
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
          {t("Upload", "Unggah")} {files.length ? `${files.length} ${t(files.length > 1 ? "files" : "file", "file")}` : ""}
        </Button>
      </Card>

      {result && (
        <Card>
          <SectionTitle>{t("Result", "Hasil")}</SectionTitle>
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
                      {t("Open document", "Buka dokumen")}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {result.queued > 0 && (
            <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">
              {t(
                `${result.queued} file${result.queued > 1 ? "s are" : " is"} being analysed in the background. Results appear on the documents page.`,
                `${result.queued} file sedang dianalisis di latar belakang. Hasilnya muncul di halaman dokumen.`,
              )}
            </p>
          )}
          <Link href={reference ? `/documents/shipment/${encodeURIComponent(reference)}` : "/documents"} className="mt-3 inline-block text-sm font-semibold text-brand-700">
            {t("Go to", "Buka")} {reference ? `shipment ${reference}` : t("documents", "dokumen")}
          </Link>
        </Card>
      )}

      <Card>
        <SectionTitle>{t("Try it with fictional samples", "Coba dengan contoh fiktif")}</SectionTitle>
        <p className="text-sm text-slate-600">
          {t(
            "Download invented documents for shipment SHP-DEMO-7, then upload them here. They contain deliberate mismatches.",
            "Unduh dokumen karangan untuk shipment SHP-DEMO-7, lalu unggah di sini. Isinya sengaja dibuat ada selisih.",
          )}
        </p>
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
