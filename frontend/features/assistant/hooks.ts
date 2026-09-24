"use client";

import useSWR, { useSWRConfig } from "swr";

import { fetcher } from "@/lib/api/client";
import type {
  AssistantInsights,
  AssistantStatus,
  Clarification,
  CommunicationDraft,
  KnowledgeCategory,
  KnowledgeListResponse,
} from "@/types";

export function useAssistantStatus() {
  return useSWR<AssistantStatus>("/api/assistant/status", fetcher);
}

export function useKnowledge(query: string, category: KnowledgeCategory | "") {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (category) params.set("category", category);
  const qs = params.toString();
  return useSWR<KnowledgeListResponse>(`/api/knowledge${qs ? `?${qs}` : ""}`, fetcher, { keepPreviousData: true });
}

export function useClarifications(state: "open" | "all" = "open", taskId?: string) {
  const params = new URLSearchParams({ state });
  if (taskId) params.set("task_id", taskId);
  return useSWR<{ items: Clarification[] }>(`/api/assistant/clarifications?${params}`, fetcher);
}

export function useDrafts(taskId?: string) {
  return useSWR<{ items: CommunicationDraft[] }>(`/api/assistant/drafts${taskId ? `?task_id=${taskId}` : ""}`, fetcher);
}

export function useInsights() {
  return useSWR<AssistantInsights>("/api/assistant/insights", fetcher);
}

/** After a change: assistant data, knowledge, and task data (questions add and close task issues). */
export function useRefreshAssistant() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/assistant") ||
          key.startsWith("/api/knowledge") ||
          key.startsWith("/api/tasks") ||
          key.startsWith("/api/planner") ||
          key.startsWith("/api/documents/settings")),
    );
}
