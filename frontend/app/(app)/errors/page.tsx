"use client";

import clsx from "clsx";
import { BookPlus, ChevronRight, Lightbulb, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BarList, ColumnChart } from "@/components/charts/BarChart";
import { Badge, Button, Card, EmptyState, ErrorState, InlineError, LinkButton, PageHeader, SectionTitle, Spinner } from "@/components/ui";
import { Tabs } from "@/components/ui/Tabs";
import { useErrorAnalytics, useErrors, useRefreshPerformance } from "@/features/performance/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useSettings } from "@/lib/hooks";
import { ERROR_STATUS, LEVEL_LABEL, SEVERITY_STYLE } from "@/lib/utils/labels";
import { formatDateTime, formatMinutes } from "@/lib/utils/time";
import { t } from "@/lib/i18n";
import type { PriorityLevel, RecurringPattern } from "@/types";

export default function ErrorsPage() {
  const [tab, setTab] = useState<"log" | "analytics">("log");
  return (
    <div>
      <PageHeader
        title={t("Errors", "Kesalahan")}
        subtitle={t("Report early, correct transparently, learn from it.", "Laporkan lebih awal, koreksi dengan terbuka, lalu belajar darinya.")}
        action={
          <LinkButton href="/errors/new" variant="primary">
            <Plus className="h-4 w-4" aria-hidden /> {t("Report an error", "Laporkan kesalahan")}
          </LinkButton>
        }
      />
      <p className="mb-4 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
        {t(
          "A personal record for your own improvement, not an official evaluation. Reporting a mistake as soon as you confirm it is always the right move.",
          "Catatan pribadi untuk perbaikan dirimu, bukan penilaian resmi. Melaporkan kesalahan begitu kamu yakin selalu langkah yang tepat.",
        )}
      </p>
      <Tabs
        label={t("Errors view", "Tampilan kesalahan")}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "log", label: t("Error log", "Log kesalahan") },
          { key: "analytics", label: t("Analytics", "Analitik") },
        ]}
      />
      {tab === "log" ? <ErrorLog /> : <Analytics />}
    </div>
  );
}

