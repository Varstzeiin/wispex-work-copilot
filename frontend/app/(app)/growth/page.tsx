"use client";

import clsx from "clsx";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import { useState } from "react";

import { Button, Card, ErrorState, Field, InlineError, Modal, PageHeader, Spinner, inputClass } from "@/components/ui";
import { Tabs } from "@/components/ui/Tabs";
import { useDevelopmentPlan, useIndicators, useRefreshPerformance } from "@/features/performance/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { INDICATOR_STATUS } from "@/lib/utils/labels";
import type { DevelopmentPlanData } from "@/types";

export default function GrowthPage() {
  const [tab, setTab] = useState<"indicators" | "plan">("indicators");
  return (
    <div>
      <PageHeader title="Growth" subtitle="Evidence of progress: accuracy, reliability, independence, trust." />
      <Tabs
        label="Growth view"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "indicators", label: "Reliability indicators" },
          { key: "plan", label: "30 / 60 / 90 days" },
        ]}
      />
      {tab === "indicators" ? <Indicators /> : <Plan />}
    </div>
  );
}

function Indicators() {
  const [days, setDays] = useState(30);
  const { data, error, mutate } = useIndicators(days);
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Personal Reliability Indicators</h2>
        <p className="mt-1 text-sm text-slate-600">
          For your own development only. This is not an official company evaluation, and there is deliberately no overall
          score. Each indicator shows the evidence behind it.
        </p>
        <div className="mt-3 flex gap-2" role="group" aria-label="Period">
          {[14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-sm font-medium",
                days === d ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700",
              )}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {data.indicators.map((i) => {
          const st = INDICATOR_STATUS[i.status];
          return (
            <section key={i.key} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{i.label}</h3>
                <span className={clsx("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", st.style)}>
                  <span aria-hidden>{st.icon}</span> {st.label}
                </span>
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{i.value}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {i.evidence.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
              {i.note && <p className="mt-2 text-xs italic text-slate-500">{i.note}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

const PHASE_STYLE: Record<string, string> = {
  CURRENT: "border-2 border-brand-600",
  PAST: "border border-slate-200",
  UPCOMING: "border border-dashed border-slate-300",
  NOT_STARTED: "border border-dashed border-slate-300",
};

function Plan() {
  const { data, error, mutate } = useDevelopmentPlan();
  const refresh = useRefreshPerformance();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [goalFor, setGoalFor] = useState<30 | 60 | 90 | null>(null);
  const [goalTitle, setGoalTitle] = useState("");
  const [evidenceFor, setEvidenceFor] = useState<DevelopmentPlanData["phases"][number]["goals"][number] | null>(null);
  const [evidence, setEvidence] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;

  return (
    <div className="space-y-4">
      <Card>
        {data.start_date ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-slate-800">
              <span className="text-3xl font-bold tabular-nums">Day {data.day_number}</span>
              <span className="ml-2 text-sm text-slate-500">since {data.start_date}</span>
            </p>
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-brand-700">Change start date</summary>
              <div className="mt-2 flex gap-2">
                <input type="date" className={inputClass} value={start} max={data.today} onChange={(e) => setStart(e.target.value)} aria-label="Start date" />
                <Button disabled={!start || !online} loading={busy} onClick={() => run(() => api.put("/api/growth/plan", { start_date: start }))}>
                  Save
                </Button>
              </div>
            </details>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">Set your first working day in this role to track your 30 / 60 / 90 day progress.</p>
            <div className="flex gap-2">
              <input type="date" className={inputClass} value={start} max={data.today} onChange={(e) => setStart(e.target.value)} aria-label="Start date" />
              <Button disabled={!start || !online} loading={busy} onClick={() => run(() => api.put("/api/growth/plan", { start_date: start }))}>
                Start
              </Button>
            </div>
          </div>
        )}
        <InlineError message={actionError} />
      </Card>

      {data.phases.map((phase) => (
        <section key={phase.phase} className={clsx("rounded-2xl bg-white p-4", PHASE_STYLE[phase.status])}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-slate-900">
              Day {phase.phase}: {phase.title}
            </h2>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {phase.status === "CURRENT" ? "Current phase" : phase.status === "PAST" ? "Completed period" : phase.status === "UPCOMING" ? "Upcoming" : "Not started"}
              {phase.window && ` · ${phase.window.start} to ${phase.window.end}`}
            </span>
          </div>

          <ul className="mt-3 space-y-1.5">
            {phase.goals.map((g) => (
              <li key={g.id} className="flex items-start gap-2">
                <button
                  onClick={() => run(() => api.patch(`/api/growth/goals/${g.id}`, { done: !g.done }))}
                  disabled={!online || busy}
                  className="mt-0.5 shrink-0"
                  aria-label={g.done ? `Mark "${g.title}" as not done` : `Mark "${g.title}" as done`}
                >
                  {g.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                </button>
                <div className="min-w-0 text-sm">
                  <p className={g.done ? "text-slate-600" : "text-slate-900"}>{g.title}</p>
                  {g.evidence ? (
                    <p className="text-xs text-emerald-800">Evidence: {g.evidence}</p>
                  ) : (
                    <button
                      onClick={() => {
                        setEvidenceFor(g);
                        setEvidence("");
                      }}
                      className="text-xs font-semibold text-brand-700"
                    >
                      Add evidence
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={() => {
              setGoalFor(phase.phase);
              setGoalTitle("");
            }}
            disabled={!online}
            className="mt-2 flex items-center gap-1 text-xs font-semibold text-brand-700 disabled:text-slate-400"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add goal
          </button>

          {phase.evidence && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded evidence in this period</p>
              <dl className="mt-1 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                {[
                  ["Tasks done", phase.evidence.tasks_completed],
                  ["On time", phase.evidence.on_time_rate === null ? "—" : `${phase.evidence.on_time_rate}%`],
                  ["Errors", phase.evidence.errors],
                  ["Learned", phase.evidence.learning_completed],
                  ["Feedback applied", phase.evidence.feedback_applied],
                  ["Shift reviews", phase.evidence.shift_reviews],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-[10px] uppercase text-slate-500">{label}</dt>
                    <dd className="font-bold tabular-nums text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      ))}

      <Modal open={goalFor !== null} title={`Add a day-${goalFor} goal`} onClose={() => setGoalFor(null)}>
        <Field label="Goal" htmlFor="goal-title">
          <input id="goal-title" className={inputClass} value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} />
        </Field>
        <Button
          block
          className="mt-3"
          loading={busy}
          disabled={!goalTitle.trim()}
          onClick={async () => {
            if (await run(() => api.post("/api/growth/goals", { phase: goalFor, title: goalTitle }))) setGoalFor(null);
          }}
        >
          Add goal
        </Button>
      </Modal>

      <Modal open={evidenceFor !== null} title="Add evidence" onClose={() => setEvidenceFor(null)}>
        <p className="mb-2 text-sm text-slate-600">{evidenceFor?.title}</p>
        <Field label="What shows this is achieved?" htmlFor="goal-evidence" hint="e.g. Explained the Packing List to supervisor on 12 Sep">
          <textarea id="goal-evidence" rows={3} className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        </Field>
        <Button
          block
          className="mt-3"
          loading={busy}
          disabled={!evidence.trim()}
          onClick={async () => {
            if (evidenceFor && (await run(() => api.patch(`/api/growth/goals/${evidenceFor.id}`, { evidence })))) setEvidenceFor(null);
          }}
        >
          Save evidence
        </Button>
      </Modal>
    </div>
  );
}
