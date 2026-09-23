import { Clock, Lock } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui";

/**
 * Honest placeholder for features planned in a later MVP phase.
 * It never shows buttons that look functional but do nothing.
 */
export function ComingLater({
  title,
  phase,
  summary,
  planned,
  principles,
  children,
}: {
  title: string;
  phase: string;
  summary: string;
  planned: string[];
  principles?: string[];
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} />
      {children}
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-5">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold tracking-wide text-slate-600">
          <Clock className="h-3.5 w-3.5" aria-hidden /> COMING LATER · {phase}
        </p>
        <p className="mt-3 text-sm text-slate-700">{summary}</p>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Planned</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {planned.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {principles && (
          <>
            <p className="mt-4 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Built-in safeguards
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {principles.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
