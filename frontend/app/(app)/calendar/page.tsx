"use client";

import clsx from "clsx";
import { CalendarCheck, Download, Link2, RefreshCw, Unlink } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import useSWR from "swr";

import { Button, Card, EmptyState, ErrorState, InlineError, PageHeader, SectionTitle, Spinner } from "@/components/ui";
import { useRefreshTaskData } from "@/features/task-management/hooks";
import { api, errorMessage, fetcher } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { formatDateTime, formatMinutes } from "@/lib/utils/time";
import type { CalendarEventItem } from "@/types";

interface CalendarStatus {
  google_available: boolean;
  google_connected: boolean;
  connected_at: string | null;
}

const GOOGLE_RESULT: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Google Calendar connected.", ok: true },
  cancelled: { text: "Google Calendar connection was cancelled.", ok: false },
  failed: { text: "Google Calendar could not be connected. Please try again.", ok: false },
};

export default function CalendarPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CalendarView />
    </Suspense>
  );
}

function CalendarView() {
  const params = useSearchParams();
  const online = useOnline();
  const refresh = useRefreshTaskData();
  const { timezone, mutate: mutateSettings } = useSettings();
  const status = useSWR<CalendarStatus>("/api/calendar/status", fetcher);
  const events = useSWR<CalendarEventItem[]>("/api/calendar/events", fetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const result = GOOGLE_RESULT[params.get("google") ?? ""];

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const connect = () =>
    run("connect", async () => {
      const { authorization_url } = await api.post<{ authorization_url: string }>("/api/calendar/google/connect");
      window.location.href = authorization_url;
    });

  const disconnect = () =>
    run("disconnect", async () => {
      await api.post("/api/calendar/google/disconnect");
      await Promise.all([status.mutate(), mutateSettings(), refresh()]);
    });

  const sync = () =>
    run("sync", async () => {
      const r = await api.post<{ updated: number; failed: number }>("/api/calendar/sync");
      await refresh();
      setNotice(`${r.updated} event(s) updated${r.failed ? `, ${r.failed} failed` : ""}.`);
    });

  return (
    <div className="space-y-4">
      <PageHeader title="Calendar" subtitle="Deadline reminders linked to your tasks" />

      {result && (
        <p className={clsx("rounded-xl px-3 py-2 text-sm", result.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>
          {result.text}
        </p>
      )}

      <Card>
        <SectionTitle>Google Calendar</SectionTitle>
        {!status.data && !status.error && <Spinner />}
        {status.error && <ErrorState message={errorMessage(status.error)} />}
        {status.data && !status.data.google_available && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-semibold">Integration Required</p>
            <p className="mt-1">
              Google Calendar sync is not configured on this server. An administrator must add an authorized Google OAuth
              client (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI), and your organization must permit
              calendar access.
            </p>
            <p className="mt-2">
              Meanwhile, every task reminder can be downloaded as an <strong>.ics file</strong> and imported into Google
              Calendar, Outlook or Apple Calendar, including the reminders.
            </p>
          </div>
        )}
        {status.data?.google_available && !status.data.google_connected && (
          <div className="space-y-2 text-sm text-slate-700">
            <p>Connect to sync task deadlines as calendar events. Only event access is requested (no email, no files).</p>
            <p className="text-xs text-slate-500">Event text contains the task title and shipment reference only.</p>
            <Button onClick={connect} loading={busy === "connect"} disabled={!online}>
              <Link2 className="h-4 w-4" aria-hidden /> Connect Google Calendar
            </Button>
          </div>
        )}
        {status.data?.google_connected && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="flex items-center gap-2 text-emerald-800">
              <CalendarCheck className="h-4 w-4" aria-hidden /> Connected
              {status.data.connected_at && ` since ${formatDateTime(status.data.connected_at, timezone)}`}
            </p>
            <Button variant="secondary" onClick={disconnect} loading={busy === "disconnect"} disabled={!online}>
              <Unlink className="h-4 w-4" aria-hidden /> Disconnect
            </Button>
          </div>
        )}
      </Card>

      <section>
        <SectionTitle
          action={
            events.data && events.data.length > 0 ? (
              <button
                onClick={sync}
                disabled={!online || busy !== null}
                className="flex items-center gap-1 text-sm font-semibold text-brand-700 disabled:text-slate-400"
              >
                <RefreshCw className={clsx("h-4 w-4", busy === "sync" && "animate-spin")} aria-hidden /> Update changed
              </button>
            ) : null
          }
        >
          Linked reminders
        </SectionTitle>
        <InlineError message={error} />
        {notice && <p className="mb-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">{notice}</p>}
        {!events.data && !events.error && <Spinner />}
        {events.data && events.data.length === 0 && (
          <EmptyState title="No reminders yet">Open a task and use “Add calendar reminder”.</EmptyState>
        )}
        <ul className="space-y-2">
          {events.data?.map((e) => (
            <li key={e.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/tasks/${e.task_id}`} className="font-semibold text-slate-900 hover:underline">
                    {e.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(e.event_start, timezone)} · reminders {e.reminder_minutes.map(formatMinutes).join(", ")}
                  </p>
                </div>
                <span
                  className={clsx(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    e.sync_status === "SYNCED" && "bg-emerald-100 text-emerald-800",
                    e.sync_status === "LOCAL_ONLY" && "bg-slate-100 text-slate-600",
                    (e.sync_status === "OUT_OF_DATE" || e.sync_status === "FAILED") && "bg-amber-100 text-amber-900",
                  )}
                >
                  {e.sync_status === "LOCAL_ONLY" ? "ICS" : e.sync_status.replace("_", " ")}
                </span>
              </div>
              {e.last_error && <p className="mt-1 text-xs text-amber-800">{e.last_error}</p>}
              <a
                href={`/api/calendar/tasks/${e.task_id}/event.ics`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700"
              >
                <Download className="h-3.5 w-3.5" aria-hidden /> Download .ics
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
