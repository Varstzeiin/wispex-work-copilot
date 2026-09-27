"use client";

import { useState } from "react";

import { Button, Card, Modal, SectionTitle } from "@/components/ui";
import { useAutomationStatus, useRefreshAutomation } from "@/features/automation/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import type { AutomationStatus } from "@/types";

type Key = "client_patterns_allowed" | "email_sending_allowed" | "team_channel_allowed";

const KEYS: Key[] = ["client_patterns_allowed", "email_sending_allowed", "team_channel_allowed"];

function copy(key: Key): { title: string; on: string; confirm: string } {
  const texts: Record<Key, { title: string; on: string; confirm: string }> = {
    client_patterns_allowed: {
      title: t("Patterns per client", "Pola per klien"),
      on: t(
        "Insights can name clients, for example which client's documents often arrive late.",
        "Insight bisa menyebut nama klien, misalnya dokumen klien mana yang sering terlambat.",
      ),
      confirm: t(
        "I confirm that my organization's policy permits analysing my work per named client in this application.",
        "Aku menyatakan bahwa kebijakan organisasiku mengizinkan analisis pekerjaanku per klien di aplikasi ini.",
      ),
    },
    email_sending_allowed: {
      title: t("Send drafts by email", "Kirim draf lewat email"),
      on: t(
        "You can send a reviewed draft through the organization's email server. You approve every message before it is sent.",
        "Kamu bisa mengirim draf yang sudah dicek lewat server email organisasi. Setiap pesan harus kamu setujui sebelum dikirim.",
      ),
      confirm: t(
        "I confirm that my organization's policy explicitly permits sending work messages from this application.",
        "Aku menyatakan bahwa kebijakan organisasiku secara tegas mengizinkan pengiriman pesan kerja dari aplikasi ini.",
      ),
    },
    team_channel_allowed: {
      title: t("Post drafts to the team channel", "Posting draf ke channel tim"),
      on: t(
        "You can post a reviewed draft to your team channel. You approve every message before it is posted.",
        "Kamu bisa memposting draf yang sudah dicek ke channel tim. Setiap pesan harus kamu setujui sebelum diposting.",
      ),
      confirm: t(
        "I confirm that my organization's policy explicitly permits posting work messages from this application to this channel.",
        "Aku menyatakan bahwa kebijakan organisasiku secara tegas mengizinkan posting pesan kerja dari aplikasi ini ke channel ini.",
      ),
    },
  };
  return texts[key];
}

function current(status: AutomationStatus, key: Key): boolean {
  return key === "client_patterns_allowed"
    ? status.client_patterns_allowed
    : key === "email_sending_allowed"
      ? status.email_allowed
      : status.team_allowed;
}

function unavailable(status: AutomationStatus, key: Key): string | null {
  if (key === "email_sending_allowed" && !status.email_configured)
    return t(
      "Integration Required. No email server is configured (EMAIL_PROVIDER=smtp). Copy the draft and send it yourself.",
      "Integration Required. Belum ada server email (EMAIL_PROVIDER=smtp). Salin drafnya lalu kirim sendiri.",
    );
  if (key === "team_channel_allowed" && !status.team_configured)
    return t(
      "Integration Required. No team channel webhook is configured (TEAM_WEBHOOK_URL). Copy the draft and send it yourself.",
      "Integration Required. Belum ada webhook channel tim (TEAM_WEBHOOK_URL). Salin drafnya lalu kirim sendiri.",
    );
  if (key !== "client_patterns_allowed" && status.is_demo) return t("Not available for demo accounts.", "Tidak tersedia untuk akun demo.");
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
      setMessage({ text: `${copy(key).title}: ${value ? t("on", "aktif") : t("off", "mati")}.`, ok: true });
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
      <SectionTitle>{t("Insights and sending", "Insight dan pengiriman")}</SectionTitle>
      {message && (
        <p className={`mb-3 rounded-xl px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} role="status">
          {message.text}
        </p>
      )}
      <div className="space-y-3">
        {KEYS.map((key) => {
          const blocked = unavailable(status, key);
          const on = current(status, key);
          return (
            <div key={key} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-slate-900">
                  {copy(key).title}
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
                    aria-label={copy(key).title}
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
              <p className="mt-1 text-sm text-slate-600">{blocked ?? copy(key).on}</p>
            </div>
          );
        })}
      </div>

      <Modal open={confirming !== null} title={confirming ? `${t("Turn on", "Aktifkan")}: ${copy(confirming).title}?` : ""} onClose={() => setConfirming(null)}>
        {confirming && (
          <div className="space-y-3 text-sm text-slate-700">
            <p>{copy(confirming).on}</p>
            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <span>{copy(confirming).confirm}</span>
            </label>
            <Button block loading={busy} disabled={!checked} onClick={() => save(confirming, true)}>
              {t("Turn on", "Aktifkan")}
            </Button>
          </div>
        )}
      </Modal>
    </Card>
  );
}
