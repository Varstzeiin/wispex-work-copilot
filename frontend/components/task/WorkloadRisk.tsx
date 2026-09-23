import { Gauge } from "lucide-react";

import { formatMinutes } from "@/lib/utils/time";
import type { DailyPlan } from "@/types";

export function WorkloadRisk({ plan }: { plan: DailyPlan }) {
  const o = plan.overload;
  if (!o.is_overloaded) return null;
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900" role="alert">
      <h2 className="flex items-center gap-2 font-bold tracking-wide">
        <Gauge className="h-5 w-5" aria-hidden /> WORKLOAD RISK
      </h2>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/70 p-2">
          <dt className="text-[11px] uppercase text-red-700">Estimated workload</dt>
          <dd className="text-lg font-bold">{formatMinutes(o.workload_minutes)}</dd>
        </div>
        <div className="rounded-xl bg-white/70 p-2">
          <dt className="text-[11px] uppercase text-red-700">Available time</dt>
          <dd className="text-lg font-bold">{formatMinutes(o.available_minutes)}</dd>
        </div>
        <div className="rounded-xl bg-white/70 p-2">
          <dt className="text-[11px] uppercase text-red-700">Potential shortfall</dt>
          <dd className="text-lg font-bold">{formatMinutes(o.shortfall_minutes)}</dd>
        </div>
      </dl>
      <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm">
        {o.suggestions.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-red-800">Work is never reassigned automatically. Estimates use your own time estimates.</p>
    </section>
  );
}
