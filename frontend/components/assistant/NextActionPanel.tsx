"use client";

import { ArrowRight, Crosshair, MailQuestion, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Countdown, GuidanceChip, PriorityBadge } from "@/components/task/badges";
import { Button, Card, ErrorState, LinkButton } from "@/components/ui";
import { useNextRecommendation } from "@/features/daily-planner/hooks";
import { errorMessage } from "@/lib/api/client";

/** "What should I work on now?" One recommendation, always with the reason. */
export function NextActionPanel({ autoOpen = false }: { autoOpen?: boolean }) {
  const [asked, setAsked] = useState(autoOpen);
  const { data, error, isLoading, isValidating, mutate } = useNextRecommendation(asked);

  if (!asked) {
    return (
      <Button size="lg" block onClick={() => setAsked(true)} className="shadow-sm">
        <Sparkles className="h-5 w-5" aria-hidden /> What should I work on now?
      </Button>
    );
  }

  return (
    <Card className="border-brand-100 bg-gradient-to-b from-brand-50 to-white">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-brand-900">
          <Sparkles className="h-4 w-4" aria-hidden /> What should I work on now?
        </h2>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100"
          aria-label="Recalculate recommendation"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isValidating ? "animate-spin" : ""}`} aria-hidden /> Recalculate
        </button>
      </div>

      {isLoading && <p className="py-4 text-sm text-slate-500">Analysing your current tasks…</p>}
      {error && <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />}

      {data && (
        <div className="space-y-3">
          {data.follow_up && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-orange-900">
                <MailQuestion className="h-4 w-4" aria-hidden /> First, a quick follow-up
              </p>
              <p className="mt-1 text-orange-900">{data.follow_up.action}.</p>
              <p className="mt-1 text-xs text-orange-800">{data.follow_up.why}</p>
              <Link href={`/tasks/${data.follow_up.task.id}`} className="mt-1 inline-block text-xs font-semibold text-orange-900 underline">
                Open {data.follow_up.task.shipment_reference ?? data.follow_up.task.title}
              </Link>
            </div>
          )}

          {data.recommendation ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-bold text-slate-900">
                  {data.recommendation.shipment_reference ?? data.recommendation.title}
                </p>
                <PriorityBadge level={data.recommendation.priority_level} score={data.recommendation.priority_score} />
                <Countdown deadline={data.recommendation.submission_deadline} info={data.recommendation.deadline} />
                <GuidanceChip guidance={data.recommendation.guidance} />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{data.explanation}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <LinkButton href={`/tasks/${data.recommendation.id}`} variant="primary">
                  Open task <ArrowRight className="h-4 w-4" aria-hidden />
                </LinkButton>
                <LinkButton href={`/focus?task=${data.recommendation.id}`}>
                  <Crosshair className="h-4 w-4" aria-hidden /> Focus mode
                </LinkButton>
              </div>
            </div>
          ) : (
            !data.follow_up && <p className="text-sm text-slate-700">{data.explanation}</p>
          )}

          {data.alternatives.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Next in line</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
                {data.alternatives.map((a) => (
                  <li key={a.task_id}>
                    <Link href={`/tasks/${a.task_id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{a.label}</span>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        {a.deadline_label}
                        <PriorityBadge level={a.priority_level} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            A recommendation based on your own priority settings. You decide what to work on and remain responsible
            for verification.
          </p>
        </div>
      )}
    </Card>
  );
}
