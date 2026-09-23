"use client";

import useSWR from "swr";

import { fetcher } from "@/lib/api/client";
import type { Alert, DailyPlan, NextRecommendation } from "@/types";

export function usePlan() {
  return useSWR<DailyPlan>("/api/planner/today", fetcher, { refreshInterval: 60_000 });
}

/** Only fetched when the user asks, so the answer always reflects "now". */
export function useNextRecommendation(enabled: boolean) {
  return useSWR<NextRecommendation>(enabled ? "/api/planner/next" : null, fetcher, {
    revalidateOnFocus: false,
  });
}

export function useAlerts() {
  return useSWR<{ alerts: Alert[] }>("/api/notifications", fetcher, { refreshInterval: 60_000 });
}
