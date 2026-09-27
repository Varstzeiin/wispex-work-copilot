"use client";

import { OctagonAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

import { Button, Field, InlineError, PageHeader, Spinner, inputClass } from "@/components/ui";
import { useRefreshPerformance } from "@/features/performance/hooks";
import { useTask } from "@/features/task-management/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { COMMON_DOCUMENTS, ERROR_CATEGORY_LABEL } from "@/lib/utils/labels";
import { toLocalInput } from "@/lib/utils/time";
import { t } from "@/lib/i18n";
import type { ErrorReport } from "@/types";

export default function NewErrorPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ReportForm />
    </Suspense>
  );
}

function Step({ n, title, children }: { n: number | string; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-white p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-700">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-900 px-1.5 text-xs text-white">{n}</span>
        {title}
      </legend>
      <div className="mt-1 space-y-3">{children}</div>
    </fieldset>
  );
}

function ReportForm() {
  const router = useRouter();
  const params = useSearchParams();
  const taskId = params.get("task");
  const { data: task } = useTask(taskId);
  const { timezone } = useSettings();
  const online = useOnline();
  const refresh = useRefreshPerformance();

  const [verified, setVerified] = useState(false);
  const [reference, setReference] = useState("");
  const [field, setField] = useState("");
  const [incorrect, setIncorrect] = useState("");
  const [correct, setCorrect] = useState("");
  const [source, setSource] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [category, setCategory] = useState("DATA_ENTRY");
  const [severity, setSeverity] = useState("MEDIUM");
  const [impact, setImpact] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!task) return;
    setReference((r) => r || task.shipment_reference || "");
    if (task.completed_at) setSubmittedAt((s) => s || toLocalInput(task.completed_at, timezone));
  }, [task, timezone]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<ErrorReport>("/api/errors", {
        task_id: taskId || null,
        shipment_reference: reference,
        field_name: field,
        incorrect_value: incorrect,
        correct_value: correct,
        source_document: source,
        submitted_at: submittedAt || null,
        category,
        severity,
        impact,
        confirm_verified: verified,
      });
      await refresh();
      router.replace(`/errors/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t("Report an error", "Laporkan kesalahan")}
        subtitle={t("Thank you for reporting early. This protects the client and the team.", "Terima kasih sudah melapor lebih awal. Ini melindungi klien dan tim.")}
      />
      <form onSubmit={submit} className="space-y-4">
        <Step n={1} title={t("Stop and verify", "Berhenti dan verifikasi")}>
          <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-900">
            <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              {t(
                "Pause further work on this shipment. Re-check the submitted value against the source document before continuing. Do not try to fix it silently.",
                "Hentikan dulu pekerjaan di shipment ini. Cek ulang nilai yang sudah dikirim dengan dokumen sumber sebelum lanjut. Jangan diam-diam memperbaikinya.",
              )}
            </p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            <span>
              {t("I stopped and verified that the submitted information is wrong.", "Aku sudah berhenti dan memastikan informasi yang dikirim memang salah.")}
            </span>
          </label>
        </Step>

        <Step n="2–4" title={t("What exactly is wrong", "Apa persisnya yang salah")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("Shipment reference", "Referensi shipment")} htmlFor="ref">
              <input id="ref" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("e.g. SHP-009", "mis. SHP-009")} />
            </Field>
            <Field
              label={t("Exact field", "Field yang salah")}
              htmlFor="field"
              hint={t("e.g. Gross weight, Invoice number, Currency", "mis. Berat kotor, Nomor invoice, Mata uang")}
            >
              <input id="field" required className={inputClass} value={field} onChange={(e) => setField(e.target.value)} />
            </Field>
            <Field label={t("Submitted (wrong) value", "Nilai yang dikirim (salah)")} htmlFor="wrong">
              <input id="wrong" className={inputClass} value={incorrect} onChange={(e) => setIncorrect(e.target.value)} />
            </Field>
            <Field label={t("Correct value", "Nilai yang benar")} htmlFor="correct">
              <input id="correct" className={inputClass} value={correct} onChange={(e) => setCorrect(e.target.value)} />
            </Field>
            <Field label={t("Source document of the correct value", "Dokumen sumber nilai yang benar")} htmlFor="source">
              <input id="source" list="source-docs" className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} />
              <datalist id="source-docs">
                {COMMON_DOCUMENTS.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            {t("Keep values short. Do not paste whole document content.", "Tulis nilai secara singkat. Jangan menempel isi dokumen utuh.")}
          </p>
        </Step>

        <Step n={5} title={t("When was it submitted", "Kapan dikirim")}>
          <Field
            label={`${t("Submitted at", "Dikirim pada")} (${timezone})`}
            htmlFor="submitted"
            hint={t("Approximate time is fine if you are not sure.", "Perkiraan waktu tidak apa-apa kalau kamu tidak yakin.")}
          >
            <input id="submitted" type="datetime-local" className={inputClass} value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
          </Field>
        </Step>

        <Step n={6} title={t("Potential impact", "Potensi dampak")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("Category", "Kategori")} htmlFor="category">
              <select id="category" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(ERROR_CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Severity (your assessment)", "Tingkat keparahan (penilaianmu)")} htmlFor="severity">
              <select id="severity" className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="LOW">{t("Low", "Rendah")}</option>
                <option value="MEDIUM">{t("Medium", "Sedang")}</option>
                <option value="HIGH">{t("High", "Tinggi")}</option>
                <option value="CRITICAL">{t("Critical", "Kritis")}</option>
              </select>
            </Field>
          </div>
          <Field
            label={t("What could this affect?", "Apa yang bisa terdampak?")}
            htmlFor="impact"
            hint={t("e.g. declared value, clearance delay, client invoice", "mis. nilai yang dideklarasikan, keterlambatan clearance, invoice klien")}
          >
            <textarea id="impact" rows={3} className={inputClass} value={impact} onChange={(e) => setImpact(e.target.value)} />
          </Field>
        </Step>

        <p className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
          {t(
            "Next: notify the appropriate person, prepare the correction, follow their instructions, record the resolution and the root cause. The report page guides you through each step.",
            "Berikutnya: beri tahu orang yang tepat, siapkan koreksi, ikuti arahan mereka, catat penyelesaian dan akar masalahnya. Halaman laporan akan memandu setiap langkah.",
          )}
        </p>
        <InlineError message={error} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            {t("Cancel", "Batal")}
          </Button>
          <Button type="submit" loading={saving} disabled={!online || !verified || !field.trim()} className="flex-1 sm:flex-none">
            {t("Report error", "Laporkan kesalahan")}
          </Button>
        </div>
      </form>
    </div>
  );
}
