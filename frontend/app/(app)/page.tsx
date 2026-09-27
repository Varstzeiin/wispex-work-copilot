"use client";

import clsx from "clsx";
import { BellRing, ChevronRight, NotebookPen, Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { NextActionPanel } from "@/components/assistant/NextActionPanel";
import { TaskCard } from "@/components/task/TaskCard";
import { WorkloadRisk } from "@/components/task/WorkloadRisk";
import { Card, EmptyState, ErrorState, LinkButton, SectionTitle, Spinner } from "@/components/ui";
import { useAlerts, usePlan } from "@/features/daily-planner/hooks";
import { errorMessage } from "@/lib/api/client";
import { useMe, useNow, useSettings } from "@/lib/hooks";
import { formatFullDate, formatMinutes, formatTime } from "@/lib/utils/time";
import { t } from "@/lib/i18n";

export default function DashboardPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const params = useSearchParams();
  const { data: user } = useMe();
  const { timezone } = useSettings();
  const now = useNow();
  const { data: plan, error, mutate } = usePlan();
  const { data: alerts } = useAlerts();

  const firstName = user?.full_name?.split(" ")[0];
  const stats = plan
    ? [
        { label: t("Critical", "Kritis"), value: plan.counts.critical, href: "/tasks?level=CRITICAL", tone: "text-red-700" },
        { label: t("High", "Tinggi"), value: plan.counts.high, href: "/tasks?level=HIGH", tone: "text-orange-600" },
        { label: t("Overdue", "Terlambat"), value: plan.counts.overdue, href: "/tasks?sort=deadline", tone: "text-red-800" },
        { label: t("Waiting", "Menunggu"), value: plan.counts.blocked, href: "/tasks?status=WAITING,ESCALATED,ON_HOLD", tone: "text-slate-700" },
      ]
    : [];

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{formatFullDate(new Date(now), timezone)}</p>
          <h1 className="text-2xl font-bold text-slate-900">{firstName ? `${t("Hi", "Halo")} ${firstName}` : t("Today", "Hari ini")}</h1>
          {plan && (
            <p className="mt-0.5 text-sm text-slate-500">
              {plan.shift.status === "ON_SHIFT"
                ? t(
                    `On shift until ${formatTime(plan.shift.end, timezone)} · ${formatMinutes(plan.shift.available_minutes)} left`,
                    `Shift sampai ${formatTime(plan.shift.end, timezone)} · sisa ${formatMinutes(plan.shift.available_minutes)}`,
                  )
                : plan.shift.status === "BEFORE_SHIFT"
                  ? t(`Shift starts ${formatTime(plan.shift.start, timezone)}`, `Shift mulai ${formatTime(plan.shift.start, timezone)}`)
                  : t("Shift ended for today", "Shift hari ini sudah selesai")}
            </p>
          )}
        </div>
        <LinkButton href="/tasks/new" variant="primary" className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">{t("New task", "Task baru")}</span>
        </LinkButton>
      </header>

      <NextActionPanel autoOpen={params.get("next") === "1"} />

      {error && <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />}
      {!plan && !error && <Spinner />}

      {plan && (
        <>
          <div className="grid grid-cols-4 gap-2">
            {stats.map((s) => (
              <Link key={s.label} href={s.href} className="rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm hover:shadow">
                <p className={clsx("text-2xl font-bold tabular-nums", s.value ? s.tone : "text-slate-300")}>{s.value}</p>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{s.label}</p>
              </Link>
            ))}
          </div>

          <Card>
            <p className="text-sm leading-relaxed text-slate-700">{plan.summary}</p>
            <Link href="/planner" className="mt-2 inline-flex items-center text-sm font-semibold text-brand-700">
              {t("Open daily plan", "Buka rencana harian")} <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </Card>

          <WorkloadRisk plan={plan} />

          {(() => {
            const endingSoon =
              plan.shift.status === "AFTER_SHIFT" || (plan.shift.status === "ON_SHIFT" && plan.shift.available_minutes <= 60);
            return (
              <Link
                href="/reviews"
                className={clsx(
                  "flex items-center gap-3 rounded-2xl border p-3 text-sm",
                  endingSoon ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white",
                )}
              >
                <NotebookPen className="h-5 w-5 shrink-0 text-brand-700" aria-hidden />
                <span className="flex-1">
                  <span className="font-semibold text-slate-900">{t("End-of-shift review", "Refleksi akhir shift")}</span>
                  <span className="block text-slate-600">
                    {endingSoon
                      ? t("Your shift is ending. Take two minutes to review today.", "Shift kamu hampir selesai. Luangkan dua menit untuk meninjau hari ini.")
                      : t("See today's numbers and write a short reflection.", "Lihat angka hari ini dan tulis refleksi singkat.")}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
              </Link>
            );
          })()}

          {alerts && alerts.alerts.length > 0 && (
            <section>
              <SectionTitle>{t("Deadline alerts", "Peringatan deadline")}</SectionTitle>
              <ul className="space-y-2">
                {alerts.alerts.slice(0, 5).map((a) => (
                  <li key={`${a.task_id}-${a.kind}`}>
                    <Link
                      href={`/tasks/${a.task_id}`}
                      className={clsx(
                        "flex items-center gap-3 rounded-xl border px-3 py-2 text-sm",
                        a.kind === "APPROACHING" ? "border-orange-200 bg-orange-50" : "border-red-200 bg-red-50",
                      )}
                    >
                      <BellRing className={clsx("h-4 w-4 shrink-0", a.kind === "APPROACHING" ? "text-orange-600" : "text-red-600")} aria-hidden />
                      <span className="font-semibold text-slate-900">{a.title}</span>
                      <span className="flex-1 truncate text-slate-600">{a.message}</span>
                      <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <SectionTitle
              action={
                <Link href="/tasks" className="text-sm font-semibold text-brand-700">
                  {t("All tasks", "Semua task")}
                </Link>
              }
            >
              {t("Needs attention", "Perlu perhatian")}
            </SectionTitle>
            {plan.recommended_tasks.length === 0 ? (
              <EmptyState title={t("Nothing in your queue", "Belum ada task di antrean")}>
                <Link href="/tasks/new" className="font-semibold text-brand-700">
                  {t("Add a task", "Tambah task")}
                </Link>{" "}
                {t("or try the demo to see how prioritisation works.", "atau coba demo untuk melihat cara kerja prioritas.")}
              </EmptyState>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {plan.recommended_tasks.slice(0, 6).map((item) => (
                  <TaskCard
                    key={item.task.id}
                    task={item.task}
                    timeZone={timezone}
                    extra={<p className="mt-2 text-xs font-medium text-slate-700">→ {item.next_action}</p>}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
