"use client";

import clsx from "clsx";

import { Badge } from "@/components/ui";
import { useNow } from "@/lib/hooks";
import { DEADLINE_STYLE, GUIDANCE, LEVEL_STYLE, STATUS_LABEL } from "@/lib/utils/labels";
import { formatCountdown } from "@/lib/utils/time";
import type { DeadlineInfo, Guidance, PriorityLevel, TaskStatus } from "@/types";

export function PriorityBadge({ level, score }: { level: PriorityLevel; score?: number }) {
  if (level === "NONE") return null;
  return (
    <Badge className={LEVEL_STYLE[level]}>
      {level}
      {score !== undefined && <span className="font-normal opacity-80">· {score}</span>}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const style =
    status === "COMPLETED"
      ? "bg-emerald-100 text-emerald-800"
      : status === "ESCALATED"
        ? "bg-red-100 text-red-800"
        : status === "WAITING" || status === "ON_HOLD"
          ? "bg-slate-200 text-slate-700"
          : status === "IN_PROGRESS"
            ? "bg-sky-100 text-sky-800"
            : "bg-slate-100 text-slate-700";
  return <Badge className={style}>{STATUS_LABEL[status]}</Badge>;
}

export function GuidanceChip({ guidance, compact }: { guidance: Guidance; compact?: boolean }) {
  const g = GUIDANCE[guidance];
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", g.style)}>
      <span aria-hidden>{g.emoji}</span>
      {compact ? g.label.split(" ")[0] : g.label}
    </span>
  );
}

/**
 * Live countdown. The status colour comes from the backend deadline engine (refreshed every
 * minute), the ticking text is computed locally from the shared clock.
 */
export function Countdown({
  deadline,
  info,
  size = "sm",
}: {
  deadline: string | null;
  info: DeadlineInfo;
  size?: "sm" | "lg";
}) {
  const now = useNow();
  const style = DEADLINE_STYLE[info.status];
  if (!deadline) {
    return <span className="text-sm text-slate-500">No deadline</span>;
  }
  const { text } = formatCountdown(deadline, now);
  if (size === "lg") {
    return (
      <div className={clsx("rounded-2xl px-4 py-3", style.bg)}>
        <p className={clsx("text-xs font-bold tracking-wide", style.text)}>
          <span aria-hidden>{style.dot}</span> {style.label}
          {info.approaching_critical && " · becomes critical soon"}
        </p>
        <p className={clsx("font-mono text-4xl font-bold tabular-nums", style.text)} aria-live="off">
          {text}
        </p>
        <p className={clsx("text-sm", style.text)}>{info.label}</p>
      </div>
    );
  }
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold", style.bg, style.text)}>
      <span aria-hidden>{style.dot}</span>
      <span className="font-mono tabular-nums">{text}</span>
    </span>
  );
}
