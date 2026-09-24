"use client";

import useSWR, { useSWRConfig } from "swr";

import { api, fetcher } from "@/lib/api/client";
import type { Issue, Task, TaskList, TaskStatus } from "@/types";

export interface TaskQuery {
  view?: "open" | "closed" | "all";
  status?: string;
  level?: string;
  q?: string;
  sort?: "priority" | "deadline" | "created";
  page?: number;
  pageSize?: number;
}

export function taskListKey(query: TaskQuery): string {
  const params = new URLSearchParams();
  if (query.view) params.set("view", query.view);
  if (query.status) params.set("status", query.status);
  if (query.level) params.set("level", query.level);
  if (query.q) params.set("q", query.q);
  if (query.sort) params.set("sort", query.sort);
  params.set("page", String(query.page ?? 1));
  params.set("page_size", String(query.pageSize ?? 25));
  return `/api/tasks?${params.toString()}`;
}

// Priority depends on the clock, so lists refresh every minute
export function useTasks(query: TaskQuery) {
  return useSWR<TaskList>(taskListKey(query), fetcher, { refreshInterval: 60_000, keepPreviousData: true });
}

export function useTask(id: string | null) {
  return useSWR<Task>(id ? `/api/tasks/${id}` : null, fetcher, { refreshInterval: 60_000 });
}

/** Revalidate everything that depends on task data after a change. */
export function useRefreshTaskData() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/tasks") ||
          key.startsWith("/api/planner") ||
          key.startsWith("/api/notifications") ||
          key.startsWith("/api/calendar")),
    );
}

export interface TaskPayload {
  title: string;
  shipment_reference?: string | null;
  client_name?: string | null;
  client_sla_tier?: "HIGH" | "STANDARD" | "LOW" | null;
  transport_mode?: "SEA" | "AIR" | null;
  eta?: string | null;
  submission_deadline?: string | null;
  estimated_minutes: number;
  required_documents: string[];
  available_documents: string[];
  assigned_action: string;
  notes: string;
  description: string;
  status?: TaskStatus;
  issues?: Issue[];
}

export const taskApi = {
  create: (payload: TaskPayload) => api.post<Task>("/api/tasks", payload),
  update: (id: string, payload: Partial<TaskPayload>) => api.patch<Task>(`/api/tasks/${id}`, payload),
  changeStatus: (id: string, status: TaskStatus, note = "", confirmVerified = false, checklist: string[] = []) =>
    api.post<Task>(`/api/tasks/${id}/status`, {
      status,
      note,
      confirm_verified: confirmVerified,
      checklist_confirmed: checklist,
    }),
  remove: (id: string) => api.delete(`/api/tasks/${id}`),
};
