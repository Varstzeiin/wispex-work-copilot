"use client";

import clsx from "clsx";
import { EyeOff, GraduationCap, Lightbulb, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BarList, ColumnChart } from "@/components/charts/BarChart";
import { Button, Card, EmptyState, ErrorState, InlineError, PageHeader, SectionTitle, Spinner } from "@/components/ui";
import { Tabs } from "@/components/ui/Tabs";
import { useAnalytics, useForecast, usePatterns, useRefreshAutomation } from "@/features/automation/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { FORECAST_STATUS, ISSUE_LABEL } from "@/lib/utils/labels";
import { formatMinutes } from "@/lib/utils/time";
import type { Finding, IssueType } from "@/types";

type Tab = "forecast" | "patterns" | "analytics";

export default function InsightsPage() {
  const [tab, setTab] = useState<Tab>("forecast");
  return (
    <div className="space-y-4">
      <PageHeader title="Insights" subtitle="Forecasts and patterns from your own records. Information only: nothing changes automatically." />
      <Tabs
        label="Insights"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "forecast", label: "Workload" },
          { key: "patterns", label: "Patterns" },
          { key: "analytics", label: "Analytics" },
        ]}
      />
      {tab === "forecast" && <ForecastView />}
      {tab === "patterns" && <PatternsView />}
      {tab === "analytics" && <AnalyticsView />}
    </div>
  );
}

