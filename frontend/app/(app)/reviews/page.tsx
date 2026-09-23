"use client";

import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { ColumnChart } from "@/components/charts/BarChart";
import { Button, Card, ErrorState, Field, InlineError, PageHeader, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { Tabs } from "@/components/ui/Tabs";
import { useRefreshPerformance, useReviewHistory, useShiftReview, useWeeklyReview } from "@/features/performance/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { formatMinutes } from "@/lib/utils/time";
import type { PeriodStats } from "@/types";

type Tab = "shift" | "weekly" | "history";

export default function ReviewsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Reviews />
    </Suspense>
  );
}

function Reviews() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "shift");
  const [date, setDate] = useState<string | null>(params.get("date"));
  return (
    <div>
      <PageHeader title="Reviews" subtitle="Numbers are calculated from your recorded work. Reflections are yours." />
      <Tabs
        label="Review type"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "shift", label: "End of shift" },
          { key: "weekly", label: "Weekly" },
          { key: "history", label: "History" },
        ]}
      />
      {tab === "shift" && <ShiftReviewView date={date} setDate={setDate} />}
      {tab === "weekly" && <WeeklyReviewView />}
      {tab === "history" && (
        <HistoryView
          openDay={(d) => {
            setDate(d);
            setTab("shift");
          }}
        />
      )}
    </div>
  );
}

// ---------- helpers ----------

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function DateNav({ label, onPrev, onNext, canNext }: { label: string; onPrev: () => void; onNext: () => void; canNext: boolean }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-2">
      <button onClick={onPrev} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100" aria-label="Previous">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="font-semibold text-slate-900">{label}</span>
      <button onClick={onNext} disabled={!canNext} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label="Next">
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}

function StatGrid({ stats, extra }: { stats: PeriodStats; extra?: { label: string; value: string | number }[] }) {
  const items = [
    { label: "Tasks completed", value: stats.tasks_completed },
    {
      label: "On time",
      value: stats.completed_with_deadline ? `${stats.completed_on_time}/${stats.completed_with_deadline}` : "—",
    },
    { label: "Errors", value: stats.errors },
    { label: "Discrepancies", value: stats.discrepancies },
    { label: "Escalations", value: stats.escalations },
    { label: "Avg. processing", value: stats.avg_processing_minutes ? formatMinutes(stats.avg_processing_minutes) : "—" },
    { label: "Learning completed", value: stats.learning_completed },
    { label: "Feedback applied", value: stats.feedback_applied },
    ...(extra ?? []),
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl border border-slate-200 bg-white p-2.5">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{i.label}</dt>
          <dd className="text-xl font-bold tabular-nums text-slate-900">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Reflection({
  fields,
  initial,
  savedAt,
  onSave,
}: {
  fields: { key: string; label: string; placeholder: string }[];
  initial: Record<string, string>;
  savedAt: string | null;
  onSave: (values: Record<string, string>) => Promise<void>;
}) {
  const online = useOnline();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const initialKey = JSON.stringify(initial);

  useEffect(() => {
    setValues(JSON.parse(initialKey));
    setSaved(false);
  }, [initialKey]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <SectionTitle>Your reflection</SectionTitle>
      <div className="space-y-3">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={f.key}>
            <textarea
              id={f.key}
              rows={2}
              className={inputClass}
              placeholder={f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) => {
                setValues({ ...values, [f.key]: e.target.value });
                setSaved(false);
              }}
            />
          </Field>
        ))}
      </div>
      <InlineError message={error} />
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} loading={saving} disabled={!online}>
          Save reflection
        </Button>
        {(saved || savedAt) && <span className="text-xs text-slate-500">{saved ? "Saved." : "Saved earlier."}</span>}
      </div>
    </Card>
  );
}

// ---------- End of shift ----------

