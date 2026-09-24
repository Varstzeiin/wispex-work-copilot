"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { Button, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui";
import { errorMessage, fetcher } from "@/lib/api/client";
import { useSettings } from "@/lib/hooks";
import { formatDateTime } from "@/lib/utils/time";
import type { AuditItem } from "@/types";

const ACTION_LABEL: Record<string, string> = {
  USER_REGISTERED: "Account created",
  USER_LOGGED_IN: "Signed in",
  DEMO_SESSION_STARTED: "Demo session started",
  TASK_CREATED: "Task created",
  TASK_UPDATED: "Task updated",
  TASK_STATUS_CHANGED: "Status changed",
  TASK_ESCALATED: "Task escalated",
  TASK_COMPLETED: "Task completed",
  TASK_DELETED: "Task deleted",
  SETTINGS_UPDATED: "Settings updated",
  CALENDAR_CONNECTED: "Google Calendar connected",
  CALENDAR_DISCONNECTED: "Google Calendar disconnected",
  CALENDAR_EVENT_CREATED: "Calendar reminder created",
  CALENDAR_EVENT_UPDATED: "Calendar reminder updated",
  CALENDAR_EVENT_DELETED: "Calendar reminder removed",
  ERROR_REPORTED: "Error reported",
  ERROR_UPDATED: "Error report updated",
  ERROR_STATUS_CHANGED: "Error workflow step",
  CORRECTION_COMPLETED: "Correction completed",
  SHIFT_REVIEW_SAVED: "End-of-shift review saved",
  WEEKLY_REVIEW_SAVED: "Weekly review saved",
  LEARNING_ITEM_CREATED: "Learning item added",
  LEARNING_PROGRESS: "Learning progress",
  FEEDBACK_RECORDED: "Feedback recorded",
  FEEDBACK_APPLIED: "Feedback applied",
  SKILL_LEVEL_CHANGED: "Skill level changed",
  DEVELOPMENT_PLAN_UPDATED: "30/60/90 plan updated",
  GOAL_UPDATED: "Development goal updated",
  DOCUMENT_UPLOADED: "Document uploaded",
  DOCUMENT_ANALYZED: "Document analysed",
  DOCUMENT_ANALYSIS_FAILED: "Document analysis failed",
  DOCUMENT_TYPE_SET: "Document type set",
  DOCUMENT_VERSION_SELECTED: "Document version chosen",
  DOCUMENT_VERIFIED: "Document verified",
  DOCUMENT_DOWNLOADED: "Document downloaded",
  DOCUMENT_DELETED: "Document deleted",
  FIELD_VERIFIED: "Document field checked",
  DISCREPANCY_DETECTED: "Discrepancy detected",
  DISCREPANCY_RESOLVED: "Discrepancy closed",
  AI_PERMISSION_CHANGED: "AI document reading changed",
  CHECKLIST_UPDATED: "Final checklist updated",
  KNOWLEDGE_NOTE_CREATED: "Knowledge note added",
  KNOWLEDGE_NOTE_UPDATED: "Knowledge note updated",
  KNOWLEDGE_NOTE_DELETED: "Knowledge note deleted",
  KNOWLEDGE_ANSWER_GENERATED: "Knowledge answer generated",
  CLARIFICATION_CREATED: "Clarification created",
  ESCALATION_CREATED: "Escalation created",
  CLARIFICATION_ANSWERED: "Answer recorded",
  CLARIFICATION_CANCELLED: "Question closed",
  MESSAGE_DRAFTED: "Message drafted",
  MESSAGE_MARKED_SENT: "Message sent by you",
  MESSAGE_REWRITTEN: "Draft reworded with AI",
  DRAFT_DELETED: "Draft deleted",
  AI_ASSIST_PERMISSION_CHANGED: "AI writing help changed",
  AUTOMATION_PERMISSION_CHANGED: "Insights or sending permission changed",
  EMAIL_SENT: "Email sent (approved by you)",
  TEAM_MESSAGE_POSTED: "Posted to team channel (approved by you)",
};

function describe(item: AuditItem): string | null {
  const prev = item.previous_state ?? {};
  const next = item.new_state ?? {};
  if ("status" in prev && "status" in next) return `${prev.status} → ${next.status}`;
  if (item.metadata && Array.isArray(item.metadata.fields) && item.metadata.fields.length)
    return `Changed: ${(item.metadata.fields as string[]).join(", ").replaceAll("_", " ")}`;
  if ("priority_level" in next) return `Priority ${next.priority_level}`;
  return null;
}

export default function ActivityPage() {
  const { timezone } = useSettings();
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useSWR<{ items: AuditItem[]; total: number; page_size: number }>(
    `/api/audit?page=${page}&page_size=30`,
    fetcher,
    { keepPreviousData: true },
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div>
      <PageHeader title="Activity log" subtitle="Your personal audit trail. Entries cannot be edited." />
      {error && <ErrorState message={errorMessage(error)} onRetry={() => mutate()} />}
      {!data && !error && <Spinner />}
      {data && data.items.length === 0 && <EmptyState title="No activity yet" />}
      {data && data.items.length > 0 && (
        <ol className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {data.items.map((item) => {
            const detail = describe(item);
            const isTask = item.entity === "task" && item.action !== "TASK_DELETED";
            const isError = item.entity === "error";
            const isDoc = item.entity === "document" && item.action !== "DOCUMENT_DELETED";
            return (
              <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {(isTask || isError || isDoc) && item.entity_id ? (
                      <Link href={`/${isTask ? "tasks" : isError ? "errors" : "documents"}/${item.entity_id}`} className="hover:underline">
                        {ACTION_LABEL[item.action] ?? item.action}
                      </Link>
                    ) : (
                      ACTION_LABEL[item.action] ?? item.action
                    )}
                  </p>
                  {detail && <p className="truncate text-xs text-slate-500">{detail}</p>}
                </div>
                <time className="shrink-0 text-xs tabular-nums text-slate-500">{formatDateTime(item.timestamp, timezone)}</time>
              </li>
            );
          })}
        </ol>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <span className="text-sm text-slate-500">
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
