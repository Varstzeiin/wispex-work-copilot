"use client";

import { Wand2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui";
import { useAssistantStatus } from "@/features/assistant/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import type { RewriteResult } from "@/types";

/**
 * Optional AI wording help. Shown as a working button only when AI writing help is permitted.
 * The server keeps the original text if any number or reference would change.
 */
export function RewriteButton({ text, onRewrite }: { text: string; onRewrite: (text: string) => void }) {
  const online = useOnline();
  const { data: status } = useAssistantStatus();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (!status) return null;
  if (!status.ai_allowed) {
    return (
      <p className="text-xs text-slate-500">
        {t("AI wording help:", "Bantuan kalimat AI:")}{" "}
        {!status.ai_configured
          ? t("Integration Required (no AI provider configured).", "Integration Required (belum ada penyedia AI).")
          : status.is_demo
            ? t("not available in the demo.", "tidak tersedia di demo.")
            : t(
                "off. You can switch it on in Settings if your organization permits it.",
                "mati. Bisa diaktifkan di Pengaturan kalau organisasi kamu mengizinkan.",
              )}
      </p>
    );
  }

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.post<RewriteResult>("/api/assistant/rewrite", { text });
      if (!r.kept_original) onRewrite(r.text);
      setMessage({ text: r.message, ok: !r.kept_original });
    } catch (e) {
      setMessage({ text: errorMessage(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button variant="ghost" onClick={run} loading={busy} disabled={!online || text.trim().length < 5}>
        <Wand2 className="h-4 w-4" aria-hidden /> {t("Improve wording with AI", "Perbaiki kalimat dengan AI")}
      </Button>
      {message && <p className={`text-xs ${message.ok ? "text-emerald-700" : "text-amber-800"}`}>{message.text}</p>}
    </div>
  );
}
