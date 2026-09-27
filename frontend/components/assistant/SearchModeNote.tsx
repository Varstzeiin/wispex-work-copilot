"use client";

import { useAssistantStatus } from "@/features/assistant/hooks";
import { t } from "@/lib/i18n";

function modeText(mode: string): string {
  const texts: Record<string, string> = {
    READY: t(
      "Search by meaning is on. It runs on the server, so your notes are not sent to any AI provider.",
      "Pencarian berdasarkan makna aktif. Berjalan di server, jadi catatanmu tidak dikirim ke penyedia AI mana pun.",
    ),
    LOADING: t(
      "Search by meaning is starting. Until it is ready, results match your words only.",
      "Pencarian berdasarkan makna sedang disiapkan. Sampai siap, hasil hanya mencocokkan kata-katamu.",
    ),
    UNAVAILABLE: t(
      "Search by meaning is unavailable on this server. Results match your words only.",
      "Pencarian berdasarkan makna tidak tersedia di server ini. Hasil hanya mencocokkan kata-katamu.",
    ),
    OFF: t(
      "Search by meaning is switched off on this server. Results match your words only.",
      "Pencarian berdasarkan makna dimatikan di server ini. Hasil hanya mencocokkan kata-katamu.",
    ),
  };
  return texts[mode] ?? "";
}

/** Honest note on how search currently works. */
export function SearchModeNote() {
  const { data } = useAssistantStatus();
  if (!data) return null;
  return <p className="text-xs text-slate-500">{modeText(data.semantic_search)}</p>;
}
