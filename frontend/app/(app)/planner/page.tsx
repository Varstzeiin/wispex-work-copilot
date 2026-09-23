"use client";

import clsx from "clsx";
import { AlertTriangle, MailQuestion, RefreshCw } from "lucide-react";
import Link from "next/link";

import { GuidanceChip, PriorityBadge, StatusBadge } from "@/components/task/badges";
import { WorkloadRisk } from "@/components/task/WorkloadRisk";
import { Card, EmptyState, ErrorState, PageHeader, SectionTitle, Spinner } from "@/components/ui";
import { usePlan } from "@/features/daily-planner/hooks";
import { errorMessage } from "@/lib/api/client";
import { useSettings } from "@/lib/hooks";
import { formatMinutes, formatTime } from "@/lib/utils/time";

export default function PlannerPage() {
  const { timezone } = useSettings();
  const { data: plan, error, isValidating, mutate } = usePlan();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Daily plan"
        subtitle={plan ? `Recalculated ${formatTime(plan.generated_at, timezone)} · updates every minute and after every change` : undefined}
        action={
          <button
            onClick={() => mutate()}
            className="flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            <RefreshCw className={clsx("h-4 w-4", isValidating && "animate-spin")} aria-hidden /> Recalculate
          </button>
        }
      />
      {error && <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />}
      {!plan && !error && <Spinner />}
      {plan && (
        <>
          <Card>
            <p className="text-sm leading-relaxed text-slate-700">{plan.summary}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-2">
                <dt className="text-[11px] uppercase text-slate-500">Workload</dt>
                <dd className="font-bold text-slate-900">{formatMinutes(plan.estimated_workload_minutes)}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-2">
                <dt className="text-[11px] uppercase text-slate-500">Shift time left</dt>
                <dd className="font-bold text-slate-900">{formatMinutes(plan.shift.available_minutes)}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-2">
                <dt className="text-[11px] uppercase text-slate-500">Est. finish</dt>
                <dd className="font-bold text-slate-900">{formatTime(plan.estimated_completion_time, timezone)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              Shift {formatTime(plan.shift.start, timezone)}–{formatTime(plan.shift.end, timezone)} ({timezone}). A flexible
              recommendation, not a fixed schedule.
            </p>
          </Card>

          <WorkloadRisk plan={plan} />

          {plan.follow_ups.length > 0 && (
            <Card className="border-orange-200">
              <SectionTitle>Quick follow-ups to send early</SectionTitle>
              <ul className="space-y-2 text-sm">
                {plan.follow_ups.map((f) => (
                  <li key={f.task_id}>
                    <Link href={`/tasks/${f.task_id}`} className="flex items-start gap-2 rounded-xl bg-orange-50 px-3 py-2 text-orange-900">
                      <MailQuestion className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        <strong>{f.label}</strong>: request {f.missing_documents.join(", ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Requesting missing documents early gives the sender time to respond.</p>
            </Card>
          )}

          <section>
            <SectionTitle>Recommended order</SectionTitle>
            {plan.recommended_tasks.length === 0 ? (
              <EmptyState title="No workable tasks right now" />
            ) : (
              <ol className="space-y-2">
                {plan.recommended_tasks.map((item) => (
                  <li key={item.task.id}>
                    <Link
                      href={`/tasks/${item.task.id}`}
                      className={clsx(
                        "flex gap-3 rounded-2xl border bg-white p-3 shadow-sm hover:shadow",
                        item.at_risk ? "border-red-300" : "border-slate-200",
                      )}
                    >
                      <div className="flex w-14 shrink-0 flex-col items-center border-r border-slate-100 pr-3 text-center">
                        <span className="text-lg font-bold text-slate-400">{item.position}</span>
                        <span className="text-xs font-semibold tabular-nums text-slate-700">{formatTime(item.projected_start, timezone)}</span>
                        <span className="text-[10px] text-slate-400">to {formatTime(item.projected_end, timezone)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{item.task.shipment_reference ?? item.task.title}</span>
                          <PriorityBadge level={item.task.priority_level} />
                          <GuidanceChip guidance={item.task.guidance} compact />
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {item.task.deadline.label} · ~{item.task.estimated_minutes}m
                        </p>
                        <p className="mt-1 text-sm text-slate-700">→ {item.next_action}</p>
                        {item.at_risk && (
                          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-red-700">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> At this pace it may finish after the deadline
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {plan.blocked_tasks.length > 0 && (
            <section>
              <SectionTitle>Waiting on others</SectionTitle>
              <ul className="space-y-2">
                {plan.blocked_tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                      <span>
                        <span className="font-semibold text-slate-900">{t.shipment_reference ?? t.title}</span>
                        <span className="block text-xs text-slate-500">
                          {t.deadline.label}
                          {t.assigned_action && ` · ${t.assigned_action}`}
                        </span>
                      </span>
                      <StatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Check whether answers have arrived. Continue the parts you can verify meanwhile.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
