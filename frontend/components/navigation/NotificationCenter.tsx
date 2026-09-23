"use client";

import { BellRing, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useAlerts } from "@/features/daily-planner/hooks";
import { useSettings } from "@/lib/hooks";
import type { Alert } from "@/types";

const SEEN_KEY = "wispex-seen-alerts";

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    // storage unavailable (private mode): alerts may repeat, which is acceptable
  }
}

/**
 * Shows each deadline alert once per level (in-app toast and, if allowed, a browser notification).
 * Only overdue / critical / approaching-critical alerts exist, to avoid notification fatigue.
 */
export function NotificationCenter() {
  const { data } = useAlerts();
  const { data: settings } = useSettings();
  // One compact toast at a time, so alerts never cover the screen on a phone
  const [toast, setToast] = useState<Alert[] | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!data || !settings) return;
    const prefs = settings.notification_prefs;
    if (!seen.current) seen.current = loadSeen();
    const fresh = data.alerts.filter((a) => {
      if (a.kind === "APPROACHING" && !prefs.notify_approaching_critical) return false;
      if (a.kind !== "APPROACHING" && !prefs.notify_new_critical) return false;
      return !seen.current!.has(`${a.task_id}:${a.kind}`);
    });
    if (!fresh.length) return;
    fresh.forEach((a) => seen.current!.add(`${a.task_id}:${a.kind}`));
    saveSeen(seen.current);

    if (prefs.in_app) setToast(fresh);
    if (prefs.browser && typeof Notification !== "undefined" && Notification.permission === "granted") {
      // Keep the text minimal: shipment reference and timing only
      fresh.slice(0, 3).forEach((a) => new Notification(`⚠️ ${a.title}`, { body: a.message, tag: `${a.task_id}:${a.kind}` }));
    }
  }, [data, settings]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 10_000);
    return () => window.clearTimeout(id);
  }, [toast]);

  if (!toast?.length) return null;
  const first = toast[0];
  const single = toast.length === 1;
  const heading =
    first.kind === "OVERDUE" ? "Deadline passed" : first.kind === "CRITICAL" ? "Deadline approaching" : "Becoming critical soon";
  return (
    <div className="fixed inset-x-3 top-3 z-50 md:left-auto md:right-4 md:w-96" aria-live="polite">
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-white p-3 shadow-lg">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
        <Link href={single ? `/tasks/${first.task_id}` : "/"} className="min-w-0 flex-1 text-sm" onClick={() => setToast(null)}>
          <p className="font-semibold text-slate-900">
            {single ? `${heading} · ${first.title}` : `${toast.length} deadline alerts`}
          </p>
          <p className="truncate text-slate-600">
            {single ? first.message : toast.map((a) => `${a.title} (${a.kind.toLowerCase()})`).join(", ")}
          </p>
        </Link>
        <button onClick={() => setToast(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
