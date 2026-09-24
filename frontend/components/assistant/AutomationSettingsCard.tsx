"use client";

import { useState } from "react";

import { Button, Card, Modal, SectionTitle } from "@/components/ui";
import { useAutomationStatus, useRefreshAutomation } from "@/features/automation/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import type { AutomationStatus } from "@/types";

type Key = "client_patterns_allowed" | "email_sending_allowed" | "team_channel_allowed";

const COPY: Record<Key, { title: string; on: string; confirm: string }> = {
  client_patterns_allowed: {
    title: "Patterns per client",
    on: "Insights can name clients, for example which client's documents often arrive late.",
    confirm: "I confirm that my organization's policy permits analysing my work per named client in this application.",
  },
  email_sending_allowed: {
    title: "Send drafts by email",
    on: "You can send a reviewed draft through the organization's email server. You approve every message before it is sent.",
    confirm: "I confirm that my organization's policy explicitly permits sending work messages from this application.",
  },
  team_channel_allowed: {
    title: "Post drafts to the team channel",
    on: "You can post a reviewed draft to your team channel. You approve every message before it is posted.",
    confirm: "I confirm that my organization's policy explicitly permits posting work messages from this application to this channel.",
  },
};

function current(status: AutomationStatus, key: Key): boolean {
  return key === "client_patterns_allowed"
    ? status.client_patterns_allowed
    : key === "email_sending_allowed"
      ? status.email_allowed
      : status.team_allowed;
}

function unavailable(status: AutomationStatus, key: Key): string | null {
  if (key === "email_sending_allowed" && !status.email_configured)
    return "Integration Required. No email server is configured (EMAIL_PROVIDER=smtp). Copy the draft and send it yourself.";
  if (key === "team_channel_allowed" && !status.team_configured)
    return "Integration Required. No team channel webhook is configured (TEAM_WEBHOOK_URL). Copy the draft and send it yourself.";
  if (key !== "client_patterns_allowed" && status.is_demo) return "Not available for demo accounts.";
  return null;
}

/** Permissions for MVP 5 features. Each needs an explicit policy confirmation to switch on. */
export function AutomationSettingsCard() {
  const online = useOnline();
  const refresh = useRefreshAutomation();
  const { data: status } = useAutomationStatus();
  const [confirming, setConfirming] = useState<Key | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (!status) return null;

  async function save(key: Key, value: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      await api.put("/api/automation/settings", { [key]: value, confirm_policy: value });
      await refresh();
      setMessage({ text: `${COPY[key].title}: ${value ? "on" : "off"}.`, ok: true });
      setConfirming(null);
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div id="automation" className="scroll-mt-20" />
      <SectionTitle>Insights and sending</SectionTitle>
      {message && (
        <p className={`mb-3 rounded-xl px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} role="status">
          {message.text}
        </p>
      )}
      <div className="space-y-3">
        {(Object.keys(COPY) as Key[]).map((key) => {
          const blocked = unavailable(status, key);
          const on = current(status, key);
          return (
            <div key={key} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-slate-900">
                  {COPY[key].title}
                  {key === "team_channel_allowed" && status.team_channel_name && (
                    <span className="font-normal text-slate-500"> · {status.team_channel_name}</span>
                  )}
                </p>
                {!blocked && (
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-brand-600"
                    checked={on}
                    disabled={!online || busy}
                    aria-label={COPY[key].title}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setChecked(false);
                        setConfirming(key);
                      } else {
                        save(key, false);
                      }
                    }}
                  />
                )}
              </div>
              <p className="mt-1 text-sm text-slate-600">{blocked ?? COPY[key].on}</p>
            </div>
          );
        })}
      </div>

      <Modal open={confirming !== null} title={confirming ? `Turn on: ${COPY[confirming].title}?` : ""} onClose={() => setConfirming(null)}>
        {confirming && (
          <div className="space-y-3 text-sm text-slate-700">
            <p>{COPY[confirming].on}</p>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <span>{COPY[confirming].confirm}</span>
            </label>
            <Button block loading={busy} disabled={!checked} onClick={() => save(confirming, true)}>
              Turn on
            </Button>
          </div>
        )}
      </Modal>
    </Card>
  );
}
