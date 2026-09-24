"use client";

import useSWR, { useSWRConfig } from "swr";

import { fetcher } from "@/lib/api/client";
import type { AnalyticsData, AutomationStatus, Forecast, Patterns } from "@/types";

export function useAutomationStatus() {
  return useSWR<AutomationStatus>("/api/automation/status", fetcher);
}

export function useForecast() {
  // Deadlines and the shift move with the clock
  return useSWR<Forecast>("/api/automation/forecast", fetcher, { refreshInterval: 5 * 60_000 });
}

export function usePatterns() {
  return useSWR<Patterns>("/api/automation/patterns", fetcher);
}

export function useAnalytics() {
  return useSWR<AnalyticsData>("/api/automation/analytics", fetcher);
}

export function useRefreshAutomation() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/automation") || key.startsWith("/api/assistant/drafts") || key.startsWith("/api/learning")),
    );
}
