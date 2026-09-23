"use client";

import { ArrowRight, CheckCircle2, Circle, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { StatusActions } from "@/components/task/StatusActions";
import { Countdown, GuidanceChip } from "@/components/task/badges";
import { DocumentChecklist } from "@/components/task/TaskSections";
import { EmptyState, ErrorState, LinkButton, Spinner } from "@/components/ui";
import { useNextRecommendation } from "@/features/daily-planner/hooks";
import { useTask } from "@/features/task-management/hooks";
import { errorMessage } from "@/lib/api/client";
import { ISSUE_LABEL } from "@/lib/utils/labels";

export default function FocusPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Focus />
    </Suspense>
  );
}

/** Focus mode: one task, only what is needed to finish it accurately. */
function Focus() {
  const params = useSearchParams();
  const router = useRouter();
  const explicitId = params.get("task");
  const { data: next, error: nextError } = useNextRecommendation(!explicitId);
  const taskId = explicitId ?? next?.recommendation?.id ?? next?.follow_up?.task.id ?? null;
  const { data: task, error } = useTask(taskId);

  const exit = (
    <button onClick={() => router.push(taskId ? `/tasks/${taskId}` : "/")} className="flex items-center gap-1 text-sm font-medium text-slate-500">
      <X className="h-4 w-4" aria-hidden /> Exit focus
    </button>
  );

  if (error || nextError) return <ErrorState message={errorMessage(error ?? nextError)} />;
  if (!explicitId && next && !taskId) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        {exit}
        <EmptyState title="Nothing to focus on">{next.explanation}</EmptyState>
      </div>
    );
  }
  if (!task) return <Spinner />;

  const closed = task.status === "COMPLETED" || task.status === "CANCELLED";
  const openIssues = task.issues.filter((i) => !i.resolved);
  const nextAction = task.deadline.overdue
    ? "The deadline has passed. Inform the appropriate person according to the SOP, then complete and verify carefully."
    : task.missing_documents.length
    ? `Request ${task.missing_documents.join(", ")}. Continue verifying the documents you already have.`
    : openIssues.length
      ? "Verify the open issue against the source documents before continuing."
      : task.assigned_action || "Process and verify each field against the source documents.";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold tracking-wide text-white">FOCUS MODE</span>
        {exit}
      </div>

      <div>
        <h1 className="text-3xl font-bold uppercase tracking-tight text-slate-900">{task.shipment_reference ?? task.title}</h1>
        <p className="text-sm text-slate-500">{[task.client_name, task.title].filter(Boolean).join(" · ")}</p>
      </div>

      {closed ? (
        <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">
          <p className="font-semibold">Task {task.status.toLowerCase()}.</p>
          <LinkButton href="/focus" variant="primary" className="mt-3">
            Next recommended task <ArrowRight className="h-4 w-4" aria-hidden />
          </LinkButton>
        </div>
      ) : (
        <Countdown deadline={task.submission_deadline} info={task.deadline} size="lg" />
      )}

      {!closed && (
        <section className="rounded-2xl border-2 border-brand-600 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">Next action</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{nextAction}</p>
          <div className="mt-2">
            <GuidanceChip guidance={task.guidance} />
          </div>
        </section>
      )}

      <DocumentChecklist task={task} disabled={closed} />

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Before completing</p>
        <ul className="space-y-1.5 text-sm">
          <CheckRow done={task.missing_documents.length === 0} label="All required documents received" />
          <CheckRow done={openIssues.length === 0} label="No open issues" />
          <CheckRow done={false} label="Each field verified against the source documents (your confirmation)" />
        </ul>
        {openIssues.length > 0 && (
          <ul className="mt-3 space-y-2">
            {openIssues.map((i) => (
              <li key={i.id} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <strong>{ISSUE_LABEL[i.type]}:</strong> {i.description}
              </li>
            ))}
          </ul>
        )}
        {openIssues.length > 0 && (
          <Link href={`/tasks/${task.id}`} className="mt-2 inline-block text-sm font-semibold text-brand-700">
            Resolve issues on the task page
          </Link>
        )}
      </section>

      <StatusActions task={task} />
    </div>
  );
}

function CheckRow({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden /> : <Circle className="h-5 w-5 text-slate-300" aria-hidden />}
      <span className={done ? "text-slate-700" : "text-slate-900"}>{label}</span>
    </li>
  );
}
