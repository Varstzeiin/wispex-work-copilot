"use client";

import clsx from "clsx";
import { AlertTriangle, CalendarClock, FileText, Ship, Plane } from "lucide-react";
import Link from "next/link";

import { Countdown, GuidanceChip, PriorityBadge, StatusBadge } from "@/components/task/badges";
import { formatDateTime } from "@/lib/utils/time";
import type { Task } from "@/types";

const BORDER: Record<string, string> = {
  CRITICAL: "border-l-red-600",
  HIGH: "border-l-orange-500",
  MEDIUM: "border-l-amber-400",
  LOW: "border-l-slate-300",
  NONE: "border-l-emerald-400",
};

export function TaskCard({ task, timeZone, extra }: { task: Task; timeZone: string; extra?: React.ReactNode }) {
  const docsDone = task.required_documents.length - task.missing_documents.length;
  const ModeIcon = task.transport_mode === "AIR" ? Plane : Ship;
  return (
    <Link
      href={`/tasks/${task.id}`}
      className={clsx(
        "block rounded-2xl border border-l-4 border-slate-200 bg-white p-3.5 shadow-sm transition hover:shadow-md",
        BORDER[task.priority_level],
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-semibold text-slate-900">
            {task.transport_mode && <ModeIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
            {task.shipment_reference ?? task.title}
          </p>
          <p className="truncate text-xs text-slate-500">
            {[task.client_name, task.shipment_reference ? task.title : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <PriorityBadge level={task.priority_level} score={task.priority_score} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {task.status !== "COMPLETED" && task.status !== "CANCELLED" && (
          <Countdown deadline={task.submission_deadline} info={task.deadline} />
        )}
        <StatusBadge status={task.status} />
        {task.status !== "COMPLETED" && task.status !== "CANCELLED" && <GuidanceChip guidance={task.guidance} compact />}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> ETA {formatDateTime(task.eta, timeZone)}
        </span>
        {task.required_documents.length > 0 && (
          <span className={clsx("inline-flex items-center gap-1", task.missing_documents.length && "font-semibold text-orange-700")}>
            <FileText className="h-3.5 w-3.5" aria-hidden /> Docs {docsDone}/{task.required_documents.length}
          </span>
        )}
        {task.open_issue_count > 0 && (
          <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {task.open_issue_count} issue
            {task.open_issue_count > 1 ? "s" : ""}
          </span>
        )}
        <span>~{task.estimated_minutes}m</span>
      </div>
      {extra}
    </Link>
  );
}
