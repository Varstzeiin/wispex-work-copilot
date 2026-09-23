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
      <PageHeader title="Report an error" subtitle="Thank you for reporting early. This protects the client and the team." />
      <form onSubmit={submit} className="space-y-4">
        <Step n={1} title="Stop and verify">
          <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-900">
            <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Pause further work on this shipment. Re-check the submitted value against the source document before
              continuing. Do not try to fix it silently.
            </p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            <span>I stopped and verified that the submitted information is wrong.</span>
          </label>
        </Step>

        <Step n="2–4" title="What exactly is wrong">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Shipment reference" htmlFor="ref">
              <input id="ref" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. SHP-009" />
            </Field>
            <Field label="Exact field" htmlFor="field" hint="e.g. Gross weight, Invoice number, Currency">
              <input id="field" required className={inputClass} value={field} onChange={(e) => setField(e.target.value)} />
            </Field>
            <Field label="Submitted (wrong) value" htmlFor="wrong">
              <input id="wrong" className={inputClass} value={incorrect} onChange={(e) => setIncorrect(e.target.value)} />
            </Field>
            <Field label="Correct value" htmlFor="correct">
              <input id="correct" className={inputClass} value={correct} onChange={(e) => setCorrect(e.target.value)} />
            </Field>
            <Field label="Source document of the correct value" htmlFor="source">
              <input id="source" list="source-docs" className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} />
              <datalist id="source-docs">
                {COMMON_DOCUMENTS.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
          </div>
          <p className="text-xs text-slate-500">Keep values short. Do not paste whole document content.</p>
        </Step>

        <Step n={5} title="When was it submitted">
          <Field label={`Submitted at (${timezone})`} htmlFor="submitted" hint="Approximate time is fine if you are not sure.">
            <input id="submitted" type="datetime-local" className={inputClass} value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
          </Field>
        </Step>

        <Step n={6} title="Potential impact">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="category">
              <select id="category" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(ERROR_CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Severity (your assessment)" htmlFor="severity">
              <select id="severity" className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </Field>
          </div>
          <Field label="What could this affect?" htmlFor="impact" hint="e.g. declared value, clearance delay, client invoice">
            <textarea id="impact" rows={3} className={inputClass} value={impact} onChange={(e) => setImpact(e.target.value)} />
          </Field>
        </Step>

        <p className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
          Next: notify the appropriate person, prepare the correction, follow their instructions, record the resolution
          and the root cause. The report page guides you through each step.
        </p>
        <InlineError message={error} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!online || !verified || !field.trim()} className="flex-1 sm:flex-none">
            Report error
          </Button>
        </div>
      </form>
    </div>
  );
}
