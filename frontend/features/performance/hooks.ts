"use client";

import useSWR, { useSWRConfig } from "swr";

import { fetcher } from "@/lib/api/client";
import type {
  DevelopmentPlanData,
  ErrorAnalytics,
  ErrorReport,
  FeedbackItem,
  Indicator,
  LearningItem,
  ReviewHistory,
  ShiftReviewData,
  SkillItem,
  WeeklyReviewData,
} from "@/types";

export function useErrors(status: "open" | "resolved" | "all", page: number) {
  return useSWR<{ items: ErrorReport[]; total: number; page_size: number }>(
    `/api/errors?status=${status}&page=${page}&page_size=20`,
    fetcher,
    { keepPreviousData: true },
  );
}

export function useError(id: string) {
  return useSWR<ErrorReport>(`/api/errors/${id}`, fetcher);
}

export function useErrorAnalytics(days: number) {
  return useSWR<ErrorAnalytics>(`/api/errors/analytics?days=${days}`, fetcher, { keepPreviousData: true });
}

export function useShiftReview(date: string | null) {
  return useSWR<ShiftReviewData>(`/api/reviews/shift${date ? `?review_date=${date}` : ""}`, fetcher, {
    keepPreviousData: true,
  });
}

export function useWeeklyReview(weekStart: string | null) {
  return useSWR<WeeklyReviewData>(`/api/reviews/weekly${weekStart ? `?week_start=${weekStart}` : ""}`, fetcher, {
    keepPreviousData: true,
  });
}

export function useReviewHistory() {
  return useSWR<ReviewHistory>("/api/reviews/history", fetcher);
}

export function useLearningItems() {
  return useSWR<LearningItem[]>("/api/learning/items", fetcher);
}

export function useFeedback() {
  return useSWR<FeedbackItem[]>("/api/learning/feedback", fetcher);
}

export function useSkills() {
  return useSWR<{ levels: Record<string, string>; skills: SkillItem[] }>("/api/learning/skills", fetcher);
}

export function useIndicators(days: number) {
  return useSWR<{ days: number; indicators: Indicator[] }>(`/api/growth/indicators?days=${days}`, fetcher, {
    keepPreviousData: true,
  });
}

export function useDevelopmentPlan() {
  return useSWR<DevelopmentPlanData>("/api/growth/plan", fetcher);
}

/** Performance numbers depend on each other (errors feed reviews and indicators). */
export function useRefreshPerformance() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate(
      (key) =>
        typeof key === "string" &&
        ["/api/errors", "/api/reviews", "/api/learning", "/api/growth", "/api/audit"].some((p) => key.startsWith(p)),
    );
}
