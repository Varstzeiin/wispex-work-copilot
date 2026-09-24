"use client";

import { useAssistantStatus } from "@/features/assistant/hooks";

const TEXT: Record<string, string> = {
  READY: "Search by meaning is on. It runs on the server, so your notes are not sent to any AI provider.",
  LOADING: "Search by meaning is starting. Until it is ready, results match your words only.",
  UNAVAILABLE: "Search by meaning is unavailable on this server. Results match your words only.",
  OFF: "Search by meaning is switched off on this server. Results match your words only.",
};

/** Honest note on how search currently works. */
export function SearchModeNote() {
  const { data } = useAssistantStatus();
  if (!data) return null;
  return <p className="text-xs text-slate-500">{TEXT[data.semantic_search]}</p>;
}