function ForecastView() {
  const { data, error, mutate } = useForecast();
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  const scale = Math.max(1, ...data.days.map((d) => Math.max(d.expected_minutes, d.capacity_minutes)));

  return (
    <div className="space-y-4">
      {data.advice.length > 0 && (
        <ul className="space-y-2">
          {data.advice.map((a) => (
            <li key={a} className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden /> {a}
            </li>
          ))}
        </ul>
      )}
      <Card>
        <SectionTitle>Next working days</SectionTitle>
        <ul className="space-y-4">
          {data.days.map((d) => {
            const s = FORECAST_STATUS[d.status];
            return (
              <li key={d.date}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-slate-900">{d.label}</span>
                  <span className={clsx("font-semibold", s.style)}>
                    <span aria-hidden>{s.icon}</span> {s.label}
                  </span>
                </div>
                {/* Expected work as a bar, shift capacity as a marker line */}
                <div className="relative mt-1 h-3 rounded-full bg-slate-100" aria-hidden>
                  <div className={clsx("h-3 rounded-full", s.bar)} style={{ width: `${(100 * d.expected_minutes) / scale}%` }} />
                  {d.capacity_minutes > 0 && (
                    <div className="absolute -top-1 h-5 w-0.5 bg-slate-700" style={{ left: `${(100 * d.capacity_minutes) / scale}%` }} />
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Expected {formatMinutes(d.expected_minutes)} · shift {formatMinutes(d.capacity_minutes)}. {d.explanation}
                </p>
                {d.task_refs.length > 0 && (
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                    {d.task_refs.map((t) => (
                      <Link key={t.id} href={`/tasks/${t.id}`} className="font-semibold text-brand-700">
                        {t.label}
                      </Link>
                    ))}
                    {d.known_tasks > d.task_refs.length && <span className="text-slate-500">+{d.known_tasks - d.task_refs.length} more</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Bar: expected work. Line: your shift. Expected work is the larger of the tasks already due and a typical day, based on{" "}
          {data.history_tasks} completed tasks. {data.note}
        </p>
      </Card>
      {data.calibration.tasks > 0 && (
        <Card>
          <SectionTitle>How long your tasks really take</SectionTitle>
          <p className="text-sm text-slate-700">
            On average {Math.round(data.calibration.ratio * 100)}% of the estimate ({data.calibration.tasks} tasks).
            {Object.entries(data.calibration.by_mode).map(([mode, v]) => (
              <span key={mode}>
                {" "}
                {mode === "AIR" ? "Air" : "Sea"}: {Math.round(v.ratio * 100)}% ({v.tasks} tasks).
              </span>
            ))}
          </p>
          <p className="mt-1 text-xs text-slate-500">The forecast uses these ratios. Your task estimates are not changed.</p>
        </Card>
      )}
    </div>
  );
}

function PatternsView() {
  const online = useOnline();
  const refresh = useRefreshAutomation();
  const { data, error, mutate } = usePatterns();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHandled, setShowHandled] = useState(false);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;

  async function act(f: Finding, action: "learn" | "dismiss") {
    setBusy(f.key);
    setActionError(null);
    try {
      await api.post(`/api/automation/suggestions/${action}`, { key: f.key });
      await refresh();
      setMessage(action === "learn" ? `Added to your learning tracker: “${f.suggestion}”` : null);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const open = data.findings.filter((f) => !f.handled);
  const handled = data.findings.filter((f) => f.handled);

  return (
    <div className="space-y-4">
      {!data.client_patterns_allowed && (
        <p className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Patterns per client are off. Only overall patterns are shown.{" "}
            <Link href="/settings#automation" className="font-semibold text-brand-700">
              Switch on in Settings
            </Link>{" "}
            if your organization permits analysing work per client.
          </span>
        </p>
      )}
      {message && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {message}
        </p>
      )}
      <InlineError message={actionError} />
      {open.length === 0 ? (
        <EmptyState title="No new patterns">Based on {data.tasks_analysed} tasks in the last {data.days} days.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {open.map((f) => (
            <Card key={f.key}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{f.title}</h3>
                {f.scope !== "all" && <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">{f.scope}</span>}
              </div>
              <p className="mt-1 text-sm text-slate-600">{f.evidence}</p>
              <p className="mt-2 flex gap-2 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-950">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {f.suggestion}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => act(f, "learn")} loading={busy === f.key} disabled={!online || !!busy}>
                  <GraduationCap className="h-4 w-4" aria-hidden /> Add to learning
                </Button>
                <Button variant="ghost" onClick={() => act(f, "dismiss")} disabled={!online || !!busy}>
                  <X className="h-4 w-4" aria-hidden /> Dismiss
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {handled.length > 0 && (
        <button onClick={() => setShowHandled(!showHandled)} className="text-sm font-semibold text-brand-700">
          {showHandled ? "Hide" : "Show"} {handled.length} handled pattern{handled.length > 1 ? "s" : ""}
        </button>
      )}
      {showHandled && (
        <ul className="space-y-1 text-sm text-slate-600">
          {handled.map((f) => (
            <li key={f.key}>
              {f.title} <span className="text-slate-400">· {f.evidence}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">{data.note} Suggestions never change your tasks, settings or official SOP.</p>
    </div>
  );
}

function AnalyticsView() {
  const { data, error, mutate } = useAnalytics();
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  if (data.total_completed === 0) return <EmptyState title="No completed tasks yet">Analytics appear once you complete tasks.</EmptyState>;
  const week = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <SectionTitle>Completed per week</SectionTitle>
        <ColumnChart
          title="Completed tasks per week"
          data={data.weekly.map((w) => ({ label: week(w.week_start), value: w.completed, detail: `week of ${week(w.week_start)}` }))}
        />
      </Card>
      <Card>
        <SectionTitle>On time per week (%)</SectionTitle>
        <ColumnChart
          title="Share of tasks completed before the deadline, per week"
          data={data.weekly.map((w) => ({
            label: week(w.week_start),
            value: w.on_time_pct ?? 0,
            muted: w.on_time_pct === null,
            detail: w.on_time_pct === null ? "no tasks with a deadline" : `${w.on_time_pct}% on time`,
          }))}
        />
      </Card>
      <Card>
        <SectionTitle>Estimate vs actual</SectionTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1 font-medium">Mode</th>
              <th className="py-1 text-right font-medium">Tasks</th>
              <th className="py-1 text-right font-medium">Estimate</th>
              <th className="py-1 text-right font-medium">Actual</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.by_mode.map((m) => (
              <tr key={m.mode} className="border-t border-slate-100">
                <td className="py-1.5">{m.mode}</td>
                <td className="py-1.5 text-right">{m.tasks}</td>
                <td className="py-1.5 text-right">{formatMinutes(m.avg_estimate)}</td>
                <td className={clsx("py-1.5 text-right font-semibold", m.avg_actual > m.avg_estimate * 1.2 && "text-amber-800")}>
                  {formatMinutes(m.avg_actual)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <SectionTitle>Processing time by weekday</SectionTitle>
        <BarList title="Minutes of processing time per weekday" data={data.weekday_minutes.map((d) => ({ label: d.day, value: d.minutes }))} />
      </Card>
      <Card className="md:col-span-2">
        <SectionTitle>Issues recorded on completed tasks</SectionTitle>
        <BarList
          title="Issues by type"
          data={data.issues.map((i) => ({ label: ISSUE_LABEL[i.type as IssueType] ?? i.type, value: i.count }))}
          empty="No issues recorded."
        />
      </Card>
    </div>
  );
}
