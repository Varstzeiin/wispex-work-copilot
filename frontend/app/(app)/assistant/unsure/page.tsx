"use client";

import clsx from "clsx";
import { CheckCircle2, Circle, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { CopyButton } from "@/components/assistant/CopyButton";
import { RewriteButton } from "@/components/assistant/RewriteButton";
import { SourceList } from "@/components/assistant/SourceList";
import { Button, Card, Field, InlineError, PageHeader, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { useRefreshAssistant } from "@/features/assistant/hooks";
import { useTasks } from "@/features/task-management/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { RECOMMENDATION_STYLE } from "@/lib/utils/labels";
import type { Clarification, UnsureResult } from "@/types";

export default function UnsurePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <UnsureForm />
    </Suspense>
  );
}

function UnsureForm() {
  const params = useSearchParams();
  const router = useRouter();
  const online = useOnline();
  const refresh = useRefreshAssistant();
  const { data: tasks } = useTasks({ view: "open", sort: "deadline", pageSize: 100 });

  const [taskId, setTaskId] = useState(params.get("task") ?? "");
  const [fieldName, setFieldName] = useState(params.get("field") ?? "");
  const [issue, setIssue] = useState("");
  const [evidence, setEvidence] = useState("");
  const [ask, setAsk] = useState("");
  const [greeting, setGreeting] = useState("Hi");
  const [askedTo, setAskedTo] = useState("Senior");
  const [compliance, setCompliance] = useState(false);
  const [financial, setFinancial] = useState(false);

  const [result, setResult] = useState<UnsureResult | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyse() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<UnsureResult>("/api/assistant/unsure", {
        task_id: taskId || null,
        field_name: fieldName,
        issue,
        evidence,
        ask,
        greeting,
        compliance_impact: compliance,
        financial_impact: financial,
      });
      setResult(r);
      setQuestion(r.draft.text);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function record(kind: "QUESTION" | "ESCALATION") {
    setBusy(true);
    setError(null);
    try {
      await api.post<Clarification>("/api/assistant/clarifications", {
        task_id: taskId || null,
        kind,
        field_name: fieldName,
        issue,
        evidence,
        question,
        asked_to: askedTo,
        compliance_impact: compliance,
      });
      await refresh();
      router.push(taskId ? `/tasks/${taskId}` : "/assistant");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const rec = result ? RECOMMENDATION_STYLE[result.assessment.recommendation] : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="I'm not sure" subtitle="Check trusted sources first. If they do not answer it, ask a precise question." />

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Task" htmlFor="task">
            <select id="task" className={inputClass} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">No specific task</option>
              {tasks?.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.shipment_reference ?? t.title} · {t.deadline.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Field or topic" htmlFor="field">
            <input id="field" className={inputClass} value={fieldName} onChange={(e) => setFieldName(e.target.value)} placeholder="e.g. Quantity" maxLength={120} />
          </Field>
        </div>
        <div className="mt-3 space-y-3">
          <Field label="What is unclear?" htmlFor="issue">
            <textarea id="issue" rows={2} className={inputClass} value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="e.g. The Invoice and Packing List show different quantities" maxLength={1000} />
          </Field>
          <Field label="Evidence (optional)" htmlFor="evidence" hint="Exact values and where you saw them. Left empty, a matching document discrepancy is used.">
            <textarea id="evidence" rows={2} className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="e.g. Invoice: 1,500 units. Packing List: 1,550 units" maxLength={1000} />
          </Field>
          <Field label="What do you need to know? (optional)" htmlFor="ask">
            <input id="ask" className={inputClass} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. which value should be used" maxLength={500} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Greeting" htmlFor="greeting">
              <input id="greeting" className={inputClass} value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={60} />
            </Field>
            <Field label="Ask whom (role)" htmlFor="asked-to">
              <input id="asked-to" className={inputClass} value={askedTo} onChange={(e) => setAskedTo(e.target.value)} maxLength={80} />
            </Field>
          </div>
          <fieldset className="space-y-2 text-sm">
            <legend className="text-sm font-medium text-slate-700">Possible impact</legend>
            <label className="flex items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={compliance} onChange={(e) => setCompliance(e.target.checked)} />
              Could affect compliance
            </label>
            <label className="flex items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={financial} onChange={(e) => setFinancial(e.target.checked)} />
              Could affect value, duties or the client
            </label>
          </fieldset>
        </div>
        <div className="mt-3">
          <InlineError message={error} />
        </div>
        <Button className="mt-3" block size="lg" loading={busy && !result} disabled={!online || issue.trim().length < 3} onClick={analyse}>
          <ShieldQuestion className="h-5 w-5" aria-hidden /> {result ? "Check again" : "Check sources and draft a question"}
        </Button>
      </Card>

      {result && rec && (
        <>
          <section className={clsx("rounded-2xl border p-4", rec.style)}>
            <p className="text-xs font-bold uppercase tracking-wide">{rec.label}</p>
            <p className="mt-1 font-semibold">{result.assessment.headline}</p>
            {result.assessment.triggers.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {result.assessment.triggers.map((t) => (
                  <li key={t.key} className="rounded-full bg-white/70 px-2 py-0.5 font-medium">
                    {t.label}
                  </li>
                ))}
              </ul>
            )}
            <ol className="mt-3 space-y-1 text-sm">
              {result.assessment.steps.map((s) => (
                <li key={s.key} className="flex items-start gap-2">
                  {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 opacity-50" aria-hidden />}
                  <span>
                    {s.label}
                    {s.note && <span className="opacity-80"> · {s.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs opacity-80">A suggestion based on your data. You decide, following the applicable SOP.</p>
          </section>

          <Card>
            <SectionTitle>1. What your trusted sources say</SectionTitle>
            {result.knowledge.length ? (
              <SourceList sources={result.knowledge} />
            ) : (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{result.knowledge_message}</p>
            )}
            <Link href="/knowledge" className="mt-2 inline-block text-xs font-semibold text-brand-700">
              Open knowledge base
            </Link>
          </Card>

          <Card>
            <SectionTitle>2. Your question</SectionTitle>
            <p className="mb-2 text-xs text-slate-500">Context → Specific issue → Evidence → Deadline → Question. Edit freely before sending.</p>
            <textarea rows={7} className={inputClass} value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question text" maxLength={3000} />
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <CopyButton text={question} />
              <RewriteButton text={question} onRewrite={setQuestion} />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Send it yourself through your usual work channel. Then record it here, so it stays visible on the task until you have the answer.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Button onClick={() => record("QUESTION")} disabled={!online || busy || question.trim().length < 5}>
                I asked this question
              </Button>
              <Button variant="secondary" onClick={() => record("ESCALATION")} disabled={!online || busy || question.trim().length < 5}>
                I escalated this
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
