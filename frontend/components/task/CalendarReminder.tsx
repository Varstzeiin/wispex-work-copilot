"use client";

import clsx from "clsx";
import { CalendarPlus, Download, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button, Card, InlineError, SectionTitle } from "@/components/ui";
import { useRefreshTaskData } from "@/features/task-management/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline, useSettings } from "@/lib/hooks";
import { formatDateTime } from "@/lib/utils/time";
import { t } from "@/lib/i18n";
import type { Task } from "@/types";

const REMINDER_MINUTES = [1440, 240, 60, 30, 15];

function reminderLabel(minutes: number): string {
  if (minutes >= 60) {
    const hours = minutes / 60;
    return t(`${hours} hour${hours === 1 ? "" : "s"}`, `${hours} jam`);
  }
  return t(`${minutes} minutes`, `${minutes} menit`);
}

function syncLabel(status: string): string {
  const labels: Record<string, string> = {
    SYNCED: t("Synced to Google Calendar", "Tersinkron ke Google Calendar"),
    LOCAL_ONLY: t(
      "Saved in Wispex. Download the .ics file to add it to your calendar",
      "Tersimpan di Wispex. Unduh file .ics untuk menambahkannya ke kalender kamu",
    ),
    OUT_OF_DATE: t("Deadline changed. Update the calendar event", "Deadline berubah. Perbarui event kalendernya"),
    FAILED: t("Google Calendar sync failed. Try again", "Sinkronisasi Google Calendar gagal. Coba lagi"),
    PENDING: t("Syncing…", "Menyinkronkan…"),
  };
  return labels[status] ?? status;
}

export function CalendarReminder({ task }: { task: Task }) {
  const refresh = useRefreshTaskData();
  const online = useOnline();
  const { data: settings, timezone } = useSettings();
  const [reminders, setReminders] = useState<number[]>(task.calendar_event?.reminder_minutes ?? [1440, 240, 60, 30]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const event = task.calendar_event;

  if (!task.submission_deadline) {
    return (
      <Card>
        <SectionTitle>{t("Calendar reminder", "Pengingat kalender")}</SectionTitle>
        <p className="text-sm text-slate-500">
          {t("Set a submission deadline to add a calendar reminder.", "Isi deadline pengajuan untuk menambahkan pengingat kalender.")}
        </p>
      </Card>
    );
  }

  async function run(fn: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const save = () => run(() => api.put(`/api/calendar/tasks/${task.id}/event`, { reminder_minutes: reminders }));
  const remove = () => run(() => api.delete(`/api/calendar/tasks/${task.id}/event`));
  const google = settings?.google_calendar_connected;

  return (
    <Card>
      <SectionTitle>{t("Calendar reminder", "Pengingat kalender")}</SectionTitle>
      <p className="text-sm text-slate-700">
        <span className="font-semibold">
          WISPEX — {task.shipment_reference ?? task.title} Submission Deadline
        </span>
        <br />
        {formatDateTime(task.submission_deadline, timezone)}
      </p>

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Remind me before", "Ingatkan sebelum")}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {REMINDER_MINUTES.map((minutes) => {
          const on = reminders.includes(minutes);
          return (
            <button
              key={minutes}
              type="button"
              onClick={() => setReminders(on ? reminders.filter((m) => m !== minutes) : [...reminders, minutes].slice(-5))}
              className={clsx(
                "rounded-full border px-3 py-1 text-sm",
                on ? "border-brand-600 bg-brand-50 font-semibold text-brand-800" : "border-slate-300 text-slate-600",
              )}
              aria-pressed={on}
            >
              {reminderLabel(minutes)}
            </button>
          );
        })}
      </div>

      {event && (
        <p
          className={clsx(
            "mt-3 rounded-xl px-3 py-2 text-xs",
            event.sync_status === "SYNCED" ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-600",
            (event.sync_status === "FAILED" || event.sync_status === "OUT_OF_DATE") && "bg-amber-50 text-amber-900",
          )}
        >
          {syncLabel(event.sync_status)}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
        <Button onClick={save} loading={saving} disabled={!online || reminders.length === 0} className="col-span-2 sm:col-span-1">
          <CalendarPlus className="h-4 w-4" aria-hidden />
          {event
            ? t("Update reminder", "Perbarui pengingat")
            : google
              ? t("Add to Google Calendar", "Tambah ke Google Calendar")
              : t("Add calendar reminder", "Tambah pengingat kalender")}
        </Button>
        <a
          href={`/api/calendar/tasks/${task.id}/event.ics`}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          <Download className="h-4 w-4" aria-hidden /> {t(".ics file", "File .ics")}
        </a>
        {event && (
          <Button variant="ghost" onClick={remove} disabled={!online || saving}>
            <Trash2 className="h-4 w-4" aria-hidden /> {t("Remove", "Hapus")}
          </Button>
        )}
      </div>
      {!google && (
        <p className="mt-2 text-xs text-slate-500">
          {t("Google Calendar is not connected.", "Google Calendar belum tersambung.")}{" "}
          <Link href="/calendar" className="font-semibold text-brand-700 underline">
            {t("Calendar settings", "Pengaturan kalender")}
          </Link>
          .{" "}
          {t(
            "The .ics file works with Google Calendar, Outlook and Apple Calendar.",
            "File .ics bisa dipakai di Google Calendar, Outlook, dan Apple Calendar.",
          )}
        </p>
      )}
      <div className="mt-2">
        <InlineError message={error} />
      </div>
    </Card>
  );
}
