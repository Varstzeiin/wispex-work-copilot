"use client";

import { ShieldAlert, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";

import { Button, Card, ErrorState, Field, InlineError, Modal, PageHeader, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { useRefreshTaskData } from "@/features/task-management/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useMe, useOnline, useSettings } from "@/lib/hooks";
import { FACTOR_LABEL } from "@/lib/utils/labels";
import type { Settings } from "@/types";

const THRESHOLD_LABEL: Record<keyof Settings["deadline_thresholds"], string> = {
  critical_minutes: "Critical when less than (min)",
  urgent_minutes: "Urgent when less than (min)",
  watch_minutes: "Watch when less than (min)",
  warn_before_critical_minutes: "Early warning before critical (min)",
};

export default function SettingsPage() {
  const { data: settings, error, mutate } = useSettings();
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />;
  if (!settings) return <Spinner />;
  return <SettingsForm settings={settings} />;
}

function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const online = useOnline();
  const { mutate } = useSWRConfig();
  const refreshTasks = useRefreshTaskData();
  const { data: user } = useMe();
  const { mutate: mutateSettings } = useSettings();
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [permission, setPermission] = useState<string>("default");

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "UTC"];
    }
  }, []);

  async function save(payload: Partial<Settings>, path = "/api/settings", method: "put" | "post" = "put") {
    setSaving(true);
    setMessage(null);
    try {
      const updated = method === "put" ? await api.put<Settings>(path, payload) : await api.post<Settings>(path);
      setDraft(updated);
      await mutateSettings(updated, { revalidate: false });
      await refreshTasks(); // priorities depend on these settings
      setMessage({ text: "Saved. Priorities were recalculated.", ok: true });
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function enableBrowserNotifications(on: boolean) {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setMessage({ text: "Browser notifications were not allowed. You can change this in your browser settings.", ok: false });
        return;
      }
    }
    const prefs = { ...draft.notification_prefs, browser: on };
    setDraft({ ...draft, notification_prefs: prefs });
    save({ notification_prefs: prefs });
  }

  async function deleteAccount() {
    setDeleteError(null);
    try {
      await api.delete("/api/auth/me");
      await mutate(() => true, undefined, { revalidate: false });
      router.replace("/login");
    } catch (e) {
      setDeleteError(errorMessage(e));
    }
  }

  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle={user?.email} />
      {message && (
        <p className={`rounded-xl px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} role="status">
          {message.text}
        </p>
      )}

      <Card>
        <SectionTitle>Time and shift</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Timezone" htmlFor="tz">
            <select id="tz" className={inputClass} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shift start" htmlFor="shift-start">
            <input id="shift-start" type="time" className={inputClass} value={draft.shift_start} onChange={(e) => setDraft({ ...draft, shift_start: e.target.value })} />
          </Field>
          <Field label="Shift end" htmlFor="shift-end" hint="Overnight shifts (e.g. 22:00 to 06:00) are supported.">
            <input id="shift-end" type="time" className={inputClass} value={draft.shift_end} onChange={(e) => setDraft({ ...draft, shift_end: e.target.value })} />
          </Field>
        </div>
        <Button
          className="mt-3"
          loading={saving}
          disabled={!online}
          onClick={() => save({ timezone: draft.timezone, shift_start: draft.shift_start, shift_end: draft.shift_end })}
        >
          Save time settings
        </Button>
      </Card>

      <Card>
        <SectionTitle>Deadline thresholds</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(THRESHOLD_LABEL) as (keyof Settings["deadline_thresholds"])[]).map((key) => (
            <Field key={key} label={THRESHOLD_LABEL[key]} htmlFor={key}>
              <input
                id={key}
                type="number"
                min={0}
                inputMode="numeric"
                className={inputClass}
                value={draft.deadline_thresholds[key]}
                onChange={(e) => setDraft({ ...draft, deadline_thresholds: { ...draft.deadline_thresholds, [key]: num(e.target.value) } })}
              />
            </Field>
          ))}
        </div>
        <Button className="mt-3" loading={saving} disabled={!online} onClick={() => save({ deadline_thresholds: draft.deadline_thresholds })}>
          Save thresholds
        </Button>
      </Card>

      <Card>
        <SectionTitle>Priority weights</SectionTitle>
        <p className="mb-3 text-sm text-slate-600">
          Maximum points each factor can add. The total is scaled to 0–100. These are your personal settings and are not
          company policy. Set a weight to 0 to ignore a factor.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(draft.priority_weights) as (keyof Settings["priority_weights"])[]).map((key) => (
            <Field key={key} label={FACTOR_LABEL[key] ?? key} htmlFor={`w-${key}`}>
              <input
                id={`w-${key}`}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                className={inputClass}
                value={draft.priority_weights[key]}
                onChange={(e) =>
                  setDraft({ ...draft, priority_weights: { ...draft.priority_weights, [key]: Math.min(100, num(e.target.value)) } })
                }
              />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Levels: Critical ≥ {draft.level_thresholds.critical}, High ≥ {draft.level_thresholds.high}, Medium ≥{" "}
          {draft.level_thresholds.medium}. A task below the critical deadline threshold is always shown as Critical.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button loading={saving} disabled={!online} onClick={() => save({ priority_weights: draft.priority_weights })}>
            Save weights
          </Button>
          <Button variant="secondary" disabled={!online || saving} onClick={() => save({}, "/api/settings/reset", "post")}>
            Reset thresholds and weights
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle>Notifications</SectionTitle>
        <p className="mb-3 text-sm text-slate-600">Only deadline alerts are sent: overdue, critical, and about to become critical.</p>
        <div className="space-y-2">
          <Toggle
            label="In-app alerts"
            checked={draft.notification_prefs.in_app}
            onChange={(v) => {
              const prefs = { ...draft.notification_prefs, in_app: v };
              setDraft({ ...draft, notification_prefs: prefs });
              save({ notification_prefs: prefs });
            }}
          />
          <Toggle
            label="Browser notifications"
            hint={permission === "denied" ? "Blocked in your browser settings." : "Shown even when the app is in the background tab."}
            checked={draft.notification_prefs.browser && permission === "granted"}
            onChange={enableBrowserNotifications}
          />
          <Toggle
            label="Critical and overdue deadlines"
            checked={draft.notification_prefs.notify_new_critical}
            onChange={(v) => {
              const prefs = { ...draft.notification_prefs, notify_new_critical: v };
              setDraft({ ...draft, notification_prefs: prefs });
              save({ notification_prefs: prefs });
            }}
          />
          <Toggle
            label="Early warning before critical"
            checked={draft.notification_prefs.notify_approaching_critical}
            onChange={(v) => {
              const prefs = { ...draft.notification_prefs, notify_approaching_critical: v };
              setDraft({ ...draft, notification_prefs: prefs });
              save({ notification_prefs: prefs });
            }}
          />
        </div>
      </Card>

      <Card>
        <SectionTitle>Data and privacy</SectionTitle>
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
          <p>
            Do not upload or enter confidential company or client information unless your organization&apos;s policy
            explicitly permits this application (and any AI provider) to process it. Keep notes short and factual.
          </p>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Task data is never cached on this device by the app.</li>
          <li>Calendar tokens are stored encrypted on the server.</li>
          <li>The activity log records actions and statuses, never document content.</li>
        </ul>
        <Button variant="danger" className="mt-4" onClick={() => setDeleteOpen(true)} disabled={!online}>
          <Trash2 className="h-4 w-4" aria-hidden /> Delete my account and all data
        </Button>
      </Card>

      <Modal open={deleteOpen} title="Delete account" onClose={() => setDeleteOpen(false)}>
        <p className="text-sm text-slate-600">
          This permanently deletes your account, tasks, settings, calendar links and activity log, and revokes Google
          Calendar access. Events already in your Google Calendar stay there. This cannot be undone.
        </p>
        <Field label='Type "DELETE" to confirm' htmlFor="confirm-delete">
          <input id="confirm-delete" className={inputClass} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </Field>
        <div className="mt-3">
          <InlineError message={deleteError} />
        </div>
        <Button variant="danger" block className="mt-3" disabled={confirmText !== "DELETE"} onClick={deleteAccount}>
          Permanently delete
        </Button>
      </Modal>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
      <span>
        <span className="text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
