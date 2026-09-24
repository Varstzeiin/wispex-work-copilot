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
  created_at?: string | null;
  resolved_at?: string | null;
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

// ---------- MVP 2: performance ----------

export type ErrorCategory =
  | "TYPOGRAPHICAL"
  | "DATA_READING"
  | "DATA_ENTRY"
  | "MISSING_INFORMATION"
  | "CROSS_DOCUMENT"
  | "SOP_PROCEDURE"
  | "COMMUNICATION"
  | "TIME_MANAGEMENT"
  | "OTHER";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ErrorStatus = "REPORTED" | "NOTIFIED" | "CORRECTING" | "RESOLVED";

export interface ErrorReport {
  id: string;
  task_id: string | null;
  shipment_reference: string;
  field_name: string;
  incorrect_value: string;
  correct_value: string;
  source_document: string;
  submitted_at: string | null;
  discovered_at: string;
  category: ErrorCategory;
  category_label: string;
  severity: Severity;
  impact: string;
  notified_person: string;
  notified_at: string | null;
  correction_notes: string;
  instructions: string;
  resolution: string;
  resolved_at: string | null;
  root_cause: ErrorCategory | "";
  root_cause_notes: string;
  prevention_action: string;
  status: ErrorStatus;
  steps: { step: number; label: string; done: boolean }[];
  correction_minutes: number | null;
  report_delay_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface CountItem {
  key: string;
  label: string;
  count: number;
}

export interface RecurringPattern {
  kind: "FIELD" | "CATEGORY";
  key: string;
  count: number;
  message: string;
  suggested_learning: string;
}

export interface ErrorAnalytics {
  days: number;
  total: number;
  open: number;
  tasks_completed: number;
  error_rate: number | null;
  by_category: CountItem[];
  by_severity: CountItem[];
  by_root_cause: CountItem[];
  avg_correction_minutes: number | null;
  rca_completed: number;
  resolved: number;
  reported_within_hour: number;
  trend: { week_start: string; count: number }[];
  recurring: RecurringPattern[];
}

export interface PeriodStats {
  tasks_completed: number;
  completed_on_time: number;
  completed_with_deadline: number;
  avg_processing_minutes: number | null;
  errors: number;
  error_categories: Record<string, number>;
  escalations: number;
  discrepancies: number;
  issue_types: Record<string, number>;
  learning_completed: number;
  feedback_applied: number;
}

export interface ShiftReviewData {
  review_date: string;
  is_today: boolean;
  stats: PeriodStats & {
    pending?: number;
    critical?: number;
    waiting?: number;
    tomorrow_priorities?: { task_id: string; label: string; reason: string }[];
  };
  recurring_issue: { source: string; label: string; count: number } | null;
  summary: string;
  reflection: { went_well: string; to_improve: string; tomorrow_focus: string; saved_at: string | null };
}

export interface WeeklyReviewData {
  week_start: string;
  week_end: string;
  stats: PeriodStats;
  previous_week: PeriodStats;
  days: { date: string; completed: number; errors: number; escalations: number }[];
  recurring_issue: { source: string; label: string; count: number } | null;
  shift_reviews_logged: number;
  reflection: { went_well: string; to_improve: string; next_week_focus: string; saved_at: string | null };
}

export interface ReviewHistory {
  shift_reviews: { review_date: string; tasks_completed: number; errors: number; has_reflection: boolean }[];
  weekly_reviews: { week_start: string; tasks_completed: number; errors: number; has_reflection: boolean }[];
}

export type LearningCategory = "SOP" | "DOCUMENT" | "TERMINOLOGY" | "PROCEDURE" | "SYSTEM" | "LESSON" | "OTHER";
export type LearningStatus = "TO_LEARN" | "LEARNING" | "UNDERSTOOD" | "APPLIED";

export interface LearningItem {
  id: string;
  title: string;
  category: LearningCategory;
  source: string;
  notes: string;
  status: LearningStatus;
  understood_at: string | null;
  created_at: string;
}

export interface FeedbackItem {
  id: string;
  received_at: string;
  from_role: string;
  summary: string;
  action_plan: string;
  applied: boolean;
  applied_at: string | null;
  applied_evidence: string;
}

export interface SkillItem {
  id: string;
  name: string;
  level: number;
  evidence: string;
  is_default: boolean;
  history: { level: number; at: string }[];
  updated_at: string;
}

export interface Indicator {
  key: string;
  label: string;
  value: string;
  status: "GOOD" | "WATCH" | "NEEDS_ATTENTION" | "NO_DATA";
  evidence: string[];
  note: string;
}

export interface DevelopmentPlanData {
  start_date: string | null;
  day_number: number | null;
  today: string;
  phases: {
    phase: 30 | 60 | 90;
    title: string;
    window: { start: string; end: string } | null;
    status: "NOT_STARTED" | "PAST" | "CURRENT" | "UPCOMING";
    goals: { id: string; title: string; done: boolean; done_at: string | null; evidence: string; is_default: boolean }[];
    goals_done: number;
    evidence: {
      tasks_completed: number;
      on_time_rate: number | null;
      errors: number;
      learning_completed: number;
      feedback_applied: number;
      shift_reviews: number;
    } | null;
  }[];
}

// ---------- MVP 3: documents ----------

export type DocumentType = "INVOICE" | "PACKING_LIST" | "BILL_OF_LADING" | "AIR_WAYBILL" | "OTHER" | "UNKNOWN";
export type ProcessingStatus =
  | "UPLOADED"
  | "QUEUED"
  | "PROCESSING"
  | "EXTRACTED"
  | "NEEDS_REVIEW"
  | "VERIFIED"
  | "FAILED"
  | "AI_NOT_PERMITTED";

export interface DocField {
  name: string;
  value: string | null;
  normalized: string | null;
  confidence: number;
  source: "AI" | "HUMAN";
  status: "OK" | "NEEDS_REVIEW" | "VERIFIED";
  rule_messages: string[];
  evidence: string;
}

export interface DocVersion {
  id: string;
  original_filename: string;
  uploaded_at: string;
  is_active_version: boolean;
  changes: { field: string; this: string | null; other: string | null }[];
}

export interface DocumentItem {
  id: string;
  task_id: string | null;
  shipment_reference: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  checksum_sha256: string;
  document_type: DocumentType;
  type_source: "USER" | "AI" | "HUMAN";
  type_confidence: number | null;
  is_active_version: boolean;
  version_count: number;
  processing_status: ProcessingStatus;
  processing_error: string;
  ai_provider: string;
  ai_model: string;
  has_file: boolean;
  is_demo: boolean;
  uploaded_at: string;
  processed_at: string | null;
  verified_at: string | null;
  fields: DocField[];
  review_count: number;
  versions?: DocVersion[];
}

export interface Comparison {
  field: string;
  document_a: string;
  value_a: string | null;
  document_b: string;
  value_b: string | null;
  difference: string;
  status: "MATCH" | "POTENTIAL_MISMATCH" | "CANNOT_COMPARE";
  requires_human_review: boolean;
  confidence: number;
  note: string;
}

export interface DiscrepancyItem {
  id: string;
  shipment_reference: string;
  task_id: string | null;
  field: string;
  document_a: string;
  document_a_id: string;
  value_a: string;
  document_b: string;
  document_b_id: string;
  value_b: string;
  difference: string;
  confidence: number;
  status: "OPEN" | "RESOLVED" | "DISMISSED" | "SUPERSEDED";
  requires_human_review: boolean;
  potential_impact: string;
  recommended_action: string;
  resolution_note: string;
  created_at: string;
  resolved_at: string | null;
}

export interface Completeness {
  required: string[];
  available: number;
  total: number;
  missing: string[];
}

export interface ShipmentGroup {
  shipment_reference: string;
  task_id: string | null;
  document_count: number;
  completeness: Completeness | null;
  open_discrepancies: number;
  fields_to_review: number;
  processing: number;
  version_choice_needed: boolean;
  documents: { id: string; original_filename: string; document_type: DocumentType; processing_status: ProcessingStatus; is_active_version: boolean }[];
  last_upload: string;
}

export interface ShipmentDetail {
  shipment_reference: string;
  task_id: string | null;
  completeness: Completeness;
  documents: DocumentItem[];
  comparisons: Comparison[];
  notes: string[];
  discrepancies: DiscrepancyItem[];
}

export interface DocumentStatus {
  ai_configured: boolean;
  ai_provider: string | null;
  ai_model: string | null;
  ai_allowed: boolean;
  ai_permission_confirmed: boolean;
  is_demo: boolean;
  max_upload_mb: number;
  max_pdf_pages: number;
  accepted: string[];
  storage: string;
}

export interface DocumentSettings {
  ai_processing_allowed: boolean;
  ai_permission_confirmed_at: string | null;
  review_threshold: number;
  weight_tolerance_pct: number;
  final_checklist: string[];
}

export interface UploadResult {
  results: { filename: string; status: "UPLOADED" | "DUPLICATE" | "REJECTED"; document_id?: string; message?: string }[];
  queued: number;
}
