"use client";

import { ArrowLeft, CheckCircle2, Circle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge, Button, Card, ErrorState, Field, InlineError, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { useError, useRefreshPerformance } from "@/features/performance/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { ERROR_CATEGORY_LABEL, ERROR_STATUS, SEVERITY_STYLE } from "@/lib/utils/labels";
import { formatDateTime, formatMinutes } from "@/lib/utils/time";
import type { ErrorReport } from "@/types";

export default function ErrorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { timezone } = useSettings();
  const { data: e, error, mutate } = useError(id);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!e) return <Spinner />;

  const rows: [string, string][] = [
    ["Shipment", e.shipment_reference || "—"],
    ["Field", e.field_name],
    ["Submitted value", e.incorrect_value || "—"],
    ["Correct value", e.correct_value || "—"],
    ["Source document", e.source_document || "—"],
    ["Submitted at", formatDateTime(e.submitted_at, timezone)],
    ["Discovered at", formatDateTime(e.discovered_at, timezone)],
    ["Category", e.category_label],
  ];

  return (
    <div className="space-y-4">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-medium text-slate-600">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {e.field_name}
            {e.shipment_reference && <span className="font-normal text-slate-500"> · {e.shipment_reference}</span>}
          </h1>
          <p className="text-sm text-slate-500">Reported {formatDateTime(e.created_at, timezone)}</p>
        </div>
        <div className="flex gap-1">
          <Badge className={SEVERITY_STYLE[e.severity]}>{e.severity}</Badge>
          <Badge className={ERROR_STATUS[e.status].style}>{ERROR_STATUS[e.status].label}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <NextStep report={e} />
          <Card>
            <SectionTitle>Details</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase text-slate-500">{k}</dt>
                  <dd className="font-medium text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
            {e.impact && (
              <div className="mt-3">
                <p className="text-xs uppercase text-slate-500">Potential impact</p>
                <p className="text-sm text-slate-800">{e.impact}</p>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {e.task_id && (
                <Link href={`/tasks/${e.task_id}`} className="text-sm font-semibold text-brand-700">
                  Open linked task
                </Link>
              )}
              <Link href={`/assistant/drafts?kind=CORRECTION&error=${e.id}`} className="text-sm font-semibold text-brand-700">
                Draft a correction notification
              </Link>
            </div>
          </Card>
          <Record report={e} timezone={timezone} />
        </div>

        <Card className="h-fit">
          <SectionTitle>Report an Error: 11 steps</SectionTitle>
          <ol className="space-y-1.5">
            {e.steps.map((s) => (
              <li key={s.step} className="flex items-center gap-2 text-sm">
                {s.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                )}
                <span className={s.done ? "text-slate-700" : "text-slate-900"}>
                  {s.step}. {s.label}
                </span>
                <span className="sr-only">{s.done ? "done" : "not done"}</span>
              </li>
            ))}
          </ol>
          {e.correction_minutes !== null && (
            <p className="mt-3 text-xs text-slate-500">Corrected {formatMinutes(e.correction_minutes)} after discovery.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Shows only the next action in the workflow, so it is always clear what to do. */
function NextStep({ report: e }: { report: ErrorReport }) {
  const refresh = useRefreshPerformance();
  const online = useOnline();
  const [text, setText] = useState("");
  const [instructions, setInstructions] = useState(e.instructions);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setText("");
    setInstructions(e.instructions);
  }, [e.status, e.instructions]);

  async function run(fn: () => Promise<unknown>) {
    setSaving(true);
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setSaving(false);
    }
  }

  const status = (body: object) => run(() => api.post(`/api/errors/${e.id}/status`, body));
  const patch = (body: object) => run(() => api.patch(`/api/errors/${e.id}`, body));

  if (e.status === "REPORTED") {
    return (
      <Card className="border-2 border-brand-600">
        <SectionTitle>Next: notify the appropriate person (step 7)</SectionTitle>
        <p className="mb-2 text-sm text-slate-600">
          Tell the person responsible according to your SOP now, even if some details are still being verified.
        </p>
        <Field label="Who did you notify? (a role is enough)" htmlFor="notified">
          <input id="notified" className={inputClass} value={text} onChange={(x) => setText(x.target.value)} placeholder="e.g. Supervisor" />
        </Field>
        <InlineError message={err} />
        <Button className="mt-3" loading={saving} disabled={!online || !text.trim()} onClick={() => status({ status: "NOTIFIED", notified_person: text })}>
          I have notified them
        </Button>
      </Card>
    );
  }

  if (e.status === "NOTIFIED") {
    return (
      <Card className="border-2 border-brand-600">
        <SectionTitle>Next: prepare the correction (step 8)</SectionTitle>
        <Field label="What correction are you preparing?" htmlFor="correction">
          <textarea id="correction" rows={3} className={inputClass} value={text} onChange={(x) => setText(x.target.value)} />
        </Field>
        <InlineError message={err} />
        <Button className="mt-3" loading={saving} disabled={!online || !text.trim()} onClick={() => status({ status: "CORRECTING", correction_notes: text })}>
          Correction prepared
        </Button>
      </Card>
    );
  }

  if (e.status === "CORRECTING") {
    return (
      <Card className="border-2 border-brand-600">
        <SectionTitle>Next: follow instructions and record the resolution (steps 9–10)</SectionTitle>
        <Field label="Instructions received" htmlFor="instructions" hint="What did the responsible person ask you to do?">
          <textarea id="instructions" rows={2} className={inputClass} value={instructions} onChange={(x) => setInstructions(x.target.value)} />
        </Field>
        <Button variant="secondary" className="mt-2" disabled={!online || saving || instructions === e.instructions} onClick={() => patch({ instructions })}>
          Save instructions
        </Button>
        <Field label="How was it resolved?" htmlFor="resolution">
          <textarea id="resolution" rows={3} className={inputClass} value={text} onChange={(x) => setText(x.target.value)} />
        </Field>
        <InlineError message={err} />
        <Button className="mt-3" loading={saving} disabled={!online || !text.trim()} onClick={() => status({ status: "RESOLVED", resolution: text })}>
          Mark as resolved
        </Button>
      </Card>
    );
  }

  return <RootCause report={e} run={run} saving={saving} err={err} online={online} />;
}

function RootCause({
  report: e,
  run,
  saving,
  err,
  online,
}: {
  report: ErrorReport;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  saving: boolean;
  err: string | null;
  online: boolean;
}) {
  const [cause, setCause] = useState<string>(e.root_cause || e.category);
  const [notes, setNotes] = useState(e.root_cause_notes);
  const [prevention, setPrevention] = useState(e.prevention_action);
  const done = Boolean(e.root_cause);
  return (
    <Card className={done ? "" : "border-2 border-brand-600"}>
      <SectionTitle>{done ? "Root-cause analysis (step 11)" : "Next: root-cause analysis (step 11)"}</SectionTitle>
      <p className="mb-2 text-sm text-slate-600">Focus on the process, not on blame. What would have prevented this?</p>
      <div className="space-y-3">
        <Field label="Root cause" htmlFor="cause">
          <select id="cause" className={inputClass} value={cause} onChange={(x) => setCause(x.target.value)}>
            {Object.entries(ERROR_CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Why did it happen?" htmlFor="rca-notes">
          <textarea id="rca-notes" rows={2} className={inputClass} value={notes} onChange={(x) => setNotes(x.target.value)} />
        </Field>
        <Field label="Prevention step" htmlFor="prevention" hint="A concrete habit or check you will use from now on.">
          <textarea id="prevention" rows={2} className={inputClass} value={prevention} onChange={(x) => setPrevention(x.target.value)} />
        </Field>
      </div>
      <InlineError message={err} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          loading={saving}
          disabled={!online}
          onClick={() =>
            run(() => api.patch(`/api/errors/${e.id}`, { root_cause: cause, root_cause_notes: notes, prevention_action: prevention }))
          }
        >
          Save root-cause analysis
        </Button>
        <Button variant="ghost" disabled={!online || saving} onClick={() => run(() => api.post(`/api/errors/${e.id}/status`, { status: "CORRECTING" }))}>
          <RotateCcw className="h-4 w-4" aria-hidden /> Reopen
        </Button>
      </div>
    </Card>
  );
}

function Record({ report: e, timezone }: { report: ErrorReport; timezone: string }) {
  const entries = [
    e.notified_at && { when: e.notified_at, text: `Notified: ${e.notified_person}` },
    e.correction_notes && { when: null, text: `Correction: ${e.correction_notes}` },
    e.instructions && { when: null, text: `Instructions: ${e.instructions}` },
    e.resolved_at && { when: e.resolved_at, text: `Resolved: ${e.resolution}` },
    e.root_cause && {
      when: null,
      text: `Root cause: ${ERROR_CATEGORY_LABEL[e.root_cause]}${e.root_cause_notes ? `. ${e.root_cause_notes}` : ""}`,
    },
    e.prevention_action && { when: null, text: `Prevention: ${e.prevention_action}` },
  ].filter(Boolean) as { when: string | null; text: string }[];
  if (!entries.length) return null;
  return (
    <Card>
      <SectionTitle>Correction record</SectionTitle>
      <ul className="space-y-2 text-sm text-slate-700">
        {entries.map((x) => (
          <li key={x.text}>
            {x.when && <span className="mr-2 text-xs tabular-nums text-slate-500">{formatDateTime(x.when, timezone)}</span>}
            {x.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}
