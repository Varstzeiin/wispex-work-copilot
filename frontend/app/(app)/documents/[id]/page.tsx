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
import { t } from "@/lib/i18n";

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
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t("Back", "Kembali")}
      </button>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">{DOC_TYPE_LABEL[doc.document_type]}</h1>
          <p className="truncate text-sm text-slate-500">
            {doc.original_filename} ·{" "}
            {doc.page_count ? `${doc.page_count} ${t(doc.page_count > 1 ? "pages" : "page", "halaman")} · ` : ""}
            {t("uploaded", "diunggah")} {formatDateTime(doc.uploaded_at, timezone)}
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
        <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-900">
          {t("Demo record with fictional values. No file is stored for it.", "Data demo dengan nilai fiktif. Tidak ada file yang disimpan untuknya.")}
        </p>
      )}
      {doc.processing_error && (
        <p className={clsx("rounded-xl px-3 py-2 text-sm", doc.processing_status === "FAILED" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900")} role="alert">
          {doc.processing_error}
        </p>
      )}
      {analysing && (
        <p className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />{" "}
          {t("Analysing the document. This page updates by itself.", "Sedang menganalisis dokumen. Halaman ini diperbarui sendiri.")}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>{t("Extracted fields", "Field yang terbaca")}</SectionTitle>
            {doc.review_count > 0 && <Badge className="bg-amber-100 text-amber-900">{doc.review_count} {t("to review", "perlu dicek")}</Badge>}
          </div>
          {doc.ai_provider && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              {t("First reading by", "Bacaan awal oleh")}{" "}
              {doc.ai_provider === "anthropic" ? `Claude (${doc.ai_model})` : doc.ai_provider === "demo" ? t("demo data", "data demo") : doc.ai_model}
              {doc.processed_at && ` · ${formatDateTime(doc.processed_at, timezone)}`}.{" "}
              {t("Check each value against the document.", "Cek setiap nilai dengan dokumennya.")}
            </p>
          )}
          {doc.fields.length > 0 ? (
            <FieldTable doc={doc} />
          ) : (
            <p className="text-sm text-slate-500">{analysing
                ? t("Fields appear when the analysis is finished.", "Field muncul setelah analisis selesai.")
                : t("No fields yet.", "Belum ada field.")}</p>
          )}
          {doc.fields.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              {doc.processing_status === "VERIFIED" ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> {t("You verified this document", "Kamu sudah memverifikasi dokumen ini")}{" "}
                  {doc.verified_at && formatDateTime(doc.verified_at, timezone)}
                </p>
              ) : (
                <Button
                  onClick={() => run("verify", () => api.post(`/api/documents/${doc.id}/verify`))}
                  loading={busy === "verify"}
                  disabled={!online || doc.review_count > 0 || doc.document_type === "UNKNOWN"}
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden /> {t("Mark document as verified", "Tandai dokumen terverifikasi")}
                </Button>
              )}
              {doc.review_count > 0 && <p className="mt-1 text-xs text-slate-500">{t("Review the highlighted fields first.", "Cek dulu field yang ditandai.")}</p>}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <SectionTitle>{t("Document", "Dokumen")}</SectionTitle>
            <div className="space-y-3">
              <Field
                label={t("Type", "Jenis")}
                htmlFor="doc-type"
                hint={
                  doc.type_source === "AI" && doc.type_confidence !== null
                    ? t(
                        `Detected by AI (${Math.round(doc.type_confidence * 100)}%). Change it if wrong.`,
                        `Dideteksi AI (${Math.round(doc.type_confidence * 100)}%). Ubah kalau salah.`,
                      )
                    : undefined
                }
              >
                <select
                  id="doc-type"
                  className={inputClass}
                  value={doc.document_type === "UNKNOWN" ? "" : doc.document_type}
                  disabled={!online || busy !== null || analysing}
                  onChange={(e) => e.target.value && run("type", () => api.patch(`/api/documents/${doc.id}`, { document_type: e.target.value }))}
                >
                  <option value="" disabled>
                    {t("Choose type", "Pilih jenis")}
                  </option>
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {DOC_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Shipment reference", "Referensi shipment")} htmlFor="doc-ref">
                <div className="flex gap-2">
                  <input id="doc-ref" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
                  <Button
                    variant="secondary"
                    disabled={!online || busy !== null || reference.trim() === doc.shipment_reference}
                    onClick={() => run("ref", () => api.patch(`/api/documents/${doc.id}`, { shipment_reference: reference }))}
                  >
                    {t("Save", "Simpan")}
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
                  <Download className="h-4 w-4" aria-hidden /> {t("Download", "Unduh")}
                </a>
              )}
              {canReprocess && (
                <Button variant="secondary" loading={busy === "reprocess"} disabled={!online} onClick={() => run("reprocess", () => api.post(`/api/documents/${doc.id}/reprocess`))}>
                  <RefreshCw className="h-4 w-4" aria-hidden /> {doc.processing_status === "AI_NOT_PERMITTED" ? t("Read with AI", "Baca dengan AI") : t("Analyse again", "Analisis ulang")}
                </Button>
              )}
              <Button variant="ghost" disabled={!online} onClick={() => setConfirmDelete(true)} aria-label={t("Delete document", "Hapus dokumen")}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <InlineError message={actionError} />
            <p className="mt-3 break-all text-[11px] text-slate-400">SHA-256 {doc.checksum_sha256.slice(0, 16)}…</p>
          </Card>

          {doc.versions && doc.versions.length > 0 && (
            <Card>
              <SectionTitle>{t("Versions", "Versi")}</SectionTitle>
              <p className="mb-2 flex gap-1.5 text-xs text-slate-600">
                <Layers className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
                {t(
                  "The newest file is not assumed to be correct. Choose the version that applies. Only that one is compared.",
                  "File terbaru tidak otomatis dianggap benar. Pilih versi yang berlaku. Hanya versi itu yang dibandingkan.",
                )}
              </p>
              <ul className="space-y-2">
                {doc.versions.map((v) => (
                  <li key={v.id} className={clsx("rounded-xl border p-2.5 text-sm", v.id === doc.id ? "border-brand-600" : "border-slate-200")}>
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/documents/${v.id}`} className="min-w-0 truncate font-medium text-slate-900 hover:underline">
                        {v.original_filename}
                      </Link>
                      {v.is_active_version ? (
                        <Badge className="bg-emerald-100 text-emerald-800">{t("Chosen", "Terpilih")}</Badge>
                      ) : (
                        <button
                          onClick={() => run("activate", () => api.post(`/api/documents/${v.id}/activate`))}
                          disabled={!online || busy !== null}
                          className="shrink-0 rounded-lg border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700"
                        >
                          {t("Use this version", "Pakai versi ini")}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{formatDateTime(v.uploaded_at, timezone)}{v.id === doc.id && ` · ${t("this document", "dokumen ini")}`}</p>
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

      <Modal open={confirmDelete} title={t("Delete this document?", "Hapus dokumen ini?")} onClose={() => setConfirmDelete(false)}>
        <p className="text-sm text-slate-600">
          {t(
            "The stored file and its extracted values are permanently deleted. Issues already added to a task stay there until you resolve them.",
            "File tersimpan dan nilai yang terbaca akan dihapus permanen. Masalah yang sudah ditambahkan ke task tetap ada sampai kamu selesaikan.",
          )}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            {t("Keep", "Jangan hapus")}
          </Button>
          <Button
            variant="danger"
            loading={busy === "delete"}
            onClick={async () => {
              if (await run("delete", () => api.delete(`/api/documents/${doc.id}`))) router.replace("/documents");
            }}
          >
            {t("Delete", "Hapus")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
