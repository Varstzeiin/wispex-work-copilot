"use client";

import clsx from "clsx";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { TaskCard } from "@/components/task/TaskCard";
import { Button, EmptyState, ErrorState, LinkButton, PageHeader, Spinner, inputClass } from "@/components/ui";
import { useTasks, type TaskQuery } from "@/features/task-management/hooks";
import { errorMessage } from "@/lib/api/client";
import { useDebounced, useSettings } from "@/lib/hooks";
import { t } from "@/lib/i18n";

/** Filter chip whose label follows the active language. */
function filterChip(key: string, en: string, id: string, query: Partial<TaskQuery>) {
  return {
    key,
    query,
    get label() {
      return t(en, id);
    },
  };
}

const FILTERS = [
  filterChip("open", "All open", "Semua aktif", { view: "open" }),
  filterChip("critical", "Critical", "Kritis", { view: "open", level: "CRITICAL" }),
  filterChip("high", "High", "Tinggi", { view: "open", level: "HIGH" }),
  filterChip("active", "In progress", "Dikerjakan", { view: "open", status: "IN_PROGRESS,NEEDS_REVIEW" }),
  filterChip("waiting", "Waiting / escalated", "Menunggu / dieskalasi", { view: "open", status: "WAITING,ESCALATED,ON_HOLD" }),
  filterChip("closed", "Completed", "Selesai", { view: "closed" }),
];

function filterFromParams(params: URLSearchParams): string {
  if (params.get("view") === "closed") return "closed";
  const level = params.get("level");
  if (level === "CRITICAL") return "critical";
  if (level === "HIGH") return "high";
  const status = params.get("status");
  if (status?.includes("WAITING")) return "waiting";
  if (status?.includes("IN_PROGRESS")) return "active";
  return "open";
}

export default function TasksPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TaskInbox />
    </Suspense>
  );
}

function TaskInbox() {
  const router = useRouter();
  const params = useSearchParams();
  const { timezone } = useSettings();
  const [filter, setFilter] = useState(() => filterFromParams(params));
  const [sort, setSort] = useState<TaskQuery["sort"]>((params.get("sort") as TaskQuery["sort"]) ?? "priority");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim(), 300);

  useEffect(() => setPage(1), [filter, sort, q]);

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const { data, error, isLoading, mutate } = useTasks({ ...active.query, sort, q, page, pageSize: 25 });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  function chooseFilter(key: string) {
    setFilter(key);
    router.replace("/tasks", { scroll: false });
  }

  return (
    <div>
      <PageHeader
        title={t("Task Inbox", "Kotak Task")}
        subtitle={data ? `${data.total} ${t(data.total === 1 ? "task" : "tasks", "task")}` : undefined}
        action={
          <LinkButton href="/tasks/new" variant="primary" className="hidden md:inline-flex">
            <Plus className="h-4 w-4" aria-hidden /> {t("New task", "Task baru")}
          </LinkButton>
        }
      />

      <div className="sticky top-0 z-20 -mx-4 space-y-2 bg-slate-50/95 px-4 pb-2 pt-1 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              placeholder={t("Search shipment, client or title", "Cari shipment, klien, atau judul")}
              className={clsx(inputClass, "pl-9")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t("Search tasks", "Cari task")}
            />
          </div>
          <select
            className={clsx(inputClass, "!w-auto shrink-0")}
            value={sort}
            onChange={(e) => setSort(e.target.value as TaskQuery["sort"])}
            aria-label={t("Sort", "Urutkan")}
          >
            <option value="priority">{t("Priority", "Prioritas")}</option>
            <option value="deadline">Deadline</option>
            <option value="created">{t("Newest", "Terbaru")}</option>
          </select>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          {FILTERS.map((f) => {
            const count =
              data && f.query.level && f.query.view === "open" ? data.counts[f.query.level as "CRITICAL" | "HIGH"] : null;
            return (
              <button
                key={f.key}
                onClick={() => chooseFilter(f.key)}
                className={clsx(
                  "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium",
                  filter === f.key ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700",
                )}
              >
                {f.label}
                {count ? <span className="ml-1 opacity-80">{count}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        {error && <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />}
        {isLoading && !data && <Spinner />}
        {data && data.items.length === 0 && (
          <EmptyState title={q ? t("No tasks match your search", "Tidak ada task yang cocok") : t("No tasks here", "Belum ada task di sini")}>
            {filter === "open" && !q && (
              <Link href="/tasks/new" className="font-semibold text-brand-700">
                {t("Add your first task", "Tambah task pertamamu")}
              </Link>
            )}
          </EmptyState>
        )}
        {data && data.items.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {data.items.map((task) => (
              <TaskCard key={task.id} task={task} timeZone={timezone} />
            ))}
          </div>
        )}
        {data && totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t("Previous", "Sebelumnya")}
            </Button>
            <span className="text-sm text-slate-500">
              {t(`Page ${page} of ${totalPages}`, `Halaman ${page} dari ${totalPages}`)}
            </span>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {t("Next", "Berikutnya")}
            </Button>
          </div>
        )}
      </div>

      <Link
        href="/tasks/new"
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg md:hidden"
        aria-label={t("New task", "Task baru")}
      >
        <Plus className="h-6 w-6" />
      </Link>
    </div>
  );
}
