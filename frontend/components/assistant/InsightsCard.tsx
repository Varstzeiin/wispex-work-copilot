"use client";

import { ListPlus, Microscope } from "lucide-react";
import { useState } from "react";

import { Button, Card, InlineError, Modal, SectionTitle, inputClass } from "@/components/ui";
import { useInsights, useRefreshAssistant } from "@/features/assistant/hooks";
import { api, errorMessage } from "@/lib/api/client";
import { useOnline } from "@/lib/hooks";
import { t } from "@/lib/i18n";

/** Error analysis and adaptive personal checklist. Nothing changes without the user's confirmation. */
export function InsightsCard() {
  const online = useOnline();
  const refresh = useRefreshAssistant();
  const { data } = useInsights();
  const [active, setActive] = useState<{ key: string; item: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!data) return null;

  async function act(kind: "accept" | "dismiss", key: string, item = "") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/assistant/checklist-suggestions/${kind}`, { key, item });
      await refresh();
      setDone(kind === "accept" ? t(`Added to your final checklist: “${item}”`, `Ditambahkan ke checklist akhirmu: “${item}”`) : null);
      setActive(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle>
        <span className="flex items-center gap-2">
          <Microscope className="h-4 w-4 text-brand-600" aria-hidden /> {t("Error analysis", "Analisis kesalahan")}
        </span>
      </SectionTitle>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        {data.insights.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {data.suggestions.map((s) => (
        <div key={s.key} className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
          <p>{s.message}</p>
          <p className="mt-1 font-medium">
            {t("Suggested checklist item:", "Usulan item checklist:")} “{s.item}”
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => setActive(s)} disabled={!online}>
              <ListPlus className="h-4 w-4" aria-hidden /> {t("Review and add", "Tinjau dan tambahkan")}
            </Button>
            <Button variant="ghost" onClick={() => act("dismiss", s.key)} disabled={!online || busy}>
              {t("Not now", "Nanti saja")}
            </Button>
          </div>
        </div>
      ))}
      {done && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {done}
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">{data.note}{" "}
        {t(
          "Suggestions only change your personal checklist, never official SOP.",
          "Saran hanya mengubah checklist pribadimu, tidak pernah SOP resmi.",
        )}</p>

      <Modal open={!!active} title={t("Add to your final checklist?", "Tambahkan ke checklist akhirmu?")} onClose={() => setActive(null)}>
        {active && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{active.message}</p>
            <label htmlFor="suggested-item" className="block text-sm font-medium text-slate-700">
              {t("Checklist item (you can change the wording)", "Item checklist (kalimatnya bisa kamu ubah)")}
            </label>
            <input
              id="suggested-item"
              className={inputClass}
              value={active.item}
              maxLength={120}
              onChange={(e) => setActive({ ...active, item: e.target.value })}
            />
            <InlineError message={error} />
            <Button block loading={busy} disabled={!active.item.trim()} onClick={() => act("accept", active.key, active.item.trim())}>
              {t("Add to my checklist", "Tambahkan ke checklistku")}
            </Button>
          </div>
        )}
      </Modal>
    </Card>
  );
}
