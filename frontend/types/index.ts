export type TaskStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "WAITING"
  | "NEEDS_REVIEW"
  | "ESCALATED"
  | "COMPLETED"
  | "ON_HOLD"
  | "CANCELLED";

export type PriorityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type DeadlineStatus = "OVERDUE" | "CRITICAL" | "URGENT" | "WATCH" | "SAFE" | "NO_DEADLINE";
export type Guidance = "SAFE_TO_PROCEED" | "VERIFY" | "ASK" | "ESCALATE" | "HOLD";
export type IssueType =
  | "QUANTITY_MISMATCH"
  | "WEIGHT_MISMATCH"
  | "DESCRIPTION_MISMATCH"
  | "VALUE_MISMATCH"
  | "MISSING_INFORMATION"
  | "LOW_CONFIDENCE"
  | "COMPLIANCE_QUESTION"
  | "OTHER";

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_demo: boolean;
}

export interface Issue {
  id: string;
  type: IssueType;
  description: string;
  resolved: boolean;
}

export interface DeadlineInfo {
  status: DeadlineStatus;
  minutes_remaining: number | null;
  overdue: boolean;
  approaching_critical: boolean;
  label: string;
}

export interface Factor {
  name: string;
  points: number;
  max_points: number;
  reason: string | null;
}

export interface CalendarLink {
  id: string;
  provider: "google" | "ics";
  sync_status: string;
  event_start: string;
  reminder_minutes: number[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  notes: string;
  status: TaskStatus;
  shipment_reference: string | null;
  client_name: string | null;
  client_sla_tier: "HIGH" | "STANDARD" | "LOW" | null;
  transport_mode: "SEA" | "AIR" | null;
  eta: string | null;
  submission_deadline: string | null;
  estimated_minutes: number;
  actual_minutes: number | null;
  required_documents: string[];
  available_documents: string[];
  missing_documents: string[];
  document_completeness: number;
  issues: Issue[];
  open_issue_count: number;
  assigned_action: string;
  priority_score: number;
  priority_level: PriorityLevel;
  priority_reasons: string[];
  risk_level: "HIGH" | "MEDIUM" | "LOW";
  guidance: Guidance;
  guidance_reason: string;
  deadline: DeadlineInfo;
  factors: Factor[];
  calendar_event: CalendarLink | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TaskList {
  items: Task[];
  total: number;
  page: number;
  page_size: number;
  counts: Record<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW", number>;
}

export interface PlanItem {
  position: number;
  task: Task;
  projected_start: string;
  projected_end: string;
  at_risk: boolean;
  next_action: string;
}

export interface DailyPlan {
  generated_at: string;
  shift: { status: "ON_SHIFT" | "BEFORE_SHIFT" | "AFTER_SHIFT"; start: string; end: string; available_minutes: number };
  counts: Record<"open" | "workable" | "blocked" | "critical" | "high" | "overdue" | "at_risk", number>;
  summary: string;
  estimated_workload_minutes: number;
  estimated_completion_time: string | null;
  overload: {
    is_overloaded: boolean;
    workload_minutes: number;
    available_minutes: number;
    shortfall_minutes: number;
    suggestions: string[];
  };
  follow_ups: { task_id: string; label: string; missing_documents: string[] }[];
  recommended_tasks: PlanItem[];
  blocked_tasks: Task[];
}

export interface NextRecommendation {
  recommendation: Task | null;
  follow_up: { task: Task; action: string; why: string } | null;
  explanation: string;
  alternatives: {
    task_id: string;
    label: string;
    priority_level: PriorityLevel;
    priority_score: number;
    deadline_label: string;
  }[];
  summary?: string;
}

export interface Alert {
  task_id: string;
  kind: "OVERDUE" | "CRITICAL" | "APPROACHING";
  title: string;
  message: string;
  minutes_remaining: number | null;
  created_recently: boolean;
}

export interface NotificationPrefs {
  in_app: boolean;
  browser: boolean;
  notify_new_critical: boolean;
  notify_approaching_critical: boolean;
}

export interface Settings {
  timezone: string;
  shift_start: string;
  shift_end: string;
  deadline_thresholds: {
    critical_minutes: number;
    urgent_minutes: number;
    watch_minutes: number;
    warn_before_critical_minutes: number;
  };
  priority_weights: Record<
    "deadline" | "eta" | "risk" | "missing_documents" | "client_priority" | "complexity" | "task_age",
    number
  >;
  level_thresholds: Record<string, number>;
  notification_prefs: NotificationPrefs;
  google_calendar_available: boolean;
  google_calendar_connected: boolean;
}

export interface CalendarEventItem {
  id: string;
  task_id: string;
  task_title: string | null;
  shipment_reference: string | null;
  title: string;
  provider: "google" | "ics";
  event_start: string;
  event_end: string;
  reminder_minutes: number[];
  sync_status: "SYNCED" | "PENDING" | "FAILED" | "LOCAL_ONLY" | "OUT_OF_DATE";
  last_error: string;
}

export interface AuditItem {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  timestamp: string;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}