function ShiftReviewView({ date, setDate }: { date: string | null; setDate: (d: string | null) => void }) {
  const refresh = useRefreshPerformance();
  const { data, error, mutate } = useShiftReview(date);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  const s = data.stats;

  return (
    <div className="space-y-4">
      <DateNav
        label={data.is_today ? `Today · ${shortDate(data.review_date)}` : longDate(data.review_date)}
        onPrev={() => setDate(shiftDate(data.review_date, -1))}
        onNext={() => {
          const next = shiftDate(data.review_date, 1);
          setDate(data.is_today ? null : next);
        }}
        canNext={!data.is_today}
      />
      <Card>
        <p className="text-base leading-relaxed text-slate-800">{data.summary}</p>
      </Card>
      <StatGrid
        stats={s}
        extra={
          data.is_today
            ? [
                { label: "Pending now", value: s.pending ?? 0 },
                { label: "Critical now", value: s.critical ?? 0 },
                { label: "Waiting on others", value: s.waiting ?? 0 },
              ]
            : undefined
        }
      />
      {data.recurring_issue && (
        <section className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Most frequent issue in the last 14 days: <strong>{data.recurring_issue.label}</strong> ({data.recurring_issue.count}×).
          </p>
        </section>
      )}
      {data.is_today && s.tomorrow_priorities && s.tomorrow_priorities.length > 0 && (
        <Card>
          <SectionTitle>Tomorrow&apos;s priorities (from your open tasks)</SectionTitle>
          <ol className="space-y-2 text-sm">
            {s.tomorrow_priorities.map((p, i) => (
              <li key={p.task_id} className="flex gap-2">
                <span className="font-bold text-slate-400">{i + 1}</span>
                <Link href={`/tasks/${p.task_id}`} className="hover:underline">
                  <strong>{p.label}</strong> <span className="text-slate-600">· {p.reason}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <Reflection
        fields={[
          { key: "went_well", label: "What went well?", placeholder: "e.g. Checked every weight against the Packing List" },
          { key: "to_improve", label: "What will you do differently?", placeholder: "e.g. Ask earlier when a document is unclear" },
          { key: "tomorrow_focus", label: "Tomorrow's focus", placeholder: "e.g. Start with the earliest deadline" },
        ]}
        initial={{
          went_well: data.reflection.went_well,
          to_improve: data.reflection.to_improve,
          tomorrow_focus: data.reflection.tomorrow_focus,
        }}
        savedAt={data.reflection.saved_at}
        onSave={async (values) => {
          await api.put("/api/reviews/shift", { review_date: data.review_date, ...values });
          await refresh();
        }}
      />
    </div>
  );
}

// ---------- Weekly ----------

function WeeklyReviewView() {
  const refresh = useRefreshPerformance();
  const [week, setWeek] = useState<string | null>(null);
  const { data, error, mutate } = useWeeklyReview(week);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  const isCurrent = week === null;
  const s = data.stats;
  const p = data.previous_week;
  const delta = (now: number, before: number) => (now === before ? "same as" : now > before ? `${now - before} more than` : `${before - now} fewer than`);

  return (
    <div className="space-y-4">
      <DateNav
        label={`${shortDate(data.week_start)} – ${shortDate(data.week_end)}`}
        onPrev={() => setWeek(shiftDate(data.week_start, -7))}
        onNext={() => {
          const next = shiftDate(data.week_start, 7);
          setWeek(next > new Date().toISOString().slice(0, 10) ? null : next);
        }}
        canNext={!isCurrent}
      />
      <Card>
        <p className="text-sm leading-relaxed text-slate-800">
          This week: {s.tasks_completed} tasks completed ({delta(s.tasks_completed, p.tasks_completed)} the week before),{" "}
          {s.errors} error{s.errors === 1 ? "" : "s"} ({delta(s.errors, p.errors)} the week before), {s.escalations} escalation
          {s.escalations === 1 ? "" : "s"}. {data.shift_reviews_logged} end-of-shift review{data.shift_reviews_logged === 1 ? "" : "s"} written.
        </p>
        {data.recurring_issue && (
          <p className="mt-2 text-sm text-amber-900">
            Most frequent issue: <strong>{data.recurring_issue.label}</strong>.
          </p>
        )}
      </Card>
      <StatGrid stats={s} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Tasks completed per day</SectionTitle>
          <ColumnChart
            title="Tasks completed per day"
            data={data.days.map((d) => ({
              label: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d.date}T00:00:00Z`)),
              value: d.completed,
              detail: longDate(d.date),
            }))}
          />
        </Card>
        <Card>
          <SectionTitle>Errors per day</SectionTitle>
          <ColumnChart
            title="Errors per day"
            data={data.days.map((d) => ({
              label: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d.date}T00:00:00Z`)),
              value: d.errors,
              detail: longDate(d.date),
            }))}
          />
        </Card>
      </div>
      <Reflection
        fields={[
          { key: "went_well", label: "What went well this week?", placeholder: "" },
          { key: "to_improve", label: "What should improve?", placeholder: "" },
          { key: "next_week_focus", label: "Focus for next week", placeholder: "" },
        ]}
        initial={{
          went_well: data.reflection.went_well,
          to_improve: data.reflection.to_improve,
          next_week_focus: data.reflection.next_week_focus,
        }}
        savedAt={data.reflection.saved_at}
        onSave={async (values) => {
          await api.put("/api/reviews/weekly", { week_start: data.week_start, ...values });
          await refresh();
        }}
      />
    </div>
  );
}

// ---------- History ----------

function HistoryView({ openDay }: { openDay: (date: string) => void }) {
  const { data, error, mutate } = useReviewHistory();
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <SectionTitle>End-of-shift reviews</SectionTitle>
        {data.shift_reviews.length === 0 && <p className="text-sm text-slate-500">No saved reviews yet.</p>}
        <ul className="divide-y divide-slate-100">
          {data.shift_reviews.map((r) => (
            <li key={r.review_date}>
              <button onClick={() => openDay(r.review_date)} className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-slate-50">
                <span className="font-medium text-slate-900">{longDate(r.review_date)}</span>
                <span className="text-xs text-slate-500">
                  {r.tasks_completed} tasks · {r.errors} errors
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <SectionTitle>Weekly reviews</SectionTitle>
        {data.weekly_reviews.length === 0 && <p className="text-sm text-slate-500">No saved weekly reviews yet.</p>}
        <ul className="divide-y divide-slate-100">
          {data.weekly_reviews.map((r) => (
            <li key={r.week_start} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium text-slate-900">Week of {shortDate(r.week_start)}</span>
              <span className="text-xs text-slate-500">
                {r.tasks_completed} tasks · {r.errors} errors
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