function ErrorLog() {
  const { timezone } = useSettings();
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("all");
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useErrors(filter, page);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {(["all", "open", "resolved"] as const).map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={clsx(
              "rounded-full border px-3 py-1.5 text-sm font-medium capitalize",
              filter === f ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700",
            )}
          >
            {f === "all" ? t("All", "Semua") : f === "open" ? t("Open", "Terbuka") : t("Resolved", "Selesai")}
          </button>
        ))}
      </div>
      {error && <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />}
      {!data && !error && <Spinner />}
      {data && data.items.length === 0 && (
        <EmptyState
          title={
            filter === "all"
              ? t("No errors recorded", "Belum ada kesalahan tercatat")
              : filter === "open"
                ? t("No open errors", "Tidak ada kesalahan terbuka")
                : t("No resolved errors", "Belum ada kesalahan yang selesai")
          }
        >
          {t(
            "When you find a mistake in submitted work, use “Report an error”.",
            "Kalau menemukan kesalahan di pekerjaan yang sudah dikirim, pakai “Laporkan kesalahan”.",
          )}
        </EmptyState>
      )}
      <ul className="space-y-2">
        {data?.items.map((e) => {
          const done = e.steps.filter((s) => s.done).length;
          return (
            <li key={e.id}>
              <Link href={`/errors/${e.id}`} className="block rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:shadow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {e.field_name}
                      {e.shipment_reference && <span className="font-normal text-slate-500"> · {e.shipment_reference}</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {e.category_label} · {t("reported", "dilaporkan")} {formatDateTime(e.created_at, timezone)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Badge className={SEVERITY_STYLE[e.severity]}>{LEVEL_LABEL[e.severity as PriorityLevel] ?? e.severity}</Badge>
                    <Badge className={ERROR_STATUS[e.status].style}>{ERROR_STATUS[e.status].label}</Badge>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(done / e.steps.length) * 100}%` }} />
                  </span>
                  <span className="text-xs tabular-nums text-slate-500">
                    {done}/{e.steps.length} {t("steps", "langkah")}
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("Previous", "Sebelumnya")}
          </Button>
          <span className="text-sm text-slate-500">
            {t(`Page ${page} of ${pages}`, `Halaman ${page} dari ${pages}`)}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t("Next", "Berikutnya")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Analytics() {
  const { timezone } = useSettings();
  const [days, setDays] = useState(30);
  const { data, error, mutate } = useErrorAnalytics(days);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!data) return <Spinner />;

  const tiles = [
    { label: t("Errors", "Kesalahan"), value: String(data.total), hint: t(`${data.open} still open`, `${data.open} masih terbuka`) },
    {
      label: t("Error rate", "Tingkat kesalahan"),
      value: data.error_rate === null ? "—" : `${data.error_rate}`,
      hint:
        data.error_rate === null
          ? t("No completed tasks", "Belum ada task selesai")
          : t(`per 100 of ${data.tasks_completed} completed tasks`, `per 100 dari ${data.tasks_completed} task selesai`),
    },
    {
      label: t("Avg. correction", "Rata-rata koreksi"),
      value: data.avg_correction_minutes === null ? "—" : formatMinutes(data.avg_correction_minutes),
      hint: t("discovery to resolution", "dari ditemukan sampai selesai"),
    },
    {
      label: t("Root cause done", "Akar masalah selesai"),
      value: `${data.rca_completed}/${data.resolved}`,
      hint: t("of resolved errors", "dari kesalahan yang selesai"),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="group" aria-label={t("Period", "Periode")}>
        {[30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={clsx(
              "rounded-full border px-3 py-1.5 text-sm font-medium",
              days === d ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700",
            )}
          >
            {t(`Last ${d} days`, `${d} hari terakhir`)}
          </button>
        ))}
      </div>

      {data.recurring.map((p) => (
        <RecurringCard key={`${p.kind}-${p.key}`} pattern={p} />
      ))}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{tile.label}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{tile.value}</p>
            <p className="text-xs text-slate-500">{tile.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>{t("Errors per week", "Kesalahan per minggu")}</SectionTitle>
          <ColumnChart
            title={t("Errors per week, last 8 weeks", "Kesalahan per minggu, 8 minggu terakhir")}
            data={data.trend.map((w) => ({
              label: formatDateTime(w.week_start, timezone).split(",")[0],
              value: w.count,
              detail: `${t("week from", "minggu mulai")} ${formatDateTime(w.week_start, timezone).split(",")[0]}`,
            }))}
          />
        </Card>
        <Card>
          <SectionTitle>{t("By category", "Per kategori")}</SectionTitle>
          <BarList
            title={t("Errors by category", "Kesalahan per kategori")}
            data={data.by_category.map((c) => ({ label: c.label, value: c.count }))}
            empty={t("No errors in this period.", "Tidak ada kesalahan di periode ini.")}
          />
        </Card>
        <Card>
          <SectionTitle>{t("By severity", "Per tingkat keparahan")}</SectionTitle>
          <BarList
            title={t("Errors by severity", "Kesalahan per tingkat keparahan")}
            data={data.by_severity.map((c) => ({ label: c.label, value: c.count }))}
            empty={t("No errors in this period.", "Tidak ada kesalahan di periode ini.")}
          />
        </Card>
        <Card>
          <SectionTitle>{t("Root causes", "Akar masalah")}</SectionTitle>
          <BarList
            title={t("Errors by root cause", "Kesalahan per akar masalah")}
            data={data.by_root_cause.map((c) => ({ label: c.label, value: c.count }))}
            empty={t("No root-cause analysis recorded yet.", "Belum ada analisis akar masalah yang dicatat.")}
          />
          <p className="mt-3 text-xs text-slate-500">
            {t(
              `${data.reported_within_hour} of ${data.total} errors were reported within 1 hour of discovery.`,
              `${data.reported_within_hour} dari ${data.total} kesalahan dilaporkan dalam 1 jam setelah ditemukan.`,
            )}
          </p>
        </Card>
      </div>
    </div>
  );
}

/** Suggestion only: the user decides whether to act on it. Nothing changes automatically. */
function RecurringCard({ pattern }: { pattern: RecurringPattern }) {
  const refresh = useRefreshPerformance();
  const [state, setState] = useState<"idle" | "saving" | "added">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function addToLearning() {
    setState("saving");
    setErr(null);
    try {
      await api.post("/api/learning/items", {
        title: pattern.suggested_learning,
        category: "LESSON",
        source: "Error analysis",
        notes: pattern.message,
      });
      await refresh();
      setState("added");
    } catch (e) {
      setErr(errorMessage(e));
      setState("idle");
    }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Lightbulb className="h-4 w-4" aria-hidden /> {t("Recurring pattern", "Pola berulang")}
      </p>
      <p className="mt-1 text-sm">{pattern.message}</p>
      <p className="mt-1 text-xs text-amber-900">
        {t(
          "Nothing is changed unless you choose to. Official SOP is never modified.",
          "Tidak ada yang berubah kecuali kamu memilihnya. SOP resmi tidak pernah diubah.",
        )}
      </p>
      {state === "added" ? (
        <p className="mt-2 text-sm font-semibold text-emerald-800">{t("Added to your learning tracker.", "Ditambahkan ke daftar belajarmu.")}</p>
      ) : (
        <Button variant="secondary" className="mt-2" onClick={addToLearning} loading={state === "saving"}>
          <BookPlus className="h-4 w-4" aria-hidden /> {t("Add as a learning item", "Tambahkan sebagai materi belajar")}
        </Button>
      )}
      <InlineError message={err} />
    </section>
  );
}
