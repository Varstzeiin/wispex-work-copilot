"use client";

import { Wand2 } from "lucide-react";
import { useState } from "react";

import { Button, Card, Modal, SectionTitle } from "@/components/ui";
import { useAssistantStatus } from "@/features/assistant/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { t } from "@/lib/i18n";

/** Separate permission from document AI: notes and task text can fall under a different policy. */
export function AssistantSettingsCard() {
  const online = useOnline();
  const { data: status, mutate } = useAssistantStatus();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [policyChecked, setPolicyChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (!status) return null;

  async function save(allowed: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      await api.put("/api/assistant/settings", { ai_assist_allowed: allowed, confirm_policy: allowed && policyChecked });
      await mutate();
      setMessage({
        text: allowed ? t("AI writing help switched on.", "Bantuan menulis AI diaktifkan.") : t("AI writing help switched off.", "Bantuan menulis AI dimatikan."),
        ok: true,
      });
      setConfirmOpen(false);
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  const provider = status.ai_provider === "anthropic" ? `Anthropic (Claude, ${status.ai_model})` : status.ai_provider;

  return (
    <Card>
      <div id="assistant" className="scroll-mt-20" />
      <SectionTitle>{t("Assistant", "Asisten")}</SectionTitle>
      {message && (
        <p className={`mb-3 rounded-xl px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} role="status">
          {message.text}
        </p>
      )}
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="flex items-center gap-2 font-medium text-slate-900">
          <Wand2 className="h-4 w-4 text-slate-500" aria-hidden /> {t("AI writing help", "Bantuan menulis AI")}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {t(
            "Knowledge search, question drafts and message drafts always work without AI. With AI writing help on, the matching notes are sent to the AI provider to write a short answer with sources, and drafts can be reworded on request.",
            "Pencarian pengetahuan, draf pertanyaan, dan draf pesan selalu jalan tanpa AI. Kalau bantuan menulis AI aktif, catatan yang cocok dikirim ke penyedia AI untuk menulis jawaban singkat beserta sumbernya, dan draf bisa diperbaiki kalimatnya atas permintaan.",
          )}
        </p>
        {!status.ai_configured ? (
          <p className="mt-2 text-sm text-slate-600">
            <strong>Integration Required.</strong>{" "}
            {t("No AI provider is configured on this server (AI_PROVIDER).", "Belum ada penyedia AI yang diatur di server ini (AI_PROVIDER).")}
          </p>
        ) : status.is_demo ? (
          <p className="mt-2 text-sm text-slate-600">{t("Not available for demo accounts.", "Tidak tersedia untuk akun demo.")}</p>
        ) : (
          <label className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-slate-800">
              {status.ai_permission_confirmed ? t("On", "Aktif") : t("Off", "Mati")} · {t("Provider", "Penyedia")}: {provider}
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand-600"
              checked={status.ai_permission_confirmed}
              disabled={!online || busy}
              onChange={(e) => {
                if (e.target.checked) {
                  setPolicyChecked(false);
                  setConfirmOpen(true);
                } else {
                  save(false);
                }
              }}
              aria-label={t("AI writing help", "Bantuan menulis AI")}
            />
          </label>
        )}
      </div>

      <Modal open={confirmOpen} title={t("Turn on AI writing help?", "Aktifkan bantuan menulis AI?")} onClose={() => setConfirmOpen(false)}>
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            {t(
              "Your matching knowledge notes and the text of drafts you choose to reword will be sent to",
              "Catatan pengetahuan yang cocok dan teks draf yang kamu pilih untuk diperbaiki akan dikirim ke",
            )}{" "}
            <strong>{provider}</strong>.{" "}
            {t("They may contain company or client information.", "Isinya bisa memuat informasi perusahaan atau klien.")}
          </p>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={policyChecked} onChange={(e) => setPolicyChecked(e.target.checked)} />
            <span>
              {t(
                "I confirm that my organization's policy explicitly permits this application and this AI provider to process this information.",
                "Aku menyatakan bahwa kebijakan organisasiku secara tegas mengizinkan aplikasi ini dan penyedia AI ini memproses informasi tersebut.",
              )}
            </span>
          </label>
          <Button block loading={busy} disabled={!policyChecked} onClick={() => save(true)}>
            {t("Turn on", "Aktifkan")}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
